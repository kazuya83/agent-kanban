// GitHub CLI（gh）の確認・インストール・ログイン
const { spawn, execFile } = require('child_process');
const { resolveCommand, isWin } = require('./env');

const DOWNLOAD_URL = 'https://cli.github.com/';
const DEVICE_URL = 'https://github.com/login/device';

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// gh のインストールに使えるパッケージマネージャー
function installer() {
  if (process.platform === 'darwin') {
    const brew = resolveCommand('brew');
    return brew ? { name: 'Homebrew', cmd: brew, args: ['install', 'gh'], label: 'brew install gh' } : null;
  }
  if (isWin) {
    const winget = resolveCommand('winget');
    return winget
      ? {
          name: 'winget',
          cmd: winget,
          args: ['install', '--id', 'GitHub.cli', '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements'],
          label: 'winget install GitHub.cli',
        }
      : null;
  }
  return null; // Linux はディストリごとに違うので、ダウンロードページを案内する
}

/** @returns {Promise<{installed: boolean, path: string|null, loggedIn: boolean, user: string, installer: string|null, installLabel: string|null, downloadUrl: string}>} */
async function status() {
  const gh = resolveCommand('gh');
  const inst = installer();
  const base = { path: gh, installer: inst ? inst.name : null, installLabel: inst ? inst.label : null, downloadUrl: DOWNLOAD_URL };
  if (!gh) return { ...base, installed: false, loggedIn: false, user: '' };
  const r = await run(gh, ['auth', 'status', '--hostname', 'github.com']);
  const out = r.stdout + r.stderr;
  const m = out.match(/account\s+(\S+)/) || out.match(/Logged in to github\.com as\s+(\S+)/);
  return { ...base, installed: true, loggedIn: r.code === 0, user: m ? m[1] : '' };
}

// 出力を1行ずつ onLine に渡しながらコマンドを動かす
function stream(cmd, args, onLine, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '' } });
    let buf = '';
    const feed = (d) => {
      buf += d;
      let i;
      // \r も改行として扱う（進捗表示）
      while ((i = buf.search(/[\r\n]/)) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) onLine(line);
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.stdin.on('error', () => {});
    if (stdin !== undefined) child.stdin.end(stdin);
    child.on('error', reject);
    child.on('close', (code) => {
      if (buf.trim()) onLine(buf.trim());
      resolve(code);
    });
    stream.current = child;
  });
}

async function install(onLine) {
  if (resolveCommand('gh')) return status();
  const inst = installer();
  if (!inst) throw new Error(`この環境では自動でインストールできません。${DOWNLOAD_URL} からインストールしてください`);
  onLine(`$ ${inst.label}`);
  const code = await stream(inst.cmd, inst.args, onLine);
  const st = await status();
  if (!st.installed) {
    throw new Error(code === 0 ? 'インストールは終わりましたが gh が見つかりません。アプリを再起動してください' : `インストールに失敗しました（終了コード ${code}）`);
  }
  return st;
}

/**
 * ブラウザで GitHub にログインする（gh auth login --web）
 * @param {(ev: {type: 'code', code: string, url: string} | {type: 'line', line: string}) => void} onEvent
 */
async function login(onEvent) {
  const gh = resolveCommand('gh');
  if (!gh) throw new Error('gh が入っていません');
  let sentCode = false;
  const code = await stream(
    gh,
    ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'],
    (line) => {
      const m = line.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
      if (m && !sentCode) {
        sentCode = true;
        const u = line.match(/https:\/\/\S+/);
        onEvent({ type: 'code', code: m[1], url: u ? u[0] : DEVICE_URL });
        return;
      }
      onEvent({ type: 'line', line });
    },
    { stdin: '\n' }, // 「Enter を押すとブラウザを開きます」で止まらないようにする
  );
  const st = await status();
  if (!st.loggedIn) throw new Error(code === 0 ? 'ログインを確認できませんでした' : `ログインに失敗しました（終了コード ${code}）`);
  return st;
}

function cancel() {
  const c = stream.current;
  if (c && c.exitCode === null) c.kill();
}

module.exports = { status, install, login, cancel, DOWNLOAD_URL, DEVICE_URL };
