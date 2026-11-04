/* global api, icon, agentIcon, NOTIF_ICON */
const COLUMNS = [
  { key: 'todo', label: 'Todo', statuses: ['todo'], hint: 'ここから「実行中」へドラッグしても開始できます' },
  { key: 'running', label: '実行中', statuses: ['queued', 'running'] },
  { key: 'review', label: 'レビュー', statuses: ['review', 'failed'] },
  { key: 'done', label: '完了', statuses: ['done'] },
];
// タスクに紐づかない会話（worktree を作らず、リポジトリのフォルダでそのまま話す）はボードのレーンには出さず、
// 「会話」ボタンから一覧を開き、選んだ会話はモーダルで表示する
const STATUS_LABEL = { todo: '未着手', queued: '待機中', running: '実行中', review: 'レビュー待ち', failed: 'エラー', done: 'マージ済み' };
const CHAT_STATUS_LABEL = { todo: '未開始', queued: '待機中', running: '返答中', review: '返事済み', failed: 'エラー', done: '終了' };
const isChat = (c) => !!c && c.kind === 'chat';
const LOG_LABEL = { question: '質問', user: 'あなた', text: 'Claude', tool: 'ツール', tool_result: '結果', tool_error: '結果(エラー)', system: 'システム', result: '完了', error: 'エラー', stderr: 'stderr', permission: '承認' };
const PERMISSION_MODES = [
  ['default', '毎回確認する（すべての操作をカードで承認）'],
  ['acceptEdits', 'ファイル編集は自動で許可、コマンドなどは確認する（おすすめ）'],
  ['plan', '計画だけ立てる（ファイルは変更しない）'],
  ['bypassPermissions', 'すべて自動で許可する（注意）'],
];

// エージェント（Claude Code / Codex CLI / Gemini CLI / Cursor CLI）と、オーケストレーション（Pipeline・競争）
const AGENTS = [
  ['claude', 'Claude Code', 'Claude'],
  ['codex', 'Codex CLI', 'Codex'],
  ['gemini', 'Gemini CLI', 'Gemini'],
  ['cursor', 'Cursor CLI', 'Cursor'],
];
// 設定で「使う」にチェックを付けたエージェント（1つもなければ Claude Code）
function enabledAgents(s = state.board.settings || {}) {
  const on = Array.isArray(s.enabledAgents) ? s.enabledAgents : ['claude'];
  const list = AGENTS.map((x) => x[0]).filter((a) => on.includes(a));
  return list.length ? list : ['claude'];
}
// 新しいタスク・会話で最初から選んでおくエージェント
function defaultAgent(s = state.board.settings || {}) {
  const list = enabledAgents(s);
  return list.includes(s.defaultAgent) ? s.defaultAgent : list[0];
}
const agentLabel = (a) => (AGENTS.find((x) => x[0] === a) || AGENTS[0])[1];
const agentShort = (a) => (AGENTS.find((x) => x[0] === a) || AGENTS[0])[2];
const agentOf = (c) => (c && AGENTS.some((x) => x[0] === c.agent) ? c.agent : 'claude');

const state = { board: { settings: {}, cards: [] }, repoOpenMode: 'replace', selected: null, tab: 'log', logs: new Map(), headSig: '', relayOpen: new Set() };
const $ = (id) => document.getElementById(id);
// index.html の data-icon="名前" の場所に、モノクロの SVG アイコンを入れる（icons.js）
for (const el of document.querySelectorAll('[data-icon]')) el.outerHTML = icon(el.dataset.icon, el.className);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// カードや通知の短い文章では、Markdown の記号（見出し・太字・コード・表・リスト）を外して、ふつうの文章にする
function plainText(md) {
  return String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\|?\s*:?-{3,}/.test(l)) // 表の区切り行
    .map((l) =>
      l
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*+]\s+/, '・')
        .replace(/^\d+\.\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^\||\|$/g, '')
        .replace(/\s*\|\s*/g, ' / '),
    )
    .join(' ')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
function card(id) {
  return state.board.cards.find((c) => c.id === id);
}
function elapsed(since) {
  if (!since) return '';
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  if (s < 60) return `${s}秒`;
  if (s < 3600) return `${Math.floor(s / 60)}分${s % 60}秒`;
  return `${Math.floor(s / 3600)}時間${Math.floor((s % 3600) / 60)}分`;
}
function toast(msg, kind = 'error') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), kind === 'error' ? 8000 : 3000);
}
async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'ok');
    return r;
  } catch (err) {
    toast(err.message);
    return undefined;
  }
}

