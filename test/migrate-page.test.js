// 「Vibe Kanban から移る方法」「Conductor から移る方法」のページ（GitHub Pages は .nojekyll なので HTML で置く）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const BASE = 'https://kazuya83.github.io/worktree-kanban/';
const GUIDES = [
  ['migrate-from-vibe-kanban.html', 'migrate-from-vibe-kanban.ja.html'],
  ['migrate-from-conductor.html', 'migrate-from-conductor.ja.html'],
];
const PAGES = GUIDES.flat();
const headings = (html) => [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => m[1]);

for (const name of PAGES) test(`docs/${name}: 検索向けの情報と、もう一方の言語へのリンクがある`, () => {
  const html = read(`docs/${name}`);
  assert.ok(html.includes(`<link rel="canonical" href="${BASE}${name}">`));
  const pair = GUIDES.find((g) => g.includes(name));
  for (const page of pair) assert.ok(html.includes(`${BASE}${page}"`), page);
  assert.ok(html.includes(`class="lang" href="${pair.find((p) => p !== name)}"`));
  assert.match(html, /<meta name="description" content="[^"]{40,}">/);
});

test('2つのページは見出しの段が同じ', () => {
  for (const [en, ja] of GUIDES) assert.deepEqual(headings(read(`docs/${en}`)), headings(read(`docs/${ja}`)));
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
  assert.equal(index.match(/ migrateConductor: '/g).length, 5);
  for (const name of PAGES) assert.ok(index.includes(name), name);
  for (const [en, ja] of GUIDES) {
    for (const file of ['README.md', 'README.es.md', 'README.fr.md', 'README.zh-CN.md']) {
      assert.ok(read(file).includes(`(${BASE}${en})`), file);
    }
    assert.ok(read('README.ja.md').includes(`(${BASE}${ja})`));
  }
});

test('Conductor のページは、Cloud のデータを公式の手順で先に書き出すよう案内する', () => {
  for (const name of GUIDES[1]) {
    const html = read(`docs/${name}`);
    const firstStep = html.indexOf('<h3>1. ');
    assert.ok(firstStep < html.indexOf('<h3>2. '));
    const step = html.slice(firstStep, html.indexOf('<h3>2. '));
    assert.match(step, /Settings → Account → Export data/);
    assert.match(step, /Transfer to local/);
    assert.ok(html.indexOf('Cloud') < html.indexOf('<h2>'), 'ページの先頭で Cloud に触れる');
  }
});
