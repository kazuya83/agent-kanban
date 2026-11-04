// Agent Kanban 同士の遠隔操作（ペアリング・RPC・イベント）
const test = require('node:test');
const assert = require('node:assert');
const { RemoteHost, RemoteClient, DEFAULT_PORT, isProxyChannel, isLocalChannel, MAX_PAIR_FAILURES } = require('../src/remote');

test('遠隔で転送するチャンネルと、しないチャンネル', () => {
  assert.strictEqual(isProxyChannel('board:get'), true);
  assert.strictEqual(isProxyChannel('card:send'), true);
  assert.strictEqual(isProxyChannel('settings:update'), true);
  assert.strictEqual(isProxyChannel('remote:connect'), false);
  assert.strictEqual(isProxyChannel('app:info'), false);
  assert.strictEqual(isProxyChannel('open:external'), false);
  // ホストの画面にダイアログや Finder が出るだけの操作は転送しない
  assert.strictEqual(isProxyChannel('repo:choose'), false);
  assert.strictEqual(isProxyChannel('repo:chooseParent'), false);
  assert.strictEqual(isProxyChannel('card:open'), false);
  // 代わりに、ホストのフォルダを操作側の画面で辿って、パスを指定して開く
  assert.strictEqual(isProxyChannel('repo:browse'), true);
  assert.strictEqual(isProxyChannel('repo:open'), true);
  assert.strictEqual(isLocalChannel('remote:connect'), true);
  assert.strictEqual(isLocalChannel('app:info'), true);
  assert.strictEqual(isLocalChannel('repo:choose'), false);
});

test('ペアリングコードで接続し、ボード操作とイベントを中継できる', async () => {
  let board = { settings: { repoPath: '/host/repo' }, cards: [{ id: 'c1', title: '遠隔' }] };
  const tokens = [];
  const host = new RemoteHost({
    port: 0,
    tokens: [],
    onTokens: (t) => {
      tokens.length = 0;
      tokens.push(...t);
    },
    invoke: async (channel, arg) => {
      if (channel === 'board:get') return board;
      if (channel === 'card:send') {
        board = { ...board, cards: [{ ...board.cards[0], last: arg.message }] };
        return true;
      }
      if (channel === 'settings:update') {
        board = { ...board, settings: { ...board.settings, ...arg } };
        return board.settings;
      }
      throw new Error(`unknown ${channel}`);
    },
  });
  await host.start(0);

  try {
    const st = host.status();
    assert.ok(st.listening);
    assert.ok(st.pairCode);
    assert.match(st.pairCode, /^\d{6}$/);

    const client = new RemoteClient();
    const paired = await client.connect({ host: '127.0.0.1', port: host.port, code: st.pairCode });
    assert.ok(paired.token);
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(client.connected, true);

    // コードは一度使うと消える
    assert.strictEqual(host.status().pairCode, null);

    const remoteBoard = await client.invoke('board:get');
    assert.strictEqual(remoteBoard.settings.repoPath, '/host/repo');
    assert.strictEqual(remoteBoard.cards[0].title, '遠隔');

    await client.invoke('card:send', { id: 'c1', message: 'Windows から指示' });
    const after = await client.invoke('board:get');
    assert.strictEqual(after.cards[0].last, 'Windows から指示');

    // イベント配信
    const got = new Promise((resolve) => client.once('event', (ch, payload) => resolve({ ch, payload })));
    host.broadcast('board:changed', { cards: [{ id: 'c1' }] });
    const ev = await got;
    assert.strictEqual(ev.ch, 'board:changed');
    assert.strictEqual(ev.payload.cards[0].id, 'c1');

    // 切断してトークンで再接続
    client.disconnect();
    assert.strictEqual(client.connected, false);
    const client2 = new RemoteClient();
    await client2.connect({ host: '127.0.0.1', port: host.port, token: paired.token });
    assert.strictEqual(client2.connected, true);
    const again = await client2.invoke('board:get');
    assert.strictEqual(again.cards[0].last, 'Windows から指示');
    client2.disconnect();
  } finally {
    await host.stop();
  }
});

