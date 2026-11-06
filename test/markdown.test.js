// ログの Markdown 表示に使う renderer/markdown.js を確かめる
const test = require('node:test');
const assert = require('node:assert');
const { render } = require('../renderer/markdown');

test('見出し・太字・コード・リストを HTML にする', () => {
  const html = render('## 変更点\n\n**大事**な点と `npm test` の結果:\n\n- ひとつ目\n- ふたつ目\n\n1. 手順A\n2. 手順B');
  assert.match(html, /<h2>変更点<\/h2>/);
  assert.match(html, /<strong>大事<\/strong>/);
  assert.match(html, /<code>npm test<\/code>/);
  assert.match(html, /<ul><li>ひとつ目<\/li><li>ふたつ目<\/li><\/ul>/);
  assert.match(html, /<ol><li>手順A<\/li><li>手順B<\/li><\/ol>/);
});

test('コードブロックの中は装飾せず、そのまま出す', () => {
  const html = render('```js\nconst a = **b**;\n# not heading\n```\n後ろの文');
  assert.match(html, /<pre class="md-code" data-lang="js"><code>const a = \*\*b\*\*;\n# not heading<\/code><\/pre>/);
  assert.match(html, /<p>後ろの文<\/p>/);
});

test('コードブロックには、スクロールする pre の外にコピーボタンが付く', () => {
  const html = render('```\necho <a>\n```');
  assert.match(html, /^<div class="md-code-wrap"><button class="md-copy" type="button"[^>]*>コピー<\/button><pre class="md-code"><code>echo &lt;a&gt;<\/code><\/pre><\/div>$/);
  // 行の中の `code` には付けない
  assert.ok(!/md-copy/.test(render('`npm test` を動かす')));
});

test('表を table にする', () => {
  const html = render('| ファイル | 内容 |\n|---|:-:|\n| a.js | 追加 |');
  assert.match(html, /<th>ファイル<\/th>/);
  assert.match(html, /<td style="text-align:center">追加<\/td>/);
});

test('入れ子のリストと引用', () => {
  const html = render('- 親\n  - 子\n> 引用です');
  assert.match(html, /<li>親<ul><li>子<\/li><\/ul><\/li>/);
  assert.match(html, /<blockquote><p>引用です<\/p><\/blockquote>/);
});

test('HTML やスクリプトはエスケープされ、リンクは http(s) だけ', () => {
  const html = render('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://example.com/a?b=1&c=2) `<b>`');
  assert.ok(!/<img/.test(html));
  assert.ok(!/href=/.test(html));
  assert.ok(!/data-url="javascript/.test(html));
  assert.match(html, /<a class="md-link" data-url="https:\/\/example\.com\/a\?b=1&amp;c=2"[^>]*>ok<\/a>/);
  assert.match(html, /<code>&lt;b&gt;<\/code>/);
  // 属性を抜け出そうとする URL
  const h2 = render('[a](https://e.com/"onmouseover="x)');
  assert.ok(!h2.includes('"onmouseover'));
});

test('段落の中の改行は保つ', () => {
  assert.strictEqual(render('一行目\n二行目'), '<p>一行目<br>二行目</p>');
});
