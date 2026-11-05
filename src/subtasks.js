// サブタスク: 1つのタスク（親）を、いくつかのサブタスクに分けて進める
// - 親のタスクのブランチを1本作り、サブタスクはそのブランチから分けた worktree で動かす
// - サブタスクが終わったら、親のブランチにマージする（自動、またはユーザーが確かめてから）
// - 直列か並列かは、サブタスクごとの after（先に終わっている必要があるサブタスクの key）で決める
// - すべてマージしたら、親のエージェントが仕上げ（テスト・つなぎの直し）をしてからレビューに回す
//
// 親のカード: c.subtasks = {
//   items: [{ key, title, prompt, after: [key], issue?: { number, title, url }, cardId?, state, report?, branch?, costUsd? }],
//     state: pending（まだ始めていない）/ running（サブタスクのカードがある）/ merged（親のブランチにマージした）/ skipped（破棄された）
//   merge: 'auto' | 'review'   サブタスクが終わったら自動でマージするか、確かめてからマージするか
//   phase: 'plan'  順番（直列・並列）をエージェントに決めてもらう前（親の最初の実行で決める）
//          'run'   サブタスクを動かしている
//          'done'  すべてマージした（親が仕上げをして、レビューへ）
//   note?: 分け方の説明（エージェントの返事）
// }
// 提案: c.subtaskProposal = { items, at }（ユーザーが「サブタスクでやる」と答えたら c.subtasks にする）
// サブタスクのカード: c.subtaskOf = { parent, key, approved? }

const SUBTASK_MARKER = '[[SUBTASKS]]';
const SUBTASK_LANG = 'subtasks';
const SUBTASK_BLOCK_RE = new RegExp('\\n?[ \\t]*```[ \\t]*' + SUBTASK_LANG + '[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*```[ \\t]*', 'g');
const MAX_SUBTASKS = 12;
const MERGE_MODES = ['auto', 'review'];

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function cleanMergeMode(v) {
  return MERGE_MODES.includes(v) ? v : 'auto';
}

function cleanKey(v, i) {
  const k = String(v ?? '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return k || `s${i + 1}`;
}

/**
 * サブタスクの一覧を確かめて整える（key の重なり・知らない after・自分自身・循環を外す）
 * @param {any[]} list
 * @returns {Array<{ key: string, title: string, prompt: string, after: string[], issue?: object }>}
 */
function cleanItems(list) {
  const out = [];
  const used = new Set();
  for (const [i, x] of (Array.isArray(list) ? list : []).entries()) {
    if (!x || typeof x !== 'object') continue;
    const title = truncate(String(x.title || '').trim(), 120);
    const prompt = truncate(String(x.prompt || '').trim(), 20000);
    if (!title && !prompt) continue;
    let key = cleanKey(x.key, i);
    for (let n = 2; used.has(key); n++) key = `${cleanKey(x.key, i)}-${n}`;
    used.add(key);
    const item = { key, title: title || truncate(prompt.split('\n')[0], 60), prompt: prompt || title, after: Array.isArray(x.after) ? x.after.map((a) => String(a ?? '').trim()).filter(Boolean) : [] };
    if (x.issue && Number(x.issue.number) > 0) item.issue = { number: Number(x.issue.number), title: String(x.issue.title || ''), url: String(x.issue.url || '') };
    out.push(item);
    if (out.length >= MAX_SUBTASKS) break;
  }
  const keys = new Set(out.map((x) => x.key));
  for (const x of out) x.after = [...new Set(x.after.filter((a) => keys.has(a) && a !== x.key))];
  // 循環があれば、循環を作っている線を外す（並べた順で前にあるものへの依存だけ残す）
  if (hasCycle(out)) {
    const order = new Map(out.map((x, i) => [x.key, i]));
    for (const x of out) x.after = x.after.filter((a) => order.get(a) < order.get(x.key));
  }
  return out;
}

function hasCycle(items) {
  const map = new Map(items.map((x) => [x.key, x]));
  const state = new Map();
  const visit = (k) => {
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const a of (map.get(k) || {}).after || []) if (visit(a)) return true;
    state.set(k, 2);
    return false;
  };
  return items.some((x) => visit(x.key));
}

function parseItems(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (data && !Array.isArray(data) && Array.isArray(data.subtasks)) data = data.subtasks;
  const items = cleanItems(data);
  return items.length ? items : null;
}

function hasSubtaskMarker(text) {
  return String(text || '').trimStart().startsWith(SUBTASK_MARKER);
}

/**
 * 返事から、サブタスクの印と ```subtasks のブロックを取り出す
 * @returns {{ text: string, marked: boolean, items: object[]|null }}
 */
function extractSubtasks(raw) {
  let src = String(raw || '');
  const marked = hasSubtaskMarker(src);
  if (marked) src = src.trimStart().slice(SUBTASK_MARKER.length).replace(/^[ \t]*\n?/, '');
  let items = null;
  const body = src.replace(SUBTASK_BLOCK_RE, (_, json) => {
    if (!items) items = parseItems(json);
    return '';
  });
  return { text: marked || items ? body.replace(/\s+$/, '') : src, marked, items };
}

