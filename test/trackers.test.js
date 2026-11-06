// 連携の土台: プロバイダの登録、HTTP の共通処理、カードの issue の互換、プロバイダ経由の動き
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const trackers = require('../src/trackers');
const { validateBaseUrl, joinUrl, redact, request, HttpError } = require('../src/trackers/http');
const { buildIssuePrompt } = require('../src/trackers/prompt');
const github = require('../src/github');
const IssueRef = require('../renderer/issue-ref');
const Subtasks = require('../src/subtasks');
const { Store, repoSettingsOf } = require('../src/store');
const { AgentManager } = require('../src/agent');

const mem = (t, p) => {
  trackers.register(p);
  t.after(() => trackers.unregister(p.id));
  return p;
};

function setup(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-trackers-'));
  const store = new Store(path.join(dir, 'board.json'));
  store.settings.repoPath = dir;
  Object.assign(store.settings, settings);
  const agents = new AgentManager(store, { mcpScript: '', mcpDir: path.join(dir, 'mcp'), nodeBin: process.execPath });
  return { store, agents, repo: dir };
}

// ---------- 登録 ----------

test('GitHub は最初から登録され、共通の形を持つ', () => {
  const p = trackers.get('github');
  for (const m of ['testConnection', 'parseRefs', 'fetchIssue', 'setStatus', 'addComment', 'createSubIssue', 'fetchSubIssues']) assert.strictEqual(typeof p[m], 'function', m);
  assert.deepStrictEqual(p.configFields, []);
  assert.deepStrictEqual(p.parseRefs({}, '#12 15'), [{ number: 12, key: '#12' }, { number: 15, key: '#15' }]);
  assert.throws(() => p.parseRefs({}, 'abc'), /Issue 番号として読めません/);
  assert.ok(p.matchesRemote('git@github.com:o/r.git'));
  assert.ok(!p.matchesRemote('https://gitlab.com/o/r.git'));
});

test('形の合わないプロバイダは登録できない', (t) => {
  const bad = [
    { label: 'x' },
    { id: 'Bad Id', label: 'x' },
    { id: 'nolabel' },
    { id: 'github', label: 'dup' },
    { id: 'half', label: 'x', fetchIssue() {} },
    { id: 'field1', label: 'x', configFields: [{ name: 'a b', type: 'text', label: 'x' }] },
    { id: 'field2', label: 'x', configFields: [{ name: 'a', type: 'color', label: 'x' }] },
    { id: 'field3', label: 'x', configFields: [{ name: 'a', type: 'text', label: 'x' }, { name: 'a', type: 'url', label: 'y' }] },
  ];
  for (const p of bad) assert.throws(() => trackers.register(p), undefined, JSON.stringify(p));
  mem(t, { id: 'okay', label: 'OK' });
  assert.ok(trackers.get('okay'));
});

test('チャットサービスは「連携」の欄にだけ出て、課題管理サービスには出ない', (t) => {
  mem(t, { id: 'chat', label: 'Chat', configFields: [{ name: 'token', type: 'secret', label: 'トークン' }] });
  assert.ok(!trackers.isIssueProvider('chat'));
  assert.ok(!trackers.issueProviderMeta().some((p) => p.id === 'chat'));
  const { store } = setup();
  const row = new trackers.Trackers({ store }).publicList().find((p) => p.id === 'chat');
  assert.strictEqual(row.issues, false);
  assert.strictEqual(row.configFields[0].type, 'secret');
});

test('origin から課題管理サービスを推定する。分からなければ GitHub', (t) => {
  const { store } = setup();
  const list = new trackers.Trackers({ store });
  assert.strictEqual(list.guessFromRemote('https://example.com/o/r.git'), 'github');
  assert.strictEqual(list.guessFromRemote('https://github.com/o/r.git'), 'github');
  mem(t, { id: 'lab', label: 'Lab', parseRefs: () => [], fetchIssue() {}, matchesRemote: (u) => /lab\.example/.test(u) });
  assert.strictEqual(list.guessFromRemote('git@lab.example:o/r.git'), 'lab');
});

