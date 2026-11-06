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

// ---------- ボタンとモーダルでの承認・回答 ----------

// 本物の AgentManager に確認を出させて、Slack のボタンで答える
async function realBridge(t, f, config = { allowedUsers: ALICE, notifyChannel: 'C0NOTIFY' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-slack-repo-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const store = new Store(path.join(dir, 'board.json'));
  Object.assign(store.settings, { repoPath: repo, noGitRepos: [repo] });
  const agents = new AgentManager(store, {});
  const secrets = new SecretStore({ file: path.join(dir, 'secrets.json'), safeStorage });
  const trackers = new trackersMod.Trackers({ store, secrets });
  trackers.save('slack', { config, secrets: { botToken: BOT, appToken: APP } });
  FakeWS.made = [];
  const bridge = new SlackBridge({ trackers, agents, store, WebSocketImpl: FakeWS });
  t.after(() => bridge.stop());
  const ws = await connected({ bridge });
  const card = agents.createTask({ prompt: 'テスト', repoPath: repo, skipSpecCheck: true })[0];
  await until(() => bridge.status().state === 'connected');
  return { agents, store, trackers, bridge, ws, card, f };
}

const actionsOf = (post) => post.body.blocks.find((b) => b.type === 'actions').elements;
let envelope = 0;
function press(s, post, actionId, { user = ALICE, value } = {}) {
  envelope += 1;
  const el = actionsOf(post).find((x) => x.action_id === actionId) || actionsOf(post)[0];
  s.ws.receive({
    type: 'interactive',
    envelope_id: `env-a${envelope}`,
    payload: { type: 'block_actions', user: { id: user, username: 'alice' }, trigger_id: `trig-${envelope}`, response_url: 'https://hooks.slack.com/actions/T/1/x', channel: { id: post.body.channel }, message: { ts: post.ts }, actions: [{ action_id: actionId, value: value || el.value }] },
  });
}
function submit(s, view, values, { user = ALICE } = {}) {
  envelope += 1;
  const id = `env-v${envelope}`;
  s.ws.receive({ type: 'interactive', envelope_id: id, payload: { type: 'view_submission', user: { id: user, username: 'alice' }, view: { ...view, state: { values } } } });
  return s.ws.sent.filter((x) => x.envelope_id === id).at(-1);
}
// 最後の投稿（ts は mockFetch が振る順番）
const lastPost = (f) => {
  const posts = f.posts();
  return { ...posts.at(-1), ts: `900.${posts.length}` };
};

test('承認: 許可された人が「許可」を押すと進み、通知のボタンが消える', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  const p = s.agents.requestPermission({ cardId: s.card.id, toolName: 'Bash', input: { command: 'npm test <!channel>' } });
  await until(() => f.posts().length === 1);
  const post = lastPost(f);
  assert.deepStrictEqual(actionsOf(post).map((x) => x.action_id), ['kanban_allow', 'kanban_deny']);
  const detail = post.body.blocks.find((b) => b.text && b.text.type === 'plain_text');
  assert.match(detail.text.text, /npm test <!channel>/, '全文を書式なしで見せる');
  assert.ok(!post.body.text.includes('<!channel>'));
  assert.ok(!post.body.text.includes('画面で確かめて'));
  press(s, post, 'kanban_allow');
  assert.strictEqual((await p).behavior, 'allow');
  await until(() => f.calls.find((c) => c.method === 'chat.update'));
  const update = f.calls.find((c) => c.method === 'chat.update');
  assert.strictEqual(update.body.ts, post.ts);
  assert.ok(!update.body.blocks.some((b) => b.type === 'actions'), 'ボタンは消える');
  assert.match(JSON.stringify(update.body.blocks), new RegExp(`<@${ALICE}>`));
  assert.ok(s.card.logs.some((l) => /Slack の @alice が許可しました/.test(JSON.stringify(l))));
});

