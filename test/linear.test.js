// Linear 連携: 識別子と URL の解釈、状態の対応、GraphQL のエラー、書き戻し。fetch をモックする
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const trackers = require('../src/trackers');
const linear = require('../src/trackers/linear');
const IssueRef = require('../renderer/issue-ref');
const I18n = require('../renderer/i18n');
const { Store } = require('../src/store');
const { AgentManager } = require('../src/agent');

const KEY = 'lin_api_sekret123';
const STATES = [
  { id: 's-backlog', name: 'Backlog', type: 'backlog', position: 0 },
  { id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 's-review', name: 'In Review', type: 'started', position: 3 },
  { id: 's-progress', name: 'In Progress', type: 'started', position: 2 },
  { id: 's-done', name: 'Done', type: 'completed', position: 4 },
  { id: 's-cancel', name: 'Canceled', type: 'canceled', position: 5 },
];

// fetch を差し替える。answer(body, n) が返した値を JSON で返す（Response を返せばそのまま）
function mockFetch(t, answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), init, ...body });
    const r = await answer(body, calls.length - 1);
    return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => (globalThis.fetch = real));
  return calls;
}

const ctx = (settings = {}) => ({ provider: 'linear', settings, secret: () => KEY });
const issueNode = (over = {}) => ({ id: 'uuid-1', identifier: 'ENG-123', title: 'ログイン', description: '本文', url: 'https://linear.app/acme/issue/ENG-123/login', state: { id: 's-todo', name: 'Todo', type: 'unstarted' }, labels: { nodes: [{ name: 'bug' }] }, ...over });
const withStates = (state) => ({ data: { issue: { id: 'uuid-1', state, team: { id: 't1', name: 'Engineering', states: { nodes: STATES } } } } });

function setup(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-linear-'));
  const store = new Store(path.join(dir, 'board.json'));
  store.settings.repoPath = dir;
  Object.assign(store.settings, settings);
  const list = new trackers.Trackers({ store, secrets: { has: () => true, get: () => KEY } });
  const agents = new AgentManager(store, { mcpScript: '', mcpDir: path.join(dir, 'mcp'), nodeBin: process.execPath, trackers: list });
  return { store, agents, repo: dir, list };
}

// ---------- 識別子と URL ----------

test('登録されていて、共通の形を持つ', () => {
  assert.strictEqual(trackers.get('linear'), linear);
  const meta = trackers.issueProviderMeta().find((p) => p.id === 'linear');
  assert.strictEqual(meta.canSync, true);
  assert.strictEqual(meta.canSubIssue, true);
  assert.strictEqual(meta.canComment, true);
  assert.strictEqual(trackers.issueProviderMeta().find((p) => p.id === 'github').canComment, false);
  assert.deepStrictEqual(linear.configFields.map((f) => [f.name, f.type]), [['apiKey', 'secret']]);
});

test('識別子と URL を読む', () => {
  const keys = (s) => linear.parseRefs({}, s).map((r) => r.key);
  assert.deepStrictEqual(keys('ENG-123'), ['ENG-123']);
  assert.deepStrictEqual(keys('eng-123, A1-2、T_X-9'), ['ENG-123', 'A1-2', 'T_X-9']);
  assert.deepStrictEqual(keys('https://linear.app/acme/issue/ENG-123/fix-login'), ['ENG-123']);
  assert.deepStrictEqual(keys('https://linear.app/acme/issue/eng-123'), ['ENG-123']);
  assert.deepStrictEqual(keys('linear.app/acme/issue/ENG-5/x?y=1#comment-a'), ['ENG-5']);
});

test('読めない入力は例外にする', () => {
  for (const s of ['123', 'ENG', 'ENG-0', '-1', 'ENG-1 abc', 'https://example.com/acme/issue/ENG-1', 'https://linear.app/acme/project/ENG-1', 'https://linear.app.evil.test/acme/issue/ENG-1']) {
    assert.throws(() => linear.parseRefs({}, s), /Linear の Issue として読めません/, s);
  }
});

