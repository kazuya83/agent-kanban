// 差分タブ用の renderer/diff-parse.js（git diff の解析とフォルダツリー）を確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const git = require('../src/git');
const { parseDiff, buildTree, treeOrder, unquote } = require('../renderer/diff-parse');

test('parseDiff: 実際の git diff から、ファイルごとの状態・行番号・増減を取り出す', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kanban-diff-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(repo, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'lib', 'a.js'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(repo, 'old.txt'), 'bye\n');
  fs.writeFileSync(path.join(repo, 'move-me.txt'), 'same content here\nline 2\nline 3\n');
  g('add', '.');
  g('commit', '-qm', 'init');
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();

  fs.writeFileSync(path.join(repo, 'src', 'lib', 'a.js'), 'one\n2\nthree\nfour\n');
  fs.unlinkSync(path.join(repo, 'old.txt'));
  g('mv', 'move-me.txt', 'moved.txt');
  fs.writeFileSync(path.join(repo, '日本語 ファイル.md'), '# こんにちは\n'); // 未追跡

  const files = parseDiff(await git.diff(repo, base));
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['moved.txt', 'old.txt', 'src/lib/a.js', '日本語 ファイル.md'].sort());

  const a = by['src/lib/a.js'];
  assert.strictEqual(a.status, 'M');
  assert.deepStrictEqual([a.add, a.del], [2, 1]);
  const lines = a.hunks[0].lines;
  assert.deepStrictEqual(lines.find((l) => l.type === 'del'), { type: 'del', text: 'two', oldNo: 2 });
  assert.deepStrictEqual(lines.find((l) => l.text === 'four'), { type: 'add', text: 'four', newNo: 4 });
  assert.deepStrictEqual(lines[0], { type: 'ctx', text: 'one', oldNo: 1, newNo: 1 });

  assert.strictEqual(by['old.txt'].status, 'D');
  assert.strictEqual(by['old.txt'].del, 1);
  assert.strictEqual(by['moved.txt'].status, 'R');
  assert.strictEqual(by['moved.txt'].oldPath, 'move-me.txt');
  assert.strictEqual(by['日本語 ファイル.md'].status, 'A');
  assert.strictEqual(by['日本語 ファイル.md'].add, 1);
});

test('parseDiff: 削除行が "-- " で始まっても見出しと取り違えない・バイナリ・改行なし', () => {
  const text = [
    'diff --git a/x.sql b/x.sql',
    'index 1..2 100644',
    '--- a/x.sql',
    '+++ b/x.sql',
    '@@ -1,2 +1,1 @@',
    '--- comment',
    ' keep',
    '\\ No newline at end of file',
    'diff --git a/img.png b/img.png',
    'index 1..2 100644',
    'Binary files a/img.png and b/img.png differ',
    '',
  ].join('\n');
  const [x, img] = parseDiff(text);
  assert.strictEqual(x.path, 'x.sql');
  assert.deepStrictEqual(x.hunks[0].lines.map((l) => [l.type, l.text]), [['del', '-- comment'], ['ctx', 'keep'], ['meta', 'No newline at end of file']]);
  assert.strictEqual(img.binary, true);
  assert.strictEqual(img.status, 'M');
});

test('unquote: git がエスケープしたパスを戻す', () => {
  assert.strictEqual(unquote('"a/\\343\\201\\202 b\\"c"'), 'a/あ b"c');
  assert.strictEqual(unquote('plain'), 'plain');
});

test('buildTree: フォルダごとにまとめ、子が1つのフォルダはつなげる', () => {
  const files = ['src/lib/a.js', 'src/lib/b.js', 'README.md', 'src/main.js', 'docs/img/x.png'].map((p) => ({ path: p }));
  const tree = buildTree(files);
  assert.deepStrictEqual(tree.dirs.map((d) => d.name), ['docs/img', 'src']);
  assert.deepStrictEqual(tree.files.map((f) => f.name), ['README.md']);
  const src = tree.dirs[1];
  assert.deepStrictEqual(src.dirs.map((d) => d.name), ['lib']);
  assert.deepStrictEqual(src.files.map((f) => f.name), ['main.js']);
  assert.deepStrictEqual(treeOrder(tree).map((i) => files[i].path), ['docs/img/x.png', 'src/lib/a.js', 'src/lib/b.js', 'src/main.js', 'README.md']);
});

test('splitRows: 消した行と足した行を左右の組にし、同じ行は両側に並べる', () => {
  const { splitRows } = require('../renderer/diff-parse');
  const [f] = parseDiff(
    [
      'diff --git a/x.txt b/x.txt',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1,5 +1,5 @@',
      ' a',
      '-b',
      '-c',
      '+B',
      ' d',
      '+e',
      '-f',
      '\\ No newline at end of file',
    ].join('\n'),
  );
  const rows = splitRows(f.hunks[0]);
  const view = rows.map((r) => (r.type === 'meta' ? ['meta', r.text] : [r.left && `${r.left.type}:${r.left.text}`, r.right && `${r.right.type}:${r.right.text}`]));
  assert.deepStrictEqual(view, [
    ['ctx:a', 'ctx:a'],
    ['del:b', 'add:B'],
    ['del:c', null],
    ['ctx:d', 'ctx:d'],
    [null, 'add:e'],
    ['del:f', null],
    ['meta', 'No newline at end of file'],
  ]);
  assert.strictEqual(rows[1].left.oldNo, 2);
  assert.strictEqual(rows[1].right.newNo, 2);
});
