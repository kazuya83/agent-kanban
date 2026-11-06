// Slack 連携: 許可の判定・重複イベント・再接続・トークンを出さないこと・通知の投稿（WebSocket と fetch はモック）
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SecretStore } = require('../src/secrets');
const trackersMod = require('../src/trackers');
const { Store } = require('../src/store');
const { AgentManager } = require('../src/agent');
const { provider, SlackBridge, decide, parseUsers, parseChannelMap, toPlainText, escapeText, backoffMs } = require('../src/slack');

const BOT = 'xoxb-SUPERSECRET-BOT-123456';
const APP = 'xapp-SUPERSECRET-APP-654321';
const WSS = 'wss://wss-primary.slack.com/link/?ticket=SECRETTICKET';
const ALICE = 'U0ALICE';
const MALLORY = 'U0MALLORY';
const CH = 'C0PROJECT';
const OTHER_CH = 'C0OTHER';

const flip = (b) => Buffer.from(b.map((x) => x ^ 0x5a));
const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => flip(Buffer.from(s, 'utf8')), decryptString: (b) => flip(b).toString('utf8') };

class FakeWS {
  static made = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.listeners = {};
    this.closed = false;
    FakeWS.made.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  fire(type, e = {}) {
    for (const fn of this.listeners[type] || []) fn(e);
  }
  send(s) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.closed = true;
    this.fire('close');
  }
  receive(obj) {
    this.fire('message', { data: JSON.stringify(obj) });
  }
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await tick(2);
  }
  assert.fail('待ち時間を過ぎました');
}

// fetch の差し替え。responses[メソッド名] で応答を変えられる
function mockFetch(t, responses = {}) {
  const calls = [];
  const ts = { n: 0 };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = u.pathname.split('/').pop();
    const call = { url: String(url), host: u.host, method, auth: (opts.headers || {}).Authorization, body: opts.body ? JSON.parse(opts.body) : null };
    calls.push(call);
    const r = responses[method];
    if (r) {
      const v = typeof r === 'function' ? r(call) : r;
      if (v instanceof Response) return v;
      if (v) return json(v);
    }
    if (method === 'auth.test') return json({ ok: true, user: 'kanban', user_id: 'UBOT' });
    if (method === 'apps.connections.open') return json({ ok: true, url: WSS });
    if (method === 'chat.postMessage') return json({ ok: true, ts: `900.${(ts.n += 1)}` });
    return json({ ok: true });
  };
  t.after(() => {
    globalThis.fetch = orig;
  });
  return { calls, posts: () => calls.filter((c) => c.method === 'chat.postMessage') };
}

class FakeAgents extends EventEmitter {
  constructor() {
    super();
    this.created = [];
    this.started = [];
    this.logs = [];
  }
  createTask(p) {
    const c = { id: `c${this.created.length + 1}`, title: p.prompt.slice(0, 40), ...p };
    this.created.push(c);
    return [c];
  }
  start(id) {
    this.started.push(id);
  }
  log(c, kind, text) {
    this.logs.push({ id: c.id, kind, text });
  }
}

const CONFIG = { allowedUsers: ALICE, channelMap: `${CH} /tmp/project`, notifyChannel: 'C0NOTIFY' };

function setup(t, { config = CONFIG, tokens = true, agents = new FakeAgents(), WebSocketImpl = FakeWS, ...opts } = {}) {
  FakeWS.made = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-slack-'));
  const store = new Store(path.join(dir, 'board.json'));
  const secrets = new SecretStore({ file: path.join(dir, 'secrets.json'), safeStorage });
  const trackers = new trackersMod.Trackers({ store, secrets });
  if (tokens) trackers.save('slack', { config, secrets: { botToken: BOT, appToken: APP } });
  const bridge = new SlackBridge({ trackers, agents, store, WebSocketImpl, retryBaseMs: 1, retryMaxMs: 4, ...opts });
  t.after(() => bridge.stop());
  return { dir, store, trackers, secrets, agents, bridge };
}

async function connected(s) {
  s.bridge.start();
  await until(() => FakeWS.made.length);
  const ws = FakeWS.made.at(-1);
  ws.receive({ type: 'hello' });
  return ws;
}

