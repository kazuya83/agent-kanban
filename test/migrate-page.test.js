// 「Vibe Kanban から移る方法」のページ（GitHub Pages は .nojekyll なので HTML で置く）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = 'https://kazuya83.github.io/worktree-kanban/';
const PAGES = ['migrate-from-vibe-kanban.html', 'migrate-from-vibe-kanban.ja.html'];
const headings = (html) => [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => m[1]);

for (const name of PAGES) test(`docs/${name}: 検索向けの情報と、もう一方の言語へのリンクがある`, () => {
  const html = read(`docs/${name}`);
  assert.ok(html.includes(`<link rel="canonical" href="${BASE}${name}">`));
  for (const page of PAGES) assert.ok(html.includes(`${BASE}${page}"`), page);
  assert.ok(html.includes(`class="lang" href="${PAGES.find((p) => p !== name)}"`));
  assert.match(html, /<meta name="description" content="[^"]{40,}">/);
});

test('2つのページは見出しの段が同じ', () => {
  assert.deepEqual(headings(read(`docs/${PAGES[0]}`)), headings(read(`docs/${PAGES[1]}`)));
});

test('ページのローカルの参照先があり、ライセンスを誤って書いていない', () => {
  for (const name of PAGES) {
    const html = read(`docs/${name}`);
    for (const [, target] of html.matchAll(/(?:href|src)="(?!https?:|\.\/)([^"#]+)"/g)) {
      assert.ok(fs.existsSync(path.join(root, 'docs', target)), target);
    }
    assert.doesNotMatch(html, /open.?source|\bOSS\b|オープンソース/i);
    assert.match(html, /source-available/);
  }
});

test('紹介ページと5言語の README から移行ページへ行ける', () => {
  const index = read('docs/index.html');
  assert.equal(index.match(/ migrate: '/g).length, 5);
  for (const name of PAGES) assert.ok(index.includes(name), name);
  for (const file of ['README.md', 'README.es.md', 'README.fr.md', 'README.zh-CN.md']) {
    assert.ok(read(file).includes(`(${BASE}${PAGES[0]})`), file);
  }
  assert.ok(read('README.ja.md').includes(`(${BASE}${PAGES[1]})`));
});
