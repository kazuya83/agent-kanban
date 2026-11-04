// 最近開いたリポジトリ一覧（src/store.js）を確かめる
const test = require('node:test');
const assert = require('node:assert');
const {
  cleanRecentRepoPaths,
  touchRecentRepo,
  seedRecentRepoPaths,
  migrateSettings,
  DEFAULT_SETTINGS,
  MAX_RECENT_REPOS,
} = require('../src/store');

test('cleanRecentRepoPaths: 空・重複を捨てて上限まで残す', () => {
  assert.deepStrictEqual(cleanRecentRepoPaths(null), []);
  assert.deepStrictEqual(cleanRecentRepoPaths(['', '  ', '/a', '/a', '/b']), ['/a', '/b']);
  const many = Array.from({ length: MAX_RECENT_REPOS + 5 }, (_, i) => `/r${i}`);
  assert.strictEqual(cleanRecentRepoPaths(many).length, MAX_RECENT_REPOS);
  assert.strictEqual(cleanRecentRepoPaths(many)[0], '/r0');
});

test('touchRecentRepo: 開いたパスを先頭に移す', () => {
  assert.deepStrictEqual(touchRecentRepo(['/a', '/b'], '/b'), ['/b', '/a']);
  assert.deepStrictEqual(touchRecentRepo(['/a'], '/c'), ['/c', '/a']);
  assert.deepStrictEqual(touchRecentRepo([], '/a'), ['/a']);
  assert.deepStrictEqual(touchRecentRepo(['/a'], ''), ['/a']);
  assert.deepStrictEqual(touchRecentRepo(['/a'], '  /a  '), ['/a']);
});

test('touchRecentRepo: 上限を超えた古いものを落とす', () => {
  const list = Array.from({ length: MAX_RECENT_REPOS }, (_, i) => `/old${i}`);
  const next = touchRecentRepo(list, '/new');
  assert.strictEqual(next.length, MAX_RECENT_REPOS);
  assert.strictEqual(next[0], '/new');
  assert.ok(!next.includes(`/old${MAX_RECENT_REPOS - 1}`));
});

test('seedRecentRepoPaths: 今のリポジトリとカードから起こす', () => {
  assert.deepStrictEqual(
    seedRecentRepoPaths({ repoPath: '/cur' }, [
      { repoPath: '/old', createdAt: 1 },
      { repoPath: '/newer', createdAt: 9 },
      { repoPath: '/cur', createdAt: 5 },
      { repoPath: '', createdAt: 10 },
    ]),
    ['/cur', '/newer', '/old'],
  );
  assert.deepStrictEqual(seedRecentRepoPaths({ repoPath: '' }, []), []);
});

test('migrateSettings: recent が空ならシードする', () => {
  const settings = { ...DEFAULT_SETTINGS, repoPath: '/home/me/app', recentRepoPaths: [] };
  migrateSettings(settings, {}, [{ repoPath: '/home/me/other', createdAt: 2, agent: 'claude' }]);
  assert.deepStrictEqual(settings.recentRepoPaths, ['/home/me/app', '/home/me/other']);
});

test('migrateSettings: すでにある recent は消さない', () => {
  const settings = { ...DEFAULT_SETTINGS, repoPath: '/a', recentRepoPaths: ['/b', '/a'] };
  migrateSettings(settings, { recentRepoPaths: ['/b', '/a'] }, [{ repoPath: '/c', createdAt: 1 }]);
  assert.deepStrictEqual(settings.recentRepoPaths, ['/b', '/a']);
});