test('configFields の値を整える: 既定値・select・http の許可', (t) => {
  const p = mem(t, {
    id: 'cfg',
    label: 'Cfg',
    configFields: [
      { name: 'baseUrl', type: 'url', label: 'u', default: 'https://api.example.com/', allowHttpField: 'allowHttp' },
      { name: 'allowHttp', type: 'checkbox', label: 'h' },
      { name: 'mode', type: 'select', label: 'm', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'b' },
      { name: 'note', type: 'text', label: 'n' },
      { name: 'token', type: 'secret', label: 't' },
    ],
  });
  assert.deepStrictEqual(trackers.cleanConfig(p, null), { baseUrl: 'https://api.example.com', allowHttp: false, mode: 'b', note: '' });
  assert.throws(() => trackers.cleanConfig(p, { baseUrl: 'http://gitlab.local' }), /許可/);
  assert.strictEqual(trackers.cleanConfig(p, { baseUrl: 'http://gitlab.local/', allowHttp: true }).baseUrl, 'http://gitlab.local');
  assert.strictEqual(trackers.cleanConfig(p, { mode: 'z' }).mode, 'b');
  assert.ok(!('token' in trackers.cleanConfig(p, { token: 'x' })));
});

// ---------- HTTP ----------

test('URL の検証: https が基本。http は明示の許可があるときだけ', () => {
  assert.strictEqual(validateBaseUrl('https://gitlab.example.com/'), 'https://gitlab.example.com');
  assert.strictEqual(validateBaseUrl(' https://example.com/jira// '), 'https://example.com/jira');
  assert.throws(() => validateBaseUrl('http://gitlab.local'), /許可/);
  assert.strictEqual(validateBaseUrl('http://gitlab.local:8080', { allowHttp: true }), 'http://gitlab.local:8080');
  for (const bad of ['', 'gitlab.example.com', 'ftp://a.example.com', 'file:///etc/passwd', 'javascript:alert(1)']) assert.throws(() => validateBaseUrl(bad, { allowHttp: true }), undefined, bad);
  assert.throws(() => validateBaseUrl('https://u:p4ss@a.example.com'), (e) => !e.message.includes('p4ss'));
  assert.throws(() => validateBaseUrl('https://a.example.com/?token=x'), /\?/);
  assert.throws(() => validateBaseUrl('https://a.example.com/#x'), /#/);
  assert.strictEqual(joinUrl('https://a.example.com/', '/api/v4'), 'https://a.example.com/api/v4');
});

test('redact: トークンとトークンらしいものを消す', () => {
  assert.strictEqual(redact('oops abc123 and abc123', ['abc123']), 'oops *** and ***');
  assert.strictEqual(redact('Authorization: Bearer xyz, ok'), 'Authorization: Bearer ***, ok');
  assert.strictEqual(redact('GET /a?access_token=xyz&b=1'), 'GET /a?access_token=***&b=1');
});

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => { s.closeAllConnections(); s.close(); } }));
  });
}

test('request: JSON を送って受け取る', async (t) => {
  let got;
  const s = await server((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      got = { url: req.url, method: req.method, type: req.headers['content-type'], auth: req.headers.authorization, body };
      res.setHeader('Content-Type', 'application/json');
      res.end('{"id":1}');
    });
  });
  t.after(s.close);
  const r = await request(`${s.url}/x`, { method: 'POST', query: { a: 1, b: undefined }, json: { t: 'v' }, headers: { Authorization: 'Bearer k' } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.data, { id: 1 });
  assert.deepStrictEqual(got, { url: '/x?a=1', method: 'POST', type: 'application/json', auth: 'Bearer k', body: '{"t":"v"}' });
});

test('request: エラーの文にトークンを含めない', async (t) => {
  const s = await server((req, res) => {
    res.statusCode = req.url === '/auth' ? 401 : 500;
    res.end(JSON.stringify({ message: 'bad token sekret-value given' }));
  });
  t.after(s.close);
  await assert.rejects(request(`${s.url}/auth`, { label: 'Fake', secrets: ['sekret-value'] }), (e) => e instanceof HttpError && e.status === 401 && /Fake の認証に失敗/.test(e.message) && !e.message.includes('sekret'));
  await assert.rejects(request(`${s.url}/x`, { secrets: ['sekret-value'] }), (e) => e.status === 500 && !e.message.includes('sekret-value') && /\*\*\*/.test(e.message));
});

