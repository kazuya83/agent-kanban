// GitLab 連携: fetch を差し替えて、API の呼び方と、カードの動きへのつながりを確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const trackers = require('../src/trackers');
const gitlab = require('../src/trackers/gitlab');
const { buildIssuePrompt } = require('../src/trackers/prompt');
const IssueRef = require('../renderer/issue-ref');
const I18n = require('../renderer/i18n');
const { Store } = require('../src/store');
const { AgentManager } = require('../src/agent');

const TOKEN = 'glpat-super-secret-value';
const BASE = 'https://gitlab.example.com';
const API = `${BASE}/api/v4`;
const P = 'projects/grp%2Fsub%2Fproj';
const FAKE = path.join(__dirname, 'fake-claude.js');

// routes: { 'GET /api/v4/x': 応答 | (req) => 応答 }。応答は JSON にする値か { status, json }。呼ばれた順に calls へ残す
function mockFetch(t, routes) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const raw = `${opts.method || 'GET'} ${u.pathname}`;
    const req = { url: u, method: opts.method || 'GET', headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : undefined };
    calls.push(req);
    const route = routes[raw];
    if (route === undefined) return new Response(JSON.stringify({ message: '404 Not found' }), { status: 404 });
    const r = typeof route === 'function' ? route(req) : route;
    if (r && r.status) return new Response(JSON.stringify(r.json ?? {}), { status: r.status });
    return new Response(JSON.stringify(r), { status: 200 });
  };
  t.after(() => (global.fetch = real));
  return calls;
}

function fakeSecrets(values = { 'tracker:gitlab:token': TOKEN }) {
  const m = new Map(Object.entries(values));
  return { has: (k) => m.has(k), get: (k) => m.get(k) || '', set: (k, v) => m.set(k, v), delete: (k) => m.delete(k) };
}

function makeRepo(originUrl = `${BASE}/grp/sub/proj.git`) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-gitlab-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo }).toString().trim();
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  g('remote', 'add', 'origin', originUrl);
  return { tmp, repo, g };
}

function setup({ origin, config = {} } = {}) {
  const { tmp, repo, g } = makeRepo(origin);
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  store.settings.repoPath = repo;
  store.settings.trackerConfigs = { gitlab: { baseUrl: BASE, ...config } };
  const list = new trackers.Trackers({ store, secrets: fakeSecrets() });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath, trackers: list });
  store.setRepoSettings(repo, { issueProvider: 'gitlab' });
  return { tmp, repo, g, store, agents, list };
}

const call = (s, method, ...args) => s.list.call('gitlab', method, { repoPath: s.repo }, ...args);
const issueData = (over = {}) => ({ id: 900, iid: 12, title: 'ログイン', description: '本文', web_url: `${BASE}/grp/sub/proj/-/issues/12`, state: 'opened', labels: ['bug'], ...over });

function waitFor(pred, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = pred();
      if (!v && Date.now() - t0 <= ms) return;
      clearInterval(iv);
      if (v) resolve(v);
      else reject(new Error('timeout'));
    }, 20);
  });
}

// ---------- リモート URL ----------

test('origin の URL を読む: HTTPS・SSH・サブグループ', () => {
  const read = gitlab.parseGitlabRemote;
  for (const u of ['https://gitlab.com/group/proj.git', 'https://gitlab.com/group/proj', 'https://gitlab.com/group/proj/', 'git@gitlab.com:group/proj.git', 'ssh://git@gitlab.com/group/proj.git']) {
    assert.deepStrictEqual(read(u), { host: 'gitlab.com', path: 'group/proj' }, u);
  }
  assert.strictEqual(read('git@gitlab.com:a/b/c/proj.git').path, 'a/b/c/proj');
  assert.strictEqual(read('https://GitLab.com/a/b/proj.git').path, 'a/b/proj');
  assert.strictEqual(read('https://oauth2:pass@gitlab.com/a/proj.git').path, 'a/proj');
});

test('セルフホストは、設定の URL のホストと照合する', () => {
  const read = gitlab.parseGitlabRemote;
  assert.strictEqual(read('git@git.corp.example:team/proj.git', 'https://git.corp.example').path, 'team/proj');
  assert.strictEqual(read('ssh://git@git.corp.example:2222/team/proj.git', 'https://git.corp.example:8443').path, 'team/proj', 'SSH と Web でポートが違ってもよい');
  assert.strictEqual(read('https://corp.example/gitlab/team/proj.git', 'https://corp.example/gitlab').path, 'team/proj', 'サブパスのインストール');
  assert.strictEqual(read('git@git.corp.example:team/proj.git'), null, '既定の接続先とは違う');
  assert.strictEqual(read('git@gitlab.com:team/proj.git', 'https://git.corp.example'), null);
  assert.strictEqual(read('https://github.com/o/r.git', 'https://gitlab.com'), null);
  assert.strictEqual(read('https://gitlab.com/only-one'), null);
  assert.strictEqual(read('/srv/git/proj.git'), null);
  assert.strictEqual(read(''), null);
});

