// エージェントを起動する直前の状態（チェックポイント）。戻す処理は、この時点へファイル・工程・会話を戻す
// Electron には依存しない
const crypto = require('crypto');
const I18n = require('../renderer/i18n');
const { tr } = I18n;
const IssueRef = require('../renderer/issue-ref');

const MAX_CHECKPOINTS = 100;
const HANDOFF_LIMIT = 8000;
const HANDOFF_HEAD = '## ここまでのやりとり\n';

function create(fields) {
  const f = fields || {};
  return {
    id: f.id || crypto.randomBytes(4).toString('hex'),
    at: typeof f.at === 'number' ? f.at : Date.now(),
    seq: f.seq,
    prompt: f.prompt || '',
    attachments: f.attachments && f.attachments.length ? f.attachments.slice() : null,
    label: f.label || '',
    commit: f.commit || null,
    session: f.session || null,
    forkNext: !!f.forkNext,
    agent: f.agent || 'claude',
    model: f.model || null,
    persona: f.persona ? { ...f.persona } : null,
    specState: f.specState || null,
    relay: f.relay || null,
    stepStart: !!f.stepStart,
    handoff: !!f.handoff,
  };
}

// 古い順のまま、最大 100 件（古いものから捨てる）
function trim(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  if (arr.length <= MAX_CHECKPOINTS) return arr;
  return arr.slice(arr.length - MAX_CHECKPOINTS);
}

// 直前のチェックポイントと工程が違う（または初めて）なら、その工程の最初の実行
function stepStart(card) {
  const list = (card && card.checkpoints) || [];
  const prev = list.length ? list[list.length - 1] : null;
  if (!card || !card.relay) return !prev;
  if (!prev || !prev.relay) return true;
  return prev.relay.index !== card.relay.index;
}

function labelFor(card, prompt) {
  if (card && card.relay && card.relay.steps && card.relay.steps[card.relay.index]) {
    return card.relay.steps[card.relay.index].label || '';
  }
  const line = String(prompt || (card && card.prompt) || '').split('\n').find((l) => l.trim()) || '';
  return line.trim().slice(0, 40);
}

// 戻すときに必要な分だけ。flow や history 本体はカードに残っている
function relaySnapshot(relay) {
  if (!relay) return null;
  return {
    index: relay.index,
    counts: { ...(relay.counts || {}) },
    historyLen: (relay.history || []).length,
    stepCostStart: relay.stepCostStart || 0,
    lastResult: relay.lastResult || null,
  };
}

function applyRelay(relay, snap) {
  if (!relay || !snap) return relay;
  relay.index = snap.index;
  relay.counts = { ...(snap.counts || {}) };
  relay.stepCostStart = snap.stepCostStart || 0;
  relay.history = (relay.history || []).slice(0, snap.historyLen || 0);
  if (snap.lastResult) relay.lastResult = snap.lastResult;
  else delete relay.lastResult;
  delete relay.done;
  delete relay.limitReached;
  delete relay.atJoin;
  delete relay.stepStartedAt;
  return relay;
}

// 起動直前に記録するか。中断の再開・コンフリクト解消・完了後の会話・git なしのフォルダは記録しない
// 読み取り専用はファイルを戻さない（commit は null）が、時点としては記録する
function shouldRecord(card) {
  if (!card || card.afterDone) return false;
  if (card.conflict && card.conflict.resolving) return false;
  if (card.noGit && !card.readOnly) return false;
  return true;
}