test('同じ Issue は1つにまとまる', async () => {
  const { list, repo } = setup();
  const refs = await list.parseRefs('linear', repo, 'ENG-1 eng-1 https://linear.app/a/issue/ENG-1/x');
  assert.deepStrictEqual(refs.map((r) => [r.provider, r.key]), [['linear', 'ENG-1']]);
});

test('ブランチ名と PR の本文に識別子が入る', () => {
  assert.strictEqual(IssueRef.branchPart({ provider: 'linear', key: 'ENG-123' }), 'eng-123');
  assert.strictEqual(linear.linkLine({ key: 'ENG-123', url: 'https://linear.app/a/issue/ENG-123/x' }), 'Ref ENG-123 https://linear.app/a/issue/ENG-123/x');
});

// ---------- 読み取り ----------

test('Issue を読む。API キーはそのまま Authorization に入れ、コメントは古い順にする', async (t) => {
  const comments = { nodes: [
    { body: 'b', createdAt: '2026-02-01T00:00:00Z', user: null, botActor: { name: 'Bot' } },
    { body: 'a', createdAt: '2026-01-01T00:00:00Z', user: { displayName: 'kaz', name: 'Kaz' } },
    { body: 'c', createdAt: '2026-03-01T00:00:00Z', user: null, botActor: null },
  ] };
  const calls = mockFetch(t, () => ({ data: { issue: issueNode({ comments }) } }));
  const x = await linear.fetchIssue(ctx(), { key: 'ENG-123' });
  assert.strictEqual(calls[0].url, 'https://api.linear.app/graphql');
  assert.strictEqual(calls[0].init.headers.Authorization, KEY);
  assert.deepStrictEqual(calls[0].variables, { id: 'ENG-123' });
  assert.deepStrictEqual(x, { key: 'ENG-123', title: 'ログイン', body: '本文', url: 'https://linear.app/acme/issue/ENG-123/login', state: 'open', labels: ['bug'], comments: [{ author: 'kaz', body: 'a' }, { author: 'Bot', body: 'b' }, { author: 'Linear', body: 'c' }] });
});

test('完了とキャンセルの Issue は closed、本文が無ければ空', async (t) => {
  let type = 'completed';
  mockFetch(t, () => ({ data: { issue: issueNode({ description: null, state: { id: 'x', name: 'x', type } }) } }));
  const a = await linear.fetchIssue(ctx(), { key: 'ENG-1' });
  assert.strictEqual(a.state, 'closed');
  assert.strictEqual(a.body, '');
  type = 'canceled';
  assert.strictEqual((await linear.fetchIssue(ctx(), { key: 'ENG-1' })).state, 'closed');
});

test('サブIssue の一覧', async (t) => {
  mockFetch(t, () => ({ data: { issue: { id: 'uuid-1', children: { nodes: [issueNode({ identifier: 'ENG-2' }), issueNode({ identifier: 'ENG-3', state: { id: 'd', name: 'Done', type: 'completed' } })] } } } }));
  const subs = await linear.fetchSubIssues(ctx(), { key: 'ENG-1' });
  assert.deepStrictEqual(subs.map((x) => [x.key, x.state]), [['ENG-2', 'open'], ['ENG-3', 'closed']]);
});

test('サブIssue を作ると、親のチームとプロジェクトにぶら下がる', async (t) => {
  const calls = mockFetch(t, (b) => (b.query.includes('issueCreate') ? { data: { issueCreate: { success: true, issue: { identifier: 'ENG-9', title: 'sub', url: 'https://linear.app/a/issue/ENG-9' } } } } : { data: { issue: { id: 'uuid-1', team: { id: 't1' }, project: { id: 'p1' } } } }));
  const made = await linear.createSubIssue(ctx(), { key: 'ENG-1' }, { title: 'sub', body: '指示' });
  assert.deepStrictEqual(made, { key: 'ENG-9', title: 'sub', url: 'https://linear.app/a/issue/ENG-9' });
  assert.deepStrictEqual(calls[1].variables.input, { teamId: 't1', parentId: 'uuid-1', title: 'sub', description: '指示', projectId: 'p1' });
});

