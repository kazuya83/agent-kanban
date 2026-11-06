// Slack 連携。課題管理ではないので src/trackers には置かず、ここに通知と受信をまとめる。
// - provider: 設定の「連携」の欄（src/trackers に登録する）
// - SlackBridge: 通知の投稿（chat.postMessage）と、Socket Mode の受信（メンション・/コマンド・ボタン・モーダル）
//
// 受信は Socket Mode（アプリから Slack へ WebSocket でつなぐ）なので、公開サーバーもポートの開放も要らない。
// Electron の Node の標準の WebSocket を使う。アプリを閉じている間は動かない。
//
// 安全のきまり:
// - タスクの開始は手元でエージェントがコードを動かすことになる。allowedUsers にある人だけが開始でき、空なら誰も開始できない
// - チャンネルも channelMap に対応を書いたものだけを受け付ける
// - 承認と回答も allowedUsers にある人だけができる。押したときと、モーダルを送ったときの両方で確かめる
// - 入力の全文を Slack に出せない承認は、読まずに許可できないので、拒否だけを出す
// - 指示にするのは、呼びかけたメッセージの本文だけ（スレッドの中身は読まない）
// - トークンは投稿の直前に読み、status とエラーの文には入れない
const { EventEmitter } = require('events');
const { tr } = require('../renderer/i18n');
const { request } = require('./trackers/http');

const API_BASE = 'https://slack.com/api';
const LABEL = 'Slack';
const MAX_TEXT = 3500; // chat.postMessage の text に載せる長さ
const SEEN_LIMIT = 2000; // 重複の判定に覚えておく ID の数
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 60000;
const HELLO_TIMEOUT_MS = 30000;
// 標準の WebSocket では ping を見られず、回線が黙って切れても気づけないので、定期的につなぎ直す
// （つなぎ直す間のイベントは Slack が送り直す）
const MAX_CONNECTION_MS = 30 * 60 * 1000;
const RATE_LIMIT_WAIT_MS = 5000;
// Block Kit の上限
const MAX_BLOCK_TEXT = 3000;
const MAX_LABEL = 2000;
const MAX_OPTION_TEXT = 75;
const MAX_OPTIONS = 10;
const MAX_TITLE = 24;

const ACTION_ALLOW = 'kanban_allow';
const ACTION_DENY = 'kanban_deny';
const ACTION_ANSWER = 'kanban_answer';
const VIEW_ANSWER = 'kanban_answer_view';