// 印とブロックを除いた本文（カードの一言など）
function stripSubtasks(raw) {
  return extractSubtasks(raw).text;
}

// ---------- 指示 ----------

// サブタスクに分けたほうがよいときに、提案してもらう（新しいタスクの最初の指示に付ける）
const SUBTASK_PROPOSE_PROMPT = [
  '# サブタスクに分けるかを判断してください',
  '',
  '仕様が詰まったら（最初から詰まっていればすぐに）、開発を始める前に、このタスクをサブタスクに分けて進めたほうがよいかを判断してください。',
  '',
  '- 1つのブランチでそのまま進められる大きさなら、分けずにそのまま開発を進めてください（ほとんどのタスクはこちらです）',
  '- 独立した大きな作業がいくつも入っていて、分けたほうが速く・確実に進められるときだけ、ファイルを変えずに次の形でサブタスクを提案して、そこで止まってください（サブタスクは、それぞれ別のエージェントが親のブランチから分けたブランチで作業し、終わったものから親のブランチにマージします）',
  `  1. 1行目に \`${SUBTASK_MARKER}\` とだけ書く（アプリがこの印で「サブタスクの提案」にします。ユーザーには表示されません）`,
  '  2. 分け方と理由を短く説明し、サブタスクを番号付きで並べる（並列に進められるもの・先に終わっている必要があるもの）',
  '  3. 最後は「この分け方で、サブタスクにして進めますか？」のような質問で終える',
  `  4. 返事のいちばん最後に、\`\`\`${SUBTASK_LANG} のコードブロックで JSON を付ける（ユーザーには表示されません）`,
  '     形: [{"key": "api", "title": "短い名前", "prompt": "このサブタスクでやることの詳しい指示（これだけ読んで作業できるように）", "after": ["先に終わっている必要があるサブタスクの key"]}]',
  `     - 2〜${MAX_SUBTASKS - 4} 個。並列に進められるものは after を空にし、同じところを大きく触るものや、前の結果を使うものは after でつなぐ（直列にする）`,
  '- 仕様の確認の質問をしているあいだは、提案しないでください（仕様の質問が先です）',
  '- ユーザーが「分けずに進めて」と答えたら、もう提案せずに、このタスクのまま開発を進めてください',
].join('\n');

// タスクの本文のあとに付ける（本文を先に読んでもらう）
function withProposeNote(prompt) {
  return `${prompt}\n\n---\n\n${SUBTASK_PROPOSE_PROMPT}`;
}