const mention = (over = {}) => ({
  type: 'events_api',
  envelope_id: 'env-1',
  payload: { event_id: 'Ev1', event: { type: 'app_mention', user: ALICE, channel: CH, ts: '100.1', text: '<@UBOT> READMEを直して', ...over } },
});
const slash = (over = {}) => ({
  type: 'slash_commands',
  envelope_id: 'env-s1',
  payload: { command: '/kanban', text: 'テストを足して', user_id: ALICE, user_name: 'alice', channel_id: CH, channel_name: 'project', trigger_id: 'tr1', response_url: 'https://hooks.slack.com/commands/T/1/x', ...over },
});

test('Slack: 連携の欄に出るが、課題管理の一覧には入らない', () => {
  assert.strictEqual(trackersMod.get('slack'), provider);
  assert.ok(!trackersMod.isIssueProvider('slack'));
  assert.ok(!trackersMod.issueProviderMeta().some((p) => p.id === 'slack'));
  assert.ok(provider.guide.some((x) => x.includes('Socket Mode')));
  assert.ok(provider.guide.some((x) => x.includes('閉じている間')));
});

test('decide: 一覧にある人の、対応のあるチャンネルからの依頼だけを通す', () => {
  const req = { user: ALICE, channel: CH, text: 'do' };
  assert.deepStrictEqual(decide(CONFIG, req), { ok: true, repoPath: '/tmp/project' });
  assert.deepStrictEqual(decide(CONFIG, { ...req, user: MALLORY }), { ok: false, reason: 'user' });
  assert.deepStrictEqual(decide(CONFIG, { ...req, user: '' }), { ok: false, reason: 'user' });
  assert.deepStrictEqual(decide(CONFIG, { ...req, channel: OTHER_CH }), { ok: false, reason: 'channel' });
  assert.deepStrictEqual(decide(CONFIG, { ...req, text: '  ' }), { ok: false, reason: 'empty' });
});

test('decide: 未設定なら誰も開始できない', () => {
  for (const config of [{}, { allowedUsers: '', channelMap: `${CH} /tmp/x` }, { allowedUsers: '   ,  ', channelMap: `${CH} /tmp/x` }]) {
    assert.deepStrictEqual(decide(config, { user: ALICE, channel: CH, text: 'do' }), { ok: false, reason: 'user' });
  }
  assert.strictEqual(trackersMod.cleanConfig(provider, {}).allowedUsers, '');
});

test('設定の読み取り: 区切りとパスの空白・ドライブ名、読めない値', () => {
  assert.deepStrictEqual([...parseUsers('U012, U034\nW056').users], ['U012', 'U034', 'W056']);
  assert.deepStrictEqual(parseUsers('alice').bad, ['alice']);
  const { map, bad } = parseChannelMap(`C012 /Users/me/my project\nG034 = C:\\work\\repo\n\nnope`);
  assert.strictEqual(map.get('C012'), '/Users/me/my project');
  assert.strictEqual(map.get('G034'), 'C:\\work\\repo');
  assert.deepStrictEqual(bad, ['nope']);
});

test('保存: 読めない ID やトークンの種類の間違いは断る（エラーにトークンを入れない）', (t) => {
  const s = setup(t, { tokens: false });
  const save = (config, secrets = { botToken: BOT, appToken: APP }) => s.trackers.save('slack', { config, secrets });
  assert.throws(() => save({ allowedUsers: 'alice' }), /U で始まる/);
  assert.throws(() => save({ channelMap: 'nope' }), /対応を読めません/);
  assert.throws(() => save({ notifyChannel: '#general' }), /チャンネル ID/);
  assert.throws(() => save({}, { botToken: APP, appToken: APP }), (e) => /xoxb-/.test(e.message) && !e.message.includes(APP));
  assert.strictEqual(s.trackers.hasSecret('slack', 'botToken'), false, '断ったときはトークンも保存しない');
  assert.ok(save({}).configured);
});

test('toPlainText: 自分へのメンションを外し、リンクは実際の URL にする', () => {
  assert.strictEqual(toPlainText('<@UBOT> fix &lt;b&gt; &amp; go', 'UBOT'), 'fix <b> & go');
  assert.strictEqual(toPlainText('<@UOTHER> <@UBOT> ask <@U2>', 'UBOT'), '@UOTHER  ask @U2');
  assert.strictEqual(toPlainText('see <https://evil.example|https://good.example>', 'UBOT'), 'see https://evil.example');
  assert.strictEqual(toPlainText('<#C1|general> <!here>', 'UBOT'), '#general @here');
});

