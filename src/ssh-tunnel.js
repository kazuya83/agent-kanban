// クライアント側で SSH のポート転送（ssh -N -L）を張る
// ホストの Agent Kanban は 127.0.0.1 でしか待ち受けないので、Tailscale の IP などへは
// 直接つながらない。アプリが ssh を起動し、手元の空きポート → ホストの 127.0.0.1:port へ転送する
const net = require('net');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const READY_TIMEOUT_MS = 30 * 1000;
const POLL_MS = 200;

function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => {
      sock.removeAllListeners();
      sock.on('error', () => {});
      sock.destroy();
      resolve(ok);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(2000, () => done(false));
  });
}

// ssh の標準エラーを、原因と直し方が分かる文にする
function explainSshError(stderr, { host = '', user = '', sshPort = 22, spawnError = null } = {}) {
  if (spawnError && spawnError.code === 'ENOENT') {
    return 'ssh コマンドが見つかりません。Windows なら「設定 → システム → オプション機能」で「OpenSSH クライアント」を追加してください（ssh のフルパスを設定で指定することもできます）';
  }
  const text = String(stderr || '').trim();
  const target = `${user ? `${user}@` : ''}${host}:${sshPort}`;
  if (/timed out|ETIMEDOUT/i.test(text)) {
    return `SSH の接続がタイムアウトしました（${target}）。Mac の「システム設定 → 一般 → 共有 → リモートログイン」がオンか、Tailscale が両方の PC で接続中か、IP やホスト名が合っているかを確かめてください`;
  }
  if (/Connection refused/i.test(text)) {
    return `SSH の接続を断られました（${target}）。Mac の「システム設定 → 一般 → 共有 → リモートログイン」をオンにしてください（SSH のポートが 22 以外ならそれも合わせてください）`;
  }
  if (/Could not resolve hostname|Name or service not known|No such host/i.test(text)) {
    return `SSH の接続先「${host}」が見つかりません。Tailscale の IP（100.x.x.x）か、Tailscale の管理画面に出ているマシン名を入れてください`;
  }
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) {
    return `ホストの鍵が以前と違うため止めました（${host}）。Mac を入れ直したなど心当たりがあるときは、ターミナルで ssh-keygen -R ${host} を実行してからもう一度接続してください`;
  }
  if (/Permission denied|Too many authentication failures|no mutual signature/i.test(text)) {
    return `SSH の認証に失敗しました（${target}）。アプリからはパスワードを入力できないので、鍵で入れるようにしてください: 操作側で ssh-keygen -t ed25519 を実行し、できた公開鍵（~/.ssh/id_ed25519.pub）の中身を Mac の ~/.ssh/authorized_keys に1行で足します。ユーザー名が Mac のログイン名と合っているかも確かめてください`;
  }
  if (/remote port forwarding failed|forwarding failed|open failed|administratively prohibited/i.test(text)) {
    return `SSH はつながりましたが、ポート転送を断られました。Mac の sshd_config で AllowTcpForwarding が no になっていないか確かめてください`;
  }
  const last = text.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ');
  return `SSH トンネルを張れませんでした（${target}）${last ? `: ${last}` : ''}`;
}

function sshArgs({ host, user, sshPort = 22, remotePort, localPort, identityFile }) {
  const args = [
    '-N',
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-p', String(sshPort),
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
  ];
  if (identityFile) args.push('-i', identityFile, '-o', 'IdentitiesOnly=yes');
  args.push(user ? `${user}@${host}` : host);
  return args;
}

class SshTunnel extends EventEmitter {
  // command: ssh のパス。prefixArgs: テストで node スクリプトを ssh 代わりにするため
  constructor({ command = 'ssh', prefixArgs = [], readyTimeoutMs = READY_TIMEOUT_MS } = {}) {
    super();
    this.command = command;
    this.prefixArgs = prefixArgs;
    this.readyTimeoutMs = readyTimeoutMs;
    this.child = null;
    this.localPort = 0;
    this.target = null;
  }

  active() {
    return !!this.child;
  }

  status() {
    return { active: this.active(), localPort: this.localPort, target: this.target };
  }

  // 転送が使えるようになったら、手元のポート番号を返す
  async open({ host, user = '', sshPort = 22, remotePort, identityFile = '' } = {}) {
    this.close();
    host = String(host || '').trim();
    user = String(user || '').trim();
    if (!host) throw new Error('SSH の接続先（Tailscale の IP かホスト名）を入れてください');
    if (/^-/.test(host) || /^-/.test(user) || /[\s@]/.test(user)) throw new Error('SSH の接続先かユーザー名が正しくありません');
    sshPort = Math.min(65535, Math.max(1, parseInt(sshPort, 10) || 22));
    const localPort = await freePort();
    const opts = { host, user, sshPort, remotePort, localPort, identityFile: String(identityFile || '').trim() };
    const child = spawn(this.command, [...this.prefixArgs, ...sshArgs(opts)], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.child = child;
    this.localPort = localPort;
    this.target = { host, user, sshPort, remotePort };
    let stderr = '';
    let spawnError = null;
    let exited = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-8000);
    });
    child.on('error', (err) => {
      spawnError = err;
      exited = true;
    });
    child.on('exit', (code) => {
      exited = true;
      if (this.child !== child) return;
      this.child = null;
      this.localPort = 0;
      this.emit('exit', { code, message: explainSshError(stderr, { ...opts, spawnError }) });
    });

    const deadline = Date.now() + this.readyTimeoutMs;
    while (!exited && Date.now() < deadline) {
      if (await canConnect(localPort)) {
        if (this.child !== child) break;
        this.emit('changed');
        return localPort;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    // 終わるまで少し待ってから、ssh の言い分で知らせる
    if (!exited) {
      this.kill(child);
      throw new Error(explainSshError(stderr || 'timed out', { ...opts, spawnError }));
    }
    await new Promise((r) => setTimeout(r, 50));
    if (this.child === child) this.child = null;
    throw new Error(explainSshError(stderr, { ...opts, spawnError }));
  }

  kill(child) {
    if (this.child === child) {
      this.child = null;
      this.localPort = 0;
    }
    try {
      child.kill();
    } catch {
      /* 終了済み */
    }
  }

  close() {
    const c = this.child;
    if (!c) return;
    this.kill(c);
    this.emit('changed');
  }
}

module.exports = { SshTunnel, explainSshError, isLoopbackHost, sshArgs, freePort };
