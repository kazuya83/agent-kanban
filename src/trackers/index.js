// 課題管理・チャットサービスとの連携の土台。プロバイダの登録と、プロバイダを呼ぶときの共通の処理。
//
// ---------- プロバイダの共通の形 ----------
// サービスを足すには src/trackers/<id>.js に下の形のオブジェクトを書き、このファイルの末尾の BUILTIN に足す。
//
// 必須
//   id: 'linear'（英小文字で始まる ID。c.issue.provider と設定に保存する）
//   label: 'Linear'（画面に出す名前）
// 任意（持たない機能は書かない。アプリは「その機能はないもの」として動く）
//   configFields: [{ name, type, label, placeholder?, help?, required?, default?, options?, allowHttpField? }]
//     設定の「連携」に出す欄。type は text / textarea / url / secret / checkbox / select。
//     label・placeholder・help は日本語の原文で書く（画面が tr() で訳す）。
//     secret の値は src/secrets.js で暗号化して保存し、ctx.secret(name) でだけ読める。ほかの値は settings.trackerConfigs に入る。
//     url は保存のときに http.validateBaseUrl で確かめる。http を許可する checkbox があれば、その name を allowHttpField に書く。
//     url を変えたときは、一緒に入れ直さなかった secret を消す（保存したトークンを別の接続先へ送らないため）。
//     select の options は [{ value, label }]。
//   testConnection(ctx) → { ok: boolean, message?: string }   接続テスト。ctx には画面に入力中の値も入る
//
//   matchesRemote(url, config) → boolean   origin の URL がこのサービスのものか（プロジェクトの初期値を決める）
//   statusLabel: 'GitHub Projects'   状態同期のログに出す名前（無ければ label）
//   refPlaceholder: '例: ENG-123'   Issue の入力欄の例（日本語の原文で書く）
//   linkLine(ref) → string   PR / MR の本文に入れる1行（無ければ「キー URL」。ref は fetchIssue の結果）
//
//   課題管理サービスは次を持つ（parseRefs と fetchIssue の両方があるものが、プロジェクトの設定で選べる）
//   parseRefs(ctx, text) → ref[]   入力の番号や URL から Issue の参照を取り出す。読めない入力は例外にする
//     ref: { key: 'ENG-123', number?: 123 }   key は表示にも重複の判定にも使うので、同じ Issue はいつも同じ文字にする
//   fetchIssue(ctx, ref) → { key, number?, title, body, url, state: 'open'|'closed', labels?: string[], comments?: [{ author, body }] }
//   setStatus(ctx, ref, statusKey) → { updated: [{ project?, from?, to }], skipped: [{ project?, reason }], projects?: number }
//     statusKey は inProgress / inReview / done（カードの状態から決まる）。projects が 0 なら「対象がなかった」とログに出す
//   addComment(ctx, ref, body) → { url? }
//   createSubIssue(ctx, parentRef, { title, body }) → { key, number?, title, url }
//   fetchSubIssues(ctx, parentRef) → fetchIssue と同じ形の配列（comments は無くてよい）
//
// 上の ref には、カードの c.issue（renderer/issue-ref.js の形）もそのまま渡る。
// チャットサービス（parseRefs・fetchIssue を持たない）は、configFields と testConnection で「連携」の欄にだけ出る。
//
// ctx（呼び出しごとに作る）: { provider, repoPath, config, settings, ghPath, secret(name) }
//   config: このサービスの設定（secret を除く） / settings: プロジェクトの設定 / secret(name): 保存したトークンを読む
//   トークンを返り値・例外の文・ログ・ファイル・環境変数に入れない。API は http.js の request を使い、secrets に渡す。
//   ここで投げた例外の文からも、secret で読んだ値は消す（呼ぶ側の call が行う）
const { EventEmitter } = require('events');
const { tr } = require('../../renderer/i18n');
const { DEFAULT_PROVIDER, keyOf, cleanIssue } = require('../../renderer/issue-ref');
const { validateBaseUrl, redact } = require('./http');