test('backoffMs: 間隔を伸ばし、上限で止める', () => {
  const at = (n) => backoffMs(n, { base: 1000, max: 60000, random: () => 0.5 });
  assert.deepStrictEqual([0, 1, 2, 3].map(at), [1000, 2000, 4000, 8000]);
  assert.strictEqual(at(10), 60000);
  assert.strictEqual(at(1000), 60000);
});

test('接続: xapp- で URL をもらって WebSocket を開き、hello で接続済みになる', async (t) => {
  const f = mockFetch(t);
  const s = setup(t);
  const ws = await connected(s);
  assert.strictEqual(ws.url, WSS);
  assert.strictEqual(f.calls.find((c) => c.method === 'apps.connections.open').auth, `Bearer ${APP}`);
  assert.strictEqual(f.calls.find((c) => c.method === 'auth.test').auth, `Bearer ${BOT}`);
  assert.ok(f.calls.every((c) => c.host === 'slack.com'));
  assert.strictEqual(s.bridge.status().state, 'connected');
});

test('接続: トークンが無ければつながない。標準の WebSocket が無いときは理由を出す', async (t) => {
  const f = mockFetch(t);
  const s = setup(t, { tokens: false });
  s.bridge.start();
  await tick();
  assert.strictEqual(f.calls.length, 0);
  assert.strictEqual(s.bridge.status().state, 'off');

  const orig = globalThis.WebSocket;
  delete globalThis.WebSocket;
  t.after(() => {
    globalThis.WebSocket = orig;
  });
  const n = setup(t, { WebSocketImpl: null });
  n.bridge.start();
  await until(() => n.bridge.status().state === 'error');
  assert.match(n.bridge.status().text, /WebSocket/);
  // 受信は使えなくても、投稿はできる
  await n.bridge.notify({ kind: 'done', title: '完了', body: '' }, { id: 'x' });
  assert.strictEqual(f.posts().length, 1);
});

test('再接続: 切れたらつなぎ直す。待ち時間の回数は hello で元に戻る', async (t) => {
  mockFetch(t);
  const s = setup(t);
  const first = await connected(s);
  first.close();
  assert.strictEqual(s.bridge.status().state, 'connecting');
  assert.strictEqual(s.bridge.attempt, 1);
  await until(() => FakeWS.made.length === 2);
  FakeWS.made[1].close();
  assert.strictEqual(s.bridge.attempt, 2);
  await until(() => FakeWS.made.length === 3);
  FakeWS.made[2].receive({ type: 'hello' });
  assert.strictEqual(s.bridge.attempt, 0);
  assert.strictEqual(s.bridge.status().state, 'connected');
});

test('再接続: disconnect を受けたら、古い接続を閉じてつなぎ直す', async (t) => {
  mockFetch(t);
  const s = setup(t);
  const first = await connected(s);
  first.receive({ type: 'disconnect', reason: 'refresh_requested' });
  await until(() => FakeWS.made.length === 2);
  assert.strictEqual(first.closed, true);
  first.receive(mention());
  await tick();
  assert.strictEqual(s.agents.created.length, 0, '古い接続のイベントは捨てる');
});

test('再接続: hello が来なければつなぎ直す。接続が長くなったらつなぎ直す', async (t) => {
  mockFetch(t);
  const s = setup(t, { helloTimeoutMs: 5, maxConnectionMs: 5 });
  s.bridge.start();
  await until(() => FakeWS.made.length >= 2);
  FakeWS.made.at(-1).receive({ type: 'hello' });
  const n = FakeWS.made.length;
  await until(() => FakeWS.made.length > n);
});

test('再接続: ネットワークのエラーでは続け、トークンの間違いでは止める', async (t) => {
  let down = 2;
  mockFetch(t, {
    'apps.connections.open': () => (down-- > 0 ? new Response('oops', { status: 503 }) : null),
  });
  const s = setup(t);
  s.bridge.start();
  await until(() => FakeWS.made.length === 1);

  const f = mockFetch(t, { 'apps.connections.open': { ok: false, error: 'invalid_auth' } });
  const b = setup(t);
  b.bridge.start();
  await until(() => b.bridge.status().state === 'error');
  const n = f.calls.length;
  await tick(20);
  assert.strictEqual(f.calls.length, n, '入れ直すまでつなぎ直さない');
  assert.match(b.bridge.status().text, /invalid_auth/);
  // 設定を保存し直したら、もう一度つなぐ
  b.trackers.save('slack', { secrets: { appToken: APP } });
  await until(() => f.calls.length > n);
});

