// アプリの更新（新しい版を調べて、install.sh / install.ps1 で入れ替える）
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { Updater, compareVersions, versionFromReleaseUrl, assetName, unsupportedReason, installCommand, macBundlePath } = require('../src/updater');
const { isLocalChannel } = require('../src/remote');

test('版の番号を数字として比べる', () => {
  assert.strictEqual(compareVersions('0.1.10', '0.1.9'), 1);
  assert.strictEqual(compareVersions('v0.1.8', '0.1.8'), 0);
  assert.strictEqual(compareVersions('0.1.8', '0.2.0'), -1);
  assert.strictEqual(compareVersions('1.0', '0.9.9'), 1);
});

test('releases/latest のリダイレクト先から版を取り出す', () => {
  assert.strictEqual(versionFromReleaseUrl('https://github.com/kazuya83/worktree-kanban/releases/tag/v0.1.9'), '0.1.9');
  assert.strictEqual(versionFromReleaseUrl('https://github.com/kazuya83/worktree-kanban/releases'), null);
  assert.strictEqual(versionFromReleaseUrl(''), null);
});

test('OS・CPU ごとのリリースのファイル名（install.sh / install.ps1 と同じ）', () => {
  assert.strictEqual(assetName('darwin', 'arm64', '0.1.9'), 'worktree-kanban-0.1.9-mac-arm64.dmg');
  assert.strictEqual(assetName('darwin', 'x64', '0.1.9'), 'worktree-kanban-0.1.9-mac-x64.dmg');
  assert.strictEqual(assetName('linux', 'x64', '0.1.9'), 'worktree-kanban-0.1.9-linux-x86_64.AppImage');
  assert.strictEqual(assetName('win32', 'x64', '0.1.9'), 'worktree-kanban-0.1.9-win-x64.zip');
  assert.strictEqual(assetName('linux', 'arm64', '0.1.9'), null);
});

test('開発版・AppImage 以外の Linux では更新しない', () => {
  assert.match(unsupportedReason({ packaged: false, platform: 'darwin', arch: 'arm64', env: {} }), /開発版/);
  assert.match(unsupportedReason({ packaged: true, platform: 'linux', arch: 'x64', env: {} }), /AppImage/);
  assert.strictEqual(unsupportedReason({ packaged: true, platform: 'linux', arch: 'x64', env: { APPIMAGE: '/a.AppImage' } }), null);
  assert.strictEqual(unsupportedReason({ packaged: true, platform: 'darwin', arch: 'arm64', env: {} }), null);
});

test('Mac の .app のフォルダを実行ファイルの場所から求める', () => {
  assert.strictEqual(macBundlePath('/Applications/Worktree Kanban.app/Contents/MacOS/Worktree Kanban'), '/Applications/Worktree Kanban.app');
  assert.strictEqual(macBundlePath('/usr/bin/electron'), '');
});

// fetch の代わり: URL ごとに返す応答を決める
function fakeFetch(map) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = map(url);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, url: r.url || url };
  };
  fn.calls = calls;
  return fn;
}

const mk = (fetch, o = {}) => new Updater({ currentVersion: '0.1.8', packaged: true, platform: 'darwin', arch: 'arm64', env: {}, fetch, ...o });

test('新しい版があり、この OS 向けのファイルもあれば available', async () => {
  const f = fakeFetch((u) => (u.endsWith('/releases/latest') ? { status: 200, url: 'https://github.com/kazuya83/worktree-kanban/releases/tag/v0.1.9' } : { status: 200 }));
  const up = mk(f);
  const events = [];
  up.on('changed', (s) => events.push(s.state));
  const s = await up.check();
  assert.strictEqual(s.state, 'available');
  assert.strictEqual(s.latestVersion, '0.1.9');
  assert.match(s.releaseUrl, /\/releases\/tag\/v0\.1\.9$/);
  assert.ok(f.calls.some((u) => u.endsWith('/releases/download/v0.1.9/worktree-kanban-0.1.9-mac-arm64.dmg')));
  assert.deepStrictEqual(events, ['checking', 'available']);
});