// マージや push など時間のかかる操作のあいだ、画面全体にローディングを出す。
// 終わるまでほかの操作（二重クリック・ダイアログを閉じるなど）を受け付けない。
const busyState = { count: 0, msgs: [] };
function isBusy() {
  return busyState.count > 0;
}
async function withBusy(msg, fn) {
  busyState.count++;
  busyState.msgs.push(msg);
  $('busyMsg').textContent = msg;
  $('busy').classList.remove('hidden');
  document.activeElement?.blur?.();
  try {
    return await fn();
  } finally {
    busyState.count--;
    busyState.msgs.splice(busyState.msgs.lastIndexOf(msg), 1);
    if (busyState.count) $('busyMsg').textContent = busyState.msgs[busyState.msgs.length - 1];
    else $('busy').classList.add('hidden');
  }
}
// 処理中はキー入力も止める（Enter での二重送信などを防ぐ）
document.addEventListener(
  'keydown',
  (e) => {
    if (!isBusy()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  true,
);
// run() にローディング表示を付けたもの
function runBusy(msg, fn, okMsg) {
  return withBusy(msg, () => run(fn, okMsg));
}

// ---------------- ボード ----------------

function permissionBlock(c, compact) {
  const reqs = c.permissions || [];
  if (!reqs.length) return '';
  const list = compact ? reqs.slice(0, 1) : reqs;
  return list
    .map(
      (r) => `
      <div class="perm" data-card="${c.id}" data-req="${r.id}">
        <div class="perm-title">${icon('alert')}承認待ち: <b>${esc(r.toolName)}</b></div>
        ${r.summary ? `<code class="perm-summary">${esc(r.summary)}</code>` : ''}
        ${compact ? '' : `<details><summary>入力の全文</summary><pre>${esc(r.detail)}</pre></details>
          <input class="deny-reason" placeholder="拒否する理由（任意・${esc(agentShort(agentOf(c)))} に伝わります）" />`}
        <div class="perm-actions">
          <button class="btn small allow" data-decision="allow">許可</button>
          <button class="btn small deny" data-decision="deny">拒否</button>
          <button class="btn small ghost" data-decision="always" title="このタスクでは ${esc(r.toolName)} を今後も自動で許可">常に許可</button>
        </div>
      </div>`,
    )
    .join('') + (compact && reqs.length > 1 ? `<div class="perm-more">ほか ${reqs.length - 1} 件の承認待ち</div>` : '');
}

// ---- エージェントからの質問 ----

// カードの状態を表すバッジ（質問・承認待ち・回答待ちを優先して出す）
function isInterrupted(c) {
  return !!c.interrupted && c.status !== 'running' && c.status !== 'queued';
}
// 内容が詰まっていないので、開発を始める前に仕様を詰めているところか
function isSpecPending(c) {
  return c.specState === 'pending' && (c.status === 'review' || c.status === 'failed');
}
function badgeFor(c) {
  if (isInterrupted(c)) return ['interrupted', '中断'];
  if ((c.questions || []).length) return ['question', '質問'];
  if ((c.permissions || []).length) return ['waiting', '承認待ち'];
  if (c.conflict && !c.conflict.resolving && c.status !== 'running' && c.status !== 'queued') return ['conflict', 'コンフリクト'];
  if (isSpecPending(c)) return ['spec', '仕様の確認'];
  if (c.awaitingReply && (c.status === 'review' || c.status === 'failed')) return ['awaiting', '回答待ち'];
  return [c.status, (isChat(c) ? CHAT_STATUS_LABEL : STATUS_LABEL)[c.status]];
}
function needsYou(c) {
  return isInterrupted(c) || (c.questions || []).length || (c.permissions || []).length || (c.awaitingReply && c.status === 'review') || (c.conflict && !c.conflict.resolving && c.status === 'review');
}

// ボードのカード用（短く）。1問だけの単一選択なら、その場で答えられる
function questionCompactHtml(c) {
  const req = (c.questions || [])[0];
  if (!req) return '';
  const q = req.questions[0];
  const quick = req.questions.length === 1 && !q.multiSelect && q.options.length && q.options.length <= 4;
  return `<div class="qbox" data-card="${c.id}" data-req="${req.id}">
    <div class="q-title">${icon('question')}${esc(q.header ? q.header + ': ' : '')}${esc(q.question)}</div>
    ${quick
      ? `<div class="q-quick">${q.options.map((o) => `<button class="btn small" data-qpick="${esc(o.label)}" title="${esc(o.description)}">${esc(o.label)}</button>`).join('')}<button class="btn small ghost" data-qopen="1">その他…</button></div>`
      : `<div class="q-quick"><button class="btn small primary" data-qopen="1">回答する（${req.questions.length}問）</button></div>`}
  </div>`;
}

// 質問ひとつずつの選択肢と自由入力（AskUserQuestion の回答フォームと、仕様の確認の回答フォームで使う）
function questionItemsHtml(name, questions) {
  return questions
    .map(
      (q, i) => `<div class="q-item" data-qi="${i}">
      <div class="q-head">${q.header ? `<span class="q-chip">${esc(q.header)}</span>` : ''}${esc(q.question)}${q.multiSelect && q.options.length ? '<span class="muted small">（複数選べます）</span>' : ''}</div>
      <div class="q-opts">
        ${q.options.length
          ? q.options
              .map(
                (o) => `<label class="q-opt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q-${name}-${i}" value="${esc(o.label)}" />
            <span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></label>`,
              )
              .join('') +
            `<label class="q-opt other"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q-${name}-${i}" value="__other__" />
          <span><b>その他</b><input class="q-other" placeholder="自由に入力" /></span></label>`
          : '<textarea class="q-other q-free" rows="2" placeholder="自由に入力"></textarea>'}
      </div>
    </div>`,
    )
    .join('');
}

// 詳細パネル用の回答フォーム
function questionFormHtml(c) {
  return (c.questions || [])
    .map(
      (req) => `<div class="qform" data-card="${c.id}" data-req="${req.id}">
      <div class="q-title">${icon('question')}${esc(agentShort(agentOf(c)))} からの質問</div>
      ${questionItemsHtml(req.id, req.questions)}
      <div class="q-actions"><button class="btn primary" data-qact="submit">回答する</button><button class="btn ghost" data-qact="skip" title="${esc(agentShort(agentOf(c)))} に、妥当だと思う方法で進めてもらいます">答えずに続ける</button></div>
    </div>`,
    )
    .join('');
}

// 仕様の確認の回答フォーム（エージェントが付けた質問の JSON から作る。答えは追加指示として送る）
function specQuestions(c) {
  return isSpecPending(c) && Array.isArray(c.specQuestions) && c.specQuestions.length ? c.specQuestions : null;
}
function specFormHtml(c) {
  const qs = specQuestions(c);
  if (!qs) return '';
  const can = canSendFollow(c);
  return `<div class="qform spec-qform" data-card="${c.id}" data-spec="1">
    <div class="q-title">${icon('question')}仕様の質問に答える</div>
    ${questionItemsHtml(`spec-${c.id}`, qs)}
    <div class="q-item"><div class="q-head">補足（任意）</div><textarea class="q-note" rows="2" placeholder="ほかに伝えたいことがあれば"></textarea></div>
    <div class="q-actions"><button class="btn primary" data-sqact="submit"${can ? '' : ' disabled'}>回答して送る</button><button class="btn ghost" data-sqact="auto"${can ? '' : ' disabled'} title="答えていない質問は、${esc(agentShort(agentOf(c)))} に妥当な案で決めてもらいます">おまかせで進める</button></div>
    <small class="muted">答えていない質問は「おまかせ」として送ります。下の欄に文章で書いて送ってもかまいません。</small>
  </div>`;
}
const SPEC_AUTO = 'おまかせ（妥当な案で決めてください）';
// 仕様の確認フォームの答えを、エージェントに送る文章にする
function specAnswerMessage(questions, answers, note, auto) {
  const lines = ['仕様の質問への答えです。', ''];
  questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.question}`, `   → ${(!auto && answers[q.question]) || SPEC_AUTO}`);
  });
  if (note) lines.push('', `補足: ${note}`);
  return lines.join('\n');
}
async function sendSpecAnswer(form, c, auto) {
  const qs = specQuestions(c);
  if (!qs) return;
  const answers = auto ? {} : collectAnswers(form, qs);
  const note = form.querySelector('.q-note').value.trim();
  if (!auto && !note && !Object.values(answers).some(Boolean)) return toast('どれかの質問に答えてください（すべて任せるときは「おまかせで進める」）');
  const msg = specAnswerMessage(qs, answers, note, auto);
  return run(() => api.send(c.id, msg, null).then(() => true), auto ? 'おまかせで進めてもらいます' : '回答を送りました');
}

// ---- コンフリクト ----
function conflictBoxHtml(c) {
  const busy = c.status === 'running' || c.status === 'queued';
  const who = esc(agentShort(agentOf(c)));
  if (c.conflict) {
    const k = c.conflict;
    const files = (k.unresolved && k.unresolved.length ? k.unresolved : k.files) || [];
    let actions;
    if (k.resolving && busy) actions = `<p class="muted small">${who} がコンフリクトを解消しています…（ログで進み具合を見られます）</p>`;
    else if (k.manual)
      actions = `<p class="small">タスクの worktree で、上のファイルの <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> 〜 <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> を直してください。</p>
        <div class="cf-actions"><button class="btn" data-cact="open">フォルダを開く</button><button class="btn primary" data-cact="complete">解消した（取り込みを完了）</button><button class="btn" data-cact="agent">${who} に任せる</button><button class="btn ghost" data-cact="abort">取り込みを中止</button></div>`;
    else if (k.pr)
      actions = `<div class="cf-actions"><button class="btn primary" data-cact="agent">${who} に解消してもらう</button><button class="btn" data-cact="manual">自分で解消する</button>${c.prUrl ? '<button class="btn ghost" data-cact="openPr">GitHub で見る</button>' : ''}<button class="btn ghost" data-cact="dismiss">閉じる</button></div>
        <p class="muted small">どちらも、origin/${esc(k.target)} をこのタスクのブランチに取り込んで解消します。解消できたら「PR を更新」で push すると、PR のコンフリクトがなくなります。</p>`;
    else
      actions = `<div class="cf-actions"><button class="btn primary" data-cact="agent">${who} に解消してもらう</button><button class="btn" data-cact="manual">自分で解消する</button><button class="btn ghost" data-cact="dismiss">閉じる</button></div>
        <p class="muted small">どちらも、${esc(k.target)} をこのタスクのブランチに取り込んで解消します。${esc(k.target)} 自体は解消が終わってマージするまで変わりません。</p>`;
    return `<div class="cf-box">
      <b>${icon('alert')}${k.pr ? `PR が ${esc(k.target)} とコンフリクトしています` : `${esc(k.target)} とコンフリクトしています`}${k.unresolved && k.unresolved.length ? '（まだ残っています）' : ''}</b>
      ${files.length ? `<ul class="cf-files">${files.map((f) => `<li class="mono">${esc(f)}</li>`).join('')}</ul>` : '<p class="muted small">コンフリクトしているファイルは、解消を始めると表示されます。</p>'}
      ${actions}
    </div>`;
  }
  if (c.conflictResolved && !busy && (c.status === 'review' || c.status === 'failed')) {
    const r = c.conflictResolved;
    if (r.pr)
      return `<div class="cf-box ok"><b>${icon('check')}origin/${esc(r.target)} を取り込んで、コンフリクトを解消しました</b>
      <p class="small">差分タブで解消の内容を確かめてから、PR を更新（push）してください。</p>
      <div class="cf-actions"><button class="btn primary" data-cact="pushPr">PR を更新（push）</button><button class="btn ghost" data-cact="dismiss">閉じる</button></div></div>`;
    return `<div class="cf-box ok"><b>${icon('check')}${esc(r.target)} を取り込んで、コンフリクトを解消しました</b>
      <p class="small">差分タブで解消の内容を確かめてから、マージしてください。</p>
      <div class="cf-actions"><button class="btn primary" data-cact="remerge">${esc(r.target)} にマージ${r.push ? 'して push' : ''}</button><button class="btn ghost" data-cact="dismiss">閉じる</button></div></div>`;
  }
  return '';
}

async function conflictAction(c, act) {
  if (act === 'agent') {
    const who = agentShort(agentOf(c));
    return runBusy(`${who} に解消を頼んでいます…`, () => api.resolveConflict(c.id, 'agent'), `${who} に解消を頼みました`);
  }
  if (act === 'manual') {
    const r = await runBusy('コンフリクトした状態を作っています…', () => api.resolveConflict(c.id, 'manual'));
    if (r && r.manual) {
      toast('worktree にコンフリクトした状態を作りました。エディタで直してください', 'ok');
      run(() => api.open(c.id));
    } else if (r && r.resolved) toast('コンフリクトなしで取り込めました', 'ok');
    return;
  }
  if (act === 'open') return run(() => api.open(c.id));
  if (act === 'complete') return runBusy('取り込みを完了しています…', () => api.completeConflict(c.id), '取り込みを完了しました');
  if (act === 'abort') return runBusy('取り込みを中止しています…', () => api.abortConflict(c.id), '取り込みを中止しました');
  if (act === 'dismiss') return run(() => api.dismissConflict(c.id));
  if (act === 'openPr') return c.prUrl && api.openExternal(c.prUrl);
  if (act === 'pushPr') {
    const res = await runBusy('PR を更新しています…', () => api.createPr(c.id, { base: c.conflictResolved.target, keep: true }));
    if (res && res.url) toast('PR を更新しました。GitHub でコンフリクトがなくなったか確かめます', 'ok');
    return;
  }
  if (act === 'remerge') {
    const r = c.conflictResolved;
    const res = await runBusy(r.push ? `${r.target} にマージして push しています…` : `${r.target} にマージしています…`, () => api.merge(c.id, { target: r.target, push: r.push, keep: r.keep }));
    if (res && res.merged) toast(`${r.target} にマージしました${r.push ? '（origin にも push しました）' : ''}`, 'ok');
    else if (res && res.conflict) toast('まだコンフリクトしています。もう一度解消してください');
  }
}

// フォームから回答を集める（複数選択は「, 」でつなぐ）
function collectAnswers(form, questions) {
  if (!questions) return null;
  const answers = {};
  questions.forEach((q, i) => {
    const item = form.querySelector(`.q-item[data-qi="${i}"]`);
    const other = item.querySelector('.q-other').value.trim();
    const picked = [...item.querySelectorAll('input[type=radio]:checked, input[type=checkbox]:checked')].map((x) => x.value);
    const vals = picked.filter((v) => v !== '__other__');
    if (other && (picked.includes('__other__') || !vals.length || q.multiSelect)) vals.push(other);
    answers[q.question] = vals.join(', ');
  });
  return answers;
}

async function sendAnswer(cardId, reqId, answers) {
  return run(() => api.answerQuestion(cardId, reqId, answers).then(() => true), answers ? '回答しました' : 'そのまま続けてもらいます');
}

function cardHtml(c) {
  const waiting = needsYou(c);
  const [bcls, blabel] = badgeFor(c);
  const since = c.status === 'running' ? c.startedAt : null;
  return `
    <div class="card s-${c.status} ${isChat(c) ? 'chat' : ''} ${waiting ? (bcls === 'waiting' ? 'waiting' : bcls === 'conflict' ? 'conflicting' : 'asking') : ''} ${state.selected === c.id ? 'selected' : ''}" draggable="${c.status === 'todo' && !isChat(c)}" data-id="${c.id}">
      <div class="card-top">
        <span class="badge b-${bcls}">${blabel}</span>
        ${since ? `<span class="elapsed" data-since="${since}">${elapsed(since)}</span>` : ''}
      </div>
      <div class="card-title">${c.issue ? `<a class="issue-chip" data-url="${esc(c.issue.url)}" title="Issue を開く">#${c.issue.number}</a> ${esc(c.title.replace(/^#\d+\s*/, ''))}` : esc(c.title)}</div>
      ${orchChipsHtml(c)}
      ${c.skill ? `<div class="card-skill-row"><span class="skill-chip small" title="最初の指示で使うスキル">${icon('zap')}/${esc(c.skill)}</span></div>` : ''}
      ${c.error && c.status === 'failed' ? `<div class="card-err">${esc(c.error)}</div>` : ''}
      ${c.lastMessage && !waiting ? `<div class="card-msg">${esc(plainText(c.lastMessage))}</div>` : ''}
      ${isSpecPending(c) ? `<div class="card-msg card-spec">${icon('note')}内容が詰まっていないので、開発を開始できません。開いて質問に答えてください</div>` : ''}
      ${isInterrupted(c) ? `<div class="int-quick"><button class="btn small primary" data-resume="${c.id}" title="中断したところから続けます">${icon('play')}再開</button></div>` : ''}
      ${questionCompactHtml(c)}
      ${permissionBlock(c, true)}
      <div class="card-meta">
        ${c.branch ? `<span title="${esc(c.branch)}">${icon('branch')}${esc(c.branch.replace(/^agent\//, ''))}</span>` : ''}
        ${c.costUsd ? `<span class="card-cost">$${c.costUsd.toFixed(2)}</span>` : ''}
      </div>
    </div>`;
}

// カードに出すエージェント・Pipeline・競争の印
function orchChipsHtml(c) {
  const chips = [];
  if (c.relay) chips.push(`<span class="orch-chip relay" title="Pipeline: 工程ごとに別のエージェントへ順番に引き継ぎます">${icon('pipeline')}${c.relay.index + 1}/${c.relay.steps.length} ${esc(c.relay.steps[c.relay.index].label)} · ${agentIcon(agentOf(c))} ${esc(agentShort(agentOf(c)))}</span>`);
  else chips.push(`<span class="orch-chip agent">${agentIcon(agentOf(c))}${esc(agentLabel(agentOf(c)))}</span>`);
  if (c.compete) {
    const n = competitors(c).length;
    chips.push(c.compete.adopted ? `<span class="orch-chip compete">${icon('flag')}採用した案</span>` : `<span class="orch-chip compete" title="同じタスクを複数のエージェントで解いています">${icon('flag')}競争 ${n}案</span>`);
  }
  return (chips.length ? `<div class="card-skill-row">${chips.join('')}</div>` : '') + (c.relay && !isChat(c) ? relayBarHtml(c) : '');
}
function competitors(c) {
  if (!c || !c.compete) return c ? [c] : [];
  return state.board.cards.filter((x) => x.compete && x.compete.group === c.compete.group).sort((a, b) => a.compete.index - b.compete.index);
}

// 週間上限のリセットからリセットまでの合計金額を、期間（何月何日〜何日）と一緒に出す
let weekRollTimer = null;
function renderCostInfo(settings) {
  const el = $('costInfo');
  el.classList.toggle('hidden', !settings.repoPath);
  const total = Number(state.board.totalCostUsd) || 0;
  const w = state.board.weeklyCost;
  if (!w) {
    el.textContent = `合計 $${total.toFixed(2)}`;
    return;
  }
  const start = new Date(w.start);
  const end = new Date(w.end);
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const full = (d) => `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）${hm(d)}`;
  // 0:00 にリセットされるなら、終わりの日は前の日（例: 月曜 0:00 リセット → 月〜日）
  const midnight = start.getHours() === 0 && start.getMinutes() === 0;
  const last = midnight ? new Date(w.end - 1) : end;
  el.innerHTML = `今週 $${(Number(w.usd) || 0).toFixed(2)}<span class="pill-sub"> ・ ${md(start)}〜${md(last)}</span>`;
  const src = { claude: 'Claude から届いた週間上限のリセット日時', settings: '設定で決めたリセットの曜日・時刻', default: 'リセット日時がまだ分からないので月曜 0:00（設定で変えられます）' }[w.source] || '';
  el.title = `Claude の週間上限のリセットに合わせた、今週このリポジトリのタスクで使った金額です\n期間: ${full(start)} 〜 ${full(end)}\n区切り: ${src}\nこれまでの合計: $${total.toFixed(2)}（削除したタスクの分も含みます）`;
  // 週が変わったら表示を新しい週に切り替える
  clearTimeout(weekRollTimer);
  const wait = w.end - Date.now();
  if (wait > 0 && wait < 2 ** 31 - 1) weekRollTimer = setTimeout(async () => ((state.board = await api.getBoard()), renderBoard()), wait + 1000);
}

// 遠隔操作（クライアント）で接続中なら、その接続の情報。ボード・リポジトリ・作業ディレクトリはホストのもの
function remoteClient() {
  const rs = state.board.remoteSession;
  return rs && rs.role === 'client' ? rs.client || {} : null;
}
// 接続先のホストの呼び名（SSH なら user@host、直接なら host:port）
function remoteHostLabel(c = remoteClient()) {
  if (!c) return '';
  if (c.mode === 'direct') return `${c.host}:${c.port}`;
  return c.sshHost ? (c.sshUser ? `${c.sshUser}@${c.sshHost}` : c.sshHost) : 'ホスト';
}

// 左上のリポジトリのタブ（MAX_REPO_TABS まで）。遠隔操作中は、ホストのタブだと分かるように接続先の名前を付ける
const MAX_REPO_TABS = 3;
function repoTabsList() {
  const repo = state.board.settings.repoPath || '';
  const list = (state.board.repoTabs || []).filter((t) => t && t.path);
  if (repo && !list.some((t) => t.path === repo)) list.push({ path: repo, running: 0, attention: 0 });
  return list;
}
function renderRepoTabs() {
  const repo = state.board.settings.repoPath || '';
  const rc = remoteClient();
  const el = $('repoTabs');
  el.classList.toggle('remote', !!rc);
  const host = rc ? remoteHostLabel(rc) : '';
  const hostHtml = rc ? `<span class="repo-host" title="接続先（${esc(host)}）のリポジトリです。エージェントはホストのフォルダで動きます">${icon('monitor')}${esc(host)}</span>` : '';
  if (!repo) {
    el.innerHTML = `${hostHtml}<button class="repo" id="repoPick" title="${rc ? `接続先（${esc(host)}）のリポジトリを選びます` : 'リポジトリを選ぶ'}">${icon('folder')}${rc ? 'ホストのリポジトリを選ぶ' : 'リポジトリを選ぶ'}</button>`;
    $('repoPick').onclick = () => chooseRepo({ tab: 'replace' });
    return;
  }
  const tabs = repoTabsList();
  const full = tabs.length >= MAX_REPO_TABS;
  el.innerHTML =
    hostHtml +
    tabs
      .map((t) => {
        const on = t.path === repo;
        const badges = on
          ? ''
          : `${t.attention ? `<span class="repo-tab-badge warn" title="あなたの対応を待っているタスクが ${t.attention} 件あります">${t.attention}</span>` : ''}${t.running ? `<span class="repo-tab-badge run" title="動いているタスクが ${t.running} 件あります">${t.running}</span>` : ''}`;
        const tip = on ? `${t.path}\nクリックで、このタブのリポジトリを切り替えます` : `${t.path}\nクリックでこのリポジトリに切り替えます`;
        return `<div class="repo-tab${on ? ' active' : ''}" data-path="${esc(t.path)}" role="tab" aria-selected="${on}">
          <button class="repo-tab-main" title="${esc(tip)}">${icon('folder')}<span class="repo-tab-name">${esc(repoFolderName(t.path))}</span>${badges}</button>
          ${tabs.length > 1 ? `<button class="repo-tab-close" title="タブを閉じる（動いているタスクは止まりません）" aria-label="タブを閉じる">${icon('x')}</button>` : ''}
        </div>`;
      })
      .join('') +
    `<button class="repo-tab-add" id="repoTabAdd" ${full ? 'disabled' : ''} title="${full ? `タブは ${MAX_REPO_TABS} つまでです。タブを閉じてから開いてください` : '新しいタブでリポジトリを開く'}" aria-label="新しいタブでリポジトリを開く">${icon('plus')}</button>`;
  el.querySelectorAll('.repo-tab').forEach((tab) => {
    const p = tab.dataset.path;
    tab.querySelector('.repo-tab-main').onclick = () => (p === state.board.settings.repoPath ? chooseRepo({ tab: 'replace' }) : switchRepoTab(p));
    const x = tab.querySelector('.repo-tab-close');
    if (x) x.onclick = (e) => (e.stopPropagation(), closeRepoTab(p));
  });
  $('repoTabAdd').onclick = () => !full && chooseRepo({ tab: 'new' });
}

// リポジトリを開いた・切り替えたあとに、ボードを読み直す
async function afterRepoChanged() {
  closeModal();
  closeDetail();
  state.board = await api.getBoard();
  renderBoard();
  checkEnv();
}
async function switchRepoTab(dir) {
  if (await run(() => api.switchRepoTab(dir))) await afterRepoChanged();
}
async function closeRepoTab(dir) {
  const wasCurrent = dir === state.board.settings.repoPath;
  const r = await run(() => api.closeRepoTab(dir));
  if (!r) return;
  if (wasCurrent) return afterRepoChanged();
  state.board = await api.getBoard();
  renderBoard();
}

function renderRemoteInfo() {
  renderRepoTabs();
  const el = $('remoteInfo');
  const rs = state.board.remoteSession;
  el.classList.remove('resume', 'error');
  const target = (c) => (c.mode === 'direct' ? `${c.host}:${c.port}` : `SSH ${c.sshHost}`);
  if (rs?.role === 'local' && rs.client?.reconnecting) {
    // 前回の接続を裏で再開している
    const r = rs.client.reconnecting;
    el.classList.remove('hidden', 'host');
    el.textContent = `前回の接続を再開中… → ${target(rs.client)}（${r.attempt}/${r.max}）`;
    el.title = `${r.lastError ? `前回の失敗: ${r.lastError}\n` : ''}クリックで RC設定を開きます（やめることもできます）`;
    el.onclick = () => openRemoteSettings();
    return;
  }
  if (rs?.role === 'local' && rs.client?.canResume) {
    // ワンクリックで前回の接続を再開する
    el.classList.remove('hidden', 'host');
    el.classList.add('resume');
    el.classList.toggle('error', !!rs.client.resumeError);
    el.textContent = `↻ 前回の接続を再開 → ${target(rs.client)}`;
    el.title = `${rs.client.resumeError ? `つながりませんでした: ${rs.client.resumeError}\n` : ''}保存したトークンで、前回と同じホストにつなぎます`;
    el.onclick = () => runBusy(rs.client.mode === 'direct' ? '前回の接続を再開しています…' : 'SSH トンネルを張って、前回の接続を再開しています…', () => api.remoteResume());
    return;
  }
  if (!rs || rs.role === 'local') {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.classList.toggle('host', rs.role === 'host');
  if (rs.role === 'client') {
    const c = rs.client;
    el.textContent = c.mode === 'direct' ? `遠隔操作中 → ${c.host}:${c.port}` : `遠隔操作中 → SSH ${c.sshHost}`;
    el.title = 'ホストのボードを表示・操作しています。クリックで RC設定を開きます';
  } else {
    const code = rs.host.pairCode ? ` ・ コード ${rs.host.pairCode}` : '';
    el.textContent = `ホスト待ち受け :${rs.host.port}${code}`;
    el.title = 'このマシンで遠隔ホストとして待ち受けています。クリックで RC設定を開きます';
  }
  el.onclick = () => openRemoteSettings();
}

function renderBoard() {
  const { settings, cards } = state.board;
  renderInterruptBanner();
  renderRemoteInfo();
  // 会話は同時実行数に数えない
  const running = cards.filter((c) => c.status === 'running' && !isChat(c)).length;
  renderCostInfo(settings);
  renderNotifications();
  renderChatBtn();
  $('runInfo').textContent = `実行中 ${running}/${settings.maxParallel || 1}`;

  if (!settings.repoPath) {
    $('board').innerHTML = remoteClient()
      ? `<div class="empty-state"><h2>接続先（${esc(remoteHostLabel())}）でリポジトリを選んでください</h2><p>遠隔操作中は、ホストのリポジトリでエージェントが動きます。ホストの最近開いたリポジトリや、ホストのフォルダから選べます。</p><button class="btn primary" id="emptyRepo">ホストのリポジトリを選ぶ</button></div>`
      : `<div class="empty-state"><h2>まずリポジトリを選んでください</h2><p>タスクごとにこのリポジトリの git worktree を作って、エージェント（Claude Code / Codex CLI / Gemini CLI / Cursor CLI）を並列に動かします。</p><button class="btn primary" id="emptyRepo">リポジトリを選ぶ・クローン・新規作成</button></div>`;
    $('emptyRepo').onclick = chooseRepo;
    return;
  }
  // 作り直すとスクロールが先頭に戻るので、ボードと各列の位置を覚えておいて戻す
  const boardEl = $('board');
  const boardScroll = [boardEl.scrollLeft, boardEl.scrollTop];
  const colScroll = {};
  boardEl.querySelectorAll('.column[data-col]').forEach((sec) => {
    const list = sec.querySelector('.cards');
    if (list) colScroll[sec.dataset.col] = list.scrollTop;
  });
  boardEl.innerHTML = COLUMNS.map((col) => {
    const list = cards
      .filter((c) => !isChat(c) && col.statuses.includes(c.status))
      .sort(byAttention);
    return `
      <section class="column" data-col="${col.key}">
        <header><span>${col.label}</span><span class="count">${list.length}</span></header>
        <div class="cards">${list.map(cardHtml).join('') || `<div class="col-empty">${col.key === 'todo' ? '「＋ 新しいタスク」から追加' : 'なし'}</div>`}</div>
      </section>`;
  }).join('');
  boardEl.querySelectorAll('.column[data-col]').forEach((sec) => {
    const top = colScroll[sec.dataset.col];
    const list = sec.querySelector('.cards');
    if (top && list) list.scrollTop = top;
  });
  [boardEl.scrollLeft, boardEl.scrollTop] = boardScroll;
}

// 対応が必要なものを上に、あとは新しい順
function byAttention(a, b) {
  return (needsYou(b) ? 1 : 0) - (needsYou(a) ? 1 : 0) || b.createdAt - a.createdAt;
}

// 「会話」ボタン: 会話の数と、返事を待っている会話があるかを出す
function renderChatBtn() {
  const chats = state.board.cards.filter(isChat);
  const waiting = chats.filter(needsYou).length;
  const n = $('chatCount');
  n.textContent = String(waiting || chats.length);
  n.classList.toggle('hidden', !chats.length);
  n.classList.toggle('warn', !!waiting);
  $('chatBtn').title = waiting ? `あなたの対応を待っている会話が ${waiting} 件あります` : 'タスクを作らずに、このリポジトリについてエージェントと話します';
  if (state.chatListOpen) drawChatList();
}

// ボード上のクリック・ドラッグ（イベント委譲）
$('board').addEventListener('click', boardClick);
function boardClick(e) {
  const rs = e.target.closest('[data-resume]');
  if (rs) {
    e.stopPropagation();
    runBusy('再開しています…', () => api.resume(rs.dataset.resume), '再開しました');
    return;
  }
  const qp = e.target.closest('[data-qpick], [data-qopen]');
  if (qp) {
    e.stopPropagation();
    const box = qp.closest('.qbox');
    if (qp.dataset.qopen) return select(box.dataset.card);
    const c = card(box.dataset.card);
    const req = c && (c.questions || []).find((r) => r.id === box.dataset.req);
    if (req) sendAnswer(c.id, req.id, { [req.questions[0].question]: qp.dataset.qpick });
    return;
  }
  const btn = e.target.closest('[data-decision]');
  if (btn) {
    e.stopPropagation();
    const p = btn.closest('.perm');
    answer(p.dataset.card, p.dataset.req, btn.dataset.decision, '');
    return;
  }
  const chip = e.target.closest('.issue-chip');
  if (chip) {
    e.stopPropagation();
    run(() => api.openExternal(chip.dataset.url));
    return;
  }
  const el = e.target.closest('.card');
  if (el) select(el.dataset.id);
}
$('board').addEventListener('dragstart', (e) => {
  const el = e.target.closest('.card');
  if (el) e.dataTransfer.setData('text/plain', el.dataset.id);
});
$('board').addEventListener('dragover', (e) => {
  const col = e.target.closest('.column[data-col="running"]');
  if (col) {
    e.preventDefault();
    col.classList.add('drop');
  }
});
$('board').addEventListener('dragleave', (e) => e.target.closest('.column')?.classList.remove('drop'));
$('board').addEventListener('drop', (e) => {
  const col = e.target.closest('.column[data-col="running"]');
  if (!col) return;
  e.preventDefault();
  col.classList.remove('drop');
  const id = e.dataTransfer.getData('text/plain');
  if (card(id)?.status === 'todo') runBusy('タスクを開始しています…', () => api.start(id));
});

async function answer(cardId, reqId, decision, message) {
  await run(() => api.answerPermission(cardId, reqId, decision, message), decision === 'deny' ? '拒否しました' : '許可しました');
}

// ---- アプリの終了で中断されたタスク ----
function interruptedBoxHtml(c) {
  const it = c.interrupted;
  const how = it.kind === 'queued' ? '待機中だった指示を、そのままもう一度渡して始めます。' : c.sessionId ? '同じ会話の続きとして、中断したところから作業を続けてもらいます。' : '最後に渡した指示で、もう一度始めます。';
  return `<div class="int-box">
    <b>${icon('pause')}アプリの終了で中断されました</b>${it.at ? `<span class="muted small">（${esc(new Date(it.at).toLocaleString())}）</span>` : ''}
    <p class="small">${esc(how)}別の指示で続けたいときは、下の欄から追加指示を送ってください。</p>
    <div class="cf-actions"><button class="btn primary" data-act="resume">${icon('play')}再開</button><button class="btn ghost" data-act="dismissInterrupted" title="再開せずに、中断の表示だけ消します">再開しない</button></div>
  </div>`;
}

// 前回の終了で中断されたタスクがあれば、ボードの上に「すべて再開」を出す
function renderInterruptBanner() {
  const el = $('interruptBanner');
  const list = state.board.cards.filter(isInterrupted);
  if (!list.length || state.interruptDismissed) {
    el.classList.add('hidden');
    return;
  }
  el.innerHTML = `<span>${icon('pause')}前回アプリを終了したときに、<b>${list.length} 件</b>のタスクが中断されました。</span>
    <button class="btn small primary" id="resumeAllBtn">${icon('play')}すべて再開</button>
    <button class="btn small ghost" id="interruptLater">あとで</button>`;
  el.classList.remove('hidden');
  $('resumeAllBtn').onclick = () => runBusy('タスクを再開しています…', () => api.resumeAll().then((n) => `${n} 件のタスクを再開しました`)).then((m) => m && toast(m, 'ok'));
  $('interruptLater').onclick = () => {
    state.interruptDismissed = true;
    renderInterruptBanner();
  };
}

// ---------------- 詳細パネル ----------------

// 作ったカードがまだ手元のボードに無ければ、ボードを読み直す。
// board:changed は少し遅れて届く（遠隔操作中はホストからの中継なので、遅れたり届かなかったりもする）ので、それを待たずに一覧へ出す
async function refreshBoardFor(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length || list.every((id) => card(id))) return;
  const board = await run(() => api.getBoard());
  if (!board) return;
  state.board = board;
  renderBoard();
}

// 作ったカードを開く（一覧にまだ無ければ、読み直してから）
async function selectNew(id) {
  await refreshBoardFor(id);
  if (card(id)) select(id);
}

async function select(id) {
  if (state.selected !== id) state.titleExpanded = false;
  state.selected = id;
  state.headSig = '';
  if (state.chatListOpen) closeModal();
  // 会話はボードの横ではなく、画面の中央にモーダルで開く
  const chatModal = isChat(card(id));
  $('detail').classList.toggle('as-modal', chatModal);
  $('detailBackdrop').classList.toggle('hidden', !chatModal);
  $('detail').classList.remove('hidden');
  $('followInput').value = '';
  followAttach.clear();
  state.followSkill = null;
  // 承認や回答が必要なものはログの最後に出すので、そのときはログタブで開く
  if (hasLogActions(card(id)) && state.tab !== 'log') {
    state.tab = 'log';
    document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'log'));
  }
  renderBoard();
  renderDetailHead();
  updateBtwTab(card(id));
  updateTabsFor(card(id));
  if (!state.logs.has(id)) {
    const logs = await run(() => api.logs(id));
    state.logs.set(id, logs || []);
  }
  renderDetailBody();
}

// 会話には worktree も差分もないので、そのタブは隠す
function updateTabsFor(c) {
  const chat = isChat(c);
  document.querySelectorAll('#tabs .tab').forEach((t) => {
    if (t.dataset.tab === 'worktree' || t.dataset.tab === 'diff') t.classList.toggle('hidden', chat);
  });
  if (chat && (state.tab === 'worktree' || state.tab === 'diff')) {
    state.tab = 'log';
    document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'log'));
  }
}

function closeDetail() {
  state.selected = null;
  $('detail').classList.add('hidden');
  $('detail').classList.remove('as-modal');
  $('detailBackdrop').classList.add('hidden');
  renderBoard();
}

// Pipelineの工程の状態（ワークフロー表示用）
const RELAY_STATE = {
  pending: ['・', '待ち'],
  queued: ['…', '待機中'],
  running: ['▶', '実行中'],
  question: ['?', '質問中'],
  waiting: ['!', '承認待ち'],
  awaiting: ['?', '回答待ち'],
  spec: ['?', '仕様の確認'],
  conflict: ['!', 'コンフリクト'],
  interrupted: ['‖', '中断'],
  stopped: ['■', '停止'],
  failed: ['✕', '失敗'],
  skipped: ['–', 'スキップ'],
  done: ['✓', '完了'],
};
// 設定: 分岐の行き先の選択肢（'' = 次の工程 / 'end' = 終了 / 工程の番号）
function targetOpts(v, n) {
  const o = (val, label) => `<option value="${val}" ${String(v === undefined ? '' : v) === String(val) ? 'selected' : ''}>${label}</option>`;
  return [o('', '次の工程'), ...Array.from({ length: n }, (_, j) => o(j, `工程${j + 1}へ`)), o('end', '終了（レビューへ）')].join('');
}
function relayStepState(c, i) {
  const r = c.relay;
  const ran = (r.history || []).some((h) => h.index === i);
  // 分岐で飛ばした工程・Pipelineを終えたあとの、まだ動かしていない工程は「スキップ」
  if (i < r.index) return ran ? 'done' : 'skipped';
  if (i > r.index) return r.done ? (ran ? 'done' : 'skipped') : 'pending';
  const b = badgeFor(c)[0];
  if (b === 'review') return r.done || i === r.steps.length - 1 ? 'done' : 'stopped'; // 途中の工程で止まっている（停止したとき）
  if (b === 'todo') return 'pending';
  return RELAY_STATE[b] ? b : 'done';
}
function durText(ms) {
  if (!(ms > 0)) return '';
  return elapsed(Date.now() - ms).replace(/(\d+分)\d+秒$/, '$1');
}
function hhmm(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ボードのカード: 工程の数だけ区切った進み具合のバー
function relayBarHtml(c) {
  const r = c.relay;
  const segs = r.steps.map((st, i) => `<span class="rb-seg rs-${relayStepState(c, i)}" title="${i + 1}. ${esc(st.label)}（${esc(agentShort(st.agent))}）: ${RELAY_STATE[relayStepState(c, i)][1]}"></span>`);
  return `<div class="relay-bar">${segs.join('')}</div>`;
}

// 詳細: Pipelineの工程をワークフローの形で見せる（状態・エージェント・時間・金額・前の工程の報告）
function relayFlowHtml(c) {
  if (!c.relay || isChat(c)) return '';
  const r = c.relay;
  const hist = new Map((r.history || []).map((h) => [h.index, h])); // 同じ工程を何度か動かしたら、最後の回
  const runs = (i) => (r.history || []).filter((h) => h.index === i).length + (i === r.index ? 1 : 0);
  const doneN = r.steps.filter((_, i) => relayStepState(c, i) === 'done').length;
  const loopN = Object.values(r.loops || {}).reduce((a, b) => a + b, 0);
  const nodes = r.steps.map((st, i) => {
    const stt = relayStepState(c, i);
    const [mark, label] = RELAY_STATE[stt]; // icon() を隠さないよう、別の名前にする
    // 今の工程は、今の回の情報を見せる（今の回は履歴にまだない。前の回の報告は残す）
    const h = i === r.index ? null : hist.get(i);
    const prev = hist.get(i);
    const info = [];
    const n = runs(i);
    if (n > 1) info.push(`${n}回目`);
    if (h) {
      if (h.startedAt && h.at) info.push(`${icon('clock')}${durText(h.at - h.startedAt) || '1分未満'}`);
      if (h.costUsd) info.push(`$${h.costUsd.toFixed(3)}`);
    } else if (i === r.index && r.stepStartedAt) {
      if (stt === 'running') info.push(`${icon('clock')}<span class="elapsed" data-since="${r.stepStartedAt}">${elapsed(r.stepStartedAt)}</span>（${hhmm(r.stepStartedAt)} から）`);
      else info.push(`${hhmm(r.stepStartedAt)} に開始`);
      const cost = (c.costUsd || 0) - (r.stepCostStart || 0);
      if (cost > 0) info.push(`$${cost.toFixed(3)}`);
    }
    // 判定する工程: 行き先と、最後の判定
    const judge = st.onPass !== undefined || st.onFail !== undefined;
    // 「次の工程」でも最後の工程なら終了（agent.js の relayPlan と同じ）
    const tgt = (to) => {
      const j = to === undefined ? i + 1 : to;
      if (to === 'end' || j >= r.steps.length) return '終了';
      return to === undefined ? '次へ' : `工程${j + 1}${j <= i ? 'に戻る' : 'へ'}`;
    };
    const verdict = (i === r.index && r.lastVerdict) || (prev && prev.verdict);
    const judgeHtml = judge
      ? `<div class="rf-info">分岐: 合格 → ${esc(tgt(st.onPass))} ・ 差し戻し → ${esc(tgt(st.onFail))}${(r.loops || {})[i] ? ` ・ 戻した回数 ${r.loops[i]}/${st.maxLoops || 3}` : ''}${verdict ? ` <span class="rf-verdict v-${verdict}">${verdict === 'fail' ? '差し戻し' : '合格'}</span>` : ''}</div>`
      : '';
    const key = `${c.id}:${i}`;
    const report = prev && String(prev.report || '').trim()
      ? `<details class="rf-report" data-rkey="${esc(key)}" ${state.relayOpen.has(key) ? 'open' : ''}><summary>${(r.history || []).filter((x) => x.index === i).length > 1 ? '最後に' : ''}次の工程へ渡した報告</summary><div class="rf-report-body">${esc(prev.report)}</div></details>`
      : '';
    return `<li class="rf-node rs-${stt} ${i === r.index ? 'cur' : ''}">
      <span class="rf-dot">${mark}</span>
      <div class="rf-body">
        <div class="rf-head"><b>${i + 1}. ${esc(st.label)}</b> <span class="rf-agent">${agentIcon(st.agent)}${esc(agentLabel(st.agent))}</span> <span class="rf-state">${label}</span></div>
        ${info.length ? `<div class="rf-info">${info.join(' ・ ')}</div>` : ''}
        ${judgeHtml}
        ${st.instruction ? `<div class="rf-inst" title="${esc(st.instruction)}">${esc(st.instruction)}</div>` : ''}
        ${report}
      </div>
    </li>`;
  });
  return `<div class="relay-flow"><div class="rf-title">${icon('pipeline')}Pipeline <span class="muted small">${doneN}/${r.steps.length} 工程が完了${loopN ? `・ループ ${loopN} 回` : ''}${r.limitReached ? '・ループの上限で終了' : ''}</span></div><ol class="rf-list">${nodes.join('')}</ol></div>`;
}

// 詳細: 競争の候補（同じタスクをほかのエージェントで解いたもの）
function competeBoxHtml(c) {
  if (!c.compete || isChat(c)) return '';
  if (c.compete.adopted) return '';
  const list = competitors(c);
  if (list.length < 2) return '';
  const busy = list.some((x) => x.status === 'running' || x.status === 'queued' || x.status === 'todo');
  const rows = list
    .map((x) => {
      const [bcls, blabel] = badgeFor(x);
      return `<button class="compete-item ${x.id === c.id ? 'cur' : ''}" data-goto="${x.id}"><span class="badge b-${bcls}">${blabel}</span> <b>${agentIcon(agentOf(x))}${esc(agentLabel(agentOf(x)))}</b> <span class="muted small">${esc(x.lastMessage || '')}</span></button>`;
    })
    .join('');
  const canAdopt = c.status === 'review' || c.status === 'failed';
  return `<div class="compete-box"><b>${icon('flag')}競争: 同じタスクを ${list.length} つのエージェントで解いています</b>
    <div class="compete-list">${rows}</div>
    <small>${busy ? 'まだ動いている候補があります。' : 'すべての候補が終わりました。'}差分タブでそれぞれの変更を見比べて、よいものを採用してください。採用すると、ほかの候補は worktree とブランチごと破棄します。</small>
    <div class="d-actions">
      ${canAdopt ? `<button class="btn primary" data-act="adopt">${icon('flag')}この案（${esc(agentShort(agentOf(c)))}）を採用</button>` : ''}
      <button class="btn" data-act="compare" ${busy ? 'title="終わっていない候補は、その時点の内容で比べます"' : ''}>${icon('compare')}${agentIcon(defaultAgent())}${esc(agentShort(defaultAgent()))} に比べてもらう</button>
      ${c.compete.compareChat && card(c.compete.compareChat) ? `<button class="btn ghost" data-goto="${c.compete.compareChat}">比較の会話を開く</button>` : ''}
    </div></div>`;
}

function renderDetailHead() {
  const c = card(state.selected);
  if (!c) return closeDetail();
  const sig = JSON.stringify([c.conflict, c.conflictResolved, c.status, c.title, c.error, c.branch, c.worktreePath, c.costUsd, c.permissions, c.alwaysAllow, c.mergedInto, c.pushedTo, c.prUrl, c.prBase, c.prState, c.prMergeable, state.board.settings.integration, c.sessionId, c.forkNext, c.sessions, c.questions, c.awaitingReply, c.specState, c.specQuestions, c.interrupted, c.agent, c.relay, c.compete, competitors(c).map((x) => [x.id, x.status, x.branch])]);
  if (sig === state.headSig) return;
  state.headSig = sig;
  const s = c.status;
  const chat = isChat(c);
  const btns = chat ? [
    isInterrupted(c) && `<button class="btn primary" data-act="resume" title="中断したところから続けます">${icon('play')}再開</button>`,
    (s === 'running' || s === 'queued') && `<button class="btn" data-act="stop">${icon('stop')}停止</button>`,
    c.sessionId && s !== 'running' && s !== 'queued' &&
      `<button class="btn" data-act="toTask" title="この会話の続きとして、worktree で作業するタスクを作ります（会話はそのまま残ります）">${icon('note')}タスクにする</button>`,
    `<button class="btn danger" data-act="discard">削除</button>`,
  ].filter(Boolean) : [
    isInterrupted(c) && `<button class="btn primary" data-act="resume" title="中断したところから続けます">${icon('play')}再開</button>`,
    s === 'todo' && !isInterrupted(c) && `<button class="btn primary" data-act="start">${icon('play')}開始</button>`,
    (s === 'running' || s === 'queued') && `<button class="btn" data-act="stop">${icon('stop')}停止</button>`,
    (s === 'review' || s === 'failed') && c.worktreePath &&
      (state.board.settings.integration === 'pr'
        ? `<button class="btn primary" data-act="pr">${icon('pr')}${c.prUrl ? 'PR を更新…' : 'PR を作成…'}</button>`
        : `<button class="btn primary" data-act="merge">${icon('merge')}マージ…</button>`),
    // 完了したタスクは開き直さない。修正は別のタスクにする（このタスクのやりとりを引き継ぐ）
    s === 'done' && `<button class="btn" data-act="fixTask" title="このタスクのやりとり（完了後の会話も含む）を引き継いで、修正のための新しいタスクを作ります">${icon('wrench')}修正タスクを作る</button>`,
    c.worktreePath && `<button class="btn ghost" data-act="open">フォルダを開く</button>`,
    // 完了したタスク（完了後の会話の途中も含む）は削除できない
    s !== 'done' && !c.afterDone && `<button class="btn danger" data-act="discard">破棄</button>`,
  ].filter(Boolean);
  $('detailTitle').innerHTML = `
    <div class="d-title-row">
      <span class="badge b-${badgeFor(c)[0]}">${badgeFor(c)[1]}</span>
      <h2 class="d-title" id="detailTitleText" title="${esc(c.title)}">${esc(c.title)}</h2>
      <button class="icon" id="closeDetail" title="閉じる">✕</button>
    </div>`;
  $('detailHead').innerHTML = `
    ${isInterrupted(c) ? interruptedBoxHtml(c) : c.error ? `<div class="d-error">${esc(c.error)}</div>` : ''}
    ${relayFlowHtml(c)}
    ${competeBoxHtml(c)}
    ${conflictBoxHtml(c)}
    <div class="d-actions">${btns.join('')}</div>`;
  $('closeDetail').onclick = closeDetail;
  // 長いタイトルは2行までにして、クリックで全文を開いたり閉じたりする
  const tt = $('detailTitleText');
  tt.classList.toggle('expanded', !!state.titleExpanded);
  tt.onclick = () => {
    if (!state.titleExpanded && tt.scrollHeight <= tt.clientHeight + 1) return;
    state.titleExpanded = !state.titleExpanded;
    tt.classList.toggle('expanded', state.titleExpanded);
  };
  $('detailHead').querySelectorAll('details[data-rkey]').forEach((d) => (d.ontoggle = () => (d.open ? state.relayOpen.add(d.dataset.rkey) : state.relayOpen.delete(d.dataset.rkey))));
  if (state.tab === 'info') renderInfo(c);
  drawLogActions(c);
  const canFollow = canSendFollow(c);
  $('followInput').disabled = !canFollow;
  drawFollowSkill();
  followAttach.sync();
  $('followBtn').disabled = !canFollow;
  $('followInput').placeholder =
    chat ? (canFollow ? 'メッセージを送る（Ctrl/⌘ + Enter で送信）。同じ会話の続きとして話せます' : '返事が来たら、続きを話せます')
    : canFollow && isSpecPending(c) ? '質問への答えを書く（Ctrl/⌘ + Enter で送信）。分からないところは「おまかせ」と書いてもかまいません'
    : canFollow && c.awaitingReply ? `${agentShort(agentOf(c))} への回答を書く（Ctrl/⌘ + Enter で送信）`
    : s === 'done' ? '完了したタスクについて話す（Ctrl/⌘ + Enter で送信）。ファイルは変えずに答えます。修正が必要なときは「修正タスクを作る」から別のタスクにしてください'
    : c.afterDone ? '返事が来たら、続きを話せます'
    : canFollow ? '追加の指示を送る（Ctrl/⌘ + Enter で送信）。同じセッションの続きとして動きます'
    : s === 'todo' ? '開始すると、終わったあとに追加の指示を送れます'
    : 'エージェントの作業中は送れません';
}

// 詳細の「情報」タブ: エージェント・会話・ブランチ・worktree・PR・コストなど
function detailMetaHtml(c) {
  const s = c.status;
  const chat = isChat(c);
  return `<dl class="d-meta">
      ${c.issue ? `<dt>Issue</dt><dd><a class="issue-chip" data-url="${esc(c.issue.url)}">#${c.issue.number}</a> ${esc(c.issue.url)}</dd>` : ''}
      ${!chat ? `<dt>エージェント</dt><dd>${agentIcon(agentOf(c))}${esc(agentLabel(agentOf(c)))}</dd>` : ''}
      ${sessionRowHtml(c)}
      ${chat ? `<dt>場所</dt><dd class="mono">${esc(c.repoPath)} <span class="muted small">（worktree は作りません）</span></dd>` : ''}
      ${c.branch ? `<dt>ブランチ</dt><dd>${esc(c.branch)} ← ${esc(c.baseBranch)}</dd>` : ''}
      ${c.worktreePath ? `<dt>worktree</dt><dd class="mono">${esc(c.worktreePath)}</dd>` : ''}
      ${c.prUrl ? `<dt>PR</dt><dd><a class="issue-chip" data-url="${esc(c.prUrl)}">${esc(c.prUrl)}</a>${c.prBase ? ` → ${esc(c.prBase)}` : ''}${c.prState === 'MERGED' ? '（マージ済み）' : c.prState === 'CLOSED' ? '（閉じられました）' : ''}${c.prState === 'OPEN' && c.prMergeable === 'CONFLICTING' ? ` <span class="badge b-conflict">コンフリクト</span>${c.worktreePath && !c.conflict && (s === 'review' || s === 'failed') ? ' <button class="btn small" data-act="prConflict">解消する</button>' : ''}` : ''}</dd>` : ''}
      ${(c.mergedInto || []).length ? `<dt>マージ済み</dt><dd>${c.mergedInto.map((b) => esc(b) + ((c.pushedTo || []).includes(b) ? '（origin にも push 済み）' : '')).join(', ')}</dd>` : ''}
      ${c.costUsd ? `<dt>コスト</dt><dd>$${c.costUsd.toFixed(3)}</dd>` : ''}
      ${(c.alwaysAllow || []).length ? `<dt>常に許可</dt><dd>${c.alwaysAllow.map(esc).join(', ')}</dd>` : ''}
    </dl>`;
}

function renderInfo(c) {
  const body = $('detailBody');
  body.innerHTML = `<div class="pad">${detailMetaHtml(c)}</div>`;
  const ds = $('dSession');
  if (ds) {
    ds.onchange = async () => {
      const v = ds.value;
      if (v === '__pick__') {
        state.headSig = '';
        renderDetailHead(); // 選択を元に戻す（情報タブも描き直す）
        return openSessionPicker(c);
      }
      const sess = v === '__new__' ? { mode: 'new' } : { mode: 'resume', id: v };
      await run(() => api.setSession(c.id, sess), v === '__new__' ? '次は新しい会話で始めます' : '次はこの会話の続きで始めます');
    };
  }
}

// 情報タブの中のリンク・ボタン
$('detailBody').addEventListener('click', (e) => {
  if (state.tab !== 'info') return;
  const chip = e.target.closest('.issue-chip');
  if (chip) return run(() => api.openExternal(chip.dataset.url));
  const c = card(state.selected);
  if (c && e.target.closest('[data-act="prConflict"]')) run(() => api.reopenPrConflict(c.id));
});

// ログの最後の、承認・質問・仕様の確認のフォーム
$('detailBody').addEventListener('input', (e) => {
  if (!e.target.classList.contains('q-other')) return;
  const box = e.target.closest('.q-opt')?.querySelector('input[type=radio], input[type=checkbox]');
  if (box && e.target.value.trim()) box.checked = true;
});
$('detailBody').addEventListener('click', (e) => {
  if (e.target.closest('.log-actions')) logActionClick(e);
});
function logActionClick(e) {
  const sq = e.target.closest('[data-sqact]');
  if (sq) {
    const form = sq.closest('.qform');
    const c = card(form.dataset.card);
    if (c) sendSpecAnswer(form, c, sq.dataset.sqact === 'auto');
    return;
  }
  const qa = e.target.closest('[data-qact]');
  if (qa) {
    const form = qa.closest('.qform');
    const c = card(form.dataset.card);
    if (!c) return;
    if (qa.dataset.qact === 'skip') return sendAnswer(c.id, form.dataset.req, null);
    const req = (c.questions || []).find((r) => r.id === form.dataset.req);
    const answers = collectAnswers(form, req && req.questions);
    const empty = Object.entries(answers || {}).find(([, v]) => !v);
    if (empty) toast(`「${empty[0]}」に答えてください`);
    else sendAnswer(c.id, form.dataset.req, answers);
    return;
  }
  const dec = e.target.closest('[data-decision]');
  if (dec) {
    const p = dec.closest('.perm');
    answer(p.dataset.card, p.dataset.req, dec.dataset.decision, p.querySelector('.deny-reason')?.value || '');
    return;
  }
}
$('detailHead').addEventListener('click', async (e) => {
  const ca = e.target.closest('[data-cact]');
  if (ca) {
    const c = card(state.selected);
    if (c) conflictAction(c, ca.dataset.cact);
    return;
  }
  const chip = e.target.closest('.issue-chip');
  if (chip) return run(() => api.openExternal(chip.dataset.url));
  const go = e.target.closest('[data-goto]');
  if (go) return select(go.dataset.goto);
  const act = e.target.closest('[data-act]')?.dataset.act;
  const c = card(state.selected);
  if (!act || !c) return;
  if (act === 'start') runBusy('タスクを開始しています…', () => api.start(c.id));
  if (act === 'resume') runBusy('再開しています…', () => api.resume(c.id), '再開しました');
  if (act === 'dismissInterrupted') run(() => api.dismissInterrupted(c.id));
  if (act === 'stop') runBusy('停止しています…', () => api.stop(c.id));
  if (act === 'open') run(() => api.open(c.id));
  if (act === 'merge') openMerge(c);
  if (act === 'pr') openPr(c);
  if (act === 'prConflict') run(() => api.reopenPrConflict(c.id));
  if (act === 'toTask') newTask({ fromChat: c });
  if (act === 'fixTask') newTask({ fromChat: c });
  if (act === 'adopt') {
    const others = competitors(c).filter((x) => x.id !== c.id && x.status !== 'done' && !x.afterDone);
    const msg = others.length
      ? `${agentLabel(agentOf(c))} の案を採用しますか？\nほかの候補（${others.map((x) => agentShort(agentOf(x))).join('・')}）は worktree とブランチごと破棄され、元に戻せません。`
      : `${agentLabel(agentOf(c))} の案を採用しますか？\nほかの候補は完了しているので、破棄せずに残します。`;
    if (confirm(msg)) await runBusy('ほかの候補を破棄しています…', () => api.adoptCompetitor(c.id), 'この案を採用しました。マージ（または PR の作成）で取り込めます');
    return;
  }
  if (act === 'compare') {
    const id = await runBusy('比べてもらう会話を始めています…', () => api.compareCompetitors(c.id));
    if (id) selectNew(id);
    return;
  }
  if (act === 'discard' && isChat(c)) {
    if (confirm(`会話「${c.title}」をボードから削除しますか？\n${agentOf(c) === 'claude' ? '（Claude Code の会話の記録は残るので、あとで「既存の会話」から引き継げます）' : ''}`)) {
      await runBusy('削除しています…', () => api.discard(c.id), '削除しました');
      closeDetail();
    }
    return;
  }
  if (act === 'discard') {
    if (c.status === 'done' || c.afterDone) return toast('完了したタスクは削除できません');
    if (confirm(`「${c.title}」を破棄しますか？\nworktree とブランチ ${c.branch || ''} も削除され、元に戻せません。`)) {
      await runBusy('worktree とブランチを削除しています…', () => api.discard(c.id), '破棄しました');
      closeDetail();
    }
  }
});

document.querySelectorAll('#tabs .tab').forEach((t) =>
  t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    renderDetailBody();
  }),
);

// ログはチャットの形で見せる（Claude Desktop のように、あなたの指示は右の吹き出し、エージェントの返事は左）。
// Claude の返事やあなたの指示は Markdown として整えて表示する（ツールの出力などはそのまま）
const logTime = (e) => (e && e.t ? new Date(e.t).toLocaleTimeString() : '');
function mdHtml(text) {
  return typeof Markdown !== 'undefined' ? `<div class="md">${Markdown.render(text || '')}</div>` : `<div class="c-plain">${esc(text || '')}</div>`;
}
function skillChip(e) {
  return e.skill ? `<div class="c-skill"><span class="skill-chip small">${icon('zap')}/${esc(e.skill)}</span></div>` : '';
}
function chatHeadHtml(agent, e) {
  return `<div class="c-head"><span class="c-avatar">${agentIcon(agent)}</span><b class="c-name">${esc(agentShort(agent))}</b><span class="c-time">${esc(logTime(e))}</span></div>`;
}
// ツールの呼び出し「名前  引数の要約」を名前と引数に分ける
function splitTool(text) {
  const t = String(text || '');
  const i = t.indexOf('  ');
  return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 2)];
}
const NOTE_ICON = { result: 'checkCircle', error: 'alert', question: 'question', permission: 'lock', stderr: 'terminal' };
function chatItemHtml(it, agent, open) {
  const e = it.entry;
  if (it.type === 'user') {
    return `<div class="c-row c-user" title="${esc(logTime(e))}"><div class="c-bubble">${skillChip(e)}${mdHtml(e.text)}${logImagesHtml(e.images)}${attachFilesHtml(e.attachments)}</div></div>`;
  }
  if (it.type === 'assistant') {
    return `<div class="c-row c-agent">${it.head ? chatHeadHtml(it.agent || agent, e) : ''}<div class="c-text" title="${esc(logTime(e))}">${mdHtml(e.text)}${logImagesHtml(e.images)}</div></div>`;
  }
  if (it.type === 'tool') {
    const r = it.result;
    const [name, arg] = e ? splitTool(e.text) : ['ツールの結果', ''];
    const err = r && r.kind === 'tool_error';
    const st = err ? `<span class="c-tool-st">エラー</span>` : '';
    const out = r && r.text ? `<pre class="c-tool-out">${esc(r.text)}</pre>` : r ? `<div class="c-tool-out muted small">（出力はありません）</div>` : `<div class="c-tool-out muted small">（結果はまだありません）</div>`;
    return `<div class="c-row c-agent c-toolrow">${it.head ? chatHeadHtml(it.agent || agent, e || r) : ''}<details class="c-tool${err ? ' err' : ''}"${open ? ' open' : ''}><summary title="${esc(logTime(e || r))}">${icon('wrench')}<span class="c-tool-name">${esc(name)}</span><span class="c-tool-arg">${esc(arg)}</span>${st}</summary>${out}</details>${r ? logImagesHtml(r.images) : ''}</div>`;
  }
  // システムのお知らせ・完了・エラー・承認・質問などは、会話の間に小さく挟む
  const k = e.kind;
  const body = k === 'question' ? mdHtml(e.text) : k === 'result' ? mdHtml(e.text) : `<span class="c-note-x">${esc(e.text)}</span>`;
  return `<div class="c-note k-${esc(k)}" title="${esc(LOG_LABEL[k] || k)} ${esc(logTime(e))}">${NOTE_ICON[k] ? icon(NOTE_ICON[k]) : ''}${body}${logImagesHtml(e.images)}</div>`;
}
function renderChatLog(body, c, logs) {
  const agent = agentOf(c);
  const items = ChatLog.build(logs, agent);
  state.chat = { id: c.id, items };
  body.innerHTML = `<div class="chat-log">${items.map((it) => chatItemHtml(it, agent)).join('')}</div><div id="logActions" class="log-actions"></div>`;
  drawLogActions(c, true);
}

// ログの最後に出す、あなたの操作が必要なもの（承認・質問の回答・仕様の確認・回答待ちの案内）
function logActionsHtml(c) {
  const s = c.status;
  const who = esc(agentShort(agentOf(c)));
  const spec = isSpecPending(c);
  const parts = [
    permissionBlock(c, false),
    questionFormHtml(c),
    spec
      ? `<div class="d-awaiting d-spec"><b>${icon('note')}内容が詰まっていないので、開発を開始できません</b><small>${specQuestions(c) ? 'このすぐ下のフォーム（または下の欄）' : '下の欄'}で、上の ${who} の質問に答えて仕様を詰めてください。仕様が詰まると、決まった仕様をまとめてから開発を始めます。</small></div>${specFormHtml(c)}`
      : c.awaitingReply && (s === 'review' || s === 'failed')
        ? `<div class="d-awaiting"><b>${icon('chat')}${who} が質問しています</b><small>下の欄に答えを書いて送ると、同じ会話の続きから進めます。</small></div>`
        : '',
  ];
  return parts.join('');
}
function hasLogActions(c) {
  return !!(c && ((c.permissions || []).length || (c.questions || []).length || isSpecPending(c) || (c.awaitingReply && (c.status === 'review' || c.status === 'failed'))));
}
// 中身が変わったときだけ描き直す（選びかけのラジオや入力中の文字を消さない）
function drawLogActions(c, force) {
  const tab = $('logTab');
  const attn = hasLogActions(c);
  tab.classList.toggle('attn', attn);
  tab.title = attn ? 'ログの最後に、承認や回答が必要なものがあります' : '';
  if (state.tab !== 'log') return;
  const box = $('logActions');
  if (!box) return;
  const html = logActionsHtml(c);
  if (!force && box.dataset.card === c.id && box.dataset.html === html) return;
  const body = $('detailBody');
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  const grew = !box.dataset.html && html;
  box.dataset.card = c.id;
  box.dataset.html = html;
  box.innerHTML = html;
  box.classList.toggle('hidden', !html);
  // 新しく承認や質問が出たら、見えるところまで送る
  if (atBottom || grew) body.scrollTop = body.scrollHeight;
}
// 実行中に届いたログを1件ずつ足す（ツールの結果は、呼び出しの折りたたみの中に入れ直す）
function appendChatLog(body, c, entry) {
  const box = body.querySelector('.chat-log');
  if (!box || !state.chat || state.chat.id !== c.id) return renderChatLog(body, c, state.logs.get(c.id) || []);
  const agent = agentOf(c);
  const { op, item } = ChatLog.push(state.chat.items, entry, agent);
  const lastEl = box.lastElementChild;
  if (op === 'replace' && lastEl) {
    const open = !!lastEl.querySelector('details[open]');
    lastEl.outerHTML = chatItemHtml(item, agent, open);
  } else box.insertAdjacentHTML('beforeend', chatItemHtml(item, agent));
}

// ツールの結果に入っていた画像（スクリーンショットなど）。クリックで大きく表示する
const IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
function logImagesHtml(images) {
  if (!Array.isArray(images) || !images.length) return '';
  const items = images.map((im) => {
    if (im && IMG_TYPES.has(im.mediaType) && typeof im.data === 'string' && /^[A-Za-z0-9+/]+=*$/.test(im.data)) {
      return `<img class="log-img" src="data:${im.mediaType};base64,${im.data}" alt="画像" title="クリックで大きく表示" />`;
    }
    return `<span class="log-img-omitted">${icon('image')}画像（${esc((im && im.omitted) || '表示できません')}）</span>`;
  });
  return `<div class="log-imgs">${items.join('')}</div>`;
}

document.addEventListener('click', (ev) => {
  const img = ev.target.closest && ev.target.closest('.log-img');
  if (img) {
    const ov = document.createElement('div');
    ov.className = 'img-overlay';
    ov.title = 'クリックで閉じる';
    const big = document.createElement('img');
    big.src = img.src;
    ov.appendChild(big);
    ov.onclick = () => ov.remove();
    document.body.appendChild(ov);
  }
});
// 拡大表示中の Esc は拡大を閉じるだけにする（詳細パネルまで閉じない）
document.addEventListener(
  'keydown',
  (ev) => {
    const ovs = document.querySelectorAll('.img-overlay');
    if (ev.key !== 'Escape' || !ovs.length) return;
    ovs.forEach((o) => o.remove());
    ev.stopImmediatePropagation();
  },
  true,
);

// ---------------- 差分タブ（GitHub 風: 左にファイルツリー、右にファイルごとの差分） ----------------

const DIFF_STATUS = { A: ['追加', 'fa'], M: ['変更', 'fm'], D: ['削除', 'fd'], R: ['名前変更', 'fr'] };
const DIFF_BIG = 600; // これより行数が多いファイルは最初は折りたたむ
// 折りたたみ・表示状態（更新しても保つ）
// split: 左右に並べて表示する（次に開いたときも同じ表示にする）。full: 画面に大きくモーダルで出す
const DIFF_SPLIT_KEY = 'agent-kanban.diffSplit';
const diffUi = { cardId: null, collapsedDirs: new Set(), collapsedFiles: new Set(), openedBig: new Set(), tree: true, active: null, split: localStorage.getItem(DIFF_SPLIT_KEY) === '1', full: false };

function diffTreeHtml(node, depth) {
  const pad = (d) => `style="padding-left:${8 + d * 14}px"`;
  let html = '';
  for (const d of node.dirs) {
    const closed = diffUi.collapsedDirs.has(d.path);
    html += `<li class="dv-dir ${closed ? 'closed' : ''}"><div class="dv-row" data-dir="${esc(d.path)}" ${pad(depth)} title="${esc(d.path)}"><span class="dv-caret">▾</span><span class="dv-ico">${icon('folder')}</span><span class="dv-name">${esc(d.name)}</span></div>
      <ul>${diffTreeHtml(d, depth + 1)}</ul></li>`;
  }
  for (const f of node.files) {
    const [, cls] = DIFF_STATUS[f.file.status] || ['', 'fm'];
    const nums = f.file.binary ? '' : `<span class="dv-n"><span class="add">+${f.file.add}</span> <span class="del">-${f.file.del}</span></span>`;
    html += `<li><div class="dv-row dv-file ${diffUi.active === f.file.path ? 'active' : ''}" data-file="${f.index}" ${pad(depth)} title="${esc(f.file.path)}"><span class="dv-dot ${cls}"></span><span class="dv-name">${esc(f.name)}</span>${nums}</div></li>`;
  }
  return html;
}

// 左右に並べた表示（左が元、右が変更後）
function diffSplitHtml(file) {
  const side = (l, kind) => {
    if (!l) return '<td class="ln empty"></td><td class="code empty"></td>';
    const cls = l.type === 'ctx' ? '' : kind;
    const no = kind === 'del' ? l.oldNo : l.newNo;
    return `<td class="ln ${cls}">${no ?? ''}</td><td class="code ${cls}">${esc(l.text)}</td>`;
  };
  const rows = [];
  for (const h of file.hunks) {
    rows.push(`<tr class="dv-hunk"><td class="ln"></td><td class="code" colspan="3">${esc(h.header)}</td></tr>`);
    for (const r of DiffParse.splitRows(h)) {
      if (r.type === 'meta') rows.push(`<tr class="dv-meta"><td class="ln"></td><td class="code" colspan="3">${esc(r.text)}</td></tr>`);
      else rows.push(`<tr>${side(r.left, 'del')}${side(r.right, 'add')}</tr>`);
    }
  }
  return `<table class="dv-tbl dv-split"><colgroup><col class="c-ln"><col><col class="c-ln"><col></colgroup><tbody>${rows.join('')}</tbody></table>`;
}

function diffLinesHtml(file) {
  if (file.binary) return '<div class="dv-note">バイナリファイルのため表示できません</div>';
  if (!file.hunks.length) {
    const why = file.status === 'R' ? '中身は変わらず、名前だけ変わりました' : file.meta.length ? esc(file.meta.join(' / ')) : '表示できる差分はありません';
    return `<div class="dv-note">${why}</div>`;
  }
  if (diffUi.split) return diffSplitHtml(file);
  const rows = [];
  for (const h of file.hunks) {
    rows.push(`<tr class="dv-hunk"><td class="ln" colspan="2"></td><td class="code">${esc(h.header)}</td></tr>`);
    for (const l of h.lines) {
      if (l.type === 'meta') {
        rows.push(`<tr class="dv-meta"><td class="ln" colspan="2"></td><td class="code">${esc(l.text)}</td></tr>`);
        continue;
      }
      const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
      rows.push(`<tr class="dv-${l.type}"><td class="ln">${l.oldNo ?? ''}</td><td class="ln">${l.newNo ?? ''}</td><td class="code"><span class="sg">${sign}</span>${esc(l.text)}</td></tr>`);
    }
  }
  return `<table class="dv-tbl"><tbody>${rows.join('')}</tbody></table>`;
}

function diffFileHtml(file, index) {
  const [label, cls] = DIFF_STATUS[file.status] || [file.status, 'fm'];
  const lines = file.hunks.reduce((n, h) => n + h.lines.length, 0);
  const big = lines > DIFF_BIG && !diffUi.openedBig.has(file.path);
  const collapsed = diffUi.collapsedFiles.has(file.path) || big;
  const name = file.status === 'R' && file.oldPath ? `${esc(file.oldPath)} → ${esc(file.newPath)}` : esc(file.path);
  const nums = file.binary ? '<span class="muted">バイナリ</span>' : `<span class="add">+${file.add}</span> <span class="del">-${file.del}</span>`;
  const body = big
    ? `<div class="dv-note">差分が大きいので折りたたんでいます（${lines} 行）<button class="btn small ghost" data-open-big="${index}">表示する</button></div>`
    : diffLinesHtml(file);
  return `<section class="dv-fileblock ${collapsed ? 'collapsed' : ''}" id="dvf-${index}" data-path="${esc(file.path)}">
    <header class="dv-fhead" data-toggle="${index}"><span class="dv-caret">▾</span><span class="wt-fs ${cls}">${label}</span><span class="dv-fpath" title="${esc(file.path)}">${name}</span><span class="dv-fnums">${nums}</span>${changeBar(file.add, file.del, Math.max(file.add + file.del, 1))}</header>
    <div class="dv-fbody">${body}</div></section>`;
}

function diffHtml(text, files) {
  if (!text.trim() || !files.length) return '<div class="muted pad">まだ変更はありません</div>';
  const tree = DiffParse.buildTree(files);
  const order = DiffParse.treeOrder(tree);
  const add = files.reduce((n, f) => n + f.add, 0);
  const del = files.reduce((n, f) => n + f.del, 0);
  return `<div class="dv ${diffUi.tree ? '' : 'no-tree'}">
    <div class="diff-stat"><button class="btn small ghost" id="toggleDiffTree" title="ファイルツリーの表示を切り替えます">${icon('sidebar')}</button>
      <span><b>${files.length}</b> ファイル <span class="add">+${add}</span> <span class="del">-${del}</span></span>
      <span class="spacer"></span>
      <span class="dv-mode" role="group" aria-label="差分の並べ方"><button class="btn small ghost ${diffUi.split ? '' : 'on'}" data-diff-mode="unified" title="変更前と変更後を上下に並べます">上下</button><button class="btn small ghost ${diffUi.split ? 'on' : ''}" data-diff-mode="split" title="変更前を左、変更後を右に並べます">左右</button></span>
      <button class="btn small ghost" id="diffExpandAll">すべて開く</button><button class="btn small ghost" id="diffCollapseAll">すべて閉じる</button>
      <button class="btn small ghost" id="refreshDiff">更新</button>
      <button class="btn small ghost" id="toggleDiffFull" title="${diffUi.full ? '大きな表示を閉じます（Esc）' : '画面に大きく表示します'}">${diffUi.full ? icon('minimize') : icon('maximize')}</button></div>
    <div class="dv-main">
      <nav class="dv-tree" id="diffTree"><ul>${diffTreeHtml(tree, 0)}</ul></nav>
      <div class="dv-files" id="diffFiles">${order.map((i) => diffFileHtml(files[i], i)).join('')}</div>
    </div></div>`;
}

function bindDiff(body, files, rerender) {
  const filesEl = $('diffFiles');
  if (!filesEl) return;
  $('toggleDiffTree').onclick = () => {
    diffUi.tree = !diffUi.tree;
    body.querySelector('.dv').classList.toggle('no-tree', !diffUi.tree);
  };
  body.querySelectorAll('[data-diff-mode]').forEach((b) => {
    b.onclick = () => {
      const split = b.dataset.diffMode === 'split';
      if (split === diffUi.split) return;
      diffUi.split = split;
      localStorage.setItem(DIFF_SPLIT_KEY, split ? '1' : '0');
      rerender();
    };
  });
  $('toggleDiffFull').onclick = () => {
    diffUi.full = !diffUi.full;
    rerender();
  };
  $('diffExpandAll').onclick = () => {
    diffUi.collapsedFiles.clear();
    files.forEach((f) => diffUi.openedBig.add(f.path));
    rerender();
  };
  $('diffCollapseAll').onclick = () => {
    files.forEach((f) => diffUi.collapsedFiles.add(f.path));
    rerender();
  };
  body.querySelectorAll('.dv-row[data-dir]').forEach((el) => {
    el.onclick = () => {
      const p = el.dataset.dir;
      if (diffUi.collapsedDirs.has(p)) diffUi.collapsedDirs.delete(p);
      else diffUi.collapsedDirs.add(p);
      el.parentElement.classList.toggle('closed');
    };
  });
  const setActive = (path) => {
    diffUi.active = path;
    body.querySelectorAll('.dv-file').forEach((x) => x.classList.toggle('active', files[x.dataset.file].path === path));
  };
  body.querySelectorAll('.dv-file').forEach((el) => {
    el.onclick = () => {
      const f = files[el.dataset.file];
      const sec = $(`dvf-${el.dataset.file}`);
      if (diffUi.collapsedFiles.delete(f.path)) sec.classList.remove('collapsed');
      setActive(f.path);
      filesEl.scrollTop = Math.max(0, sec.offsetTop - 10);
    };
  });
  body.querySelectorAll('.dv-fhead').forEach((el) => {
    el.onclick = () => {
      const f = files[el.dataset.toggle];
      const sec = el.parentElement;
      const closed = sec.classList.toggle('collapsed');
      if (closed) diffUi.collapsedFiles.add(f.path);
      else {
        diffUi.collapsedFiles.delete(f.path);
        if (!diffUi.openedBig.has(f.path) && sec.querySelector('[data-open-big]')) {
          diffUi.openedBig.add(f.path);
          sec.querySelector('.dv-fbody').innerHTML = diffLinesHtml(f);
        }
      }
    };
  });
  body.querySelectorAll('[data-open-big]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const f = files[b.dataset.openBig];
      diffUi.openedBig.add(f.path);
      diffUi.collapsedFiles.delete(f.path);
      const sec = b.closest('.dv-fileblock');
      sec.classList.remove('collapsed');
      sec.querySelector('.dv-fbody').innerHTML = diffLinesHtml(f);
    };
  });
}

async function renderDiff(c) {
  const body = $('detailBody');
  const same = diffUi.cardId === c.id;
  if (!same) {
    Object.assign(diffUi, { cardId: c.id, active: null });
    diffUi.collapsedDirs.clear();
    diffUi.collapsedFiles.clear();
    diffUi.openedBig.clear();
  }
  const prev = same ? $('diffFiles') : null;
  if (!prev) diffUi.full = false; // 別のタスク・別のタブから来たときは、普通の表示で開く
  const top = prev ? prev.scrollTop : 0;
  if (!prev) body.innerHTML = '<div class="muted pad">読み込み中…</div>';
  const d = c.worktreePath || c.status === 'done' ? await run(() => api.diff(c.id)) : '';
  if (state.selected !== c.id || state.tab !== 'diff') return;
  const text = d || '';
  const files = DiffParse.parseDiff(text);
  let first = true;
  const draw = () => {
    const keep = first || !$('diffFiles') ? top : $('diffFiles').scrollTop;
    first = false;
    body.innerHTML = diffHtml(text, files);
    applyDiffFull(body, draw);
    const r = $('refreshDiff');
    if (r) r.onclick = () => renderDiff(card(c.id) || c);
    bindDiff(body, files, draw);
    if ($('diffFiles')) $('diffFiles').scrollTop = keep;
  };
  draw();
}

// 差分を画面に大きくモーダルで出す（.dv をそのまま画面いっぱいに広げ、後ろを暗くする）
function applyDiffFull(body, rerender) {
  const dv = body.querySelector('.dv');
  if (!dv) {
    diffUi.full = false;
    return;
  }
  dv.classList.toggle('full', diffUi.full);
  if (!diffUi.full) return;
  const bd = document.createElement('div');
  bd.className = 'dv-backdrop';
  bd.onmousedown = () => {
    diffUi.full = false;
    rerender();
  };
  body.prepend(bd);
  dv._closeFull = bd.onmousedown;
}
// Esc は、大きな表示を閉じるだけにする（詳細パネルは閉じない）
document.addEventListener(
  'keydown',
  (ev) => {
    if (ev.key !== 'Escape' || document.querySelector('.img-overlay') || !$('modal').classList.contains('hidden')) return;
    const dv = document.querySelector('.dv.full');
    if (!dv || !dv._closeFull) return;
    dv._closeFull();
    ev.stopImmediatePropagation();
  },
  true,
);

// ---------------- worktree タブ ----------------

const FILE_STATUS = { A: ['追加', 'fa'], M: ['変更', 'fm'], D: ['削除', 'fd'], '?': ['新規', 'fn'], T: ['種類変更', 'fm'] };
function ago(t) {
  if (!t) return '';
  const ms = typeof t === 'number' ? t : Date.parse(t);
  if (!ms) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
}

function changeBar(add, del, max) {
  const w = (n) => (max ? Math.max(n ? 2 : 0, Math.round((n / max) * 60)) : 0);
  return `<span class="wt-bar"><span class="a" style="width:${w(add)}px"></span><span class="d" style="width:${w(del)}px"></span></span>`;
}

function fileListHtml(files, { showTime } = {}) {
  if (!files.length) return '<div class="muted small wt-empty">なし</div>';
  const max = Math.max(...files.map((f) => f.add + f.del), 1);
  // 新しく触ったファイルが上に来るようにする（未コミットのみ）
  const list = showTime ? [...files].sort((a, b) => (b.mtime || 0) - (a.mtime || 0)) : files;
  return `<ul class="wt-files">${list
    .map((f) => {
      const [label, cls] = FILE_STATUS[f.status] || [f.status, 'fm'];
      const slash = f.path.lastIndexOf('/');
      const dir = slash >= 0 ? f.path.slice(0, slash + 1) : '';
      const name = f.path.slice(slash + 1);
      const nums = f.binary ? '<span class="muted">バイナリ</span>' : `<span class="add">+${f.add}</span> <span class="del">-${f.del}</span>`;
      return `<li title="${esc(f.path)}"><span class="wt-fs ${cls}">${label}</span><span class="wt-path"><span class="muted">${esc(dir)}</span>${esc(name)}</span>
        ${showTime && f.mtime ? `<span class="wt-time muted">${ago(f.mtime)}</span>` : ''}<span class="wt-nums">${nums}</span>${changeBar(f.add, f.del, max)}</li>`;
    })
    .join('')}</ul>`;
}

function sumChanges(files) {
  return files.reduce((s, f) => ({ add: s.add + f.add, del: s.del + f.del }), { add: 0, del: 0 });
}

function worktreeHtml(c, data) {
  const refresh = '<button class="btn small ghost" id="refreshWt">更新</button>';
  const others = worktreeListHtml(c, data.worktrees || []);
  if (!data.exists) {
    const why =
      c.status === 'done'
        ? 'マージが終わったので worktree は片付けられました。'
        : c.status === 'todo'
          ? 'まだ worktree はありません。「開始」を押すと、このタスク専用の worktree とブランチが作られます。'
          : 'worktree が見つかりません（削除された可能性があります）。';
    return `<div class="wt-toolbar"><span class="muted">${esc(why)}</span>${refresh}</div>${c.branch ? `<div class="pad small muted">ブランチ: <code>${esc(c.branch)}</code></div>` : ''}${others}`;
  }
  const s = data.status;
  const live = c.status === 'running' || c.status === 'queued';
  const cs = sumChanges(s.committed);
  const us = sumChanges(s.uncommitted);
  const latest = s.uncommitted.reduce((m, f) => Math.max(m, f.mtime || 0), 0);

  // ベース → コミット → 未コミット をつないだ縦のグラフ
  const nodes = [];
  if (s.behind > 0) nodes.push(`<li class="g-behind"><span class="g-dot"></span><div><b>${esc(s.baseBranch)}</b> はその後 <b>${s.behind}</b> コミット進んでいます<div class="muted small">マージ時にコンフリクトが起きることがあります</div></div></li>`);
  nodes.push(`<li class="g-base"><span class="g-dot"></span><div><span class="g-tag">ベース</span> <code>${esc(s.base.short)}</code> ${esc(s.base.subject)}<div class="muted small">${esc(s.baseBranch || '')} から分岐 ${ago(s.base.date)}</div></div></li>`);
  for (const k of s.commits) {
    nodes.push(`<li class="g-commit"><span class="g-dot"></span><div><code>${esc(k.sha.slice(0, 7))}</code> ${esc(k.subject)}<div class="muted small">${k.files} ファイル <span class="add">+${k.add}</span> <span class="del">-${k.del}</span> · ${ago(k.date)}</div></div></li>`);
  }
  if (s.uncommitted.length) {
    nodes.push(`<li class="g-wip ${live ? 'live' : ''}"><span class="g-dot"></span><div><span class="g-tag wip">${live ? '作業中' : '未コミット'}</span> ${s.uncommitted.length} ファイル <span class="add">+${us.add}</span> <span class="del">-${us.del}</span>${latest ? `<div class="muted small">最後の編集 ${ago(latest)}</div>` : ''}</div></li>`);
  } else if (live) {
    nodes.push(`<li class="g-wip live"><span class="g-dot"></span><div><span class="g-tag wip">作業中</span> <span class="muted">まだファイルの変更はありません</span></div></li>`);
  }
  nodes.reverse(); // 新しいものを上に

  return `<div class="wt-toolbar">
      <span class="wt-sum"><b>${s.commits.length}</b> コミット · <b>${s.committed.length}</b> ファイル(コミット済み) · <b>${s.uncommitted.length}</b> ファイル(未コミット)</span>
      ${live ? '<span class="muted small">自動で更新中</span>' : ''}${refresh}</div>
    <div class="pad wt">
      <dl class="wt-meta">
        <dt>場所</dt><dd><code>${esc(s.path)}</code></dd>
        <dt>ブランチ</dt><dd><code>${esc(s.branch)}</code> ← <code>${esc(s.baseBranch || s.base.short)}</code></dd>
        <dt>HEAD</dt><dd><code>${esc(s.head.short)}</code> ${esc(s.head.subject)}</dd>
      </dl>
      <h4>流れ</h4>
      <ul class="wt-graph">${nodes.join('')}</ul>
      <h4>未コミットの変更 <span class="muted small">${s.uncommitted.length ? `+${us.add} -${us.del}` : ''}</span></h4>
      ${fileListHtml(s.uncommitted, { showTime: true })}
      ${s.untrackedTruncated ? `<div class="muted small">ほか ${s.untrackedTruncated} 個の新規ファイルは省略しました</div>` : ''}
      <h4>コミット済みの変更（ベースから） <span class="muted small">${s.committed.length ? `+${cs.add} -${cs.del}` : ''}</span></h4>
      ${fileListHtml(s.committed)}
    </div>${others}`;
}

// 同じリポジトリで並列に動いている worktree の一覧
function worktreeListHtml(c, list) {
  if (!list.length) return '';
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const byPath = new Map(state.board.cards.filter((x) => x.worktreePath).map((x) => [norm(x.worktreePath), x]));
  return `<div class="pad wt"><h4>このリポジトリの worktree（${list.length}）</h4><ul class="wt-list">${list
    .map((w) => {
      const owner = byPath.get(norm(w.path));
      const me = owner && owner.id === c.id;
      const label = w.main ? '<span class="g-tag">メイン</span>' : owner ? `<span class="badge b-${owner.status}">${STATUS_LABEL[owner.status]}</span>` : '<span class="badge">ほか</span>';
      return `<li class="${me ? 'me' : ''}" ${owner && !me ? `data-card="${esc(owner.id)}"` : ''}>${label}
        <span class="wt-l-title">${owner ? esc(owner.title) : esc(w.path.split(/[\\/]/).pop())}${me ? ' <span class="muted small">（このタスク）</span>' : ''}</span>
        <code class="muted small">${esc(w.branch || (w.detached ? 'detached' : ''))}</code></li>`;
    })
    .join('')}</ul></div>`;
}

let wtLoading = false;
async function renderWorktree(c, { quiet } = {}) {
  const body = $('detailBody');
  if (!quiet) body.innerHTML = '<div class="muted pad">読み込み中…</div>';
  wtLoading = true;
  let data;
  try {
    data = quiet ? await api.worktree(c.id).catch(() => null) : await run(() => api.worktree(c.id));
  } finally {
    wtLoading = false;
  }
  if (state.selected !== c.id || state.tab !== 'worktree') return;
  if (!data) {
    if (!quiet) body.innerHTML = '<div class="muted pad">worktree の状況を読み込めませんでした</div>';
    return;
  }
  const top = body.scrollTop;
  body.innerHTML = worktreeHtml(card(c.id) || c, data);
  body.scrollTop = top;
  const r = $('refreshWt');
  if (r) r.onclick = () => renderWorktree(card(c.id) || c);
  body.querySelectorAll('.wt-list li[data-card]').forEach((li) => (li.onclick = () => select(li.dataset.card)));
}

// 実行中は worktree タブを自動で更新する
setInterval(() => {
  if (state.tab !== 'worktree' || !state.selected || wtLoading || document.hidden) return;
  const c = card(state.selected);
  if (c && (c.status === 'running' || c.status === 'queued') && c.worktreePath) renderWorktree(c, { quiet: true });
}, 4000);

const BTW_STATE = { sent: '送信済み', delivered: '反映済み', queued: '開始時に渡します', follow: '終了後に追加指示', lost: '届きませんでした' };
function btwListHtml(c) {
  const list = c.btw || [];
  if (!list.length) return '<div class="muted small">まだ送っていません</div>';
  return list
    .map((m) => `<div class="btw-item"><div class="btw-text">${esc(m.text)}</div><div class="btw-meta"><span class="btw-st st-${m.state}">${BTW_STATE[m.state] || m.state}</span> ${new Date(m.at).toLocaleTimeString()}</div></div>`)
    .join('');
}

function updateBtwTab(c) {
  const n = (c && c.btw ? c.btw.length : 0);
  $('btwTab').textContent = n ? `btw (${n})` : 'btw';
  const live = c && (c.status === 'running' || c.status === 'queued');
  $('btwTab').classList.toggle('live', !!live);
  // Codex / Gemini / Cursor は実行中の stdin 追加に対応していない（終了後に追加指示／待機中は開始の指示に付け足す）
  $('btwTab').title = c && agentOf(c) !== 'claude'
    ? `${agentLabel(agentOf(c))} では、実行中に送ると今の作業のあと追加指示として送ります（待機中なら開始するときの指示に付け足します）`
    : '実行中のエージェントに、作業を止めずにメッセージを送ります';
}

async function renderDetailBody() {
  const c = card(state.selected);
  if (!c) return;
  const body = $('detailBody');
  if (state.tab === 'info') {
    renderInfo(c);
  } else if (state.tab === 'log') {
    const logs = state.logs.get(c.id) || [];
    if (logs.length) renderChatLog(body, c, logs);
    else {
      state.chat = null;
      body.innerHTML = `<div class="muted pad">${isChat(c) ? 'まだ会話はありません。' : `まだログはありません。「開始」を押すと ${agentLabel(agentOf(c))} が動き出します。`}</div><div id="logActions" class="log-actions"></div>`;
      drawLogActions(c, true);
    }
    body.scrollTop = body.scrollHeight;
  } else if (state.tab === 'diff') {
    await renderDiff(c);
  } else if (state.tab === 'worktree') {
    await renderWorktree(c);
  } else if (state.tab === 'btw') {
    const live = c.status === 'running' || c.status === 'queued';
    const nonClaude = agentOf(c) !== 'claude';
    const help = nonClaude
      ? `${agentLabel(agentOf(c))} では、作業の途中にはメッセージを差し込めません。実行中に送ると今の作業は続け、終わったあとに「追加指示」として送ります。待機中なら、開始するときの指示に付け足します。`
      : 'エージェントの作業を止めずに、メッセージを送れます（例:「テストも書いて」「その API は使わないで」）。Claude Code は今の作業の途中で読み、そのまま反映します。';
    const hint = !live
      ? (c.status === 'todo' ? '開始すると送れるようになります' : '作業が終わったあとは、下の「追加指示」を使ってください')
      : c.status === 'queued'
        ? '待機中なので、開始するときの指示に付け足します'
        : nonClaude
          ? '今の作業は続け、終わったあとに追加指示として送ります'
          : '送ると、すぐに実行中のエージェントに届きます';
    body.innerHTML = `<div class="pad btw">
      <p class="muted small">${help}</p>
      <div id="btwList" class="btw-list">${btwListHtml(c)}</div>
      <textarea id="btwInput" rows="3" placeholder="${live ? 'btw: …（Ctrl/⌘ + Enter で送信）' : 'エージェントが実行中のときに送れます'}" ${live ? '' : 'disabled'}></textarea>
      <div class="btw-actions"><span class="muted small">${hint}</span>
        <button class="btn primary" id="btwSend" ${live ? '' : 'disabled'}>送信</button></div>
    </div>`;
    const send = async () => {
      const text = $('btwInput').value.trim();
      if (!text) return;
      const ok = await run(() => api.btw(c.id, text).then(() => true));
      if (ok) {
        $('btwInput').value = '';
        $('btwInput').focus();
      }
    };
    $('btwSend').onclick = send;
    $('btwInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
    });
    if (live) $('btwInput').focus();
  } else {
    const editable = c.status === 'todo';
    body.innerHTML = `<div class="pad">
      <label class="field"><span>タイトル</span><input id="editTitle" value="${esc(c.title)}" ${editable ? '' : 'disabled'} /></label>
      <div class="field"><span>最初の指示</span><div id="editSkill" class="skill-slot"></div><textarea id="editPrompt" rows="14" ${editable ? '' : 'disabled'}>${esc(c.prompt)}</textarea>${c.attachments && c.attachments.length ? `<small class="muted">添付ファイル</small>${attachFilesHtml(c.attachments, { all: true })}` : ''}</div>
      ${editable ? '<button class="btn primary" id="saveEdit">保存</button>' : '<p class="muted">開始後は編集できません。変更したいときは追加指示を送ってください。</p>'}
    </div>`;
    let editSkill = c.skill || null;
    const drawEditSkill = () => renderSkillSlot('editSkill', editSkill, (v) => ((editSkill = v), drawEditSkill()), { disabled: !editable });
    drawEditSkill();
    if (editable) $('saveEdit').onclick = () => runBusy('保存しています…', () => api.updateCard({ id: c.id, title: $('editTitle').value, prompt: $('editPrompt').value, skill: editSkill || '' }), '保存しました');
  }
}

// ---------------- 添付ファイル ----------------
// 指示の入力欄に、ファイル（画像・PDF・テキストなど）を付ける。貼り付け・ドラッグ＆ドロップ・添付ボタンで足せる。
// 中身は base64 で読んで送る（遠隔操作でもそのままホストに届く。ホストが作業フォルダの外に保存して、エージェントに渡す）

const ATTACH_MAX_FILES = 10;
const ATTACH_MAX_BYTES = 20 * 1024 * 1024; // 合わせて（1つでも）この大きさまで。ホスト側でも同じ上限で確かめる

function fmtBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

function readFileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result || '');
      const i = url.indexOf(',');
      resolve({ name: file.name || 'clipboard.png', mediaType: file.type || '', size: file.size, data: i >= 0 ? url.slice(i + 1) : '' });
    };
    r.onerror = () => reject(new Error(`「${file.name}」を読めませんでした`));
    r.readAsDataURL(file);
  });
}

/**
 * 入力欄に添付ファイルの欄を付ける
 * @param {{ box: HTMLElement, input: HTMLElement, drop?: HTMLElement, enabled?: () => boolean }} o
 *   box: 添付ボタンと添付の一覧を描く場所 / input: 貼り付けを受け取る入力欄 / drop: ドロップを受け取る場所（省略すると input）
 * @returns {{ list: () => object[], clear: () => void, render: () => void }}
 */
function attachField({ box, input, drop, enabled = () => true }) {
  let items = [];
  const total = () => items.reduce((n, a) => n + a.size, 0);
  const add = async (files) => {
    if (!enabled()) return;
    const list = Array.from(files || []).filter((f) => f && f.size >= 0);
    if (!list.length) return;
    for (const f of list) {
      if (items.length >= ATTACH_MAX_FILES) return toast(`添付できるファイルは ${ATTACH_MAX_FILES} 個までです`);
      if (total() + f.size > ATTACH_MAX_BYTES) return toast(`添付ファイルは合わせて ${fmtBytes(ATTACH_MAX_BYTES)} までです（「${f.name}」は付けられませんでした）`);
      try {
        const a = await readFileAsAttachment(f);
        // クリップボードの画像は名前が同じ（image.png）なので、時刻を付けて見分けられるようにする
        if (!f.name || f.name === 'image.png') a.name = `clipboard-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')}-${items.length + 1}.png`;
        items.push(a);
      } catch (err) {
        toast(err.message);
      }
    }
    render();
  };
  let shown = null; // 最後に描いたときに使えたか
  const render = () => {
    const on = enabled();
    shown = on;
    box.classList.toggle('hidden', !on);
    if (!on) return;
    box.innerHTML = `<button type="button" class="btn small ghost attach-pick" title="ファイルを選んで添付します（貼り付け・ドラッグ＆ドロップでも付けられます）">${icon('paperclip')}ファイルを添付</button><input type="file" multiple class="hidden attach-input" />
      ${items.map((a, i) => `<span class="attach-chip" title="${esc(a.name)}（${fmtBytes(a.size)}）">${IMG_TYPES.has(a.mediaType) ? `<img src="data:${a.mediaType};base64,${a.data}" alt="" />` : icon('file')}<span class="attach-name">${esc(a.name)}</span><span class="muted">${fmtBytes(a.size)}</span><button type="button" class="chip-x" data-i="${i}" title="添付を外す">×</button></span>`).join('')}`;
    const fi = box.querySelector('.attach-input');
    box.querySelector('.attach-pick').onclick = () => fi.click();
    fi.onchange = () => add(fi.files);
    box.querySelectorAll('.chip-x').forEach((b) => {
      b.onclick = () => {
        items.splice(Number(b.dataset.i), 1);
        render();
      };
    });
  };
  input.addEventListener('paste', (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (!enabled() || !files || !files.length) return;
    e.preventDefault();
    add(files);
  });
  const target = drop || input;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  target.addEventListener('dragover', (e) => {
    if (!enabled() || !hasFiles(e)) return;
    e.preventDefault();
    target.classList.add('attach-over');
  });
  target.addEventListener('dragleave', (e) => {
    if (!target.contains(e.relatedTarget)) target.classList.remove('attach-over');
  });
  target.addEventListener('drop', (e) => {
    target.classList.remove('attach-over');
    if (!enabled() || !hasFiles(e)) return;
    e.preventDefault();
    add(e.dataTransfer.files);
  });
  render();
  return {
    list: () => items.map(({ name, mediaType, data }) => ({ name, mediaType, data })),
    clear: () => {
      items = [];
      render();
    },
    render,
    // 使える・使えないが変わったときだけ描き直す（ファイルを選んでいる途中に、ボタンを作り直さない）
    sync: () => {
      if (enabled() !== shown) render();
    },
  };
}

