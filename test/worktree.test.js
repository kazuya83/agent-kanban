// worktree タブ用の git.worktreeStatus / listWorktrees を確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const git = require('../src/git');

test('worktreeStatus: コミット・未コミット・未追跡・ベースの進み具合', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-wt-'));
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

test('worktreeStatus: 日本語のファイル名がそのまま読める', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-wt-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'メモ.md'), 'a\n');
  g('add', '.');
  g('commit', '-qm', 'init');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
  fs.writeFileSync(path.join(repo, 'メモ.md'), 'a\nb\n');
  fs.writeFileSync(path.join(repo, '新規.txt'), 'x\ny\n');

  const s = await git.worktreeStatus(repo, base, null);
  const un = Object.fromEntries(s.uncommitted.map((f) => [f.path, f]));
  assert.strictEqual(un['メモ.md'].status, 'M');
  assert.strictEqual(un['メモ.md'].add, 1);
  assert.strictEqual(un['新規.txt'].add, 2);
  assert.ok(un['新規.txt'].mtime > 0);

  fs.rmSync(repo, { recursive: true, force: true });
});

test('resetHardClean: 指定のコミットへ戻し、未追跡は消し、ignore されたファイルは残す', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-reset-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'base\n');
  g('add', '.');
  g('commit', '-qm', 'init');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();

  fs.writeFileSync(path.join(repo, 'keep.txt'), 'changed\n');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');
  g('add', '.');
  g('commit', '-qm', 'second');
  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'dirty\n');
  fs.mkdirSync(path.join(repo, 'node_modules'));
  fs.writeFileSync(path.join(repo, 'node_modules', 'left.js'), 'stay\n');

  await git.resetHardClean(repo, base);
  assert.strictEqual(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim(), base);
  assert.strictEqual(fs.readFileSync(path.join(repo, 'keep.txt'), 'utf8'), 'base\n');
  assert.ok(!fs.existsSync(path.join(repo, 'new.txt')));
  assert.ok(!fs.existsSync(path.join(repo, 'dirty.txt')));
  assert.strictEqual(fs.readFileSync(path.join(repo, 'node_modules', 'left.js'), 'utf8'), 'stay\n');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('commitExists / resetHardClean: 40桁の16進数以外は拒否する', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-sha-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  g('add', '.');
  g('commit', '-qm', 'init');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
  assert.strictEqual(await git.commitExists(repo, sha), true);
  assert.strictEqual(await git.commitExists(repo, 'a'.repeat(40)), false);
  for (const bad of ['HEAD', 'main', sha.slice(0, 7), sha.toUpperCase(), `${sha}\n`, ` ${sha}`, `${sha} --hard`, '', null, undefined, `../${sha.slice(0, 37)}`]) {
    await assert.rejects(() => git.commitExists(repo, bad), /コミットの指定が正しくありません/);
    await assert.rejects(() => git.resetHardClean(repo, bad), /コミットの指定が正しくありません/);
  }
  assert.strictEqual(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'a\n', '拒否したときはファイルを変えない');
  fs.rmSync(repo, { recursive: true, force: true });
});
