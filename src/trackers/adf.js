// Atlassian Document Format（Jira Cloud の本文の形）とプレーンテキストの変換
// 知らない種類のノードが来ても落とさず、中の文字を拾う（ADF は種類が増えていくため）

const asList = (v) => (Array.isArray(v) ? v : []);
const attrsOf = (n) => (n && n.attrs && typeof n.attrs === 'object' ? n.attrs : {});
const indented = (text, first, rest) => String(text).split('\n').map((line, i) => (i === 0 ? first : rest) + line).join('\n');

function isoDate(ms) {
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? String(ms || '') : d.toISOString().slice(0, 10);
}

function textNode(n) {
  let s = String(n.text || '');
  const marks = asList(n.marks);
  if (marks.some((m) => m && m.type === 'code')) s = `\`${s}\``;
  const link = marks.find((m) => m && m.type === 'link');
  const href = link && attrsOf(link).href;
  return href && href !== s ? `${s} (${href})` : s;
}

function inlineNode(n) {
  if (!n || typeof n !== 'object') return '';
  const a = attrsOf(n);
  switch (n.type) {
    case 'text':
      return textNode(n);
    case 'hardBreak':
      return '\n';
    case 'mention':
      return String(a.text || (a.id ? `@${a.id}` : ''));
    case 'emoji':
      return String(a.text || a.shortName || '');
    case 'date':
      return isoDate(a.timestamp);
    case 'status':
      return String(a.text || '');
    case 'inlineCard':
      return String(a.url || '');
    default:
      return n.content ? inline(n.content) : String(n.text || '');
  }
}

const inline = (nodes) => asList(nodes).map(inlineNode).join('');

function listItems(items, marker) {
  return asList(items)
    .map((item, i) => {
      const m = marker(i, item);
      return indented(blocks(item && item.content, '\n'), m, ' '.repeat(m.length));
    })
    .join('\n');
}

function table(n) {
  return asList(n.content)
    .map((row) => asList(row && row.content).map((cell) => blocks(cell && cell.content).replace(/\s*\n\s*/g, ' ')).join(' | '))
    .join('\n');
}

function blockNode(n) {
  if (!n || typeof n !== 'object') return '';
  const a = attrsOf(n);
  switch (n.type) {
    case 'paragraph':
      return inline(n.content);
    case 'heading':
      return `${'#'.repeat(Math.min(6, Math.max(1, Number(a.level) || 1)))} ${inline(n.content)}`;
    case 'bulletList':
    case 'decisionList':
      return listItems(n.content, () => '- ');
    case 'orderedList': {
      const start = Number(a.order) || 1;
      return listItems(n.content, (i) => `${start + i}. `);
    }
    case 'taskList':
      return asList(n.content).map((item) => `- [${attrsOf(item).state === 'DONE' ? 'x' : ' '}] ${item && item.content ? inline(item.content) : ''}`).join('\n');
    case 'blockquote':
      return indented(blocks(n.content), '> ', '> ');
    case 'codeBlock':
      return `\`\`\`${a.language || ''}\n${asList(n.content).map((x) => (x && x.text) || '').join('')}\n\`\`\``;
    case 'rule':
      return '---';
    case 'table':
      return table(n);
    case 'expand':
    case 'nestedExpand':
      return [a.title, blocks(n.content)].filter(Boolean).join('\n');
    case 'mediaSingle':
    case 'mediaGroup':
      return blocks(n.content);
    case 'media':
      return `[添付: ${a.alt || a.id || ''}]`;
    case 'blockCard':
    case 'embedCard':
      return String(a.url || '');
    default:
      return asList(n.content).some((x) => x && BLOCK_TYPES.has(x.type)) ? blocks(n.content) : inlineNode(n);
  }
}

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'decisionList', 'blockquote', 'codeBlock', 'rule', 'table', 'expand', 'nestedExpand', 'panel', 'mediaSingle', 'mediaGroup', 'blockCard', 'embedCard']);

const blocks = (nodes, gap = '\n\n') => asList(nodes).map(blockNode).filter((s) => s !== '').join(gap);

/** ADF（Data Center の本文のような文字列はそのまま）をプレーンテキストにする */
function adfToText(doc) {
  if (doc === null || doc === undefined) return '';
  if (typeof doc !== 'object') return String(doc);
  return blocks(doc.type === 'doc' || !doc.type ? doc.content : [doc]).trim();
}

// 行の中の URL をリンクにする
function lineNodes(line) {
  const out = [];
  let at = 0;
  for (const m of line.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = m[0].replace(/[.,;:!?)\]、。）」]+$/, '');
    if (m.index > at) out.push({ type: 'text', text: line.slice(at, m.index) });
    out.push({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] });
    at = m.index + url.length;
  }
  if (at < line.length) out.push({ type: 'text', text: line.slice(at) });
  return out;
}

/** プレーンテキストを ADF にする。空行で段落を分け、1回の改行は段落の中の改行にする（ADF は空の text を許さない） */
function textToAdf(text) {
  const paragraphs = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const content = paragraphs.map((p) => {
    const nodes = [];
    p.split('\n').forEach((line, i) => {
      if (i) nodes.push({ type: 'hardBreak' });
      nodes.push(...lineNodes(line));
    });
    return { type: 'paragraph', content: nodes };
  });
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

module.exports = { adfToText, textToAdf };
