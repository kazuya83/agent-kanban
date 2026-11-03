// 次にリリースするバージョンの決め方
const test = require('node:test');
const assert = require('node:assert');
const { decide } = require('../scripts/next-version');

const app = () => ['src/agent.js', 'README.md'];
const docsOnly = () => ['README.md', 'test/a.test.js', '.github/workflows/build.yml'];

test('最新のリリースの最後の数字を1つ上げる', () => {
  const r = decide({ tags: ['v0.1.7', 'v0.1.8', 'v0.1.10', 'v0.1.9'], pkgVersion: '0.1.8', changedSince: app });
  assert.deepStrictEqual([r.version, r.release, r.latest], ['0.1.11', true, '0.1.10']);
});

test('アプリの中身が変わっていなければリリースしない', () => {
  const r = decide({ tags: ['v0.1.8'], pkgVersion: '0.1.8', changedSince: docsOnly });
  assert.strictEqual(r.release, false);
});

test('package.json の version のほうが大きければ、それで出す', () => {
  const r = decide({ tags: ['v0.1.8'], pkgVersion: '0.2.0', changedSince: docsOnly });
  assert.deepStrictEqual([r.version, r.release], ['0.2.0', true]);
  // もう出ていれば出さない
  assert.strictEqual(decide({ tags: ['v0.1.8', 'v0.2.0'], pkgVersion: '0.2.0', changedSince: docsOnly }).release, false);
});

test('まだリリースがなければ package.json の version で出す', () => {
  const r = decide({ tags: [], pkgVersion: '0.1.0', changedSince: app });
  assert.deepStrictEqual([r.version, r.release], ['0.1.0', true]);
});

test('今のリポジトリで実行できる', () => {
  const out = require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '..', 'scripts', 'next-version.js')], { encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.match(r.version, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(typeof r.release, 'boolean');
});
