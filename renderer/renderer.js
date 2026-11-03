/* global api */
const COLUMNS = [
  { key: 'todo', label: 'Todo', statuses: ['todo'], hint: 'ここから「実行中」へドラッグしても開始できます' },
  { key: 'running', label: '実行中', statuses: ['queued', 'running'] },
  { key: 'review', label: 'レビュー', statuses: ['review', 'failed'] },
  { key: 'done', label: '完了', statuses: ['done'] },
  // タスクに紐づかない会話（worktree を作らず、リポジトリのフォルダでそのまま話す）
  { key: 'chat', label: '💬 会話', chat: true },
];
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

const state = { board: { settings: {}, cards: [] }, selected: null, tab: 'log', logs: new Map(), headSig: '' };
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
        <div class="perm-title">⚠ 承認待ち: <b>${esc(r.toolName)}</b></div>
        ${r.summary ? `<code class="perm-summary">${esc(r.summary)}</code>` : ''}
        ${compact ? '' : `<details><summary>入力の全文</summary><pre>${esc(r.detail)}</pre></details>
          <input class="deny-reason" placeholder="拒否する理由（任意・Claude に伝わります）" />`}
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
function badgeFor(c) {
  if (isInterrupted(c)) return ['interrupted', '中断'];
  if ((c.questions || []).length) return ['question', '質問'];
  if ((c.permissions || []).length) return ['waiting', '承認待ち'];
  if (c.conflict && !c.conflict.resolving && c.status !== 'running' && c.status !== 'queued') return ['conflict', 'コンフリクト'];
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
    <div class="q-title">❓ ${esc(q.header ? q.header + ': ' : '')}${esc(q.question)}</div>
    ${quick
      ? `<div class="q-quick">${q.options.map((o) => `<button class="btn small" data-qpick="${esc(o.label)}" title="${esc(o.description)}">${esc(o.label)}</button>`).join('')}<button class="btn small ghost" data-qopen="1">その他…</button></div>`
      : `<div class="q-quick"><button class="btn small primary" data-qopen="1">回答する（${req.questions.length}問）</button></div>`}
  </div>`;
}

// 詳細パネル用の回答フォーム
function questionFormHtml(c) {
  return (c.questions || [])
    .map(
      (req) => `<div class="qform" data-card="${c.id}" data-req="${req.id}">
      <div class="q-title">❓ Claude からの質問</div>
      ${req.questions
        .map(
          (q, i) => `<div class="q-item" data-qi="${i}">
          <div class="q-head">${q.header ? `<span class="q-chip">${esc(q.header)}</span>` : ''}${esc(q.question)}${q.multiSelect ? '<span class="muted small">（複数選べます）</span>' : ''}</div>
          <div class="q-opts">
            ${q.options
              .map(
                (o) => `<label class="q-opt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q-${req.id}-${i}" value="${esc(o.label)}" />
                <span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></label>`,
              )
              .join('')}
            <label class="q-opt other"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q-${req.id}-${i}" value="__other__" />
              <span><b>その他</b><input class="q-other" placeholder="自由に入力" /></span></label>
          </div>
        </div>`,
        )
        .join('')}
      <div class="q-actions"><button class="btn primary" data-qact="submit">回答する</button><button class="btn ghost" data-qact="skip" title="Claude に、妥当だと思う方法で進めてもらいます">答えずに続ける</button></div>
    </div>`,
    )
    .join('');
}

// ---- コンフリクト ----
function conflictBoxHtml(c) {
  const busy = c.status === 'running' || c.status === 'queued';
  if (c.conflict) {
    const k = c.conflict;
    const files = (k.unresolved && k.unresolved.length ? k.unresolved : k.files) || [];
    let actions;
    if (k.resolving && busy) actions = '<p class="muted small">Claude がコンフリクトを解消しています…（ログで進み具合を見られます）</p>';
    else if (k.manual)
      actions = `<p class="small">タスクの worktree で、上のファイルの <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> 〜 <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> を直してください。</p>
        <div class="cf-actions"><button class="btn" data-cact="open">フォルダを開く</button><button class="btn primary" data-cact="complete">解消した（取り込みを完了）</button><button class="btn" data-cact="agent">Claude に任せる</button><button class="btn ghost" data-cact="abort">取り込みを中止</button></div>`;
    else if (k.pr)
      actions = `<div class="cf-actions"><button class="btn primary" data-cact="agent">Claude に解消してもらう</button><button class="btn" data-cact="manual">自分で解消する</button>${c.prUrl ? '<button class="btn ghost" data-cact="openPr">GitHub で見る</button>' : ''}<button class="btn ghost" data-cact="dismiss">閉じる</button></div>
        <p class="muted small">どちらも、origin/${esc(k.target)} をこのタスクのブランチに取り込んで解消します。解消できたら「PR を更新」で push すると、PR のコンフリクトがなくなります。</p>`;
    else
      actions = `<div class="cf-actions"><button class="btn primary" data-cact="agent">Claude に解消してもらう</button><button class="btn" data-cact="manual">自分で解消する</button><button class="btn ghost" data-cact="dismiss">閉じる</button></div>
        <p class="muted small">どちらも、${esc(k.target)} をこのタスクのブランチに取り込んで解消します。${esc(k.target)} 自体は解消が終わってマージするまで変わりません。</p>`;
    return `<div class="cf-box">
      <b>⚠ ${k.pr ? `PR が ${esc(k.target)} とコンフリクトしています` : `${esc(k.target)} とコンフリクトしています`}${k.unresolved && k.unresolved.length ? '（まだ残っています）' : ''}</b>
      ${files.length ? `<ul class="cf-files">${files.map((f) => `<li class="mono">${esc(f)}</li>`).join('')}</ul>` : '<p class="muted small">コンフリクトしているファイルは、解消を始めると表示されます。</p>'}
      ${actions}
    </div>`;
  }
  if (c.conflictResolved && !busy && (c.status === 'review' || c.status === 'failed')) {
    const r = c.conflictResolved;
    if (r.pr)
      return `<div class="cf-box ok"><b>✓ origin/${esc(r.target)} を取り込んで、コンフリクトを解消しました</b>
      <p class="small">差分タブで解消の内容を確かめてから、PR を更新（push）してください。</p>
      <div class="cf-actions"><button class="btn primary" data-cact="pushPr">PR を更新（push）</button><button class="btn ghost" data-cact="dismiss">閉じる</button></div></div>`;
    return `<div class="cf-box ok"><b>✓ ${esc(r.target)} を取り込んで、コンフリクトを解消しました</b>
      <p class="small">差分タブで解消の内容を確かめてから、マージしてください。</p>
      <div class="cf-actions"><button class="btn primary" data-cact="remerge">${esc(r.target)} にマージ${r.push ? 'して push' : ''}</button><button class="btn ghost" data-cact="dismiss">閉じる</button></div></div>`;
  }
  return '';
}

async function conflictAction(c, act) {
  if (act === 'agent') return runBusy('Claude に解消を頼んでいます…', () => api.resolveConflict(c.id, 'agent'), 'Claude に解消を頼みました');
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
function collectAnswers(form, c) {
  const req = (c.questions || []).find((r) => r.id === form.dataset.req);
  if (!req) return null;
  const answers = {};
  req.questions.forEach((q, i) => {
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
      ${c.skill ? `<div class="card-skill-row"><span class="skill-chip small" title="最初の指示で使うスキル">⚡ /${esc(c.skill)}</span></div>` : ''}
      ${c.error && c.status === 'failed' ? `<div class="card-err">${esc(c.error)}</div>` : ''}
      ${c.lastMessage && !waiting ? `<div class="card-msg">${esc(c.lastMessage)}</div>` : ''}
      ${isInterrupted(c) ? `<div class="int-quick"><button class="btn small primary" data-resume="${c.id}" title="中断したところから続けます">▶ 再開</button></div>` : ''}
      ${questionCompactHtml(c)}
      ${permissionBlock(c, true)}
      <div class="card-meta">
        ${c.branch ? `<span title="${esc(c.branch)}">⎇ ${esc(c.branch.replace(/^agent\//, ''))}</span>` : ''}
        ${c.costUsd ? `<span>$${c.costUsd.toFixed(2)}</span>` : ''}
      </div>
    </div>`;
}

function renderBoard() {
  const { settings, cards } = state.board;
  renderInterruptBanner();
  $('repoBtn').textContent = settings.repoPath ? `📁 ${settings.repoPath}` : '📁 リポジトリを選ぶ';
  $('baseInfo').textContent = settings.repoPath ? `ベース: ${settings.baseBranch || 'チェックアウト中のブランチ'}` : '';
  // 会話は同時実行数に数えない
  const running = cards.filter((c) => c.status === 'running' && !isChat(c)).length;
  const queued = cards.filter((c) => c.status === 'queued' && !isChat(c)).length;
  const waiting = cards.filter((c) => needsYou(c)).length;
  const total = Number(state.board.totalCostUsd) || 0;
  $('costInfo').classList.toggle('hidden', !settings.repoPath);
  $('costInfo').textContent = `合計 $${total.toFixed(2)}`;
  renderNotifications();
  $('runInfo').innerHTML = `実行中 ${running}/${settings.maxParallel || 1}${queued ? ` ・ 待機 ${queued}` : ''}${waiting ? ` ・ <b class="warn">あなたの対応待ち ${waiting}</b>` : ''}`;

  if (!settings.repoPath) {
    $('board').innerHTML = `<div class="empty-state"><h2>まずリポジトリを選んでください</h2><p>タスクごとにこのリポジトリの git worktree を作って、Claude Code を並列に動かします。</p><button class="btn primary" id="emptyRepo">リポジトリを選ぶ</button></div>`;
    $('emptyRepo').onclick = chooseRepo;
    return;
  }
  $('board').innerHTML = COLUMNS.map((col) => {
    const list = cards
      .filter((c) => (col.chat ? isChat(c) : !isChat(c) && col.statuses.includes(c.status)))
      .sort((a, b) => (needsYou(b) ? 1 : 0) - (needsYou(a) ? 1 : 0) || b.createdAt - a.createdAt);
    return `
      <section class="column ${col.chat ? 'chat-col' : ''}" data-col="${col.key}">
        <header><span>${col.label}</span><span class="count">${list.length}</span></header>
        <div class="cards">${list.map(cardHtml).join('') || `<div class="col-empty">${col.key === 'todo' ? '「＋ 新しいタスク」から追加' : col.chat ? '「💬 会話」から、タスクを作らずに Claude と話せます' : 'なし'}</div>`}</div>
      </section>`;
  }).join('');
}

// ボード上のクリック・ドラッグ（イベント委譲）
$('board').addEventListener('click', (e) => {
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
});
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
    <b>⏸ アプリの終了で中断されました</b>${it.at ? `<span class="muted small">（${esc(new Date(it.at).toLocaleString())}）</span>` : ''}
    <p class="small">${esc(how)}別の指示で続けたいときは、下の欄から追加指示を送ってください。</p>
    <div class="cf-actions"><button class="btn primary" data-act="resume">▶ 再開</button><button class="btn ghost" data-act="dismissInterrupted" title="再開せずに、中断の表示だけ消します">再開しない</button></div>
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
  el.innerHTML = `<span>⏸ 前回アプリを終了したときに、<b>${list.length} 件</b>のタスクが中断されました。</span>
    <button class="btn small primary" id="resumeAllBtn">▶ すべて再開</button>
    <button class="btn small ghost" id="interruptLater">あとで</button>`;
  el.classList.remove('hidden');
  $('resumeAllBtn').onclick = () => runBusy('タスクを再開しています…', () => api.resumeAll().then((n) => `${n} 件のタスクを再開しました`)).then((m) => m && toast(m, 'ok'));
  $('interruptLater').onclick = () => {
    state.interruptDismissed = true;
    renderInterruptBanner();
  };
}

// ---------------- 詳細パネル ----------------

async function select(id) {
  state.selected = id;
  state.headSig = '';
  $('detail').classList.remove('hidden');
  $('followInput').value = '';
  state.followSkill = null;
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
  renderBoard();
}

function renderDetailHead() {
  const c = card(state.selected);
  if (!c) return closeDetail();
  const sig = JSON.stringify([c.conflict, c.conflictResolved, c.status, c.title, c.error, c.branch, c.worktreePath, c.costUsd, c.permissions, c.alwaysAllow, c.mergedInto, c.pushedTo, c.prUrl, c.prBase, c.prState, c.prMergeable, state.board.settings.integration, c.sessionId, c.forkNext, c.sessions, c.questions, c.awaitingReply, c.interrupted]);
  if (sig === state.headSig) return;
  state.headSig = sig;
  const s = c.status;
  const chat = isChat(c);
  const btns = chat ? [
    isInterrupted(c) && `<button class="btn primary" data-act="resume" title="中断したところから続けます">▶ 再開</button>`,
    (s === 'running' || s === 'queued') && `<button class="btn" data-act="stop">■ 停止</button>`,
    c.sessionId && s !== 'running' && s !== 'queued' &&
      `<button class="btn" data-act="toTask" title="この会話の続きとして、worktree で作業するタスクを作ります（会話はそのまま残ります）">📝 タスクにする</button>`,
    `<button class="btn danger" data-act="discard">削除</button>`,
  ].filter(Boolean) : [
    isInterrupted(c) && `<button class="btn primary" data-act="resume" title="中断したところから続けます">▶ 再開</button>`,
    s === 'todo' && !isInterrupted(c) && `<button class="btn primary" data-act="start">▶ 開始</button>`,
    (s === 'running' || s === 'queued') && `<button class="btn" data-act="stop">■ 停止</button>`,
    (s === 'review' || s === 'failed') && c.worktreePath &&
      (state.board.settings.integration === 'pr'
        ? `<button class="btn primary" data-act="pr">${c.prUrl ? '⇡ PR を更新…' : '⇡ PR を作成…'}</button>`
        : `<button class="btn primary" data-act="merge">⇲ マージ…</button>`),
    c.worktreePath && `<button class="btn ghost" data-act="open">フォルダを開く</button>`,
    `<button class="btn danger" data-act="discard">${s === 'done' ? '削除' : '破棄'}</button>`,
  ].filter(Boolean);
  $('detailHead').innerHTML = `
    <div class="d-title-row">
      <span class="badge b-${badgeFor(c)[0]}">${badgeFor(c)[1]}</span>
      <h2 class="d-title">${esc(c.title)}</h2>
      <button class="icon" id="closeDetail" title="閉じる">✕</button>
    </div>
    <dl class="d-meta">
      ${c.issue ? `<dt>Issue</dt><dd><a class="issue-chip" data-url="${esc(c.issue.url)}">#${c.issue.number}</a> ${esc(c.issue.url)}</dd>` : ''}
      ${sessionRowHtml(c)}
      ${chat ? `<dt>場所</dt><dd class="mono">${esc(c.repoPath)} <span class="muted small">（worktree は作りません）</span></dd>` : ''}
      ${c.branch ? `<dt>ブランチ</dt><dd>${esc(c.branch)} ← ${esc(c.baseBranch)}</dd>` : ''}
      ${c.worktreePath ? `<dt>worktree</dt><dd class="mono">${esc(c.worktreePath)}</dd>` : ''}
      ${c.prUrl ? `<dt>PR</dt><dd><a class="issue-chip" data-url="${esc(c.prUrl)}">${esc(c.prUrl)}</a>${c.prBase ? ` → ${esc(c.prBase)}` : ''}${c.prState === 'MERGED' ? '（マージ済み）' : c.prState === 'CLOSED' ? '（閉じられました）' : ''}${c.prState === 'OPEN' && c.prMergeable === 'CONFLICTING' ? ` <span class="badge b-conflict">コンフリクト</span>${c.worktreePath && !c.conflict && (s === 'review' || s === 'failed') ? ' <button class="btn small" data-act="prConflict">解消する</button>' : ''}` : ''}</dd>` : ''}
      ${(c.mergedInto || []).length ? `<dt>マージ済み</dt><dd>${c.mergedInto.map((b) => esc(b) + ((c.pushedTo || []).includes(b) ? '（origin にも push 済み）' : '')).join(', ')}</dd>` : ''}
      ${c.costUsd ? `<dt>コスト</dt><dd>$${c.costUsd.toFixed(3)}</dd>` : ''}
      ${(c.alwaysAllow || []).length ? `<dt>常に許可</dt><dd>${c.alwaysAllow.map(esc).join(', ')}</dd>` : ''}
    </dl>
    ${isInterrupted(c) ? interruptedBoxHtml(c) : c.error ? `<div class="d-error">${esc(c.error)}</div>` : ''}
    ${conflictBoxHtml(c)}
    ${questionFormHtml(c)}
    ${c.awaitingReply && (s === 'review' || s === 'failed') ? `<div class="d-awaiting"><b>💬 Claude が質問しています</b><p>${esc(String(c.lastText || '').slice(-600))}</p><small>下の欄に答えを書いて送ると、同じ会話の続きから進めます。</small></div>` : ''}
    ${permissionBlock(c, false)}
    <div class="d-actions">${btns.join('')}</div>`;
  $('closeDetail').onclick = closeDetail;
  const ds = $('dSession');
  if (ds) {
    ds.onchange = async () => {
      const v = ds.value;
      if (v === '__pick__') {
        state.headSig = '';
        renderDetailHead();
        return openSessionPicker(c);
      }
      const sess = v === '__new__' ? { mode: 'new' } : { mode: 'resume', id: v };
      await run(() => api.setSession(c.id, sess), v === '__new__' ? '次は新しい会話で始めます' : '次はこの会話の続きで始めます');
    };
  }
  const canFollow = canSendFollow(c);
  $('followInput').disabled = !canFollow;
  drawFollowSkill();
  $('followBtn').disabled = !canFollow;
  $('followInput').placeholder =
    chat ? (canFollow ? 'メッセージを送る（Ctrl/⌘ + Enter で送信）。同じ会話の続きとして話せます' : '返事が来たら、続きを話せます')
    : canFollow && c.awaitingReply ? 'Claude への回答を書く（Ctrl/⌘ + Enter で送信）'
    : s === 'done' ? '完了したタスクの続きを話す（Ctrl/⌘ + Enter で送信）。同じ場所に worktree を作り直して、同じ会話の続きから動きます'
    : canFollow ? '追加の指示を送る（Ctrl/⌘ + Enter で送信）。同じセッションの続きとして動きます'
    : s === 'todo' ? '開始すると、終わったあとに追加の指示を送れます'
    : 'エージェントの作業中は送れません';
}

$('detailHead').addEventListener('input', (e) => {
  if (!e.target.classList.contains('q-other')) return;
  const box = e.target.closest('.q-opt').querySelector('input[type=radio], input[type=checkbox]');
  if (box && e.target.value.trim()) box.checked = true;
});
$('detailHead').addEventListener('click', async (e) => {
  const ca = e.target.closest('[data-cact]');
  if (ca) {
    const c = card(state.selected);
    if (c) conflictAction(c, ca.dataset.cact);
    return;
  }
  const qa = e.target.closest('[data-qact]');
  if (qa) {
    const form = qa.closest('.qform');
    const c = card(form.dataset.card);
    if (!c) return;
    if (qa.dataset.qact === 'skip') return sendAnswer(c.id, form.dataset.req, null);
    const answers = collectAnswers(form, c);
    const empty = Object.entries(answers || {}).find(([, v]) => !v);
    if (empty) return toast(`「${empty[0]}」に答えてください`);
    return sendAnswer(c.id, form.dataset.req, answers);
  }
  const chip = e.target.closest('.issue-chip');
  if (chip) return run(() => api.openExternal(chip.dataset.url));
  const dec = e.target.closest('[data-decision]');
  if (dec) {
    const p = dec.closest('.perm');
    answer(p.dataset.card, p.dataset.req, dec.dataset.decision, p.querySelector('.deny-reason')?.value || '');
    return;
  }
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
  if (act === 'discard' && isChat(c)) {
    if (confirm(`会話「${c.title}」をボードから削除しますか？\n（Claude Code の会話の記録は残るので、あとで「既存の会話」から引き継げます）`)) {
      await runBusy('削除しています…', () => api.discard(c.id), '削除しました');
      closeDetail();
    }
    return;
  }
  if (act === 'discard') {
    const msg = c.status === 'done' ? `「${c.title}」をボードから削除しますか？` : `「${c.title}」を破棄しますか？\nworktree とブランチ ${c.branch || ''} も削除され、元に戻せません。`;
    if (confirm(msg)) {
      await runBusy(c.status === 'done' ? '削除しています…' : 'worktree とブランチを削除しています…', () => api.discard(c.id), '破棄しました');
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

function logEntryHtml(e) {
  const time = new Date(e.t).toLocaleTimeString();
  const sk = e.skill ? `<span class="skill-chip small">⚡ /${esc(e.skill)}</span> ` : '';
  return `<div class="log k-${e.kind}"><span class="log-k">${LOG_LABEL[e.kind] || e.kind}</span><span class="log-t">${time}</span><div class="log-x">${sk}${esc(e.text)}</div></div>`;
}

// ---------------- 差分タブ（GitHub 風: 左にファイルツリー、右にファイルごとの差分） ----------------

const DIFF_STATUS = { A: ['追加', 'fa'], M: ['変更', 'fm'], D: ['削除', 'fd'], R: ['名前変更', 'fr'] };
const DIFF_BIG = 600; // これより行数が多いファイルは最初は折りたたむ
// 折りたたみ・表示状態（更新しても保つ）
const diffUi = { cardId: null, collapsedDirs: new Set(), collapsedFiles: new Set(), openedBig: new Set(), tree: true, active: null };

function diffTreeHtml(node, depth) {
  const pad = (d) => `style="padding-left:${8 + d * 14}px"`;
  let html = '';
  for (const d of node.dirs) {
    const closed = diffUi.collapsedDirs.has(d.path);
    html += `<li class="dv-dir ${closed ? 'closed' : ''}"><div class="dv-row" data-dir="${esc(d.path)}" ${pad(depth)} title="${esc(d.path)}"><span class="dv-caret">▾</span><span class="dv-ico">📁</span><span class="dv-name">${esc(d.name)}</span></div>
      <ul>${diffTreeHtml(d, depth + 1)}</ul></li>`;
  }
  for (const f of node.files) {
    const [, cls] = DIFF_STATUS[f.file.status] || ['', 'fm'];
    const nums = f.file.binary ? '' : `<span class="dv-n"><span class="add">+${f.file.add}</span> <span class="del">-${f.file.del}</span></span>`;
    html += `<li><div class="dv-row dv-file ${diffUi.active === f.file.path ? 'active' : ''}" data-file="${f.index}" ${pad(depth)} title="${esc(f.file.path)}"><span class="dv-dot ${cls}"></span><span class="dv-name">${esc(f.name)}</span>${nums}</div></li>`;
  }
  return html;
}

function diffLinesHtml(file) {
  if (file.binary) return '<div class="dv-note">バイナリファイルのため表示できません</div>';
  if (!file.hunks.length) {
    const why = file.status === 'R' ? '中身は変わらず、名前だけ変わりました' : file.meta.length ? esc(file.meta.join(' / ')) : '表示できる差分はありません';
    return `<div class="dv-note">${why}</div>`;
  }
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
    <div class="diff-stat"><button class="btn small ghost" id="toggleDiffTree" title="ファイルツリーの表示を切り替えます">☰</button>
      <span><b>${files.length}</b> ファイル <span class="add">+${add}</span> <span class="del">-${del}</span></span>
      <span class="spacer"></span>
      <button class="btn small ghost" id="diffExpandAll">すべて開く</button><button class="btn small ghost" id="diffCollapseAll">すべて閉じる</button>
      <button class="btn small ghost" id="refreshDiff">更新</button></div>
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
    const r = $('refreshDiff');
    if (r) r.onclick = () => renderDiff(card(c.id) || c);
    bindDiff(body, files, draw);
    if ($('diffFiles')) $('diffFiles').scrollTop = keep;
  };
  draw();
}

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

const BTW_STATE = { sent: '送信済み', delivered: '反映済み', queued: '開始時に渡します', lost: '届きませんでした' };
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
}

async function renderDetailBody() {
  const c = card(state.selected);
  if (!c) return;
  const body = $('detailBody');
  if (state.tab === 'log') {
    const logs = state.logs.get(c.id) || [];
    body.innerHTML = logs.length ? logs.map(logEntryHtml).join('') : `<div class="muted pad">${isChat(c) ? 'まだ会話はありません。' : 'まだログはありません。「開始」を押すと Claude が動き出します。'}</div>`;
    body.scrollTop = body.scrollHeight;
  } else if (state.tab === 'diff') {
    await renderDiff(c);
  } else if (state.tab === 'worktree') {
    await renderWorktree(c);
  } else if (state.tab === 'btw') {
    const live = c.status === 'running' || c.status === 'queued';
    body.innerHTML = `<div class="pad btw">
      <p class="muted small">エージェントの作業を止めずに、メッセージを送れます（例:「テストも書いて」「その API は使わないで」）。Claude は今の作業の途中で読み、そのまま反映します。</p>
      <div id="btwList" class="btw-list">${btwListHtml(c)}</div>
      <textarea id="btwInput" rows="3" placeholder="${live ? 'btw: …（Ctrl/⌘ + Enter で送信）' : 'エージェントが実行中のときに送れます'}" ${live ? '' : 'disabled'}></textarea>
      <div class="btw-actions"><span class="muted small">${live ? (c.status === 'queued' ? '待機中なので、開始するときの指示に付け足します' : '送ると、すぐに実行中のエージェントに届きます') : c.status === 'todo' ? '開始すると送れるようになります' : '作業が終わったあとは、下の「追加指示」を使ってください'}</span>
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
      <div class="field"><span>最初の指示</span><div id="editSkill" class="skill-slot"></div><textarea id="editPrompt" rows="14" ${editable ? '' : 'disabled'}>${esc(c.prompt)}</textarea></div>
      ${editable ? '<button class="btn primary" id="saveEdit">保存</button>' : '<p class="muted">開始後は編集できません。変更したいときは追加指示を送ってください。</p>'}
    </div>`;
    let editSkill = c.skill || null;
    const drawEditSkill = () => renderSkillSlot('editSkill', editSkill, (v) => ((editSkill = v), drawEditSkill()), { disabled: !editable });
    drawEditSkill();
    if (editable) $('saveEdit').onclick = () => runBusy('保存しています…', () => api.updateCard({ id: c.id, title: $('editTitle').value, prompt: $('editPrompt').value, skill: editSkill || '' }), '保存しました');
  }
}

// 追加指示を送れる状態か（完了したタスクにも送れる。送ると worktree を作り直して続きから動く）
function canSendFollow(c) {
  return !!c && (c.status === 'review' || c.status === 'failed' || c.status === 'done');
}

function drawFollowSkill() {
  const c = card(state.selected);
  const can = canSendFollow(c);
  renderSkillSlot('followSkill', state.followSkill, (v) => ((state.followSkill = v), drawFollowSkill()), { disabled: !can });
}

async function sendFollow() {
  const c = card(state.selected);
  const msg = $('followInput').value.trim();
  if (!c || !msg) return;
  const ok = await run(() => api.send(c.id, msg, state.followSkill).then(() => true));
  if (ok) {
    $('followInput').value = '';
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
  $('modalBox').innerHTML = html;
  $('modal').classList.remove('hidden');
  onReady?.();
}
function closeModal() {
  $('modal').classList.add('hidden');
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

function newTask(opts = {}) {
  if (!state.board.settings.repoPath) return chooseRepo();
  const from = opts.fromChat;
  openModal(
    `<h2>新しいタスク</h2>
     ${from ? `<p class="muted small">会話「${esc(from.title)}」の続きとして、タスクを始めます（会話の内容を Claude が引き継ぎます。会話そのものはそのまま残ります）。</p>` : ''}
     <label class="field"><span>タイトル（省略すると指示の1行目）</span><input id="nTitle" placeholder="例: ログイン画面にパスワード表示ボタンを追加" /></label>
     <div class="field"><span>Claude への指示</span><div id="nSkill" class="skill-slot"></div><textarea id="nPrompt" rows="10" placeholder="やってほしいことを具体的に書いてください。テストの実行方法なども書いておくと確実です。"></textarea></div>
     ${sessionFieldHtml('n')}
     <p class="muted small">GitHub の Issue から作るときは、右上の「Issue から作成」を使ってください。</p>
     <label class="check"><input type="checkbox" id="nStart" checked /> 作成したらすぐに開始する</label>
     <div class="modal-actions"><button class="btn ghost" id="nCancel">キャンセル</button><button class="btn primary" id="nOk">作成（Ctrl/⌘ + Enter）</button></div>`,
    () => {
      $('nPrompt').focus();
      if (from) $('nPrompt').value = 'ここまでの会話の内容をもとに、作業を進めてください。';
      fillSessionField('n', from ? { id: from.sessionId, title: `会話: ${from.title}` } : undefined);
      let skill = state.board.settings.defaultSkill || null;
      const drawSkill = () => renderSkillSlot('nSkill', skill, (v) => ((skill = v), drawSkill()));
      drawSkill();
      const submit = async () => {
        const id = await runBusy('タスクを作成しています…', () => api.createCard({ title: $('nTitle').value, prompt: $('nPrompt').value, autoStart: $('nStart').checked, session: readSessionField('n'), skill }));
        if (id) {
          closeModal();
          select(id);
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

// タスクに紐づかない会話を始める（worktree を作らず、リポジトリのフォルダでそのまま話す）
function newChat() {
  if (!state.board.settings.repoPath) return chooseRepo();
  openModal(
    `<h2>💬 会話を始める</h2>
     <p class="muted small">タスクを作らずに、このリポジトリについて Claude と話せます（質問・調べもの・相談など）。worktree やブランチは作らず、コミットやマージもしません。</p>
     <div class="field"><span>メッセージ</span><div id="cSkill" class="skill-slot"></div><textarea id="cMsg" rows="6" placeholder="例: このリポジトリの全体の構成を教えて"></textarea></div>
     <label class="field"><span>タイトル（省略するとメッセージの1行目）</span><input id="cTitle" /></label>
     ${sessionFieldHtml('c')}
     <p class="muted small">会話はリポジトリのフォルダ（手元の作業中のファイル）でそのまま動くので、ファイルの変更やコマンドは毎回カードで確かめます。作業してほしくなったら、詳細画面の「📝 タスクにする」で会話の続きからタスクを作れます。</p>
     <div class="modal-actions"><button class="btn ghost" id="cCancel">キャンセル</button><button class="btn primary" id="cOk">話しかける（Ctrl/⌘ + Enter）</button></div>`,
    () => {
      $('cMsg').focus();
      fillSessionField('c');
      let skill = null;
      const drawSkill = () => renderSkillSlot('cSkill', skill, (v) => ((skill = v), drawSkill()));
      drawSkill();
      const submit = async () => {
        const id = await runBusy('会話を始めています…', () => api.createChat({ message: $('cMsg').value, title: $('cTitle').value, session: readSessionField('c'), skill }));
        if (id) {
          closeModal();
          select(id);
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
    el.innerHTML = value ? `<span class="skill-chip off">⚡ /${esc(value)}</span>` : '';
    return;
  }
  el.innerHTML = value
    ? `<span class="skill-chip" title="このスキルを使って実行します">⚡ /${esc(value)}<button type="button" class="chip-x" title="スキルを外す">×</button></span><button type="button" class="btn small ghost skill-pick">変更</button>`
    : `<button type="button" class="btn small ghost skill-pick">⚡ スキルを選ぶ</button>`;
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
    <p class="muted small">1つだけ選べます。選んだスキルは、指示の先頭に <code>/スキル名</code> として付けて Claude に渡します。</p>
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
  const own = (c.sessions || []).filter((x) => x.origin === 'task');
  const imported = (c.sessions || []).find((x) => x.origin === 'imported' && x.id === c.sessionId && c.forkNext);
  const opts = [
    `<option value="__new__" ${!c.sessionId ? 'selected' : ''}>新しい会話で始める</option>`,
    ...own.map((x, i) => {
      const src = x.from && (c.sessions || []).find((y) => y.id === x.from);
      const label = src ? `← 引き継ぎ: ${src.label || src.id.slice(0, 8)}` : x.label || '';
      return `<option value="${esc(x.id)}" ${x.id === c.sessionId && !c.forkNext ? 'selected' : ''}>会話 ${i + 1}（${esc(fmtTime(x.at))}） ${esc(label)}</option>`;
    }),
    imported ? `<option value="${esc(imported.id)}" selected>引き継ぐ: ${esc(imported.label || imported.id.slice(0, 8))}</option>` : '',
    `<option value="__pick__">既存の会話から選ぶ…</option>`,
  ].join('');
  return `<dt>会話</dt><dd><select id="dSession" class="d-session" ${busy ? 'disabled title="実行中は切り替えられません"' : ''}>${opts}</select>
</dd>`;
}

// ---------------- GitHub Issue から作る ----------------

// Issue 番号からカードを作る（上部の枠と、詳細ダイアログの両方から使う）
async function createFromIssues(numbers, extra, autoStart, session, skill) {
  const r = await runBusy('Issue を読み込んでタスクを作成しています…', () => api.createFromIssues({ numbers, extra, autoStart, session, skill }));
  if (!r) return false;
  if (r.errors.length) toast(r.errors.join('\n'));
  else toast(`${r.ids.length} 件のタスクを Issue から作りました`, 'ok');
  if (r.ids.length === 1) select(r.ids[0]);
  return true;
}

// Issue から作成するダイアログ（Issue 番号・会話・追加の指示・gh の準備）
function openIssueModal(prefill = '') {
  if (!state.board.settings.repoPath) return chooseRepo();
  openModal(
    `<h2>Issue から作成</h2>
     <label class="field"><span>Issue 番号（複数ならカンマかスペースで区切る。1つの Issue が1枚のカードになり、並列で動きます）</span>
       <input id="nNumbers" placeholder="例: 12 または 12, 15, 18" inputmode="numeric" value="${esc(prefill)}" /></label>
     <p class="muted small" id="nRepoInfo">リポジトリを確認しています…</p>
     <div id="ghPanel" class="gh-panel">gh（GitHub CLI）を確認しています…</div>
     ${sessionFieldHtml('n')}
     <div class="field"><span>追加の指示（任意・すべての Issue に付けます）</span><div id="nSkill" class="skill-slot"></div><textarea id="nExtra" rows="4" placeholder="例: 変更したらテストを追加して npm test で確認して"></textarea></div>
     <label class="check"><input type="checkbox" id="nStart" checked /> 作成したらすぐに開始する</label>
     <div class="modal-actions"><button class="btn ghost" id="nCancel">キャンセル</button><button class="btn primary" id="nOk">Issue からタスクを作成</button></div>`,
    () => {
      $('nNumbers').focus();
      api.repoGithub().then(
        (g) => {
          const el = $('nRepoInfo');
          if (!el) return;
          if (!g || !g.slug) el.textContent = '⚠ このリポジトリの origin が GitHub ではないため、Issue を読み込めません。';
          else el.textContent = `${g.slug.owner}/${g.slug.repo} の Issue を読み込みます。`;
        },
        () => {},
      );
      refreshGh();
      fillSessionField('n');
      let skill = state.board.settings.defaultSkill || null;
      const drawSkill = () => renderSkillSlot('nSkill', skill, (v) => ((skill = v), drawSkill()));
      drawSkill();
      const submit = async () => {
        $('nOk').disabled = true;
        $('nOk').textContent = 'Issue を読み込んでいます…';
        const ok = await createFromIssues($('nNumbers').value, $('nExtra').value, $('nStart').checked, readSessionField('n'), skill);
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
  const body = [c.issue ? `Closes #${c.issue.number}\n` : '', c.lastMessage ? `${c.lastMessage}\n` : '', '---\nClaude Agent Kanban のタスクから作成しました。'].join('\n').trim();
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

async function openSettings() {
  const s = state.board.settings;
  const info = (await run(() => api.repoInfo())) || { branches: [], current: '' };
  openModal(
    `<h2>設定</h2>
     <label class="field"><span>ベースブランチ（worktree の作成元・マージ先）</span>
       <select id="sBase"><option value="">チェックアウト中のブランチ${info.current ? `（今は ${esc(info.current)}）` : ''}</option>
       ${info.branches.map((b) => `<option ${b === s.baseBranch ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>
     <label class="field"><span>レビュー後の取り込み方</span>
       <select id="sIntegration">
         <option value="merge" ${s.integration !== 'pr' ? 'selected' : ''}>直接マージする（ローカルで git merge）</option>
         <option value="pr" ${s.integration === 'pr' ? 'selected' : ''}>PR を作成する（origin に push して gh pr create）</option>
       </select>
       <small>レビュー中のタスクに出るボタンが「マージ」か「PR を作成」に変わります。PR の作成には gh のインストールとログインが必要です。</small></label>
     <label class="field"><span>ブランチの命名規則（自然言語で書けます）</span>
       <textarea id="sBranchRule" rows="2" placeholder="例: feature/<Issue番号>-<内容を表す短い英語> にする。Issue がないときは feature/<内容を表す短い英語>">${esc(s.branchNamingRule || '')}</textarea>
       <small>書いておくと、タスクの開始時に Claude がこの規則に従ってブランチ名を考えます。空なら agent/issue-12-xxxx のような名前になります。決められなかったときも、この名前になります。</small></label>
     <div class="field">
       <label class="check"><input type="checkbox" id="sIssueSync" ${s.issueStatusSync !== false ? 'checked' : ''} /> Issue のステータスを自動で変える（GitHub Projects）</label>
       <small>Issue から作ったタスクが「実行中」になると In progress、「レビュー」になると In review、マージして「完了」になると Done に、Issue が入っている Project の Status を変えます。gh に project の権限が必要です。</small>
       <div class="status-map">
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
     <label class="field"><span>最初から許可しておくツール（カンマか改行で区切る）</span>
       <textarea id="sAllowed" rows="2" placeholder="例: Bash(npm test:*), Bash(git status), WebSearch">${esc(s.allowedTools)}</textarea></label>
     <div class="row">
       <label class="field"><span>同時に動かす数</span><input id="sMax" type="number" min="1" max="10" value="${esc(s.maxParallel)}" /></label>
       <label class="field"><span>モデル（空なら既定）</span><input id="sModel" placeholder="例: sonnet / opus" value="${esc(s.model)}" /></label>
     </div>
     <div class="field"><span>新しいタスクで最初から選んでおくスキル</span><div id="sSkill" class="skill-slot"></div>
       <small>「＋ 新しいタスク」と「Issue から作成」を開いたときに、このスキルが選ばれた状態になります（その場で外したり変えたりできます）。</small></div>
     <label class="check"><input type="checkbox" id="sSuggestSkills" ${s.suggestSkillsOnDone !== false ? 'checked' : ''} /> タスクが完了したら、スキルにしないか通知で聞く（右上の 🔔）</label>
     <label class="field"><span>claude コマンドのパス</span><input id="sClaude" value="${esc(s.claudePath)}" /></label>

     <div class="modal-actions"><button class="btn ghost" id="sCancel">キャンセル</button><button class="btn primary" id="sOk">保存</button></div>`,
    () => {
      let defSkill = s.defaultSkill || null;
      const drawDef = () => renderSkillSlot('sSkill', defSkill, (v) => ((defSkill = v), drawDef()));
      drawDef();
      refreshGh();
      $('sCancel').onclick = closeModal;
      $('sOk').onclick = async () => {
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
            defaultSkill: defSkill || '',
            issueStatusSync: $('sIssueSync').checked,
            suggestSkillsOnDone: $('sSuggestSkills').checked,
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

async function chooseRepo() {
  const r = await run(() => api.chooseRepo());
  if (r) {
    closeDetail();
    state.board = await api.getBoard();
    renderBoard();
  }
}

$('repoBtn').onclick = chooseRepo;
$('newBtn').onclick = () => newTask();
$('chatBtn').onclick = newChat;
$('issueBtn').onclick = () => openIssueModal();
$('settingsBtn').onclick = openSettings;

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
    el.innerHTML = `<span>✓ gh で GitHub にログインしています${st.user ? `（<b>${esc(st.user)}</b>）` : ''}</span>
      <p>Issue のステータス（GitHub Projects の In progress / In review / Done）を自動で変えるには、project の権限が必要です。</p>
      <p><button class="btn primary small" id="ghScope">Projects の権限を追加</button> <span class="muted small">ブラウザが開くので、表示されたコードを入力します</span></p>
      <div><button class="btn small ghost" id="ghRecheck">もう一度確認</button></div>${log}`;
    $('ghScope').onclick = () => ghAction('scope');
    $('ghRecheck').onclick = refreshGh;
    return;
  }
  el.className = 'gh-panel ok';
  el.innerHTML = `<span>✓ gh で GitHub にログインしています${st.user ? `（<b>${esc(st.user)}</b>）` : ''}</span>`;
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

const NOTIF_ICON = { permission: '🔐', question: '❓', awaiting: '💬', review: '👀', failed: '⚠️', done: '✅', skill: '💡', conflict: '⚔️' };

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
    <span class="notif-icon">${NOTIF_ICON[n.kind] || '🔔'}</span>
    <div class="notif-main">
      <div class="notif-title">${esc(n.title)}</div>
      ${n.body ? `<div class="notif-body">${esc(n.body)}</div>` : ''}
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
    if (n && n.action === 'suggestSkills' && c && c.status === 'done' && !confirm('完了したタスクの続きとして、worktree を作り直して Claude にスキルを提案してもらいます。よろしいですか？')) return;
    const ok = await runBusy('スキルの提案を頼んでいます…', () => api.actNotification(act.dataset.nact).then(() => true), 'スキルの提案を頼みました。返事が来たら、下の欄から追加したいものを伝えてください');
    if (ok && c) {
      closeNotifications();
      select(c.id);
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

api.onBoard((board) => {
  state.board = board;
  renderBoard();
  if (state.selected) {
    renderDetailHead();
    const c = card(state.selected);
    if (c) {
      updateBtwTab(c);
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
api.onLog(({ id, entry }) => {
  if (!state.logs.has(id)) return;
  state.logs.get(id).push(entry);
  if (state.selected === id && state.tab === 'log') {
    const body = $('detailBody');
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
    body.querySelector('.muted.pad')?.remove();
    body.insertAdjacentHTML('beforeend', logEntryHtml(entry));
    if (atBottom) body.scrollTop = body.scrollHeight;
  }
});
api.onFocus((id) => card(id) && select(id));

setInterval(() => {
  document.querySelectorAll('.elapsed[data-since]').forEach((el) => (el.textContent = elapsed(Number(el.dataset.since))));
}, 1000);

// git / claude が見つからないときは画面上部に案内を出す
async function checkEnv() {
  const env = await run(() => api.checkEnv());
  if (!env) return;
  const msgs = [];
  if (!env.git) msgs.push(`git が見つかりません。${env.platform === 'win32' ? 'Git for Windows（https://git-scm.com/）' : env.platform === 'darwin' ? 'ターミナルで xcode-select --install を実行するか Homebrew で git' : 'git'} をインストールしてから、アプリを再起動してください。`);
  if (!env.claude) msgs.push('claude コマンドが見つかりません。Claude Code をインストールしてログインするか、⚙ 設定で claude のフルパスを指定してください（ターミナルで which claude、Windows なら where claude で調べられます）。');
  const el = $('envBanner');
  el.innerHTML = msgs.map((m) => `<div>⚠ ${esc(m)}</div>`).join('');
  el.classList.toggle('hidden', msgs.length === 0);
}

// 左上に、いま動いているアプリのバージョンを出す
api.appInfo().then(
  (i) => {
    $('appVersion').textContent = `v${i.version}${i.packaged ? '' : '（開発版）'}`;
    $('appVersion').title = `Claude Agent Kanban v${i.version}`;
  },
  () => {},
);

// 右側の詳細パネルは、左端をドラッグして幅を変えられる（タブを切り替えても幅は変わらない）
(function setupDetailResize() {
  const KEY = 'detailWidth';
  const panel = $('detail');
  const handle = $('detailResizer');
  const MIN = 360;
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

(async () => {
  state.board = await api.getBoard();
  renderBoard();
  checkEnv();
})();
