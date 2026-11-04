// Release の説明（Markdown）の作り方
const test = require('node:test');
const assert = require('node:assert');
const { buildNotes, classify, previousTag, repoFromUrl } = require('../scripts/release-notes');

test('変わったファイルと件名で分ける', () => {
  assert.strictEqual(classify({ subject: '詳細にチャットタブを追加', files: ['renderer/renderer.js'] }), 'feature');
  assert.strictEqual(classify({ subject: '差分の表示UI修正', files: ['renderer/styles.css'] }), 'fix');
  assert.strictEqual(classify({ subject: 'README: 撮り直す', files: ['README.md', 'renderer/renderer.js'] }), 'docs');
  assert.strictEqual(classify({ subject: 'CI: Mac を変える', files: ['.github/workflows/build.yml'] }), 'dev');
  assert.strictEqual(classify({ subject: 'スキルを追加', files: ['.claude/skills/release/SKILL.md'] }), 'dev');
  assert.strictEqual(classify({ subject: 'フックを有効にする', files: ['package.json', 'scripts/setup-hooks.js'] }), 'dev');
});

test('前の版のタグは、出す版より小さい中でいちばん新しいもの', () => {
  assert.strictEqual(previousTag(['v0.1.9', 'v0.1.10', 'v0.1.8', 'nightly'], '0.1.11'), 'v0.1.10');
  assert.strictEqual(previousTag(['v0.1.9', 'v0.1.10'], '0.1.10'), 'v0.1.9');
  assert.strictEqual(previousTag([], '0.1.0'), null);
});

test('origin の URL から owner/repo を取り出す', () => {
  assert.strictEqual(repoFromUrl('git@github.com:kazuya83/agent-kanban.git'), 'kazuya83/agent-kanban');
  assert.strictEqual(repoFromUrl('https://github.com/kazuya83/agent-kanban'), 'kazuya83/agent-kanban');
  assert.strictEqual(repoFromUrl('/tmp/repo.git'), null);
});

test('見出しごとにまとめ、ダウンロードの表と比較のリンクを付ける', () => {
  const md = buildNotes({
    version: '0.1.49',
    prevTag: 'v0.1.48',
    repo: 'o/r',
    // git log と同じく新しい順
    commits: [
      { subject: 'agent: 入力欄の高さを直す', files: ['renderer/styles.css'] },
      { subject: 'agent: 一覧が表示されない', files: ['renderer/renderer.js'] },
      { subject: 'agent: 入力欄の高さを直す', files: ['renderer/styles.css'] },
    ],
    assets: ['dist/agent-kanban-0.1.49-linux-x86_64.AppImage', 'dist/agent-kanban-0.1.49-mac-arm64.dmg'],
  });
  assert.match(md, /^v0\.1\.48 からの変更点です。/);
  assert.match(md, /## ✨ 新機能・改善\n\n- 入力欄の高さを直す\n/);
  assert.match(md, /## 🐛 不具合の修正\n\n- 一覧が表示されない\n/);
  assert.strictEqual(md.match(/入力欄の高さを直す/g).length, 1);
  assert.ok(md.indexOf('macOS（Apple シリコン）') < md.indexOf('Linux（AppImage）'));
  assert.match(md, /https:\/\/github\.com\/o\/r\/releases\/download\/v0\.1\.49\/agent-kanban-0\.1\.49-mac-arm64\.dmg/);
  assert.match(md, /\*\*Full Changelog\*\*: https:\/\/github\.com\/o\/r\/compare\/v0\.1\.48\.\.\.v0\.1\.49\n$/);
});

test('変更がなくても空にしない', () => {
  const md = buildNotes({ version: '0.1.0', prevTag: null, repo: null, commits: [] });
  assert.match(md, /はじめてのリリースです。\n\n- 細かな調整\n$/);
});