// サブタスクが決まっているタスク（手動で足した・GitHub のサブIssue）の最初の指示: 順番を決めてもらう
function buildPlanPrompt(items) {
  const lines = [
    '# このタスクはサブタスクに分けて進めます',
    '',
    '下の「サブタスク」は、ユーザーが決めた（または GitHub のサブIssue の）サブタスクです。作業はサブタスクごとに別のエージェントが、このタスクのブランチから分けたブランチで行い、終わったものからこのブランチにマージします。',
    'あなたは、仕様が詰まったら（最初から詰まっていればすぐに）、ファイルを変えずに、サブタスクの順番（並列に進められるか、先に終わっている必要があるサブタスクがあるか）を決めて、次の形で返事をしてください。',
    '',
    `1. 1行目に \`${SUBTASK_MARKER}\` とだけ書く（ユーザーには表示されません）`,
    '2. 順番とその理由を短く説明する（質問では終えないでください。返事が来たら、アプリがすぐにサブタスクを動かし始めます）',
    `3. 返事のいちばん最後に、\`\`\`${SUBTASK_LANG} のコードブロックで JSON を付ける。形: [{"key": "下の key をそのまま", "title": "…", "prompt": "…", "after": ["先に終わっている必要があるサブタスクの key"]}]`,
    '   - サブタスクを足したり消したりはしないでください。並列に進められるものは after を空にし、同じところを大きく触るものや前の結果を使うものは after でつなぎます',
    '',
    '## サブタスク',
  ];
  for (const x of items) {
    lines.push('', `### key: ${x.key} — ${x.title}${x.issue ? `（Issue #${x.issue.number}）` : ''}`, truncate(x.prompt, 3000));
  }
  return lines.join('\n');
}

function withPlanNote(items, prompt) {
  return `${buildPlanPrompt(items)}\n\n---\n\n## タスク（全体）\n\n${prompt}`;
}

const STATE_LABEL = { pending: 'まだ', running: '作業中', merged: 'マージ済み', skipped: '破棄' };

// サブタスクのカードの最初の指示
function buildChildPrompt(parent, item) {
  const st = parent.subtasks;
  const lines = [
    `# サブタスク「${item.title}」`,
    '',
    `親のタスク「${parent.title}」をサブタスクに分けたうちの1つです。**このサブタスクの範囲だけ**を作業してください。ほかのサブタスクは別のエージェントが、並列または順番に進めています。終わったら、アプリが親のタスクのブランチにマージします。`,
    '',
    '## このサブタスクでやること',
    item.prompt,
  ];
  if (item.issue) lines.push('', `（GitHub の Issue #${item.issue.number} ${item.issue.url || ''} のサブタスクです）`.replace(/\s+）/, '）'));
  const others = st.items.filter((x) => x.key !== item.key);
  if (others.length) {
    lines.push('', '## ほかのサブタスク（参考。ここでは作業しないでください）');
    for (const x of others) lines.push(`- ${x.title}（${STATE_LABEL[x.state] || x.state}）${item.after.includes(x.key) ? ' ← 先に終わってマージ済み。その変更はこのブランチに入っています' : ''}`);
  }
  if (st.note) lines.push('', '## 分け方の説明', truncate(st.note, 3000));
  lines.push('', '## 親のタスク（全体の指示。参考）', truncate(parent.prompt, 6000));
  lines.push('', '## 進め方', '- 必要な変更を行い、テストがあれば実行して確かめてください', '- 最後に、何をどう変えたかを短くまとめてください');
  return lines.join('\n');
}

// すべてのサブタスクをマージしたあとに、親のエージェントに頼む仕上げ
function buildFinishPrompt(parent) {
  const items = parent.subtasks.items;
  const merged = items.filter((x) => x.state === 'merged');
  const skipped = items.filter((x) => x.state === 'skipped');
  const lines = [
    `サブタスク（${merged.length} 個）をすべて、このタスクのブランチにマージしました。`,
    '',
    'タスク全体を通して、仕上げをしてください。',
    '- サブタスク同士のつなぎ目（呼び出し・型・設定・重なっている変更・抜け）を確かめて、必要なら直す',
    '- テストがあれば全体で実行し、落ちていれば直す',
    '- 最後に、タスク全体で何をどう変えたかを短くまとめる',
    '',
    '## サブタスクの報告',
  ];
  for (const x of merged) lines.push('', `### ${x.title}${x.branch ? `（${x.branch}）` : ''}`, truncate(x.report || '（報告なし）', 2500));
  if (skipped.length) lines.push('', '## 破棄されたサブタスク（マージしていません）', ...skipped.map((x) => `- ${x.title}`));
  return lines.join('\n');
}

// ---------- 進め方 ----------

// 先に終わっている必要があるサブタスクが、すべてマージ（または破棄）されたか
function isUnblocked(st, item) {
  const done = new Set(st.items.filter((x) => x.state === 'merged' || x.state === 'skipped').map((x) => x.key));
  return item.after.every((a) => done.has(a));
}

// 次に始められるサブタスク
function startable(st) {
  return st.items.filter((x) => x.state === 'pending' && isUnblocked(st, x));
}

function allSettled(st) {
  return st.items.length > 0 && st.items.every((x) => x.state === 'merged' || x.state === 'skipped');
}

// 順番を決めた返事（plan）を、決まっているサブタスクに当てはめる（after だけを使う）。返事がなければ直列にする
function applyPlan(items, plan) {
  const byKey = new Map((plan || []).map((x) => [x.key, x]));
  const keys = new Set(items.map((x) => x.key));
  const out = items.map((x, i) => {
    const p = byKey.get(x.key);
    const after = p ? p.after.filter((a) => keys.has(a) && a !== x.key) : i > 0 ? [items[i - 1].key] : [];
    return { ...x, after };
  });
  return cleanItems(out).map((x, i) => ({ ...out[i], after: x.after }));
}

// 順番の説明（ログ用）: 「並列: A・B / C は A のあと」
function describeOrder(items) {
  const title = new Map(items.map((x) => [x.key, x.title]));
  const free = items.filter((x) => !x.after.length).map((x) => `「${x.title}」`);
  const parts = [];
  if (free.length) parts.push(free.length > 1 ? `並列: ${free.join('・')}` : `最初: ${free[0]}`);
  for (const x of items) if (x.after.length) parts.push(`「${x.title}」は ${x.after.map((a) => `「${title.get(a)}」`).join('・')} のあと`);
  return parts.join(' / ');
}

// 進み具合（カードと進捗に出す）
function progressOf(st) {
  const total = st.items.length;
  const merged = st.items.filter((x) => x.state === 'merged').length;
  const skipped = st.items.filter((x) => x.state === 'skipped').length;
  const running = st.items.filter((x) => x.state === 'running').length;
  return { total, merged, skipped, running, pending: total - merged - skipped - running };
}

module.exports = {
  SUBTASK_MARKER,
  SUBTASK_LANG,
  MAX_SUBTASKS,
  cleanMergeMode,
  cleanItems,
  parseItems,
  hasSubtaskMarker,
  extractSubtasks,
  stripSubtasks,
  SUBTASK_PROPOSE_PROMPT,
  withProposeNote,
  buildPlanPrompt,
  withPlanNote,
  buildChildPrompt,
  buildFinishPrompt,
  isUnblocked,
  startable,
  allSettled,
  applyPlan,
  progressOf,
  describeOrder,
};
