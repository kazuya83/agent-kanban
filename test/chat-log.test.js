// ログタブをチャットの形に並べる renderer/chat-log.js を確かめる
const test = require('node:test');
const assert = require('node:assert');
const { build, push } = require('../renderer/chat-log');

const L = (kind, text, extra) => ({ t: 1, kind, text, ...(extra || {}) });

test('build: あなたの指示・返事・ツール・お知らせを、それぞれの項目に分ける', () => {
  const items = build(
    [L('system', 'worktree を作成しました'), L('user', '直して'), L('text', '見てみます'), L('tool', 'Read  a.js'), L('tool_result', '...'), L('text', '直しました'), L('result', '完了しました')],
    'claude',
  );
  assert.deepStrictEqual(
    items.map((it) => it.type),
    ['notice', 'user', 'assistant', 'tool', 'assistant', 'notice'],
  );
  // ツールの結果は呼び出しの項目にまとめる
  assert.strictEqual(items[3].entry.text, 'Read  a.js');
  assert.strictEqual(items[3].result.text, '...');
  // 名前とアイコンは返事のまとまりの最初だけ
  assert.strictEqual(items[2].head, true);
  assert.strictEqual(items[3].head, false);
  assert.strictEqual(items[4].head, false);
  assert.strictEqual(items[2].agent, 'claude');
});

test('build: まとまりがツールから始まったら、ツールの項目に名前を出す', () => {
  const items = build([L('user', 'x'), L('tool', 'Bash  ls'), L('tool_error', 'no'), L('text', 'だめでした')], 'codex');
  assert.strictEqual(items[1].head, true);
  assert.strictEqual(items[1].result.kind, 'tool_error');
  assert.strictEqual(items[2].head, false);
});

test('build: Pipeline でエージェントが替わったら、もう一度名前を出す', () => {
  const items = build([L('text', 'a', { agent: 'claude' }), L('text', 'b', { agent: 'claude' }), L('text', 'c', { agent: 'codex' })], 'claude');
  assert.deepStrictEqual(items.map((it) => it.head), [true, false, true]);
  assert.strictEqual(items[2].agent, 'codex');
});

test('build: 呼び出しのない結果や、2つめの結果は別の項目にする', () => {
  const items = build([L('tool_result', 'r1'), L('tool', 'Read  a'), L('tool_result', 'r2'), L('tool_result', 'r3')]);
  assert.strictEqual(items.length, 3);
  assert.strictEqual(items[0].entry, null);
  assert.strictEqual(items[0].result.text, 'r1');
  assert.strictEqual(items[1].result.text, 'r2');
  assert.strictEqual(items[2].result.text, 'r3');
});

test('push: 結果が届いたら、直前のツールの項目を描き直す（それ以外は末尾に足す）', () => {
  const items = [];
  assert.strictEqual(push(items, L('tool', 'Read  a')).op, 'append');
  const r = push(items, L('tool_result', 'ok'));
  assert.strictEqual(r.op, 'replace');
  assert.strictEqual(r.item, items[0]);
  assert.strictEqual(push(items, L('text', 'done')).op, 'append');
  assert.strictEqual(items.length, 2);
});

test('build: agent の無い返事は Claude とみなす（Claude → Codex の Pipeline で、Claude の返事を Codex と出さない）', () => {
  const items = build([L('user', 'x'), L('text', 'claude の返事'), L('system', '引き継ぎ'), L('text', 'codex の返事', { agent: 'codex' })], 'codex');
  assert.strictEqual(items[1].agent, 'claude');
  assert.strictEqual(items[3].agent, 'codex');
});

test('build: ツールの agent が替わったら、ツールの項目に名前を出し直す', () => {
  const items = build([L('text', 'a', { agent: 'claude' }), L('tool', 'Bash  ls', { agent: 'codex' }), L('tool_result', 'ok'), L('text', 'b', { agent: 'codex' })], 'codex');
  assert.deepStrictEqual(items.map((it) => it.head), [true, true, false]);
  assert.strictEqual(items[1].agent, 'codex');
});

test('build: agent の無い古いツールは、まとまりのエージェントを使う（名前は出し直さない）', () => {
  const items = build([L('text', 'a', { agent: 'gemini' }), L('tool', 'Read  a')], 'claude');
  assert.strictEqual(items[1].agent, 'gemini');
  assert.strictEqual(items[1].head, false);
});
