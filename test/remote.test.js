// Worktree Kanban 同士の遠隔操作（ペアリング・RPC・イベント）
const test = require('node:test');
const assert = require('node:assert');
const { RemoteHost, RemoteClient, Reconnector, DEFAULT_PORT, isProxyChannel, isLocalChannel, MAX_PAIR_FAILURES, connectionKey, upsertConnectionHistory, removeConnectionHistory, findConnectionHistory, publicConnectionHistory, redactForRemote, MAX_CONNECTION_HISTORY, composeTabs } = require('../src/remote');

test('遠隔で転送するチャンネルと、しないチャンネル', () => {
  assert.strictEqual(isProxyChannel('board:get'), true);
  assert.strictEqual(isProxyChannel('card:send'), true);
  assert.strictEqual(isProxyChannel('card:rewind'), true);
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
  // チャットを開いたときの既読は画面が自動で呼ぶので、遠隔中もホストへ転送する
  assert.strictEqual(isProxyChannel('card:markSeen'), true);
});

test('main.js の操作は、転送するか・手元で動かすか・わざと止めるかのどれかに決まっている', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const channels = [...src.matchAll(/\bhandle\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(channels.length > 20);
  // ホストの画面にダイアログや Finder が出るだけなので、遠隔中は止める操作
  const blocked = new Set(['repo:choose', 'repo:chooseParent', 'card:open']);
  const unknown = channels.filter((ch) => !isProxyChannel(ch) && !isLocalChannel(ch) && !blocked.has(ch));
  assert.deepStrictEqual(unknown, [], `遠隔中に「この操作を使えません」になる操作があります: ${unknown.join(', ')}`);
});

test('main.js: ホストとして操作側へ渡すボードは、このマシンのボードだけ（別のホストにつないでいても混ぜない）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  // RemoteHost の invoke で board:get を受けたら、画面用の viewBoard ではなく boardState を返す
  const invoke = src.slice(src.indexOf('new RemoteHost('), src.indexOf('new RemoteHost(') + 1200);
  assert.match(invoke, /channel === 'board:get'\) return withRemoteSession\(boardState\(\)\)/);
  // board:changed の配信も、このマシンのボード（viewBoard ではない）
  const notify = src.slice(src.indexOf('function notifyBoard()'), src.indexOf('function notifyRemoteOnly()'));
  assert.match(notify, /const own = withRemoteSession\(boardState\(\)\);\s*remoteHost\?\.broadcast\('board:changed', own\)/);
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

// 接続済みのホストとクライアントを用意して fn を動かす
async function withPair(invoke, fn) {
  const host = new RemoteHost({ port: 0, tokens: [], onTokens: () => {}, invoke });
  await host.start(0);
  const client = new RemoteClient();
  try {
    await client.connect({ host: '127.0.0.1', port: host.port, code: host.status().pairCode });
    await fn(client, host);
  } finally {
    client.disconnect();
    await host.stop();
  }
}

test('スケジュールの4つの操作はホストへ転送され、引数と結果がそのまま届く', async () => {
  const calls = [];
  await withPair(
    async (channel, arg) => {
      calls.push([channel, arg]);
      return { channel };
    },
    async (client) => {
      for (const [ch, arg] of [
        ['schedules:create', { title: '毎朝', rule: { kind: 'daily', hour: 9, minute: 0 } }],
        ['schedules:update', { id: 's1', enabled: false }],
        ['schedules:delete', { id: 's1' }],
        ['schedules:run', { id: 's1', start: true }],
      ]) {
        assert.strictEqual(isProxyChannel(ch), true);
        assert.strictEqual(isLocalChannel(ch), false);
        assert.deepStrictEqual(await client.invoke(ch, arg), { channel: ch });
        assert.deepStrictEqual(calls.at(-1), [ch, arg]);
      }
    },
  );
});

test('スケジュールの処理がホストで失敗したら、その理由が操作側に届く', async () => {
  await withPair(
    async () => {
      throw new Error('先にリポジトリを開いてください');
    },
    async (client) => {
      await assert.rejects(client.invoke('schedules:create', {}), /先にリポジトリを開いてください/);
    },
  );
});

test('ボードの schedules は遠隔でも消えず、設定の秘密だけが抜かれる', async () => {
  const schedules = [{ id: 's1', repoPath: '/host/repo', title: '毎朝', runs: [] }];
  await withPair(
    async () => ({ settings: { repoPath: '/host/repo', remotePairTokens: ['secret'] }, cards: [], schedules }),
    async (client) => {
      const b = await client.invoke('board:get');
      assert.deepStrictEqual(b.schedules, schedules);
      assert.strictEqual(b.settings.remotePairTokens, undefined);
    },
  );
});

test('古いホスト: ボードに schedules がなくても、画面には空の一覧を渡す', () => {
  const old = { settings: { repoPath: '/h' }, repoTabs: [{ path: '/h' }], cards: [] };
  const local = { settings: { repoPath: '/l', recentRepoPaths: [] }, repoTabs: [{ path: '/l' }], cards: [], schedules: [{ id: 'l1' }] };
  assert.deepStrictEqual(composeTabs(old, local, 'host').schedules, []);
  // 壊れた値でも配列にする
  assert.deepStrictEqual(composeTabs({ ...old, schedules: null }, local, 'host').schedules, []);
  assert.deepStrictEqual(composeTabs({ ...old, schedules: 'x' }, local, 'host').schedules, []);
  // このマシンのタブを見ているときは、このマシンの分
  assert.deepStrictEqual(composeTabs(old, local, 'local').schedules, [{ id: 'l1' }]);
  // 接続していないとき
  assert.deepStrictEqual(composeTabs(null, local).schedules, [{ id: 'l1' }]);
  assert.deepStrictEqual(composeTabs(null, { settings: {}, repoTabs: [] }).schedules, []);
  // 新しいホストの分はそのまま
  assert.deepStrictEqual(composeTabs({ ...old, schedules: [{ id: 'h1' }] }, local, 'host').schedules, [{ id: 'h1' }]);
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

test('無効なトークンで認証すると BAD_TOKEN のエラーになる（自動の再開をやめる目印）', async () => {
  const host = new RemoteHost({ port: 0, tokens: ['good'], invoke: async () => null });
  await host.start(0);
  const client = new RemoteClient();
  try {
    await assert.rejects(client.connect({ port: host.port, token: 'bad' }), (err) => err.code === 'BAD_TOKEN');
    const r = await client.connect({ port: host.port, token: 'good' });
    assert.strictEqual(r.token, 'good');
  } finally {
    client.disconnect();
    await host.stop();
  }
});

test('前回の接続の再開: つながるまで間をあけて試し、つながったら止まる', async () => {
  let calls = 0;
  const r = new Reconnector({
    delays: [0, 5, 5, 5],
    connect: async () => {
      calls++;
      if (calls < 3) throw new Error(`だめ ${calls}`);
    },
  });
  const done = new Promise((resolve) => r.once('connected', resolve));
  r.start();
  assert.ok(r.active());
  await done;
  assert.strictEqual(calls, 3);
  assert.strictEqual(r.active(), false);
  assert.strictEqual(r.status(), null);
});

test('前回の接続の再開: 決められた回数で、または fatal のエラーで、あきらめる', async () => {
  let calls = 0;
  const r = new Reconnector({ delays: [0, 1, 1], connect: async () => (calls++, Promise.reject(new Error('届かない'))) });
  const failed = await new Promise((resolve) => {
    r.once('failed', resolve);
    r.start();
  });
  assert.strictEqual(calls, 3);
  assert.strictEqual(failed.message, '届かない');
  assert.strictEqual(r.active(), false);

  let calls2 = 0;
  const r2 = new Reconnector({ delays: [0, 1, 1], connect: async () => (calls2++, Promise.reject(Object.assign(new Error('トークンが無効'), { fatal: true }))) });
  await new Promise((resolve) => {
    r2.once('failed', resolve);
    r2.start();
  });
  assert.strictEqual(calls2, 1);
});

test('前回の接続の再開: やめたら、試している最中の結果も捨てる', async () => {
  let release;
  const r = new Reconnector({ delays: [0, 1], connect: () => new Promise((resolve) => (release = resolve)) });
  let connected = false;
  r.on('connected', () => (connected = true));
  r.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(r.status().attempt === 1);
  r.cancel();
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.strictEqual(connected, false);
  assert.strictEqual(r.active(), false);
});

test('これまでの接続: つながった接続先を新しい順に残し、同じ接続先は置き換える', () => {
  const a = { mode: 'ssh', sshHost: '100.1.1.1', sshUser: 'me', port: 17831 };
  const b = { mode: 'direct', host: '127.0.0.1', port: 18000 };
  let list = upsertConnectionHistory([], a, { token: 'ta', at: 1 });
  list = upsertConnectionHistory(list, b, { token: 'tb', at: 2 });
  assert.deepStrictEqual(list.map((e) => e.token), ['tb', 'ta']);
  // 鍵ファイルが変わっても同じ接続先。トークンを渡さなければ前のトークンを引き継ぐ
  list = upsertConnectionHistory(list, { ...a, sshKey: '/k', sshHost: '100.1.1.1 ' }, { at: 3 });
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].id, connectionKey(a));
  assert.strictEqual(list[0].token, 'ta');
  assert.strictEqual(list[0].sshKey, '/k');
  assert.strictEqual(list[0].lastConnectedAt, 3);
  // ユーザー名やポートが違えば別の接続先
  assert.notStrictEqual(connectionKey(a), connectionKey({ ...a, sshUser: 'other' }));
  assert.notStrictEqual(connectionKey(a), connectionKey({ ...a, port: 17832 }));
  assert.strictEqual(findConnectionHistory(list, connectionKey(b)).token, 'tb');
  list = removeConnectionHistory(list, connectionKey(b));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(findConnectionHistory(list, connectionKey(b)), null);
});

test('これまでの接続: 決められた数までしか残さない', () => {
  let list = [];
  for (let i = 0; i < MAX_CONNECTION_HISTORY + 3; i++) list = upsertConnectionHistory(list, { mode: 'direct', host: '127.0.0.1', port: 20000 + i }, { token: `t${i}` });
  assert.strictEqual(list.length, MAX_CONNECTION_HISTORY);
  assert.strictEqual(list[0].port, 20000 + MAX_CONNECTION_HISTORY + 2);
});

test('これまでの接続: 画面や遠隔へはトークンを渡さない', () => {
  const list = upsertConnectionHistory([], { mode: 'ssh', sshHost: 'h', sshUser: 'u' }, { token: 'secret' });
  const pub = publicConnectionHistory(list);
  assert.strictEqual(pub[0].hasToken, true);
  assert.ok(!('token' in pub[0]));
  assert.ok(!JSON.stringify(pub).includes('secret'));
  const red = redactForRemote({ settings: { remoteClientHistory: list, x: 1 } });
  assert.ok(!('remoteClientHistory' in red.settings));
});
