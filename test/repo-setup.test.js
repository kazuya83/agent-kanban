// リポジトリのクローン・新規作成（src/repo-setup.js）を確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const rs = require('../src/repo-setup');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-rs-'));
const out = (cwd, ...a) => execFileSync('git', a, { cwd }).toString().trim();

test('normalizeCloneUrl: 使える形だけ受け付ける', () => {
  assert.strictEqual(rs.normalizeCloneUrl(' https://github.com/a/b.git '), 'https://github.com/a/b.git');
  assert.strictEqual(rs.normalizeCloneUrl('git@github.com:a/b.git'), 'git@github.com:a/b.git');
  assert.strictEqual(rs.normalizeCloneUrl('ssh://git@example.com/a/b'), 'ssh://git@example.com/a/b');
  assert.strictEqual(rs.normalizeCloneUrl('kazuya83/worktree-kanban'), 'https://github.com/kazuya83/worktree-kanban.git');
  assert.strictEqual(rs.normalizeCloneUrl('a/b.git'), 'https://github.com/a/b.git');
  for (const bad of ['', 'ext::sh -c touch% /tmp/x', 'file:///etc', '--upload-pack=touch x', '/tmp/repo', 'a/.git', 'https://github.com', 'git@h:-oProxy', '-oProxyCommand@h:x', 'git@-oProxy:x']) {
    assert.throws(() => rs.normalizeCloneUrl(bad), undefined, bad);
  }
});

test('repoNameFromUrl / validateName', () => {
  assert.strictEqual(rs.repoNameFromUrl('https://github.com/a/my-repo.git'), 'my-repo');
  assert.strictEqual(rs.repoNameFromUrl('git@github.com:a/x.git'), 'x');
  assert.strictEqual(rs.repoNameFromUrl('https://example.com/a/b/'), 'b');
  assert.strictEqual(rs.validateName(' app '), 'app');
  for (const bad of ['', '..', '.git', '-x', 'a/b', 'a\\b', 'a:b']) assert.throws(() => rs.validateName(bad), undefined, bad);
});

test('createRepo: README.md の最初のコミットがある main ブランチを作る', async () => {
  const parent = tmpdir();
  const r = await rs.createRepo({ parent, name: 'new-app' });
  assert.strictEqual(r.dir, path.join(parent, 'new-app'));
  assert.strictEqual(r.github, '');
  assert.strictEqual(out(r.dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.strictEqual(out(r.dir, 'log', '--format=%s'), 'Initial commit');
  assert.strictEqual(fs.readFileSync(path.join(r.dir, 'README.md'), 'utf8'), '# new-app\n');
  // 同じ名前ではもう作れない
  await assert.rejects(rs.createRepo({ parent, name: 'new-app' }), /すでにあります/);
  await assert.rejects(rs.createRepo({ parent: path.join(parent, 'nope'), name: 'x' }), /見つかりません/);
  await assert.rejects(rs.createRepo({ parent, name: 'y', github: 'secret' }), /公開範囲/);
});

test('cloneFrom / targetDir: 置き場所の中にクローンする', async () => {
  const tmp = tmpdir();
  const work = (await rs.createRepo({ parent: tmp, name: 'work' })).dir;
  const parent = path.join(tmp, 'dest');
  fs.mkdirSync(parent);
  const dir = await rs.cloneFrom(work, parent, 'copied');
  assert.strictEqual(dir, path.join(parent, 'copied'));
  assert.strictEqual(out(dir, 'log', '--format=%s'), 'Initial commit');
  // 空のフォルダならそこへ、中身があればエラー
  fs.mkdirSync(path.join(parent, 'empty'));
  assert.strictEqual(rs.targetDir(parent, 'empty'), path.join(parent, 'empty'));
  assert.throws(() => rs.targetDir(parent, 'copied'), /すでにあります/);
  assert.strictEqual(await rs.hasCommit(dir), true);
  // 空のリポジトリ（コミットなし）をクローンすると hasCommit が false
  const bare = path.join(tmp, 'empty.git');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  const emptyClone = await rs.cloneFrom(bare, parent, 'empty-clone');
  assert.strictEqual(await rs.hasCommit(emptyClone), false);
  // 手元のパスや file:// は cloneRepo では受け付けない
  await assert.rejects(rs.cloneRepo({ url: work, parent }), /クローンできません/);
  await assert.rejects(rs.cloneRepo({ url: 'file://' + work, parent }), /クローンできません/);
});