const FIELD_TYPES = ['text', 'textarea', 'url', 'secret', 'checkbox', 'select'];
const MAX_FIELD_LENGTH = 4000;
const MAX_SECRET_LENGTH = 8192;

const registry = new Map();

const canIssues = (p) => typeof p.fetchIssue === 'function';

function register(provider) {
  const p = provider || {};
  if (!/^[a-z][a-z0-9-]*$/.test(String(p.id || ''))) throw new Error(`invalid tracker id: ${p.id}`);
  if (registry.has(p.id)) throw new Error(`tracker already registered: ${p.id}`);
  if (!p.label) throw new Error(`tracker ${p.id}: label is required`);
  if (canIssues(p) !== (typeof p.parseRefs === 'function')) throw new Error(`tracker ${p.id}: parseRefs and fetchIssue go together`);
  const names = new Set();
  for (const f of p.configFields || []) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(String(f.name || '')) || names.has(f.name)) throw new Error(`tracker ${p.id}: bad field name: ${f.name}`);
    if (!FIELD_TYPES.includes(f.type)) throw new Error(`tracker ${p.id}: bad field type: ${f.type}`);
    names.add(f.name);
  }
  registry.set(p.id, p);
  return p;
}

function unregister(id) {
  return registry.delete(id);
}

const get = (id) => registry.get(id) || null;
const list = () => [...registry.values()];
const issueProviders = () => list().filter(canIssues);
const isIssueProvider = (id) => !!get(id) && canIssues(get(id));
const fieldsOf = (p) => p.configFields || [];
const secretFields = (p) => fieldsOf(p).filter((f) => f.type === 'secret');
const secretName = (id, field) => `tracker:${id}:${field}`;

// 画面の入力から、保存する設定を作る（secret は入れない）。URL が正しくなければ例外
function cleanConfig(p, input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const f of fieldsOf(p)) {
    if (f.type === 'secret') continue;
    const v = src[f.name];
    if (f.type === 'checkbox') {
      out[f.name] = v === undefined ? !!f.default : !!v;
    } else if (f.type === 'select') {
      const values = (f.options || []).map((o) => o.value);
      out[f.name] = values.includes(v) ? v : f.default !== undefined ? f.default : values[0];
    } else {
      out[f.name] = String(v === undefined || v === null || v === '' ? (f.default === undefined ? '' : f.default) : v).trim().slice(0, MAX_FIELD_LENGTH);
    }
  }
  for (const f of fieldsOf(p)) if (f.type === 'url' && out[f.name]) out[f.name] = validateBaseUrl(out[f.name], { allowHttp: !!(f.allowHttpField && out[f.allowHttpField]) });
  return out;
}

// 接続先（url の欄）が変わったか
const urlChanged = (p, a, b) => fieldsOf(p).some((f) => f.type === 'url' && a[f.name] !== b[f.name]);

// 画面から来たトークンを整える（空の欄は「変えない」）
function cleanSecrets(p, input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const f of secretFields(p)) {
    const v = String(src[f.name] == null ? '' : src[f.name]).trim();
    if (!v) continue;
    if (v.length > MAX_SECRET_LENGTH || /[\r\n]/.test(v)) throw new Error(tr('「{label}」の値が正しくありません', { label: tr(f.label) }));
    out[f.name] = v;
  }
  return out;
}

// ボードに載せる課題管理サービスの一覧（設定もトークンの有無も入れない）
function issueProviderMeta() {
  return issueProviders().map((p) => ({
    id: p.id,
    label: p.label,
    refPlaceholder: p.refPlaceholder || '',
    canSync: typeof p.setStatus === 'function',
    canSubIssue: typeof p.createSubIssue === 'function',
  }));
}