test('同じ版なら latest、ファイルがまだなければ preparing、通信できなければ error', async () => {
  const same = await mk(fakeFetch(() => ({ status: 200, url: 'https://github.com/kazuya83/worktree-kanban/releases/tag/v0.1.8' }))).check();
  assert.strictEqual(same.state, 'latest');
  const prep = await mk(fakeFetch((u) => (u.endsWith('/latest') ? { status: 200, url: 'https://github.com/kazuya83/worktree-kanban/releases/tag/v0.1.9' } : { status: 404 }))).check();
  assert.strictEqual(prep.state, 'preparing');
  const err = await mk(fakeFetch(() => new Error('offline'))).check();
  assert.strictEqual(err.state, 'error');
  assert.match(err.error, /offline/);
});

test('同時に何回確かめても、問い合わせは1回', async () => {
  const f = fakeFetch(() => ({ status: 200, url: 'https://github.com/kazuya83/worktree-kanban/releases/tag/v0.1.8' }));
  const up = mk(f);
  await Promise.all([up.check(), up.check(), up.check()]);
  assert.strictEqual(f.calls.length, 1);
});

test('新しい版がないとき・開発版では入れ替えない', async () => {
  const up = mk(fakeFetch(() => ({ status: 200, url: 'https://github.com/kazuya83/worktree-kanban/releases/tag/v0.1.8' })));
  await up.check();
  assert.throws(() => up.install(), /新しい版はありません/);
  assert.throws(() => mk(null, { packaged: false }).install(), /開発版/);
});

test('入れ替えのスクリプトを、アプリと切り離して起動する', async () => {
  const spawned = [];
  const spawn = (command, args, opts) => {
    spawned.push({ command, args, opts });
    return { unref() {} };
  };
  const up = mk(fakeFetch((u) => (u.endsWith('/latest') ? { status: 200, url: 'https://github.com/kazuya83/worktree-kanban/releases/tag/v0.1.9' } : { status: 200 })), { spawn, env: { ELECTRON_RUN_AS_NODE: '1', HOME: '/h' } });
  await up.check();
  const s = up.install({ pid: 4321, execPath: '/Applications/Worktree Kanban.app/Contents/MacOS/Worktree Kanban' });
  assert.strictEqual(s.state, 'installing');
  assert.strictEqual(spawned.length, 1);
  const { command, args, opts } = spawned[0];
  assert.strictEqual(command, '/bin/bash');
  assert.strictEqual(opts.detached, true);
  assert.strictEqual(opts.env.ELECTRON_RUN_AS_NODE, undefined);
  const script = args[1];
  assert.match(script, /kill -0 4321/);
  assert.match(script, /AGENT_KANBAN_VERSION='0\.1\.9' bash/);
  assert.match(script, /open '\/Applications\/Worktree Kanban\.app'/); // 入れられなかったら元のアプリを起動し直す
});

test('Mac / Linux のスクリプトは bash の文法として正しい', { skip: process.platform === 'win32' }, () => {
  for (const [platform, env] of [['darwin', {}], ['linux', { APPIMAGE: "/home/a/it's.AppImage" }]]) {
    const { args } = installCommand({ platform, pid: 1, version: '0.1.9', execPath: '/x/Worktree Kanban.app/Contents/MacOS/Worktree Kanban', env });
    const r = spawnSync('/bin/bash', ['-n', '-c', args[1]]);
    assert.strictEqual(r.status, 0, String(r.stderr));
  }
});

test('Windows は install.ps1 を使い、入れられなかったら元のアプリを起動し直す', () => {
  const { command, args } = installCommand({ platform: 'win32', pid: 99, version: 'v0.2.0', execPath: "C:\\Users\\a'b\\Worktree Kanban.exe" });
  assert.strictEqual(command, 'powershell.exe');
  const script = args[args.length - 1];
  assert.match(script, /Wait-Process -Id 99/);
  assert.match(script, /AGENT_KANBAN_VERSION = '0\.2\.0'/);
  assert.match(script, /install\.ps1/);
  assert.match(script, /Start-Process -FilePath 'C:\\Users\\a''b\\Worktree Kanban\.exe'/);
});

test('おかしな版の番号・プロセス番号ではスクリプトを作らない', () => {
  assert.throws(() => installCommand({ platform: 'darwin', pid: 1, version: '0.1.9; rm -rf /', execPath: '/x' }), /版の番号/);
  assert.throws(() => installCommand({ platform: 'darwin', pid: 0, version: '0.1.9', execPath: '/x' }), /プロセス番号/);
});

test('更新の操作は、遠隔操作中でもこのマシンで動かす', () => {
  assert.strictEqual(isLocalChannel('update:install'), true);
  assert.strictEqual(isLocalChannel('update:status'), true);
});
