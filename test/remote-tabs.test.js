// 遠隔操作中に、ホストのタブとこのマシンのタブを並べて動かす（どちらで行うかの振り分けと、タブの並べ方）
const test = require('node:test');
const assert = require('node:assert');
const { routeSide, stripRouting, composeTabs, VIEW_CHANNELS } = require('../src/remote');

test('routeSide: タブの操作は remote の印で、リポジトリの追加は target で振り分ける', () => {
  assert.strictEqual(routeSide('repo:switchTab', { path: '/a', remote: false }, 'host'), 'local');
  assert.strictEqual(routeSide('repo:closeTab', { path: '/a', remote: true }, 'local'), 'host');
  assert.strictEqual(routeSide('repo:open', { path: '/a', target: 'local' }, 'host'), 'local');
  assert.strictEqual(routeSide('repo:clone', { target: 'host' }, 'local'), 'host');
  assert.strictEqual(routeSide('repo:browse', { target: 'local' }, 'host'), 'local');
  assert.strictEqual(routeSide('wsl:distros', { target: 'local' }, 'host'), 'local');
});

test('routeSide: 印がなければ、見ているタブの側で行う（カードの操作などは印を見ない）', () => {
  assert.strictEqual(routeSide('card:start', { id: 'x', target: 'local' }, 'host'), 'host');
  assert.strictEqual(routeSide('card:start', { id: 'x' }, 'local'), 'local');
  assert.strictEqual(routeSide('board:get', undefined, 'host'), 'host');
  assert.strictEqual(routeSide('board:get', undefined, 'local'), 'local');
  assert.strictEqual(routeSide('repo:open', { path: '/a' }, 'local'), 'local');
  assert.strictEqual(routeSide('repo:switchTab', { path: '/a' }, 'host'), 'host');
});

test('stripRouting: ホストへ送る前に target と remote を外す', () => {
  assert.deepStrictEqual(stripRouting({ path: '/a', target: 'host', tab: 'new' }), { path: '/a', tab: 'new' });
  assert.deepStrictEqual(stripRouting({ path: '/a', remote: true }), { path: '/a' });
  const same = { id: 'x' };
  assert.strictEqual(stripRouting(same), same);
  assert.strictEqual(stripRouting(undefined), undefined);
});

test('VIEW_CHANNELS: リポジトリを開いた・タブを切り替えたら、見ている側が変わる', () => {
  for (const c of ['repo:open', 'repo:choose', 'repo:switchTab', 'repo:clone', 'repo:create']) assert.ok(VIEW_CHANNELS.has(c), c);
  assert.ok(!VIEW_CHANNELS.has('repo:closeTab'));
  assert.ok(!VIEW_CHANNELS.has('repo:browse'));
});

const host = { settings: { repoPath: '/h/b', recentRepoPaths: ['/h/b', '/h/a'] }, repoTabs: [{ path: '/h/a', running: 1, attention: 0 }, { path: '/h/b', running: 0, attention: 0 }], cards: [{ id: 'hc' }] };
const local = { settings: { repoPath: '/l/x', recentRepoPaths: ['/l/x'] }, repoTabs: [{ path: '/l/x', running: 2, attention: 1 }], cards: [{ id: 'lc' }] };

test('composeTabs: ホストのタブを見ているときは、ホストのボードに両方のタブを並べる', () => {
  const b = composeTabs(host, local, 'host');
  assert.deepStrictEqual(b.cards, host.cards);
  assert.strictEqual(b.settings.repoPath, '/h/b');
  assert.deepStrictEqual(
    b.repoTabs.map((t) => [t.path, t.remote, t.active]),
    [
      ['/h/a', true, false],
      ['/h/b', true, true],
      ['/l/x', false, false],
    ],
  );
  assert.deepStrictEqual(b.recentBySide, { host: ['/h/b', '/h/a'], local: ['/l/x'] });
});

test('composeTabs: このマシンのタブを見ているときは、このマシンのボードを出す', () => {
  const b = composeTabs(host, local, 'local');
  assert.deepStrictEqual(b.cards, local.cards);
  assert.deepStrictEqual(
    b.repoTabs.filter((t) => t.active).map((t) => [t.path, t.remote]),
    [['/l/x', false]],
  );
  // 同じパスがホストとこのマシンの両方にあっても、側で見分ける
  const same = composeTabs({ ...host, settings: { repoPath: '/l/x' }, repoTabs: [{ path: '/l/x' }] }, local, 'host');
  assert.deepStrictEqual(
    same.repoTabs.map((t) => [t.path, t.remote, t.active]),
    [
      ['/l/x', true, true],
      ['/l/x', false, false],
    ],
  );
});

test('composeTabs: 接続していないときは、このマシンのタブだけ（ホストへ送るボードにもこのマシンのタブは入らない）', () => {
  const b = composeTabs(null, local);
  assert.deepStrictEqual(
    b.repoTabs.map((t) => [t.path, t.remote, t.active]),
    [['/l/x', false, true]],
  );
  assert.strictEqual(b.recentBySide, undefined);
  // 元のボードは書き換えない
  assert.strictEqual(local.repoTabs[0].remote, undefined);
});