// 戻せない理由。画面はこの文字列を出すだけで、ここでは判定しない。戻せるときは null
// ctx: { rewinding, worktreeMissing, parentMerged }
function blockReason(card, ctx) {
  const c = card || {};
  const x = ctx || {};
  if (x.rewinding) return tr('戻しているところです');
  if (c.status !== 'review' && c.status !== 'failed') {
    if (c.status === 'running' || c.status === 'queued') return tr('実行中・待機中は戻せません');
    if (c.status === 'done') return tr('完了したタスクは戻せません');
    if (c.status === 'todo') return tr('開始していないタスクは戻せません');
    return tr('レビュー中か失敗したタスクだけ戻せます');
  }
  if ((c.relay && c.relay.waiting) || c.conflict) {
    if (c.relay && c.relay.waiting) return tr('Pipelineの並列の枝が終わるのを待っています');
    return tr('コンフリクトがあるので戻せません');
  }
  if (c.subtasks && c.subtasks.phase && c.subtasks.phase !== 'plan') return tr('サブタスクを動かしているあいだは戻せません');
  if ((c.mergedInto && c.mergedInto.length) || c.mergedAt) return tr('マージ済みのタスクは戻せません');
  // 読み取り専用は git のリポジトリでも noGit が立つ。worktree が無いので、その理由にする
  if (c.noGit && !c.readOnly) return tr('git で管理していないフォルダは戻せません');
  if (c.kind === 'chat' || !c.worktreePath || x.worktreeMissing) return tr('worktree がありません');
  if (c.prUrl) return I18n.forHost(tr('PR があるので戻せません'), IssueRef.reviewHostOf(c.prUrl));
  if (x.parentMerged) return tr('親のタスクがこの枝をすでにマージしたので戻せません');
  return null;
}

// 画面へ渡す形。prompt や commit は渡さない
function publicView(card, ctx) {
  const points = ((card && card.checkpoints) || []).map((cp) => ({
    id: cp.id,
    at: cp.at,
    seq: cp.seq,
    label: cp.label,
    stepIndex: cp.relay ? cp.relay.index : null,
    stepStart: !!cp.stepStart,
    agent: cp.agent,
  }));
  return { blocked: blockReason(card, ctx), points };
}

// 引き継ぎ文を付けた送信文から、元の指示だけを取り出す。付いていなければそのまま
function visiblePrompt(prompt) {
  const s = String(prompt || '');
  if (!s.startsWith(HANDOFF_HEAD)) return s;
  const cut = s.indexOf('\n\n', HANDOFF_HEAD.length);
  return cut < 0 ? s : s.slice(cut + 2);
}

// 会話を続けられないエージェント向けに、その時点より前の指示と返事を 8,000 字までまとめる
// omitLatestUser: 今から送り直す指示（直前のユーザーログ）は含めない。prompt 側に付く
function handoffText(logs, opts) {
  const o = opts || {};
  const before = o.before;
  const max = o.max > 0 ? o.max : HANDOFF_LIMIT;
  const lines = [];
  let latestUser = -1;
  for (const l of logs || []) {
    if (!l || (before != null && !(typeof l.t === 'number' && l.t < before))) continue;
    if (l.kind !== 'user' && l.kind !== 'text') continue;
    const text = String(l.text || '').trim();
    if (!text) continue;
    if (l.kind === 'user') latestUser = lines.length;
    lines.push(`${l.kind === 'user' ? '【ユーザー】' : '【エージェント】'} ${text}`);
  }
  if (o.omitLatestUser && latestUser >= 0) lines.splice(latestUser, 1);
  if (!lines.length) return '';
  const tail = '\n\n';
  // 末尾の空行も予算に入れる。見出しを切って 8,000 字に収めない
  const room = max - HANDOFF_HEAD.length - tail.length;
  if (room <= 0) return '';
  const picked = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const add = line.length + (picked.length ? 1 : 0);
    if (size + add > room) {
      if (!picked.length) picked.unshift(line.slice(line.length - room));
      break;
    }
    picked.unshift(line);
    size += add;
  }
  if (!picked.length) return '';
  return `${HANDOFF_HEAD}${picked.join('\n')}${tail}`;
}

module.exports = {
  MAX_CHECKPOINTS,
  HANDOFF_LIMIT,
  create,
  trim,
  stepStart,
  labelFor,
  relaySnapshot,
  applyRelay,
  shouldRecord,
  blockReason,
  publicView,
  handoffText,
  visiblePrompt,
};
