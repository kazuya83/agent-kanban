// 遠隔操作（クライアント側）で使う SSH の鍵を、アプリの中で作る
// 公開鍵をホストに登録するのはユーザーがやる（ホストのパスワードはアプリから入力できないため）
// アプリから ssh は BatchMode で動かすので、パスフレーズなしの専用の鍵を作る
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { tr } = require('../renderer/i18n');

const KEY_NAME = 'agent-kanban_ed25519';

function defaultKeyPath(home = os.homedir()) {
  return path.join(home, '.ssh', KEY_NAME);
}

// ~ で始まるパスをホームに直す
function expandHome(p, home = os.homedir()) {
  const s = String(p || '').trim();
  if (s === '~') return home;
  if (/^~[\\/]/.test(s)) return path.join(home, s.slice(2));
  return s;
}

function readPublicKey(keyPath) {
  try {
    return fs.readFileSync(`${keyPath}.pub`, 'utf8').trim();
  } catch {
    return '';
  }
}

// 鍵の状態。keyPath が空なら、アプリの専用の鍵の場所を見る
function keyStatus({ keyPath = '', home = os.homedir() } = {}) {
  const p = expandHome(keyPath, home) || defaultKeyPath(home);
  const exists = fs.existsSync(p);
  const publicKey = exists ? readPublicKey(p) : '';
  return { path: p, pubPath: `${p}.pub`, exists, publicKey, isDefault: p === defaultKeyPath(home) };
}

// ssh のパスから、同じ場所にある ssh-keygen を探す（Windows の System32\OpenSSH\ssh.exe など）
function keygenCommandFor(sshCommand) {
  const cmd = String(sshCommand || '').trim() || 'ssh';
  // Windows のパス（\ 区切り）は、どの OS で動いていても Windows のやり方で分ける
  const p = /\\/.test(cmd) ? path.win32 : path;
  const base = p.basename(cmd).toLowerCase();
  if (base !== 'ssh' && base !== 'ssh.exe') return 'ssh-keygen';
  if (cmd.toLowerCase() === base) return 'ssh-keygen';
  return p.join(p.dirname(cmd), base.endsWith('.exe') ? 'ssh-keygen.exe' : 'ssh-keygen');
}

// 鍵を作る。もうあれば作り直さずに、その鍵を返す
async function generateKey({ keyPath = '', command = 'ssh-keygen', prefixArgs = [], comment = '', home = os.homedir() } = {}) {
  const st = keyStatus({ keyPath, home });
  if (st.exists) {
    if (!st.publicKey) throw new Error(tr('鍵 {path} はありますが、公開鍵（{pubPath}）が読めません。ssh-keygen -y -f "{path2}" > "{pubPath2}" で作り直せます', { path: st.path, pubPath: st.pubPath, path2: st.path, pubPath2: st.pubPath }));
    return { ...st, created: false };
  }
  const dir = path.dirname(st.path);
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* 権限を変えられない場所でも続ける */
    }
  }
  let user = '';
  try {
    user = os.userInfo().username || '';
  } catch {
    /* 取れない環境もある */
  }
  const c = comment || `agent-kanban ${user ? `${user}@` : ''}${os.hostname()}`;
  // -N "" でパスフレーズなし（Windows の ssh-keygen にも空文字の引数として渡る）
  const args = [...prefixArgs, '-t', 'ed25519', '-N', '', '-C', c, '-f', st.path, '-q'];
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 30000 }, (err, _stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          reject(new Error(tr('ssh-keygen が見つかりません。Windows なら「設定 → システム → オプション機能」で「OpenSSH クライアント」を追加してください')));
          return;
        }
        reject(new Error(tr('鍵を作れませんでした: {message}', { message: String(stderr || err.message).trim() })));
        return;
      }
      const after = keyStatus({ keyPath: st.path, home });
      if (!after.exists || !after.publicKey) {
        reject(new Error(tr('鍵を作れませんでした（{path} ができていません）', { path: st.path })));
        return;
      }
      resolve({ ...after, created: true });
    });
  });
}

// PowerShell の '…' の中に入れる
function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}
// sh の '…' の中に入れる
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// 公開鍵をホストに登録するコマンド（ユーザーがホストで実行する）
function registerCommands(publicKey) {
  const k = String(publicKey || '').trim();
  return {
    // ホストが Mac（Linux も同じ）: ホストのターミナルで
    mac: `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo ${shQuote(k)} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
    // ホストが Windows で、ユーザーが管理者: 管理者の PowerShell で
    winAdmin: `Add-Content -Path C:\\ProgramData\\ssh\\administrators_authorized_keys -Value ${psQuote(k)}; icacls.exe C:\\ProgramData\\ssh\\administrators_authorized_keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"`,
    // ホストが Windows で、ユーザーが管理者ではない: PowerShell で
    winUser: `New-Item -ItemType Directory -Force $env:USERPROFILE\\.ssh | Out-Null; Add-Content -Path $env:USERPROFILE\\.ssh\\authorized_keys -Value ${psQuote(k)}`,
  };
}