test('承認: 許可されていない人が押しても進まず、本人にだけ断る', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  const p = s.agents.requestPermission({ cardId: s.card.id, toolName: 'Bash', input: { command: 'ls' } });
  await until(() => f.posts().length === 1);
  press(s, lastPost(f), 'kanban_allow', { user: MALLORY });
  await until(() => f.calls.some((c) => c.host === 'hooks.slack.com'));
  assert.strictEqual(s.card.permissions.length, 1);
  const refusal = f.calls.find((c) => c.host === 'hooks.slack.com');
  assert.deepStrictEqual([refusal.body.response_type, refusal.body.replace_original], ['ephemeral', false]);
  assert.match(refusal.body.text, /許可された人だけ/);
  press(s, lastPost(f), 'kanban_deny');
  assert.strictEqual((await p).behavior, 'deny');
});

test('承認: 許可の一覧が空か App-Level Token がなければ、ボタンを出さない', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f, { allowedUsers: '', notifyChannel: 'C0NOTIFY' });
  s.agents.requestPermission({ cardId: s.card.id, toolName: 'Bash', input: { command: 'ls' } });
  await until(() => f.posts().length === 1);
  assert.strictEqual(f.posts()[0].body.blocks, undefined);
  assert.match(f.posts()[0].body.text, /画面で確かめて/);
  s.trackers.save('slack', { config: { allowedUsers: ALICE, notifyChannel: 'C0NOTIFY' }, secrets: {} });
  assert.ok(s.bridge.promptFor({ kind: 'permission', reqId: s.card.permissions[0].id }, s.card), '両方そろえば出す');
  s.trackers.hasSecret = (id, name) => name !== 'appToken';
  assert.strictEqual(s.bridge.promptFor({ kind: 'permission', reqId: s.card.permissions[0].id }, s.card), null);
});

test('承認: 全文を出せない入力は拒否だけ。古いボタンの値や別の通知の値では動かない', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  s.agents.requestPermission({ cardId: s.card.id, toolName: 'Bash', input: { command: `true ${'x'.repeat(5000)}; rm -rf /` } });
  await until(() => f.posts().length === 1);
  const post = lastPost(f);
  assert.deepStrictEqual(actionsOf(post).map((x) => x.action_id), ['kanban_deny']);
  assert.ok(post.body.blocks.every((b) => !b.text || b.text.text.length <= 3000));
  press(s, post, 'kanban_allow');
  await until(() => f.calls.some((c) => c.host === 'hooks.slack.com'));
  assert.strictEqual(s.card.permissions.length, 1, '作った値でも許可できない');
  press(s, { ...post, ts: '1.1' }, 'kanban_deny');
  await until(() => f.calls.filter((c) => c.host === 'hooks.slack.com').length === 2);
  assert.strictEqual(s.card.permissions.length, 1, '別のメッセージからは動かない');
});

test('承認: アプリの画面で答えたら、Slack のボタンが消える。あとから押しても何も起きない', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  s.agents.requestPermission({ cardId: s.card.id, toolName: 'Bash', input: { command: 'ls' } });
  await until(() => f.posts().length === 1);
  const post = lastPost(f);
  s.agents.answerPermission(s.card.id, s.card.permissions[0].id, 'deny');
  await until(() => f.calls.some((c) => c.method === 'chat.update'));
  assert.match(JSON.stringify(f.calls.find((c) => c.method === 'chat.update').body.blocks), /拒否/);
  press(s, post, 'kanban_allow');
  await until(() => f.calls.some((c) => c.host === 'hooks.slack.com'));
  assert.match(f.calls.find((c) => c.host === 'hooks.slack.com').body.text, /もう終わっています/);
});

test('承認: 投稿の途中で答えが出ても、投稿のあとでボタンを消す', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  const mocked = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith('chat.postMessage')) await gate;
    return mocked(url, opts);
  };
  t.after(() => { globalThis.fetch = mocked; });
  s.agents.requestPermission({ cardId: s.card.id, toolName: 'Bash', input: { command: 'ls' } });
  s.agents.answerPermission(s.card.id, s.card.permissions[0].id, 'allow');
  await tick();
  assert.strictEqual(f.calls.filter((c) => c.method === 'chat.update').length, 0);
  release();
  await until(() => f.calls.some((c) => c.method === 'chat.update'));
  assert.strictEqual(f.calls.find((c) => c.method === 'chat.update').body.ts, '900.1');
});

