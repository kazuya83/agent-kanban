// 「途中の状態に戻す」の説明が、設計と食い違わないこと
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const HEADING = '途中の状態に戻す';

// ## の節だけ。次の ## 以降と、### だけの見出しは節にしない
function h2Section(md, title) {
  const lines = String(md || '').split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${title}`);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

// 「最大100件」「引き継ぎ文（8,000字」の数字。カンマは桁区切りだけを外す
function labeledNumbers(text, re) {
  return [...String(text || '').matchAll(re)].map((m) => Number(m[1].replace(/,/g, '')));
}

function countLimits(text) {
  return labeledNumbers(text, /最大\s*([0-9][0-9,]*)\s*件/g);
}

function handoffLimits(text) {
  return labeledNumbers(text, /引き継ぎ文[（(]\s*([0-9][0-9,]*)\s*字/g);
}

const MUST = [
  ['pipeline', /Pipeline の工程/],
  ['runs', /エージェントが動いた回/],
  ['before', /直前/],
  ['firstRun', /最初の回/],
  ['auto', /すぐに動き始めます/],
  ['files', /ファイル/],
  ['progress', /進み具合/],
  ['talk', /会話/],
  ['discard', /残さず捨てます/],
  ['noUndo', /取り消せません/],
  ['cost', /金額は戻りません/],
  ['logsGone', /その時点以降のログは消え/],
  ['historyGone', /履歴も消えます/],
  ['ignored', /無視しているファイルは残ります/],
  ['dirty', /未コミット/],
  ['recorded', /起動する直前/],
  ['oldest', /古い順/],
  ['skipDone', /完了したあとの会話/],
  ['skipConflict', /コンフリクトを解消するための実行/],
  ['skipResume', /中断したタスクの再開/],
  ['skipNoGit', /git で管理していないフォルダのタスク/],
  ['stepButton', /ここからやり直す/],
  ['history', /「履歴」/],
  ['newest', /新しい順/],
  ['runButton', /ここに戻す/],
  ['confirmDiscard', /あとの変更は捨てられ、元に戻せません/],
  ['confirmStart', /すぐに動き始めます/],
  ['disabled', /ボタンは無効になり、理由が出ます/],
  ['keepCard', /カードは変えずにエラーになります/],
  ['noCommit', /記録したファイルの時点がない/],
  ['status', /レビューと失敗以外/],
  ['statusExamples', /実行中・待機中・完了/],
  ['waiting', /並列の枝の完了を待っている/],
  ['conflict', /コンフリクトがある/],
  ['subtasks', /開始したサブタスク/],
  ['merged', /マージ済み/],
  ['worktree', /worktree がない/],
  ['pr', /PR を作ってある/],
  ['parentMerged', /親のタスクがすでにマージした/],
  ['noGit', /ファイルを戻せないため/],
  ['afterJoin', /合流したあとは親のタスクから戻せません/],
  ['parentOnly', /親の時点だけが表示されます/],
  ['differs', /エージェントで違います/],
  ['noSession', /その時点の会話がないとき/],
  ['newSession', /新しい会話で始めます/],
  ['stepStart', /工程の最初の回は、いつもこれです/],
  ['fork', /引き継いだ元の会話は変えません/],
  ['claude', /Claude Code/],
  ['otherCards', /ほかのカード/],
  ['size', /大きさ以上/],
  ['newline', /行の境目/],
  ['truncate', /切り詰めて/],
  ['resume', /同じ会話の続き/],
  ['fallback', /条件に合わなければ/],
  ['others', /Codex \/ Gemini \/ Cursor/],
];

// 説明が仕様の逆を言うとき。正常な文（「取り消せません」など）には一致しない
const MUST_NOT = [
  ['undo', /取り消せます/],
  ['keepChanges', /あとの変更は残します/],
  ['restoreCost', /金額は戻ります/],
  ['deleteIgnored', /無視しているファイルは消/],
  ['rewindRunning', /実行中でも戻せます/],
  ['rewindWaiting', /完了を待っていても戻せます/],
  ['rewindConflict', /コンフリクトがあっても戻せます/],
  ['rewindSubtasks', /サブタスクがあっても戻せます/],
  ['rewindMerged', /マージ済みでも戻せます/],
  ['rewindPr', /PR があっても戻せます/],
  ['rewindParent', /親がマージしたあとも戻せます/],
  ['rewindNoGit', /管理していないフォルダでも戻せます/],
  ['rewindJoined', /合流したあとも親から戻せます/],
  ['sameForAll', /どのエージェントも同じ会話を切り詰め/],
];

function sectionProblems(section) {
  const text = String(section || '');
  const problems = [];
  for (const [id, re] of MUST) {
    if (!re.test(text)) problems.push(id);
  }
  for (const [id, re] of MUST_NOT) {
    if (re.test(text)) problems.push(id);
  }
  const counts = countLimits(text);
  if (counts.length !== 1 || counts[0] !== 100) problems.push('limit');
  const handoff = handoffLimits(text);
  if (handoff.length !== 1 || handoff[0] !== 8000) problems.push('handoff');
  return problems;
}

// ページ内リンクの # が、## 見出しの文言と一致するか
function missingAnchors(md) {
  const headings = new Set([...String(md || '').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()));
  return [...String(md || '').matchAll(/\]\(#([^)]+)\)/g)]
    .map((m) => decodeURIComponent(m[1]))
    .filter((anchor) => !headings.has(anchor));
}

function agentsProblems(md) {
  const text = String(md || '');
  const problems = [];
  const links = [...text.matchAll(/\]\(usage\.md#([^)]+)\)/g)].map((m) => decodeURIComponent(m[1]));
  if (links.length !== 1 || links[0] !== HEADING) problems.push('link');
  const line = text.split(/\r?\n/).find((row) => /\]\(usage\.md#/.test(row)) || '';
  if (!line.startsWith('- ') || /取り消せます|あとの変更は残します|金額は戻ります/.test(line)) problems.push('bullet');
  if (!/ファイル/.test(line)) problems.push('files');
  if (!/進み具合/.test(line)) problems.push('progress');
  if (!/会話/.test(line)) problems.push('talk');
  if (!/捨て/.test(line)) problems.push('discard');
  if (!/すぐに動き始めます/.test(line)) problems.push('auto');
  return [...new Set(problems)];
}

const MINIMAL = [
  'Pipeline の工程とエージェントが動いた回。直前。最初の回。すぐに動き始めます。',
  'ファイル、Pipeline の進み具合、会話。残さず捨てます。取り消せません。金額は戻りません。',
  'その時点以降のログは消え、履歴も消えます。',
  'git が無視しているファイルは残ります。未コミット。',
  '起動する直前。古い順で最大100件。',
  '完了したあとの会話。コンフリクトを解消するための実行。中断したタスクの再開。git で管理していないフォルダのタスク。',
  '「ここからやり直す」。「履歴」。新しい順。「ここに戻す」。',
  'あとの変更は捨てられ、元に戻せません。すぐに動き始めます。',
  'ボタンは無効になり、理由が出ます。',
  'カードは変えずにエラーになります。記録したファイルの時点がない。',
  'レビューと失敗以外。実行中・待機中・完了。',
  '並列の枝の完了を待っている。コンフリクトがある。',
  '開始したサブタスク。マージ済み。worktree がない。',
  'PR を作ってある。親のタスクがすでにマージした。ファイルを戻せないため。',
  '合流したあとは親のタスクから戻せません。親の時点だけが表示されます。',
  'エージェントで違います。その時点の会話がないとき: 新しい会話で始めます。工程の最初の回は、いつもこれです。',
  '引き継いだ元の会話は変えません。',
  'Claude Code。ほかのカード。大きさ以上。行の境目。切り詰めて。同じ会話の続き。条件に合わなければ。',
  'Codex / Gemini / Cursor。引き継ぎ文（8,000字まで）。',
].join('\n');

test('節は ## の次から次の ## の前までで、空や見出しのゆれは空', () => {
  const md = ['# 題', '## 途中の状態に戻す', '本文', '### 小', '続き', '## 次', '外'].join('\n');
  assert.equal(h2Section(md, HEADING), '本文\n### 小\n続き');
  assert.equal(h2Section(md.replace(/\n/g, '\r\n'), HEADING), '本文\n### 小\n続き');
  assert.equal(h2Section('### 途中の状態に戻す\n本文\n', HEADING), '');
  assert.equal(h2Section('## 途中の状態に戻す \n本文\n', HEADING), '');
  assert.equal(h2Section('## 途中の状態に戻す', HEADING), '');
  assert.equal(h2Section('', HEADING), '');
  assert.equal(h2Section(null, HEADING), '');
  assert.equal(h2Section(undefined, HEADING), '');
});

test('件数と引き継ぎの字数は、桁区切りだけを外して全部拾う', () => {
  assert.deepEqual(countLimits('古い順で最大100件'), [100]);
  assert.deepEqual(countLimits('最大 100 件'), [100]);
  assert.deepEqual(countLimits('最大1,000件'), [1000]);
  assert.deepEqual(countLimits('最大0件と最大100件'), [0, 100]);
  assert.deepEqual(countLimits('最大99件'), [99]);
  assert.deepEqual(countLimits('最大件'), []);
  assert.deepEqual(countLimits('最大100個'), []);
  assert.deepEqual(countLimits(''), []);
  assert.deepEqual(countLimits(null), []);
  assert.deepEqual(handoffLimits('引き継ぎ文（8,000字まで）'), [8000]);
  assert.deepEqual(handoffLimits('引き継ぎ文（8000字）'), [8000]);
  assert.deepEqual(handoffLimits('引き継ぎ文（8,000 字まで）'), [8000]);
  assert.deepEqual(handoffLimits('引き継ぎ文(8,000字)'), [8000]);
  assert.deepEqual(handoffLimits('引き継ぎ文（7,999字）'), [7999]);
  assert.deepEqual(handoffLimits('引き継ぎ文（8,001字）'), [8001]);
  assert.deepEqual(handoffLimits('引き継ぎ文（8、000字）'), []);
  assert.deepEqual(handoffLimits('8,000字'), []);
  assert.deepEqual(handoffLimits(''), []);
  assert.deepEqual(handoffLimits(null), []);
});

test('揃った説明には問題がなく、1つ欠けるとそれだけが残る', () => {
  assert.deepEqual(sectionProblems(MINIMAL), []);
  assert.deepEqual(sectionProblems(''), [...MUST.map(([id]) => id), 'limit', 'handoff']);
  assert.deepEqual(sectionProblems(null), [...MUST.map(([id]) => id), 'limit', 'handoff']);
  const drop = {
    pipeline: 'Pipeline の工程',
    limit: '最大100件',
    handoff: '引き継ぎ文（8,000字まで）',
    noUndo: '取り消せません',
    newline: '行の境目',
    afterJoin: '合流したあとは親のタスクから戻せません',
  };
  for (const [id, phrase] of Object.entries(drop)) {
    assert.deepEqual(sectionProblems(MINIMAL.replace(phrase, '')), [id], id);
  }
  assert.deepEqual(sectionProblems(MINIMAL.replace('最大100件', '最大99件')), ['limit']);
  assert.deepEqual(sectionProblems(MINIMAL.replace('最大100件', '最大101件')), ['limit']);
  assert.deepEqual(sectionProblems(`${MINIMAL}\n最大100件`), ['limit']);
  assert.deepEqual(sectionProblems(MINIMAL.replace('8,000', '7,999')), ['handoff']);
  assert.deepEqual(sectionProblems(MINIMAL.replace('8,000', '8,001')), ['handoff']);
  assert.deepEqual(sectionProblems(`${MINIMAL}\n引き継ぎ文（8,000字）`), ['handoff']);
});

test('仕様と逆の文は、その項目だけを落とす', () => {
  const bad = [
    ['undo', 'この操作は取り消せます。'],
    ['keepChanges', 'あとの変更は残します。'],
    ['restoreCost', '金額は戻ります。'],
    ['deleteIgnored', '無視しているファイルは消えます。'],
    ['rewindRunning', '実行中でも戻せます。'],
    ['rewindWaiting', '枝の完了を待っていても戻せます。'],
    ['rewindConflict', 'コンフリクトがあっても戻せます。'],
    ['rewindSubtasks', 'サブタスクがあっても戻せます。'],
    ['rewindMerged', 'マージ済みでも戻せます。'],
    ['rewindPr', 'PR があっても戻せます。'],
    ['rewindParent', '親がマージしたあとも戻せます。'],
    ['rewindNoGit', '管理していないフォルダでも戻せます。'],
    ['rewindJoined', '合流したあとも親から戻せます。'],
    ['sameForAll', 'どのエージェントも同じ会話を切り詰めます。'],
  ];
  for (const [id, sentence] of bad) {
    assert.deepEqual(sectionProblems(`${MINIMAL}\n${sentence}`), [id], id);
  }
  // 正常な否定は、逆の文として拾わない
  assert.deepEqual(sectionProblems(`${MINIMAL}\n実行中は戻せません。金額は戻りません。`), []);
});

test('ページ内リンクは ## の見出しと一致するときだけ通る', () => {
  const ok = `## ${HEADING}\n\n本文\n\n[戻す](#${HEADING})\n`;
  assert.deepEqual(missingAnchors(ok), []);
  assert.deepEqual(missingAnchors(`[戻す](#ない)\n`), ['ない']);
  assert.deepEqual(missingAnchors(`[戻す](#${encodeURIComponent(HEADING)})\n## ${HEADING}\n`), []);
  assert.deepEqual(missingAnchors(''), []);
  assert.deepEqual(missingAnchors(null), []);
  assert.deepEqual(missingAnchors(`[x](#途中の状態に戻す )\n## 途中の状態に戻す\n`), ['途中の状態に戻す ']);
});