test('エラーに トークンも接続用の URL も出ない', async (t) => {
  const leak = `boom ${BOT} ${APP} Bearer ${BOT}`;
  const f = mockFetch(t, {
    'auth.test': () => {
      throw Object.assign(new Error(leak), { cause: { message: leak } });
    },
    'chat.postMessage': () => new Response(JSON.stringify({ message: leak }), { status: 500 }),
  });
  class Thrower {
    constructor(url) {
      throw new Error(`cannot open ${url}`);
    }
  }
  const s = setup(t, { WebSocketImpl: Thrower });
  s.bridge.start();
  await until(() => f.calls.length && s.bridge.reason);
  await s.bridge.notify({ kind: 'done', title: 'x', body: '' }, { id: 'x' });
  let text = JSON.stringify(s.bridge.status());
  assert.match(text, /投稿に失敗/);

  const g = mockFetch(t);
  const w = setup(t, { WebSocketImpl: Thrower });
  w.bridge.start();
  await until(() => g.calls.length >= 2 && w.bridge.reason);
  text += JSON.stringify(w.bridge.status()) + JSON.stringify(w.trackers.publicList());
  for (const bad of [BOT, APP, 'SECRETTICKET']) assert.ok(!text.includes(bad), bad);
});

test('メンション: 許可された人ならタスクを作って開始し、スレッドに返事する', async (t) => {
  const f = mockFetch(t);
  const s = setup(t);
  const ws = await connected(s);
  ws.receive(mention());
  await until(() => f.posts().length);
  assert.deepStrictEqual(ws.sent, [{ envelope_id: 'env-1' }]);
  const [made] = s.agents.created;
  assert.strictEqual(made.prompt, 'READMEを直して');
  assert.strictEqual(made.repoPath, '/tmp/project');
  assert.strictEqual(made.skipSpecCheck, undefined, '仕様の確認の流れはそのまま');
  assert.deepStrictEqual(made.slack, { channel: CH, user: ALICE, ts: '100.1', threadTs: '100.1' });
  assert.deepStrictEqual(s.agents.started, ['c1']);
  assert.ok(s.agents.logs[0].text.includes(ALICE) && s.agents.logs[0].text.includes(CH));
  const post = f.posts()[0];
  assert.strictEqual(post.auth, `Bearer ${BOT}`);
  assert.strictEqual(post.body.channel, CH);
  assert.strictEqual(post.body.thread_ts, '100.1');
  assert.match(post.body.text, /受け付けました/);
});

test('メンション: スレッドの中で呼ばれたら、そのスレッドに返す。指示はそのメッセージの本文だけ', async (t) => {
  const f = mockFetch(t);
  const s = setup(t);
  const ws = await connected(s);
  ws.receive(mention({ ts: '100.5', thread_ts: '100.1' }));
  await until(() => f.posts().length);
  assert.strictEqual(s.agents.created[0].prompt, 'READMEを直して');
  assert.strictEqual(f.posts()[0].body.thread_ts, '100.1');
  assert.ok(!f.calls.some((c) => /conversations/.test(c.method)), 'スレッドの中身を読まない');
});

test('メンション: 許可されていない人には断りの返事だけして、タスクは作らない', async (t) => {
  const f = mockFetch(t);
  const s = setup(t);
  const ws = await connected(s);
  ws.receive(mention({ user: MALLORY }));
  await until(() => f.posts().length);
  assert.strictEqual(s.agents.created.length, 0);
  assert.strictEqual(s.agents.started.length, 0);
  assert.match(f.posts()[0].body.text, /許可された人だけ/);
  assert.strictEqual(f.posts()[0].body.thread_ts, '100.1');
});

test('メンション: 許可の一覧が空なら、誰の依頼でもタスクを作らない', async (t) => {
  const f = mockFetch(t);
  const s = setup(t, { config: { channelMap: `${CH} /tmp/project` } });
  const ws = await connected(s);
  ws.receive(mention());
  await until(() => f.posts().length);
  assert.strictEqual(s.agents.created.length, 0);
});