/**
 * 設定とトークンを持って、プロバイダを呼ぶ
 * store: アプリの Store / secrets: src/secrets.js の SecretStore（無ければトークンを使えない）
 * 'changed' イベント（id）: 連携の設定が変わった
 */
class Trackers extends EventEmitter {
  constructor({ store, secrets = null } = {}) {
    super();
    this.store = store;
    this.secrets = secrets;
  }

  mustGet(id) {
    const p = get(id);
    if (!p) throw new Error(tr('連携先「{id}」は使えません', { id: String(id) }));
    return p;
  }

  configOf(id) {
    const p = this.mustGet(id);
    return cleanConfig(p, (this.store.settings.trackerConfigs || {})[id]);
  }

  hasSecret(id, field) {
    return !!this.secrets && this.secrets.has(secretName(id, field));
  }

  // そのプロジェクトで使う課題管理サービス
  forRepo(repoPath) {
    const id = this.store.repoSettings(repoPath).issueProvider || DEFAULT_PROVIDER;
    const p = this.mustGet(id);
    if (!canIssues(p)) throw new Error(tr('連携先「{id}」は使えません', { id }));
    return p;
  }

  // origin の URL から、プロジェクトの初期値にする課題管理サービスを決める
  guessFromRemote(url) {
    const hit = issueProviders().find((p) => typeof p.matchesRemote === 'function' && p.matchesRemote(url, this.configOf(p.id)));
    return hit ? hit.id : DEFAULT_PROVIDER;
  }

  // draft: 接続テストで使う、画面に入力中の値 { config, secrets }
  context(p, { repoPath = '', ghPath, draft = null, used = [] } = {}) {
    const saved = this.configOf(p.id);
    const config = draft ? cleanConfig(p, { ...saved, ...(draft.config || {}) }) : saved;
    const drafted = draft ? cleanSecrets(p, draft.secrets) : {};
    return {
      provider: p.id,
      repoPath,
      ghPath,
      config,
      settings: repoPath ? this.store.repoSettings(repoPath) : {},
      secret: (name) => {
        let v = drafted[name];
        if (v === undefined && this.secrets) v = this.secrets.get(secretName(p.id, name));
        if (v) used.push(v);
        return v || '';
      },
    };
  }

  // プロバイダのメソッドを呼ぶ。例外の文に読んだトークンが混ざっていても消す
  async call(id, method, { repoPath, ghPath, draft } = {}, ...args) {
    const p = this.mustGet(id);
    if (typeof p[method] !== 'function') throw new Error(tr('{label} はこの機能に対応していません', { label: p.label }));
    const used = [];
    try {
      return await p[method](this.context(p, { repoPath, ghPath, draft, used }), ...args);
    } catch (err) {
      if (err && used.length) err.message = redact(err.message, used);
      throw err;
    }
  }

  // 入力から Issue の参照を取り出す（同じ Issue は1つにする）
  async parseRefs(id, repoPath, text) {
    const refs = await this.call(id, 'parseRefs', { repoPath }, text);
    const out = new Map();
    for (const r of refs || []) {
      const ref = cleanIssue({ ...r, provider: id });
      if (ref && !out.has(ref.key)) out.set(ref.key, ref);
    }
    if (!out.size) throw new Error(tr('Issue を入力してください'));
    return [...out.values()];
  }

  // プロバイダ（またはテストの差し替え）が返した Issue に、provider・key・linkLine を入れる
  normalizeIssue(id, issue) {
    const p = get(id);
    const out = { ...issue, provider: id, key: keyOf(issue) };
    if (p && typeof p.linkLine === 'function') out.linkLine = p.linkLine(out);
    return out;
  }