test('origin からサービスと MR を推定する。GitHub はこれまでどおり', () => {
  const { list, store } = setup();
  assert.strictEqual(list.guessFromRemote(`${BASE}/g/p.git`), 'gitlab');
  assert.strictEqual(list.codeHostOf('git@gitlab.example.com:g/p.git'), 'gitlab');
  assert.strictEqual(list.guessFromRemote('https://github.com/o/r.git'), 'github');
  assert.strictEqual(list.codeHostOf('https://github.com/o/r.git'), '');
  assert.strictEqual(list.codeHostOf('https://gitlab.com/g/p.git'), '', '接続先を変えたら gitlab.com は別のサーバー');
  store.settings.trackerConfigs = {};
  assert.strictEqual(list.codeHostOf('https://gitlab.com/g/p.git'), 'gitlab', '既定は gitlab.com');
});

test('設定: トークンは secret で、値は画面に渡らない', () => {
  const { list } = setup();
  const row = list.publicOne('gitlab');
  assert.strictEqual(row.configured, true);
  assert.strictEqual(row.config.baseUrl, BASE);
  assert.strictEqual(row.secrets.token, true);
  assert.ok(!JSON.stringify(row).includes(TOKEN));
  assert.throws(() => list.save('gitlab', { config: { baseUrl: 'http://gitlab.local' } }), /http/);
  assert.strictEqual(list.save('gitlab', { config: { baseUrl: 'http://gitlab.local', allowHttp: true }, secrets: { token: 'new' } }).config.baseUrl, 'http://gitlab.local');
});

// ---------- Issue ----------

test('番号・URL から Issue の参照を作る。origin のプロジェクトは同じ key にそろえる', async () => {
  const s = setup();
  const refs = await s.list.parseRefs('gitlab', s.repo, `12, #12 ${BASE}/grp/sub/proj/-/issues/12 ${BASE}/GRP/sub/proj/-/work_items/15#note_1 ${BASE}/other/x/-/issues/3 other/x#4`);
  assert.deepStrictEqual(refs.map((r) => r.key), ['#12', '#15', 'other/x#3', 'other/x#4']);
  assert.strictEqual(refs[2].number, 3);
  assert.strictEqual(refs[0].provider, 'gitlab');
  await assert.rejects(s.list.parseRefs('gitlab', s.repo, 'abc'), /Issue 番号として読めません/);
  await assert.rejects(s.list.parseRefs('gitlab', s.repo, 'https://evil.example/grp/proj/-/issues/1'), /読めません/, '別のサーバーの URL');
  const err = await s.list.parseRefs('gitlab', s.repo, 'x?private_token=abc').catch((e) => e);
  assert.ok(!err.message.includes('private_token=abc'), err.message);
});

test('origin が接続先と違うときは、URL を文に入れずに断る', async () => {
  const s = setup({ origin: 'https://user:hunter2@elsewhere.example/g/p.git' });
  const err = await s.list.parseRefs('gitlab', s.repo, '12').catch((e) => e);
  assert.match(err.message, /gitlab\.example\.com のリポジトリではありません/);
  assert.ok(!err.message.includes('hunter2'));
});