// 入れ直してもらうまで直らないエラー（つなぎ直しても無駄なもの）
const FATAL_CODES = new Set(['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'token_expired', 'not_allowed_token_type', 'missing_scope', 'no_permission']);

// 通知の種類 → 設定の項目
const NOTIFY_FIELDS = {
  done: 'notifyDone',
  failed: 'notifyFailed',
  schedule: 'notifyFailed',
  permission: 'notifyAwaiting',
  question: 'notifyAwaiting',
  awaiting: 'notifyAwaiting', // 仕様の確認（SPEC_UNCLEAR）・回答待ち
  review: 'notifyAwaiting',
  conflict: 'notifyAwaiting',
};

class SlackError extends Error {
  constructor(code) {
    const safe = /^[a-z0-9_]+$/.test(String(code || '')) ? code : 'unknown_error';
    const hint = safe === 'not_in_channel' || safe === 'channel_not_found' ? tr('Bot をそのチャンネルに招待して、チャンネル ID を確かめてください') : '';
    super(tr('Slack がエラーを返しました: {code}', { code: hint ? `${safe}（${hint}）` : safe }));
    this.name = 'SlackError';
    this.code = safe;
  }
}

async function slackApi(method, token, json) {
  let data;
  try {
    ({ data } = await request(`${API_BASE}/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, json, secrets: [token], label: LABEL }));
  } catch (err) {
    // 渡したトークンは request が消す。もう1つのトークンが混ざっていても出さない
    err.message = err.message.replace(/\bx(?:ox[a-z]|app)-[A-Za-z0-9-]+/g, '***');
    throw err;
  }
  if (!data || data.ok !== true) throw new SlackError(data && data.error);
  return data;
}

const isFatal = (err) => !!err && (FATAL_CODES.has(err.code) || err.status === 401 || err.status === 403);

// ---------- 設定の読み取り ----------

const USER_ID = /^[UW][A-Z0-9]{2,}$/;
const CHANNEL_ID = /^[CG][A-Z0-9]{2,}$/;

// 「U012, U034」のような一覧。読めないものは bad に入れる
function parseUsers(text) {
  const items = String(text || '').split(/[\s,]+/).filter(Boolean);
  return { users: new Set(items.filter((x) => USER_ID.test(x))), bad: items.filter((x) => !USER_ID.test(x)) };
}

// 1行に「チャンネル ID  プロジェクトのフォルダ」（パスには空白も : も入るので、最初の区切りで分ける）
function parseChannelMap(text) {
  const map = new Map();
  const bad = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Z0-9]+)(?:\s*=\s*|\s+)(.+)$/);
    if (m && CHANNEL_ID.test(m[1])) map.set(m[1], m[2].trim());
    else bad.push(line);
  }
  return { map, bad };
}

/**
 * Slack からの開始を受け付けてよいかを決める
 * @param {object} config Slack の設定
 * @param {{ user: string, channel: string, text: string }} req
 * @returns {{ ok: true, repoPath: string } | { ok: false, reason: 'user'|'channel'|'empty' }}
 */
function decide(config, { user, channel, text }) {
  if (!user || !parseUsers(config.allowedUsers).users.has(user)) return { ok: false, reason: 'user' };
  const repoPath = parseChannelMap(config.channelMap).map.get(channel);
  if (!repoPath) return { ok: false, reason: 'channel' };
  if (!String(text || '').trim()) return { ok: false, reason: 'empty' };
  return { ok: true, repoPath };
}

// ---------- 文字の変換 ----------

// 投稿の本文。タスクの名前やエージェントの文に <!channel> などがあっても、全員への呼び出しにしない
const escapeText = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Slack の書式のメッセージを、エージェントに渡す文にする（リンクは表示の文字ではなく実際の URL にする）
function toPlainText(raw, botUserId) {
  return String(raw || '')
    .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (m, id, name) => (id === botUserId ? '' : `@${name || id}`))
    .replace(/<#([A-Z0-9]+)(?:\|([^>]*))?>/g, (m, id, name) => `#${name || id}`)
    .replace(/<!([^>|]+)(?:\|([^>]*))?>/g, (m, cmd, label) => (label || `@${cmd}`))
    .replace(/<([a-z][a-z0-9+.-]*:[^>|]+)(?:\|[^>]*)?>/gi, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

// 再接続までの待ち時間。回数ごとに倍にして、上限で止める（いっせいに戻らないように少しずらす）
function backoffMs(attempt, { base = RETRY_BASE_MS, max = RETRY_MAX_MS, random = Math.random } = {}) {
  const ms = Math.min(base * 2 ** Math.min(attempt, 20), max);
  return Math.round(ms * (0.75 + random() * 0.5));
}

// ---------- ボタンとモーダル ----------

const plain = (text, max = MAX_BLOCK_TEXT) => {
  const s = String(text == null ? '' : text);
  return { type: 'plain_text', text: s.length > max ? `${s.slice(0, max - 1)}…` : s };
};
const textSection = (text) => ({ type: 'section', text: { type: 'mrkdwn', text: String(text).slice(0, MAX_BLOCK_TEXT) } });
const noteBlock = (text) => ({ type: 'context', elements: [{ type: 'mrkdwn', text: String(text).slice(0, MAX_BLOCK_TEXT) }] });
const button = (actionId, label, value, style) => ({ type: 'button', action_id: actionId, value, text: plain(label, MAX_TITLE), ...(style ? { style } : {}) });

// エージェントの文や入力はそのまま plain_text で出す（書式にも全員への呼び出しにもならない）
function plainSections(text) {
  const s = String(text || '');
  const out = [];
  for (let i = 0; i < s.length; i += MAX_BLOCK_TEXT) out.push({ type: 'section', text: { type: 'plain_text', text: s.slice(i, i + MAX_BLOCK_TEXT) } });
  return out;
}

// 通知に付ける Block Kit
function promptBlocks(prompt, text) {
  const blocks = [textSection(text)];
  if (prompt.kind === 'permission') {
    blocks.push(...plainSections(prompt.detail));
    if (prompt.cut) blocks.push(noteBlock(escapeText(tr('入力が長くて全文を出せないので、Slack からは拒否だけできます。許可はアプリの画面で行います'))));
    const allow = prompt.cut ? [] : [button(ACTION_ALLOW, tr('許可'), prompt.id, 'primary')];
    blocks.push({ type: 'actions', elements: [...allow, button(ACTION_DENY, tr('拒否'), prompt.id, 'danger')] });
  } else {
    blocks.push({ type: 'actions', elements: [button(ACTION_ANSWER, tr('回答する'), prompt.id, 'primary')] });
  }
  return blocks;
}

// 質問1つ分の入力欄。選択肢の value は番号（Slack の上限より長い選択肢があるので）
function questionBlocks(q, i) {
  const options = (q.options || [])
    .map((o, j) => ({ ...(o.description ? { description: plain(o.description, MAX_OPTION_TEXT) } : {}), text: plain(o.label, MAX_OPTION_TEXT), value: String(j) }))
    .filter((o) => o.text.text.trim())
    .slice(0, MAX_OPTIONS);
  const text = { type: 'plain_text_input', action_id: 'text', multiline: true };
  if (!options.length) return [{ type: 'input', block_id: `t${i}`, optional: true, label: plain(q.question, MAX_LABEL), element: text }];
  return [
    { type: 'input', block_id: `q${i}`, optional: true, label: plain(q.question, MAX_LABEL), element: { type: q.multiSelect ? 'checkboxes' : 'radio_buttons', action_id: 'choice', options } },
    { type: 'input', block_id: `t${i}`, optional: true, label: plain(tr('自由に書く'), MAX_LABEL), element: text },
  ];
}

// モーダルの答えを取り出す（書いた文があれば、ひとつ選ぶ質問ではそちらを使う）
function readAnswer(values, q, i) {
  const choice = (values[`q${i}`] || {}).choice || {};
  const selected = choice.selected_options || (choice.selected_option ? [choice.selected_option] : []);
  const picked = selected.map((o) => ((q.options || [])[Number(o.value)] || {}).label).filter(Boolean);
  const text = String(((values[`t${i}`] || {}).text || {}).value || '').trim();
  return (q.multiSelect ? [...picked, text] : text ? [text] : picked).filter(Boolean).join(', ');
}

// 仕様の確認の答えを、エージェントに送る文にする（画面の specAnswerMessage と同じ形）
function specAnswerText(questions, answers, note) {
  const lines = [tr('仕様の質問への答えです。'), ''];
  questions.forEach((q, i) => lines.push(`${i + 1}. ${q.question}`, `   → ${answers[i] || tr('おまかせ（妥当な案で決めてください）')}`));
  if (note) lines.push('', tr('補足: {note}', { note }));
  return lines.join('\n');
}

const folderName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();

// ---------- 設定の「連携」の欄 ----------

const provider = {
  id: 'slack',
  label: LABEL,
  configFields: [
    { name: 'botToken', type: 'secret', label: 'Bot Token', placeholder: 'xoxb-...', required: true },
    { name: 'appToken', type: 'secret', label: 'App-Level Token', placeholder: 'xapp-...', required: true, help: 'Slack からの受信（Socket Mode）に使います' },
    { name: 'notifyChannel', type: 'text', label: '通知を投稿するチャンネル ID', placeholder: 'C0123456789', help: 'チャンネルの詳細の一番下に出る ID です。空なら投稿しません。Slack から頼んだタスクの知らせは、下の種類の設定によらず、そのスレッドに投稿します' },
    { name: 'notifyDone', type: 'checkbox', label: '完了を通知する', default: true },
    { name: 'notifyFailed', type: 'checkbox', label: '失敗を通知する', default: true },
    { name: 'notifyAwaiting', type: 'checkbox', label: '確認待ちを通知する（仕様の確認・権限の確認・回答待ち・レビュー待ち・コンフリクト）', default: true },
    { name: 'allowedUsers', type: 'textarea', label: 'タスクの開始と承認・回答ができる Slack ユーザー ID', placeholder: 'U0123456789, U0987654321', help: '空なら誰も開始も承認もできません。どちらも、このマシンでエージェントがコードを動かすことにつながります。ここに書いた人は、通知のボタンでツールの実行を許可できます' },
    { name: 'channelMap', type: 'textarea', label: 'チャンネルとプロジェクトの対応', placeholder: 'C0123456789 /path/to/project', help: '1行に「チャンネル ID」と「プロジェクトのフォルダ」を書きます。書いたチャンネルからだけ開始できます' },
  ],
  guide: [
    'https://api.slack.com/apps で Slack アプリを作ります',
    '「Socket Mode」を有効にして、App-Level Token（スコープは connections:write）を作り、下の欄に入れます',
    '「OAuth & Permissions」の Bot Token Scopes に app_mentions:read と chat:write を足します。/コマンドも使うなら commands も足します',
    '「Event Subscriptions」を有効にして、Bot Events に app_mention を足します。/コマンドを使うなら「Slash Commands」で作ります（Socket Mode なので Request URL は要りません）',
    '通知のボタンで承認と回答をするなら「Interactivity & Shortcuts」を有効にします（Socket Mode なので Request URL は要りません）',
    'ワークスペースにインストールして Bot Token を下の欄に入れ、使うチャンネルに Bot を招待します',
    '動くのはこのアプリを開いている間だけです。閉じている間は、通知の投稿も、Slack からの開始・承認・回答も動きません',
  ],

  // 保存の前に確かめる。secrets は今回入力された分だけ
  validateConfig(config, secrets = {}) {
    if (secrets.botToken && !secrets.botToken.startsWith('xoxb-')) throw new Error(tr('Bot Token は xoxb- で始まるものを入れてください'));
    if (secrets.appToken && !secrets.appToken.startsWith('xapp-')) throw new Error(tr('App-Level Token は xapp- で始まるものを入れてください'));
    if (config.notifyChannel && !CHANNEL_ID.test(config.notifyChannel)) throw new Error(tr('チャンネル ID が正しくありません: {value}', { value: config.notifyChannel }));
    const { bad: users } = parseUsers(config.allowedUsers);
    if (users.length) throw new Error(tr('Slack ユーザー ID が正しくありません（U で始まる ID を入れてください）: {value}', { value: users[0] }));
    const { bad: lines } = parseChannelMap(config.channelMap);
    if (lines.length) throw new Error(tr('チャンネルとプロジェクトの対応を読めません: {value}', { value: lines[0] }));
  },

  async testConnection(ctx) {
    const bot = ctx.secret('botToken');
    const app = ctx.secret('appToken');
    if (!bot || !app) return { ok: false, message: tr('Bot Token と App-Level Token を入れてください') };
    const who = await slackApi('auth.test', bot);
    await slackApi('apps.connections.open', app); // Socket Mode が有効か、xapp- のトークンか（受け取った URL は使わない）
    return { ok: true, message: tr('{user} として接続できました', { user: who.user || who.user_id || LABEL }) };
  },
};

// ---------- 通知と受信 ----------

/**
 * trackers: src/trackers の Trackers / agents: AgentManager / store: Store
 * 'status' イベント: 接続の状態が変わった
 */
class SlackBridge extends EventEmitter {
  constructor({ trackers, agents, store, WebSocketImpl, retryBaseMs = RETRY_BASE_MS, retryMaxMs = RETRY_MAX_MS, helloTimeoutMs = HELLO_TIMEOUT_MS, maxConnectionMs = MAX_CONNECTION_MS, rateLimitWaitMs = RATE_LIMIT_WAIT_MS }) {
    super();
    this.trackers = trackers;
    this.agents = agents;
    this.store = store;
    this.WebSocketImpl = WebSocketImpl; // テストの差し替え。無ければ標準の WebSocket
    this.timing = { retryBaseMs, retryMaxMs, helloTimeoutMs, maxConnectionMs, rateLimitWaitMs };
    this.gen = 0; // 接続の世代。古い接続のイベントと、待っている途中の処理を捨てる
    this.ws = null;
    this.attempt = 0;
    this.retryTimer = null;
    this.watchTimer = null;
    this.state = 'off';
    this.reason = '';
    this.postError = '';
    this.botUserId = '';
    this.seen = new Map();
    this.prompts = new Map(); // ボタンの付いた通知（ID → 待っている確認）。再起動で消える
    this.queue = Promise.resolve(); // 投稿の順番を、受付 → 完了のように起きた順に保つ
    this.attached = false;
  }

  // 通知と設定の変更を受け取って、接続を始める
  start() {
    if (!this.attached) {
      this.attached = true;
      this.onChanged = (id) => {
        if (id === provider.id) this.reconnect();
      };
      this.onNotification = (n, c) => this.notify(n, c);
      this.onSettled = (id, label) => this.settled(id, label);
      this.onCardChanged = (id) => this.cardChanged(id);
      this.trackers.on('changed', this.onChanged);
      this.agents.on('notification', this.onNotification);
      this.agents.on('settled', this.onSettled);
      this.agents.on('changed', this.onCardChanged);
    }
    this.reconnect();
  }

  stop() {
    if (this.attached) {
      this.attached = false;
      this.trackers.off('changed', this.onChanged);
      this.agents.off('notification', this.onNotification);
      this.agents.off('settled', this.onSettled);
      this.agents.off('changed', this.onCardChanged);
    }
    this.teardown();
    this.setState('off');
  }

  // 設定が変わった・スリープから戻ったとき: 待ち時間なしでつなぎ直す
  reconnect() {
    if (!this.attached) return;
    this.attempt = 0;
    this.reason = '';
    this.connect();
  }

  // 画面に出す状態（トークンは入らない）
  status() {
    const base = { off: '', connecting: tr('Slack に接続しています…'), connected: tr('Slack に接続しています。メンションと /コマンドを受け取れます'), error: '' }[this.state];
    const text = [this.reason ? (base ? `${base}（${this.reason}）` : this.reason) : base, this.postError && tr('Slack への投稿に失敗しました: {message}', { message: this.postError })].filter(Boolean).join(' / ');
    return { state: this.state, text };
  }

  setState(state, reason = '') {
    if (this.state === state && this.reason === reason) return;
    this.state = state;
    this.reason = reason;
    this.emit('status');
  }

  setPostError(message) {
    if (this.postError === message) return;
    this.postError = message;
    this.emit('status');
  }

  secret(name) {
    return this.trackers.context(provider).secret(name);
  }

  config() {
    return this.trackers.configOf(provider.id);
  }

  // ---------- 接続 ----------

  teardown() {
    this.gen += 1;
    clearTimeout(this.retryTimer);
    clearTimeout(this.watchTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* もう閉じている */
      }
    }
    return this.gen;
  }

  async connect() {
    const gen = this.teardown();
    let botToken;
    let appToken;
    try {
      botToken = this.secret('botToken');
      appToken = this.secret('appToken');
    } catch (err) {
      this.setState('error', err.message);
      return;
    }
    if (!botToken || !appToken) {
      this.setState('off');
      return;
    }
    const WS = this.WebSocketImpl || globalThis.WebSocket;
    if (typeof WS !== 'function') {
      this.setState('error', tr('このアプリの実行環境に標準の WebSocket がないので、Slack からの受信を使えません（通知の投稿は動きます）'));
      return;
    }
    this.setState('connecting', this.reason);
    let url;
    try {
      const who = await slackApi('auth.test', botToken);
      if (gen !== this.gen) return;
      this.botUserId = who.user_id || '';
      url = (await slackApi('apps.connections.open', appToken)).url;
      if (gen !== this.gen) return;
      if (!/^wss:\/\//.test(String(url || ''))) throw new SlackError('invalid_socket_url');
    } catch (err) {
      if (gen !== this.gen) return;
      if (isFatal(err)) this.setState('error', err.message);
      else this.retry(err.message);
      return;
    }
    let ws;
    try {
      ws = new WS(url);
    } catch {
      // エラーの文には接続用の URL（チケット入り）が混ざることがあるので使わない
      this.retry(tr('Slack の受信用の接続を開けませんでした'));
      return;
    }
    this.ws = ws;
    ws.addEventListener('message', (e) => {
      if (gen === this.gen) this.onMessage(e.data);
    });
    ws.addEventListener('close', () => {
      if (gen === this.gen) this.retry(tr('Slack との接続が切れました'));
    });
    ws.addEventListener('error', () => {
      /* 続けて close が来る */
    });
    this.watch(this.timing.helloTimeoutMs, tr('Slack から接続の返事がありませんでした'));
  }

  // 時間内に次へ進まなければ、つなぎ直す
  watch(ms, reason, again = false) {
    clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => (again ? this.reconnect() : this.retry(reason)), ms);
    this.watchTimer.unref?.();
  }

  retry(reason) {
    this.teardown();
    const delay = backoffMs(this.attempt, { base: this.timing.retryBaseMs, max: this.timing.retryMaxMs });
    this.attempt += 1;
    this.setState('connecting', reason);
    this.retryTimer = setTimeout(() => this.connect(), delay);
    this.retryTimer.unref?.();
  }

  // ---------- 受信 ----------

  // 初めての ID なら覚えて true（古いものから忘れる）
  firstTime(key) {
    if (!key) return true;
    if (this.seen.has(key)) return false;
    this.seen.set(key, true);
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.keys().next().value);
    return true;
  }

  ack(envelopeId, payload) {
    try {
      this.ws.send(JSON.stringify({ envelope_id: envelopeId, ...(payload ? { payload } : {}) }));
    } catch {
      /* 切れた。Slack が送り直す */
    }
  }

  onMessage(raw) {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (m.type === 'hello') {
      this.attempt = 0;
      this.setState('connected');
      this.watch(this.timing.maxConnectionMs, '', true);
      return;
    }
    // 接続の入れ替え（Slack が定期的に送ってくる）
    if (m.type === 'disconnect') {
      if (m.reason === 'warning' || m.reason === 'refresh_requested') this.reconnect();
      else this.retry(tr('Slack との接続が切れました'));
      return;
    }
    if (!m.envelope_id) return;
    // 同じ封筒が2度届いても、返事はそのつど返す（返さないと送り直しが続く）
    const fresh = this.firstTime(`envelope:${m.envelope_id}`);
    if (m.type === 'events_api') {
      this.ack(m.envelope_id);
      if (fresh) this.track(this.onEvent(m.payload));
    } else if (m.type === 'slash_commands') {
      this.onCommand(m.envelope_id, m.payload, fresh);
    } else if (m.type === 'interactive') {
      this.onInteractive(m.envelope_id, m.payload, fresh);
    } else {
      this.ack(m.envelope_id);
    }
  }

  track(promise) {
    return promise.catch((err) => this.setPostError(err.message));
  }

  // メンション
  async onEvent(payload) {
    const ev = payload && payload.event;
    if (!ev || ev.type !== 'app_mention') return;
    // 送り直しは封筒の ID が変わり、event_id は同じ
    if (!this.firstTime(payload.event_id ? `event:${payload.event_id}` : '')) return;
    if (ev.bot_id || ev.subtype || ev.edited || !ev.user || ev.user === this.botUserId) return;
    // アプリを再起動したあとに届いた送り直しも、作ったカードで分かる
    if (this.store.cards.some((c) => c.slack && c.slack.channel === ev.channel && c.slack.ts === ev.ts)) return;
    const req = { user: ev.user, channel: ev.channel, text: toPlainText(ev.text, this.botUserId), ts: ev.ts };
    const threadTs = ev.thread_ts || ev.ts;
    const d = decide(this.config(), req);
    if (!d.ok) {
      await this.post(ev.channel, this.refusal(d.reason), threadTs);
      return;
    }
    await this.begin(req, d.repoPath, threadTs, (text) => this.post(ev.channel, text, threadTs));
  }

  // /コマンド。断るときは ack の返事にして、頼んだ本人にだけ見せる
  onCommand(envelopeId, p, fresh) {
    const payload = p || {};
    const isNew = fresh && this.firstTime(`command:${payload.trigger_id || envelopeId}`);
    if (!isNew) {
      this.ack(envelopeId);
      return;
    }
    const req = { user: payload.user_id, channel: payload.channel_id, text: toPlainText(payload.text, this.botUserId), userName: payload.user_name, channelName: payload.channel_name };
    const d = decide(this.config(), req);
    if (!d.ok) {
      this.ack(envelopeId, { response_type: 'ephemeral', text: this.refusal(d.reason) });
      return;
    }
    this.ack(envelopeId);
    this.track(this.begin(req, d.repoPath, '', (text) => this.respond(payload.response_url, text)));
  }

  // /コマンドへの本人だけに見える返事（Bot がチャンネルに投稿できないとき）
  async respond(url, text) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (u.protocol !== 'https:' || u.hostname !== 'hooks.slack.com') return;
    await request(u, { method: 'POST', json: { response_type: 'ephemeral', replace_original: false, text }, secrets: [String(url)], label: LABEL });
  }

  refusal(reason) {
    if (reason === 'user') return tr('タスクを開始できるのは、許可された人だけです。タスクは作っていません');
    if (reason === 'channel') return tr('このチャンネルはプロジェクトに対応していないので、タスクを開始できません');
    return tr('指示を書いてください。タスクは作っていません');
  }

  // タスクを作って開始する。reply は、スレッドが用意できる前に使う返事の手段
  async begin(req, repoPath, threadTs, reply) {
    let thread = threadTs;
    if (!thread) {
      // /コマンドは Slack に発言が残らないので、誰が何を頼んだかを投稿して、それをスレッドの元にする
      try {
        const posted = await this.post(req.channel, tr('<@{user}> の依頼: {text}', { user: req.user, text: escapeText(req.text) }));
        thread = posted.ts;
      } catch (err) {
        await reply(tr('タスクを作れませんでした: {message}', { message: err.message }));
        return;
      }
    }
    const say = (text) => this.track(this.post(req.channel, text, thread));
    const slack = { channel: req.channel, user: req.user, ts: req.ts || thread, threadTs: thread };
    if (req.userName) slack.userName = String(req.userName);
    if (req.channelName) slack.channelName = String(req.channelName);
    let cards;
    try {
      // skipSpecCheck は付けない: 内容が詰まっていなければ、ふつうのタスクと同じく仕様の確認で止まる
      cards = this.agents.createTask({ prompt: req.text, repoPath, slack });
      if (!cards || !cards.length) throw new Error(tr('タスクを作れませんでした'));
    } catch (err) {
      await say(tr('タスクを作れませんでした: {message}', { message: err.message }));
      return;
    }
    const first = cards[0];
    const from = slack.channelName ? `#${slack.channelName}` : slack.channel;
    const who = slack.userName ? `@${slack.userName}` : slack.user;
    for (const c of cards) this.agents.log(c, 'system', tr('Slack の {user} が {channel} から頼んだタスクです', { user: who, channel: from }));
    // 開始の前に投稿の順番に入れる（開始の直後に確認待ちになっても、受付の返事が先に出る）
    say(tr('タスク「{title}」を受け付けました（プロジェクト: {project}）', { title: escapeText((first.compete && first.compete.title) || first.title), project: escapeText(folderName(repoPath)) }));
    try {
      for (const c of cards) this.agents.start(c.id);
    } catch (err) {
      await say(tr('タスクは作りましたが、開始できませんでした: {message}', { message: err.message }));
    }
  }

  // ---------- ボタンとモーダル ----------

  allowed(user) {
    return !!user && parseUsers(this.config().allowedUsers).users.has(user);
  }

  // Slack から答えてもらえる確認なら、その内容。ボタンを押せる人がいない・受信できないときは出さない
  promptFor(n, c) {
    if (!c || !parseUsers(this.config().allowedUsers).users.size || !this.trackers.hasSecret(provider.id, 'appToken')) return null;
    const base = { cardId: c.id };
    if (n.kind === 'permission') {
      const req = (c.permissions || []).find((r) => r.id === n.reqId);
      return req ? { ...base, id: req.id, kind: 'permission', detail: req.detail, cut: !!req.detailCut } : null;
    }
    if (n.kind === 'question') {
      const req = (c.questions || []).find((r) => r.id === n.reqId);
      return req ? { ...base, id: req.id, kind: 'question', questions: req.questions } : null;
    }
    return n.kind === 'awaiting' && c.awaitingReply ? { ...base, id: n.id, kind: 'reply' } : null;
  }

  // ボタンの付いた通知を投稿する。投稿の途中で終わった確認は、投稿できてからボタンを消す
  async ask(prompt, channel, text, threadTs) {
    if (prompt.kind === 'reply') {
      for (const old of this.prompts.values()) if (old.kind === 'reply' && old.cardId === prompt.cardId) this.close(old, tr('新しい確認が出たので、こちらは閉じました'));
    }
    prompt.text = text;
    this.prompts.set(prompt.id, prompt);
    try {
      const res = await this.post(channel, text, threadTs, { blocks: promptBlocks(prompt, text) });
      prompt.channel = res.channel || channel;
      prompt.ts = res.ts;
    } catch (err) {
      this.prompts.delete(prompt.id);
      throw err;
    }
    if (prompt.result) await this.finish(prompt);
  }

  // 確認を閉じる。ここからあとはボタンを押しても何も起きない
  close(prompt, result) {
    if (prompt.result) return;
    prompt.result = result;
    this.prompts.delete(prompt.id);
    if (prompt.ts) this.track(this.finish(prompt));
  }

  // 通知からボタンを消して、どうなったかを書く
  finish(prompt) {
    const { channel, ts, text, result } = prompt;
    const line = escapeText(result).replace(/&lt;(@[A-Z0-9]+)&gt;/g, '<$1>');
    return this.enqueue(() => this.call('chat.update', { channel, ts, text: `${text}\n${line}`.slice(0, MAX_TEXT), blocks: [textSection(text), noteBlock(line)] }));
  }

  resultOf(label, by) {
    return by ? `${label}（<@${by}>）` : label;
  }

  // アプリの画面で答えた・中断された・Slack で答えた（AgentManager の settle）
  settled(id, label) {
    const prompt = this.prompts.get(id);
    if (prompt) this.close(prompt, this.resultOf(label || tr('中断されました'), prompt.by));
  }

  // 回答待ちは settle を通らないので、カードの変化で見る
  cardChanged(id) {
    for (const prompt of this.prompts.values()) {
      if (prompt.kind !== 'reply' || prompt.cardId !== id) continue;
      const c = this.store.card(id);
      if (!c || !c.awaitingReply) this.close(prompt, prompt.by ? this.resultOf(tr('回答しました'), prompt.by) : tr('この確認は終わりました'));
    }
  }

  onInteractive(envelopeId, p, fresh) {
    const payload = p || {};
    if (payload.type === 'view_submission' && payload.view && payload.view.callback_id === VIEW_ANSWER) {
      if (fresh) this.onSubmit(envelopeId, payload);
      else this.ack(envelopeId);
      return;
    }
    this.ack(envelopeId);
    if (fresh && payload.type === 'block_actions' && this.firstTime(`action:${payload.trigger_id || envelopeId}`)) this.track(this.onAction(payload));
  }

  // 通知のボタン。断るときは押した本人にだけ見せる
  async onAction(payload) {
    const action = (payload.actions || [])[0] || {};
    const isPermission = action.action_id === ACTION_ALLOW || action.action_id === ACTION_DENY;
    if (!isPermission && action.action_id !== ACTION_ANSWER) return;
    const user = (payload.user || {}).id;
    const say = (text) => this.respond(payload.response_url, text);
    if (!this.allowed(user)) {
      await say(tr('承認と回答ができるのは、許可された人だけです'));
      return;
    }
    const prompt = this.prompts.get(action.value);
    const same = prompt && prompt.ts === (payload.message || {}).ts && prompt.channel === (payload.channel || {}).id;
    const c = same && this.store.card(prompt.cardId);
    if (!c || isPermission !== (prompt.kind === 'permission') || (action.action_id === ACTION_ALLOW && prompt.cut)) {
      await say(tr('この確認はもう終わっています'));
      return;
    }
    if (!isPermission) {
      try {
        await slackApi('views.open', this.secret('botToken'), { trigger_id: payload.trigger_id, view: this.answerView(prompt, c) });
      } catch (err) {
        await say(tr('回答の画面を開けませんでした: {message}', { message: err.message }));
      }
      return;
    }
    const allow = action.action_id === ACTION_ALLOW;
    prompt.by = user;
    try {
      this.agents.answerPermission(prompt.cardId, prompt.id, allow ? 'allow' : 'deny');
    } catch (err) {
      prompt.by = null;
      await say(err.message);
      return;
    }
    this.agents.log(c, 'system', tr('Slack の {user} が{action}しました', { user: this.who(payload), action: allow ? tr('許可') : tr('拒否') }));
  }

  who(payload) {
    const u = payload.user || {};
    return u.username || u.name ? `@${u.username || u.name}` : u.id;
  }

  questionsOf(prompt, c) {
    if (prompt.kind === 'question') return prompt.questions;
    return c.specState === 'pending' && Array.isArray(c.specQuestions) && c.specQuestions.length ? c.specQuestions : null;
  }

  answerView(prompt, c) {
    const questions = this.questionsOf(prompt, c);
    const blocks = prompt.kind === 'reply' ? plainSections(String(c.lastText || '').slice(0, MAX_BLOCK_TEXT)) : [];
    (questions || []).forEach((q, i) => blocks.push(...questionBlocks(q, i)));
    if (prompt.kind === 'reply') {
      blocks.push({ type: 'input', block_id: 'note', optional: !!questions, label: plain(questions ? tr('補足（任意）') : tr('回答')), element: { type: 'plain_text_input', action_id: 'text', multiline: true } });
    }
    return { type: 'modal', callback_id: VIEW_ANSWER, private_metadata: prompt.id, title: plain('Worktree Kanban', MAX_TITLE), submit: plain(tr('回答して送る'), MAX_TITLE), close: plain(tr('キャンセル'), MAX_TITLE), blocks };
  }

  // モーダルの送信。問題があれば、ack でモーダルの中にエラーを出す
  onSubmit(envelopeId, payload) {
    const view = payload.view;
    const input = (view.blocks || []).find((b) => b.type === 'input');
    const refuse = (message, block) => this.ack(envelopeId, { response_action: 'errors', errors: { [block || (input ? input.block_id : 'note')]: message } });
    const user = (payload.user || {}).id;
    if (!this.allowed(user)) {
      refuse(tr('承認と回答ができるのは、許可された人だけです'));
      return;
    }
    const prompt = this.prompts.get(view.private_metadata);
    const c = prompt && prompt.kind !== 'permission' && this.store.card(prompt.cardId);
    if (!c) {
      refuse(tr('この確認はもう終わっています'));
      return;
    }
    const values = (view.state && view.state.values) || {};
    const questions = this.questionsOf(prompt, c);
    const answers = (questions || []).map((q, i) => readAnswer(values, q, i));
    const note = String(((values.note || {}).text || {}).value || '').trim();
    prompt.by = user;
    try {
      if (prompt.kind === 'question') {
        const empty = answers.findIndex((a) => !a);
        if (empty >= 0) {
          prompt.by = null;
          refuse(tr('回答を書いてください'), `t${empty}`);
          return;
        }
        this.agents.answerQuestion(prompt.cardId, prompt.id, Object.fromEntries(questions.map((q, i) => [q.question, answers[i]])));
      } else {
        if (!note && !answers.some(Boolean)) {
          prompt.by = null;
          refuse(tr('回答を書いてください'));
          return;
        }
        this.agents.send(prompt.cardId, questions ? specAnswerText(questions, answers, note) : note);
        this.close(prompt, this.resultOf(tr('回答しました'), user));
      }
    } catch (err) {
      prompt.by = null;
      refuse(err.message);
      return;
    }
    this.ack(envelopeId);
    this.agents.log(c, 'system', tr('Slack の {user} が{action}しました', { user: this.who(payload), action: tr('回答') }));
  }

  // ---------- 投稿 ----------

  enqueue(run) {
    const done = this.queue.then(run, run);
    this.queue = done.catch(() => {});
    return done;
  }

  post(channel, text, threadTs, extra) {
    return this.enqueue(() => this.send(channel, text, threadTs, extra));
  }

  async send(channel, text, threadTs, extra) {
    return this.call('chat.postMessage', { channel, text: String(text).slice(0, MAX_TEXT), unfurl_links: false, unfurl_media: false, ...(threadTs ? { thread_ts: threadTs } : {}), ...extra });
  }

  async call(method, body) {
    const token = this.secret('botToken');
    if (!token) throw new Error(tr('{label} に接続していません。設定の「連携」で接続してください。', { label: LABEL }));
    let res;
    try {
      res = await slackApi(method, token, body);
    } catch (err) {
      if (err.status !== 429) throw err;
      await new Promise((r) => setTimeout(r, this.timing.rateLimitWaitMs));
      res = await slackApi(method, token, body);
    }
    this.setPostError('');
    return res;
  }

  // Slack から頼んだタスクの記録。サブタスクと Pipeline の枝は、元のタスクの記録をたどる
  originOf(c) {
    let cur = c;
    for (let i = 0; cur && i < 8; i += 1) {
      if (cur.slack) return cur.slack;
      const parent = (cur.subtaskOf && cur.subtaskOf.parent) || (cur.relay && cur.relay.branchOf && cur.relay.branchOf.parent);
      cur = parent ? this.store.card(parent) : null;
    }
    return null;
  }

  // アプリの通知（AgentManager.notify）を Slack にも投稿する
  notify(n, c) {
    const field = NOTIFY_FIELDS[n.kind];
    if (!field || (c && c.kind === 'chat') || !this.trackers.hasSecret(provider.id, 'botToken')) return null;
    const origin = this.originOf(c);
    const config = this.config();
    if (!origin && (!config.notifyChannel || !config[field])) return null;
    const prompt = this.promptFor(n, c);
    const hint = field === 'notifyAwaiting' && !prompt ? `\n${tr('Worktree Kanban の画面で確かめてください')}` : '';
    const text = `*${escapeText(n.title)}*${n.body ? `\n${escapeText(n.body)}` : ''}${hint}`;
    // 頼んだ人には種類の設定によらず、そのスレッドで知らせる
    const channel = origin ? origin.channel : config.notifyChannel;
    const threadTs = origin ? origin.threadTs : undefined;
    return this.track(prompt ? this.ask(prompt, channel, text, threadTs) : this.post(channel, text, threadTs));
  }
}

module.exports = { provider, SlackBridge, SlackError, decide, parseUsers, parseChannelMap, toPlainText, escapeText, backoffMs };