  // 「連携」の欄に出す一覧。トークンは設定済みかどうかだけ返す（画面と遠隔のクライアントに渡るので、値を入れない）
  publicList() {
    return list().map((p) => {
      const config = this.configOf(p.id);
      const secrets = {};
      for (const f of secretFields(p)) secrets[f.name] = this.hasSecret(p.id, f.name);
      const fields = fieldsOf(p).map(({ name, type, label, placeholder, help, required, options, allowHttpField }) => ({ name, type, label, placeholder, help, required: !!required, options, allowHttpField }));
      const configured = fieldsOf(p).every((f) => !f.required || (f.type === 'secret' ? secrets[f.name] : !!config[f.name]));
      return { id: p.id, label: p.label, issues: canIssues(p), configFields: fields, config, secrets, configured, canTest: typeof p.testConnection === 'function', saved: !!(this.store.settings.trackerConfigs || {})[p.id] };
    });
  }

  publicOne(id) {
    return this.publicList().find((x) => x.id === id);
  }

  /**
   * 設定とトークンを保存する
   * @param {string} id
   * @param {{ config?: object, secrets?: object }} p secrets の空の欄は変えない
   * @returns 「連携」の欄の1件。cleared: 接続先を変えたので消したトークンの欄
   */
  save(id, { config, secrets } = {}) {
    const p = this.mustGet(id);
    const prev = this.configOf(id);
    const next = cleanConfig(p, { ...prev, ...(config && typeof config === 'object' ? config : {}) });
    const given = cleanSecrets(p, secrets);
    for (const f of fieldsOf(p)) {
      const missing = f.type === 'secret' ? !given[f.name] && (!this.hasSecret(id, f.name) || urlChanged(p, prev, next)) : !next[f.name];
      if (f.required && missing && f.type !== 'checkbox') throw new Error(tr('「{label}」を入れてください', { label: tr(f.label) }));
    }
    if (Object.keys(given).length && !this.secrets) throw new Error(tr('このマシンでは OS の安全な保存先を使えないので、トークンを保存できません（平文では保存しません）。Linux では GNOME Keyring や KWallet などを使えるようにしてください'));
    for (const [name, value] of Object.entries(given)) this.secrets.set(secretName(id, name), value);
    const cleared = [];
    if (urlChanged(p, prev, next)) {
      for (const f of secretFields(p)) if (!given[f.name] && this.hasSecret(id, f.name) && this.secrets.delete(secretName(id, f.name))) cleared.push(f.name);
    }
    this.store.settings.trackerConfigs = { ...(this.store.settings.trackerConfigs || {}), [id]: next };
    this.store.save();
    this.emit('changed', id);
    return { ...this.publicOne(id), cleared };
  }

  // 設定とトークンを消す
  remove(id) {
    const p = this.mustGet(id);
    for (const f of secretFields(p)) if (this.secrets) this.secrets.delete(secretName(id, f.name));
    const rest = { ...(this.store.settings.trackerConfigs || {}) };
    delete rest[id];
    this.store.settings.trackerConfigs = rest;
    this.store.save();
    this.emit('changed', id);
    return this.publicOne(id);
  }

  /**
   * 接続テスト。draft は画面に入力中の値（保存しない）。
   * 保存したトークンは、保存した接続先にしか送らない（接続先を変えたら、トークンも入れてもらう）
   */
  async test(id, draft = {}) {
    const p = this.mustGet(id);
    const d = draft && typeof draft === 'object' ? draft : {};
    const prev = this.configOf(id);
    const next = cleanConfig(p, { ...prev, ...(d.config || {}) });
    const given = cleanSecrets(p, d.secrets);
    if (urlChanged(p, prev, next) && secretFields(p).some((f) => !given[f.name] && this.hasSecret(id, f.name))) throw new Error(tr('接続先を変えたときは、トークンも入れ直してください'));
    return this.call(id, 'testConnection', { draft: d });
  }
}

// 組み込みのプロバイダ。サービスを足すときは、ここに1行足す
const BUILTIN = ['./github'];
for (const file of BUILTIN) register(require(file));

module.exports = { Trackers, register, unregister, get, list, issueProviders, isIssueProvider, issueProviderMeta, cleanConfig, secretName };
