// Jira のプロバイダ（Cloud と Data Center）。形は src/trackers/index.js の先頭のコメントのとおり。
// - Cloud: REST API v3、メールアドレス + API トークンの Basic 認証、本文は ADF
// - Data Center: REST API v2、Personal Access Token の Bearer 認証、本文は文字列
// リポジトリは GitHub / GitLab のままなので、PR / MR はそのサービスの処理で作る。ここでは課題だけを扱う
const { request, joinUrl, redact, HttpError } = require('./http');
const { adfToText, textToAdf } = require('./adf');
const { PROJECT_STATUS, normalizeStatusName, pickStatusOption } = require('../github');
const { tr } = require('../../renderer/i18n');

const LABEL = 'Jira';
const MAX_SUMMARY = 255; // Jira の summary の上限
const MAX_COMMENTS = 20; // 指示に入れるコメントの数（新しいほうから）
const ISSUE_FIELDS = 'summary,description,status,labels';

// 課題キー。プロジェクトのキーの形は管理者が変えられるので、広めに受ける
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-[1-9]\d*$/;

const isCloud = (config) => config.deployment !== 'datacenter';

// ---------- API ----------

// 認証ヘッダーとトークンを1つの呼び出しの中に閉じ込める。トークンは返さない
function client(ctx) {
  const { config } = ctx;
  if (!config.baseUrl) throw new Error(tr('{label} の接続先の URL を設定してください（設定の「連携」）', { label: LABEL }));
  const token = ctx.secret('token');
  if (!token) throw new Error(tr('{label} のトークンを設定してください（設定の「連携」）', { label: LABEL }));
  const cloud = isCloud(config);
  if (cloud && !config.email) throw new Error(tr('Jira Cloud ではメールアドレスも設定してください（設定の「連携」）'));
  const basic = cloud ? Buffer.from(`${config.email}:${token}`).toString('base64') : '';
  const authorization = cloud ? `Basic ${basic}` : `Bearer ${token}`;
  const secrets = [token, basic].filter(Boolean);
  const version = cloud ? '3' : '2';
  return {
    secrets,
    async call(pathName, opts = {}) {
      const r = await request(joinUrl(config.baseUrl, `rest/api/${version}/${pathName}`), { ...opts, headers: { Authorization: authorization }, label: LABEL, secrets });
      return r.data;
    },
  };
}

// 本文やコメントを、サービスの形にする
const toBody = (config, text) => (isCloud(config) ? textToAdf(text) : String(text == null ? '' : text));

const browseUrl = (config, key) => joinUrl(config.baseUrl, `browse/${key}`);

// カードの ref から API に渡すキーを取り出す（URL のパスに入れるので、形を確かめる）
function keyOfRef(ref) {
  const key = String((ref && ref.key) || '').trim();
  if (!KEY_RE.test(key)) throw new Error(tr('Jira の課題キーとして読めません: {v}', { v: key }));
  return key.toUpperCase();
}

const issuePath = (key, rest = '') => `issue/${encodeURIComponent(key)}${rest}`;
const closedOf = (fields) => (((fields || {}).status || {}).statusCategory || {}).key === 'done';

// ---------- キーと URL の解釈 ----------

// https://x.atlassian.net/browse/ABC-1、…/projects/ABC/issues/ABC-1、…/boards/1?selectedIssue=ABC-1 など
function keyFromUrl(text, baseUrl) {
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (!baseUrl) throw new Error(tr('{label} の接続先の URL を設定してください（設定の「連携」）', { label: LABEL }));
  // 別のサイトの URL を、たまたま同じキーの手元の課題として読まないようにする
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  if (u.origin !== base.origin || !(u.pathname === basePath || u.pathname.startsWith(`${basePath}/`))) throw new Error(tr('設定した {label} の接続先の URL ではありません: {v}', { label: LABEL, v: u.origin }));
  const selected = u.searchParams.get('selectedIssue');
  if (selected && KEY_RE.test(selected)) return selected;
  return u.pathname.split('/').reverse().find((s) => KEY_RE.test(s)) || null;
}

function parseRefs(ctx, text) {
  const words = String(text || '').split(/[\s,、]+/).filter(Boolean);
  if (!words.length) throw new Error(tr('課題のキーか URL を入力してください（例: ABC-123）'));
  const bad = [];
  const refs = [];
  for (const word of words) {
    const key = KEY_RE.test(word) ? word : /^https?:\/\//i.test(word) ? keyFromUrl(word, ctx.config.baseUrl) : null;
    if (key) refs.push({ key: key.toUpperCase() });
    else bad.push(word);
  }
  if (bad.length) throw new Error(tr('Jira の課題キーや URL として読めません: {v}', { v: bad.join(', ') }));
  return refs;
}

// ---------- 課題 ----------

async function fetchComments(api, key) {
  const d = await api.call(issuePath(key, '/comment'), { query: { orderBy: '-created', maxResults: MAX_COMMENTS } });
  return [...((d && d.comments) || [])]
    .sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')))
    .map((c) => ({ author: (c.author && (c.author.displayName || c.author.name)) || '', body: adfToText(c.body) }));
}