test('質問: 「回答する」でモーダルを開き、選択肢と自由入力で答える', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  const long = 'L'.repeat(120);
  const input = { questions: [
    { question: 'どの案？', header: '案', multiSelect: false, options: [{ label: long, description: 'd'.repeat(100) }, { label: 'B' }] },
    { question: '対象は？', header: '対象', multiSelect: true, options: [{ label: 'x' }, { label: 'y' }] },
  ] };
  const p = s.agents.requestPermission({ cardId: s.card.id, toolName: 'AskUserQuestion', input });
  await until(() => f.posts().length === 1);
  press(s, lastPost(f), 'kanban_answer');
  await until(() => f.calls.some((c) => c.method === 'views.open'));
  const open = f.calls.find((c) => c.method === 'views.open');
  assert.match(open.body.trigger_id, /^trig-/);
  const { view } = open.body;
  assert.deepStrictEqual(view.blocks.map((b) => b.block_id), ['q0', 't0', 'q1', 't1']);
  assert.strictEqual(view.blocks[0].element.type, 'radio_buttons');
  assert.strictEqual(view.blocks[2].element.type, 'checkboxes');
  assert.ok(view.blocks[0].element.options[0].text.text.length <= 75);
  assert.ok(view.blocks[0].element.options[0].description.text.length <= 75);
  const missing = submit(s, view, { q0: { choice: { selected_option: { value: '1' } } }, t0: { text: { value: '' } }, q1: { choice: { selected_options: [] } }, t1: { text: { value: '' } } });
  assert.deepStrictEqual(missing.payload, { response_action: 'errors', errors: { t1: '回答を書いてください' } });
  assert.strictEqual(s.card.questions.length, 1);
  const refused = submit(s, view, {}, { user: MALLORY });
  assert.match(JSON.stringify(refused.payload), /許可された人だけ/);
  const done = submit(s, view, { q0: { choice: { selected_option: { value: '0' } } }, t0: { text: { value: '' } }, q1: { choice: { selected_options: [{ value: '0' }, { value: '1' }] } }, t1: { text: { value: 'z' } } });
  assert.strictEqual(done.payload, undefined);
  const res = await p;
  assert.deepStrictEqual(res.updatedInput.answers, { 'どの案？': long, '対象は？': 'x, y, z' });
  await until(() => f.calls.some((c) => c.method === 'chat.update'));
  assert.match(JSON.stringify(submit(s, view, {}).payload), /もう終わっています/);
});

function awaiting(s, over = {}) {
  Object.assign(s.card, { status: 'review', awaitingReply: true, lastText: 'どちらにしますか？', ...over });
  return s.agents.notify(s.card, 'awaiting', `回答待ち: ${s.card.title}`, s.card.lastText);
}

test('回答待ち: モーダルの文が追加指示になり、ボタンが消える', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  const sent = [];
  const send = s.agents.send.bind(s.agents);
  s.agents.send = (id, message) => {
    sent.push(message);
    s.card.awaitingReply = false;
    s.agents.emit('changed', id);
  };
  t.after(() => { s.agents.send = send; });
  awaiting(s);
  await until(() => f.posts().length === 1);
  press(s, lastPost(f), 'kanban_answer');
  await until(() => f.calls.some((c) => c.method === 'views.open'));
  const { view } = f.calls.find((c) => c.method === 'views.open').body;
  assert.match(JSON.stringify(view.blocks[0]), /どちらにしますか/);
  assert.match(JSON.stringify(submit(s, view, { note: { text: { value: '  ' } } }).payload), /回答を書いてください/);
  assert.strictEqual(submit(s, view, { note: { text: { value: 'Aで' } } }).payload, undefined);
  assert.deepStrictEqual(sent, ['Aで']);
  await until(() => f.calls.some((c) => c.method === 'chat.update'));
  assert.match(JSON.stringify(f.calls.find((c) => c.method === 'chat.update').body.blocks), new RegExp(`回答しました（<@${ALICE}>）`));
  assert.strictEqual(f.calls.filter((c) => c.method === 'chat.update').length, 1);
});

