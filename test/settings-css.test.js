const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('renderer/settings.css');
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

// 指定のセレクタのブロックを、メディアクエリの外だけから探す
function rule(selector, source = noComments.split('@media')[0]) {
  const at = source.split('}').find((b) => b.split('{')[0].trim() === selector);
  assert.ok(at, `${selector} のルールがない`);
  return at.split('{')[1];
}
const media = (query) => {
  const i = noComments.indexOf(`@media ${query}`);
  assert.notEqual(i, -1, `${query} のメディアクエリがない`);
  const rest = noComments.slice(i);
  return rest.slice(rest.indexOf('{') + 1);
};

test('画面はトップバーの下いっぱいに広がり、中身の高さで押し広げない', () => {
  const b = rule('.settings-view');
  assert.match(b, /flex:\s*1/);
  assert.match(b, /display:\s*flex/);
  assert.match(b, /min-height:\s*0/);
  assert.match(b, /min-width:\s*0/);
});

test('左の一覧と右の本文は別々にスクロールする', () => {
  assert.match(rule('.settings-nav'), /overflow-y:\s*auto/);
  assert.match(rule('.settings-nav'), /width:\s*240px/);
  assert.match(rule('.settings-main'), /overflow:\s*auto/);
  assert.match(rule('.settings-main'), /min-width:\s*0/);
});

test('節の offsetTop をスクロール領域から測れる', () => {
  assert.match(rule('.settings-main'), /position:\s*relative/);
});

test('現在地は左の青いバーで示す', () => {
  const b = rule('.settings-nav-item.active::before');
  assert.match(b, /background:\s*var\(--accent\)/);
  assert.match(b, /content:/);
  assert.match(rule('.settings-nav-item'), /position:\s*relative/);
});

test('見出しはミュート色で、グループの間に罫線が入る。先頭のグループには入らない', () => {
  const b = rule('.settings-nav-heading');
  assert.match(b, /color:\s*var\(--muted\)/);
  assert.match(b, /border-top:\s*1px solid var\(--line\)/);
});

test('項目を押して着いた節が、現在地の判定（scrollTop + 24 以下）に入る', () => {
  const m = rule('.settings-section').match(/scroll-margin-top:\s*(\d+)px/);
  assert.ok(m, 'scroll-margin-top がない');
  assert.ok(Number(m[1]) <= 24, `scroll-margin-top が ${m[1]}px で、判定の幅を超えている`);
});

test('最後の節は画面の高さぶんあり、どの項目でも先頭まで届く', () => {
  assert.match(rule('.settings-section:last-of-type'), /min-height:\s*100vh/);
});

test('保存のボタンは下に貼り付き、下の文字が透けない', () => {
  const b = rule('.settings-actions');
  assert.match(b, /position:\s*sticky/);
  assert.match(b, /bottom:\s*0/);
  assert.match(b, /background:\s*var\(--panel\)/);
});

test('本文とボタンの幅がそろう', () => {
  const width = (s) => rule(s).match(/max-width:\s*(\d+)px/)?.[1];
  assert.equal(width('.settings-content'), '860');
  assert.equal(width('.settings-actions'), width('.settings-content'));
});

test('土台はモーダルと同じ色で、入力欄などの背景と見分けられる', () => {
  assert.match(rule('.settings-view'), /background:\s*var\(--panel\)/);
  assert.match(read('renderer/styles.css'), /\.modal-box \{ background: var\(--panel\)/);
});

test('モーダルの外で効かなくなる見た目を持つ', () => {
  assert.match(rule('.settings-title'), /border-bottom:\s*1px solid var\(--line\)/);
  const code = (s, src) => rule(s, src).split(';').map((d) => d.trim()).filter(Boolean);
  assert.deepEqual(code('.settings-view code'), code('.modal-box code', read('renderer/styles.css')));
});

test('720px 以下では一覧を上にたたみ、折り返して全項目を見せる', () => {
  const m = media('(max-width: 720px)');
  assert.match(rule('.settings-view', m), /flex-direction:\s*column/);
  const nav = rule('.settings-nav', m);
  assert.match(nav, /width:\s*100%/);
  assert.match(nav, /flex-wrap:\s*wrap/);
  assert.match(rule('.settings-nav-heading', m), /display:\s*none/);
});

test('描き直しで scrollTop を戻すので、スクロールをアニメーションにしない', () => {
  assert.doesNotMatch(noComments, /scroll-behavior/);
});

test('.hidden で隠せる（!important のまま）', () => {
  assert.match(read('renderer/styles.css'), /\.hidden\s*\{\s*display:\s*none\s*!important/);
  assert.doesNotMatch(css, /!important/);
});

test('色はすべてテーマの変数を使い、ライト・ダークで変わる', () => {
  assert.doesNotMatch(noComments, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(noComments, /\b(?:rgba?|hsla?)\(/i);
});

test('モーダルのスタイルには手を入れない', () => {
  assert.doesNotMatch(noComments, /\.modal/);
});

const docs = ['README.md', ...fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];

for (const file of docs) {
  test(`${file}: 上部の設定ボタンの説明が残っていない`, () => {
    const text = read(file);
    assert.doesNotMatch(text, /⚙/);
    assert.doesNotMatch(text, /(?:上部|右上)の[^。\n]{0,6}「?設定」?(?:ボタン|を押)/);
  });
}

test('docs/settings.md に、すべての項目の見出しと開き方がある', () => {
  const text = read('docs/settings.md');
  assert.match(text, /メニューボタン[^\n]*「設定」/);
  for (const name of ['全般', 'アプリの更新', 'ブランチと取り込み', 'Issue 連携', '権限', 'タスクの既定', '使うエージェント', 'カスタムエージェント', 'オーケストレーション']) {
    assert.match(text, new RegExp(`^## ${name}$`, 'm'), `## ${name} がない`);
  }
  assert.doesNotMatch(text, /キャンセル/);
  assert.match(text, /元に戻す/);
});

test('docs/settings.md のページ内リンクの行き先がある', () => {
  const text = read('docs/settings.md');
  const anchors = new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1].trim().toLowerCase().replace(/\s+/g, '-')));
  const links = [...text.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 9);
  for (const a of links) assert.ok(anchors.has(a), `#${a} の見出しがない`);
});
