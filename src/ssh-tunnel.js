// クライアント側で SSH のポート転送（ssh -N -L）を張る
// ホストの Agent Kanban は 127.0.0.1 でしか待ち受けないので、Tailscale の IP などへは
// 直接つながらない。アプリが ssh を起動し、手元の空きポート → ホストの 127.0.0.1:port へ転送する
const net = require('net');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { tr } = require('../renderer/i18n');

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
function explainSshError(stderr, { host = '', user = '', sshPort = 22, spawnError = null, identityFile = '' } = {}) {
  if (spawnError && spawnError.code === 'ENOENT') {
    return tr('ssh コマンドが見つかりません。Windows なら「設定 → システム → オプション機能」で「OpenSSH クライアント」を追加してください（ssh のフルパスを設定で指定することもできます）');
  }
  const text = String(stderr || '').trim();
  const target = `${user ? `${user}@` : ''}${host}:${sshPort}`;
  const howto = tr('ホストが Mac なら「システム設定 → 一般 → 共有 → リモートログイン」をオン、Windows なら「設定 → システム → オプション機能」で「OpenSSH サーバー」を追加してサービス sshd を開始');
  const guide = tr('詳しい手順は README の「遠隔操作」（docs/remote.md）にあります');
  if (/timed out|ETIMEDOUT/i.test(text)) {
    return tr('SSH の接続がタイムアウトしました（{target}）。相手から返事がないときに出ます。次を順に確かめてください: ① 両方の PC で Tailscale が「接続中」か（操作側で tailscale ping {host} が返るか） ② IP やホスト名が、ホストの Agent Kanban の「RC設定」に出ている接続先と合っているか ③ ホストがスリープしていないか ④ ホストで SSH サーバーが動いているか（{howto}） ⑤ ホストのファイアウォールが SSH（{sshPort}）を止めていないか（Mac の「ステルスモード」「外部からの接続をすべてブロック」など）。{guide}', { target, host, howto, sshPort, guide });
  }
  if (/Connection refused/i.test(text)) {
    return tr('SSH の接続を断られました（{target}）。ホストで SSH サーバーが動いていません。{howto}してください（SSH のポートが 22 以外ならそれも合わせてください）。{guide}', { target, howto, guide });
  }
  if (/Could not resolve hostname|Name or service not known|No such host/i.test(text)) {
    return tr('SSH の接続先「{host}」が見つかりません。Tailscale の IP（100.x.x.x）か、Tailscale の管理画面に出ているマシン名を入れてください', { host });
  }
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) {
    return tr('ホストの鍵が以前と違うため止めました（{host}）。ホストを入れ直したなど心当たりがあるときは、操作側のターミナルで ssh-keygen -R {host} を実行してからもう一度接続してください', { host });
  }
  if (/Permission denied|Too many authentication failures|no mutual signature/i.test(text)) {
    const who = `${user ? `${user}@` : ''}${host}`;
    const keyNote = identityFile
      ? tr('アプリが使った鍵: {file}。ターミナルで ssh -i "{file}" {who} exit がパスワードなしで通るか確かめてください。', { file: identityFile, who })
      : tr('アプリは鍵ファイルを指定せずに接続しました（RC設定の「鍵ファイル」が空で、アプリの鍵も見つかりませんでした）。');
    return tr('SSH の認証に失敗しました（{target}）。{keyNote}アプリからはパスワードを入力できないので、鍵で入れるようにしてください: 操作側の「RC設定」で「鍵を作る」を押し、出てきた公開鍵を、ホストの PC で登録します（出ているコマンドをホストで実行するか、ホストが Mac なら ~/.ssh/authorized_keys に、Windows なら C:\\Users\\<ユーザー>\\.ssh\\authorized_keys（管理者のユーザーは C:\\ProgramData\\ssh\\administrators_authorized_keys）に1行で足します）。ユーザー名がホストのログイン名と合っているかも確かめてください。{guide}', { target, keyNote, guide });
  }
  if (/remote port forwarding failed|forwarding failed|open failed|administratively prohibited/i.test(text)) {
    return tr('SSH はつながりましたが、ポート転送を断られました。ホストの sshd_config（Mac は /etc/ssh/sshd_config、Windows は C:\\ProgramData\\ssh\\sshd_config）で AllowTcpForwarding が no になっていないか確かめてください');
  }
  const last = text.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ');
  return last ? tr('SSH トンネルを張れませんでした（{target}）: {last}', { target, last }) : tr('SSH トンネルを張れませんでした（{target}）', { target });
}

// Tailscale の IP（100.64.0.0/10）か
function isTailscaleIp(ip) {
  const m = String(ip || '').match(/^100\.(\d+)\.\d+\.\d+$/);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

// ホスト側で、操作側に入れてもらう接続先と、SSH サーバーが動いているかを調べる
async function sshHostInfo({ sshPort = 22, os = require('os'), probe = (port) => canConnect(port) } = {}) {
  const ifaces = os.networkInterfaces() || {};
  const addrs = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list || []) {
      if (a && (a.family === 'IPv4' || a.family === 4) && !a.internal) addrs.push(a.address);
    }
  }
  let user = '';
  try {
    user = os.userInfo().username || '';
  } catch {
    /* 取れない環境もある */
  }
  return {
    platform: process.platform,
    hostname: os.hostname(),
    user,
    tailscaleIps: addrs.filter(isTailscaleIp),
    otherIps: addrs.filter((a) => !isTailscaleIp(a)),
    sshPort,
    sshServer: await probe(sshPort),
  };
}

// 鍵ファイルの場所: ~ で始まれば展開し、空なら「鍵を作る」で作ったアプリの鍵があればそれを使う
function resolveIdentityFile(identityFile, home = require('os').homedir()) {
  const key = require('./ssh-key');
  const given = key.expandHome(identityFile, home);
  if (given) return given;
  const def = key.defaultKeyPath(home);
  return require('fs').existsSync(def) ? def : '';
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
    if (!host) throw new Error(tr('SSH の接続先（Tailscale の IP かホスト名）を入れてください'));
    if (/^-/.test(host) || /^-/.test(user) || /[\s@]/.test(user)) throw new Error(tr('SSH の接続先かユーザー名が正しくありません'));
    sshPort = Math.min(65535, Math.max(1, parseInt(sshPort, 10) || 22));
    const localPort = await freePort();
    const opts = { host, user, sshPort, remotePort, localPort, identityFile: resolveIdentityFile(identityFile) };
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

module.exports = {
  resolveIdentityFile, SshTunnel, explainSshError, isLoopbackHost, isTailscaleIp, sshHostInfo, sshArgs, freePort };
