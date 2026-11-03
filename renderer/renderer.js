/* global api */
const COLUMNS = [
  { key: 'todo', label: 'Todo', statuses: ['todo'], hint: 'ここから「実行中」へドラッグしても開始できます' },
  { key: 'running', label: '実行中', statuses: ['queued', 'running'] },
  { key: 'review', label: 'レビュー', statuses: ['review', 'failed'] },
  { key: 'done', label: '完了', statuses: ['done'] },
];
const STATUS_LABEL = { todo: '未着手', queued: '待機中', running: '実行中', review: 'レビュー待ち', failed: 'エラー', done: 'マージ済み' };
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
function badgeFor(c) {
  if ((c.questions || []).length) return ['question', '質問'];
  if ((c.permissions || []).length) return ['waiting', '承認待ち'];
  if (c.awaitingReply && (c.status === 'review' || c.status === 'failed')) return ['awaiting', '回答待ち'];
  return [c.status, STATUS_LABEL[c.status]];
}
function needsYou(c) {
  return (c.questions || []).length || (c.permissions || []).length || (c.awaitingReply && c.status === 'review');
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
    <div class="card s-${c.status} ${waiting ? (bcls === 'waiting' ? 'waiting' : 'asking') : ''} ${state.selected === c.id ? 'selected' : ''}" draggable="${c.status === 'todo'}" data-id="${c.id}">
      <div class="card-top">
        <span class="badge b-${bcls}">${blabel}</span>
        ${since ? `<span class="elapsed" data-since="${since}">${elapsed(since)}</span>` : ''}
      </div>
      <div class="card-title">${c.issue ? `<a class="issue-chip" data-url="${esc(c.issue.url)}" title="Issue を開く">#${c.issue.number}</a> ${esc(c.title.replace(/^#\d+\s*/, ''))}` : esc(c.title)}</div>
      ${c.skill ? `<div class="card-skill-row"><span class="skill-chip small" title="最初の指示で使うスキル">⚡ /${esc(c.skill)}</span></div>` : ''}
      ${c.error && c.status === 'failed' ? `<div class="card-err">${esc(c.error)}</div>` : ''}
      ${c.lastMessage && !waiting ? `<div class="card-msg">${esc(c.lastMessage)}</div>` : ''}
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
  $('repoBtn').textContent = settings.repoPath ? `📁 ${settings.repoPath}` : '📁 リポジトリを選ぶ';
  $('baseInfo').textContent = settings.repoPath ? `ベース: ${settings.baseBranch || 'チェックアウト中のブランチ'}` : '';
  const running = cards.filter((c) => c.status === 'running').length;
  const queued = cards.filter((c) => c.status === 'queued').length;
  const waiting = cards.filter((c) => needsYou(c)).length;
  $('runInfo').innerHTML = `実行中 ${running}/${settings.maxParallel || 1}${queued ? ` ・ 待機 ${queued}` : ''}${waiting ? ` ・ <b class="warn">あなたの対応待ち ${waiting}</b>` : ''}`;

  if (!settings.repoPath) {
    $('board').innerHTML = `<div class="empty-state"><h2>まずリポジトリを選んでください</h2><p>タスクごとにこのリポジトリの git worktree を作って、Claude Code を並列に動かします。</p><button class="btn primary" id="emptyRepo">リポジトリを選ぶ</button></div>`;
    $('emptyRepo').onclick = chooseRepo;
    return;
  }
  $('board').innerHTML = COLUMNS.map((col) => {
    const list = cards
      .filter((c) => col.statuses.includes(c.status))
      .sort((a, b) => (needsYou(b) ? 1 : 0) - (needsYou(a) ? 1 : 0) || b.createdAt - a.createdAt);
    return `
      <section class="column" data-col="${col.key}">
        <header><span>${col.label}</span><span class="count">${list.length}</span></header>
        <div class="cards">${list.map(cardHtml).join('') || `<div class="col-empty">${col.key === 'todo' ? '「＋ 新しいタスク」から追加' : 'なし'}</div>`}</div>
      </section>`;
  }).join('');
}

// ボード上のクリック・ドラッグ（イベント委譲）
$('board').addEventListener('click', (e) => {
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
  if (card(id)?.status === 'todo') run(() => api.start(id));
});

async function answer(cardId, reqId, decision, message) {
  await run(() => api.answerPermission(cardId, reqId, decision, message), decision === 'deny' ? '拒否しました' : '許可しました');
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
  if (!state.logs.has(id)) {
    const logs = await run(() => api.logs(id));
    state.logs.set(id, logs || []);
  }
  renderDetailBody();
}

function closeDetail() {
  state.selected = null;
  $('detail').classList.add('hidden');
  renderBoard();
}

