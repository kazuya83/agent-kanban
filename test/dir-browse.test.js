// 遠隔操作でホストのフォルダを辿る一覧（src/dir-browse.js）を確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listDirs, parentDir } = require('../src/dir-browse');

const tmpdir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-db-')));

test('listDirs: フォルダだけを名前順で返し、git リポジトリに印を付ける', () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'b-app'));
  fs.mkdirSync(path.join(root, 'a-repo', '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.writeFileSync(path.join(root, 'file.txt'), 'x');
  fs.symlinkSync(path.join(root, 'b-app'), path.join(root, 'c-link'));
  const r = listDirs(root);
  assert.strictEqual(r.path, root);
  assert.strictEqual(r.parent, path.dirname(root));
  assert.strictEqual(r.repo, false);
  assert.deepStrictEqual(
    r.dirs.map((d) => [d.name, d.repo]),
    [
      ['a-repo', true],
      ['b-app', false],
      ['c-link', false],
    ],
  );
  assert.strictEqual(r.dirs[0].path, path.join(root, 'a-repo'));
  assert.ok(listDirs(root, { showHidden: true }).dirs.some((d) => d.name === '.hidden'));
  assert.strictEqual(listDirs(path.join(root, 'a-repo')).repo, true);
});

test('listDirs: 無いフォルダ・ファイル・空のパスはエラー', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, 'f'), 'x');
  assert.throws(() => listDirs(path.join(root, 'nope')), /見つかりません/);
  assert.throws(() => listDirs(path.join(root, 'f')), /フォルダではありません/);
  assert.throws(() => listDirs(''), /空/);
});

test('parentDir: いちばん上では空を返す', () => {
  assert.strictEqual(parentDir('/'), '');
  assert.strictEqual(parentDir('/Users/me'), '/Users');
  assert.strictEqual(parentDir('C:\\Users\\me'), 'C:\\Users');
  assert.strictEqual(parentDir('C:\\'), '');
  assert.strictEqual(parentDir('\\\\wsl.localhost\\Ubuntu\\home'), '\\\\wsl.localhost\\Ubuntu\\');
  assert.strictEqual(parentDir('\\\\wsl.localhost\\Ubuntu\\'), '');
});
