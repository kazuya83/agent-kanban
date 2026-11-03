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
  const sm = out.match(/Token scopes:\s*(.*)/);
  const scopes = sm ? sm[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
  // GH_TOKEN などで scope が出ないときは、分からない（null）にしておく
  const hasProjectScope = scopes ? scopes.includes('project') : null // 書き換えには read:project ではなく project が要る;
  return { ...base, installed: true, loggedIn: r.code === 0, user: m ? m[1] : '', scopes, hasProjectScope };
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

// ブラウザで確認コードを入れる流れ（ログイン・権限の追加）を動かす
async function deviceFlow(args, onEvent) {
  const gh = resolveCommand('gh');
  if (!gh) throw new Error('gh が入っていません');
  let sentCode = false;
  const code = await stream(
    gh,
    args,
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
  return code;
}

/**
 * ブラウザで GitHub にログインする（gh auth login --web）
 * @param {(ev: {type: 'code', code: string, url: string} | {type: 'line', line: string}) => void} onEvent
 */
async function login(onEvent) {
  const code = await deviceFlow(['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--scopes', 'project'], onEvent);
  const st = await status();
  if (!st.loggedIn) throw new Error(code === 0 ? 'ログインを確認できませんでした' : `ログインに失敗しました（終了コード ${code}）`);
  return st;
}

/**
 * GitHub Projects のステータスを変えられるように、gh に project の権限を足す（gh auth refresh -s project）
 * @param {(ev: {type: 'code', code: string, url: string} | {type: 'line', line: string}) => void} onEvent
 */
async function addProjectScope(onEvent) {
  const code = await deviceFlow(['auth', 'refresh', '--hostname', 'github.com', '--scopes', 'project'], onEvent);
  const st = await status();
  if (code !== 0 || st.hasProjectScope === false) throw new Error(code === 0 ? 'project の権限を確認できませんでした' : `権限の追加に失敗しました（終了コード ${code}）`);
  return st;
}

/**
 * プルリクエストを作る。同じブランチの PR が開いていればそれを返す
 * @param {{ cwd: string, head: string, base: string, title: string, body: string, gh?: string }} p
 * @returns {Promise<{ url: string, number: number|null, created: boolean }>}
 */
async function createPullRequest({ cwd, head, base, title, body, gh: ghPath }) {
  const gh = ghPath || resolveCommand('gh');
  if (!gh) throw new Error('PR を作るには GitHub CLI（gh）が必要です。「Issue から」の画面からインストールとログインができます');
  const opts = { cwd, timeout: 60000 };
  const view = await run(gh, ['pr', 'view', head, '--json', 'url,number,state'], opts);
  if (view.code === 0) {
    try {
      const d = JSON.parse(view.stdout);
      if (String(d.state).toUpperCase() === 'OPEN' && d.url) return { url: d.url, number: d.number ?? null, created: false };
    } catch {
      /* 読めなければ新しく作る */
    }
  }
  const r = await run(gh, ['pr', 'create', '--head', head, '--base', base, '--title', title, '--body', body], opts);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout).trim();
    if (/auth login|not logged/i.test(msg)) throw new Error('GitHub にログインしていません。「Issue から」の画面からログインしてください');
    throw new Error(`PR を作れませんでした: ${msg}`);
  }
  const url = (r.stdout.match(/https:\/\/\S+\/pull\/\d+/) || [r.stdout.trim()])[0];
  const m = url.match(/\/pull\/(\d+)/);
  return { url, number: m ? Number(m[1]) : null, created: true };
}

/**
 * プルリクエストの今の状態を GitHub に聞く
 * @param {{ url: string, cwd?: string, gh?: string }} p
 * @returns {Promise<{ state: 'OPEN'|'CLOSED'|'MERGED', mergedAt: string|null, headRefOid: string|null, baseRefName: string|null, mergeable: 'MERGEABLE'|'CONFLICTING'|'UNKNOWN'|null }>}
 */
async function pullRequestState({ url, cwd, gh: ghPath }) {
  const gh = ghPath || resolveCommand('gh');
  if (!gh) throw new Error('PR の状態を確かめるには GitHub CLI（gh）が必要です');
  const r = await run(gh, ['pr', 'view', url, '--json', 'state,mergedAt,headRefOid,baseRefName,mergeable'], { cwd, timeout: 30000 });
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout).trim();
    if (/auth login|not logged/i.test(msg)) throw new Error('GitHub にログインしていません');
    throw new Error(msg || 'PR の状態を取れませんでした');
  }
  let d;
  try {
    d = JSON.parse(r.stdout);
  } catch {
    throw new Error('PR の状態を読めませんでした');
  }
  return {
    state: String(d.state || '').toUpperCase(),
    mergedAt: d.mergedAt || null,
    headRefOid: d.headRefOid || null,
    baseRefName: d.baseRefName || null,
    // MERGEABLE / CONFLICTING / UNKNOWN（GitHub が計算中のときは UNKNOWN）
    mergeable: d.mergeable ? String(d.mergeable).toUpperCase() : null,
  };
}

function cancel() {
  const c = stream.current;
  if (c && c.exitCode === null) c.kill();
}

module.exports = { status, install, login, addProjectScope, cancel, createPullRequest, pullRequestState, DOWNLOAD_URL, DEVICE_URL };
