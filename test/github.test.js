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