test('メンション: 対応のないチャンネル・空の指示は断る', async (t) => {
  const f = mockFetch(t);
  const s = setup(t);
  const ws = await connected(s);
  ws.receive(mention({ channel: OTHER_CH }));
  ws.receive({ ...mention({ ts: '100.2', text: '<@UBOT>  ' }), envelope_id: 'env-2', payload: { ...mention({ ts: '100.2', text: '<@UBOT>  ' }).payload, event_id: 'Ev2' } });
  await until(() => f.posts().length === 2);
  assert.strictEqual(s.agents.created.length, 0);
  assert.match(f.posts()[0].body.text, /対応していない/);
  assert.match(f.posts()[1].body.text, /指示を書いて/);
});

test('メンション: ボット・編集・自分の発言では動かない', async (t) => {
  const f = mockFetch(t);
  const s = setup(t);
  const ws = await connected(s);
  const cases = [{ bot_id: 'B1' }, { subtype: 'bot_message' }, { edited: { ts: '1' } }, { user: 'UBOT' }];
  cases.forEach((over, i) => {
    const m = mention(over);
    ws.receive({ ...m, envelope_id: `e${i}`, payload: { ...m.payload, event_id: `Ev${i}` } });
  });
  await tick(20);
  assert.strictEqual(s.agents.created.length, 0);
  assert.strictEqual(f.posts().length, 0);
  assert.strictEqual(ws.sent.length, cases.length, '動かないイベントにも ack は返す');
});

test('重複: 同じ envelope_id・event_id は1つしかタスクにしない（ack は毎回返す）', async (t) => {
  mockFetch(t);
  const s = setup(t);
  const ws = await connected(s);
  const m = mention();
  ws.receive(m);
  ws.receive(m); // 同じ封筒
  ws.receive({ ...m, envelope_id: 'env-retry', retry_attempt: 1 }); // 送り直し: 封筒は別で event_id は同じ
  await tick(20);
  assert.strictEqual(s.agents.created.length, 1);
  assert.deepStrictEqual(ws.sent.map((x) => x.envelope_id), ['env-1', 'env-1', 'env-retry']);
});

test('重複: 再起動のあとの送り直しも、作ったカードで分かる', async (t) => {
  mockFetch(t);
  const s = setup(t);
  s.store.cards.push({ id: 'old', slack: { channel: CH, ts: '100.1', threadTs: '100.1' } });
  const ws = await connected(s);
  ws.receive(mention());
  await tick(20);
  assert.strictEqual(s.agents.created.length, 0);
});

test('/コマンド: 誰の依頼かを投稿して、それをスレッドにする', async (t) => {
  const f = mockFetch(t);
  const s = setup(t);
  const ws = await connected(s);
  ws.receive(slash());
  await until(() => f.posts().length === 2);
  assert.deepStrictEqual(ws.sent, [{ envelope_id: 'env-s1' }]);
  const [head, accepted] = f.posts();
  assert.strictEqual(head.body.thread_ts, undefined);
  assert.ok(head.body.text.includes(`<@${ALICE}>`) && head.body.text.includes('テストを足して'));
  assert.strictEqual(accepted.body.thread_ts, '900.1');
  assert.deepStrictEqual(s.agents.created[0].slack, { channel: CH, user: ALICE, ts: '900.1', threadTs: '900.1', userName: 'alice', channelName: 'project' });
  assert.ok(s.agents.logs[0].text.includes('@alice') && s.agents.logs[0].text.includes('#project'));
});

test('/コマンド: 断るときは本人にだけ返事する。重複は1つにする', async (t) => {
  const f = mockFetch(t);
  const s = setup(t);
  const ws = await connected(s);
  ws.receive(slash({ user_id: MALLORY }));
  assert.strictEqual(ws.sent[0].payload.response_type, 'ephemeral');
  assert.match(ws.sent[0].payload.text, /許可された人だけ/);
  ws.receive(slash({ trigger_id: 'tr2' }));
  ws.receive({ ...slash({ trigger_id: 'tr2' }), envelope_id: 'env-s2' });
  await until(() => f.posts().length === 2);
  await tick(10);
  assert.strictEqual(s.agents.created.length, 1);
  assert.deepStrictEqual(ws.sent.slice(1), [{ envelope_id: 'env-s1' }, { envelope_id: 'env-s2' }]);
});

