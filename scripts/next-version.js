#!/usr/bin/env node
// 次にリリースするバージョンを決める（CI 用）
//   node scripts/next-version.js            → {"version":"0.1.9","release":true,"latest":"0.1.8","reason":"..."} を出す
//
// - 最新のリリース（v から始まるタグ）の最後の数字を1つ上げる（0.1.8 → 0.1.9）
// - package.json の version のほうが大きければ、それを使う（0.2.0 などに上げたいとき）
// - 最新のリリースからアプリの中身（APP_PATHS）が変わっていなければ、リリースしない
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// アプリの中身として扱うファイル（README やテスト、CI の設定だけの変更ではリリースしない）
const APP_PATHS = /^(main\.js|preload\.js|src\/|renderer\/|build\/|package\.json|package-lock\.json)/;

function parse(v) {
  const m = String(v || '').trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
const fmt = (v) => v.join('.');

/**
 * @param {{ tags: string[], pkgVersion: string, changedSince: (tag: string) => string[] }} p
 */
function decide({ tags, pkgVersion, changedSince }) {
  const pkg = parse(pkgVersion);
  if (!pkg) throw new Error(`package.json の version が読めません: ${pkgVersion}`);
  const released = tags.map(parse).filter(Boolean).sort(cmp);
  const latest = released[released.length - 1] || null;
  if (!latest) return { version: fmt(pkg), release: true, latest: null, reason: 'まだリリースがないので、package.json の version で出します' };

  const latestTag = `v${fmt(latest)}`;
  const exists = (v) => released.some((r) => cmp(r, v) === 0);
  if (cmp(pkg, latest) > 0) {
    return { version: fmt(pkg), release: !exists(pkg), latest: fmt(latest), reason: `package.json の version（${fmt(pkg)}）が最新のリリースより大きいので、それで出します` };
  }
  const next = [latest[0], latest[1], latest[2] + 1];
  const changed = changedSince(latestTag).filter((f) => APP_PATHS.test(f));
  if (!changed.length) {
    return { version: fmt(next), release: false, latest: fmt(latest), reason: `${latestTag} からアプリの中身が変わっていないので、リリースしません` };
  }
  return { version: fmt(next), release: true, latest: fmt(latest), reason: `${latestTag} から ${changed.length} ファイル変わったので、${fmt(next)} を出します（例: ${changed.slice(0, 3).join(', ')}）` };
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  const tags = git('tag', '-l', 'v*').split('\n').filter(Boolean);
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const result = decide({ tags, pkgVersion, changedSince: (tag) => git('diff', '--name-only', tag, 'HEAD').split('\n').filter(Boolean) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { decide, parse, APP_PATHS };