// ログ・指示のタブに出す、画像以外の添付ファイルの一覧（画像は logImagesHtml で出す）
function attachFilesHtml(atts, { all = false } = {}) {
  const list = (Array.isArray(atts) ? atts : []).filter((a) => a && (all || !IMG_TYPES.has(a.mediaType)));
  if (!list.length) return '';
  return `<div class="attach-files">${list.map((a) => `<span class="attach-chip" title="${esc(a.path || a.name)}">${icon(IMG_TYPES.has(a.mediaType) ? 'image' : 'file')}<span class="attach-name">${esc(a.name)}</span><span class="muted">${fmtBytes(a.size || 0)}</span></span>`).join('')}</div>`;
}

// 追加指示を送れる状態か（完了したタスクにも送れる。送ると、タスクは完了のまま、ファイルを変えずに話す）
function canSendFollow(c) {
  return !!c && (c.status === 'review' || c.status === 'failed' || c.status === 'done');
}

function drawFollowSkill() {
  const c = card(state.selected);
  const can = canSendFollow(c);
  renderSkillSlot('followSkill', state.followSkill, (v) => ((state.followSkill = v), drawFollowSkill()), { disabled: !can });
}

// 会話の入力欄にだけ、添付ファイルを付けられる（タスクの追加の指示には付けない）
const followAttach = attachField({
  box: $('followAttach'),
  input: $('followInput'),
  drop: $('detailFoot'),
  enabled: () => {
    const c = card(state.selected);
    return isChat(c) && canSendFollow(c);
  },
});

