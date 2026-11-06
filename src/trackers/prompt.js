// Issue からエージェントへの指示を作る（どのサービスの Issue でも同じ形）
const { keyOf } = require('../../renderer/issue-ref');

function clip(s, n) {
  s = String(s || '').trim();
  return s.length > n ? `${s.slice(0, n)}\n…（長いので省略）` : s;
}

/**
 * @param {{ number?: number, key?: string, title: string, url: string, body?: string, labels?: string[], comments?: {author: string, body: string}[] }} issue
 * @param {string} [extra] 追加の指示
 * @param {{ label?: string }} [opts] label: サービスの名前
 */
function buildIssuePrompt(issue, extra, { label = 'GitHub' } = {}) {
  const lines = [
    `${label} の Issue ${keyOf(issue)} を解決してください。`,
    '',
    `タイトル: ${issue.title}`,
    `URL: ${issue.url}`,
  ];
  if (issue.labels && issue.labels.length) lines.push(`ラベル: ${issue.labels.join(', ')}`);
  lines.push('', '## 本文', clip(issue.body, 20000) || '（本文なし）');
  const comments = (issue.comments || []).slice(-20);
  if (comments.length) {
    lines.push('', '## コメント');
    for (const c of comments) lines.push('', `### @${c.author}`, clip(c.body, 3000));
  }
  if (extra && extra.trim()) lines.push('', '## 追加の指示', extra.trim());
  lines.push(
    '',
    '## 進め方',
    '- まずリポジトリのコードを読んで、Issue の内容と原因を理解してください',
    '- 必要な変更を行い、テストがあれば実行して確かめてください',
    '- 最後に、何をどう変えたかを短くまとめてください',
  );
  return lines.join('\n');
}

module.exports = { buildIssuePrompt };