test('/コマンド: Bot が投稿できないチャンネルなら、タスクを作らず本人に知らせる', async (t) => {
  const f = mockFetch(t, { 'chat.postMessage': { ok: false, error: 'not_in_channel' } });
  const s = setup(t);
  const ws = await connected(s);
  ws.receive(slash());
  await until(() => f.calls.some((c) => c.host === 'hooks.slack.com'));
  assert.strictEqual(s.agents.created.length, 0);
  assert.match(f.calls.at(-1).body.text, /not_in_channel/);
  assert.strictEqual(f.calls.at(-1).body.response_type, 'ephemeral');
  // Slack の決まった宛先でなければ送らない
  const n = f.calls.length;
  await s.bridge.respond('https://evil.example/hook', 'x');
  assert.strictEqual(f.calls.length, n);
});

test('作れなかった・開始できなかったときは、スレッドに知らせる', async (t) => {
  const f = mockFetch(t);
  const agents = new FakeAgents();
  agents.createTask = () => {
    throw new Error('エージェントが使えません');
  };
  const s = setup(t, { agents });
  const ws = await connected(s);
  ws.receive(mention());
  await until(() => f.posts().length);
  assert.match(f.posts()[0].body.text, /タスクを作れませんでした: エージェントが使えません/);

  const late = new FakeAgents();
  late.start = () => {
    throw new Error('上限です');
  };
  const f2 = mockFetch(t);
  const s2 = setup(t, { agents: late });
  const ws2 = await connected(s2);
  ws2.receive(mention());
  await until(() => f2.posts().length === 2);
  assert.match(f2.posts()[1].body.text, /開始できませんでした: 上限です/);
});

test('通知: 種類ごとに切れる。確認待ちには仕様の確認と権限の確認も入る', async (t) => {
  const f = mockFetch(t);
  const s = setup(t, { config: { ...CONFIG, notifyDone: false } });
  s.bridge.start();
  await until(() => s.bridge.status().state === 'connecting' && FakeWS.made.length);
  const send = (kind) => s.agents.emit('notification', { kind, title: `t-${kind}`, body: 'b' }, { id: 'x', title: 'x' });
  for (const k of ['done', 'skill', 'failed', 'awaiting', 'permission', 'question', 'review']) send(k);
  await until(() => f.posts().length === 5);
  await tick(10);
  assert.deepStrictEqual(f.posts().map((p) => p.body.text.split('\n')[0]), ['*t-failed*', '*t-awaiting*', '*t-permission*', '*t-question*', '*t-review*']);
  assert.ok(f.posts().every((p) => p.body.channel === 'C0NOTIFY' && !p.body.thread_ts));
});

test('通知: 会話のカードは投稿しない。チャンネルが空なら投稿しない', async (t) => {
  const f = mockFetch(t);
  const s = setup(t, { config: { ...CONFIG, notifyChannel: '' } });
  s.bridge.start();
  s.agents.emit('notification', { kind: 'done', title: 'x', body: '' }, { id: 'x' });
  const c = setup(t);
  c.bridge.start();
  c.agents.emit('notification', { kind: 'awaiting', title: 'x', body: '' }, { id: 'x', kind: 'chat' });
  await tick(20);
  assert.strictEqual(f.posts().length, 0);
});

test('通知: 本文の <!channel> で全員を呼ばない', async (t) => {
  const f = mockFetch(t);
  const s = setup(t);
  await s.bridge.notify({ kind: 'failed', title: '失敗: <!channel>', body: 'a & <@U1> <!here>' }, { id: 'x' });
  const { text } = f.posts()[0].body;
  assert.ok(!/<[!@]/.test(text), text);
  assert.strictEqual(escapeText('<&>'), '&lt;&amp;&gt;');
});

test('通知: Slack から頼んだタスクは、種類の設定によらずそのスレッドに投稿する（サブタスクと枝も）', async (t) => {
  const f = mockFetch(t);
  const s = setup(t, { config: { ...CONFIG, notifyDone: false, notifyFailed: false, notifyAwaiting: false } });
  const slack = { channel: CH, user: ALICE, ts: '1.1', threadTs: '1.1' };
  s.store.cards.push({ id: 'p', slack }, { id: 'k', subtaskOf: { parent: 'p', key: 'a' } }, { id: 'b', relay: { branchOf: { parent: 'k' } } });
  for (const id of ['p', 'k', 'b']) await s.bridge.notify({ kind: 'done', title: id, body: '' }, s.store.card(id));
  assert.strictEqual(f.posts().length, 3);
  assert.ok(f.posts().every((p) => p.body.channel === CH && p.body.thread_ts === '1.1'));
});