// ---------------- ホスト側: 受け取った公開鍵を登録する ----------------

const KEY_TYPE = /^(ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/;

// 公開鍵ファイルの中身から、登録する1行を取り出す。秘密鍵や関係ないファイルは断る
function parsePublicKey(text) {
  const s = String(text || '');
  if (/PRIVATE KEY-----/.test(s)) {
    throw new Error(tr('選んだのは秘密鍵です。ホストに渡すのは「.pub」で終わる公開鍵だけです（秘密鍵は操作側の PC から出さないでください）'));
  }
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length !== 1) throw new Error(tr('公開鍵のファイルではないようです（ssh-ed25519 AAAA… の1行が入った .pub ファイルを選んでください）'));
  const [type, body, ...rest] = lines[0].split(/\s+/);
  if (!KEY_TYPE.test(type || '') || !/^[A-Za-z0-9+/]+={0,3}$/.test(body || '') || body.length < 40) {
    throw new Error(tr('公開鍵のファイルではないようです（ssh-ed25519 AAAA… の1行が入った .pub ファイルを選んでください）'));
  }
  return { line: [type, body, ...rest].join(' '), type, body, comment: rest.join(' ') };
}

// 公開鍵を置く場所。Windows の管理者のユーザーは、sshd が ~/.ssh/authorized_keys を見ない
function authorizedKeysPath({ platform = process.platform, isAdmin = false, home = os.homedir(), programData = process.env.ProgramData || 'C:\\ProgramData' } = {}) {
  if (platform === 'win32' && isAdmin) return path.join(programData, 'ssh', 'administrators_authorized_keys');
  return path.join(home, '.ssh', 'authorized_keys');
}

// Windows でいまのユーザーが Administrators グループに入っているか（昇格していなくても入っていれば true）
function windowsIsAdmin() {
  return new Promise((resolve) => {
    execFile('whoami', ['/groups'], { windowsHide: true, timeout: 10000 }, (err, stdout) => resolve(!err && /S-1-5-32-544/.test(String(stdout))));
  });
}

// 公開鍵を authorized_keys に足す。同じ鍵がもうあれば足さない
// run: Windows の管理者用ファイルの権限を icacls で絞る（テストでは差し替える）
async function installPublicKey({ text, platform = process.platform, isAdmin, home = os.homedir(), programData, run } = {}) {
  const key = parsePublicKey(text);
  if (platform === 'win32' && isAdmin === undefined) isAdmin = await windowsIsAdmin();
  const file = authorizedKeysPath({ platform, isAdmin, home, programData });
  const admin = platform === 'win32' && isAdmin;
  let current = '';
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw permissionError(err, file, key.line, admin);
  }
  const already = current.split(/\r?\n/).some((l) => l.trim().split(/\s+/)[1] === key.body);
  if (!already) {
    try {
      const dir = path.dirname(file);
      fs.mkdirSync(dir, { recursive: true });
      if (platform !== 'win32') fs.chmodSync(dir, 0o700);
      const sep = current && !/\n$/.test(current) ? (platform === 'win32' ? '\r\n' : '\n') : '';
      fs.appendFileSync(file, `${sep}${key.line}${platform === 'win32' ? '\r\n' : '\n'}`);
      if (platform !== 'win32') fs.chmodSync(file, 0o600);
    } catch (err) {
      throw permissionError(err, file, key.line, admin);
    }
  }
  if (admin) {
    const icacls = run || ((cmd, args) => new Promise((res, rej) => execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (e, _o, se) => (e ? rej(new Error(String(se || e.message).trim())) : res()))));
    try {
      await icacls('icacls.exe', [file, '/inheritance:r', '/grant', 'Administrators:F', '/grant', 'SYSTEM:F']);
    } catch (err) {
      throw new Error(tr('公開鍵は {file} に入れましたが、権限を絞れませんでした（{message}）。管理者の PowerShell で icacls.exe {file2} /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" を実行してください', { file, message: err.message, file2: file }));
    }
  }
  return { file, added: !already, key: key.line, comment: key.comment, admin };
}

function permissionError(err, file, line, admin) {
  if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
    const cmd = admin ? registerCommands(line).winAdmin : registerCommands(line).mac;
    return new Error(admin
      ? tr('{file} に書き込めませんでした（権限がありません）。このユーザーは管理者なので、公開鍵は管理者用のファイルに入れる必要があります。Agent Kanban を「管理者として実行」で開き直すか、次のコマンドを管理者の PowerShell で実行してください: {cmd}', { file, cmd })
      : tr('{file} に書き込めませんでした（権限がありません）。次のコマンドをターミナルで実行してください: {cmd}', { file, cmd }));
  }
  return err;
}

module.exports = { KEY_NAME, parsePublicKey, authorizedKeysPath, installPublicKey, windowsIsAdmin, defaultKeyPath, expandHome, keyStatus, keygenCommandFor, generateKey, registerCommands, psQuote, shQuote };