test('コメントを書く', async (t) => {
  const calls = mockFetch(t, (b) => (b.query.includes('commentCreate') ? { data: { commentCreate: { success: true, comment: { url: 'https://linear.app/c' } } } } : { data: { issue: { id: 'uuid-1', team: { id: 't1' }, project: null } } }));
  assert.deepStrictEqual(await linear.addComment(ctx(), { key: 'ENG-1' }, 'こんにちは'), { url: 'https://linear.app/c' });
  assert.deepStrictEqual(calls[1].variables.input, { issueId: 'uuid-1', body: 'こんにちは' });
});

// ---------- 状態の対応 ----------

test('状態の型で既定の対応を決める', () => {
  const pick = (key, states = STATES) => (linear._pickState(states, key, '') || {}).name;
  assert.strictEqual(pick('inProgress'), 'In Progress');
  assert.strictEqual(pick('inReview'), 'In Review');
  assert.strictEqual(pick('done'), 'Done');
  const custom = [{ id: 'a', name: 'Doing now', type: 'started', position: 1 }, { id: 'b', name: 'QA', type: 'started', position: 2 }, { id: 'c', name: 'Shipped', type: 'completed', position: 3 }];
  assert.strictEqual(pick('inProgress', custom), 'Doing now');
  assert.strictEqual(pick('inReview', custom), 'Doing now', 'レビューの状態が無ければ開始済みのまま');
  assert.strictEqual(pick('done', custom), 'Shipped');
  assert.strictEqual(pick('inProgress', [{ id: 'r', name: 'In Review', type: 'started' }]), 'In Review');
  assert.strictEqual(pick('done', [{ id: 'a', name: 'Doing', type: 'started' }]), undefined);
});

test('名前を指定すると、その名前だけを選ぶ（大文字小文字や記号は無視し、複数書ける）', () => {
  assert.strictEqual(linear._pickState(STATES, 'inReview', '🏗 todo').name, 'Todo');
  assert.strictEqual(linear._pickState(STATES, 'done', 'Nope, canceled').name, 'Canceled');
  assert.strictEqual(linear._pickState(STATES, 'done', 'Nope'), null);
});

test('状態を変えて、前の状態も返す', async (t) => {
  const calls = mockFetch(t, (b) => (b.query.includes('issueUpdate') ? { data: { issueUpdate: { success: true } } } : withStates({ id: 's-todo', name: 'Todo', type: 'unstarted' })));
  const r = await linear.setStatus(ctx(), { key: 'ENG-1' }, 'inProgress');
  assert.deepStrictEqual(r, { updated: [{ from: 'Todo', to: 'In Progress' }], skipped: [], projects: 1 });
  assert.deepStrictEqual(calls[1].variables, { id: 'uuid-1', stateId: 's-progress' });
});

test('同じ状態なら書き込まない', async (t) => {
  const calls = mockFetch(t, () => withStates({ id: 's-review', name: 'In Review', type: 'started' }));
  const r = await linear.setStatus(ctx(), { key: 'ENG-1' }, 'inReview');
  assert.deepStrictEqual(r.updated, []);
  assert.strictEqual(calls.length, 1);
});

test('プロジェクト設定の名前を使い、無ければ理由を返す', async (t) => {
  const calls = mockFetch(t, (b) => (b.query.includes('issueUpdate') ? { data: { issueUpdate: { success: true } } } : withStates({ id: 's-todo', name: 'Todo', type: 'unstarted' })));
  const a = await linear.setStatus(ctx({ statusMapping: { done: 'Canceled' } }), { key: 'ENG-1' }, 'done');
  assert.strictEqual(a.updated[0].to, 'Canceled');
  const before = calls.length;
  const b = await linear.setStatus(ctx({ statusMapping: { done: 'Nope' } }), { key: 'ENG-1' }, 'done');
  assert.match(b.skipped[0].reason, /チーム「Engineering」に、設定した状態「Nope」がありません/);
  assert.strictEqual(calls.length, before + 1, '変更は送らない');
});

test('受け付けられなかった変更はエラーにする', async (t) => {
  mockFetch(t, (b) => (b.query.includes('issueUpdate') ? { data: { issueUpdate: { success: false } } } : withStates({ id: 's-todo', name: 'Todo', type: 'unstarted' })));
  await assert.rejects(linear.setStatus(ctx(), { key: 'ENG-1' }, 'done'), /Linear が変更を受け付けませんでした/);
});

