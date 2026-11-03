/* global api */
const COLUMNS = [
  { key: 'todo', label: 'Todo', statuses: ['todo'], hint: 'ここから「実行中」へドラッグしても開始できます' },
  { key: 'running', label: '実行中', statuses: ['queued', 'running'] },
  { key: 'review', label: 'レビュー', statuses: ['review', 'failed'] },
  { key: 'done', label: '完了', statuses: ['done'] },
];
const STATUS_LABEL = { todo: '未着手', queued: '待機中', running: '実行中', review: 'レビュー待ち', failed: 'エラー', done: 'マージ済み' };
const LOG_LABEL = { user: 'あなた', text: 'Claude', tool: 'ツール', tool_result: '結果', tool_error: '結果(エラー)', system: 'システム', result: '完了', error: 'エラー', stderr: 'stderr', permission: '承認' };
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

function cardHtml(c) {
  const waiting = (c.permissions || []).length > 0;
  const since = c.status === 'running' ? c.startedAt : null;
  return `
    <div class="card s-${c.status} ${waiting ? 'waiting' : ''} ${state.selected === c.id ? 'selected' : ''}" draggable="${c.status === 'todo'}" data-id="${c.id}">
      <div class="card-top">
        <span class="badge b-${waiting ? 'waiting' : c.status}">${waiting ? '承認待ち' : STATUS_LABEL[c.status]}</span>
        ${since ? `<span class="elapsed" data-since="${since}">${elapsed(since)}</span>` : ''}
      </div>
      <div class="card-title">${esc(c.title)}</div>
      ${c.error && c.status === 'failed' ? `<div class="card-err">${esc(c.error)}</div>` : ''}
      ${c.lastMessage && !waiting ? `<div class="card-msg">${esc(c.lastMessage)}</div>` : ''}
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
  const waiting = cards.filter((c) => (c.permissions || []).length).length;
  $('runInfo').innerHTML = `実行中 ${running}/${settings.maxParallel || 1}${queued ? ` ・ 待機 ${queued}` : ''}${waiting ? ` ・ <b class="warn">承認待ち ${waiting}</b>` : ''}`;

  if (!settings.repoPath) {
    $('board').innerHTML = `<div class="empty-state"><h2>まずリポジトリを選んでください</h2><p>タスクごとにこのリポジトリの git worktree を作って、Claude Code を並列に動かします。</p><button class="btn primary" id="emptyRepo">リポジトリを選ぶ</button></div>`;
    $('emptyRepo').onclick = chooseRepo;
    return;
  }
  $('board').innerHTML = COLUMNS.map((col) => {
    const list = cards
      .filter((c) => col.statuses.includes(c.status))
      .sort((a, b) => ((b.permissions || []).length - (a.permissions || []).length) || (b.createdAt - a.createdAt));
    return `
      <section class="column" data-col="${col.key}">
        <header><span>${col.label}</span><span class="count">${list.length}</span></header>
        <div class="cards">${list.map(cardHtml).join('') || `<div class="col-empty">${col.key === 'todo' ? '「＋ 新しいタスク」から追加' : 'なし'}</div>`}</div>
      </section>`;
  }).join('');
}

// ボード上のクリック・ドラッグ（イベント委譲）
$('board').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-decision]');
  if (btn) {
    e.stopPropagation();
    const p = btn.closest('.perm');
    answer(p.dataset.card, p.dataset.req, btn.dataset.decision, '');
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
  renderBoard();
  renderDetailHead();
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
  const sig = JSON.stringify([c.status, c.title, c.error, c.branch, c.worktreePath, c.costUsd, c.permissions, c.alwaysAllow, c.mergedInto]);
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
      <span class="badge b-${(c.permissions || []).length ? 'waiting' : s}">${(c.permissions || []).length ? '承認待ち' : STATUS_LABEL[s]}</span>
      <h2 class="d-title">${esc(c.title)}</h2>
      <button class="icon" id="closeDetail" title="閉じる">✕</button>
    </div>
    <dl class="d-meta">
      ${c.branch ? `<dt>ブランチ</dt><dd>${esc(c.branch)} ← ${esc(c.baseBranch)}</dd>` : ''}
      ${c.worktreePath ? `<dt>worktree</dt><dd class="mono">${esc(c.worktreePath)}</dd>` : ''}
      ${(c.mergedInto || []).length ? `<dt>マージ済み</dt><dd>${c.mergedInto.map(esc).join(', ')}</dd>` : ''}
      ${c.costUsd ? `<dt>コスト</dt><dd>$${c.costUsd.toFixed(3)}</dd>` : ''}
      ${(c.alwaysAllow || []).length ? `<dt>常に許可</dt><dd>${c.alwaysAllow.map(esc).join(', ')}</dd>` : ''}
    </dl>
    ${c.error ? `<div class="d-error">${esc(c.error)}</div>` : ''}
    ${permissionBlock(c, false)}
    <div class="d-actions">${btns.join('')}</div>`;
  $('closeDetail').onclick = closeDetail;
  const canFollow = s === 'review' || s === 'failed';
  $('followInput').disabled = !canFollow;
  $('followBtn').disabled = !canFollow;
  $('followInput').placeholder = canFollow ? '追加の指示を送る（Ctrl/⌘ + Enter で送信）。同じセッションの続きとして動きます' : s === 'todo' ? '開始すると、終わったあとに追加の指示を送れます' : 'エージェントの作業中は送れません';
}

