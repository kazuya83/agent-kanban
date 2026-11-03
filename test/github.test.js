// GitHub Issue からタスクを作る機能と、gh のログインの流れを確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const github = require('../src/github');
const gh = require('../src/gh');
const { Store } = require('../src/store');
const { AgentManager } = require('../src/agent');

// 偽の gh: 「ログイン済み」かどうかを $FAKE_GH_STATE のファイルで表す
function fakeGh(dir) {
  const state = path.join(dir, 'logged-in');
  const js = path.join(dir, 'gh.js');
  fs.writeFileSync(
    js,
    `
const fs = require('fs');
const a = process.argv.slice(2);
const state = ${JSON.stringify(state)};
if (a[0] === 'auth' && a[1] === 'status') {
  if (fs.existsSync(state)) { console.log('github.com\\n  ✓ Logged in to github.com account octocat (keyring)'); process.exit(0); }
  console.error('You are not logged into any GitHub hosts.'); process.exit(1);
}
if (a[0] === 'auth' && a[1] === 'login') {
  console.error('! First copy your one-time code: ABCD-1234');
  console.error('Open this URL to continue in your web browser: https://github.com/login/device');
  setTimeout(() => { fs.writeFileSync(state, '1'); console.error('✓ Logged in as octocat'); process.exit(0); }, 200);
  return;
}
if (a[0] === 'issue' && a[1] === 'view') {
  if (!fs.existsSync(state)) { console.error('not logged in'); process.exit(1); }
  const n = Number(a[2]);
  if (n === 404) { console.error('Could not resolve to an issue'); process.exit(1); }
  console.log(JSON.stringify({ number: n, title: 'ログインできない ' + n, body: '再現手順:\\n1. ...', url: 'https://github.com/acme/app/issues/' + n,
    state: n === 9 ? 'CLOSED' : 'OPEN', labels: [{ name: 'bug' }], comments: [{ author: { login: 'alice' }, body: 'Safari でも起きます' }] }));
  process.exit(0);
}
process.exit(2);
`,
  );
  const bin = path.join(dir, process.platform === 'win32' ? 'gh.cmd' : 'gh');
  fs.writeFileSync(bin, process.platform === 'win32' ? `@"${process.execPath}" "${js}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 });
  return state;
}

test('リモート URL と Issue 番号の読み取り', () => {
  assert.deepStrictEqual(github.parseGithubRemote('https://github.com/kazuya83/agent-kanban.git'), { owner: 'kazuya83', repo: 'agent-kanban' });
  assert.deepStrictEqual(github.parseGithubRemote('git@github.com:acme/app.git\n'), { owner: 'acme', repo: 'app' });
  assert.deepStrictEqual(github.parseGithubRemote('ssh://git@github.com/acme/app'), { owner: 'acme', repo: 'app' });
  assert.strictEqual(github.parseGithubRemote('https://gitlab.com/acme/app.git'), null);
  assert.deepStrictEqual(github.parseIssueNumbers('12, 15 #18、12'), [12, 15, 18]);
  assert.throws(() => github.parseIssueNumbers('abc'), /読めません/);
  assert.throws(() => github.parseIssueNumbers(' '), /入力してください/);
});

test('Issue から指示を作る', () => {
  const p = github.buildIssuePrompt(
    { number: 7, title: 'ボタンが押せない', body: '本文です', url: 'https://github.com/a/b/issues/7', labels: ['bug'], comments: [{ author: 'bob', body: 'iOS だけ' }] },
    'テストも追加して',
  );
  assert.match(p, /Issue #7 を解決/);
  assert.match(p, /ボタンが押せない/);
  assert.match(p, /ラベル: bug/);
  assert.match(p, /@bob\n iOS だけ|@bob\niOS だけ/);
  assert.match(p, /## 追加の指示\nテストも追加して/);
});

test('gh: 未ログイン → ログイン（確認コードを受け取る）→ Issue からカードを作る', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-gh-'));
  const binDir = path.join(tmp, 'bin');
  fs.mkdirSync(binDir);
  fakeGh(binDir);
  const oldPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${oldPath}`;
  try {
    let st = await gh.status();
    assert.strictEqual(st.installed, true);
    assert.strictEqual(st.loggedIn, false);

    const events = [];
    st = await gh.login((ev) => events.push(ev));
    assert.deepStrictEqual(events.find((e) => e.type === 'code'), { type: 'code', code: 'ABCD-1234', url: 'https://github.com/login/device' });
    assert.strictEqual(st.loggedIn, true);
    assert.strictEqual(st.user, 'octocat');

    // リポジトリ（origin が GitHub）
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    const g = (...a) => execFileSync('git', a, { cwd: repo });
    g('init', '-q', '-b', 'main');
    g('remote', 'add', 'origin', 'https://github.com/acme/app.git');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    g('add', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');

    const store = new Store(path.join(tmp, 'data', 'board.json'));
    store.settings.repoPath = repo;
    const agents = new AgentManager(store, { mcpScript: '', mcpDir: path.join(tmp, 'mcp'), nodeBin: process.execPath });

    const r = await agents.createFromIssues({ numbers: '12, 9, 404', extra: '小さく直して' });
    assert.strictEqual(r.cards.length, 2);
    const [c12] = r.cards;
    assert.strictEqual(c12.title, '#12 ログインできない 12');
    assert.deepStrictEqual(c12.issue, { number: 12, title: 'ログインできない 12', url: 'https://github.com/acme/app/issues/12' });
    assert.match(c12.prompt, /Safari でも起きます/);
    assert.match(c12.prompt, /小さく直して/);
    assert.ok(r.errors.some((e) => /#9 はクローズ済み/.test(e)));
    assert.ok(r.errors.some((e) => /^#404:/.test(e)));
    assert.strictEqual(agents.commitMessage(c12), 'agent: ログインできない 12 (#12)');

    // 同じ Issue はもう作らない
    await assert.rejects(agents.createFromIssues({ numbers: '12' }), /もうタスクがあります/);
  } finally {
    process.env.PATH = oldPath;
  }
});

test('Projects の Status の選択肢を選ぶ', () => {
  const opts = [
    { id: 't', name: 'Todo' },
    { id: 'p', name: '🏗 In Progress' },
    { id: 'r', name: 'In review' },
    { id: 'd', name: 'Done' },
  ];
  assert.deepStrictEqual(github.pickStatusOption(opts, 'inProgress'), { id: 'p', name: '🏗 In Progress' });
  assert.deepStrictEqual(github.pickStatusOption(opts, 'inReview'), { id: 'r', name: 'In review' });
  assert.deepStrictEqual(github.pickStatusOption(opts, 'done'), { id: 'd', name: 'Done' });
  assert.deepStrictEqual(github.pickStatusOption([{ id: 'x', name: 'in-progress' }], 'inProgress'), { id: 'x', name: 'in-progress' });
  assert.deepStrictEqual(github.pickStatusOption([{ id: 'x', name: '完了' }], 'done'), { id: 'x', name: '完了' });
  assert.strictEqual(github.pickStatusOption([{ id: 't', name: 'Todo' }], 'inReview'), null);

  // 設定で選択肢の名前を指定したら、その名前のものだけを選ぶ（記号・大文字小文字は無視、カンマで候補を複数）
  const custom = [...opts, { id: 'q', name: '🔍 QA' }, { id: 's', name: 'Shipped' }];
  assert.deepStrictEqual(github.pickStatusOption(custom, 'inReview', 'qa'), { id: 'q', name: '🔍 QA' });
  assert.deepStrictEqual(github.pickStatusOption(custom, 'done', 'Released, shipped'), { id: 's', name: 'Shipped' });
  assert.strictEqual(github.pickStatusOption(custom, 'done', 'Released'), null); // 指定した名前がなければ自動では探さない
  assert.deepStrictEqual(github.pickStatusOption(custom, 'done', '  '), { id: 'd', name: 'Done' }); // 空なら自動
});

// 偽の gh（api graphql）: Issue は2つの Project に入っている。mutation は $LOG に書き出す
function fakeGhProjects(dir, { noScope = false } = {}) {
  const log = path.join(dir, 'mutations.jsonl');
  const js = path.join(dir, 'gh.js');
  fs.writeFileSync(
    js,
    `
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] !== 'api' || a[1] !== 'graphql') process.exit(2);
const vars = {};
for (let i = 2; i < a.length; i += 2) { const [k, ...v] = a[i + 1].split('='); vars[k] = v.join('='); }
if (${noScope}) {
  console.log(JSON.stringify({ errors: [{ type: 'INSUFFICIENT_SCOPES', message: "requires one of the following scopes: ['read:project']" }] }));
  console.error("gh: Your token has not been granted the required scopes to execute this query. requires ['read:project']");
  process.exit(1);
}
if (/mutation/.test(vars.query)) {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ projectId: vars.projectId, itemId: vars.itemId, fieldId: vars.fieldId, optionId: vars.optionId }) + '\\n');
  console.log(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: vars.itemId } } } }));
  process.exit(0);
}
const opts = [{ id: 'o-todo', name: 'Todo' }, { id: 'o-prog', name: 'In Progress' }, { id: 'o-rev', name: 'In review' }, { id: 'o-done', name: 'Done' }];
fs.appendFileSync(${JSON.stringify(log)}.replace(/mutations/, 'queries'), JSON.stringify({ field: vars.field }) + '\\n');
console.log(JSON.stringify({ data: { repository: { issue: { projectItems: { nodes: [
  { id: 'item-1', project: { id: 'P1', title: 'Board', closed: false, field: { id: 'F1', options: opts } }, fieldValueByName: { name: 'Todo', optionId: 'o-todo' } },
  { id: 'item-2', project: { id: 'P2', title: 'Simple', closed: false, field: { id: 'F2', options: [{ id: 's-todo', name: 'Todo' }, { id: 's-done', name: 'Done' }] } }, fieldValueByName: null },
  { id: 'item-3', project: { id: 'P3', title: 'Old', closed: true, field: { id: 'F3', options: opts } }, fieldValueByName: null },
] } } } } }));
`,
  );
  const bin = path.join(dir, process.platform === 'win32' ? 'gh.cmd' : 'gh');
  fs.writeFileSync(bin, process.platform === 'win32' ? `@"${process.execPath}" "${js}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 });
  return { bin, log };
}

function githubRepo(tmp) {
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  g('remote', 'add', 'origin', 'https://github.com/acme/app.git');
  return repo;
}

test('Issue が入っている Project の Status を変える', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-proj-'));
  const repo = githubRepo(tmp);
  const { bin, log } = fakeGhProjects(tmp);
  const r = await github.setIssueProjectStatus(repo, 8, 'inProgress', { gh: bin });
  assert.deepStrictEqual(r.updated, [{ project: 'Board', from: 'Todo', to: 'In Progress' }]);
  assert.strictEqual(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /In progress/);
  assert.strictEqual(r.projects, 2); // クローズした Project は数えない
  const muts = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepStrictEqual(muts, [{ projectId: 'P1', itemId: 'item-1', fieldId: 'F1', optionId: 'o-prog' }]);

  const d = await github.setIssueProjectStatus(repo, 8, 'done', { gh: bin });
  assert.deepStrictEqual(d.updated.map((u) => [u.project, u.to]), [['Board', 'Done'], ['Simple', 'Done']]);

  // project の権限がないときは、権限の足し方を案内する
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-proj-'));
  const noScope = fakeGhProjects(tmp2, { noScope: true });
  await assert.rejects(github.setIssueProjectStatus(repo, 8, 'inReview', { gh: noScope.bin }), (err) => err.code === 'SCOPE' && /gh auth refresh -h github.com -s project/.test(err.message));
});

test('設定した項目名・選択肢の名前で Project のステータスを変える', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-proj-'));
  const repo = githubRepo(tmp);
  const { bin, log } = fakeGhProjects(tmp);
  const r = await github.setIssueProjectStatus(repo, 8, 'inReview', { gh: bin, fieldName: 'Stage', mapping: { inReview: 'Todo' } });
  assert.deepStrictEqual(r.updated, [{ project: 'Simple', from: '', to: 'Todo' }]);
  assert.deepStrictEqual(r.unchanged, [{ project: 'Board', to: 'Todo' }]);
  const queries = fs.readFileSync(log.replace(/mutations/, 'queries'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepStrictEqual(queries, [{ field: 'Stage' }]); // 指定した項目名で問い合わせる
  // Board はもう Todo なので変えず、まだ値のない Simple だけ変える
  assert.strictEqual(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1);

  // 指定した名前の選択肢がないと、理由を付けて飛ばす
  const d = await github.setIssueProjectStatus(repo, 8, 'done', { gh: bin, mapping: { done: 'Released' } });
  assert.deepStrictEqual(d.updated, []);
  assert.strictEqual(d.skipped.length, 2);
  assert.match(d.skipped[0].reason, /Released/);
});

test('カードの列に合わせて Projects の Status を変える', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-sync-'));
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  store.settings.repoPath = tmp;
  const agents = new AgentManager(store, { mcpScript: '', mcpDir: path.join(tmp, 'mcp'), nodeBin: process.execPath });
  const calls = [];
  agents.setIssueProjectStatus = async (_repo, n, key) => {
    calls.push([n, key]);
    return { updated: [{ project: 'Board', from: '', to: key }], unchanged: [], skipped: [], projects: 1 };
  };
  const c = agents.createCard({ title: '#8 自動で変える', prompt: 'やって', issue: { number: 8, title: '自動で変える', url: 'https://github.com/acme/app/issues/8' } });
  const plain = agents.createCard({ title: 'ふつうのタスク', prompt: 'やって' });
  const step = async (status, extra) => {
    Object.assign(c, { status }, extra || {});
    agents.changed(c);
    await agents.flushIssueSync();
  };
  await step('todo');
  await step('queued');
  await step('running'); // 待機中 → 実行中 は同じ In progress なので、もう一度は変えない
  await step('review');
  await step('failed');
  await step('running');
  await step('done', { mergedInto: ['main'] });
  assert.deepStrictEqual(calls, [[8, 'inProgress'], [8, 'inReview'], [8, 'inProgress'], [8, 'done']]);
  assert.ok(c.logs.some((l) => /GitHub Projects「Board」で #8 のステータスを done にしました/.test(l.text)));

  // PR を作って片付けただけ（マージしていない）なら In review のまま
  calls.length = 0;
  c.mergedInto = [];
  await step('review');
  calls.length = 0;
  await step('done', { prUrl: 'https://github.com/acme/app/pull/1' });
  assert.deepStrictEqual(calls, []);

  // Issue のないカード・設定で切ったときは何もしない
  plain.status = 'running';
  agents.changed(plain);
  store.settings.issueStatusSync = false;
  c.mergedInto = ['main'];
  await step('running');
  await agents.flushIssueSync();
  assert.deepStrictEqual(calls, []);

  // 失敗してもカードは止めず、ログに1回だけ出す
  store.settings.issueStatusSync = true;
  agents.setIssueProjectStatus = async () => {
    throw new Error('権限がありません');
  };
  await step('review');
  await step('running');
  assert.strictEqual(c.logs.filter((l) => /権限がありません/.test(l.text)).length, 1);
});