// ---------- エラー ----------

test('GraphQL のエラーを分かる文言にする', async (t) => {
  let errors;
  mockFetch(t, () => ({ errors, data: null }));
  const fails = (re) => assert.rejects(linear.fetchIssue(ctx(), { key: 'ENG-404' }), re);
  errors = [{ message: 'Entity not found: Issue', extensions: { type: 'invalid input' } }];
  await fails(/Linear に ENG-404 が見つかりません/);
  errors = [{ message: 'nope', extensions: { code: 'AUTHENTICATION_ERROR' } }];
  await fails(/Linear の認証に失敗しました/);
  errors = [{ message: 'no', extensions: { code: 'FORBIDDEN', userPresentableMessage: 'チームに入っていません' } }];
  await fails(/権限がありません: チームに入っていません/);
  errors = [{ message: 'boom\ntrace' }];
  await assert.rejects(linear.fetchIssue(ctx(), { key: 'ENG-1' }), (e) => e.message === 'Linear がエラーを返しました: boom');
});

test('Issue が null で返ってきても見つからないと分かる', async (t) => {
  mockFetch(t, () => ({ data: { issue: null } }));
  await assert.rejects(linear.fetchIssue(ctx(), { key: 'ENG-404' }), /ENG-404 が見つかりません/);
});

test('レート制限は待ち時間つきで知らせる', async (t) => {
  const limited = (headers, status = 429) => new Response(JSON.stringify({ errors: [{ message: 'too many', extensions: { code: 'RATELIMITED' } }] }), { status, headers });
  let res;
  mockFetch(t, () => res());
  res = () => limited({ 'Retry-After': '90' });
  await assert.rejects(linear.fetchIssue(ctx(), { key: 'ENG-1' }), /レート制限に達しました。約 2 分後/);
  res = () => limited({ 'X-RateLimit-Requests-Remaining': '0', 'X-RateLimit-Requests-Reset': String(Date.now() + 240000) }, 400);
  await assert.rejects(linear.fetchIssue(ctx(), { key: 'ENG-1' }), /約 4 分後/);
  res = () => limited({});
  await assert.rejects(linear.fetchIssue(ctx(), { key: 'ENG-1' }), /しばらく待って/);
});

test('HTTP の認証エラーは土台の文言のまま', async (t) => {
  mockFetch(t, () => new Response('{}', { status: 401 }));
  await assert.rejects(linear.fetchIssue(ctx(), { key: 'ENG-1' }), /Linear の認証に失敗しました（401）/);
});

test('API キーが無ければ、呼ばずに案内する', async (t) => {
  const calls = mockFetch(t, () => ({}));
  await assert.rejects(linear.fetchIssue({ secret: () => '' }, { key: 'ENG-1' }), /設定の「連携」で API キーを入れて/);
  assert.deepStrictEqual(await linear.testConnection({ secret: () => '' }), { ok: false, message: 'API キーを入れてください' });
  assert.strictEqual(calls.length, 0);
});

test('エラーの文に API キーが出ない', async (t) => {
  const { list, repo } = setup({ issueProvider: 'linear' });
  const leak = `bad key ${KEY}`;
  let res;
  mockFetch(t, () => res());
  const noLeak = (e) => !e.message.includes(KEY);
  res = () => ({ errors: [{ message: leak }] });
  await assert.rejects(list.call('linear', 'fetchIssue', { repoPath: repo }, { key: 'ENG-1' }), noLeak);
  res = () => ({ errors: [{ message: 'x', extensions: { code: 'FORBIDDEN', userPresentableMessage: leak } }] });
  await assert.rejects(list.call('linear', 'fetchIssue', { repoPath: repo }, { key: 'ENG-1' }), noLeak);
  res = () => new Response(JSON.stringify({ message: leak }), { status: 500 });
  await assert.rejects(list.call('linear', 'fetchIssue', { repoPath: repo }, { key: 'ENG-1' }), noLeak);
  res = () => {
    throw new Error(`socket ${KEY}`);
  };
  await assert.rejects(list.call('linear', 'fetchIssue', { repoPath: repo }, { key: 'ENG-1' }), noLeak);
  res = () => ({ errors: [{ message: leak }] });
  const r = await list.call('linear', 'testConnection', {});
  assert.strictEqual(r.ok, false);
  assert.ok(!r.message.includes(KEY));
});