async function sendFollow() {
  const c = card(state.selected);
  const msg = $('followInput').value.trim();
  if (!c || !msg) return;
  const files = isChat(c) ? followAttach.list() : [];
  const ok = await run(() => api.send(c.id, msg, state.followSkill, files.length ? files : undefined).then(() => true));
  if (ok) {
    $('followInput').value = '';
    followAttach.clear();
    state.followSkill = null; // スキルはその1回だけ
    drawFollowSkill();
  }
}
$('followBtn').onclick = sendFollow;
$('followInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendFollow();
});

// ---------------- モーダル ----------------

function openModal(html, onReady) {
  state.chatListOpen = false;
  $('modalBox').innerHTML = html;
  $('modal').classList.remove('hidden');
  onReady?.();
}
function closeModal() {
  $('modal').classList.add('hidden');
  state.chatListOpen = false;
}
$('modal').addEventListener('mousedown', (e) => {
  if (e.target === $('modal')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('skillPicker').classList.contains('hidden')) $('skillPicker').classList.add('hidden');
  else if (!$('modal').classList.contains('hidden')) closeModal();
  else if (state.selected) closeDetail();
});

// エージェントの注意書き（Claude Code 以外は、CLI の作りの都合でできないことがある）
function agentLimitHint(a) {
  return a === 'claude' ? '' : `${agentLabel(a)} は CLI の作りの都合で、カードでの承認・選択肢の質問・作業途中へのメッセージ差し込み・既存の会話の引き継ぎに対応していません（btw は終了後の追加指示として送られます）。権限は設定の権限モードに合わせて CLI 側で許可します。`;
}

// Pipelineと競争は排他。設定で選んだ方だけを使える（'relay' / 'compete' / 'none'＝どちらも使わない）
function orchestrationOf(s) {
  return s && (s.orchestration === 'compete' || s.orchestration === 'none') ? s.orchestration : 'relay';
}
// タスクを動かすエージェントを選ぶ欄（単独のエージェント / Pipelineか競争の、設定で選んだ方）。使う設定のエージェントだけ出す
// orchestration: false なら、1つのエージェントだけを選ぶ（会話など）
function agentFieldHtml(idp, value, { orchestration = true } = {}) {
  const s = state.board.settings;
  const on = enabledAgents(s);
  const orch = orchestration ? orchestrationOf(s) : 'none';
  const steps = s.relaySteps || [];
  const relayOff = !steps.length || steps.some((x) => !on.includes(x.agent));
  const comp = (s.competeAgents || []).filter((a) => on.includes(a));
  // 設定でPipeline・競争を選んでいれば、それを最初から選んでおく（使えない状態なら、最初から選んでおくエージェント）
  const orchUsable = (orch === 'relay' && !relayOff) || (orch === 'compete' && comp.length >= 2);
  const v = value || (orchUsable ? orch : defaultAgent(s));
  const opt = (val, label, disabled) => `<option value="${val}" ${val === v && !disabled ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</option>`;
  const single = AGENTS.filter(([a]) => on.includes(a)).map(([a, l]) => opt(a, l)).join('');
  if (orch === 'none') return `<label class="field"><span>エージェント</span><select id="${idp}Agent">${single}</select><small id="${idp}AgentHint" class="muted"></small></label>`;
  const stepsLabel = steps.map((x) => `${x.label}(${agentShort(x.agent)})`).join(' → ') || '未設定';
  return `<label class="field"><span>エージェント</span>
    <select id="${idp}Agent">
      <optgroup label="1つのエージェントで動かす">${single}</optgroup>
      <optgroup label="オーケストレーション">
        ${orch === 'relay'
          ? opt('relay', `Pipeline: ${stepsLabel}${relayOff ? '（設定で工程のエージェントを使う設定にしてください）' : ''}`, relayOff)
          : opt('compete', comp.length >= 2 ? `競争: ${comp.map(agentShort).join('・')} で同じタスクを解いて比べる` : '競争（設定で使うエージェントを2つ以上選んでください）', comp.length < 2)}
      </optgroup>
    </select>
    <small id="${idp}AgentHint" class="muted"></small></label>`;
}
// onChange(agent): 選び直したときに呼ぶ（会話の欄の出し分けなど）
function bindAgentField(idp, onChange) {
  const sel = $(`${idp}Agent`);
  const hint = () => {
    const v = sel.value;
    $(`${idp}AgentHint`).textContent =
      v === 'relay' ? '同じ worktree で、設定の工程の順にエージェントが作業を引き継ぎます（前の工程の報告を次に渡します）。工程は「設定」で変えられます。'
      : v === 'compete' ? 'エージェントごとにカードと worktree を作って並列に解きます。終わったら差分を見比べ、よい案を採用してマージします。'
      : agentLimitHint(v);
    onChange?.(v);
  };
  sel.onchange = hint;
  hint();
}
// 既存の会話（Claude Code の会話）を選べるのは、最初に動くのが Claude Code のときだけ
function firstAgentOf(v) {
  const s = state.board.settings;
  if (v === 'relay') return ((s.relaySteps || [])[0] || {}).agent || 'claude';
  if (v === 'compete') return (s.competeAgents || []).includes('claude') ? 'claude' : '';
  return v;
}
function toggleSessionField(idp, agent) {
  const box = $(`${idp}Session`)?.closest('.field');
  if (box) box.classList.toggle('hidden', agent !== 'claude');
}

