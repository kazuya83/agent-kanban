// 画面上部のリポジトリのタブ（src/store.js）を確かめる
const test = require('node:test');
const assert = require('node:assert');
const { cleanRepoTabs, openRepoTab, closeRepoTab, repoTabSummary, migrateSettings, DEFAULT_SETTINGS, MAX_REPO_TABS } = require('../src/store');

test('タブは3つまで', () => {
  assert.strictEqual(MAX_REPO_TABS, 3);
});

test('cleanRepoTabs: 空・重複を捨て、今のリポジトリを必ず入れて上限まで残す', () => {
  assert.deepStrictEqual(cleanRepoTabs(null, ''), []);
  assert.deepStrictEqual(cleanRepoTabs(null, '/a'), ['/a']);
  assert.deepStrictEqual(cleanRepoTabs(['', ' /a ', '/a', '/b'], '/a'), ['/a', '/b']);
  assert.deepStrictEqual(cleanRepoTabs(['/a', '/b'], '/c'), ['/a', '/b', '/c']);
  // 多すぎるときは今のリポジトリを残して後ろから落とす
  assert.deepStrictEqual(cleanRepoTabs(['/a', '/b', '/c', '/d'], '/d'), ['/a', '/b', '/d']);
  assert.deepStrictEqual(cleanRepoTabs(['/a', '/b', '/c'], '/x'), ['/a', '/b', '/x']);
});

test('openRepoTab: 新しいタブで開くと右に足す', () => {
  assert.deepStrictEqual(openRepoTab([], '', '/a'), ['/a']);
  assert.deepStrictEqual(openRepoTab(['/a'], '/a', '/b'), ['/a', '/b']);
  assert.deepStrictEqual(openRepoTab(['/a', '/b'], '/a', '/c', { mode: 'new' }), ['/a', '/b', '/c']);
});

test('openRepoTab: すでにタブにあればそのまま（そのタブに移るだけ）', () => {
  assert.deepStrictEqual(openRepoTab(['/a', '/b'], '/a', '/b'), ['/a', '/b']);
  assert.deepStrictEqual(openRepoTab(['/a', '/b'], '/a', '/b', { mode: 'replace' }), ['/a', '/b']);
});

test('openRepoTab: replace と、タブが上限まであるときは今のタブを置き換える', () => {
  assert.deepStrictEqual(openRepoTab(['/a', '/b'], '/a', '/c', { mode: 'replace' }), ['/c', '/b']);
  assert.deepStrictEqual(openRepoTab(['/a', '/b', '/c'], '/b', '/d', { mode: 'new' }), ['/a', '/d', '/c']);
  assert.strictEqual(openRepoTab(['/a', '/b', '/c'], '/c', '/d').length, MAX_REPO_TABS);
});

test('closeRepoTab: 今のタブを閉じたら右（なければ左）のタブに移る', () => {
  assert.deepStrictEqual(closeRepoTab(['/a', '/b', '/c'], '/b', '/b'), { tabs: ['/a', '/c'], next: '/c' });
  assert.deepStrictEqual(closeRepoTab(['/a', '/b', '/c'], '/c', '/c'), { tabs: ['/a', '/b'], next: '/b' });
  assert.deepStrictEqual(closeRepoTab(['/a', '/b', '/c'], '/a', '/c'), { tabs: ['/a', '/b'], next: '/a' });
});

test('closeRepoTab: 最後の1つと、タブにないものは閉じない', () => {
  assert.deepStrictEqual(closeRepoTab(['/a'], '/a', '/a'), { tabs: ['/a'], next: '/a' });
  assert.deepStrictEqual(closeRepoTab(['/a', '/b'], '/a', '/x'), { tabs: ['/a', '/b'], next: '/a' });
});

test('repoTabSummary: リポジトリごとに動いているタスクと対応待ちを数える', () => {
  const cards = [
    { repoPath: '/a', status: 'running' },
    { repoPath: '/a', status: 'queued' },
    { repoPath: '/a', status: 'review', awaitingReply: true },
    { repoPath: '/b', status: 'running', permissions: [{ id: 1 }] },
    { repoPath: '/b', status: 'done' },
    { repoPath: '/z', status: 'running' },
  ];
  assert.deepStrictEqual(repoTabSummary(['/a', '/b', '/c'], cards), [
    { path: '/a', running: 2, attention: 1 },
    { path: '/b', running: 1, attention: 1 },
    { path: '/c', running: 0, attention: 0 },
  ]);
});

test('migrateSettings: タブがなかった設定は今のリポジトリだけのタブにする', () => {
  const s = { ...DEFAULT_SETTINGS, repoPath: '/cur' };
  migrateSettings(s, { repoPath: '/cur' }, []);
  assert.deepStrictEqual(s.repoTabs, ['/cur']);
  assert.strictEqual(s.repoBaseBranches, undefined);
  const t = { ...DEFAULT_SETTINGS, repoPath: '/b', repoTabs: ['/a', '/b', '/a'], repoBaseBranches: [] };
  migrateSettings(t, t, []);
  assert.deepStrictEqual(t.repoTabs, ['/a', '/b']);
  assert.strictEqual(t.repoBaseBranches, undefined);
});