test('Issue を読む: システムノートを除き、古い順に指示へ入れる', async (t) => {
  const s = setup();
  const calls = mockFetch(t, {
    [`GET /api/v4/${P}/issues/12`]: issueData(),
    [`GET /api/v4/${P}/issues/12/notes`]: [
      { id: 3, system: false, author: { username: 'bob' }, body: '2つ目' },
      { id: 2, system: true, author: { username: 'bot' }, body: 'changed the description' },
      { id: 1, system: false, author: { username: 'alice' }, body: '1つ目' },
    ],
  });
  const issue = await call(s, 'fetchIssue', { key: '#12', number: 12 });
  assert.strictEqual(issue.state, 'open');
  assert.deepStrictEqual(issue.comments, [{ author: 'alice', body: '1つ目' }, { author: 'bob', body: '2つ目' }]);
  assert.strictEqual(calls[0].headers['PRIVATE-TOKEN'], TOKEN);
  assert.strictEqual(calls[1].url.searchParams.get('sort'), 'desc', 'コメントが多いときは新しいほうを取る');
  const prompt = buildIssuePrompt(issue, '', { label: 'GitLab' });
  assert.match(prompt, /GitLab の Issue #12 を解決してください/);
  assert.match(prompt, /ラベル: bug/);
  assert.ok(prompt.indexOf('1つ目') < prompt.indexOf('2つ目'));
  assert.ok(!prompt.includes('changed the description'));
});

test('Issue が無いときは分かる文で知らせる。ほかのプロジェクトの Issue も読める', async (t) => {
  const s = setup();
  const calls = mockFetch(t, { 'GET /api/v4/projects/other%2Fx/issues/3': issueData({ iid: 3, state: 'closed' }) });
  await assert.rejects(call(s, 'fetchIssue', { key: '#99', number: 99 }), /Issue #99 が見つかりません（grp\/sub\/proj）/);
  const other = await call(s, 'fetchIssue', { key: 'other/x#3', number: 3 });
  assert.strictEqual(other.key, 'other/x#3');
  assert.strictEqual(other.state, 'closed');
  assert.ok(calls.some((c) => c.url.pathname === '/api/v4/projects/other%2Fx/issues/3/notes'));
});

test('Issue からタスクを作ると、MR の本文に Closes が入る', async (t) => {
  const s = setup();
  mockFetch(t, { [`GET /api/v4/${P}/issues/12`]: issueData(), [`GET /api/v4/${P}/issues/12/notes`]: [] });
  s.agents.fetchSubIssues = async () => [];
  const { cards } = await s.agents.createFromIssues({ numbers: '12' });
  const c = cards[0];
  assert.strictEqual(c.title, '#12 ログイン');
  assert.strictEqual(c.issue.provider, 'gitlab');
  assert.strictEqual(IssueRef.linkLine(c.issue), 'Closes #12');
  c.lastMessage = '直しました';
  const def = s.agents.prDefaults(c);
  assert.strictEqual(def.title, 'ログイン');
  assert.strictEqual(def.body.split('\n')[0], 'Closes #12');
  assert.strictEqual(gitlab.linkLine({ key: 'other/x#3' }), 'Closes other/x#3');
  assert.strictEqual(IssueRef.branchPart({ key: 'other/x#3' }), 'other-x-3');
});

// ---------- 状態 ----------

function statusRoutes(start) {
  const issue = { ...issueData(), ...start };
  const puts = [];
  return {
    puts,
    routes: {
      [`GET /api/v4/${P}/issues/12`]: () => issue,
      [`PUT /api/v4/${P}/issues/12`]: (req) => {
        puts.push(req.body);
        const b = req.body;
        issue.labels = [...issue.labels.filter((l) => !String(b.remove_labels || '').split(',').includes(l)), ...(b.add_labels ? [b.add_labels] : [])];
        if (b.state_event) issue.state = b.state_event === 'close' ? 'closed' : 'opened';
        return issue;
      },
    },
  };
}

test('カードの状態をラベルと open / close に対応させる', async (t) => {
  const s = setup();
  const { puts, routes } = statusRoutes({ labels: ['bug'] });
  mockFetch(t, routes);
  const ref = { key: '#12', number: 12 };
  assert.deepStrictEqual((await call(s, 'setStatus', ref, 'inProgress')).updated, [{ from: '', to: 'In progress' }]);
  assert.deepStrictEqual(puts[0], { add_labels: 'In progress' });
  assert.deepStrictEqual((await call(s, 'setStatus', ref, 'inReview')).updated, [{ from: 'In progress', to: 'In review' }]);
  assert.deepStrictEqual(puts[1], { add_labels: 'In review', remove_labels: 'In progress' });
  await call(s, 'setStatus', ref, 'done');
  assert.deepStrictEqual(puts[2], { add_labels: 'Done', remove_labels: 'In review', state_event: 'close' });
  // 閉じた Issue でまた動き出したら、開き直す
  await call(s, 'setStatus', ref, 'inProgress');
  assert.deepStrictEqual(puts[3], { add_labels: 'In progress', remove_labels: 'Done', state_event: 'reopen' });
  // 変えるものがなければ書かない
  const same = await call(s, 'setStatus', ref, 'inProgress');
  assert.strictEqual(puts.length, 4);
  assert.deepStrictEqual(same.updated, []);
  assert.strictEqual(same.projects, 1);
  await assert.rejects(call(s, 'setStatus', ref, 'nope'), /不明なステータス/);
});

test('ラベルの名前はプロジェクトの設定で変えられる。空なら既定', async (t) => {
  const s = setup();
  s.store.setRepoSettings(s.repo, { statusMapping: { inProgress: 'workflow::doing', inReview: '', done: '' } });
  const { puts, routes } = statusRoutes({ labels: ['In review'] });
  mockFetch(t, routes);
  await call(s, 'setStatus', { key: '#12', number: 12 }, 'inProgress');
  assert.deepStrictEqual(puts[0], { add_labels: 'workflow::doing', remove_labels: 'In review' });
});

test('MR のマージで閉じた Issue は、閉じ直さずラベルだけ付ける', async (t) => {
  const s = setup();
  const { puts, routes } = statusRoutes({ labels: ['In review'], state: 'closed' });
  mockFetch(t, routes);
  await call(s, 'setStatus', { key: '#12', number: 12 }, 'done');
  assert.deepStrictEqual(puts[0], { add_labels: 'Done', remove_labels: 'In review' });
});

test('権限が足りずラベルが無視されたら、変えていないと返す', async (t) => {
  const s = setup();
  mockFetch(t, { [`GET /api/v4/${P}/issues/12`]: issueData({ labels: [] }), [`PUT /api/v4/${P}/issues/12`]: issueData({ labels: [] }) });
  const r = await call(s, 'setStatus', { key: '#12', number: 12 }, 'inReview');
  assert.deepStrictEqual(r.updated, []);
  assert.match(r.skipped[0].reason, /権限/);
});

// ---------- サブIssue ----------

const workItemData = (children = [], typeNodes = [{ id: 'gid://gitlab/WorkItems::Type/5' }]) => ({
  data: { project: { workItems: { nodes: [{ id: 'gid://gitlab/WorkItem/900', widgets: [{}, { children: { nodes: children } }] }] }, workItemTypes: { nodes: typeNodes } } },
});

test('サブIssue: 子タスク（Work Items）を読む', async (t) => {
  const s = setup();
  const calls = mockFetch(t, { 'POST /api/graphql': workItemData([{ iid: '13', title: '子', state: 'OPEN', widgets: [{}, { description: '子の本文' }] }, { iid: '14', title: '済', state: 'CLOSED', widgets: [] }]) });
  const list = await call(s, 'fetchSubIssues', { key: '#12', number: 12 });
  assert.deepStrictEqual(list.map((x) => [x.key, x.state, x.body]), [['#13', 'open', '子の本文'], ['#14', 'closed', '']]);
  assert.strictEqual(list[0].url, `${BASE}/grp/sub/proj/-/issues/13`);
  assert.deepStrictEqual(calls[0].body.variables, { path: 'grp/sub/proj', iid: '12' });
  assert.strictEqual(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
});

test('サブIssue: 子タスクを作って親につなぐ', async (t) => {
  const s = setup();
  let input;
  mockFetch(t, {
    'POST /api/graphql': (req) => {
      if (!req.body.variables.input) return workItemData();
      input = req.body.variables.input;
      return { data: { workItemCreate: { errors: [], workItem: { iid: '20', title: '子' } } } };
    },
  });
  const made = await call(s, 'createSubIssue', { key: '#12', number: 12 }, { title: '子', body: '本文' });
  assert.deepStrictEqual(made, { number: 20, key: '#20', title: '子', url: `${BASE}/grp/sub/proj/-/issues/20` });
  assert.deepStrictEqual(input, { namespacePath: 'grp/sub/proj', title: '子', workItemTypeId: 'gid://gitlab/WorkItems::Type/5', descriptionWidget: { description: '本文' }, hierarchyWidget: { parentId: 'gid://gitlab/WorkItem/900' } });
});

test('サブIssue: Work Items が使えない版では、関連 Issue で扱う', async (t) => {
  const s = setup();
  const posts = [];
  const calls = mockFetch(t, {
    'POST /api/graphql': { data: null, errors: [{ message: "Field 'workItems' doesn't exist on type 'Project'" }] },
    [`GET /api/v4/${P}/issues/12/links`]: [
      { iid: 30, title: '関連', state: 'opened', web_url: 'u30', link_type: 'relates_to', references: { full: 'grp/sub/proj#30' } },
      { iid: 4, title: '別', state: 'closed', web_url: 'u4', link_type: 'relates_to', references: { full: 'other/x#4' } },
      { iid: 5, title: 'ブロック', state: 'opened', web_url: 'u5', link_type: 'blocks', references: { full: 'grp/sub/proj#5' } },
    ],
    [`POST /api/v4/${P}/issues`]: (req) => (posts.push(req.body), { id: 1, iid: 31, project_id: 77, title: req.body.title, web_url: 'u31' }),
    [`POST /api/v4/${P}/issues/12/links`]: (req) => (posts.push(req.body), {}),
  });
  const list = await call(s, 'fetchSubIssues', { key: '#12', number: 12 });
  assert.deepStrictEqual(list.map((x) => [x.key, x.state]), [['#30', 'open'], ['other/x#4', 'closed']]);
  const made = await call(s, 'createSubIssue', { key: '#12', number: 12 }, { title: '子', body: '本文' });
  assert.deepStrictEqual(made, { number: 31, key: '#31', title: '子', url: 'u31' });
  assert.deepStrictEqual(posts, [{ title: '子', description: '本文' }, { target_project_id: 77, target_issue_iid: 31 }]);
  assert.ok(calls.length >= 4);
});

test('サブIssue: 親が子を持てないときも関連 Issue で作る。認証の失敗では作らない', async (t) => {
  const s = setup();
  let created = 0;
  mockFetch(t, {
    'POST /api/graphql': (req) => (req.body.variables.input ? { data: { workItemCreate: { errors: ['Parent is not allowed'], workItem: null } } } : workItemData()),
    [`POST /api/v4/${P}/issues`]: () => (created++, { iid: 40, project_id: 1, title: 'x', web_url: 'u' }),
    [`POST /api/v4/${P}/issues/12/links`]: {},
  });
  assert.strictEqual((await call(s, 'createSubIssue', { key: '#12', number: 12 }, { title: 'x', body: '' })).key, '#40');
  assert.strictEqual(created, 1);
  global.fetch = async () => new Response('{}', { status: 401 });
  await assert.rejects(call(s, 'createSubIssue', { key: '#12', number: 12 }, { title: 'x', body: '' }), /認証に失敗/);
  assert.strictEqual(created, 1);
});

test('サブタスクの提案から、GitLab にサブIssue を作れる', () => {
  const meta = trackers.issueProviderMeta().find((p) => p.id === 'gitlab');
  assert.deepStrictEqual({ canSync: meta.canSync, canSubIssue: meta.canSubIssue, canComment: meta.canComment }, { canSync: true, canSubIssue: true, canComment: true });
  const gh = trackers.issueProviderMeta().find((p) => p.id === 'github');
  assert.strictEqual(gh.canComment, false, 'GitHub には書き戻さない');
});

// ---------- MR ----------

test('MR を作る: 本文を入れて API で作る', async (t) => {
  const s = setup();
  const calls = mockFetch(t, {
    [`GET /api/v4/${P}/merge_requests`]: [],
    [`POST /api/v4/${P}/merge_requests`]: { iid: 5, web_url: `${BASE}/grp/sub/proj/-/merge_requests/5` },
  });
  const r = await call(s, 'createMergeRequest', { head: 'agent/x', base: 'main', title: 'T'.repeat(300), body: 'Closes #12' });
  assert.deepStrictEqual(r, { url: `${BASE}/grp/sub/proj/-/merge_requests/5`, number: 5, created: true });
  assert.strictEqual(calls[0].url.searchParams.get('source_branch'), 'agent/x');
  assert.strictEqual(calls[0].url.searchParams.get('state'), 'opened');
  assert.strictEqual(calls[1].body.description, 'Closes #12');
  assert.strictEqual(calls[1].body.target_branch, 'main');
  assert.strictEqual(calls[1].body.title.length, 255);
});

test('MR を作る: 開いている MR があれば作らず、更新扱いにする', async (t) => {
  const s = setup();
  const calls = mockFetch(t, { [`GET /api/v4/${P}/merge_requests`]: [{ iid: 5, web_url: 'https://x/-/merge_requests/5' }] });
  const r = await call(s, 'createMergeRequest', { head: 'a', base: 'main', title: 't', body: 'b' });
  assert.strictEqual(r.created, false);
  assert.strictEqual(calls.length, 1);
});

const MR = `${BASE}/grp/sub/proj/-/merge_requests/5`;

test('MR の状態: マージ・閉じた・コンフリクト・計算中', async (t) => {
  const s = setup();
  let mr = { state: 'merged', merged_at: '2026-11-07T00:00:00Z', sha: 'abc', target_branch: 'main' };
  const calls = mockFetch(t, { [`GET /api/v4/${P}/merge_requests/5`]: () => mr });
  const merged = await call(s, 'mergeRequestState', { url: MR });
  assert.deepStrictEqual(merged, { state: 'MERGED', mergedAt: '2026-11-07T00:00:00Z', headRefOid: 'abc', baseRefName: 'main', mergeable: 'MERGEABLE', checks: null });
  assert.strictEqual(calls[0].url.searchParams.get('with_merge_status_recheck'), 'true');
  mr = { state: 'closed' };
  assert.strictEqual((await call(s, 'mergeRequestState', { url: MR })).state, 'CLOSED');
  mr = { state: 'opened', has_conflicts: true, detailed_merge_status: 'conflict', sha: 'abc' };
  assert.strictEqual((await call(s, 'mergeRequestState', { url: MR })).mergeable, 'CONFLICTING');
  mr = { state: 'opened', has_conflicts: true, detailed_merge_status: 'checking', sha: 'abc' };
  assert.strictEqual((await call(s, 'mergeRequestState', { url: MR })).mergeable, 'UNKNOWN', '計算中は前の結果のままにする');
  mr = { state: 'opened', has_conflicts: false, merge_status: 'can_be_merged', sha: 'abc' };
  assert.strictEqual((await call(s, 'mergeRequestState', { url: MR })).mergeable, 'MERGEABLE', '古い版');
});

test('MR の状態: パイプラインを gh と同じ形にする', async (t) => {
  const s = setup();
  let pipe = null;
  const jobs = [{ name: 'test', web_url: 'j1' }, { name: 'lint', web_url: 'j2', allow_failure: true }];
  const calls = mockFetch(t, {
    [`GET /api/v4/${P}/merge_requests/5`]: () => ({ state: 'opened', sha: 'abc', head_pipeline: pipe }),
    [`GET /api/v4/${P}/pipelines/8/jobs`]: () => jobs,
  });
  const checks = async () => (await call(s, 'mergeRequestState', { url: MR })).checks;
  assert.strictEqual((await checks()).state, 'NONE');
  pipe = { id: 8, status: 'running', sha: 'abc' };
  assert.deepStrictEqual(await checks(), { state: 'PENDING', sha: 'abc', total: 1, passed: 0, pending: 1, failed: [] });
  pipe = { id: 8, status: 'success', sha: 'abc' };
  assert.strictEqual((await checks()).state, 'SUCCESS');
  pipe = { id: 8, status: 'canceled', sha: 'abc' };
  assert.strictEqual((await checks()).state, 'ATTENTION');
  pipe = { id: 8, status: 'failed', sha: 'abc', web_url: 'p8' };
  assert.deepStrictEqual((await checks()).failed, [{ name: 'test', url: 'j1' }], 'allow_failure のジョブは数えない');
  assert.strictEqual(calls.at(-1).url.searchParams.get('scope[]'), 'failed');
  jobs.length = 0;
  assert.deepStrictEqual((await checks()).failed, [{ name: 'パイプライン', url: 'p8' }]);
});

test('別のサーバーの MR の URL には、トークンを送らない', async (t) => {
  const s = setup();
  const calls = mockFetch(t, {});
  await assert.rejects(call(s, 'mergeRequestState', { url: 'https://evil.example/g/p/-/merge_requests/1' }), /接続先のものではありません/);
  assert.strictEqual(calls.length, 0);
});

// ---------- エラーにトークンを出さない ----------

test('エラーの文にトークンが出ない', async (t) => {
  const s = setup();
  const issue = { key: '#12', number: 12 };
  const check = async (fn) => {
    const err = await fn().catch((e) => e);
    assert.ok(err instanceof Error, 'エラーになる');
    assert.ok(!err.message.includes(TOKEN), err.message);
    return err;
  };
  mockFetch(t, {});
  global.fetch = async () => new Response(JSON.stringify({ message: `bad token ${TOKEN}` }), { status: 500 });
  assert.match((await check(() => call(s, 'fetchIssue', issue))).message, /GitLab がエラーを返しました（500）/);
  await check(() => call(s, 'addComment', issue, 'x'));
  await check(() => call(s, 'createMergeRequest', { head: 'a', base: 'b', title: 't', body: '' }));
  await check(() => call(s, 'mergeRequestState', { url: MR }));
  global.fetch = async () => {
    throw new TypeError(`failed with ${TOKEN}`);
  };
  await check(() => call(s, 'fetchIssue', issue));
  await check(() => s.list.test('gitlab', {}));
  global.fetch = async () => new Response(`<html>${TOKEN}</html>`, { status: 401 });
  assert.match((await check(() => call(s, 'testConnection'))).message, /認証に失敗/);
  global.fetch = async () => new Response('', { status: 302, headers: { location: 'https://evil.example/' } });
  assert.match((await check(() => call(s, 'fetchIssue', issue))).message, /転送/);
});

test('トークンが無いときは送らずに案内する', async (t) => {
  const { tmp, repo } = makeRepo();
  const store = new Store(path.join(tmp, 'b.json'));
  store.settings.repoPath = repo;
  store.settings.trackerConfigs = { gitlab: { baseUrl: BASE } };
  const list = new trackers.Trackers({ store, secrets: fakeSecrets({}) });
  const calls = mockFetch(t, {});
  await assert.rejects(list.call('gitlab', 'fetchIssue', { repoPath: repo }, { key: '#1', number: 1 }), /トークンが設定されていません/);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(list.publicOne('gitlab').configured, false);
});

test('接続テスト', async (t) => {
  const s = setup();
  const calls = mockFetch(t, { 'GET /api/v4/user': { username: 'kaz' } });
  assert.deepStrictEqual(await s.list.test('gitlab', {}), { ok: true, message: 'kaz として接続できました' });
  assert.strictEqual(calls[0].url.href, `${API}/user`);
});

// ---------- コメントの書き戻し ----------

function commentCard(s, over = {}) {
  const c = { id: `c${Math.random()}`, title: '#12 ログイン', prompt: 'p', status: 'todo', repoPath: s.repo, branch: 'agent/x', issue: { provider: 'gitlab', key: '#12', number: 12, title: 'ログイン', url: `${BASE}/grp/sub/proj/-/issues/12` }, ...over };
  s.store.cards.push(c);
  return c;
}

test('開始・MR の作成・完了のときに Issue へコメントする。同じ出来事は1回だけ', async (t) => {
  const s = setup();
  s.store.setRepoSettings(s.repo, { issueStatusSync: false });
  const notes = [];
  mockFetch(t, { [`POST /api/v4/${P}/issues/12/notes`]: (req) => (notes.push(req.body.body), { id: 1 }) });
  const c = commentCard(s);
  c.status = 'running';
  s.agents.changed(c);
  s.agents.changed(c);
  c.status = 'review';
  c.prUrl = MR;
  s.agents.changed(c);
  c.status = 'done';
  c.mergedInto = ['main'];
  s.agents.changed(c);
  s.agents.changed(c);
  await s.agents.flushIssueSync();
  assert.deepStrictEqual(notes, ['Worktree Kanban でタスクを開始しました（ブランチ: agent/x）', `MR を作成しました: ${MR}`, 'Worktree Kanban のタスクが完了しました']);
});

test('プロジェクトの設定で書き戻しを切れる', async (t) => {
  const s = setup();
  s.store.setRepoSettings(s.repo, { issueStatusSync: false, issueComments: false });
  const calls = mockFetch(t, {});
  const c = commentCard(s, { status: 'running' });
  s.agents.changed(c);
  await s.agents.flushIssueSync();
  assert.strictEqual(calls.length, 0);
});

test('コメントに失敗してもタスクは止めず、ログに残す。トークンは出ない', async (t) => {
  const s = setup();
  s.store.setRepoSettings(s.repo, { issueStatusSync: false });
  mockFetch(t, { [`POST /api/v4/${P}/issues/12/notes`]: { status: 500, json: { message: `oops ${TOKEN}` } } });
  const logged = [];
  s.agents.on('log', (_id, e) => logged.push(JSON.stringify(e)));
  const c = commentCard(s, { status: 'running' });
  s.agents.changed(c);
  await s.agents.flushIssueSync();
  assert.strictEqual(c.status, 'running');
  assert.ok(logged.some((x) => /GitLab にコメントを書けませんでした/.test(x)), logged.join());
  assert.ok(!logged.join().includes(TOKEN));
});

test('GitHub の Issue にはコメントしない', async (t) => {
  const s = setup();
  s.store.setRepoSettings(s.repo, { issueProvider: 'github', issueStatusSync: false });
  const calls = mockFetch(t, {});
  let wrote = 0;
  s.agents.addIssueComment = async () => wrote++;
  const c = commentCard(s, { status: 'running', issue: { number: 12, title: 't', url: 'u' } });
  s.agents.changed(c);
  await s.agents.flushIssueSync();
  assert.strictEqual(wrote, 0);
  assert.strictEqual(calls.length, 0);
});

// ---------- カードの動き ----------

async function reviewCard(t, routes, { issue } = {}) {
  const s = setup();
  const { tmp, store, agents, g, repo } = s;
  const remote = path.join(tmp, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  // get-url は GitLab の URL、push は手元のリポジトリへ
  g('remote', 'set-url', '--push', 'origin', remote);
  g('push', '-q', 'origin', 'main');
  const bin = path.join(tmp, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  Object.assign(store.settings, { claudePath: bin, maxParallel: 1, permissionMode: 'bypassPermissions' });
  store.setRepoSettings(repo, { issueStatusSync: false, issueComments: false, codeHost: 'gitlab' });
  const calls = mockFetch(t, routes);
  const c = agents.createCard({ title: 'mr task', prompt: 'MR向け' });
  if (issue) c.issue = issue;
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  return { ...s, c, calls };
}

test('GitLab の origin では、push して API で MR を作り、gh を使わない', async (t) => {
  let mrs = [];
  const s = await reviewCard(t, {
    [`GET /api/v4/${P}/merge_requests`]: () => mrs,
    [`POST /api/v4/${P}/merge_requests`]: (req) => {
      mrs = [{ iid: 5, web_url: MR, ...req.body }];
      return mrs[0];
    },
  });
  const { agents, c, calls, g } = s;
  agents.opts.ghPath = '/nonexistent/gh';
  const r = await agents.createPullRequest(c.id, { title: 'My MR', body: 'Closes #12' });
  assert.deepStrictEqual(r, { url: MR, created: true });
  assert.strictEqual(c.prUrl, MR);
  assert.strictEqual(c.prState, 'OPEN');
  const post = calls.find((x) => x.method === 'POST');
  assert.deepStrictEqual(post.body, { source_branch: c.branch, target_branch: 'main', title: 'My MR', description: 'Closes #12' });
  assert.ok(execFileSync('git', ['branch', '--list', c.branch], { cwd: g('remote', 'get-url', '--push', 'origin') }).toString().includes(c.branch), 'push した');
  // 2回目は更新扱い
  assert.strictEqual((await agents.createPullRequest(c.id)).created, false);
  assert.strictEqual(calls.filter((x) => x.method === 'POST').length, 1);
});

test('MR の見張り: マージされたらタスクを完了にする', async (t) => {
  let mr = { state: 'opened', sha: 'x', target_branch: 'main', detailed_merge_status: 'mergeable' };
  const s = await reviewCard(t, {
    [`GET /api/v4/${P}/merge_requests`]: [],
    [`POST /api/v4/${P}/merge_requests`]: { iid: 5, web_url: MR },
    [`GET /api/v4/${P}/merge_requests/5`]: () => mr,
  });
  const { agents, c, g } = s;
  await agents.createPullRequest(c.id);
  assert.strictEqual(await agents.checkPullRequests(), 0);
  assert.strictEqual(c.status, 'review');
  mr = { ...mr, state: 'merged', merged_at: '2026-11-07T00:00:00Z', sha: g('rev-parse', c.branch) };
  assert.strictEqual(await agents.checkPullRequests(), 1);
  assert.strictEqual(c.status, 'done');
  assert.strictEqual(c.prState, 'MERGED');
  assert.deepStrictEqual(c.mergedInto, ['main']);
  assert.strictEqual(agents.issueStatusKey({ ...c, issue: { key: '#1' } }), 'done');
});

test('MR の見張り: コンフリクトとパイプラインの失敗をカードに載せる', async (t) => {
  const mr = { state: 'opened', sha: 'x', target_branch: 'main', has_conflicts: true, detailed_merge_status: 'conflict', head_pipeline: { id: 8, status: 'failed', sha: 'x', web_url: 'p8' } };
  const s = await reviewCard(t, {
    [`GET /api/v4/${P}/merge_requests`]: [],
    [`POST /api/v4/${P}/merge_requests`]: { iid: 5, web_url: MR },
    [`GET /api/v4/${P}/merge_requests/5`]: () => mr,
    [`GET /api/v4/${P}/pipelines/8/jobs`]: [{ name: 'test', web_url: 'j1' }],
  });
  const { agents, c, store } = s;
  await agents.createPullRequest(c.id);
  await agents.checkPullRequests();
  assert.strictEqual(c.prMergeable, 'CONFLICTING');
  assert.ok(c.conflict && c.conflict.pr);
  assert.strictEqual(c.prChecks.state, 'FAILURE');
  assert.deepStrictEqual(c.prChecks.failed, [{ name: 'test', url: 'j1' }]);
  const n = store.notifications.find((x) => x.cardId === c.id && /コンフリクト/.test(x.title));
  assert.match(n.title, /^MR が/);
});

test('MR の URL を GitHub の処理に渡さない。GitHub の PR は gh のまま', () => {
  assert.strictEqual(IssueRef.reviewHostOf(MR), 'gitlab');
  assert.strictEqual(IssueRef.reviewHostOf('https://github.com/o/r/pull/7'), '');
  assert.strictEqual(IssueRef.reviewHostOf(null), '');
});

test('文言: GitLab のときだけ PR を MR に読み替える。埋める値は変えない', () => {
  const tpl = I18n.tr('PR がマージされました: {title}');
  assert.strictEqual(I18n.forHost(tpl, 'gitlab', { title: 'Fix PR template' }), 'MR がマージされました: Fix PR template');
  assert.strictEqual(I18n.forHost(tpl, '', { title: 'x' }), 'PR がマージされました: x');
  assert.strictEqual(I18n.forHost('PR を GitHub で見る', 'gitlab'), 'MR を GitLab で見る');
  assert.strictEqual(I18n.forHost('SUPPRESS', 'gitlab'), 'SUPPRESS');
  I18n.setLanguage('en');
  try {
    assert.match(I18n.forHost(I18n.tr('PR を更新…'), 'gitlab'), /Update MR/);
  } finally {
    I18n.setLanguage('ja');
  }
});