test('request: HTML の応答をそのまま文に入れない', async (t) => {
  const s = await server((_req, res) => {
    res.statusCode = 502;
    res.end('<html>secret page</html>');
  });
  t.after(s.close);
  await assert.rejects(request(s.url, { label: 'Fake' }), (e) => /Fake がエラーを返しました（502）$/.test(e.message));
});

test('request: タイムアウトする。接続できないときも分かるエラーにする', async (t) => {
  const s = await server(() => {});
  t.after(s.close);
  await assert.rejects(request(s.url, { timeoutMs: 50, label: 'Fake' }), /Fake から 0 秒以内に返事がありませんでした/);
  await assert.rejects(request('http://127.0.0.1:1/x?token=abc', { label: 'Fake', secrets: ['abc'] }), (e) => /Fake に接続できませんでした/.test(e.message) && !e.message.includes('abc'));
});

test('request: 転送は追わない（トークンを別のホストへ送らない）', async (t) => {
  let hits = 0;
  const other = await server((_req, res) => {
    hits++;
    res.end('{}');
  });
  t.after(other.close);
  const s = await server((_req, res) => {
    res.statusCode = 302;
    res.setHeader('Location', other.url);
    res.end();
  });
  t.after(s.close);
  await assert.rejects(request(s.url, { headers: { 'PRIVATE-TOKEN': 'k' } }), (e) => e.status === 302);
  assert.strictEqual(hits, 0);
});

// ---------- カードの issue ----------

test('古いカードの issue（provider・key なし）はそのまま読める', () => {
  const old = { number: 12, title: 'ログイン', url: 'https://github.com/o/r/issues/12' };
  assert.strictEqual(IssueRef.providerOf(old), 'github');
  assert.strictEqual(IssueRef.keyOf(old), '#12');
  assert.strictEqual(IssueRef.stripKey('#12 ログイン', old), 'ログイン');
  assert.strictEqual(IssueRef.branchPart(old), '12');
  assert.strictEqual(IssueRef.linkLine(old), 'Closes #12');
  assert.deepStrictEqual(IssueRef.cleanIssue(old), { provider: 'github', key: '#12', number: 12, title: 'ログイン', url: old.url });
  assert.ok(IssueRef.sameIssue(old, { provider: 'github', key: '#12' }));
  assert.ok(!IssueRef.sameIssue(old, { provider: 'gitlab', key: '#12' }));
});

test('番号だけで決まらないサービスの issue', () => {
  const x = { provider: 'linear', key: 'ENG-123', title: 'T', url: 'https://l/ENG-123' };
  assert.strictEqual(IssueRef.keyOf(x), 'ENG-123');
  assert.strictEqual(IssueRef.stripKey('ENG-123 T', x), 'T');
  assert.strictEqual(IssueRef.branchPart(x), 'eng-123');
  assert.strictEqual(IssueRef.branchPart({ key: 'a/b#3' }), 'a-b-3');
  assert.strictEqual(IssueRef.linkLine(x), 'ENG-123 https://l/ENG-123');
  assert.strictEqual(IssueRef.linkLine({ ...x, linkLine: 'Fixes ENG-123' }), 'Fixes ENG-123');
  assert.deepStrictEqual(IssueRef.cleanIssue(x), x);
  assert.strictEqual(IssueRef.cleanIssue({ title: 'どちらもない' }), null);
  assert.strictEqual(IssueRef.cleanIssue(null), null);
});

test('サブタスクの issue も、古い形と新しい形のどちらも残る', () => {
  const [a, b] = Subtasks.cleanItems([
    { title: 'a', prompt: 'p', issue: { number: 3, title: 't', url: 'u' } },
    { title: 'b', prompt: 'p', issue: { provider: 'linear', key: 'ENG-1', title: 't', url: 'u' } },
  ]);
  assert.strictEqual(a.issue.number, 3);
  assert.strictEqual(b.issue.key, 'ENG-1');
});

test('保存済みのカードの issue はそのまま動く（題名・コミット・ブランチ・PR）', () => {
  const { store, agents, repo } = setup();
  const c = { id: 'c1', title: '#12 ログイン', prompt: 'p', status: 'review', repoPath: repo, issue: { number: 12, title: 'ログイン', url: 'u' } };
  store.cards.push(c);
  assert.strictEqual(agents.commitMessage(c), 'agent: ログイン (#12)');
  assert.deepStrictEqual(agents.prDefaults(c).body.split('\n').slice(0, 1), ['Closes #12']);
  assert.strictEqual(agents.prDefaults(c).title, 'ログイン');
});