$('detailHead').addEventListener('click', async (e) => {
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
  return `<div class="log k-${e.kind}"><span class="log-k">${LOG_LABEL[e.kind] || e.kind}</span><span class="log-t">${time}</span><div class="log-x">${esc(e.text)}</div></div>`;
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
  } else {
    const editable = c.status === 'todo';
    body.innerHTML = `<div class="pad">
      <label class="field"><span>タイトル</span><input id="editTitle" value="${esc(c.title)}" ${editable ? '' : 'disabled'} /></label>
      <label class="field"><span>最初の指示</span><textarea id="editPrompt" rows="14" ${editable ? '' : 'disabled'}>${esc(c.prompt)}</textarea></label>
      ${editable ? '<button class="btn primary" id="saveEdit">保存</button>' : '<p class="muted">開始後は編集できません。変更したいときは追加指示を送ってください。</p>'}
    </div>`;
    if (editable) $('saveEdit').onclick = () => run(() => api.updateCard({ id: c.id, title: $('editTitle').value, prompt: $('editPrompt').value }), '保存しました');
  }
}

async function sendFollow() {
  const c = card(state.selected);
  const msg = $('followInput').value.trim();
  if (!c || !msg) return;
  const ok = await run(() => api.send(c.id, msg).then(() => true));
  if (ok) $('followInput').value = '';
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
  if (!$('modal').classList.contains('hidden')) closeModal();
  else if (state.selected) closeDetail();
});

function newTask() {
  if (!state.board.settings.repoPath) return chooseRepo();
  openModal(
    `<h2>新しいタスク</h2>
     <label class="field"><span>タイトル（省略すると指示の1行目）</span><input id="nTitle" placeholder="例: ログイン画面にパスワード表示ボタンを追加" /></label>
     <label class="field"><span>Claude への指示</span><textarea id="nPrompt" rows="10" placeholder="やってほしいことを具体的に書いてください。テストの実行方法なども書いておくと確実です。"></textarea></label>
     <label class="check"><input type="checkbox" id="nStart" checked /> 作成したらすぐに開始する</label>
     <div class="modal-actions"><button class="btn ghost" id="nCancel">キャンセル</button><button class="btn primary" id="nOk">作成（Ctrl/⌘ + Enter）</button></div>`,
    () => {
      $('nPrompt').focus();
      const submit = async () => {
        const id = await run(() => api.createCard({ title: $('nTitle').value, prompt: $('nPrompt').value, autoStart: $('nStart').checked }));
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
     <label class="field"><span>claude コマンドのパス</span><input id="sClaude" value="${esc(s.claudePath)}" /></label>
     <div class="modal-actions"><button class="btn ghost" id="sCancel">キャンセル</button><button class="btn primary" id="sOk">保存</button></div>`,
    () => {
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
$('settingsBtn').onclick = openSettings;

// ---------------- 更新の受信 ----------------

api.onBoard((board) => {
  state.board = board;
  renderBoard();
  if (state.selected) renderDetailHead();
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
