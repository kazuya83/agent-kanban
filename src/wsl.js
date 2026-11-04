// Windows から WSL（Ubuntu など）の中のリポジトリを扱う
//
// - アプリの中では、WSL のフォルダを Windows から見えるパス（\\wsl.localhost\Ubuntu\home\...）で持つ。
//   ファイルの読み書きは、そのパスでそのままできる
// - git と claude は、WSL の中で動かす（wsl.exe -d Ubuntu --cd /home/... -- ...）。
//   Windows 側の git や claude で WSL のファイルを扱うと、遅いうえに git の所有者チェックで止まり、
//   エージェントが npm install などをすると Windows 用のものが入ってしまうため
// - パスの形は、渡すときに Linux の形（/home/...）へ、受け取ったら Windows の形へ直す
const { execFile } = require('child_process');

// \\wsl.localhost\Ubuntu\home\me\repo / \\wsl$\Ubuntu\home\me\repo / //wsl.localhost/Ubuntu/home/me/repo
const WSL_RE = /^[\\/]{2}wsl(?:\.localhost|\$)[\\/]([^\\/]+)([\\/].*)?$/i;

/** @returns {{ distro: string, linux: string } | null} */
function parseWslPath(p) {
  const m = String(p || '').match(WSL_RE);
  if (!m) return null;
  const linux = (m[2] || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return { distro: m[1], linux };
}

function isWslPath(p) {
  return !!parseWslPath(p);
}

// WSL の中のパス（/home/...）を、Windows から見えるパスにする
function toUnc(distro, linuxPath) {
  const lp = String(linuxPath || '/').replace(/\/+$/, '') || '/';
  return `\\\\wsl.localhost\\${distro}${lp === '/' ? '\\' : lp.replace(/\//g, '\\')}`;
}

// Windows のパスを、WSL の中から見えるパスにする（C:\Users\me → /mnt/c/Users/me、WSL のフォルダは /home/...）
function toLinux(p) {
  const w = parseWslPath(p);
  if (w) return w.linux;
  const m = String(p || '').match(/^([A-Za-z]):[\\/]?(.*)$/);
  if (m) return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`.replace(/\/+$/, '');
  return String(p);
}

// git などが返した Linux のパスを、基準のフォルダ（ref）が WSL なら Windows から見えるパスに戻す
function fromLinux(ref, p) {
  const w = parseWslPath(ref);
  if (!w || !p || !String(p).startsWith('/')) return p;
  return toUnc(w.distro, p);
}

function wslExe() {
  return process.env.AGENT_KANBAN_WSL || 'wsl.exe';
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// WSL の中の、ログインした対話シェルの PATH（nvm などで入れた claude / node も見つかるように）
const pathCache = new Map();
function shellPath(distro) {
  if (pathCache.has(distro)) return pathCache.get(distro);
  const p = new Promise((resolve) => {
    execFile(
      wslExe(),
      ['-d', distro, '--exec', 'bash', '-lic', 'printf "__AK_PATH__%s__AK_PATH__" "$PATH"'],
      { windowsHide: true, timeout: 20000, encoding: 'utf8' },
      (err, stdout) => {
        const m = String(stdout || '').match(/__AK_PATH__([\s\S]*?)__AK_PATH__/);
        resolve(m ? m[1] : '');
      },
    );
  });
  pathCache.set(distro, p);
  return p;
}

/**
 * WSL の中で cmd を動かすための wsl.exe の引数を作る
 * @param {string} distro
 * @param {string} linuxCwd  WSL の中の作業フォルダ（/home/...）
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ env?: Record<string,string>, path?: string }} opts
 */
function command(distro, linuxCwd, cmd, args, opts = {}) {
  const exports = [];
  if (opts.path) exports.push(`export PATH=${shQuote(opts.path)}`);
  for (const [k, v] of Object.entries(opts.env || {})) exports.push(`export ${k}=${shQuote(v)}`);
  const script = `${exports.map((e) => `${e}; `).join('')}exec "$0" "$@"`;
  // --exec: 引数をそのまま渡す（`--` だと、wsl.exe が引数を1つの文字列につなげてシェルに渡すので、引用が崩れる）
  return { file: wslExe(), args: ['-d', distro, '--cd', linuxCwd, '--exec', 'bash', '-c', script, cmd, ...args] };
}

// インストールされている WSL のディストリビューション（Ubuntu など）
function listDistros() {
  if (process.platform !== 'win32' && !process.env.AGENT_KANBAN_WSL) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(wslExe(), ['-l', '-q'], { windowsHide: true, timeout: 15000, encoding: 'buffer' }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      // wsl.exe -l は UTF-16LE で出力する
      const buf = Buffer.from(stdout);
      const text = buf.includes(0) ? buf.toString('utf16le') : buf.toString('utf8');
      resolve(
        text
          .replace(/\0/g, '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !/^docker-desktop/i.test(s)),
      );
    });
  });
}

// WSL の中のホームフォルダ（/home/me）
const homeCache = new Map();
function homeDir(distro) {
  if (homeCache.has(distro)) return homeCache.get(distro);
  const p = new Promise((resolve) => {
    const c = command(distro, '/', 'sh', ['-c', 'printf %s "$HOME"']);
    execFile(c.file, c.args, { windowsHide: true, timeout: 15000, encoding: 'utf8' }, (err, stdout) => resolve(err ? '' : String(stdout).trim()));
  });
  homeCache.set(distro, p);
  return p;
}

// WSL の中の Claude Code の設定フォルダ（~/.claude）を、Windows から見えるパスで
async function claudeConfigDir(distro) {
  const home = await homeDir(distro);
  return home ? toUnc(distro, `${home}/.claude`) : null;
}

// WSL の中に cmd があるか（git / claude）
async function which(distro, cmd) {
  const c = command(distro, '/', 'sh', ['-c', `command -v ${shQuote(cmd)}`], { path: await shellPath(distro) });
  return new Promise((resolve) => {
    execFile(c.file, c.args, { windowsHide: true, timeout: 15000, encoding: 'utf8' }, (err, stdout) => resolve(err ? null : String(stdout).trim() || null));
  });
}

module.exports = { parseWslPath, isWslPath, toUnc, toLinux, fromLinux, command, shellPath, listDistros, homeDir, claudeConfigDir, which, wslExe };