test('接続テストはユーザー名を返す', async (t) => {
  mockFetch(t, () => ({ data: { viewer: { displayName: 'kaz', name: 'Kaz' } } }));
  assert.deepStrictEqual(await linear.testConnection(ctx()), { ok: true, message: 'kaz として接続できました' });
});

// ---------- カードとの組み合わせ ----------

test('Issue からカードを作る: 指示・ブランチの材料・PR の本文', async (t) => {
  mockFetch(t, (b) => (b.query.includes('children') ? { data: { issue: { id: 'uuid-1', children: { nodes: [] } } } } : { data: { issue: issueNode({ comments: { nodes: [{ body: '再現手順', createdAt: '2026-01-01', user: { displayName: 'kaz' } }] } }) } }));
  const { agents, store } = setup({ issueProvider: 'linear' });
  const { cards } = await agents.createFromIssues({ numbers: 'https://linear.app/acme/issue/ENG-123/login', agent: 'claude' });
  const [c] = cards;
  assert.strictEqual(c.title, 'ENG-123 ログイン');
  assert.match(c.prompt, /Linear の Issue ENG-123 を解決してください/);
  assert.match(c.prompt, /## 本文\n本文/);
  assert.match(c.prompt, /### @kaz\n再現手順/);
  assert.strictEqual(IssueRef.branchPart(c.issue), 'eng-123');
  assert.ok(agents.prDefaults(c).body.startsWith('Ref ENG-123 https://linear.app/acme/issue/ENG-123/login\n'));
  assert.ok(!JSON.stringify(store.data).includes(KEY));
  await agents.flushIssueSync();
});

test('サブタスクの提案から、Linear のサブIssue を作れる', async (t) => {
  mockFetch(t, (b) => (b.query.includes('issueCreate') ? { data: { issueCreate: { success: true, issue: { identifier: 'ENG-9', title: b.variables.input.title, url: 'https://linear.app/a/issue/ENG-9' } } } } : { data: { issue: { id: 'uuid-1', team: { id: 't1' }, project: null } } }));
  const { agents, store, repo } = setup({ issueProvider: 'linear', issueStatusSync: false });
  const c = { id: 'c1', title: 'ENG-1 親', status: 'review', repoPath: repo, worktreePath: repo, branch: 'agent/issue-eng-1-c1', issue: { provider: 'linear', key: 'ENG-1' }, subtaskProposal: { items: [{ key: 'a', title: '子', prompt: '指示' }] } };
  store.cards.push(c);
  agents.advanceSubtasks = async () => {};
  await agents.acceptSubtasks('c1', { createIssues: true });
  assert.strictEqual(c.subtasks.items[0].issue.key, 'ENG-9');
  assert.strictEqual(c.subtasks.items[0].issue.provider, 'linear');
  assert.match(c.subtasks.items[0].issue.linkLine, /^Ref ENG-9 /);
});

function commentSetup(t, settings = {}) {
  const sent = [];
  const fail = { on: false };
  mockFetch(t, (b) => {
    if (b.query.includes('commentCreate')) {
      if (fail.on) return { errors: [{ message: `失敗 ${KEY}` }] };
      sent.push(b.variables.input.body);
      return { data: { commentCreate: { success: true, comment: { url: 'u' } } } };
    }
    if (b.query.includes('team { id name')) return withStates({ id: 's-todo', name: 'Todo', type: 'unstarted' });
    if (b.query.includes('issueUpdate')) return { data: { issueUpdate: { success: true } } };
    return { data: { issue: { id: 'uuid-1', team: { id: 't1' }, project: null } } };
  });
  const s = setup({ issueProvider: 'linear', ...settings });
  const c = { id: 'c1', title: 'ENG-1 t', status: 'queued', repoPath: s.repo, branch: 'agent/issue-eng-1-c1', logs: [], issue: { provider: 'linear', key: 'ENG-1' } };
  s.store.cards.push(c);
  return { ...s, c, sent, fail };
}

test('開始・PR・完了のときに1回ずつコメントする', async (t) => {
  const { agents, c, sent } = commentSetup(t);
  c.status = 'running';
  agents.changed(c);
  agents.changed(c);
  await agents.flushIssueSync();
  assert.deepStrictEqual(sent, ['Worktree Kanban でタスクを開始しました（ブランチ: agent/issue-eng-1-c1）']);
  c.status = 'review';
  c.prUrl = 'https://github.com/o/r/pull/1';
  agents.changed(c);
  agents.changed(c);
  await agents.flushIssueSync();
  assert.strictEqual(sent[1], 'PR を作成しました: https://github.com/o/r/pull/1');
  c.status = 'done';
  c.prMergedAt = 1;
  agents.changed(c);
  agents.changed(c);
  await agents.flushIssueSync();
  assert.deepStrictEqual(sent.slice(2), ['Worktree Kanban のタスクが完了しました']);
});

test('PR を作って片付けただけでは、完了のコメントを書かない', async (t) => {
  const { agents, c, sent } = commentSetup(t);
  c.status = 'done';
  c.prUrl = 'https://github.com/o/r/pull/1';
  agents.changed(c);
  await agents.flushIssueSync();
  assert.deepStrictEqual(sent, ['PR を作成しました: https://github.com/o/r/pull/1']);
});

test('設定で切れる。切っているあいだの出来事は、あとから書かない', async (t) => {
  const { agents, store, c, sent } = commentSetup(t, { issueComments: false });
  c.status = 'running';
  agents.changed(c);
  await agents.flushIssueSync();
  assert.deepStrictEqual(sent, []);
  store.settings.issueComments = true;
  agents.changed(c);
  await agents.flushIssueSync();
  assert.deepStrictEqual(sent, []);
});

test('コメントの失敗はカードのログに出し、API キーは出さない', async (t) => {
  const { agents, c, fail } = commentSetup(t);
  fail.on = true;
  c.status = 'running';
  agents.changed(c);
  await agents.flushIssueSync();
  const msg = c.logs.filter((l) => l.kind === 'error' || l.type === 'error').map((l) => l.text).join('\n');
  assert.match(msg, /ENG-1 にコメントできませんでした/);
  assert.ok(!JSON.stringify(c.logs).includes(KEY));
});

test('状態同期の結果がカードのログに出る', async (t) => {
  const { agents, c } = commentSetup(t, { issueComments: false });
  c.status = 'running';
  agents.changed(c);
  await agents.flushIssueSync();
  assert.match(JSON.stringify(c.logs), /Linearで ENG-1 のステータスを In Progress にしました（前は Todo）/);
});

test('GitHub のカードにはコメントを書かない', async () => {
  const { agents, store, repo } = setup();
  let called = 0;
  agents.addIssueComment = async () => called++;
  agents.setIssueProjectStatus = async () => ({ updated: [], skipped: [] });
  const c = { id: 'c1', title: 't', status: 'running', repoPath: repo, prUrl: 'https://github.com/o/r/pull/1', logs: [], issue: { number: 12, title: 't', url: 'u' } };
  store.cards.push(c);
  agents.changed(c);
  await agents.flushIssueSync();
  assert.strictEqual(called, 0);
  assert.strictEqual(c.issueCommented, undefined);
});

// ---------- 訳 ----------

test('画面に出す言葉に訳がある', () => {
  const source = fs.readFileSync(require.resolve('../src/trackers/linear'), 'utf8');
  const keys = [...source.matchAll(/tr\('([^']+)'/g)].map((m) => m[1]);
  keys.push(linear.refPlaceholder, linear.statusHelp, ...linear.configFields.flatMap((f) => [f.label, f.help]));
  assert.ok(keys.length > 10);
  const lang = I18n.getLanguage();
  I18n.setLanguage('en');
  try {
    for (const k of keys) assert.ok(!/[ぁ-んァ-ヶ]/.test(I18n.tr(k)), k);
  } finally {
    I18n.setLanguage(lang);
  }
});