function newTask(opts = {}) {
  if (!state.board.settings.repoPath) return chooseRepo();
  const from = opts.fromChat;
  const fromDone = from && !isChat(from);
  openModal(
    `<h2>${fromDone ? '修正タスク' : '新しいタスク'}</h2>
     ${from ? '' : taskModeTabsHtml('text')}
     ${fromDone ? `<p class="muted small">完了したタスク「${esc(from.title)}」の修正として、新しいタスクを始めます（元のタスクのやりとりをエージェントが引き継ぎます。元のタスクはそのまま残ります）。</p>`
     : from ? `<p class="muted small">会話「${esc(from.title)}」の続きとして、タスクを始めます（会話の内容をエージェントが引き継ぎます。会話そのものはそのまま残ります）。</p>` : ''}
     <label class="field"><span>タイトル（省略すると指示の1行目）</span><input id="nTitle" placeholder="例: ログイン画面にパスワード表示ボタンを追加" /></label>
     ${agentFieldHtml('n', from && enabledAgents().includes(agentOf(from)) ? agentOf(from) : undefined)}
     <div class="field"><span>エージェントへの指示</span><div id="nSkill" class="skill-slot"></div><textarea id="nPrompt" rows="10" placeholder="やってほしいことを具体的に書いてください。テストの実行方法なども書いておくと確実です。画像やファイルは貼り付け・ドラッグ＆ドロップでも添付できます。"></textarea><div id="nAttach" class="attach-bar"></div></div>
     ${sessionFieldHtml('n')}
     <label class="check"><input type="checkbox" id="nStart" checked /> 作成したらすぐに開始する</label>
     <div class="modal-actions"><button class="btn ghost" id="nCancel">キャンセル</button><button class="btn primary" id="nOk">作成（Ctrl/⌘ + Enter）</button></div>`,
    () => {
      if (!from) bindTaskModeTabs();
      $('nPrompt').focus();
      if (from) $('nPrompt').value = fromDone ? '完了したタスクの内容をもとに、次の点を修正してください。\n\n' : 'ここまでの会話の内容をもとに、作業を進めてください。';
      if (fromDone) $('nTitle').value = `修正: ${from.title}`;
      // Claude Code の会話なら会話そのものを引き継ぐ。それ以外の会話・完了したタスクは、やりとりを指示に添えて渡す
      const fromClaude = from && !fromDone && agentOf(from) === 'claude';
      fillSessionField('n', fromClaude ? { id: from.sessionId, title: `会話: ${from.title}` } : undefined);
      bindAgentField('n', (v) => toggleSessionField('n', fromClaude || !from ? firstAgentOf(v) : ''));
      let skill = state.board.settings.defaultSkill || null;
      const drawSkill = () => renderSkillSlot('nSkill', skill, (v) => ((skill = v), drawSkill()));
      drawSkill();
      const att = attachField({ box: $('nAttach'), input: $('nPrompt'), drop: $('nPrompt').closest('.field') });
      const submit = async () => {
        const files = att.list();
        const id = await runBusy('タスクを作成しています…', () => api.createCard({ title: $('nTitle').value, prompt: $('nPrompt').value, autoStart: $('nStart').checked, session: readSessionField('n'), skill, agent: $('nAgent').value, fromChat: from ? from.id : undefined, attachments: files.length ? files : undefined }));
        if (id) {
          closeModal();
          selectNew(id);
        }
      };
      $('nOk').onclick = submit;
      $('nCancel').onclick = closeModal;
      $('nPrompt').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
      });
    },
  );
}

// 新しいタスクの作り方（自然言語で書く / GitHub の Issue から）を切り替えるタブ
function taskModeTabsHtml(active) {
  const tab = (mode, label) => `<button type="button" class="tab ${mode === active ? 'active' : ''}" data-task-mode="${mode}" role="tab" aria-selected="${mode === active}">${label}</button>`;
  return `<nav class="tabs task-mode-tabs" role="tablist">${tab('text', '自然言語で作成')}${tab('issue', 'GitHub Issue から作成')}</nav>`;
}
function bindTaskModeTabs() {
  document.querySelectorAll('#modalBox [data-task-mode]').forEach((b) => {
    b.onclick = () => {
      if (b.classList.contains('active')) return;
      if (b.dataset.taskMode === 'issue') openIssueModal();
      else newTask();
    };
  });
}

// 「会話」ボタン: 会話の一覧を出す（会話がまだなければ、すぐに新しい会話を始める）
function openChats() {
  if (!state.board.settings.repoPath) return chooseRepo();
  if (!state.board.cards.some(isChat)) return newChat();
  openModal('<div id="chatList"></div>');
  state.chatListOpen = true;
  drawChatList();
}

function drawChatList() {
  const box = $('chatList');
  if (!box) return;
  const chats = state.board.cards.filter(isChat).sort(byAttention);
  box.innerHTML = `<h2>${icon('chat')}会話</h2>
    <p class="muted small">タスクを作らずに、このリポジトリについてエージェントと話した会話です。選ぶと開きます。</p>
    <div class="chat-list">${chats.map(cardHtml).join('') || '<div class="col-empty">会話はまだありません</div>'}</div>
    <div class="modal-actions"><button class="btn ghost" id="chatListClose">閉じる</button><button class="btn primary" id="chatListNew">＋ 新しい会話</button></div>`;
  $('chatListClose').onclick = closeModal;
  $('chatListNew').onclick = newChat;
}

// 会話の一覧の中のカードも、ボードと同じように操作できる（承認・質問への回答・再開・開く）
$('modalBox').addEventListener('click', (e) => {
  if (!state.chatListOpen || !e.target.closest('.chat-list')) return;
  boardClick(e);
});

// タスクに紐づかない会話を始める（worktree を作らず、リポジトリのフォルダでそのまま話す）
function newChat() {
  if (!state.board.settings.repoPath) return chooseRepo();
  openModal(
    `<h2>${icon('chat')}会話を始める</h2>
     <p class="muted small">タスクを作らずに、このリポジトリについてエージェントと話せます（質問・調べもの・相談など）。worktree やブランチは作らず、コミットやマージもしません。</p>
     ${agentFieldHtml('c', undefined, { orchestration: false })}
     <div class="field"><span>メッセージ</span><div id="cSkill" class="skill-slot"></div><textarea id="cMsg" rows="6" placeholder="例: このリポジトリの全体の構成を教えて（画像やファイルは貼り付け・ドラッグ＆ドロップでも添付できます）"></textarea><div id="cAttach" class="attach-bar"></div></div>
     <label class="field"><span>タイトル（省略するとメッセージの1行目）</span><input id="cTitle" /></label>
     ${sessionFieldHtml('c')}
     <p class="muted small">会話はリポジトリのフォルダ（手元の作業中のファイル）でそのまま動くので、ファイルの変更やコマンドは毎回カードで確かめます。作業してほしくなったら、詳細画面の「タスクにする」で会話の続きからタスクを作れます。</p>
     <div class="modal-actions"><button class="btn ghost" id="cCancel">キャンセル</button><button class="btn primary" id="cOk">話しかける（Ctrl/⌘ + Enter）</button></div>`,
    () => {
      $('cMsg').focus();
      fillSessionField('c');
      bindAgentField('c', (v) => toggleSessionField('c', v));
      let skill = null;
      const drawSkill = () => renderSkillSlot('cSkill', skill, (v) => ((skill = v), drawSkill()));
      drawSkill();
      const att = attachField({ box: $('cAttach'), input: $('cMsg'), drop: $('cMsg').closest('.field') });
      const submit = async () => {
        const files = att.list();
        const id = await runBusy('会話を始めています…', () => api.createChat({ message: $('cMsg').value, title: $('cTitle').value, session: $('cAgent').value === 'claude' ? readSessionField('c') : { mode: 'new' }, skill, agent: $('cAgent').value, attachments: files.length ? files : undefined }));
        if (id) {
          closeModal();
          selectNew(id);
        }
      };
      $('cOk').onclick = submit;
      $('cCancel').onclick = closeModal;
      $('cMsg').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
      });
    },
  );
}

// ---------------- スキル ----------------
// スキルは1つだけ選べる。選んだスキルは、指示の入力欄の上にラベルで出す

const SKILL_SRC = { project: 'プロジェクト', user: '自分用', plugin: 'プラグイン' };
let skillCache = null;
async function getSkills(force) {
  if (!skillCache || force) skillCache = (await api.listSkills().catch(() => [])) || [];
  return skillCache;
}

// 入力欄の上のラベル。value はスキル名（なければ null）
function renderSkillSlot(slotId, value, onChange, opts = {}) {
  const el = $(slotId);
  if (!el) return;
  if (opts.disabled) {
    el.innerHTML = value ? `<span class="skill-chip off">${icon('zap')}/${esc(value)}</span>` : '';
    return;
  }
  el.innerHTML = value
    ? `<span class="skill-chip" title="このスキルを使って実行します">${icon('zap')}/${esc(value)}<button type="button" class="chip-x" title="スキルを外す">×</button></span><button type="button" class="btn small ghost skill-pick">変更</button>`
    : `<button type="button" class="btn small ghost skill-pick">${icon('zap')}スキルを選ぶ</button>`;
  const x = el.querySelector('.chip-x');
  if (x) x.onclick = () => onChange(null);
  el.querySelector('.skill-pick').onclick = () => openSkillPicker(value, onChange);
}

// カードの一覧から1つ選ぶ
async function openSkillPicker(current, onPick) {
  const box = $('skillPickerBox');
  box.innerHTML = '<div class="muted pad">スキルを読み込んでいます…</div>';
  $('skillPicker').classList.remove('hidden');
  const skills = await getSkills(true);
  const close = () => $('skillPicker').classList.add('hidden');
  const cardHtmlFor = (s) => `
    <button type="button" class="skill-card ${s.name === current ? 'selected' : ''}" data-skill="${esc(s.name)}">
      <span class="sk-top"><b class="sk-name">/${esc(s.name)}</b><span class="sk-src src-${s.source}">${SKILL_SRC[s.source] || s.source}</span></span>
      <span class="sk-desc">${esc(s.description || '（説明なし）')}</span>
    </button>`;
  const render = (q) => {
    const k = q.trim().toLowerCase();
    const list = k ? skills.filter((s) => (s.name + ' ' + s.description).toLowerCase().includes(k)) : skills;
    $('skGrid').innerHTML =
      `<button type="button" class="skill-card none ${!current ? 'selected' : ''}" data-skill=""><span class="sk-top"><b class="sk-name">スキルなし</b></span><span class="sk-desc">スキルを使わずに、指示だけで実行します</span></button>` +
      (list.map(cardHtmlFor).join('') || '<div class="muted pad">見つかりません</div>');
  };
  box.innerHTML = `
    <div class="sk-head"><h2>スキルを選ぶ</h2><button type="button" class="icon" id="skClose">✕</button></div>
    <p class="muted small">1つだけ選べます。選んだスキルは、Claude Code には指示の先頭に <code>/スキル名</code> として、ほかのエージェントには SKILL.md の場所を添えて渡します。</p>
    <input id="skSearch" placeholder="名前や説明で絞り込む" autocomplete="off" />
    <div class="skill-grid" id="skGrid"></div>
    ${skills.length ? '' : '<p class="muted small">使えるスキルが見つかりません。<code>.claude/skills/&lt;名前&gt;/SKILL.md</code>（このリポジトリ）か <code>~/.claude/skills/</code> に置くと、ここに出ます。</p>'}`;
  render('');
  $('skSearch').oninput = (e) => render(e.target.value);
  $('skSearch').focus();
  $('skClose').onclick = close;
  $('skGrid').onclick = (e) => {
    const b = e.target.closest('.skill-card');
    if (!b) return;
    close();
    onPick(b.dataset.skill || null);
  };
}
$('skillPicker').addEventListener('mousedown', (e) => {
  if (e.target === $('skillPicker')) $('skillPicker').classList.add('hidden');
});

// ---------------- 会話（セッション）を選ぶ ----------------

