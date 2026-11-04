// SSH トンネル経由の遠隔接続（Tailscale の IP などへ直接つながらない問題の対策）
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { SshTunnel, explainSshError, isLoopbackHost, isTailscaleIp, sshHostInfo, sshArgs } = require('../src/ssh-tunnel');
const { RemoteHost, RemoteClient } = require('../src/remote');

const FAKE = path.join(__dirname, 'fake-ssh.js');

function fakeTunnel(env = {}) {
  Object.assign(process.env, env);
  return new SshTunnel({ command: process.execPath, prefixArgs: [FAKE], readyTimeoutMs: 5000 });
}

test('ssh の引数: 転送だけ・鍵認証のみ・ホストの 127.0.0.1 へ', () => {
  const a = sshArgs({ host: '100.64.0.5', user: 'kazuya', sshPort: 22, remotePort: 17831, localPort: 40000 });
  assert.ok(a.includes('-N'));
  assert.ok(a.includes('BatchMode=yes'));
  assert.ok(a.includes('ExitOnForwardFailure=yes'));
  assert.strictEqual(a[a.indexOf('-L') + 1], '127.0.0.1:40000:127.0.0.1:17831');
  assert.strictEqual(a[a.length - 1], 'kazuya@100.64.0.5');
  const k = sshArgs({ host: 'mac', remotePort: 1, localPort: 2, identityFile: 'C:\\k\\id' });
  assert.strictEqual(k[k.indexOf('-i') + 1], 'C:\\k\\id');
  assert.strictEqual(k[k.length - 1], 'mac');
});

test('ループバックかどうか', () => {
  assert.ok(isLoopbackHost('127.0.0.1'));
  assert.ok(isLoopbackHost('localhost'));
  assert.ok(isLoopbackHost('::1'));
  assert.ok(!isLoopbackHost('100.101.102.103'));
  assert.ok(!isLoopbackHost('mac-mini'));
});

test('ssh の失敗を、直し方の分かる文にする', () => {
  assert.match(explainSshError('ssh: connect to host 100.1.2.3 port 22: Connection timed out', { host: '100.1.2.3' }), /リモートログイン/);
  assert.match(explainSshError('ssh: connect to host x port 22: Connection refused', { host: 'x' }), /リモートログイン/);
  assert.match(explainSshError('kazuya@x: Permission denied (publickey,password).', { host: 'x' }), /RC設定.*鍵を作る/);
  assert.match(explainSshError('Host key verification failed.', { host: 'x' }), /ssh-keygen -R x/);
  assert.match(explainSshError('ssh: Could not resolve hostname macmini: No such host is known.', { host: 'macmini' }), /見つかりません/);
  assert.match(explainSshError('', { spawnError: Object.assign(new Error('x'), { code: 'ENOENT' }) }), /OpenSSH/);
});

test('ホストが Windows の場合の直し方も出す（Mac だけを前提にしない）', () => {
  const timeout = explainSshError('ssh: connect to host 100.101.49.22 port 22: Connection timed out', { host: '100.101.49.22', user: 'kazuya' });
  assert.match(timeout, /kazuya@100\.101\.49\.22:22/);
  assert.match(timeout, /tailscale ping 100\.101\.49\.22/);
  assert.match(timeout, /スリープ/);
  assert.match(timeout, /ファイアウォール/);
  assert.match(timeout, /リモートログイン/);
  assert.match(timeout, /OpenSSH サーバー/);
  assert.match(explainSshError('Connection refused', { host: 'x' }), /OpenSSH サーバー/);
  assert.match(explainSshError('Permission denied (publickey).', { host: 'x' }), /administrators_authorized_keys/);
});

test('Tailscale の IP を見分ける', () => {
  assert.ok(isTailscaleIp('100.101.49.22'));
  assert.ok(isTailscaleIp('100.64.0.1'));
  assert.ok(!isTailscaleIp('100.63.0.1'));
  assert.ok(!isTailscaleIp('100.128.0.1'));
  assert.ok(!isTailscaleIp('192.168.1.10'));
});

test('ホスト側で、操作側に入れる接続先と SSH サーバーの状態を返す', async () => {
  const fakeOs = {
    networkInterfaces: () => ({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
      utun4: [{ address: '100.101.49.22', family: 'IPv4', internal: false }],
    }),
    userInfo: () => ({ username: 'kazuya' }),
    hostname: () => 'mac-mini',
  };
  const ports = [];
  const info = await sshHostInfo({ os: fakeOs, probe: async (p) => (ports.push(p), false) });
  assert.deepStrictEqual(info.tailscaleIps, ['100.101.49.22']);
  assert.deepStrictEqual(info.otherIps, ['192.168.1.10']);
  assert.strictEqual(info.user, 'kazuya');
  assert.strictEqual(info.hostname, 'mac-mini');
  assert.strictEqual(info.sshServer, false);
  assert.deepStrictEqual(ports, [22]);
});

test('おかしな接続先・ユーザー名は ssh に渡さない', async () => {
  const t = fakeTunnel();
  await assert.rejects(t.open({ host: '', remotePort: 1 }), /接続先/);
  await assert.rejects(t.open({ host: '-oProxyCommand=x', remotePort: 1 }), /正しくありません/);
  await assert.rejects(t.open({ host: 'h', user: 'a b', remotePort: 1 }), /正しくありません/);
});

test('ssh が失敗したら、その理由で止まる', async () => {
  const t = fakeTunnel({ FAKE_SSH_FAIL: 'ssh: connect to host 100.1.2.3 port 22: Connection timed out' });
  try {
    await assert.rejects(t.open({ host: '100.1.2.3', user: 'u', remotePort: 17831 }), /タイムアウト.*リモートログイン/);
    assert.strictEqual(t.active(), false);
  } finally {
    delete process.env.FAKE_SSH_FAIL;
  }
});

test('トンネル経由でホストにペアリングでき、閉じると切れる', async () => {
  const host = new RemoteHost({ port: 0, invoke: async (ch) => (ch === 'board:get' ? { cards: [{ id: 'c1' }] } : null) });
  await host.start(0);
  const code = host.status().pairCode;
  const t = fakeTunnel();
  const client = new RemoteClient();
  try {
    const localPort = await t.open({ host: '100.64.0.5', user: 'u', remotePort: host.port });
    assert.ok(t.active());
    assert.notStrictEqual(localPort, host.port);
    const r = await client.connect({ host: '127.0.0.1', port: localPort, code });
    assert.ok(r.token);
    const board = await client.invoke('board:get');
    assert.strictEqual(board.cards[0].id, 'c1');
    const gone = new Promise((res) => client.once('disconnected', res));
    t.close();
    await gone;
    assert.strictEqual(client.connected, false);
    assert.strictEqual(t.active(), false);
  } finally {
    client.disconnect();
    t.close();
    await host.stop();
  }
});

test('届かない相手には、決めた時間で ETIMEDOUT を返す', async () => {
  // どこにもつながらないアドレス（TEST-NET-1）。環境によってはすぐに別のエラーになる
  const client = new RemoteClient();
  const started = Date.now();
  await assert.rejects(client.connect({ host: '192.0.2.1', port: 17831, code: '000000', timeoutMs: 300 }), (err) => {
    assert.ok(err.code === 'ETIMEDOUT' || err.code === 'ENETUNREACH' || err.code === 'EHOSTUNREACH', err.message);
    return true;
  });
  assert.ok(Date.now() - started < 5000);
});