test('間違ったペアリングコードでは接続できない', async () => {
  const host = new RemoteHost({ invoke: async () => ({}) });
  await host.start(0);
  try {
    const client = new RemoteClient();
    await assert.rejects(() => client.connect({ host: '127.0.0.1', port: host.port, code: '000000' }), /ペアリングコード/);
  } finally {
    await host.stop();
  }
});

test('既定ポート', () => {
  assert.strictEqual(DEFAULT_PORT, 17831);
});

test('ペアリングコードを何度も間違えるとコードが無効になる（総当たり対策）', async () => {
  const host = new RemoteHost({ invoke: async () => ({}) });
  await host.start(0);
  try {
    const right = host.status().pairCode;
    const wrong = right === '000000' ? '000001' : '000000';
    for (let i = 0; i < MAX_PAIR_FAILURES; i++) {
      await assert.rejects(() => new RemoteClient().connect({ host: '127.0.0.1', port: host.port, code: wrong }), /ペアリングコード/);
    }
    assert.strictEqual(host.status().pairCode, null);
    // 正しいコードでも、もう通らない
    await assert.rejects(() => new RemoteClient().connect({ host: '127.0.0.1', port: host.port, code: right }), /ペアリングコード/);
    // 再発行すれば通る
    const fresh = host.refreshPairCode().pairCode;
    const c = new RemoteClient();
    await c.connect({ host: '127.0.0.1', port: host.port, code: fresh });
    assert.strictEqual(c.connected, true);
    c.disconnect();
  } finally {
    await host.stop();
  }
});

test('遠隔へ渡すボードからトークンを抜く', async () => {
  const board = { settings: { repoPath: '/r', remotePairTokens: ['secret'], remoteClientToken: 'mine' }, cards: [] };
  const host = new RemoteHost({ invoke: async () => board });
  await host.start(0);
  try {
    const c = new RemoteClient();
    await c.connect({ host: '127.0.0.1', port: host.port, code: host.status().pairCode });
    const got = await c.invoke('board:get');
    assert.strictEqual(got.settings.repoPath, '/r');
    assert.strictEqual('remotePairTokens' in got.settings, false);
    assert.strictEqual('remoteClientToken' in got.settings, false);
    const ev = new Promise((resolve) => c.once('event', (_ch, p) => resolve(p)));
    host.broadcast('board:changed', board);
    const p = await ev;
    assert.strictEqual('remotePairTokens' in p.settings, false);
    // 元のボードは変えない
    assert.deepStrictEqual(board.settings.remotePairTokens, ['secret']);
    c.disconnect();
  } finally {
    await host.stop();
  }
});

test('同じクライアントで接続し直しても、古い接続の close で新しい接続が切れない', async () => {
  const host = new RemoteHost({ invoke: async () => ({ ok: 1 }) });
  await host.start(0);
  try {
    const c = new RemoteClient();
    const { token } = await c.connect({ host: '127.0.0.1', port: host.port, code: host.status().pairCode });
    await c.connect({ host: '127.0.0.1', port: host.port, token });
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(c.connected, true);
    assert.deepStrictEqual(await c.invoke('board:get'), { ok: 1 });
    c.disconnect();
  } finally {
    await host.stop();
  }
});

test('接続後のソケットエラーで例外を投げない（error の聞き手がいなくても落ちない）', async () => {
  const host = new RemoteHost({ invoke: async () => ({}) });
  await host.start(0);
  try {
    const c = new RemoteClient();
    await c.connect({ host: '127.0.0.1', port: host.port, code: host.status().pairCode });
    const closed = new Promise((r) => c.once('disconnected', r));
    c.socket.destroy(new Error('boom'));
    await closed;
    assert.strictEqual(c.connected, false);
  } finally {
    await host.stop();
  }
});
