// デスクトップアプリとして起動したときの環境まわり
// macOS の Finder などから起動すると、ターミナルで設定した PATH が引き継がれず
// claude や node が見つからないので、ログインシェルの PATH と、よくあるインストール先を足す。
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';

function extraDirs() {
  const h = os.homedir();
  if (isWin) {
    return [
      path.join(h, '.local', 'bin'), // Claude Code のネイティブインストーラー
      path.join(process.env.APPDATA || path.join(h, 'AppData', 'Roaming'), 'npm'), // npm install -g
      path.join(h, '.claude', 'local'),
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\nodejs',
    ];
  }
  return [
    path.join(h, '.local', 'bin'),
    path.join(h, '.claude', 'local'),
    path.join(h, '.npm-global', 'bin'),
    path.join(h, '.volta', 'bin'),
    path.join(h, '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
}

function loginShellPath() {
  if (isWin) return '';
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  try {
    const out = execFileSync(shell, ['-ilc', 'printf "__AK_PATH__%s__AK_PATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.match(/__AK_PATH__([\s\S]*?)__AK_PATH__/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function fixPath() {
  const parts = [...(process.env.PATH || '').split(path.delimiter), ...loginShellPath().split(path.delimiter), ...extraDirs()]
    .map((p) => p.trim())
    .filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(path.delimiter);
}

// コマンド名をフルパスにする。見つからなければ null
function resolveCommand(cmd) {
  if (!cmd) return null;
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  const isFile = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (cmd.includes('/') || cmd.includes('\\')) {
    if (isFile(cmd)) return cmd;
    for (const e of exts) if (e && isFile(cmd + e)) return cmd + e;
    return null;
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = path.join(dir, cmd + e);
      if (isFile(p)) return p;
    }
  }
  return null;
}

module.exports = { fixPath, resolveCommand, isWin };