function toIssue(config, key, fields, comments) {
  const f = fields || {};
  return {
    key,
    title: f.summary || '',
    body: adfToText(f.description),
    url: browseUrl(config, key),
    state: closedOf(f) ? 'closed' : 'open',
    labels: f.labels || [],
    comments,
  };
}

async function fetchIssue(ctx, ref) {
  const api = client(ctx);
  const key = keyOfRef(ref);
  const [d, comments] = await Promise.all([api.call(issuePath(key), { query: { fields: ISSUE_FIELDS } }), fetchComments(api, key)]);
  return toIssue(ctx.config, d.key || key, d.fields, comments);
}

// ---------- 状態同期 ----------

// カードの状態 → Jira の状態カテゴリ。レビューに当たるカテゴリは無いので、名前で探す（下の pickTransition）
const CATEGORY = { inProgress: 'indeterminate', inReview: 'indeterminate', done: 'done' };
// 同じカテゴリでも、作業が済んだ・進んでいるとは言えない状態（名前の指定が無いときは選ばない）
const AVOID = {
  inProgress: /blocked|onhold|waiting|保留|ブロック/,
  done: /wontdo|wontfix|reject|cancel|declin|duplicate|invalid|却下|取り消|取消|キャンセル|中止|重複/,
};

const targetName = (t) => (t.to && t.to.name) || t.name || '';
const targetCategory = (t) => ((t.to && t.to.statusCategory) || {}).key || '';
const isReviewName = (name) => !!pickStatusOption([{ id: 'x', name }], 'inReview', '');
const transitionOptions = (list) => list.flatMap((t) => [{ id: t.id, name: targetName(t) }, { id: t.id, name: t.name || '' }]);

/**
 * その課題で使えるトランジションから、カードの状態に合うものを選ぶ
 * @param {object[]} transitions GET /issue/{key}/transitions の transitions
 * @param {'inProgress'|'inReview'|'done'} key
 * @param {string} mapping プロジェクトの設定で指定した名前（カンマ区切りで複数可。トランジションか移動先の状態の名前）
 * @param {object} status 課題の今の状態
 * @returns {{ transition?: object, unchanged?: boolean, reason?: string }}
 */
function pickTransition(transitions, key, mapping, status) {
  const usable = (Array.isArray(transitions) ? transitions : []).filter((t) => t && t.id && t.isAvailable !== false);
  const now = (status && status.name) || '';
  const nowCategory = ((status && status.statusCategory) || {}).key || '';
  const byId = (hit) => usable.find((t) => t.id === hit.id);
  const names = usable.map(targetName).join(', ');

  if (normalizeStatusName(mapping)) {
    if (pickStatusOption([{ id: 'now', name: now }], key, mapping)) return { unchanged: true };
    const hit = usable.length ? pickStatusOption(transitionOptions(usable), key, mapping) : null;
    if (hit) return { transition: byId(hit) };
    return { reason: usable.length ? tr('設定した「{mapping}」に当たるトランジションがありません（使えるもの: {names}）', { mapping, names }) : tr('この課題で今使えるトランジションがありません') };
  }

  const reviewing = isReviewName(now);
  if (key === 'done' ? nowCategory === 'done' : key === 'inReview' ? reviewing : nowCategory === 'indeterminate' && !reviewing) return { unchanged: true };
  if (!usable.length) return { reason: tr('この課題で今使えるトランジションがありません') };
  let list = usable.filter((t) => targetCategory(t) === CATEGORY[key]);
  if (key === 'inProgress') list = list.filter((t) => !isReviewName(targetName(t)));
  const hit = list.length ? pickStatusOption(transitionOptions(list), key, '') : null;
  const avoid = AVOID[key];
  const transition = hit ? byId(hit) : avoid ? list.find((t) => !avoid.test(normalizeStatusName(targetName(t)))) : null;
  if (transition) return { transition };
  return { reason: tr('「{label}」に当たるトランジションがありません（使えるもの: {names}）', { label: PROJECT_STATUS[key].label, names }) };
}

async function setStatus(ctx, ref, statusKey) {
  if (!PROJECT_STATUS[statusKey]) throw new Error(tr('不明なステータスです: {key}', { key: statusKey }));
  const api = client(ctx);
  const key = keyOfRef(ref);
  const [issue, available] = await Promise.all([api.call(issuePath(key), { query: { fields: 'status' } }), api.call(issuePath(key, '/transitions'))]);
  const status = (issue.fields || {}).status || {};
  const mapping = (ctx.settings.statusMapping || {})[statusKey] || '';
  const picked = pickTransition(available && available.transitions, statusKey, mapping, status);
  if (picked.unchanged) return { updated: [], skipped: [] };
  if (!picked.transition) return { updated: [], skipped: [{ reason: picked.reason }] };
  const to = targetName(picked.transition);
  try {
    await api.call(issuePath(key, '/transitions'), { method: 'POST', json: { transition: { id: picked.transition.id } } });
  } catch (err) {
    // 必須項目があるトランジションなど。Jira が断っただけなので、タスクの失敗にはしない
    if (err instanceof HttpError && (err.status === 400 || err.status === 409)) return { updated: [], skipped: [{ reason: tr('「{to}」へのトランジションを実行できませんでした: {message}', { to, message: err.message }) }] };
    throw err;
  }
  return { updated: [{ from: status.name || '', to }], skipped: [] };
}