test('プロジェクトの設定の初期値は GitHub で、古い設定もそのまま読める', () => {
  const { store, repo } = setup();
  assert.strictEqual(repoSettingsOf(store.settings, repo).issueProvider, 'github');
  assert.strictEqual(repoSettingsOf({ repoPath: '/a', repoSettings: { '/b': { integration: 'pr' } } }, '/b').issueProvider, 'github');
  assert.strictEqual(repoSettingsOf({ repoPath: '/a', repoSettings: { '/b': { issueProvider: 'linear' } } }, '/b').issueProvider, 'linear');
});

// ---------- プロバイダ経由 ----------

function fakeProvider(t, over = {}) {
  const calls = [];
  const p = mem(t, {
    id: 'fake',
    label: 'Fake',
    parseRefs: (_ctx, text) => String(text).split(/\s+/).filter(Boolean).map((key) => ({ key })),
    fetchIssue: async (_ctx, ref) => ({ key: ref.key, title: `T ${ref.key}`, body: '本文', url: `https://f/${ref.key}`, state: 'open' }),
    ...over,
  });
  return { p, calls };
}

test('プロジェクトで選んだサービスの Issue からカードを作る', async (t) => {
  fakeProvider(t, { linkLine: (ref) => `Refs ${ref.key}` });
  const { store, agents } = setup({ issueProvider: 'fake' });
  const { cards, errors } = await agents.createFromIssues({ numbers: 'ENG-1 ENG-1 ENG-2', agent: 'claude' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(cards.length, 2);
  const [c] = cards;
  assert.strictEqual(c.title, 'ENG-1 T ENG-1');
  assert.deepStrictEqual(c.issue, { provider: 'fake', key: 'ENG-1', title: 'T ENG-1', url: 'https://f/ENG-1', linkLine: 'Refs ENG-1' });
  assert.match(c.prompt, /Fake の Issue ENG-1 を解決してください/);
  assert.strictEqual(agents.commitMessage(c), 'agent: T ENG-1 (ENG-1)');
  assert.ok(agents.prDefaults(c).body.startsWith('Refs ENG-1\n'));
  await assert.rejects(agents.createFromIssues({ numbers: 'ENG-1' }), /ENG-1: もうタスクがあります/);
  assert.strictEqual(store.cards.length, 2);
});

test('使えないサービスを選んでいるときは、分かるエラーにする', async () => {
  const { agents } = setup({ issueProvider: 'gone' });
  await assert.rejects(agents.createFromIssues({ numbers: '1' }), /連携先「gone」は使えません/);
});

test('サブIssue は、サービスが持っていればサブタスクになる', async (t) => {
  fakeProvider(t, { fetchSubIssues: async () => [{ key: 'ENG-2', title: 'sub', url: 'https://f/ENG-2', state: 'open' }, { key: 'ENG-3', title: 'x', state: 'closed' }] });
  const { agents } = setup({ issueProvider: 'fake' });
  const { cards } = await agents.createFromIssues({ numbers: 'ENG-1', agent: 'claude' });
  const [item] = cards[0].subtasks.items;
  assert.strictEqual(cards[0].subtasks.items.length, 1);
  assert.strictEqual(item.key, 'issue-eng-2');
  assert.strictEqual(item.issue.provider, 'fake');
  assert.strictEqual(item.issue.key, 'ENG-2');
});

test('状態同期はサービスの setStatus を呼ぶ。ログは表示用のキーを使う', async (t) => {
  const seen = [];
  fakeProvider(t, { setStatus: async (ctx, ref, key) => (seen.push([ctx.repoPath, ref.key, key]), { updated: [{ to: 'Doing' }], skipped: [{ reason: 'なし' }] }) });
  const { store, agents, repo } = setup();
  const c = { id: 'c1', title: 't', status: 'running', repoPath: repo, issue: { provider: 'fake', key: 'ENG-1' } };
  store.cards.push(c);
  const logs = [];
  agents.log = (_c, kind, text) => logs.push([kind, text]);
  agents.queueIssueSync(c);
  await agents.flushIssueSync();
  assert.deepStrictEqual(seen, [[repo, 'ENG-1', 'inProgress']]);
  assert.deepStrictEqual(logs, [['system', 'Fakeで ENG-1 のステータスを Doing にしました'], ['system', 'Fakeのステータスは変えませんでした: なし']]);
});

test('状態同期: setStatus を持たないサービス・知らないサービスでは何もしない', async (t) => {
  fakeProvider(t);
  const { store, agents, repo } = setup();
  for (const provider of ['fake', 'gone']) {
    const c = { id: provider, title: 't', status: 'running', repoPath: repo, issue: { provider, key: 'ENG-1' } };
    store.cards.push(c);
    agents.queueIssueSync(c);
    await agents.flushIssueSync();
    assert.strictEqual(c.issueSync, undefined);
  }
});

test('状態同期のエラーの文からトークンを消す', async (t) => {
  fakeProvider(t, {
    configFields: [{ name: 'token', type: 'secret', label: 't' }],
    setStatus: async (ctx) => {
      throw new Error(`denied ${ctx.secret('token')}`);
    },
  });
  const { store, agents, repo } = setup();
  agents.trackers = new trackers.Trackers({ store, secrets: { has: () => true, get: () => 'sekret-token' } });
  const c = { id: 'c1', title: 't', status: 'running', repoPath: repo, issue: { provider: 'fake', key: 'ENG-1' } };
  store.cards.push(c);
  const logs = [];
  agents.log = (_c, kind, text) => logs.push(text);
  agents.queueIssueSync(c);
  await agents.flushIssueSync();
  assert.deepStrictEqual(logs, ['Fake のステータスを変えられませんでした: denied ***']);
});

test('コメントはサービスの addComment を呼び、持たないときは何もしない', async (t) => {
  let got = null;
  fakeProvider(t, { addComment: async (_ctx, ref, body) => ((got = [ref.key, body]), { url: 'u' }) });
  const { agents, repo } = setup();
  assert.deepStrictEqual(await agents.addIssueComment({ repoPath: repo, issue: { provider: 'fake', key: 'ENG-1' } }, 'hi'), { url: 'u' });
  assert.deepStrictEqual(got, ['ENG-1', 'hi']);
  assert.strictEqual(await agents.addIssueComment({ repoPath: repo, issue: { provider: 'gone', key: 'X' } }, 'hi'), null);
  assert.strictEqual(await agents.addIssueComment({ repoPath: repo }, 'hi'), null);
});

test('サブIssue を持たないサービスのカードでは、サブIssue を作れない', async (t) => {
  fakeProvider(t);
  const { store, agents, repo } = setup();
  const c = { id: 'c1', title: 't', status: 'review', repoPath: repo, worktreePath: '/w', issue: { provider: 'fake', key: 'ENG-1' }, subtaskProposal: { items: [{ title: 'a', prompt: 'p' }] } };
  store.cards.push(c);
  await assert.rejects(agents.acceptSubtasks('c1', { createIssues: true }), /対応しているサービスだけ/);
});

// ---------- 文言 ----------

test('Issue の指示はサービスの名前を使い、GitHub の文面は変わらない', () => {
  const base = { number: 12, title: 't', url: 'u', body: 'b' };
  assert.ok(buildIssuePrompt(base).startsWith('GitHub の Issue #12 を解決してください。'));
  assert.strictEqual(github.buildIssuePrompt, buildIssuePrompt);
  assert.ok(buildIssuePrompt({ key: 'ENG-1', title: 't', url: 'u' }, '', { label: 'Linear' }).startsWith('Linear の Issue ENG-1 を解決してください。'));
});

test('最初の指示はサービスに依存しない言い方になっている', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'agent.js'), 'utf8');
  assert.ok(!src.includes('GitHub Issue のときは'));
  assert.ok(!src.includes('GitHub Issue 番号'));
});

test('画面の issue の表示は key を使い、無ければ #number', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  assert.ok(!/#\$\{[cx]\.issue\.number\}/.test(src), 'issue.number を直接出している');
  assert.ok(src.indexOf("id: 'github'") > 0);
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.indexOf('issue-ref.js') < html.indexOf('renderer.js'));
  assert.ok(html.indexOf('locales/integrations.js') < html.indexOf('renderer.js'));
});