test('投稿: 順番を保ち、429 は待ってもう一度送る', async (t) => {
  let first = true;
  const f = mockFetch(t, {
    'chat.postMessage': () => {
      if (!first) return null;
      first = false;
      return new Response('{}', { status: 429 });
    },
  });
  const s = setup(t, { rateLimitWaitMs: 1 });
  await Promise.all([s.bridge.post(CH, 'one'), s.bridge.post(CH, 'two')]);
  assert.deepStrictEqual(f.posts().map((p) => p.body.text), ['one', 'one', 'two']);
});

test('接続テスト: 両方のトークンを確かめる。ダメならエラーの文に値を出さない', async (t) => {
  const f = mockFetch(t);
  const s = setup(t, { tokens: false });
  const draft = { secrets: { botToken: BOT, appToken: APP } };
  assert.deepStrictEqual(await s.trackers.test('slack', draft), { ok: true, message: 'kanban として接続できました' });
  assert.deepStrictEqual(f.calls.map((c) => c.method), ['auth.test', 'apps.connections.open']);
  assert.strictEqual((await s.trackers.test('slack', {})).ok, false);

  mockFetch(t, { 'apps.connections.open': { ok: false, error: 'not_allowed_token_type' } });
  await assert.rejects(s.trackers.test('slack', draft), (e) => /not_allowed_token_type/.test(e.message) && !e.message.includes(APP) && !e.message.includes(BOT));
});

test('画面に渡す一覧: 接続の状態と手順はあるが、トークンの値はない', async (t) => {
  mockFetch(t);
  const s = setup(t);
  s.trackers.setStatusSource('slack', () => s.bridge.status());
  await connected(s);
  const item = s.trackers.publicOne('slack');
  assert.strictEqual(item.status.state, 'connected');
  assert.ok(item.guide.length);
  assert.deepStrictEqual(s.trackers.statusMap().slack, s.bridge.status());
  const text = JSON.stringify([item, s.store.settings]);
  assert.ok(!text.includes(BOT) && !text.includes(APP));
});

test('本物の createTask: 頼んだ人を残し、仕様の確認で止まれば同じスレッドに投稿する', async (t) => {
  const f = mockFetch(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-slack-repo-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const dataStore = new Store(path.join(dir, 'board.json'));
  Object.assign(dataStore.settings, { repoPath: repo, noGitRepos: [repo] });
  const agents = new AgentManager(dataStore, {});
  agents.start = (id) => agents.notify(agents.must(id), 'awaiting', '仕様の確認: x', '内容が詰まっていません');
  const secrets = new SecretStore({ file: path.join(dir, 'secrets.json'), safeStorage });
  const trackers = new trackersMod.Trackers({ store: dataStore, secrets });
  trackers.save('slack', { config: { allowedUsers: ALICE, channelMap: `${CH} ${repo}` }, secrets: { botToken: BOT, appToken: APP } });
  FakeWS.made = [];
  const bridge = new SlackBridge({ trackers, agents, store: dataStore, WebSocketImpl: FakeWS });
  t.after(() => bridge.stop());
  const ws = await connected({ bridge });
  ws.receive(mention());
  await until(() => f.posts().length === 2);
  const card = dataStore.cards[0];
  assert.deepStrictEqual(card.slack, { channel: CH, user: ALICE, ts: '100.1', threadTs: '100.1' });
  assert.strictEqual(card.specState, 'checking');
  assert.ok(card.logs.some((l) => JSON.stringify(l).includes(ALICE)));
  assert.ok(agents.publicCards(repo)[0].slack, '画面に届く');
  assert.match(f.posts()[0].body.text, /受け付けました/);
  assert.match(f.posts()[1].body.text, /仕様の確認/);
  assert.strictEqual(f.posts()[1].body.thread_ts, '100.1');
  // renderer から来る card:create の経路では slack を受け取らない（頼んだ人を偽れない）
  assert.ok(!/handle\('card:create',[^\n]*slack/.test(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')));
});
