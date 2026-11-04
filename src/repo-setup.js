// リポジトリをクローンする・新しく作る
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const git = require('./git');
const wsl = require('./wsl');
const { resolveCommand } = require('./env');

// 受け付ける URL: https:// / http:// / ssh:// / git://、git@host:owner/repo、owner/repo（GitHub とみなす）
// ext:: や file:// など、コマンドを動かせたり手元のファイルを読めたりする形は受け付けない
function normalizeCloneUrl(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('クローンする URL を入れてください');
  if (/\s/.test(s)) throw new Error('URL に空白が入っています');
  if (/^(https?|ssh|git):\/\/[^\s/]+\/.+/i.test(s)) return s;
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s/-][^\s]*$/.test(s)) return s; // git@github.com:owner/repo.git
  const short = s.match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(\.git)?$/);
  if (short && !short[2].startsWith('.')) return `https://github.com/${short[1]}/${short[2]}.git`;
  throw new Error(`この URL ではクローンできません（${s}）。https://github.com/owner/repo や git@github.com:owner/repo.git、owner/repo の形で入れてください`);
}

// URL からフォルダ名を決める（https://github.com/owner/repo.git → repo）
function repoNameFromUrl(url) {
  const s = String(url || '').trim().replace(/[\\/]+$/, '');
  const last = s.split(/[/:]/).pop() || '';
  return last.replace(/\.git$/i, '');
}

function validateName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('フォルダ名を入れてください');
  if (/[\\/:*?"<>|\0]/.test(n) || /[\x00-\x1f]/.test(n)) throw new Error(`フォルダ名に使えない文字が入っています（${n}）`);
  if (/^[.-]/.test(n)) throw new Error('フォルダ名は「.」や「-」で始められません');
  if (n.length > 100) throw new Error('フォルダ名が長すぎます');
  return n;
}

// 置き場所（親フォルダ）の中に name のフォルダを作る場所。すでに中身があればエラー
function targetDir(parent, name) {
  const p = String(parent || '').trim();
  if (!p) throw new Error('置き場所のフォルダを選んでください');
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    throw new Error(`置き場所のフォルダが見つかりません（${p}）`);
  }
  if (!st.isDirectory()) throw new Error(`置き場所がフォルダではありません（${p}）`);
  const dir = (wsl.isWslPath(p) ? path.win32 : path).join(p, validateName(name));
  if (fs.existsSync(dir) && (!fs.statSync(dir).isDirectory() || fs.readdirSync(dir).length)) throw new Error(`同じ名前のフォルダがすでにあります（${dir}）`);
  return dir;
}

/** URL のリポジトリを parent/name にクローンする。返すのはクローンしたフォルダ */
async function cloneRepo({ url, parent, name }) {
  const u = normalizeCloneUrl(url);
  return cloneFrom(u, parent, String(name || '').trim() || repoNameFromUrl(u));
}

// URL を確かめずにクローンする（cloneRepo の中身。テストでは手元のリポジトリから）
async function cloneFrom(u, parent, name) {
  const dir = targetDir(parent, name);
  try {
    // -- のあとに置いて、URL がオプションとして読まれないようにする
    await git.git(parent, ['clone', '--', u, path.basename(dir.replace(/\\/g, '/'))], { network: true, timeout: 30 * 60 * 1000 });
  } catch (err) {
    const msg = String(err.stderr || err.message || '');
    if (/Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)/i.test(msg)) {
      throw new Error(`認証できなかったのでクローンできませんでした。非公開のリポジトリなら、ターミナルで一度 git clone して認証を済ませるか、gh にログインしてください。\n${msg.trim()}`);
    }
    if (/not found|does not exist/i.test(msg)) throw new Error(`リポジトリが見つかりませんでした（${u}）\n${msg.trim()}`);
    throw err;
  }
  return dir;
}

function runGh(args, cwd) {
  const gh = resolveCommand('gh');
  if (!gh) return Promise.reject(new Error('GitHub にも作るには gh（GitHub CLI）が必要です。設定の画面からインストール・ログインしてください'));
  return new Promise((resolve, reject) => {
    execFile(gh, args, { cwd, windowsHide: true, timeout: 180000, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`GitHub にリポジトリを作れませんでした: ${String(stderr || err.message).trim()}`));
      resolve(String(stdout || ''));
    });
  });
}

/**
 * parent/name に新しいリポジトリを作る（README.md だけの最初のコミットまで）。
 * github: '' なら手元だけ、'private' / 'public' なら GitHub にも作って push する
 * @returns {Promise<{ dir: string, github: string, warning?: string }>}
 */
async function createRepo({ parent, name, github = '' }) {
  const n = validateName(name);
  if (github && !['private', 'public'].includes(github)) throw new Error('GitHub の公開範囲が正しくありません');
  if (github && wsl.isWslPath(parent)) throw new Error('WSL のフォルダでは、GitHub にも作ることはできません。手元に作ってから、WSL の中で gh repo create してください');
  const dir = targetDir(parent, n);
  fs.mkdirSync(dir, { recursive: true });
  await git.git(dir, ['init', '-q']);
  // 古い git でも main になるように（-b は git 2.28 から）
  await git.git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  // コミットが1つもないと worktree を作れないので、README.md で最初のコミットを作る
  fs.writeFileSync((wsl.isWslPath(dir) ? path.win32 : path).join(dir, 'README.md'), `# ${n}\n`);
  await git.git(dir, ['add', 'README.md']);
  await git.git(dir, [...(await git.identityArgs(dir)), 'commit', '-q', '-m', 'Initial commit']);
  if (!github) return { dir, github: '' };
  try {
    await runGh(['repo', 'create', n, `--${github}`, '--source', '.', '--remote', 'origin', '--push'], dir);
  } catch (err) {
    // 手元のリポジトリはできているので、開いたうえで知らせる
    return { dir, github: '', warning: `手元のリポジトリは作りましたが、${err.message}` };
  }
  return { dir, github };
}

module.exports = { normalizeCloneUrl, repoNameFromUrl, validateName, targetDir, cloneRepo, cloneFrom, createRepo };
