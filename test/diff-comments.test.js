// 差分の行コメント（renderer/diff-comments.js）: 行の対応づけと、エージェントに送る文章
const test = require('node:test');
const assert = require('node:assert');
const { parseDiff } = require('../renderer/diff-parse');
const { lineRef, keyOf, findLine, orphans, buildMessage } = require('../renderer/diff-comments');

const DIFF = [
  'diff --git a/src/a.js b/src/a.js',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -1,3 +1,3 @@',
  ' keep',
  '-old line',
  '+new line',
  ' tail',
  '\\ No newline at end of file',
].join('\n');

const comment = (over) => ({ id: 1, path: 'src/a.js', side: 'new', line: 2, code: 'new line', text: '直して', ...over });

test('消した行は変更前の行番号で、それ以外は変更後の行番号で指す', () => {
  const [del, add] = parseDiff(DIFF)[0].hunks[0].lines.slice(1, 3);
  assert.deepStrictEqual(lineRef(del), { side: 'old', line: 2 });
  assert.deepStrictEqual(lineRef(add), { side: 'new', line: 2 });
  assert.notStrictEqual(keyOf('a', lineRef(del)), keyOf('a', lineRef(add)));
});

test('findLine は同じ行番号でも変更前と変更後を取り違えない', () => {
  const [f] = parseDiff(DIFF);
  assert.strictEqual(findLine(f, { side: 'old', line: 2 }).text, 'old line');
  assert.strictEqual(findLine(f, { side: 'new', line: 2 }).text, 'new line');
  assert.strictEqual(findLine(f, { side: 'new', line: 99 }), null);
});

test('差分に同じ内容の行が無くなったコメントだけ orphans に入る', () => {
  const files = parseDiff(DIFF);
  const keep = comment();
  const moved = comment({ id: 2, code: '前の内容' });
  const gone = comment({ id: 3, path: 'src/gone.js' });
  assert.deepStrictEqual(orphans(files, [keep, moved, gone]).map((x) => x.id), [2, 3]);
});

test('送る文章はファイル・行の順に、場所と該当の行とコメントを持つ', () => {
  const msg = buildMessage([
    comment({ id: 1, path: 'src/b.js', line: 1, code: '  b();\r', text: 'B を直す\n2行目' }),
    comment({ id: 2, line: 20, code: 'twenty', text: '20' }),
    comment({ id: 3, line: 3, side: 'old', code: 'removed', text: '戻して' }),
    comment({ id: 4, line: 4, code: '', text: '空行' }),
  ]);
  assert.ok(msg.indexOf('`src/a.js:3` （変更前の行）\n> removed\n\n戻して') > 0, msg);
  assert.ok(msg.includes('`src/a.js:4`\n> （空行）\n\n空行'), msg);
  assert.ok(msg.includes('`src/b.js:1`\n> b();\n\nB を直す\n2行目'), msg);
  const order = ['a.js:3', 'a.js:4', 'a.js:20', 'b.js:1'].map((x) => msg.indexOf(x));
  assert.deepStrictEqual(order, [...order].sort((a, b) => a - b));
});

test('とても長い行は切り詰める', () => {
  const msg = buildMessage([comment({ code: 'x'.repeat(5000) })]);
  assert.ok(msg.length < 500);
  assert.ok(msg.includes('…'));
});