function fmtTime(ms) {
  const d = new Date(ms);
  const same = new Date().toDateString() === d.toDateString();
  return same ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// 「新しい会話」か「既存の会話を引き継ぐ」を選ぶ欄
function sessionFieldHtml(idp) {
  return `<label class="field"><span>会話（セッション）</span>
    <select id="${idp}Session"><option value="">新しい会話で始める</option><option disabled>過去の会話を読み込んでいます…</option></select>
    <small>過去の Claude Code の会話を選ぶと、その続きとして始めます（元の会話はそのまま残ります）。</small>
    <label class="check small"><input type="checkbox" id="${idp}AllSessions" /> ほかのフォルダの会話も表示</label></label>`;
}

async function fillSessionField(idp, selected) {
  const list = (await api.listSessions().catch(() => [])) || [];
  const selectedId = selected && typeof selected === 'object' ? selected.id : selected;
  // 選んでおきたい会話が一覧にまだ出ていなければ（保存の直後など）、先頭に足しておく
  if (selected && typeof selected === 'object' && selected.id && !list.some((x) => x.id === selected.id)) {
    list.unshift({ id: selected.id, title: selected.title || selected.id, updatedAt: Date.now(), related: true });
  }
  const sel = $(`${idp}Session`);
  if (!sel) return;
  const render = () => {
    const all = $(`${idp}AllSessions`) && $(`${idp}AllSessions`).checked;
    const related = list.filter((x) => x.related);
    const others = all ? list.filter((x) => !x.related).slice(0, 60) : [];
    const opt = (x) => `<option value="${esc(x.id)}" ${x.id === selectedId ? 'selected' : ''}>${esc(fmtTime(x.updatedAt))}  ${esc(x.title.slice(0, 70))}${all && !x.related ? `  — ${esc(x.cwd)}` : ''}</option>`;
    sel.innerHTML = `<option value="">新しい会話で始める</option>
      ${related.length ? `<optgroup label="このリポジトリの会話">${related.map(opt).join('')}</optgroup>` : '<option disabled>（このリポジトリの過去の会話はありません）</option>'}
      ${others.length ? `<optgroup label="ほかのフォルダの会話">${others.map(opt).join('')}</optgroup>` : ''}`;
  };
  sel._list = list;
  render();
  const cb = $(`${idp}AllSessions`);
  if (cb) cb.onchange = render;
}

function readSessionField(idp) {
  const sel = $(`${idp}Session`);
  if (!sel || !sel.value) return { mode: 'new' };
  const x = (sel._list || []).find((s) => s.id === sel.value);
  return { mode: 'resume', id: sel.value, title: x ? x.title : '' };
}

// 詳細画面から「既存の会話から選ぶ…」
function openSessionPicker(c) {
  openModal(
    `<h2>既存の会話を引き継ぐ</h2>
     <p class="muted small">「${esc(c.title)}」の次の実行を、選んだ会話の続きとして始めます。</p>
     ${sessionFieldHtml('p')}
     <div class="modal-actions"><button class="btn ghost" id="pCancel">キャンセル</button><button class="btn primary" id="pOk">この会話を使う</button></div>`,
    () => {
      fillSessionField('p');
      $('pCancel').onclick = closeModal;
      $('pOk').onclick = async () => {
        const sess = readSessionField('p');
        const ok = await run(() => api.setSession(c.id, sess).then(() => true));
        if (ok) {
          closeModal();
          toast(sess.mode === 'new' ? '次は新しい会話で始めます' : '次はこの会話の続きで始めます', 'ok');
        }
      };
    },
  );
}

// 詳細画面の「会話」欄
function sessionRowHtml(c) {
  const busy = c.status === 'running' || c.status === 'queued';
  const own = (c.sessions || []).filter((x) => x.origin === 'task' && (x.agent || 'claude') === agentOf(c));
  const imported = (c.sessions || []).find((x) => x.origin === 'imported' && x.id === c.sessionId && c.forkNext);
  const opts = [
    `<option value="__new__" ${!c.sessionId ? 'selected' : ''}>新しい会話で始める</option>`,
    ...own.map((x, i) => {
      const src = x.from && (c.sessions || []).find((y) => y.id === x.from);
      const label = src ? `← 引き継ぎ: ${src.label || src.id.slice(0, 8)}` : x.label || '';
      return `<option value="${esc(x.id)}" ${x.id === c.sessionId && !c.forkNext ? 'selected' : ''}>会話 ${i + 1}（${esc(fmtTime(x.at))}） ${esc(label)}</option>`;
    }),
    imported ? `<option value="${esc(imported.id)}" selected>引き継ぐ: ${esc(imported.label || imported.id.slice(0, 8))}</option>` : '',
    agentOf(c) === 'claude' ? `<option value="__pick__">既存の会話から選ぶ…</option>` : '',
  ].join('');
  return `<dt>会話</dt><dd><select id="dSession" class="d-session" ${busy ? 'disabled title="実行中は切り替えられません"' : ''}>${opts}</select>
</dd>`;
}

// ---------------- 会話（セッション）を消す ----------------

// タスクとは別に、Claude Code の会話を一覧して選んで消す
function openSessionManager() {
  openModal(
    `<h2>会話（セッション）を消す</h2>
     <p class="muted small">Claude Code の会話の記録（~/.claude/projects の中）を消します。消した会話は元に戻せず、続きから再開することもできません。実行中・待機中のタスクが使っている会話は消せません。</p>
     <div class="row sm-tools">
       <label class="check small"><input type="checkbox" id="smAll" /> ほかのフォルダの会話も表示</label>
       <label class="check small"><input type="checkbox" id="smToggle" /> 表示中をすべて選ぶ</label>
     </div>
     <div id="smList" class="sm-list muted small">会話を読み込んでいます…</div>
     <div class="modal-actions"><span id="smCount" class="muted small sm-count"></span><button class="btn ghost" id="smClose">閉じる</button><button class="btn danger" id="smDelete" disabled>選んだ会話を消す</button></div>`,
    async () => {
      let list = [];
      const picked = new Set();
      const visible = () => ($('smAll').checked ? list : list.filter((x) => x.related));
      const updateCount = () => {
        $('smCount').textContent = picked.size ? `${picked.size} 件を選択中` : '';
        $('smDelete').disabled = !picked.size;
      };
      const render = () => {
        const box = $('smList');
        if (!box) return;
        const rows = visible();
        if (!rows.length) {
          box.innerHTML = '<p class="muted small">（消せる会話はありません）</p>';
          updateCount();
          return;
        }
        box.innerHTML = rows
          .map((x) => {
            const used = x.usedBy || [];
            const busy = used.some((u) => u.busy);
            const tag = used.length ? `<span class="pill sm-used" title="${esc(used.map((u) => u.title).join('\n'))}">${busy ? '実行中のタスクで使用中' : `タスク「${esc(used[0].title.slice(0, 30))}」${used.length > 1 ? ` ほか ${used.length - 1} 件` : ''}`}</span>` : '';
            return `<label class="sm-row ${busy ? 'disabled' : ''}"><input type="checkbox" class="smPick" value="${esc(x.id)}" ${busy ? 'disabled' : ''} ${picked.has(x.id) ? 'checked' : ''} />
              <span class="sm-main"><span class="sm-title">${esc(x.title.slice(0, 100))}</span>
              <span class="sm-meta muted small">${esc(fmtTime(x.updatedAt))} · ${esc(x.branch || '')}${!x.related || $('smAll').checked ? ` · ${esc(x.cwd || '')}` : ''}</span></span>${tag}</label>`;
          })
          .join('');
        box.querySelectorAll('.smPick').forEach((cb) => {
          cb.onchange = () => {
            if (cb.checked) picked.add(cb.value);
            else picked.delete(cb.value);
            updateCount();
          };
        });
        updateCount();
      };
      const load = async () => {
        list = (await run(() => api.listSessions())) || [];
        for (const id of [...picked]) if (!list.some((x) => x.id === id)) picked.delete(id);
        render();
      };
      $('smClose').onclick = closeModal;
      $('smAll').onchange = () => {
        // 隠れた会話は選ばれたままにしない
        if (!$('smAll').checked) for (const x of list) if (!x.related) picked.delete(x.id);
        $('smToggle').checked = false;
        render();
      };
      $('smToggle').onchange = () => {
        for (const x of visible()) {
          if ((x.usedBy || []).some((u) => u.busy)) continue;
          if ($('smToggle').checked) picked.add(x.id);
          else picked.delete(x.id);
        }
        render();
      };
      $('smDelete').onclick = async () => {
        const ids = [...picked];
        const used = list.filter((x) => picked.has(x.id) && (x.usedBy || []).length).length;
        const msg = `選んだ ${ids.length} 件の会話を消しますか？\n消した会話は元に戻せません。${used ? `\n（${used} 件はタスクが使っています。そのタスクは次から新しい会話で始めます）` : ''}`;
        if (!confirm(msg)) return;
        const r = await runBusy('会話を消しています…', () => api.deleteSessions(ids));
        if (!r) return;
        picked.clear();
        $('smToggle').checked = false;
        toast(`${r.removed.length} 件の会話を消しました${r.skipped.length ? `（実行中で使っている ${r.skipped.length} 件は消していません）` : ''}`, 'ok');
        await load();
      };
      await load();
    },
  );
}

// ---------------- GitHub Issue から作る ----------------

// Issue 番号からカードを作る（上部の枠と、詳細ダイアログの両方から使う）
async function createFromIssues(numbers, extra, autoStart, session, skill, agent) {
  const r = await runBusy('Issue を読み込んでタスクを作成しています…', () => api.createFromIssues({ numbers, extra, autoStart, session, skill, agent }));
  if (!r) return false;
  if (r.errors.length) toast(r.errors.join('\n'));
  else toast(`${r.ids.length} 件のタスクを Issue から作りました`, 'ok');
  await refreshBoardFor(r.ids);
  if (r.ids.length === 1) select(r.ids[0]);
  return true;
}

// Issue から作成するダイアログ（Issue 番号・会話・追加の指示・gh の準備）
function openIssueModal(prefill = '') {
  if (!state.board.settings.repoPath) return chooseRepo();
  openModal(
    `<h2>新しいタスク</h2>
     ${taskModeTabsHtml('issue')}
     <label class="field"><span>Issue 番号（複数ならカンマかスペースで区切る。1つの Issue が1枚のカードになり、並列で動きます）</span>
       <input id="nNumbers" placeholder="例: 12 または 12, 15, 18" inputmode="numeric" value="${esc(prefill)}" /></label>
     <p class="muted small" id="nRepoInfo">リポジトリを確認しています…</p>
     <div id="ghPanel" class="gh-panel">gh（GitHub CLI）を確認しています…</div>
     ${agentFieldHtml('n')}
     ${sessionFieldHtml('n')}
     <div class="field"><span>追加の指示（任意・すべての Issue に付けます）</span><div id="nSkill" class="skill-slot"></div><textarea id="nExtra" rows="4" placeholder="例: 変更したらテストを追加して npm test で確認して"></textarea></div>
     <label class="check"><input type="checkbox" id="nStart" checked /> 作成したらすぐに開始する</label>
     <div class="modal-actions"><button class="btn ghost" id="nCancel">キャンセル</button><button class="btn primary" id="nOk">Issue からタスクを作成</button></div>`,
    () => {
      bindTaskModeTabs();
      $('nNumbers').focus();
      api.repoGithub().then(
        (g) => {
          const el = $('nRepoInfo');
          if (!el) return;
          if (!g || !g.slug) el.textContent = 'このリポジトリの origin が GitHub ではないため、Issue を読み込めません。';
          else el.textContent = `${g.slug.owner}/${g.slug.repo} の Issue を読み込みます。`;
        },
        () => {},
      );
      refreshGh();
      fillSessionField('n');
      bindAgentField('n', (v) => toggleSessionField('n', firstAgentOf(v)));
      let skill = state.board.settings.defaultSkill || null;
      const drawSkill = () => renderSkillSlot('nSkill', skill, (v) => ((skill = v), drawSkill()));
      drawSkill();
      const submit = async () => {
        $('nOk').disabled = true;
        $('nOk').textContent = 'Issue を読み込んでいます…';
        const ok = await createFromIssues($('nNumbers').value, $('nExtra').value, $('nStart').checked, readSessionField('n'), skill, $('nAgent').value);
        if (ok) return closeModal();
        $('nOk').disabled = false;
        $('nOk').textContent = 'Issue からタスクを作成';
      };
      $('nOk').onclick = submit;
      $('nCancel').onclick = closeModal;
      $('nNumbers').addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      $('nExtra').addEventListener('keydown', (e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit());
    },
  );
}

// マージ先を選ぶダイアログ
async function openMerge(c) {
  const info = (await run(() => api.repoInfo())) || { branches: [], current: '' };
  const others = info.branches.filter((b) => b !== c.branch);
  const normal = others.filter((b) => !b.startsWith('agent/'));
  const agentBranches = others.filter((b) => b.startsWith('agent/'));
  const def = c.lastMergeTarget && others.includes(c.lastMergeTarget) ? c.lastMergeTarget : c.baseBranch;
  const opt = (b) => `<option value="${esc(b)}" ${b === def ? 'selected' : ''}>${esc(b)}${b === c.baseBranch ? '（ベース）' : ''}${b === info.current ? '（チェックアウト中）' : ''}</option>`;
  openModal(
    `<h2>マージ</h2>
     <p class="muted">「${esc(c.title)}」のブランチ <code>${esc(c.branch)}</code> を、選んだブランチにマージします（--no-ff）。</p>
     <label class="field"><span>マージ先のブランチ</span>
       <select id="mTarget">
         ${normal.map(opt).join('')}
         ${agentBranches.length ? `<optgroup label="ほかのタスクのブランチ">${agentBranches.map(opt).join('')}</optgroup>` : ''}
         <option value="__new__">＋ 新しいブランチを作ってマージ…</option>
       </select></label>
     <label class="field hidden" id="mNewWrap"><span>新しいブランチの名前（${esc(c.baseBranch)} から作ります）</span><input id="mNew" placeholder="例: feature/login-improvements" /></label>
     <label class="check"><input type="checkbox" id="mPush" ${info.hasOrigin && state.board.settings.pushAfterMerge !== false ? 'checked' : ''} ${info.hasOrigin ? '' : 'disabled'} /> マージしたあと origin に push する（<code id="mPushTarget">origin/…</code> にも反映）</label>
     ${info.hasOrigin ? '' : '<p class="muted small">このリポジトリには origin がないので、ローカルのブランチにだけマージします。</p>'}
     <label class="check"><input type="checkbox" id="mKeep" /> マージ後もタスクを続ける（worktree とブランチを残す）</label>
     <p class="muted small" id="mHint"></p>
     <div class="modal-actions"><button class="btn ghost" id="mCancel">キャンセル</button><button class="btn primary" id="mOk">マージ</button></div>`,
    () => {
      const update = () => {
        const isNew = $('mTarget').value === '__new__';
        $('mNewWrap').classList.toggle('hidden', !isNew);
        const t = isNew ? $('mNew').value.trim() || '（新しいブランチ）' : $('mTarget').value;
        $('mPushTarget').textContent = `origin/${t}`;
        const pushText = $('mPush').checked ? `origin の最新を取り込んでからローカルの ${t} にマージし、origin/${t} に push します。` : `ローカルの ${t} にだけマージします（origin には push しません）。`;
        $('mHint').textContent = pushText + ($('mKeep').checked
          ? 'マージしたあとも、このタスクはレビュー列に残ります。'
          : `マージしたあと、worktree とブランチ ${c.branch} を削除して「完了」にします。`);
        if (isNew) $('mNew').focus();
      };
      $('mTarget').onchange = update;
      $('mKeep').onchange = update;
      $('mPush').onchange = update;
      $('mNew').oninput = update;
      update();
      $('mCancel').onclick = closeModal;
      $('mOk').onclick = async () => {
        const isNew = $('mTarget').value === '__new__';
        const target = isNew ? $('mNew').value.trim() : $('mTarget').value;
        if (!target) return toast('ブランチ名を入力してください');
        $('mOk').disabled = true;
        const push = $('mPush').checked;
        $('mOk').textContent = push ? 'マージして push しています…' : 'マージしています…';
        const res = await runBusy(push ? `${target} にマージして push しています…` : `${target} にマージしています…`, () => api.merge(c.id, { target, createNew: isNew, keep: $('mKeep').checked, push }));
        $('mOk').textContent = 'マージ';
        if (res && res.conflict) {
          closeModal();
          toast(`${target} とコンフリクトしたので、マージを中止しました。詳細画面から解消できます`);
          return;
        }
        if (res) toast(push ? `${target} にマージして origin/${target} に push しました` : `${target} にマージしました`, 'ok');
        const ok = !!res;
        $('mOk').disabled = false;
        if (ok) closeModal();
      };
    },
  );
}

// PR を作るダイアログ（設定で「PR を作成」を選んでいるとき）
async function openPr(c) {
  const info = (await run(() => api.repoInfo())) || { branches: [], current: '' };
  const others = info.branches.filter((b) => b !== c.branch);
  const normal = others.filter((b) => !b.startsWith('agent/'));
  const agentBranches = others.filter((b) => b.startsWith('agent/'));
  const def = c.prBase && others.includes(c.prBase) ? c.prBase : c.baseBranch;
  const opt = (b) => `<option value="${esc(b)}" ${b === def ? 'selected' : ''}>${esc(b)}${b === c.baseBranch ? '（ベース）' : ''}</option>`;
  const title = c.issue ? c.title.replace(/^#\d+\s*/, '') : c.title;
  const body = [c.issue ? `Closes #${c.issue.number}\n` : '', c.lastMessage ? `${c.lastMessage}\n` : '', '---\nAgent Kanban のタスクから作成しました。'].join('\n').trim();
  const updating = !!c.prUrl;
  openModal(
    `<h2>${updating ? 'PR を更新' : 'PR を作成'}</h2>
     <p class="muted">「${esc(c.title)}」のブランチ <code>${esc(c.branch)}</code> を origin に push して、${updating ? `開いている PR（${esc(c.prUrl)}）を更新します。` : 'GitHub にプルリクエストを作ります（gh を使います）。'}</p>
     <label class="field"><span>PR のマージ先（base）</span>
       <select id="pBase" ${updating ? 'disabled' : ''}>
         ${normal.map(opt).join('')}
         ${agentBranches.length ? `<optgroup label="ほかのタスクのブランチ">${agentBranches.map(opt).join('')}</optgroup>` : ''}
       </select></label>
     ${updating ? '' : `<label class="field"><span>タイトル</span><input id="pTitle" value="${esc(title)}" /></label>
     <label class="field"><span>本文</span><textarea id="pBody" rows="6">${esc(body)}</textarea></label>`}
     <label class="check"><input type="checkbox" id="pKeep" checked /> PR を作ったあともタスクを続ける（worktree とブランチを残す）</label>
     <p class="muted small" id="pHint"></p>
     <div class="modal-actions"><button class="btn ghost" id="pCancel">キャンセル</button><button class="btn primary" id="pOk">${updating ? 'push して更新' : 'PR を作成'}</button></div>`,
    () => {
      const update = () => {
        $('pHint').textContent = $('pKeep').checked
          ? 'レビューで直しが入ったら、追加指示を送ってからもう一度このボタンを押すと PR に反映されます。'
          : `PR を作ったあと、ローカルの worktree とブランチ ${c.branch} を削除して「完了」にします（origin のブランチと PR は残ります）。`;
      };
      $('pKeep').onchange = update;
      update();
      $('pCancel').onclick = closeModal;
      $('pOk').onclick = async () => {
        $('pOk').disabled = true;
        const r = await runBusy(updating ? 'push して PR を更新しています…' : 'push して PR を作成しています…', () =>
          api.createPr(c.id, {
            base: $('pBase').value,
            title: $('pTitle') ? $('pTitle').value : '',
            body: $('pBody') ? $('pBody').value : '',
            keep: $('pKeep').checked,
          }),
        );
        $('pOk').disabled = false;
        if (r) {
          closeModal();
          toast(r.created ? 'PR を作成しました' : 'PR を更新しました', 'ok');
          api.openExternal(r.url).catch(() => {});
        }
      };
    },
  );
}

// 設定の「使うエージェント」の1つ分。チェックを付けたときだけ、コマンド・モデルなどの欄を出す
function agentConfigHtml(a, s, body) {
  const on = enabledAgents(s).includes(a);
  return `<div class="agent-cfg ${on ? 'on' : ''}" data-agent="${a}">
    <label class="check agent-cfg-head"><input type="checkbox" class="sUse" value="${a}" ${on ? 'checked' : ''} /> ${agentIcon(a)}<b>${esc(agentLabel(a))}</b> を使う</label>
    <div class="agent-cfg-body" ${on ? '' : 'hidden'}>${body}</div></div>`;
}

// ---------------- RC設定（遠隔操作） ----------------

// RC設定で最後に選んだ側（host / client）。ホストとクライアントは排他なので、選んだ側の設定だけを出す
const RC_ROLE_KEY = 'rcRole';

function openRemoteSettings() {
  openModal(
    `<h2>RC設定（遠隔操作）</h2>
     <small class="muted s-note">作業する PC（ホスト。Mac でも Windows でも）のボードを、別の PC（クライアント）から操作できます。この PC の役割をホストかクライアントのどちらかに選んでください。ホストは 127.0.0.1 だけで待ち受けるので、SSH のポート転送を通してつなぎます（手順は README の「遠隔操作」）。</small>
     <div class="remote-box" id="rcBox">遠隔の状態を読み込み中…</div>
     <div class="modal-actions"><button class="btn primary" id="rcClose">閉じる</button></div>`,
    () => {
      // 操作側の SSH の鍵。作るのはこのアプリ、公開鍵をホストに登録するのはユーザー
      const copyBtn = (id, label = 'コピー') => `<button class="btn small" type="button" data-copy="${id}">${label}</button>`;
      const drawKey = async (st) => {
        const kb = $('rKeyBox');
        if (!kb) return;
        if (!st) {
          try {
            st = await api.remoteKeyStatus({ keyPath: $('rSshKey')?.value || '' });
          } catch (err) {
            kb.innerHTML = `<div class="warn">${esc(err.message)}</div>`;
            return;
          }
        }
        if (!$('rKeyBox')) return;
        if (!st.exists) {
          kb.innerHTML = `<div><strong>① SSH の鍵を作る</strong></div>
            <small class="muted">${esc(st.path)} にまだ鍵がありません。このアプリで ssh-keygen を動かして、パスフレーズなしの ed25519 の鍵を作ります（アプリからはパスフレーズを入力できないため）。</small>
            <div class="row"><button class="btn small primary" type="button" id="rGenKey">鍵を作る</button></div>`;
          $('rGenKey').onclick = async () => {
            const r = await runBusy('SSH の鍵を作っています…', () => api.remoteGenKey({ keyPath: $('rSshKey').value, sshPath: $('rSshPath').value }));
            if (!r) return;
            if ($('rSshKey')) $('rSshKey').value = r.path;
            toast(r.created ? '鍵を作りました。公開鍵のファイルをホストに渡して登録してください' : 'すでにある鍵を使います', 'ok');
            drawKey(r);
          };
          return;
        }
        if (!st.publicKey) {
          kb.innerHTML = `<div class="warn">鍵 ${esc(st.path)} はありますが、公開鍵（${esc(st.pubPath)}）が読めません。ターミナルで <code>ssh-keygen -y -f "${esc(st.path)}" &gt; "${esc(st.pubPath)}"</code> を実行して作り直してください。</div>`;
          return;
        }
        const cmd = st.commands || {};
        const user = $('rSshUser')?.value.trim() || '<ユーザー名>';
        const host = $('rSshHost')?.value.trim() || '<ホストの IP>';
        kb.innerHTML = `<div><strong>① SSH の鍵</strong>: ${esc(st.path)}（できています）</div>
          <div class="remote-key-row"><div class="remote-ssh" id="rPubKey">${esc(st.publicKey)}</div>${copyBtn('rPubKey', '公開鍵をコピー')}</div>
          <div><strong>② 公開鍵をホストに渡す</strong>（ここはご自身で行ってください）</div>
          <small class="muted">公開鍵のファイル <b>${esc(st.pubPath)}</b> を、USB・共有フォルダ・メールなどでホストの PC の好きな場所に置き、ホストの Agent Kanban の「RC設定」→「操作側の公開鍵を登録する」で選んで登録します。秘密鍵（${esc(st.path)}）は渡さないでください。アプリを使わずに登録するなら、ホストの OS に合ったコマンドをホストで実行します:</small>
          <div><small>ホストが Mac（ターミナルで）</small></div>
          <div class="remote-key-row"><div class="remote-ssh" id="rCmdMac">${esc(cmd.mac || '')}</div>${copyBtn('rCmdMac')}</div>
          <div><small>ホストが Windows で、ユーザーが管理者（ふつうの個人の PC。PowerShell を「管理者として実行」で）</small></div>
          <div class="remote-key-row"><div class="remote-ssh" id="rCmdWinAdmin">${esc(cmd.winAdmin || '')}</div>${copyBtn('rCmdWinAdmin')}</div>
          <div><small>ホストが Windows で、ユーザーが管理者ではない（PowerShell で）</small></div>
          <div class="remote-key-row"><div class="remote-ssh" id="rCmdWinUser">${esc(cmd.winUser || '')}</div>${copyBtn('rCmdWinUser')}</div>
          <div><strong>③ パスワードなしで入れるか確かめる</strong>（この PC のターミナルで。初回は yes と答えます）</div>
          <div class="remote-key-row"><div class="remote-ssh" id="rCmdCheck">${esc(`ssh -i "${st.path}" ${user}@${host} exit`)}</div>${copyBtn('rCmdCheck')}</div>`;
        kb.querySelectorAll('[data-copy]').forEach((b) => {
          b.onclick = () => navigator.clipboard.writeText($(b.dataset.copy).textContent).then(() => toast('コピーしました', 'ok'), () => toast('コピーできませんでした'));
        });
      };
      const drawRemote = async () => {
        const box = $('rcBox');
        if (!box) return;
        let rs;
        try {
          rs = await api.remoteStatus();
        } catch (err) {
          box.innerHTML = `<div class="warn">${esc(err.message)}</div>`;
          return;
        }
        // このマシンをホストにするときの接続先（操作側に入れてもらう値）と SSH サーバーの状態
        // ホストとクライアントは排他。動いている側があればそちらに固定し、なければ前回選んだ側（初回は接続履歴があればクライアント）
        const hostActive = !!rs.host.listening;
        const clientActive = !!(rs.client.connected || rs.client.reconnecting);
        const savedRole = localStorage.getItem(RC_ROLE_KEY);
        const role = hostActive
          ? 'host'
          : clientActive
            ? 'client'
            : savedRole === 'host' || savedRole === 'client'
              ? savedRole
              : (rs.client.history || []).length || rs.client.canResume
                ? 'client'
                : 'host';
        let hi = null;
        if (role === 'host') {
          try {
            hi = await api.remoteHostInfo();
          } catch {
            hi = null;
          }
        }
        const sshServerHowto = hi?.platform === 'win32'
          ? '「設定 → システム → オプション機能」で「OpenSSH サーバー」を追加し、管理者の PowerShell で <code>Start-Service sshd; Set-Service sshd -StartupType Automatic</code> を実行してください'
          : hi?.platform === 'darwin'
            ? '「システム設定 → 一般 → 共有 → リモートログイン」をオンにしてください'
            : 'SSH サーバー（sshd）を起動してください';
        const hostInfoBlock = hi
          ? `<div class="remote-ssh">操作側の「SSH の接続先」: ${hi.tailscaleIps.length ? esc(hi.tailscaleIps.join(' / ')) : `${esc(hi.hostname)}（Tailscale の IP が見つかりません。Tailscale が接続中か確かめてください）`}
    ユーザー名: ${esc(hi.user || '?')}
    SSH サーバー（ポート ${esc(hi.sshPort)}）: ${hi.sshServer ? '動いています' : '動いていません'}</div>
             ${hi.sshServer ? '' : `<div class="warn">このマシンの SSH サーバーが動いていないので、操作側からつなげません。${sshServerHowto}</div>`}
             <div class="remote-key" id="rHostKeyBox">
               <div><strong>操作側の公開鍵を登録する</strong></div>
               <small class="muted">操作側の RC設定で作った公開鍵（agent-kanban_ed25519.pub）を、USB・共有フォルダ・メールなどでこの PC の好きな場所に置き、ここで選んで「登録する」を押すと、SSH で入れるように設定します（${hi.platform === 'win32' ? '管理者のユーザーは C:\\ProgramData\\ssh\\administrators_authorized_keys、それ以外は ~/.ssh/authorized_keys' : '~/.ssh/authorized_keys'} に足します）。</small>
               <div class="remote-key-row"><div class="remote-ssh" id="rHostPubPath">（まだ選んでいません）</div><button class="btn small" type="button" id="rPickPub">ファイルを選択…</button></div>
               <div id="rHostPubInfo"></div>
               <div class="row"><button class="btn small primary" type="button" id="rInstallPub" disabled>登録する</button></div>
             </div>`
          : '';
        const port = rs.host.port || 17831;
        const ssh = `ssh -L ${port}:127.0.0.1:${port} <user>@<host>`;
        const hostBlock = rs.host.listening
          ? `<div><strong>ホストとして待ち受け中</strong>（ポート ${esc(port)}・接続 ${rs.host.clients || 0}・ペア済み ${rs.host.pairedCount || 0}）</div>
             <div>ペアリングコード: <span class="pair-code">${rs.host.pairCode ? esc(rs.host.pairCode) : '（期限切れ・再発行してください）'}</span></div>
             <div class="row">
               <button class="btn small" type="button" id="rRefreshPair">コードを再発行</button>
               <button class="btn small" type="button" id="rClearPairs">ペアを破棄</button>
               <button class="btn small danger" type="button" id="rStopHost">ホストを停止</button>
             </div>
             <div><small class="muted">操作側の「クライアント」で「SSH 経由」を選び、下の接続先とユーザー名を入れて接続します。自分でトンネルを張るなら:</small><div class="remote-ssh">${esc(ssh)}</div></div>
             ${hostInfoBlock}`
          : `<div><strong>ホスト（作業側）</strong></div>
             <label class="field"><span>待ち受けポート</span><input id="rHostPort" type="number" min="1024" max="65535" value="${esc(port)}" /></label>
             <button class="btn small primary" type="button" id="rStartHost">ホストを開始（ペアリングコードを出す）</button>
             <div><small class="muted">開始後、操作側の「クライアント」で「SSH 経由」を選び、下の接続先とユーザー名・コードで接続します（このマシンの SSH サーバーをオンにしておいてください）。自分でトンネルを張るなら:</small><div class="remote-ssh">${esc(ssh)}</div></div>
             ${hostInfoBlock}`;
        const c = rs.client;
        const viaSsh = c.mode !== 'direct';
        const targetText = viaSsh ? `SSH 経由 ${esc(c.sshUser ? `${c.sshUser}@` : '')}${esc(c.sshHost)}（ホストのポート ${esc(c.port)}）` : `${esc(c.host)}:${esc(c.port)}`;
        const resumeBlock = c.reconnecting
          ? `<div class="remote-key"><div><strong>前回の接続を再開しています…</strong>（${esc(c.reconnecting.attempt)}/${esc(c.reconnecting.max)} 回目） → ${targetText}</div>
               ${c.reconnecting.lastError ? `<small class="muted">前回の失敗: ${esc(c.reconnecting.lastError)}</small>` : ''}
               <div><button class="btn small" type="button" id="rCancelResume">再開をやめる</button></div></div>`
          : '';
        // これまでつないだ接続先のカード。押すと、その接続先と保存したトークンでつなぐ
        const history = c.history || [];
        const connTitle = (h) => (h.mode === 'direct' ? `${h.host}:${h.port}` : `${h.sshUser ? `${h.sshUser}@` : ''}${h.sshHost}`);
        const connSub = (h) => (h.mode === 'direct' ? `直接・${h.host}:${h.port}` : `SSH 経由${h.sshPort && h.sshPort !== 22 ? `（ポート ${h.sshPort}）` : ''}・ホストのポート ${h.port}`);
        const historyBlock = history.length
          ? `<div class="remote-key"><div><strong>これまでの接続</strong>（カードを押すと、保存したトークンでつなぎます）</div>
               ${c.resumeError ? `<div class="warn">つながりませんでした: ${esc(c.resumeError)}</div>` : ''}
               <div class="rc-conn-list">${history
                 .map((h) => {
                   const last = h.id === c.currentId;
                   return `<div class="rc-conn-card${last ? ' last' : ''}${h.hasToken ? '' : ' no-token'}">
                     <button class="rc-conn-main" type="button" data-conn="${esc(h.id)}" ${h.hasToken ? '' : 'disabled'} title="${h.hasToken ? 'この接続先につなぐ' : 'トークンがないので、6 桁のコードでペアリングし直してください'}">
                       <span class="rc-conn-title">${h.hasToken ? '↻ ' : ''}${esc(connTitle(h))}${last ? '<span class="rc-conn-badge">前回</span>' : ''}</span>
                       <span class="rc-conn-sub">${esc(connSub(h))}</span>
                       <span class="rc-conn-sub">${h.hasToken ? (h.lastConnectedAt ? `最後の接続: ${esc(timeAgo(h.lastConnectedAt))}` : '以前の版で接続') : 'コードでのペアリングが必要'}</span>
                     </button>
                     <button class="rc-conn-forget" type="button" data-forget="${esc(h.id)}" title="この接続を一覧から消す（トークンも忘れます）">×</button>
                   </div>`;
                 })
                 .join('')}</div>
               <small class="muted">新しい接続先につなぐときや、接続先を直すときは、下の欄を入れて接続します。</small></div>`
          : '';
        const legacyResume = !c.reconnecting && c.canResume && !history.some((h) => h.id === c.currentId)
            ? `<div class="remote-key"><div><strong>前回の接続</strong> → ${targetText}</div>
                 ${c.resumeError ? `<div class="warn">つながりませんでした: ${esc(c.resumeError)}</div>` : ''}
                 <div><button class="btn small primary" type="button" id="rResume">↻ 前回の接続を再開</button></div>
                 <small class="muted">接続先を変えるときは、下の欄を直して「保存したトークンで接続」を押します。</small></div>`
            : '';
        const clientBlock = c.connected
          ? `<div><strong>クライアントとして接続中</strong> → ${targetText}</div>
             <small class="muted">アプリを終了しても、次に起動したときにこの接続を自動で再開します（回線が切れたときも、つなぎ直します）。「切断」を押すと、次からは自動で再開しません。</small>
             <button class="btn small danger" type="button" id="rDisconnect">切断してローカルボードに戻る</button>`
          : `<div><strong>クライアント（操作側）</strong></div>
             ${resumeBlock}
             ${historyBlock}
             ${legacyResume}
             <label class="field"><span>接続方法</span>
               <select id="rClientMode">
                 <option value="ssh" ${viaSsh ? 'selected' : ''}>SSH 経由（アプリがトンネルを張る・おすすめ）</option>
                 <option value="direct" ${viaSsh ? '' : 'selected'}>直接（自分で張ったトンネルの 127.0.0.1 などへ）</option>
               </select>
             </label>
             <div id="rSshFields" ${viaSsh ? '' : 'hidden'}>
               <div class="row">
                 <label class="field"><span>SSH の接続先（Tailscale の IP・名前など）</span><input id="rSshHost" placeholder="100.x.x.x / マシン名" value="${esc(c.sshHost || '')}" /></label>
                 <label class="field"><span>ユーザー名（ホストのログイン名）</span><input id="rSshUser" placeholder="kazuya" value="${esc(c.sshUser || '')}" /></label>
                 <label class="field"><span>SSH ポート</span><input id="rSshPort" type="number" min="1" max="65535" value="${esc(c.sshPort || 22)}" /></label>
               </div>
               <div class="row">
                 <label class="field"><span>鍵ファイル（空ならこのアプリで作る ~/.ssh/agent-kanban_ed25519）</span><input id="rSshKey" placeholder="~/.ssh/agent-kanban_ed25519" value="${esc(c.sshKey || '')}" /></label>
                 <label class="field"><span>ssh コマンド</span><input id="rSshPath" value="${esc(c.sshPath || 'ssh')}" /></label>
               </div>
               <small class="muted">SSH は鍵で入れる必要があります（パスワードは入力できません）。ホスト側で SSH サーバーをオンにしてください（Mac は「リモートログイン」、Windows は「OpenSSH サーバー」）。接続先とユーザー名は、ホストの Agent Kanban のこの画面に出ています。</small>
               <div class="remote-key" id="rKeyBox">SSH の鍵を確かめています…</div>
             </div>
             <div class="row">
               <label class="field" id="rClientHostField" ${viaSsh ? 'hidden' : ''}><span>接続先ホスト</span><input id="rClientHost" value="${esc(c.host || '127.0.0.1')}" /></label>
               <label class="field"><span>ホストの待ち受けポート</span><input id="rClientPort" type="number" min="1024" max="65535" value="${esc(c.port || 17831)}" /></label>
             </div>
             <label class="field"><span>ペアリングコード（初回のみ。トークンがあれば空で再接続）</span><input id="rPairCode" placeholder="6桁" maxlength="8" /></label>
             <div class="row">
               <button class="btn small primary" type="button" id="rConnect">${c.hasToken ? '保存したトークンで接続' : 'コードでペアリング'}</button>
               ${c.hasToken ? '<button class="btn small" type="button" id="rForgetToken">トークンを忘れる</button>' : ''}
             </div>
             <small class="muted" id="rDirectHint" ${viaSsh ? 'hidden' : ''}>直接のときは、先に <code>${esc(ssh)}</code> を張り、接続先ホストは 127.0.0.1 のままにします（ホストは 127.0.0.1 でしか待ち受けないので、Tailscale の IP を直接入れてもつながりません）</small>`;
        const roleTab = (r, label, lockedBy) =>
          `<button class="mtab${role === r ? ' active' : ''}" type="button" data-rc-role="${r}" ${lockedBy ? `disabled title="${esc(lockedBy)}"` : ''}>${label}</button>`;
        const roleTabs = `<div class="mtabs rc-role-tabs">
            ${roleTab('host', 'ホスト（作業側）', clientActive ? 'クライアントとして接続中は選べません。先に切断してください' : '')}
            ${roleTab('client', 'クライアント（操作側）', hostActive ? 'ホストとして待ち受け中は選べません。先にホストを停止してください' : '')}
          </div>`;
        const lockNote = hostActive
          ? '<small class="muted">ホストとして待ち受け中なので、クライアントには切り替えられません（ホストを停止すると選べます）。</small>'
          : clientActive
            ? '<small class="muted">クライアントとして接続中なので、ホストには切り替えられません（切断すると選べます）。</small>'
            : '';
        box.innerHTML = `${roleTabs}${lockNote}${role === 'host' ? hostBlock : clientBlock}`;
        box.querySelectorAll('[data-rc-role]').forEach((b) => {
          b.onclick = () => {
            if (b.disabled || b.dataset.rcRole === role) return;
            localStorage.setItem(RC_ROLE_KEY, b.dataset.rcRole);
            drawRemote();
          };
        });
        const busy = (label, fn) => runBusy(label, fn).then((ok) => { if (ok !== undefined) drawRemote(); });
        if ($('rStartHost')) $('rStartHost').onclick = () => busy('ホストを開始しています…', () => api.remoteStartHost({ port: $('rHostPort').value }));
        if ($('rStopHost')) $('rStopHost').onclick = () => busy('ホストを停止しています…', () => api.remoteStopHost());
        if ($('rRefreshPair')) $('rRefreshPair').onclick = () => busy('コードを発行しています…', () => api.remoteRefreshPair());
        if ($('rClearPairs')) $('rClearPairs').onclick = () => {
          if (!confirm('ペアリング済みのクライアントをすべて無効にしますか？')) return;
          busy('ペアを破棄しています…', () => api.remoteClearPairs());
        };
        if ($('rClientMode')) $('rClientMode').onchange = () => {
          const ssh = $('rClientMode').value === 'ssh';
          $('rSshFields').hidden = !ssh;
          $('rClientHostField').hidden = ssh;
          $('rDirectHint').hidden = ssh;
        };
        if ($('rConnect')) $('rConnect').onclick = () => {
          const mode = $('rClientMode').value;
          if (mode === 'ssh' && !$('rSshHost').value.trim()) return toast('SSH の接続先（Tailscale の IP か名前）を入れてください');
          busy(mode === 'ssh' ? 'SSH トンネルを張って接続しています…' : '接続しています…', () =>
            api.remoteConnect({
              mode,
              host: $('rClientHost').value,
              port: $('rClientPort').value,
              code: $('rPairCode').value.trim(),
              sshHost: $('rSshHost').value,
              sshUser: $('rSshUser').value,
              sshPort: $('rSshPort').value,
              sshKey: $('rSshKey').value,
              sshPath: $('rSshPath').value,
            }),
          );
        };
        // ホスト側: 受け取った公開鍵ファイルを選んで登録する
        let pickedPub = null;
        if ($('rPickPub')) $('rPickPub').onclick = async () => {
          const r = await runBusy('公開鍵を読み込んでいます…', () => api.remotePickPubKey());
          if (!r) return;
          pickedPub = r;
          $('rHostPubPath').textContent = r.path;
          $('rHostPubInfo').innerHTML = `<small class="muted">鍵: ${esc(r.type)}${r.comment ? `（${esc(r.comment)}）` : ''}</small>`;
          $('rInstallPub').disabled = false;
        };
        if ($('rInstallPub')) $('rInstallPub').onclick = async () => {
          if (!pickedPub) return toast('公開鍵のファイルを選んでください');
          const r = await runBusy('公開鍵を登録しています…', () => api.remoteInstallPubKey({ path: pickedPub.path }));
          if (!r) return;
          $('rHostPubInfo').innerHTML = `<div class="ok-note">${r.added ? '登録しました' : 'この鍵はもう登録されています'}: ${esc(r.file)}<br />操作側で「SSH 経由」・接続先・ユーザー名（下の値）を入れて接続できます。</div>`;
          toast(r.added ? '公開鍵を登録しました' : 'この鍵はもう登録されています', 'ok');
        };
        if ($('rKeyBox')) {
          drawKey();
          // 鍵ファイルの欄を変えたら、その鍵を見直す
          $('rSshKey').onchange = () => drawKey();
        }
        if ($('rResume')) $('rResume').onclick = () => busy(viaSsh ? 'SSH トンネルを張って、前回の接続を再開しています…' : '前回の接続を再開しています…', () => api.remoteResume());
        box.querySelectorAll('[data-conn]').forEach((b) => {
          b.onclick = () => {
            const h = history.find((x) => x.id === b.dataset.conn);
            busy(h?.mode === 'direct' ? `${connTitle(h)} につないでいます…` : `SSH トンネルを張って、${h ? connTitle(h) : ''} につないでいます…`, () => api.remoteResume({ id: b.dataset.conn }));
          };
        });
        box.querySelectorAll('[data-forget]').forEach((b) => {
          b.onclick = () => {
            const h = history.find((x) => x.id === b.dataset.forget);
            if (!confirm(`「${h ? connTitle(h) : b.dataset.forget}」を、これまでの接続から消しますか？（保存したトークンも忘れます）`)) return;
            busy('接続を消しています…', () => api.remoteForgetConnection({ id: b.dataset.forget }));
          };
        });
        if ($('rCancelResume')) $('rCancelResume').onclick = () => busy('再開をやめています…', () => api.remoteCancelResume());
        if ($('rDisconnect')) $('rDisconnect').onclick = () => busy('切断しています…', () => api.remoteDisconnect());
        if ($('rForgetToken')) $('rForgetToken').onclick = () => busy('トークンを消しています…', () => api.remoteForgetToken());
      };
      drawRemote();
      // 裏での再開が始まった・つながった・あきらめたときは、開いている RC設定も描き直す
      remoteDialogRedraw = drawRemote;
      $('rcClose').onclick = closeModal;
    },
  );
}

async function openSettings() {
  const s = state.board.settings;
  // ブランチ一覧は git を何回も起動するので（Windows だと遅い）、待たずにモーダルを開いてから後で入れる
  const baseOptions = (info) =>
    `<option value="">チェックアウト中のブランチ${info.current ? `（今は ${esc(info.current)}）` : ''}</option>` +
    [...new Set([...(s.baseBranch ? [s.baseBranch] : []), ...info.branches])]
      .map((b) => `<option ${b === s.baseBranch ? 'selected' : ''}>${esc(b)}</option>`)
      .join('');
  openModal(
    `<h2>設定</h2>
     <label class="field"><span>ベースブランチ（worktree の作成元・マージ先）</span>
       <select id="sBase">${baseOptions({ branches: [], current: '' })}</select></label>
     <label class="field"><span>レビュー後の取り込み方</span>
       <select id="sIntegration">
         <option value="merge" ${s.integration !== 'pr' ? 'selected' : ''}>直接マージする（ローカルで git merge）</option>
         <option value="pr" ${s.integration === 'pr' ? 'selected' : ''}>PR を作成する（origin に push して gh pr create）</option>
       </select>
       <small>レビュー中のタスクに出るボタンが「マージ」か「PR を作成」に変わります。PR の作成には gh のインストールとログインが必要です。</small></label>
     <label class="field"><span>ブランチの命名規則（自然言語で書けます）</span>
       <textarea id="sBranchRule" rows="2" placeholder="例: feature/<Issue番号>-<内容を表す短い英語> にする。Issue がないときは feature/<内容を表す短い英語>">${esc(s.branchNamingRule || '')}</textarea>
       <small>書いておくと、タスクの開始時にそのタスクのエージェントがこの規則に従ってブランチ名を考えます。空なら agent/issue-12-xxxx のような名前になります。決められなかったときも、この名前になります。</small></label>
     <div class="field">
       <label class="check"><input type="checkbox" id="sIssueSync" ${s.issueStatusSync !== false ? 'checked' : ''} /> Issue のステータスを自動で変える（GitHub Projects）</label>
       <small>Issue から作ったタスクが「実行中」になると In progress、「レビュー」になると In review、マージして「完了」になると Done に、Issue が入っている Project の Status を変えます。gh に project の権限が必要です。</small>
       <div class="status-map" id="sStatusMap" ${s.issueStatusSync !== false ? '' : 'hidden'}>
         <label class="field"><span>変える項目（Project の単一選択フィールド名。空なら Status）</span><input id="sStatusField" placeholder="Status" value="${esc(s.statusFieldName || '')}" /></label>
         <div class="row">
           <label class="field"><span>実行中 →</span><input id="sMapProgress" placeholder="自動（In progress など）" value="${esc((s.statusMapping || {}).inProgress || '')}" /></label>
           <label class="field"><span>レビュー →</span><input id="sMapReview" placeholder="自動（In review など）" value="${esc((s.statusMapping || {}).inReview || '')}" /></label>
           <label class="field"><span>完了 →</span><input id="sMapDone" placeholder="自動（Done など）" value="${esc((s.statusMapping || {}).done || '')}" /></label>
         </div>
         <small>列ごとに使う選択肢の名前を指定できます（カンマ区切りで候補を複数書けます。大文字小文字・絵文字・記号は無視して比べます）。空の列は名前から自動で探します。</small>
       </div>
       <div id="ghPanel" class="gh-panel">gh（GitHub CLI）を確認しています…</div></div>
     <label class="field"><span>権限モード</span>
       <select id="sMode">${PERMISSION_MODES.map(([v, l]) => `<option value="${v}" ${v === s.permissionMode ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
       <small>自動で許可されない操作は、カードに「承認待ち」として表示されます。</small></label>
     <label class="field"><span>同時に動かす数</span><input id="sMax" type="number" min="1" max="10" value="${esc(s.maxParallel)}" /></label>
     <div class="field"><span>新しいタスクで最初から選んでおくスキル</span><div id="sSkill" class="skill-slot"></div>
       <small>「＋ 新しいタスク」（自然言語・Issue のどちらでも）を開いたときに、このスキルが選ばれた状態になります（その場で外したり変えたりできます）。</small></div>
     <label class="check"><input type="checkbox" id="sSpecCheck" ${s.specCheck !== false ? 'checked' : ''} /> 新しいタスクの内容が詰まっていなければ、開発を始める前にエージェントと対話して仕様を詰める</label>
     <label class="check"><input type="checkbox" id="sSuggestSkills" ${s.suggestSkillsOnDone !== false ? 'checked' : ''} /> タスクが完了したら、スキルにしないか通知で聞く（右上のベル）</label>
     <label class="check"><input type="checkbox" id="sDeleteSessions" ${s.deleteSessionsOnMerge !== false ? 'checked' : ''} /> マージして完了したら、そのタスクの作業に使った Claude Code の会話（セッション）を消す（引き継いだ元の会話は残します）</label>

     <h3 class="s-section">使うエージェント</h3>
     <small class="muted s-note">チェックを付けたエージェントだけ、コマンドとモデルを設定でき、タスク・会話・Pipeline・競争で選べます（1つ以上）。</small>
     ${agentConfigHtml('claude', s, `
       <div class="row">
         <label class="field"><span>claude コマンドのパス</span><input id="sClaude" value="${esc(s.claudePath || 'claude')}" /></label>
         <label class="field"><span>モデル（空なら既定）</span><input id="sModel" placeholder="例: sonnet / opus" value="${esc(s.model || '')}" /></label>
       </div>
       <label class="field"><span>最初から許可しておくツール（カンマか改行で区切る）</span>
         <textarea id="sAllowed" rows="2" placeholder="例: Bash(npm test:*), Bash(git status), WebSearch">${esc(s.allowedTools)}</textarea></label>
       <div class="row">
         <label class="field"><span>週間上限のリセット曜日（上部の「今週」の区切り）</span>
           <select id="sResetDay"><option value="">自動（Claude から届く日時を使う）</option>
           ${'日月火水木金土'.split('').map((d, i) => `<option value="${i}" ${String(s.weeklyResetDay) === String(i) ? 'selected' : ''}>${d}曜日</option>`).join('')}</select></label>
         <label class="field"><span>リセット時刻</span><input id="sResetTime" type="time" value="${esc(s.weeklyResetTime || '00:00')}" /></label>
       </div>
       <small class="field-note">Claude の使用状況（/usage）に出る週間上限のリセット日時に合わせます。自動のときは、Claude がリセット日時を知らせてくるまで月曜 0:00 で区切ります。</small>`)}
     ${agentConfigHtml('codex', s, `
       <div class="row">
         <label class="field"><span>codex コマンドのパス</span><input id="sCodex" value="${esc(s.codexPath || 'codex')}" /></label>
         <label class="field"><span>モデル（空なら既定）</span><input id="sCodexModel" placeholder="例: gpt-5-codex" value="${esc(s.codexModel || '')}" /></label>
       </div>`)}
     ${agentConfigHtml('gemini', s, `
       <div class="row">
         <label class="field"><span>gemini コマンドのパス</span><input id="sGemini" value="${esc(s.geminiPath || 'gemini')}" /></label>
         <label class="field"><span>モデル（空なら既定）</span><input id="sGeminiModel" placeholder="例: gemini-2.5-pro" value="${esc(s.geminiModel || '')}" /></label>
       </div>`)}
     ${agentConfigHtml('cursor', s, `
       <div class="row">
         <label class="field"><span>cursor-agent コマンドのパス</span><input id="sCursor" value="${esc(s.cursorPath || 'cursor-agent')}" /></label>
         <label class="field"><span>モデル（空なら既定）</span><input id="sCursorModel" placeholder="例: gpt-5 / sonnet-4.5" value="${esc(s.cursorModel || '')}" /></label>
       </div>`)}
     <small class="muted s-note">Claude Code は、自動で許可されない操作をカードで承認できます。Codex / Gemini / Cursor はカードでの承認に対応していないため、権限モードに合わせて CLI 側で許可します（計画だけ → 読み取りのみ、すべて自動で許可 → 確認なし、それ以外 → Codex は worktree の中だけ書ける sandbox・Gemini はファイル編集だけ自動で許可・Cursor は --force でファイル編集とコマンドを許可（Cursor の cli-config.json の deny は守られます））。</small>
     <label class="field"><span>新しいタスク・会話で最初から選んでおくエージェント</span>
       <select id="sDefaultAgent"></select>
       <small>オーケストレーションで Pipeline・競争を選んでいれば、タスクを作るときの「エージェント」の欄では、そちらを最初から選んでおきます（使えない状態のときや会話では、このエージェント）。競争の比較も、このエージェントに頼みます（スキルの提案は、元のタスクのエージェントが使えればそちらに頼みます）。</small></label>

     <h3 class="s-section">オーケストレーション</h3>
     <div class="field"><span>使うオーケストレーション（Pipelineと競争は、どちらか1つだけ使えます。使わないこともできます）</span>
       <div class="check-row">
         <label class="check"><input type="radio" name="sOrch" value="relay" ${orchestrationOf(s) === 'relay' ? 'checked' : ''} /> ${icon('pipeline')}Pipeline</label>
         <label class="check"><input type="radio" name="sOrch" value="compete" ${orchestrationOf(s) === 'compete' ? 'checked' : ''} /> ${icon('flag')}競争</label>
         <label class="check"><input type="radio" name="sOrch" value="none" ${orchestrationOf(s) === 'none' ? 'checked' : ''} /> なし</label>
       </div>
       <small>選んだ方だけ、タスクを作るときに「エージェント」の欄で選べます。「なし」なら、いつも1つのエージェントで動かします（Pipeline・競争の設定は消えずに残ります）。</small></div>
     <div class="field" id="sRelayField"><span>${icon('pipeline')}Pipelineの工程（上から順に、同じ worktree で引き継ぎます）</span>
       <div id="sRelay" class="relay-edit"></div>
       <button class="btn small" id="sRelayAdd" type="button">＋ 工程を足す</button>
       <small>工程ごとにエージェントと担当の説明を決めます。前の工程の変更はコミットしてから、最後の報告と一緒に次の工程へ渡します。</small></div>
     <div class="field" id="sCompeteField"><span>${icon('flag')}競争させるエージェント（2つ以上）</span>
       <div class="check-row" id="sCompeteBox"></div>
       <small>使うエージェントにチェックを付けたものから選べます。</small></div>

     <div class="modal-actions"><button class="btn ghost" id="sCancel">キャンセル</button><button class="btn primary" id="sOk">保存</button></div>`,
    () => {
      let relay = (s.relaySteps || []).map((x) => ({ ...x }));
      // 画面でチェックを付けている「使うエージェント」
      const using = () => AGENTS.map((x) => x[0]).filter((a) => document.querySelector(`.sUse[value="${a}"]`)?.checked);
      let competeSel = new Set(s.competeAgents || []);
      const drawAgents = () => {
        const on = using();
        const list = on.length ? on : ['claude'];
        // 最初から選んでおくエージェント
        const dsel = $('sDefaultAgent');
        const cur = dsel.value || defaultAgent(s);
        dsel.innerHTML = list.map((a) => `<option value="${a}" ${a === cur ? 'selected' : ''}>${esc(agentLabel(a))}</option>`).join('');
        if (!list.includes(cur)) dsel.value = list[0];
        // 競争させるエージェント
        document.querySelectorAll('.sCompete').forEach((x) => (x.checked ? competeSel.add(x.value) : competeSel.delete(x.value)));
        $('sCompeteBox').innerHTML = list.map((a) => `<label class="check"><input type="checkbox" class="sCompete" value="${a}" ${competeSel.has(a) ? 'checked' : ''} /> ${agentIcon(a)}${esc(agentLabel(a))}</label>`).join('');
      };
      const drawRelay = () => {
        const on = using();
        $('sRelay').innerHTML = relay
          .map(
            (st, i) => `<div class="relay-edit-row" data-i="${i}">
              <span class="relay-no">${i + 1}</span>
              <select class="rAgent">${AGENTS.filter(([a]) => on.includes(a) || a === st.agent).map(([a, l]) => `<option value="${a}" ${a === st.agent ? 'selected' : ''}>${esc(l)}${on.includes(a) ? '' : '（使わない設定）'}</option>`).join('')}</select>
              <input class="rLabel" placeholder="工程の名前（例: 実装）" value="${esc(st.label)}" />
              <button class="icon rUp" type="button" title="上へ" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon rDel" type="button" title="この工程を消す">✕</button>
              <textarea class="rInst" rows="2" placeholder="この工程の担当の説明（例: 前の工程の変更をレビューして直す）">${esc(st.instruction)}</textarea>
              <div class="relay-branch" title="合格・差し戻しの行き先を「次の工程」以外にすると、この工程のエージェントに結果を判定してもらい（返事の最後に [[PASS]] / [[FAIL]]）、行き先を変えます。前の工程に戻すとループになります">
                <label>合格なら <select class="rPass">${targetOpts(st.onPass, relay.length)}</select></label>
                <label>差し戻しなら <select class="rFail">${targetOpts(st.onFail, relay.length)}</select></label>
                <label class="rLoopBox" ${st.onPass === undefined && st.onFail === undefined ? 'hidden' : ''}>戻る上限 <input class="rLoops" type="number" min="1" max="10" value="${esc(st.maxLoops || 3)}" /> 回</label>
              </div>
            </div>`,
          )
          .join('') || '<div class="muted small">工程がありません</div>';
      };
      const readRelay = () => {
        document.querySelectorAll('#sRelay .relay-edit-row').forEach((row) => {
          const st = relay[Number(row.dataset.i)];
          st.agent = row.querySelector('.rAgent').value;
          st.label = row.querySelector('.rLabel').value.trim();
          st.instruction = row.querySelector('.rInst').value.trim();
          const tv = (v) => (v === '' ? undefined : v === 'end' ? 'end' : Number(v));
          st.onPass = tv(row.querySelector('.rPass').value);
          st.onFail = tv(row.querySelector('.rFail').value);
          if (st.onPass === undefined) delete st.onPass;
          if (st.onFail === undefined) delete st.onFail;
          if (st.onPass === undefined && st.onFail === undefined) delete st.maxLoops;
          else st.maxLoops = Math.min(10, Math.max(1, Math.round(Number(row.querySelector('.rLoops').value) || 3)));
        });
        return relay;
      };
      // 工程を消す・並べ替えたとき、分岐の行き先の番号を合わせる（map: 元の番号 → 新しい番号。消した工程は undefined）
      const remapTargets = (map) => {
        for (const st of relay) {
          for (const k of ['onPass', 'onFail']) {
            if (typeof st[k] !== 'number') continue;
            const n = map(st[k]);
            if (n === undefined) delete st[k];
            else st[k] = n;
          }
          if (st.onPass === undefined && st.onFail === undefined) delete st.maxLoops;
        }
      };
      drawRelay();
      drawAgents();
      // 選んだオーケストレーションの欄だけ出す（選んでいない方の設定は保存したまま残す）
      const orch = () => document.querySelector('input[name="sOrch"]:checked')?.value || 'relay';
      const drawOrch = () => {
        $('sRelayField').hidden = orch() !== 'relay';
        $('sCompeteField').hidden = orch() !== 'compete';
      };
      document.querySelectorAll('input[name="sOrch"]').forEach((r) => (r.onchange = drawOrch));
      drawOrch();
      // 「使う」のチェックを切り替えたら、そのエージェントの欄を出し入れして、選べるエージェントを描き直す
      document.querySelectorAll('.sUse').forEach((cb) => {
        cb.onchange = () => {
          const box = cb.closest('.agent-cfg');
          box.classList.toggle('on', cb.checked);
          box.querySelector('.agent-cfg-body').hidden = !cb.checked;
          readRelay();
          drawRelay();
          drawAgents();
        };
      });
      $('sRelayAdd').onclick = () => {
        readRelay();
        relay.push({ agent: $('sDefaultAgent').value || 'claude', label: '', instruction: '' });
        drawRelay();
      };
      $('sRelay').onclick = (e) => {
        const row = e.target.closest('.relay-edit-row');
        if (!row) return;
        const i = Number(row.dataset.i);
        if (e.target.closest('.rDel')) {
          readRelay();
          relay.splice(i, 1);
          remapTargets((n) => (n === i ? undefined : n > i ? n - 1 : n));
          drawRelay();
        } else if (e.target.closest('.rUp') && i > 0) {
          readRelay();
          [relay[i - 1], relay[i]] = [relay[i], relay[i - 1]];
          remapTargets((n) => (n === i ? i - 1 : n === i - 1 ? i : n));
          drawRelay();
        }
      };
      // 分岐の行き先を決めたら、戻る上限の欄を出す
      $('sRelay').onchange = (e) => {
        if (!e.target.closest('.rPass, .rFail')) return;
        const row = e.target.closest('.relay-edit-row');
        row.querySelector('.rLoopBox').hidden = !row.querySelector('.rPass').value && !row.querySelector('.rFail').value;
      };
      let defSkill = s.defaultSkill || null;
      const drawDef = () => renderSkillSlot('sSkill', defSkill, (v) => ((defSkill = v), drawDef()));
      drawDef();
      const sel = $('sBase');
      api.repoInfo().then(
        (info) => {
          // 読み込み中にモーダルを閉じたり別の画面に変わっていたら何もしない
          if (!info || $('sBase') !== sel || $('modal').classList.contains('hidden')) return;
          const picked = sel.value;
          sel.innerHTML = baseOptions({ branches: info.branches || [], current: info.current || '' });
          sel.value = picked;
        },
        () => {},
      );
      // 「Issue のステータスを自動で変える」にチェックがあるときだけ、項目名と選択肢の指定を出す
      $('sIssueSync').onchange = () => ($('sStatusMap').hidden = !$('sIssueSync').checked);
      refreshGh();
      $('sCancel').onclick = closeModal;
      $('sOk').onclick = async () => {
        const on = using();
        if (!on.length) return toast('使うエージェントを1つ以上選んでください');
        const steps = readRelay();
        const offStep = steps.find((st) => (st.label || st.instruction) && !on.includes(st.agent));
        if (offStep && orch() === 'relay' && !confirm(`Pipelineの工程「${offStep.label || '（名前なし）'}」の ${agentLabel(offStep.agent)} は使わない設定です。このままだとPipelineを始められません。保存しますか？`)) return;
        const r = await runBusy('設定を保存しています…', () =>
          api.updateSettings({
            baseBranch: $('sBase').value,
            integration: $('sIntegration').value,
            branchNamingRule: $('sBranchRule').value.trim(),
            permissionMode: $('sMode').value,
            allowedTools: $('sAllowed').value,
            maxParallel: $('sMax').value,
            model: $('sModel').value.trim(),
            claudePath: $('sClaude').value.trim() || 'claude',
            codexPath: $('sCodex').value.trim() || 'codex',
            codexModel: $('sCodexModel').value.trim(),
            geminiPath: $('sGemini').value.trim() || 'gemini',
            geminiModel: $('sGeminiModel').value.trim(),
            cursorPath: $('sCursor').value.trim() || 'cursor-agent',
            cursorModel: $('sCursorModel').value.trim(),
            defaultAgent: $('sDefaultAgent').value,
            enabledAgents: on,
            orchestration: orch(),
            relaySteps: steps,
            // 使わない設定にしたエージェントの競争の選択は覚えておく（また使う設定にしたら戻る）
            competeAgents: [...new Set([...[...document.querySelectorAll('.sCompete:checked')].map((x) => x.value), ...[...competeSel].filter((a) => !on.includes(a))])],
            defaultSkill: defSkill || '',
            issueStatusSync: $('sIssueSync').checked,
            suggestSkillsOnDone: $('sSuggestSkills').checked,
            deleteSessionsOnMerge: $('sDeleteSessions').checked,
            specCheck: $('sSpecCheck').checked,
            weeklyResetDay: $('sResetDay').value,
            weeklyResetTime: $('sResetTime').value || '00:00',
            statusFieldName: $('sStatusField').value.trim(),
            statusMapping: { inProgress: $('sMapProgress').value.trim(), inReview: $('sMapReview').value.trim(), done: $('sMapDone').value.trim() },
          }),
        );
        if (r) {
          closeModal();
          toast('保存しました', 'ok');
          checkEnv();
        }
      };
    },
  );
}

async function pickRepo(opts) {
  // 遠隔操作中はホストの画面にダイアログが出てしまうので、ホストのフォルダをこの画面で辿って選ぶ
  if (remoteClient()) return hostFolderModal(opts || {});
  const r = await run(() => api.chooseRepo({ ...(opts || {}), tab: state.repoOpenMode }));
  if (r) {
    closeDetail();
    state.board = await api.getBoard();
    renderBoard();
    checkEnv();
  }
}

// パスの末尾のフォルダ名（Windows / WSL の \\ にも対応）
function repoFolderName(p) {
  const s = String(p || '').replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

async function openRecentRepo(dir) {
  const cur = state.board.settings.repoPath;
  if (dir && dir === cur) {
    closeModal();
    return;
  }
  const inTab = repoTabsList().some((t) => t.path === dir);
  const r = await run(() => api.openRepo(dir, { tab: state.repoOpenMode }));
  if (r) {
    closeModal();
    closeDetail();
    state.board = await api.getBoard();
    renderBoard();
    toast(inTab ? `${repoFolderName(r)} のタブに切り替えました` : `${repoFolderName(r)} を開きました`, 'ok');
    checkEnv();
    return;
  }
  // フォルダが無い・git でないときは履歴から外れているので、モーダル上のカードも消す
  $('modalBox')?.querySelectorAll('[data-recent]').forEach((b) => {
    if (b.dataset.recent === dir) b.remove();
  });
}

// リポジトリを選ぶ: 最近開いたもの / 既存のフォルダを開く / URL からクローン / 新しく作る
// Windows で WSL（Ubuntu など）があれば、このパソコンのフォルダか、WSL の中のフォルダかも選んでもらう
// opts.tab: 'new' なら選んだものを新しいタブで、'replace' なら今のタブで開く（「戻る」で開き直すときは前の選び方のまま）
async function chooseRepo(opts) {
  if (opts && (opts.tab === 'new' || opts.tab === 'replace')) state.repoOpenMode = opts.tab;
  const distros = (await api.wslDistros().catch(() => [])) || [];
  const current = state.board.settings.repoPath || '';
  const tabs = current ? repoTabsList() : [];
  const tabbed = new Set(tabs.map((t) => t.path));
  const asNew = state.repoOpenMode === 'new' && tabs.length < MAX_REPO_TABS;
  const tabNote = !current
    ? ''
    : asNew
      ? `<p class="muted small">選んだリポジトリを新しいタブで開きます（タブは ${MAX_REPO_TABS} つまで）。</p>`
      : `<p class="muted small">選んだリポジトリで、今のタブ（${esc(repoFolderName(current))}）を置き換えます。${tabs.length < MAX_REPO_TABS ? '残しておきたいときは、タブの右の「＋」から開いてください。' : ''}</p>`;
  const recent = (state.board.settings.recentRepoPaths || []).filter((p) => p);
  const rc = remoteClient();
  const host = rc ? remoteHostLabel(rc) : '';
  const recentHtml = recent.length
    ? `<p class="repo-section-label">${rc ? `ホスト（${esc(host)}）で最近開いたリポジトリ` : '最近開いたリポジトリ'}</p>
       <div class="repo-choices">
         ${recent
           .map((p) => {
             const on = p === current;
             const tag = on ? ' <span class="repo-current-tag">開いています</span>' : tabbed.has(p) ? ' <span class="repo-current-tag">タブにあります</span>' : '';
             return `<button class="btn repo-choice${on ? ' current' : ''}" data-recent="${esc(p)}" ${on ? 'disabled' : ''}>${icon('folder')}<b>${esc(repoFolderName(p))}${tag}</b><small>${esc(p)}</small></button>`;
           })
           .join('')}
       </div>
       <p class="repo-section-label">または新しく開く</p>`
    : '';
  openModal(
    `<h2>${rc ? 'ホストのリポジトリを選ぶ' : 'リポジトリを選ぶ'}</h2>
     ${rc ? `<p class="muted small">遠隔操作中です。ここで選ぶのは接続先（${esc(host)}）のフォルダで、エージェントもホストのそのフォルダで動きます。</p>` : ''}
     ${tabNote}
     ${distros.length ? `<p class="muted small">選んだフォルダが WSL の中なら、git とエージェント（claude / codex / gemini / cursor-agent）も WSL の中で動かします（WSL の中にも git と使うエージェントが必要です）。</p>` : ''}
     ${recentHtml}
     <div class="repo-choices">
       ${
         rc
           ? `<button class="btn repo-choice" data-pick="">${icon('monitor')}<b>ホストのフォルダを開く</b><small>${esc(host)} のフォルダを、この画面で辿って選びます</small></button>`
           : `<button class="btn repo-choice" data-pick="">${icon(distros.length ? 'monitor' : 'folder')}<b>${distros.length ? 'このパソコンのフォルダを開く' : '手元のフォルダを開く'}</b><small>${distros.length ? 'C:\\Users\\… など' : 'すでにある git リポジトリ'}</small></button>`
       }
       ${distros.map((d) => `<button class="btn repo-choice" data-pick="${esc(d)}">${icon('terminal')}<b>${esc(d)} のフォルダを開く</b><small>\\\\wsl.localhost\\${esc(d)}\\home\\… から開きます</small></button>`).join('')}
       <button class="btn repo-choice" id="rpClone">${icon('download')}<b>URL からクローンする</b><small>https://github.com/owner/repo・git@github.com:owner/repo.git・owner/repo</small></button>
       <button class="btn repo-choice" id="rpCreate">${icon('folderPlus')}<b>新しく作る</b><small>空のリポジトリを作ります（GitHub にも作れます）</small></button>
     </div>
     <div class="modal-actions"><button class="btn ghost" id="rpCancel">キャンセル</button></div>`,
    () => {
      $('rpCancel').onclick = closeModal;
      $('rpClone').onclick = () => repoSetupModal('clone', distros);
      $('rpCreate').onclick = () => repoSetupModal('create', distros);
      $('modalBox').querySelectorAll('[data-pick]').forEach((b) =>
        b.addEventListener('click', () => {
          const d = b.dataset.pick;
          closeModal();
          pickRepo(d ? { wsl: d } : {});
        }),
      );
      $('modalBox').querySelectorAll('[data-recent]').forEach((b) =>
        b.addEventListener('click', () => {
          if (b.disabled) return;
          openRecentRepo(b.dataset.recent);
        }),
      );
    },
  );
}

// ホストのフォルダを辿る一覧（遠隔操作中に使う。ホストの画面にダイアログを出さないため）
// el に描く。onPick(dir) は「pickLabel」のボタンで今のフォルダを選んだとき、onOpenRepo(dir) は一覧の git リポジトリの「開く」
async function mountDirBrowser(el, { start = '', wsl = '', pickLabel = 'このフォルダを選ぶ', onPick, onOpenRepo } = {}) {
  const st = { hidden: false, listing: null, seq: 0 };
  const load = async (dir, { first = false } = {}) => {
    const seq = ++st.seq;
    el.querySelector('.db-list')?.classList.add('loading');
    let r;
    try {
      r = await api.browseDirs({ path: dir || '', wsl: first && !dir ? wsl : '', showHidden: st.hidden });
    } catch (err) {
      if (seq !== st.seq) return;
      el.querySelector('.db-list')?.classList.remove('loading');
      toast(err.message);
      // 最初に開けなかったときは、ホームから見せる
      if (first && dir) return load('');
      return;
    }
    if (seq !== st.seq || !el.isConnected) return;
    st.listing = r;
    draw();
  };
  const draw = () => {
    const r = st.listing;
    el.innerHTML = `<div class="dir-browser">
      <div class="input-row"><input class="mono db-path" spellcheck="false" autocomplete="off" value="${esc(r.path)}" title="パスを入れて Enter で移動します" /><button class="btn db-go">移動</button></div>
      <div class="db-tools">
        <button class="btn ghost small db-up" ${r.parent ? '' : 'disabled'}>↑ 上のフォルダ</button>
        <button class="btn ghost small db-home">ホーム</button>
        <label class="db-hidden"><input type="checkbox" ${st.hidden ? 'checked' : ''} /> 隠しフォルダも出す</label>
        ${r.repo ? '<span class="db-repo-tag">git リポジトリ</span>' : ''}
      </div>
      <div class="db-list">
        ${
          r.dirs.length
            ? r.dirs
                .map(
                  (d) => `<div class="db-row${d.repo ? ' repo' : ''}"><button class="db-dir" data-dir="${esc(d.path)}">${icon(d.repo ? 'branch' : 'folder')}<span>${esc(d.name)}</span></button>${d.repo && onOpenRepo ? `<button class="btn small db-open" data-open="${esc(d.path)}">開く</button>` : ''}</div>`,
                )
                .join('')
            : '<p class="muted small db-empty">この中にフォルダはありません</p>'
        }
        ${r.truncated ? '<p class="muted small db-empty">フォルダが多いので、先頭の分だけ出しています。パスを入れて移動してください</p>' : ''}
      </div>
      ${onPick ? `<div class="db-actions"><button class="btn primary db-pick">${esc(pickLabel)}</button></div>` : ''}
    </div>`;
    const input = el.querySelector('.db-path');
    el.querySelector('.db-go').onclick = () => load(input.value.trim());
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        load(input.value.trim());
      }
    };
    el.querySelector('.db-up').onclick = () => r.parent && load(r.parent);
    el.querySelector('.db-home').onclick = () => load(r.home || '');
    el.querySelector('.db-hidden input').onchange = (e) => ((st.hidden = e.target.checked), load(r.path));
    el.querySelectorAll('[data-dir]').forEach((b) => (b.onclick = () => load(b.dataset.dir)));
    el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => onOpenRepo(b.dataset.open)));
    const pick = el.querySelector('.db-pick');
    if (pick) pick.onclick = () => onPick(r.path);
  };
  el.innerHTML = '<p class="muted small">ホストのフォルダを読み込んでいます…</p>';
  await load(start, { first: true });
}

// 遠隔操作中に、ホストのフォルダを辿って git リポジトリを開く画面
function hostFolderModal(opts = {}) {
  const host = remoteHostLabel();
  openModal(
    `<h2>ホストのフォルダを開く</h2>
     <p class="muted small">接続先（${esc(host)}）のフォルダです。git リポジトリのフォルダまで移動して「このフォルダを開く」を押すか、一覧の「開く」を押します。</p>
     <div id="hfBrowser"></div>
     <div class="modal-actions"><button class="btn ghost" id="hfBack">戻る</button></div>`,
    () => {
      $('hfBack').onclick = () => chooseRepo();
      mountDirBrowser($('hfBrowser'), {
        start: '',
        wsl: opts.wsl || '',
        pickLabel: 'このフォルダを開く',
        onPick: (dir) => openRecentRepo(dir),
        onOpenRepo: (dir) => openRecentRepo(dir),
      });
    },
  );
}

// URL から推測するフォルダ名（https://github.com/owner/repo.git → repo）
function repoNameFromUrl(url) {
  const last = String(url || '').trim().replace(/[\\/]+$/, '').split(/[/:]/).pop() || '';
  return last.replace(/\.git$/i, '');
}

// クローン（mode='clone'）・新規作成（mode='create'）の画面
async function repoSetupModal(mode, distros = []) {
  const clone = mode === 'clone';
  openModal(
    `<h2>${clone ? 'URL からクローンする' : '新しいリポジトリを作る'}</h2>
     ${clone ? `<label class="field"><span>リポジトリの URL</span><input id="rsUrl" class="mono" placeholder="https://github.com/owner/repo または owner/repo" autocomplete="off" spellcheck="false" /></label>` : ''}
     ${distros.length ? `<label class="field"><span>作る場所</span><select id="rsWhere"><option value="">このパソコン</option>${distros.map((d) => `<option value="${esc(d)}">${esc(d)}（WSL）</option>`).join('')}</select></label>` : ''}
     <label class="field"><span>置き場所（この中にフォルダを作ります）</span>
       <div class="input-row"><input id="rsParent" class="mono" spellcheck="false" /><button class="btn" id="rsBrowse">選ぶ…</button></div></label>
     <div id="rsHostBrowser" class="dir-browser-inline hidden"></div>
     <label class="field"><span>フォルダ名${clone ? '（空なら URL から決めます）' : ''}</span><input id="rsName" class="mono" spellcheck="false" autocomplete="off" placeholder="${clone ? 'repo' : '例: my-app'}" /></label>
     ${clone ? '' : `<label class="field" id="rsGhWrap"><span>GitHub</span><select id="rsGh"><option value="">作らない（手元だけ）</option><option value="private">GitHub にも作る（非公開）</option><option value="public">GitHub にも作る（公開）</option></select><small>GitHub にも作るときは、gh（GitHub CLI）にログインしている必要があります</small></label>`}
     <p class="muted small" id="rsPreview"></p>
     <div class="modal-actions"><button class="btn ghost" id="rsBack">戻る</button><button class="btn primary" id="rsOk">${clone ? 'クローンして開く' : '作って開く'}</button></div>`,
    async () => {
      const where = () => ($('rsWhere') ? $('rsWhere').value : '');
      const sep = () => (where() || /^[A-Za-z]:\\|^\\\\/.test($('rsParent').value) ? '\\' : '/');
      const name = () => $('rsName').value.trim() || (clone ? repoNameFromUrl($('rsUrl').value) : '');
      let nameTouched = false;
      const preview = () => {
        const p = $('rsParent').value.trim().replace(/[\\/]+$/, '');
        $('rsPreview').textContent = p && name() ? `作るフォルダ: ${p}${sep()}${name()}` : '';
      };
      const loadParent = async () => {
        $('rsParent').value = (await api.repoDefaultParent(where() ? { wsl: where() } : {}).catch(() => '')) || '';
        if ($('rsGhWrap')) $('rsGhWrap').hidden = !!where(); // WSL のフォルダでは GitHub に作れない
        preview();
      };
      $('rsBack').onclick = () => chooseRepo();
      $('rsBrowse').onclick = async () => {
        // 遠隔操作中は、ホストのフォルダをこの画面で辿って選ぶ
        if (remoteClient()) {
          const box = $('rsHostBrowser');
          if (!box.classList.contains('hidden')) return box.classList.add('hidden');
          box.classList.remove('hidden');
          mountDirBrowser(box, {
            start: $('rsParent').value.trim(),
            wsl: where(),
            pickLabel: 'ここを置き場所にする',
            onPick: (dir) => {
              $('rsParent').value = dir;
              box.classList.add('hidden');
              preview();
            },
          });
          return;
        }
        const p = await run(() => api.chooseRepoParent({ defaultPath: $('rsParent').value.trim() || undefined }));
        if (p) $('rsParent').value = p;
        preview();
      };
      if ($('rsWhere')) $('rsWhere').onchange = loadParent;
      $('rsParent').oninput = preview;
      $('rsName').oninput = () => ((nameTouched = !!$('rsName').value.trim()), preview());
      if (clone) $('rsUrl').oninput = () => (nameTouched || ($('rsName').placeholder = repoNameFromUrl($('rsUrl').value) || 'repo'), preview());
      $('rsOk').onclick = async () => {
        const parent = $('rsParent').value.trim();
        const r = clone
          ? await runBusy('クローンしています…（大きいリポジトリは時間がかかります）', () => api.cloneRepo({ url: $('rsUrl').value.trim(), parent, name: $('rsName').value.trim(), tab: state.repoOpenMode }))
          : await runBusy('リポジトリを作っています…', () => api.createRepo({ parent, name: $('rsName').value.trim(), github: where() ? '' : $('rsGh').value, tab: state.repoOpenMode }));
        if (!r) return;
        closeModal();
        closeDetail();
        if (r.warning) toast(r.warning);
        else toast(clone ? 'クローンしました' : r.github ? 'リポジトリを作り、GitHub にも push しました' : 'リポジトリを作りました', 'ok');
        state.board = await api.getBoard();
        renderBoard();
        checkEnv();
      };
      (clone ? $('rsUrl') : $('rsName')).focus();
      await loadParent();
    },
  );
}

$('newBtn').onclick = () => newTask();
$('chatBtn').onclick = openChats;
$('detailBackdrop').addEventListener('mousedown', closeDetail);
$('settingsBtn').onclick = openSettings;
$('sessionsBtn').onclick = openSessionManager;
$('rcBtn').onclick = openRemoteSettings;

// ---------------- gh（GitHub CLI）の案内 ----------------
// 入っていなければインストール、ログインしていなければログインまで、この画面からできるようにする

const ghState = { busy: false, lines: [], code: null };

async function refreshGh() {
  const st = await api.ghStatus().catch(() => null);
  renderGh(st);
  return st;
}

function renderGh(st) {
  const el = $('ghPanel');
  if (!el) return;
  const log = ghState.lines.length ? `<pre class="gh-log">${esc(ghState.lines.slice(-8).join('\n'))}</pre>` : '';
  if (ghState.busy && ghState.code) {
    el.className = 'gh-panel gh-warn';
    el.innerHTML = `<b>ブラウザで GitHub にログインしてください</b>
      <p>開いたページに、次のコードを入力します。</p>
      <div class="gh-code"><code>${esc(ghState.code.code)}</code><button class="btn small" id="ghCopy">コピー</button><button class="btn small ghost" id="ghOpen">ページを開く</button></div>
      <p class="muted small">ログインが終わると、自動でこの画面に戻ります。</p>${log}
      <button class="btn small ghost" id="ghCancel">やめる</button>`;
    $('ghCopy').onclick = () => navigator.clipboard.writeText(ghState.code.code).then(() => toast('コピーしました', 'ok'));
    $('ghOpen').onclick = () => run(() => api.openExternal(ghState.code.url));
    $('ghCancel').onclick = () => api.ghCancel();
    return;
  }
  if (ghState.busy) {
    el.className = 'gh-panel';
    el.innerHTML = `<b>処理しています…</b>${log}`;
    return;
  }
  if (!st) {
    el.className = 'gh-panel';
    el.textContent = 'gh の状態を確認できませんでした';
    return;
  }
  if (!st.installed) {
    el.className = 'gh-panel gh-warn';
    el.innerHTML = `<b>gh（GitHub CLI）が入っていません</b>
      <p>Issue を読み込むのに使います（private リポジトリの Issue も読めるようになります）。</p>
      ${st.installer
        ? `<button class="btn primary small" id="ghInstall">gh をインストールする</button> <span class="muted small">${esc(st.installer)} で <code>${esc(st.installLabel)}</code> を実行します</span>`
        : `<button class="btn primary small" id="ghDownload">ダウンロードページを開く</button> <span class="muted small">インストールしたら「もう一度確認」を押してください</span>`}
      <div><button class="btn small ghost" id="ghRecheck">もう一度確認</button></div>${log}
      <p class="muted small">public リポジトリなら、gh がなくても読み込めます。</p>`;
    if ($('ghInstall')) $('ghInstall').onclick = () => ghAction('install');
    if ($('ghDownload')) $('ghDownload').onclick = () => run(() => api.openExternal(st.downloadUrl));
    $('ghRecheck').onclick = refreshGh;
    return;
  }
  if (!st.loggedIn) {
    el.className = 'gh-panel gh-warn';
    el.innerHTML = `<b>gh は入っていますが、GitHub にログインしていません</b>
      <p><button class="btn primary small" id="ghLogin">GitHub にログイン</button> <span class="muted small">ブラウザが開くので、表示されたコードを入力します</span></p>
      <div><button class="btn small ghost" id="ghRecheck">もう一度確認</button></div>${log}`;
    $('ghLogin').onclick = () => ghAction('login');
    $('ghRecheck').onclick = refreshGh;
    return;
  }
  if (st.hasProjectScope === false && state.board.settings.issueStatusSync !== false) {
    el.className = 'gh-panel gh-warn';
    el.innerHTML = `<span>${icon('check')}gh で GitHub にログインしています${st.user ? `（<b>${esc(st.user)}</b>）` : ''}</span>
      <p>Issue のステータス（GitHub Projects の In progress / In review / Done）を自動で変えるには、project の権限が必要です。</p>
      <p><button class="btn primary small" id="ghScope">Projects の権限を追加</button> <span class="muted small">ブラウザが開くので、表示されたコードを入力します</span></p>
      <div><button class="btn small ghost" id="ghRecheck">もう一度確認</button></div>${log}`;
    $('ghScope').onclick = () => ghAction('scope');
    $('ghRecheck').onclick = refreshGh;
    return;
  }
  el.className = 'gh-panel ok';
  el.innerHTML = `<span>${icon('check')}gh で GitHub にログインしています${st.user ? `（<b>${esc(st.user)}</b>）` : ''}</span>`;
}

async function ghAction(kind) {
  ghState.busy = true;
  ghState.lines = [];
  ghState.code = null;
  renderGh(null);
  try {
    const st = await (kind === 'install' ? api.ghInstall() : kind === 'scope' ? api.ghAddProjectScope() : api.ghLogin());
    ghState.busy = false;
    ghState.code = null;
    toast(kind === 'install' ? 'gh をインストールしました' : kind === 'scope' ? 'project の権限を追加しました' : 'GitHub にログインしました', 'ok');
    renderGh(st);
    // インストールが終わったら、続けてログインも案内する
    if (kind === 'install' && st && st.installed && !st.loggedIn) toast('続けて「GitHub にログイン」を押してください', 'ok');
  } catch (err) {
    ghState.busy = false;
    ghState.code = null;
    toast(err.message);
    refreshGh();
  }
}

api.onGh((ev) => {
  if (ev.type === 'code') ghState.code = ev;
  else if (ev.type === 'line') ghState.lines.push(ev.line);
  if (ghState.busy) renderGh(null);
});

// ---------------- 通知（右上のベル） ----------------


function timeAgo(t) {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return new Date(t).toLocaleString();
}

function notifItemHtml(n) {
  const alive = !!card(n.cardId);
  const action =
    n.action && !n.actedAt && alive
      ? `<button class="btn small primary" data-nact="${esc(n.id)}">${esc(n.actionLabel || '実行')}</button>`
      : n.action && n.actedAt ? '<span class="muted small">対応済み</span>' : '';
  return `<div class="notif-item ${n.read ? '' : 'unread'} k-${esc(n.kind)}" data-nid="${esc(n.id)}" data-card="${alive ? esc(n.cardId) : ''}">
    <span class="notif-icon">${icon(NOTIF_ICON[n.kind] || 'bell')}</span>
    <div class="notif-main">
      <div class="notif-title">${esc(n.title)}</div>
      ${n.body ? `<div class="notif-body">${esc(plainText(n.body))}</div>` : ''}
      <div class="notif-foot"><span class="muted small">${timeAgo(n.t)}</span>${action}</div>
    </div>
    <button class="icon notif-x" data-nclear="${esc(n.id)}" title="この通知を消す">✕</button>
  </div>`;
}

function renderNotifications() {
  const list = state.board.notifications || [];
  const unread = list.filter((n) => !n.read).length;
  $('notifCount').textContent = unread > 99 ? '99+' : String(unread);
  $('notifCount').classList.toggle('hidden', !unread);
  const panel = $('notifPanel');
  if (panel.classList.contains('hidden')) return;
  panel.innerHTML = `
    <div class="notif-head"><b>通知</b><span class="spacer"></span>
      ${unread ? '<button class="btn small ghost" data-nall="read">すべて既読</button>' : ''}
      ${list.length ? '<button class="btn small ghost" data-nall="clear">すべて消す</button>' : ''}
    </div>
    <div class="notif-list">${list.length ? list.map(notifItemHtml).join('') : '<p class="muted pad">通知はまだありません</p>'}</div>`;
}

function closeNotifications() {
  const panel = $('notifPanel');
  if (panel.classList.contains('hidden')) return;
  panel.classList.add('hidden');
  // 開いているあいだに見た通知は既読にする
  const ids = (state.board.notifications || []).filter((n) => !n.read).map((n) => n.id);
  if (ids.length) run(() => api.readNotifications(ids));
}

$('notifBtn').onclick = (e) => {
  e.stopPropagation();
  const panel = $('notifPanel');
  if (!panel.classList.contains('hidden')) return closeNotifications();
  panel.classList.remove('hidden');
  renderNotifications();
};
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.notif-wrap')) closeNotifications();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeNotifications();
});
$('notifPanel').addEventListener('click', async (e) => {
  const all = e.target.closest('[data-nall]');
  if (all) {
    if (all.dataset.nall === 'read') run(() => api.readNotifications());
    else run(() => api.clearNotifications());
    return;
  }
  const x = e.target.closest('[data-nclear]');
  if (x) return run(() => api.clearNotifications([x.dataset.nclear]));
  const act = e.target.closest('[data-nact]');
  if (act) {
    const n = (state.board.notifications || []).find((v) => v.id === act.dataset.nact);
    const c = n && card(n.cardId);
    const r = await runBusy('スキルの提案を頼んでいます…', () => api.actNotification(act.dataset.nact).then((v) => v || {}), 'スキルの提案を新しい会話で頼みました。返事が来たら、下の欄から追加したいものを伝えてください');
    const to = (r && r.cardId) || (c && c.id);
    if (r && to) {
      closeNotifications();
      selectNew(to);
    }
    return;
  }
  const item = e.target.closest('.notif-item');
  if (item && item.dataset.card) {
    run(() => api.readNotifications([item.dataset.nid]));
    closeNotifications();
    select(item.dataset.card);
  }
});

// ---------------- 更新の受信 ----------------

// RC設定を開いているときの描き直し。接続の段階（接続中・再開中・失敗）が変わったときだけ呼ぶ（入力中の欄を消さないため）
let remoteDialogRedraw = null;
let remotePhase = '';
const remotePhaseOf = (rs) => {
  const c = rs?.client || {};
  const r = c.reconnecting;
  return [rs?.role, c.canResume, c.resumeError, r ? `${r.attempt}:${r.lastError}` : '', c.currentId, (c.history || []).map((h) => `${h.id}:${h.hasToken}`).join(',')].join('|');
};

api.onRemote((rs) => {
  if (!state.board) state.board = { settings: {}, cards: [] };
  state.board.remoteSession = rs;
  renderRemoteInfo();
  const phase = remotePhaseOf(rs);
  if (phase !== remotePhase) {
    remotePhase = phase;
    if (remoteDialogRedraw && $('rcBox') && !isBusy()) remoteDialogRedraw();
    else if (!$('rcBox')) remoteDialogRedraw = null;
  }
});

api.onBoard((board) => {
  state.board = board;
  renderBoard();
  if (state.selected) {
    renderDetailHead();
    const c = card(state.selected);
    if (c) {
      updateBtwTab(c);
      drawLogActions(c);
      // 実行が終わった・マージしたなど状態が変わったら worktree タブを読み直す
      if (state.tab === 'worktree' && state.wtStatus !== `${c.id}:${c.status}:${c.worktreePath || ''}`) {
        if (state.wtStatus) renderWorktree(c, { quiet: true });
      }
      state.wtStatus = `${c.id}:${c.status}:${c.worktreePath || ''}`;
      if (state.tab === 'btw') {
        const list = $('btwList');
        if (list) list.innerHTML = btwListHtml(c);
        // 実行中かどうかが変わったら作り直す
        const live = c.status === 'running' || c.status === 'queued';
        if ($('btwInput') && $('btwInput').disabled === live) renderDetailBody();
      }
    }
  }
});
// ログの中のリンクはブラウザで開く
$('detailBody').addEventListener('click', (e) => {
  const a = e.target.closest('.md-link');
  if (!a) return;
  e.preventDefault();
  const url = a.dataset.url;
  // 安全のため、ブラウザで開けるのは GitHub の URL だけ（main.js と同じ条件）。それ以外はコピーする
  if (/^https:\/\/([a-z0-9-]+\.)?github\.com\//.test(url)) return run(() => api.openExternal(url));
  navigator.clipboard?.writeText(url).then(
    () => toast('GitHub 以外のリンクは開けないので、URL をコピーしました', 'ok'),
    () => toast('GitHub 以外のリンクは開けません'),
  );
});

api.onLog(({ id, entry }) => {
  if (!state.logs.has(id)) return;
  state.logs.get(id).push(entry);
  if (state.selected === id && state.tab === 'log') {
    const body = $('detailBody');
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
    const c = card(id);
    if (c) appendChatLog(body, c, entry);
    if (atBottom) body.scrollTop = body.scrollHeight;
  }
});
api.onFocus((id) => card(id) && select(id));

setInterval(() => {
  document.querySelectorAll('.elapsed[data-since]').forEach((el) => (el.textContent = elapsed(Number(el.dataset.since))));
}, 1000);

// git や、使う設定のエージェントのコマンドが見つからないときは画面上部に案内を出す
async function checkEnv() {
  const env = await run(() => api.checkEnv());
  if (!env) return;
  const msgs = [];
  const on = enabledAgents();
  const has = (a) => (env.agents ? !!env.agents[a] : a === 'claude' ? !!env.claude : true);
  if (env.wsl) {
    if (!env.git) msgs.push(`${env.wsl}（WSL）の中に git が見つかりません。${env.wsl} のターミナルで sudo apt install git を実行してください。`);
    for (const a of on) if (!has(a)) msgs.push(`${env.wsl}（WSL）の中に ${a} が見つかりません。${env.wsl} のターミナルで ${agentLabel(a)} をインストールしてログインしてください（このリポジトリのタスクは ${env.wsl} の中で動きます）。`);
  } else {
    if (!env.git) msgs.push(`git が見つかりません。${env.platform === 'win32' ? 'Git for Windows（https://git-scm.com/）' : env.platform === 'darwin' ? 'ターミナルで xcode-select --install を実行するか Homebrew で git' : 'git'} をインストールしてから、アプリを再起動してください。`);
    for (const a of on) if (!has(a)) msgs.push(`${a} コマンドが見つかりません。${agentLabel(a)} をインストールしてログインするか、「設定」で ${a} のフルパスを指定してください（ターミナルで which ${a}、Windows なら where ${a} で調べられます）。使わないなら、「設定」の「使うエージェント」でチェックを外してください。`);
  }
  const el = $('envBanner');
  el.innerHTML = msgs.map((m) => `<div>${icon('alert')}${esc(m)}</div>`).join('');
  el.classList.toggle('hidden', msgs.length === 0);
}

// 左上に、いま動いているアプリのバージョンを出す
api.appInfo().then(
  (i) => {
    $('appVersion').textContent = `v${i.version}${i.packaged ? '' : '（開発版）'}`;
    $('appVersion').title = `Agent Kanban v${i.version}`;
  },
  () => {},
);

// 右側の詳細パネルは、左端をドラッグして幅を変えられる（タブを切り替えても幅は変わらない）
(function setupDetailResize() {
  const KEY = 'detailWidth';
  const panel = $('detail');
  const handle = $('detailResizer');
  const MIN = 320;
  const clamp = (w) => Math.max(MIN, Math.min(w, window.innerWidth - 240));
  const apply = (w) => panel.style.setProperty('--detail-w', `${Math.round(w)}px`);
  const saved = Number(localStorage.getItem(KEY));
  if (saved > 0) apply(clamp(saved));
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    const startX = e.clientX;
    const startW = panel.getBoundingClientRect().width;
    const move = (ev) => apply(clamp(startW + (startX - ev.clientX)));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      localStorage.setItem(KEY, String(Math.round(panel.getBoundingClientRect().width)));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => {
    panel.style.removeProperty('--detail-w');
    localStorage.removeItem(KEY);
  });
})();

// 詳細パネルの3つの段（上: タスクの情報 / 中: タブの中身 / 下: 追加の指示）は、境目をドラッグして高さを変えられる。
// どの段も「ログ・worktree などのタブ」の高さより低くはできない。高さは保存し、ダブルクリックで元に戻す
(function setupDetailSplit() {
  const panel = $('detail');
  const head = $('detailHead');
  const foot = $('detailFoot');
  const tabs = $('tabs');
  const KEYS = { head: 'detailHeadHeight', foot: 'detailFootHeight' };
  const els = { head, foot };
  const body = $('detailBody');
  // pref: ユーザーが決めた（保存した）高さ / h: いま実際に使っている高さ（入りきらないときは pref より縮める）
  const pref = { head: Number(localStorage.getItem(KEYS.head)) || 0, foot: Number(localStorage.getItem(KEYS.foot)) || 0 };
  const h = { ...pref };
  const minH = () => Math.max(24, tabs.offsetHeight);
  // 上下の段とタブを除いた、3つの段で分け合える高さ
  const avail = () => panel.clientHeight - tabs.offsetHeight - $('detailTitle').offsetHeight;
  const cur = (k) => (h[k] > 0 ? h[k] : els[k].offsetHeight);
  const apply = (k) => {
    const el = els[k];
    el.classList.toggle('sized', h[k] > 0);
    el.style.height = h[k] > 0 ? `${Math.round(h[k])}px` : '';
  };
  // k の段を v にしたいとき、ほかの2つの段がタブの高さ以上を保てる範囲に収める
  const clampFor = (k, v) => {
    const other = k === 'head' ? 'foot' : 'head';
    const min = minH();
    const max = avail() - cur(other) - min;
    return Math.max(min, Math.min(v, max));
  };
  // パネルの高さが変わったら（ウィンドウの大きさ・モーダルとの切り替え）、はみ出さないように縮める
  const fit = () => {
    if (panel.classList.contains('hidden') || !panel.clientHeight) return;
    const min = minH();
    // 上の段の中身が長いタスクに切り替えても、上・中の段がタブの高さより潰れないようにする
    head.style.minHeight = body.style.minHeight = `${min}px`;
    // 毎回ユーザーが決めた高さから計算し直す（モーダルを閉じた・ウィンドウを戻したときは元の高さに戻る）
    h.head = pref.head;
    h.foot = pref.foot;
    apply('head');
    apply('foot');
    let over = cur('head') + cur('foot') + min - avail();
    for (const k of ['foot', 'head']) {
      if (over <= 0 || !(h[k] > 0)) continue;
      const cut = Math.min(over, h[k] - min);
      if (cut > 0) {
        h[k] -= cut;
        over -= cut;
        apply(k);
      }
    }
  };
  const setup = (handleId, k, dir) => {
    const handle = $(handleId);
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      document.body.classList.add('resizing-row');
      const startY = e.clientY;
      const start = els[k].offsetHeight;
      const move = (ev) => {
        h[k] = clampFor(k, start + dir * (ev.clientY - startY));
        apply(k);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-row');
        pref[k] = h[k] > 0 ? Math.round(h[k]) : pref[k];
        if (pref[k] > 0) localStorage.setItem(KEYS[k], String(pref[k]));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', () => {
      h[k] = pref[k] = 0;
      apply(k);
      localStorage.removeItem(KEYS[k]);
    });
  };
  setup('splitHead', 'head', 1); // 下へ動かすと上の段が高くなる
  setup('splitFoot', 'foot', -1); // 上へ動かすと下の段が高くなる
  apply('head');
  apply('foot');
  new ResizeObserver(fit).observe(panel);
})();

(async () => {
  state.board = await api.getBoard();
  renderBoard();
  checkEnv();
})();
