// worktree タブ用の git.worktreeStatus / listWorktrees を確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const git = require('../src/git');

test('worktreeStatus: コミット・未コミット・未追跡・ベースの進み具合', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kanban-wt-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd });
  g(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  fs.writeFileSync(path.join(repo, 'old.txt'), 'bye\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-qm', 'init');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();

  const wt = path.join(tmp, 'wt');
  await git.addWorktree(repo, wt, 'agent/x', base);

  // まだ何もしていない
  let s = await git.worktreeStatus(wt, base, 'main');
  assert.strictEqual(s.branch, 'agent/x');
  assert.deepStrictEqual([s.commits.length, s.committed.length, s.uncommitted.length, s.behind], [0, 0, 0, 0]);

  // コミットを1つ積む
  fs.writeFileSync(path.join(wt, 'a.js'), 'one\ntwo\n');
  fs.rmSync(path.join(wt, 'old.txt'));
  g(wt, 'add', '-A');
  g(wt, 'commit', '-qm', 'add a');
  // 未コミットの変更と未追跡ファイル
  fs.writeFileSync(path.join(wt, 'README.md'), 'hello\nworld\n');
  fs.mkdirSync(path.join(wt, 'src'));
  fs.writeFileSync(path.join(wt, 'src', 'new.js'), 'x\ny\nz\n');
  // ベースブランチ側も進める
  fs.writeFileSync(path.join(repo, 'main.txt'), 'm\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-qm', 'main moves');

  s = await git.worktreeStatus(wt, base, 'main');
  assert.strictEqual(s.commits.length, 1);
  assert.strictEqual(s.commits[0].subject, 'add a');
  assert.strictEqual(s.commits[0].files, 2);
  assert.strictEqual(s.commits[0].add, 2);
  const committed = Object.fromEntries(s.committed.map((f) => [f.path, f.status]));
  assert.deepStrictEqual(committed, { 'a.js': 'A', 'old.txt': 'D' });
  const un = Object.fromEntries(s.uncommitted.map((f) => [f.path, f]));
  assert.strictEqual(un['README.md'].status, 'M');
  assert.strictEqual(un['README.md'].add, 1);
  assert.strictEqual(un['src/new.js'].status, '?');
  assert.strictEqual(un['src/new.js'].add, 3);
  assert.ok(un['src/new.js'].mtime > 0);
  assert.strictEqual(s.behind, 1);
  assert.strictEqual(s.base.sha, base);

  const list = await git.listWorktrees(repo);
  assert.strictEqual(list.length, 2);
  assert.ok(list[0].main);
  assert.strictEqual(list[1].branch, 'agent/x');

  fs.rmSync(tmp, { recursive: true, force: true });
});
