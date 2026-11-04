// 似たタスクの見つけ方（スキルの提案の通知を出すかどうかに使う）
const test = require('node:test');
const assert = require('node:assert');
const { findSimilarTasks } = require('../src/similar');

const card = (id, title, prompt = '') => ({ id, title, prompt });
const issuePrompt = (n, title, body) =>
  [
    `GitHub の Issue #${n} を解決してください。`,
    '',
    `タイトル: ${title}`,
    `URL: https://github.com/o/r/issues/${n}`,
    '',
    '## 本文',
    body,
    '',
    '## 進め方',
    '- まずリポジトリのコードを読んで、Issue の内容と原因を理解してください',
    '- 必要な変更を行い、テストがあれば実行して確かめてください',
    '- 最後に、何をどう変えたかを短くまとめてください',
  ].join('\n');

test('似た作業のタスクを、似ている順に見つける。自分自身は数えない', () => {
  const target = card('t', 'リレーの文言変更', 'リレーの説明の文言を短くしてください');
  const pool = [
    target,
    card('a', 'リレー文言変更', 'リレーの説明の文言を変えて'),
    card('b', 'Node.js のバージョンを上げる', 'package.json の engines を 22 にする'),
    card('c', 'ダークモード対応', '画面をダークモードにも対応させる'),
  ];
  const r = findSimilarTasks(target, pool);
  assert.deepStrictEqual(r.map((x) => x.card.id), ['a']);
  assert.ok(r[0].score > 0.3 && r[0].score <= 1);
});

test('Issue から作ったタスクの決まり文句だけが同じなら、似ているとはみなさない', () => {
  const issues = [
    card('1', '#1 Node.js のバージョンを上げる', issuePrompt(1, 'Node.js のバージョンを上げる', '（本文なし）')),
    card('2', '#2 ダークモード対応', issuePrompt(2, 'ダークモード対応', '画面をダークモードにも対応させたい')),
    card('3', '#3 ログの保存期間', issuePrompt(3, 'ログの保存期間', '古いログを消したい')),
    card('4', '#4 マージ中のローディング', issuePrompt(4, 'マージ中のローディング', 'マージしているあいだローディングを出す')),
  ];
  const target = card('5', '#5 更新中のローディングが出ない', issuePrompt(5, '更新中のローディングが出ない', 'マージなどで更新しているあいだローディングが出ない'));
  const r = findSimilarTasks(target, [...issues, target]);
  assert.deepStrictEqual(r.map((x) => x.card.id), ['4'], 'ローディングの話だけが似ている');
});

test('比べる相手がいない・中身が空なら、何も返さない', () => {
  assert.deepStrictEqual(findSimilarTasks(card('x', 'a'), []), []);
  assert.deepStrictEqual(findSimilarTasks(card('x', ''), [card('y', '')]), []);
});
