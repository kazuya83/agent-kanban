// フォルダの中のフォルダを並べる（遠隔操作中に、ホストのフォルダを操作側の画面で辿って選ぶため）
// ホストの画面にダイアログを出すと操作側からは閉じられないので、一覧を返して操作側で描く
const fs = require('fs');
const path = require('path');
const wsl = require('./wsl');
const { tr } = require('../renderer/i18n');

// 一度に返すフォルダの数（node_modules のような大きいフォルダで重くならないように）
const MAX_ENTRIES = 1000;

// パスの書き方（Windows のドライブ・UNC・WSL なら \ 区切り）に合った path を使う
function pathApi(p) {
  return process.platform === 'win32' || /^[A-Za-z]:[\\/]|^\\\\/.test(String(p || '')) || wsl.isWslPath(p) ? path.win32 : path.posix;
}

// 1つ上のフォルダ。いちばん上（/ や C:\ や \\wsl.localhost\Ubuntu\）なら ''
function parentDir(p) {
  const api = pathApi(p);
  const s = api.resolve(p);
  const up = api.dirname(s);
  if (!up || up === s) return '';
  // \\wsl.localhost\Ubuntu の上（\\wsl.localhost）は開けないので止める
  if (wsl.isWslPath(s) && !wsl.isWslPath(up)) return '';
  return up;
}

function isRepo(dir) {
  try {
    return fs.existsSync(pathApi(dir).join(dir, '.git'));
  } catch {
    return false;
  }
}

// dir の中のフォルダ（隠しフォルダは showHidden のときだけ）を名前順で返す
function listDirs(dir, { showHidden = false } = {}) {
  const raw = String(dir || '').trim();
  if (!raw) throw new Error(tr('フォルダのパスが空です'));
  const api = pathApi(raw);
  const abs = api.resolve(raw);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    throw new Error(tr('フォルダが見つかりません: {abs}', { abs }));
  }
  if (!st.isDirectory()) throw new Error(tr('フォルダではありません: {abs}', { abs }));
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (err) {
    throw new Error(tr('フォルダの中を読めませんでした（{abs}）: {v}', { abs, v: err.code || err.message }));
  }
  const dirs = [];
  for (const e of entries) {
    if (!showHidden && e.name.startsWith('.')) continue;
    const full = api.join(abs, e.name);
    let isDir = e.isDirectory();
    if (!isDir && e.isSymbolicLink()) {
      try {
        isDir = fs.statSync(full).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (isDir) dirs.push({ name: e.name, path: full });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  const truncated = dirs.length > MAX_ENTRIES;
  const shown = dirs.slice(0, MAX_ENTRIES).map((d) => ({ ...d, repo: isRepo(d.path) }));
  return { path: abs, parent: parentDir(abs), sep: api.sep, repo: isRepo(abs), dirs: shown, truncated };
}

module.exports = { listDirs, parentDir, MAX_ENTRIES };