test('Pipeline の1行は、usage の節へ1つだけつながる', () => {
  const line = `- レビューや失敗で止まっているときは、工程や各回の直前の時点へ戻せます。ファイル・進み具合・会話をその時点に戻し、あとの変更は捨てて、すぐに動き始めます。くわしくは [途中の状態に戻す](usage.md#${HEADING})`;
  assert.deepEqual(agentsProblems(`${line}\n`), []);
  assert.deepEqual(agentsProblems(''), ['link', 'bullet', 'files', 'progress', 'talk', 'discard', 'auto']);
  assert.deepEqual(agentsProblems(null), ['link', 'bullet', 'files', 'progress', 'talk', 'discard', 'auto']);
  assert.deepEqual(agentsProblems(`${line}\n${line}\n`), ['link']);
  assert.deepEqual(agentsProblems(line.replace(`#${HEADING}`, '#別の節')), ['link']);
  assert.deepEqual(agentsProblems(line.replace('- ', '  ')), ['bullet']);
  assert.deepEqual(agentsProblems(line.replace('ファイル・', '')), ['files']);
  assert.deepEqual(agentsProblems(line.replace('進み具合・', '')), ['progress']);
  assert.deepEqual(agentsProblems(line.replace('会話を', 'ログを')), ['talk']);
  assert.deepEqual(agentsProblems(line.replace('捨てて', '残して')), ['discard']);
  assert.deepEqual(agentsProblems(line.replace('すぐに動き始めます', '止まったままです')), ['auto']);
  assert.deepEqual(agentsProblems(`${line}取り消せます`), ['bullet']);
});

test('usage と agents の説明は、戻せないときと会話の違いを仕様どおり書く', () => {
  const usage = read('docs/usage.md');
  const section = h2Section(usage, HEADING);
  assert.deepEqual(sectionProblems(section), []);
  assert.equal(section.includes('反映済み'), false);
  assert.deepEqual(missingAnchors(usage), []);
  assert.deepEqual(agentsProblems(read('docs/agents.md')), []);
});