// ---------- コメント ----------

async function addComment(ctx, ref, body) {
  const api = client(ctx);
  const key = keyOfRef(ref);
  const d = await api.call(issuePath(key, '/comment'), { method: 'POST', json: { body: toBody(ctx.config, body) } });
  return { url: d && d.id ? `${browseUrl(ctx.config, key)}?focusedCommentId=${encodeURIComponent(d.id)}` : browseUrl(ctx.config, key) };
}

// ---------- サブタスク ----------

async function fetchSubIssues(ctx, ref) {
  const api = client(ctx);
  const d = await api.call(issuePath(keyOfRef(ref)), { query: { fields: 'subtasks' } });
  return (((d && d.fields) || {}).subtasks || [])
    .filter((x) => x && x.key)
    .map((x) => toIssue(ctx.config, x.key, x.fields, []));
}

// プロジェクトで使えるサブタスク用の課題タイプ（名前は言語やプロジェクトで変わるので、subtask の印で探す）
async function subtaskType(api, projectKey) {
  const project = await api.call(`project/${encodeURIComponent(projectKey)}`, { query: { expand: 'issueTypes' } });
  const type = ((project && project.issueTypes) || []).find((t) => t && t.subtask === true);
  if (!type) throw new Error(tr('プロジェクト {key} にサブタスク用の課題タイプがありません', { key: projectKey }));
  return type;
}

async function createSubIssue(ctx, parentRef, { title, body }) {
  const api = client(ctx);
  const parentKey = keyOfRef(parentRef);
  const parent = await api.call(issuePath(parentKey), { query: { fields: 'project,issuetype' } });
  const fields = (parent && parent.fields) || {};
  if (fields.issuetype && fields.issuetype.subtask) throw new Error(tr('{key} はサブタスクなので、その下にサブタスクは作れません', { key: parentKey }));
  const projectKey = (fields.project && fields.project.key) || parentKey.replace(/-\d+$/, '');
  const type = await subtaskType(api, projectKey);
  const summary = String(title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY);
  const made = await api.call('issue', {
    method: 'POST',
    json: { fields: { project: { key: projectKey }, parent: { key: parentKey }, issuetype: { id: type.id }, summary, description: toBody(ctx.config, body) } },
  });
  if (!made || !made.key) throw new Error(tr('Issue を作れませんでした'));
  return { key: made.key, title: summary, url: browseUrl(ctx.config, made.key) };
}

// ---------- 接続テスト ----------

async function testConnection(ctx) {
  let secrets = [];
  try {
    const api = client(ctx);
    secrets = api.secrets;
    const me = await api.call('myself');
    const user = (me && (me.displayName || me.name || me.emailAddress)) || '';
    return { ok: true, message: user ? tr('{user} として接続できました', { user }) : tr('接続できました') };
  } catch (err) {
    return { ok: false, message: redact(err.message, secrets) };
  }
}

module.exports = {
  id: 'jira',
  label: LABEL,
  refPlaceholder: '例: ABC-123 または ABC-123, ABC-124',
  commentEvents: true,
  mapsStatusNames: true,
  statusMapHelp: '列ごとに使うトランジションか、移動先の状態の名前を指定できます（カンマ区切りで候補を複数書けます）。空の列は、実行中と完了は状態カテゴリ（In Progress / Done）から選び、レビューは名前に Review を含むものだけを選びます。',
  configFields: [
    {
      name: 'deployment',
      type: 'select',
      label: 'Jira の種類',
      default: 'cloud',
      options: [
        { value: 'cloud', label: 'Jira Cloud' },
        { value: 'datacenter', label: 'Jira Data Center' },
      ],
    },
    { name: 'baseUrl', type: 'url', label: 'Jira の接続先 URL', placeholder: 'https://example.atlassian.net', help: 'コンテキストパスがあるときは含めて入れます（例: https://jira.example.com/jira）', required: true, allowHttpField: 'allowHttp' },
    { name: 'allowHttp', type: 'checkbox', label: 'Jira への http の接続を許可する（トークンが暗号化されずに流れます）' },
    { name: 'email', type: 'text', label: 'Atlassian のメールアドレス（Cloud のみ）', placeholder: 'you@example.com' },
    { name: 'token', type: 'secret', label: 'API トークン（Cloud）または Personal Access Token（Data Center）', required: true },
  ],
  testConnection,
  parseRefs,
  fetchIssue,
  setStatus,
  addComment,
  createSubIssue,
  fetchSubIssues,
  pickTransition,
};