function renderDetailHead() {
  const c = card(state.selected);
  if (!c) return closeDetail();
  const sig = JSON.stringify([c.status, c.title, c.error, c.branch, c.worktreePath, c.costUsd, c.permissions, c.alwaysAllow, c.mergedInto, c.sessionId, c.forkNext, c.sessions, c.questions, c.awaitingReply]);
  if (sig === state.headSig) return;
  state.headSig = sig;
  const s = c.status;
  const btns = [
    s === 'todo' && `<button class="btn primary" data-act="start">▶ 開始</button>`,
    (s === 'running' || s === 'queued') && `<button class="btn" data-act="stop">■ 停止</button>`,
    (s === 'review' || s === 'failed') && c.worktreePath && `<button class="btn primary" data-act="merge">⇲ マージ…</button>`,
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
      ${c.branch ? `<dt>ブランチ</dt><dd>${esc(c.branch)} ← ${esc(c.baseBranch)}</dd>` : ''}
      ${c.worktreePath ? `<dt>worktree</dt><dd class="mono">${esc(c.worktreePath)}</dd>` : ''}
      ${(c.mergedInto || []).length ? `<dt>マージ済み</dt><dd>${c.mergedInto.map(esc).join(', ')}</dd>` : ''}
      ${c.costUsd ? `<dt>コスト</dt><dd>$${c.costUsd.toFixed(3)}</dd>` : ''}
      ${(c.alwaysAllow || []).length ? `<dt>常に許可</dt><dd>${c.alwaysAllow.map(esc).join(', ')}</dd>` : ''}
    </dl>
    ${c.error ? `<div class="d-error">${esc(c.error)}</div>` : ''}
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
  const canFollow = s === 'review' || s === 'failed';
  $('followInput').disabled = !canFollow;
  drawFollowSkill();
  $('followBtn').disabled = !canFollow;
  $('followInput').placeholder = canFollow && c.awaitingReply ? 'Claude への回答を書く（Ctrl/⌘ + Enter で送信）' : canFollow ? '追加の指示を送る（Ctrl/⌘ + Enter で送信）。同じセッションの続きとして動きます' : s === 'todo' ? '開始すると、終わったあとに追加の指示を送れます' : 'エージェントの作業中は送れません';
}

$('detailHead').addEventListener('input', (e) => {
  if (!e.target.classList.contains('q-other')) return;
  const box = e.target.closest('.q-opt').querySelector('input[type=radio], input[type=checkbox]');
  if (box && e.target.value.trim()) box.checked = true;
});
$('detailHead').addEventListener('click', async (e) => {
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
  if (act === 'start') run(() => api.start(c.id));
  if (act === 'stop') run(() => api.stop(c.id));
  if (act === 'open') run(() => api.open(c.id));
  if (act === 'merge') openMerge(c);
  if (act === 'discard') {
    const msg = c.status === 'done' ? `「${c.title}」をボードから削除しますか？` : `「${c.title}」を破棄しますか？\nworktree とブランチ ${c.branch || ''} も削除され、元に戻せません。`;
    if (confirm(msg)) {
      await run(() => api.discard(c.id), '破棄しました');
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

function diffHtml(text) {
  if (!text.trim()) return '<div class="muted pad">まだ変更はありません</div>';
  const lines = text.split('\n');
  const files = lines.filter((l) => l.startsWith('diff --git')).length;
  const add = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  const del = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  const shown = lines.slice(0, 8000);
  return `<div class="diff-stat">${files} ファイル <span class="add">+${add}</span> <span class="del">-${del}</span> <button class="btn small ghost" id="refreshDiff">更新</button></div>
    <pre class="diff">${shown
      .map((l) => {
        let cls = '';
        if (l.startsWith('diff --git')) cls = 'df';
        else if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('index ') || l.startsWith('new file')) cls = 'dm';
        else if (l.startsWith('@@')) cls = 'dh';
        else if (l.startsWith('+')) cls = 'da';
        else if (l.startsWith('-')) cls = 'dd';
        return `<span class="${cls}">${esc(l) || ' '}</span>`;
      })
      .join('\n')}${lines.length > shown.length ? `\n… ほか ${lines.length - shown.length} 行` : ''}</pre>`;
}

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
    body.innerHTML = logs.length ? logs.map(logEntryHtml).join('') : '<div class="muted pad">まだログはありません。「開始」を押すと Claude が動き出します。</div>';
    body.scrollTop = body.scrollHeight;
  } else if (state.tab === 'diff') {
    body.innerHTML = '<div class="muted pad">読み込み中…</div>';
    const d = c.worktreePath || c.status === 'done' ? await run(() => api.diff(c.id)) : '';
    if (state.selected !== c.id || state.tab !== 'diff') return;
    body.innerHTML = diffHtml(d || '');
    const r = $('refreshDiff');
    if (r) r.onclick = renderDetailBody;
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
    if (editable) $('saveEdit').onclick = () => run(() => api.updateCard({ id: c.id, title: $('editTitle').value, prompt: $('editPrompt').value, skill: editSkill || '' }), '保存しました');
  }
}

function drawFollowSkill() {
  const c = card(state.selected);
  const can = c && (c.status === 'review' || c.status === 'failed');
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

function newTask() {
  if (!state.board.settings.repoPath) return chooseRepo();
  openModal(
    `<h2>新しいタスク</h2>
     <label class="field"><span>タイトル（省略すると指示の1行目）</span><input id="nTitle" placeholder="例: ログイン画面にパスワード表示ボタンを追加" /></label>
     <div class="field"><span>Claude への指示</span><div id="nSkill" class="skill-slot"></div><textarea id="nPrompt" rows="10" placeholder="やってほしいことを具体的に書いてください。テストの実行方法なども書いておくと確実です。"></textarea></div>
     ${sessionFieldHtml('n')}
     <p class="muted small">GitHub の Issue から作るときは、右上の「Issue から作成」を使ってください。</p>
     <label class="check"><input type="checkbox" id="nStart" checked /> 作成したらすぐに開始する</label>
     <div class="modal-actions"><button class="btn ghost" id="nCancel">キャンセル</button><button class="btn primary" id="nOk">作成（Ctrl/⌘ + Enter）</button></div>`,
    () => {
      $('nPrompt').focus();
      fillSessionField('n');
      let skill = state.board.settings.defaultSkill || null;
      const drawSkill = () => renderSkillSlot('nSkill', skill, (v) => ((skill = v), drawSkill()));
      drawSkill();
      const submit = async () => {
        const id = await run(() => api.createCard({ title: $('nTitle').value, prompt: $('nPrompt').value, autoStart: $('nStart').checked, session: readSessionField('n'), skill }));
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

async function fillSessionField(idp, selectedId) {
  const list = (await api.listSessions().catch(() => [])) || [];
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
  const r = await run(() => api.createFromIssues({ numbers, extra, autoStart, session, skill }));
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
     <label class="check"><input type="checkbox" id="mKeep" /> マージ後もタスクを続ける（worktree とブランチを残す）</label>
     <p class="muted small" id="mHint"></p>
     <div class="modal-actions"><button class="btn ghost" id="mCancel">キャンセル</button><button class="btn primary" id="mOk">マージ</button></div>`,
    () => {
      const update = () => {
        const isNew = $('mTarget').value === '__new__';
        $('mNewWrap').classList.toggle('hidden', !isNew);
        const t = isNew ? $('mNew').value.trim() || '（新しいブランチ）' : $('mTarget').value;
        $('mHint').textContent = $('mKeep').checked
          ? `${t} にマージしたあとも、このタスクはレビュー列に残ります。続けて追加指示を送ったり、別のブランチにマージしたりできます。`
          : `${t} にマージしたあと、worktree とブランチ ${c.branch} を削除して「完了」にします。`;
        if (isNew) $('mNew').focus();
      };
      $('mTarget').onchange = update;
      $('mKeep').onchange = update;
      $('mNew').oninput = update;
      update();
      $('mCancel').onclick = closeModal;
      $('mOk').onclick = async () => {
        const isNew = $('mTarget').value === '__new__';
        const target = isNew ? $('mNew').value.trim() : $('mTarget').value;
        if (!target) return toast('ブランチ名を入力してください');
        $('mOk').disabled = true;
        const ok = await run(() => api.merge(c.id, { target, createNew: isNew, keep: $('mKeep').checked }).then(() => true), `${target} にマージしました`);
        $('mOk').disabled = false;
        if (ok) closeModal();
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
     <label class="field"><span>claude コマンドのパス</span><input id="sClaude" value="${esc(s.claudePath)}" /></label>

     <div class="modal-actions"><button class="btn ghost" id="sCancel">キャンセル</button><button class="btn primary" id="sOk">保存</button></div>`,
    () => {
      let defSkill = s.defaultSkill || null;
      const drawDef = () => renderSkillSlot('sSkill', defSkill, (v) => ((defSkill = v), drawDef()));
      drawDef();
      $('sCancel').onclick = closeModal;
      $('sOk').onclick = async () => {
        const r = await run(() =>
          api.updateSettings({
            baseBranch: $('sBase').value,
            permissionMode: $('sMode').value,
            allowedTools: $('sAllowed').value,
            maxParallel: $('sMax').value,
            model: $('sModel').value.trim(),
            claudePath: $('sClaude').value.trim() || 'claude',
            defaultSkill: defSkill || '',
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
$('newBtn').onclick = newTask;
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
  el.className = 'gh-panel ok';
  el.innerHTML = `<span>✓ gh で GitHub にログインしています${st.user ? `（<b>${esc(st.user)}</b>）` : ''}</span>`;
}

async function ghAction(kind) {
  ghState.busy = true;
  ghState.lines = [];
  ghState.code = null;
  renderGh(null);
  try {
    const st = await (kind === 'install' ? api.ghInstall() : api.ghLogin());
    ghState.busy = false;
    ghState.code = null;
    toast(kind === 'install' ? 'gh をインストールしました' : 'GitHub にログインしました', 'ok');
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

// ---------------- 更新の受信 ----------------

api.onBoard((board) => {
  state.board = board;
  renderBoard();
  if (state.selected) {
    renderDetailHead();
    const c = card(state.selected);
    if (c) {
      updateBtwTab(c);
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

(async () => {
  state.board = await api.getBoard();
  renderBoard();
  checkEnv();
})();