test('回答待ち: 動いている間は送れないので、モーダルにエラーを出す', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  awaiting(s);
  await until(() => f.posts().length === 1);
  press(s, lastPost(f), 'kanban_answer');
  await until(() => f.calls.some((c) => c.method === 'views.open'));
  const { view } = f.calls.find((c) => c.method === 'views.open').body;
  s.card.status = 'running';
  assert.match(JSON.stringify(submit(s, view, { note: { text: { value: 'A' } } }).payload), /実行中・待機中/);
  assert.strictEqual(f.calls.filter((c) => c.method === 'chat.update').length, 0);
});

test('仕様の確認: 質問のフォームで答える。答えていない質問はおまかせにする', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  const sent = [];
  s.agents.send = (id, message) => sent.push(message);
  awaiting(s, { specState: 'pending', specQuestions: [{ question: 'Q1', options: [{ label: 'A' }] }, { question: 'Q2', options: [] }] });
  await until(() => f.posts().length === 1);
  press(s, lastPost(f), 'kanban_answer');
  await until(() => f.calls.some((c) => c.method === 'views.open'));
  const { view } = f.calls.find((c) => c.method === 'views.open').body;
  assert.deepStrictEqual(view.blocks.filter((b) => b.type === 'input').map((b) => b.block_id), ['q0', 't0', 't1', 'note']);
  submit(s, view, { q0: { choice: { selected_option: { value: '0' } } }, note: { text: { value: 'よろしく' } } });
  assert.deepStrictEqual(sent[0].split('\n'), ['仕様の質問への答えです。', '', '1. Q1', '   → A', '2. Q2', '   → おまかせ（妥当な案で決めてください）', '', '補足: よろしく']);
});

test('回答待ち: アプリで答えたら閉じる。新しい確認が出たら古いボタンを閉じる', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  awaiting(s);
  await until(() => f.posts().length === 1);
  const first = lastPost(f);
  awaiting(s);
  await until(() => f.posts().length === 2 && f.calls.some((c) => c.method === 'chat.update'));
  assert.strictEqual(f.calls.find((c) => c.method === 'chat.update').body.ts, first.ts);
  s.card.awaitingReply = false;
  s.agents.emit('changed', s.card.id);
  await until(() => f.calls.filter((c) => c.method === 'chat.update').length === 2);
  assert.strictEqual(s.bridge.prompts.size, 0);
});

test('受信: 同じボタンの送り直しでは1度しか動かない', async (t) => {
  const f = mockFetch(t);
  const s = await realBridge(t, f);
  s.agents.requestPermission({ cardId: s.card.id, toolName: 'Bash', input: { command: 'ls' } });
  await until(() => f.posts().length === 1);
  const envelopeMsg = { type: 'interactive', envelope_id: 'env-dup', payload: { type: 'block_actions', trigger_id: 'dup', user: { id: ALICE }, channel: { id: 'C0NOTIFY' }, message: { ts: lastPost(f).ts }, response_url: 'https://hooks.slack.com/actions/T/1/x', actions: [{ action_id: 'kanban_allow', value: s.card.permissions[0].id }] } };
  s.ws.receive(envelopeMsg);
  s.ws.receive({ ...envelopeMsg, envelope_id: 'env-dup-2' });
  await tick(20);
  assert.strictEqual(s.ws.sent.filter((x) => String(x.envelope_id).startsWith('env-dup')).length, 2, 'ack は毎回返す');
  assert.strictEqual(f.calls.filter((c) => c.host === 'hooks.slack.com').length, 0);
  assert.strictEqual(s.card.logs.filter((l) => /Slack の .* が許可しました/.test(JSON.stringify(l))).length, 1);
});
