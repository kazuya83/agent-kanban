/* global api, icon, agentIcon, NOTIF_ICON, AppView, tr, I18n */
// 言語の土台（i18n.js）が先に tr を置く。まだ無いときは原文のまま返す
if (typeof tr !== 'function') {
  var tr = (key, vars) => (vars ? String(key ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : key);
}
if (typeof I18n === 'undefined') {
  var I18n = { locale: () => undefined, tr: (key, vars) => tr(key, vars) };
}

const COLUMNS = [
  { key: 'todo', label: 'Todo', statuses: ['todo'], hint: tr('ここから「実行中」へドラッグしても開始できます。レビューと完了のあいだも、ドラッグで動かせます') },
  { key: 'running', label: tr('実行中'), statuses: ['queued', 'running'] },
  { key: 'review', label: tr('レビュー'), statuses: ['review', 'failed'] },
  { key: 'done', label: tr('完了'), statuses: ['done'] },
];
// タスクに紐づかない会話（worktree を作らず、リポジトリのフォルダでそのまま話す）はボードのレーンには出さず、
// 「会話」ボタンから一覧を開き、選んだ会話はモーダルで表示する
const STATUS_LABEL = { todo: tr('未着手'), queued: tr('待機中'), running: tr('実行中'), review: tr('レビュー待ち'), failed: tr('エラー'), done: tr('マージ済み') };
const CHAT_STATUS_LABEL = { todo: tr('未開始'), queued: tr('待機中'), running: tr('返答中'), review: tr('返事済み'), failed: tr('エラー'), done: tr('終了') };
const isChat = (c) => !!c && c.kind === 'chat';
// git で管理していないフォルダのタスク（worktree・差分・マージ・PR はない）
const isNoGit = (c) => !!c && !!c.noGit;
// git で管理していないフォルダのタスクを「完了にする」ボタンを出すか（レビュー待ち・失敗で、質問や仕様の確認を待っていないとき）
const canCompleteNoGit = (c) =>
  isNoGit(c) && !isChat(c) && (c.status === 'review' || c.status === 'failed') && !c.afterDone && !isInterrupted(c) && !isSpecPending(c) && !c.awaitingReply && !(c.questions || []).length;
const COMPLETE_TITLE = tr('git で管理していないフォルダなので、マージや PR はありません。フォルダの中身を確かめてから完了にします');
// 「完了にする」: 確かめてから完了にする（詳細の上・ボードのカード・チャットとログの最後のどこから押しても同じ）
async function completeNoGit(c) {
  if (!c || !confirm(tr('「{title}」を完了にしますか？\nフォルダの中身はそのまま残ります（git で管理していないので、マージや PR はありません）。', { title: (c.title) }))) return;
  await runBusy(tr('完了にしています…'), () => api.complete(c.id), tr('完了にしました'));
}
const LOG_LABEL = { question: tr('質問'), user: tr('あなた'), text: 'Claude', tool: tr('ツール'), tool_result: tr('結果'), tool_error: tr('結果(エラー)'), system: tr('システム'), result: tr('完了'), error: tr('エラー'), stderr: 'stderr', permission: tr('承認') };
const PERMISSION_MODES = [
  ['default', tr('毎回確認する（すべての操作をカードで承認）')],
  ['acceptEdits', tr('ファイル編集は自動で許可、コマンドなどは確認する（おすすめ）')],
  ['plan', tr('計画だけ立てる（ファイルは変更しない）')],
  ['bypassPermissions', tr('すべて自動で許可する（注意）')],
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

// ---------------- カスタムエージェント（プロジェクトごと） ----------------
// 元にする CLI・モデルに、プロフィール（名前・アイコンと色・説明・振る舞いの指示）を持たせたもの。選ぶときの値は「custom:<ID>」
const CUSTOM_PREFIX = 'custom:';
const isCustomRef = (v) => typeof v === 'string' && v.startsWith(CUSTOM_PREFIX);
function customAgents(s = state.board.settings || {}) {
  return Array.isArray(s.customAgents) ? s.customAgents : [];
}
function findCustomAgent(ref, list = customAgents()) {
  const id = isCustomRef(ref) ? ref.slice(CUSTOM_PREFIX.length) : String(ref || '');
  return list.find((x) => x && x.id === id) || null;
}
// プロフィールのアイコン（絵文字がなければ、元の CLI のアイコン）。色の丸の中に出す
function personaIcon(p, agent) {
  if (!p) return agentIcon(agent);
  const color = /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#6366f1';
  return `<span class="persona-ic" style="--pc:${color}">${p.icon ? esc(p.icon) : esc(String(p.name || '?').slice(0, 1))}</span>`;
}
// 担当の呼び名（カスタムエージェントなら「名前（CLI）」）
function whoLabel(agent, p) {
  return p && p.name ? tr('{name}（{cli}）', { name: p.name, cli: agentShort(agent) }) : agentLabel(agent);
}
function whoShort(agent, p) {
  return p && p.name ? p.name : agentShort(agent);
}
// 複数の表示を言語の区切りでつなぐ。1件なら区切りは出さない。空なら空文字
function joinMid(parts) {
  if (!parts || !parts.length) return '';
  return parts.slice(1).reduce((a, b) => tr('{a}・{b}', { a, b }), parts[0]);
}
// 名前をかぎ括弧で囲んでつなぐ。HTML へ入れる名前は、呼び出し側で esc してから渡す
function quoteNames(names) {
  return joinMid((names || []).map((name) => tr('「{name}」', { name })));
}
// Pipelineの工程のノードの、動かすエージェント・プロフィール（カスタムエージェントの工程は、今の設定のものを引く）
function stepWho(n, list = customAgents()) {
  if (n && n.custom) {
    const ca = findCustomAgent(n.custom, list);
    if (ca) return { agent: ca.agent, persona: ca, model: ca.model || '' };
    return { agent: n.agent || 'claude', persona: null, model: '', missing: true };
  }
  return { agent: (n && n.agent) || 'claude', persona: (n && n.persona) || null, model: (n && n.model) || '' };
}

// ---------------- Pipeline（プロジェクトごとに複数） ----------------
// 設定の relayFlows: [{ id, name, flow }]、relayFlowId: 既定の Pipeline。タスクを作るときの値は「relay:<ID>」（「relay」だけなら既定の Pipeline）
const RELAY_PREFIX = 'relay:';
const isRelayRef = (v) => v === 'relay' || (typeof v === 'string' && v.startsWith(RELAY_PREFIX));
function pipelines(s = state.board.settings || {}) {
  if (Array.isArray(s.relayFlows) && s.relayFlows.length) return s.relayFlows;
  return s.relayFlow ? [{ id: 'default', name: 'Pipeline', flow: s.relayFlow }] : [];
}
function defaultPipeline(s = state.board.settings || {}) {
  const list = pipelines(s);
  return list.find((p) => p.id === s.relayFlowId) || list[0] || null;
}
function pipelineOfRef(v, s = state.board.settings || {}) {
  if (v === 'relay') return defaultPipeline(s);
  return isRelayRef(v) ? pipelines(s).find((p) => p.id === v.slice(RELAY_PREFIX.length)) || null : null;
}

const state = { board: { settings: {}, cards: [] }, repoOpenMode: 'replace', selected: null, tab: 'chat', logs: new Map(), headSig: '', relayOpen: new Set(), chartZoom: null, view: AppView.loadView(localStorage) };
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
        .replace(/^[-*+]\s+(.*)$/, (_, text) => tr('・{text}', { text }))
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
  if (s < 60) return tr('{s}秒', { s });
  if (s < 3600) return tr('{m}分{s}秒', { m: (Math.floor(s / 60)), s: (s % 60) });
  return tr('{h}時間{m}分', { h: (Math.floor(s / 3600)), m: (Math.floor((s % 3600) / 60)) });
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
      (r) => tr('\n      <div class="perm" data-card="{id}" data-req="{id2}">\n        <div class="perm-title">{v}承認待ち: <b>{toolName}</b></div>\n        {v2}\n        {v3}\n        <div class="perm-actions">\n          <button class="btn small allow" data-decision="allow">許可</button>\n          <button class="btn small deny" data-decision="deny">拒否</button>\n          <button class="btn small ghost" data-decision="always" title="このタスクでは {toolName} を今後も自動で許可">常に許可</button>\n        </div>\n      </div>', { id: (c.id), id2: (r.id), v: (icon('alert')), toolName: (esc(r.toolName)), v2: (r.summary ? `<code class="perm-summary">${esc(r.summary)}</code>` : ''), v3: (compact ? '' : tr('<details><summary>入力の全文</summary><pre>{detail}</pre></details>\n          <input class="deny-reason" placeholder="拒否する理由（任意・{v} に伝わります）" />', { detail: (esc(r.detail)), v: (esc(agentShort(agentOf(c)))) })) }),
    )
    .join('') + (compact && reqs.length > 1 ? tr('<div class="perm-more">ほか {n} 件の承認待ち</div>', { n: (reqs.length - 1) }) : '');
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
  if (isInterrupted(c)) return ['interrupted', tr('中断')];
  if ((c.questions || []).length) return ['question', tr('質問')];
  if ((c.permissions || []).length) return ['waiting', tr('承認待ち')];
  if (c.conflict && !c.conflict.resolving && c.status !== 'running' && c.status !== 'queued') return ['conflict', tr('コンフリクト')];
  if (isSpecPending(c)) return ['spec', tr('仕様の確認')];
  if (hasSubtaskProposal(c)) return ['spec', tr('サブタスクの提案')];
  if (subtasksRunning(c) && (c.status === 'review' || c.status === 'failed')) return subNeedsYou(c) ? ['awaiting', tr('サブタスクが対応待ち')] : ['running', tr('サブタスク実行中')];
  if (c.subtaskOf && subtaskNeedsCheck(c)) return ['awaiting', tr('確認待ち')];
  if (c.relay && c.relay.waiting && c.status === 'review') return ['queued', tr('並列の枝を待機中')];
  if (c.awaitingReply && (c.status === 'review' || c.status === 'failed')) return ['awaiting', tr('回答待ち')];
  return [c.status, (isChat(c) ? CHAT_STATUS_LABEL : STATUS_LABEL)[c.status]];
}
function needsYou(c) {
  if (subtasksRunning(c) && subNeedsYou(c)) return true;
  if (hasSubtaskProposal(c)) return true;
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
      ? tr('<div class="q-quick">{v}<button class="btn small ghost" data-qopen="1">その他…</button></div>', { v: (q.options.map((o) => `<button class="btn small" data-qpick="${esc(o.label)}" title="${esc(o.description)}">${esc(o.label)}</button>`).join('')) })
      : tr('<div class="q-quick"><button class="btn small primary" data-qopen="1">回答する（{n}問）</button></div>', { n: (req.questions.length) })}
  </div>`;
}

// 質問ひとつずつの選択肢と自由入力（AskUserQuestion の回答フォームと、仕様の確認の回答フォームで使う）
function questionItemsHtml(name, questions) {
  return questions
    .map(
      (q, i) => `<div class="q-item" data-qi="${i}">
      <div class="q-head">${q.header ? `<span class="q-chip">${esc(q.header)}</span>` : ''}${esc(q.question)}${q.multiSelect && q.options.length ? tr('<span class="muted small">（複数選べます）</span>') : ''}</div>
      <div class="q-opts">
        ${q.options.length
          ? q.options
              .map(
                (o) => `<label class="q-opt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q-${name}-${i}" value="${esc(o.label)}" />
            <span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></label>`,
              )
              .join('') +
            tr('<label class="q-opt other"><input type="{v}" name="q-{name}-{i}" value="__other__" />\n          <span><b>その他</b><input class="q-other" placeholder="自由に入力" /></span></label>', { v: (q.multiSelect ? 'checkbox' : 'radio'), name, i })
          : tr('<textarea class="q-other q-free" rows="2" placeholder="自由に入力"></textarea>')}
      </div>
    </div>`,
    )
    .join('');
}

// 詳細パネル用の回答フォーム
function questionFormHtml(c) {
  return (c.questions || [])
    .map(
      (req) => tr('<div class="qform" data-card="{id}" data-req="{id2}">\n      <div class="q-title">{v}{v2} からの質問</div>\n      {v3}\n      <div class="q-actions"><button class="btn primary" data-qact="submit">回答する</button><button class="btn ghost" data-qact="skip" title="{v2} に、妥当だと思う方法で進めてもらいます">答えずに続ける</button></div>\n    </div>', { id: (c.id), id2: (req.id), v: (icon('question')), v2: (esc(agentShort(agentOf(c)))), v3: (questionItemsHtml(req.id, req.questions)) }),
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
  return tr('<div class="qform spec-qform" data-card="{id}" data-spec="1">\n    <div class="q-title">{v}仕様の質問に答える</div>\n    {v2}\n    <div class="q-item"><div class="q-head">補足（任意）</div><textarea class="q-note" rows="2" placeholder="ほかに伝えたいことがあれば"></textarea></div>\n    <div class="q-actions"><button class="btn primary" data-sqact="submit"{v3}>回答して送る</button><button class="btn ghost" data-sqact="auto"{v3} title="答えていない質問は、{v4} に妥当な案で決めてもらいます">おまかせで進める</button></div>\n    <small class="muted">答えていない質問は「おまかせ」として送ります。下の欄に文章で書いて送ってもかまいません。</small>\n  </div>', { id: (c.id), v: (icon('question')), v2: (questionItemsHtml(`spec-${c.id}`, qs)), v3: (can ? '' : ' disabled'), v4: (esc(agentShort(agentOf(c)))) });
}
// エージェントが文章で質問してきたとき（回答フォームの JSON がないとき）に、質問のすぐ下に出す回答欄
function replyFormHtml(c) {
  const can = canSendFollow(c);
  return tr('<div class="qform reply-qform" data-card="{id}">\n    <textarea class="q-note" rows="3" placeholder="{v} への回答を書く（Ctrl/⌘ + Enter で送信）"{v2}></textarea>\n    <div class="q-actions"><button class="btn primary" data-rqact="submit"{v2}>回答して送る</button></div>\n  </div>', { id: (c.id), v: (esc(agentShort(agentOf(c)))), v2: (can ? '' : ' disabled') });
}
async function sendReplyAnswer(form, c) {
  const box = form.querySelector('.q-note');
  const msg = box.value.trim();
  if (!msg) return toast(tr('回答を書いてください'));
  const ok = await run(() => api.send(c.id, msg, null).then(() => true), tr('回答を送りました'));
  if (ok) box.value = '';
}
const SPEC_AUTO = tr('おまかせ（妥当な案で決めてください）');
// 仕様の確認フォームの答えを、エージェントに送る文章にする
function specAnswerMessage(questions, answers, note, auto) {
  const lines = [tr('仕様の質問への答えです。'), ''];
  questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.question}`, `   → ${(!auto && answers[q.question]) || SPEC_AUTO}`);
  });
  if (note) lines.push('', tr('補足: {note}', { note }));
  return lines.join('\n');
}
async function sendSpecAnswer(form, c, auto) {
  const qs = specQuestions(c);
  if (!qs) return;
  const answers = auto ? {} : collectAnswers(form, qs);
  const note = form.querySelector('.q-note').value.trim();
  if (!auto && !note && !Object.values(answers).some(Boolean)) return toast(tr('どれかの質問に答えてください（すべて任せるときは「おまかせで進める」）'));
  const msg = specAnswerMessage(qs, answers, note, auto);
  return run(() => api.send(c.id, msg, null).then(() => true), auto ? tr('おまかせで進めてもらいます') : tr('回答を送りました'));
}

// ---- コンフリクト ----
function conflictBoxHtml(c) {
  const busy = c.status === 'running' || c.status === 'queued';
  const who = esc(agentShort(agentOf(c)));
  if (c.conflict) {
    const k = c.conflict;
    const files = (k.unresolved && k.unresolved.length ? k.unresolved : k.files) || [];
    let actions;
    if (k.resolving && busy) actions = tr('<p class="muted small">{who} がコンフリクトを解消しています…（ログで進み具合を見られます）</p>', { who });
    else if (k.manual)
      actions = tr('<p class="small">タスクの worktree で、上のファイルの <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> 〜 <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> を直してください。</p>\n        <div class="cf-actions"><button class="btn" data-cact="open">フォルダを開く</button><button class="btn primary" data-cact="complete">解消した（取り込みを完了）</button><button class="btn" data-cact="agent">{who} に任せる</button><button class="btn ghost" data-cact="abort">取り込みを中止</button></div>', { who });
    else if (k.pr)
      actions = tr('<div class="cf-actions"><button class="btn primary" data-cact="agent">{who} に解消してもらう</button><button class="btn" data-cact="manual">自分で解消する</button>{v}<button class="btn ghost" data-cact="dismiss">閉じる</button></div>\n        <p class="muted small">どちらも、origin/{target} をこのタスクのブランチに取り込んで解消します。解消できたら「PR を更新」で push すると、PR のコンフリクトがなくなります。</p>', { who, v: (c.prUrl ? tr('<button class="btn ghost" data-cact="openPr">GitHub で見る</button>') : ''), target: (esc(k.target)) });
    else
      actions = tr('<div class="cf-actions"><button class="btn primary" data-cact="agent">{who} に解消してもらう</button><button class="btn" data-cact="manual">自分で解消する</button><button class="btn ghost" data-cact="dismiss">閉じる</button></div>\n        <p class="muted small">どちらも、{target} をこのタスクのブランチに取り込んで解消します。{target} 自体は解消が終わってマージするまで変わりません。</p>', { who, target: (esc(k.target)) });
    return `<div class="cf-box">
      <b>${icon('alert')}${k.pr ? tr('PR が {target} とコンフリクトしています', { target: (esc(k.target)) }) : tr('{target} とコンフリクトしています', { target: (esc(k.target)) })}${k.unresolved && k.unresolved.length ? tr('（まだ残っています）') : ''}</b>
      ${files.length ? `<ul class="cf-files">${files.map((f) => `<li class="mono">${esc(f)}</li>`).join('')}</ul>` : tr('<p class="muted small">コンフリクトしているファイルは、解消を始めると表示されます。</p>')}
      ${actions}
    </div>`;
  }
  if (c.conflictResolved && !busy && (c.status === 'review' || c.status === 'failed')) {
    const r = c.conflictResolved;
    if (r.pr)
      return tr('<div class="cf-box ok"><b>{v}origin/{target} を取り込んで、コンフリクトを解消しました</b>\n      <p class="small">差分タブで解消の内容を確かめてから、PR を更新（push）してください。</p>\n      <div class="cf-actions"><button class="btn primary" data-cact="pushPr">PR を更新（push）</button><button class="btn ghost" data-cact="dismiss">閉じる</button></div></div>', { v: (icon('check')), target: (esc(r.target)) });
    const mergeLabel = r.push ? tr('{target} にマージして push', { target: esc(r.target) }) : tr('{target} にマージ', { target: esc(r.target) });
    return tr('<div class="cf-box ok"><b>{v}{target} を取り込んで、コンフリクトを解消しました</b>\n      <p class="small">差分タブで解消の内容を確かめてから、マージしてください。</p>\n      <div class="cf-actions"><button class="btn primary" data-cact="remerge">{merge}</button><button class="btn ghost" data-cact="dismiss">閉じる</button></div></div>', { v: (icon('check')), target: (esc(r.target)), merge: mergeLabel });
  }
  return '';
}

async function conflictAction(c, act) {
  if (act === 'agent') {
    const who = agentShort(agentOf(c));
    return runBusy(tr('{who} に解消を頼んでいます…', { who }), () => api.resolveConflict(c.id, 'agent'), tr('{who} に解消を頼みました', { who }));
  }
  if (act === 'manual') {
    const r = await runBusy(tr('コンフリクトした状態を作っています…'), () => api.resolveConflict(c.id, 'manual'));
    if (r && r.manual) {
      toast(tr('worktree にコンフリクトした状態を作りました。エディタで直してください'), 'ok');
      run(() => api.open(c.id));
    } else if (r && r.resolved) toast(tr('コンフリクトなしで取り込めました'), 'ok');
    return;
  }
  if (act === 'open') return run(() => api.open(c.id));
  if (act === 'complete') return runBusy(tr('取り込みを完了しています…'), () => api.completeConflict(c.id), tr('取り込みを完了しました'));
  if (act === 'abort') return runBusy(tr('取り込みを中止しています…'), () => api.abortConflict(c.id), tr('取り込みを中止しました'));
  if (act === 'dismiss') return run(() => api.dismissConflict(c.id));
  if (act === 'openPr') return c.prUrl && api.openExternal(c.prUrl);
  if (act === 'pushPr') {
    const res = await runBusy(tr('PR を更新しています…'), () => api.createPr(c.id, { base: c.conflictResolved.target, keep: true }));
    if (res && res.url) toast(tr('PR を更新しました。GitHub でコンフリクトがなくなったか確かめます'), 'ok');
    return;
  }
  if (act === 'remerge') {
    const r = c.conflictResolved;
    const res = await runBusy(r.push ? tr('{target} にマージして push しています…', { target: (r.target) }) : tr('{target} にマージしています…', { target: (r.target) }), () => api.merge(c.id, { target: r.target, push: r.push, keep: r.keep }));
    if (res && res.merged) toast(tr('{target} にマージしました{v}', { target: (r.target), v: (r.push ? tr('（origin にも push しました）') : '') }), 'ok');
    else if (res && res.conflict) toast(tr('まだコンフリクトしています。もう一度解消してください'));
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
  return run(() => api.answerQuestion(cardId, reqId, answers).then(() => true), answers ? tr('回答しました') : tr('そのまま続けてもらいます'));
}

function cardHtml(c) {
  const waiting = needsYou(c);
  const [bcls, blabel] = badgeFor(c);
  const since = c.status === 'running' ? c.startedAt : null;
  return `
    <div class="card s-${c.status} ${isChat(c) ? 'chat' : ''} ${waiting ? (bcls === 'waiting' ? 'waiting' : bcls === 'conflict' ? 'conflicting' : 'asking') : ''} ${state.selected === c.id ? 'selected' : ''}" draggable="${canDragCard(c)}" data-id="${c.id}">
      <div class="card-top">
        <span class="badge b-${bcls}">${blabel}</span>
        ${isUnreadChat(c) ? tr('<span class="unread-chip" title="まだ読んでいない返事があります">未読</span>') : ''}
        ${since ? `<span class="elapsed" data-since="${since}">${elapsed(since)}</span>` : ''}
      </div>
      <div class="card-title">${c.issue ? tr('<a class="issue-chip" data-url="{url}" title="Issue を開く">#{number}</a> {v}', { url: (esc(c.issue.url)), number: (c.issue.number), v: (esc(c.title.replace(/^#\d+\s*/, ''))) }) : esc(c.title)}</div>
      ${orchChipsHtml(c)}
      ${c.readOnly ? tr('<div class="card-skill-row"><span class="readonly-chip" title="ソースを変更しないタスク: worktree を作らず、ファイルを書き換えるツールを止めて動かします。確かめたら「完了にする」で完了にします">{v}ソース変更なし</span></div>', { v: (icon('lock')) }) : ''}
      ${c.skill ? tr('<div class="card-skill-row"><span class="skill-chip small" title="最初の指示で使うスキル">{v}/{skill}</span></div>', { v: (icon('zap')), skill: (esc(c.skill)) }) : ''}
      ${c.error && c.status === 'failed' ? `<div class="card-err">${esc(c.error)}</div>` : ''}
      ${c.lastMessage && !waiting ? `<div class="card-msg">${esc(plainText(c.lastMessage))}</div>` : ''}
      ${isSpecPending(c) ? tr('<div class="card-msg card-spec">{v}内容が詰まっていないので、開発を開始できません。開いて質問に答えてください</div>', { v: (icon('note')) }) : ''}
      ${hasSubtaskProposal(c) ? tr('<div class="card-msg card-spec">{v}サブタスクに分けて進めることを提案しています。開いて、サブタスクでやるかを選んでください</div>', { v: (icon('branch')) }) : ''}
      ${subtasksRunning(c) ? `<div class="card-msg card-sub">${esc(subPhaseText(c))}</div>` : ''}
      ${isInterrupted(c) ? tr('<div class="int-quick"><button class="btn small primary" data-resume="{id}" title="中断したところから続けます">{v}再開</button></div>', { id: (c.id), v: (icon('play')) }) : ''}
      ${canCompleteNoGit(c) ? tr('<div class="int-quick"><button class="btn small primary" data-complete="{id}" title="{COMPLETE_TITLE}">{v}完了にする</button></div>', { id: (c.id), COMPLETE_TITLE, v: (icon('check')) }) : ''}
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
  if (c.relay && c.relay.waiting) {
    const n = FlowModel.nodeOf(c.relay.flow, c.relay.waiting.node);
    chips.push(tr('<span class="orch-chip relay" title="Pipeline: 並列の枝が、それぞれ別の worktree で動いています。すべて終わったら合流でマージします">{v}並列「{v2}」の枝 {n} 本を待機中</span>', { v: (icon('pipeline')), v2: (esc((n && n.label) || '')), n: (c.relay.waiting.children.length) }));
  } else if (c.relay) {
    const b = c.relay.branchOf;
    chips.push(`<span class="orch-chip relay" title="${b ? tr('Pipelineの並列の枝: 合流で元のタスクにマージします') : tr('Pipeline: フローチャートの工程ごとに、エージェントが作業を引き継ぎます')}">${icon('pipeline')}${b ? tr('枝{v} · ', { v: (b.index + 1) }) : ''}${c.relay.index + 1}/${c.relay.steps.length} ${esc(FlowModel.displayText(c.relay.steps[c.relay.index].label, 'step'))} · ${personaIcon(c.persona, agentOf(c))} ${esc(whoShort(agentOf(c), c.persona))}</span>`);
  }
  else if (c.persona) chips.push(`<span class="orch-chip agent persona" style="--pc:${esc(c.persona.color || '#6366f1')}" title="${esc(c.persona.description || tr('カスタムエージェント'))}">${personaIcon(c.persona, agentOf(c))}${esc(whoLabel(agentOf(c), c.persona))}</span>`);
  else chips.push(`<span class="orch-chip agent">${agentIcon(agentOf(c))}${esc(agentLabel(agentOf(c)))}</span>`);
  if (c.scheduleId) chips.push(tr('<span class="orch-chip schedule" title="スケジュール「{v}」から作られたタスクです">{v2}{v3}</span>', { v: (esc(c.scheduleTitle || '')), v2: (icon('calendar')), v3: (esc(c.scheduleTitle || tr('スケジュール'))) }));
  if (c.compete) {
    const n = competitors(c).length;
    chips.push(c.compete.adopted ? tr('<span class="orch-chip compete">{v}採用した案</span>', { v: (icon('flag')) }) : tr('<span class="orch-chip compete" title="同じタスクを複数のエージェントで解いています">{v}競争 {n}案</span>', { v: (icon('flag')), n }));
  }
  const sub = subtaskChipHtml(c);
  if (sub) chips.push(sub);
  return (chips.length ? `<div class="card-skill-row">${chips.join('')}</div>` : '') + (c.relay && !isChat(c) ? relayBarHtml(c) : '') + (c.subtasks && !isChat(c) ? subtaskBarHtml(c) : '');
}
function competitors(c) {
  if (!c || !c.compete) return c ? [c] : [];
  return state.board.cards.filter((x) => x.compete && x.compete.group === c.compete.group).sort((a, b) => a.compete.index - b.compete.index);
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
  return c.sshHost ? (c.sshUser ? `${c.sshUser}@${c.sshHost}` : c.sshHost) : tr('ホスト');
}

// 遠隔操作中に、画面で見ているのがホストのタブか（false ならこのマシンのタブ）
function viewingHost() {
  const rc = remoteClient();
  return !!rc && rc.view !== 'local';
}
// リポジトリを追加するときに選んだ側（遠隔操作中だけ。'host' / 'local'）
function repoTargetHost() {
  return !!remoteClient() && state.repoTarget !== 'local';
}
// api に渡す、どちらの側で行うかの印（遠隔操作中だけ）
function targetOpts() {
  return remoteClient() ? { target: repoTargetHost() ? 'host' : 'local' } : {};
}

// 左上のリポジトリのタブ（側ごとに MAX_REPO_TABS まで）
// 遠隔操作中は、ホストのタブ（接続先の名前付き）と、このマシンのタブを並べる。このマシンのタブはホストには出ない
const MAX_REPO_TABS = 3;
function repoTabsList() {
  const repo = state.board.settings.repoPath || '';
  const host = viewingHost();
  const list = (state.board.repoTabs || []).filter((t) => t && t.path).map((t) => ({ ...t, remote: !!t.remote, active: 'active' in t ? !!t.active : t.path === repo }));
  if (repo && !list.some((t) => t.active)) list.push({ path: repo, running: 0, attention: 0, remote: host, active: true });
  return list;
}
// 側ごとのタブ（remote: true ならホスト）
function sideTabs(remote) {
  return repoTabsList().filter((t) => t.remote === !!remote);
}
function renderRepoTabs() {
  const rc = remoteClient();
  const el = $('repoTabs');
  const onHost = viewingHost();
  el.classList.toggle('remote', !!rc);
  const host = rc ? remoteHostLabel(rc) : '';
  const hostHtml = rc ? tr('<span class="repo-host" title="接続先（{host}）のリポジトリです。エージェントはホストのフォルダで動きます">{v}<span class="repo-host-name">{host}</span></span>', { host: (esc(host)), v: (icon('monitor')) }) : '';
  const tabs = repoTabsList();
  if (!tabs.length) {
    el.innerHTML = tr('{hostHtml}<button class="repo" id="repoPick" title="{v}">{v2}リポジトリを選ぶ</button>', { hostHtml, v: (rc ? tr('接続先（{host}）か、このマシンのリポジトリを選びます', { host: (esc(host)) }) : tr('リポジトリを選ぶ')), v2: (icon('folder')) });
    $('repoPick').onclick = () => chooseRepo({ tab: 'replace' });
    return;
  }
  const tabHtml = (t) => {
    const on = t.active;
    const own = tabs.filter((x) => x.remote === t.remote);
    const badges = on
      ? ''
      : `${t.attention ? tr('<span class="repo-tab-badge warn" title="あなたの対応を待っているタスクが {attention} 件あります">{attention}</span>', { attention: (t.attention) }) : ''}${t.running ? tr('<span class="repo-tab-badge run" title="動いているタスクが {running} 件あります">{running}</span>', { running: (t.running) }) : ''}`;
    const where = rc ? (t.remote ? tr('接続先（{host}）のリポジトリ\n', { host }) : tr('このマシンのリポジトリ\n')) : '';
    const tip = on ? tr('{where}{path}\nクリックで、このタブのリポジトリを切り替えます', { where, path: (t.path) }) : tr('{where}{path}\nクリックでこのリポジトリに切り替えます', { where, path: (t.path) });
    const tipAll = t.noGit ? tr('{tip}\n（git で管理していないフォルダ。タスクはこのフォルダで直接動きます）', { tip }) : tip;
    return `<div class="repo-tab${on ? ' active' : ''}${rc && !t.remote ? ' local' : ''}" data-path="${esc(t.path)}" data-remote="${t.remote ? '1' : ''}" role="tab" aria-selected="${on}">
          <button class="repo-tab-main" title="${esc(tipAll)}">${icon('folder')}<span class="repo-tab-name">${esc(repoFolderName(t.path))}</span>${badges}</button>
          ${own.length > 1 || (rc && tabs.length > 1) ? tr('<button class="repo-tab-close" title="タブを閉じる（動いているタスクは止まりません）" aria-label="タブを閉じる">{v}</button>', { v: (icon('x')) }) : ''}
        </div>`;
  };
  const hostTabs = tabs.filter((t) => t.remote);
  const localTabs = tabs.filter((t) => !t.remote);
  // 追加できるのは、どちらかの側にまだ空きがあるとき
  const full = rc ? hostTabs.length >= MAX_REPO_TABS && localTabs.length >= MAX_REPO_TABS : tabs.length >= MAX_REPO_TABS;
  const localHtml = rc && localTabs.length ? tr('<span class="repo-host local" title="このマシンのリポジトリです。ホストには表示されません">{v}<span class="repo-host-name">このマシン</span></span>', { v: (icon('folder')) }) : '';
  el.innerHTML =
    (rc ? (hostTabs.length ? hostHtml + hostTabs.map(tabHtml).join('') : '') + localHtml + localTabs.map(tabHtml).join('') : tabs.map(tabHtml).join('')) +
    tr('<button class="repo-tab-add" id="repoTabAdd" {v} title="{v2}" aria-label="新しいタブでリポジトリを開く">{v3}</button>', { v: (full ? 'disabled' : ''), v2: (full ? tr('タブは {MAX_REPO_TABS} つまでです。タブを閉じてから開いてください', { MAX_REPO_TABS }) : tr('新しいタブでリポジトリを開く')), v3: (icon('plus')) });
  el.querySelectorAll('.repo-tab').forEach((tab) => {
    const p = tab.dataset.path;
    const remote = !!tab.dataset.remote;
    const active = tab.classList.contains('active');
    tab.querySelector('.repo-tab-main').onclick = () => (active ? chooseRepo({ tab: 'replace', target: remote ? 'host' : 'local' }) : switchRepoTab(p, remote));
    const x = tab.querySelector('.repo-tab-close');
    if (x) x.onclick = (e) => (e.stopPropagation(), closeRepoTab(p, remote, active));
  });
  $('repoTabAdd').onclick = () => !full && chooseRepo({ tab: 'new', target: rc ? (onHost && hostTabs.length < MAX_REPO_TABS) || localTabs.length >= MAX_REPO_TABS ? 'host' : 'local' : undefined });
}

// リポジトリを開いた・切り替えたあとに、ボードを読み直す
async function afterRepoChanged() {
  closeModal();
  closeDetail();
  state.board = await api.getBoard();
  renderBoard();
  checkEnv();
}
// remote: 遠隔操作中に、ホストのタブ（true）か、このマシンのタブ（false）か
async function switchRepoTab(dir, remote) {
  if (await run(() => api.switchRepoTab(dir, remoteClient() ? { remote: !!remote } : {}))) await afterRepoChanged();
}
async function closeRepoTab(dir, remote, wasCurrent) {
  // 遠隔操作中は、もう片方の側にタブが残るなら、その側の最後のタブも閉じられる
  const r = await run(() => api.closeRepoTab(dir, remoteClient() ? { remote: !!remote, allowEmpty: sideTabs(remote).length <= 1 && sideTabs(!remote).length > 0 } : {}));
  if (r === undefined) return;
  // 片方の側の最後のタブを閉じたとき（r が ''）は、見ている側がもう片方に移るので読み直す
  if (wasCurrent || r === '') return afterRepoChanged();
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
    el.textContent = tr('前回の接続を再開中… → {v}（{attempt}/{max}）', { v: (target(rs.client)), attempt: (r.attempt), max: (r.max) });
    el.title = tr('{v}クリックで RC設定を開きます（やめることもできます）', { v: (r.lastError ? tr('前回の失敗: {lastError}\n', { lastError: (r.lastError) }) : '') });
    el.onclick = () => openRemoteSettings();
    return;
  }
  if (rs?.role === 'local' && rs.client?.canResume) {
    // ワンクリックで前回の接続を再開する
    el.classList.remove('hidden', 'host');
    el.classList.add('resume');
    el.classList.toggle('error', !!rs.client.resumeError);
    el.textContent = tr('↻ 前回の接続を再開 → {v}', { v: (target(rs.client)) });
    el.title = tr('{v}保存したトークンで、前回と同じホストにつなぎます', { v: (rs.client.resumeError ? tr('つながりませんでした: {resumeError}\n', { resumeError: (rs.client.resumeError) }) : '') });
    el.onclick = () => runBusy(rs.client.mode === 'direct' ? tr('前回の接続を再開しています…') : tr('SSH トンネルを張って、前回の接続を再開しています…'), () => api.remoteResume());
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
    el.textContent = c.mode === 'direct' ? tr('遠隔操作中 → {host}:{port}', { host: (c.host), port: (c.port) }) : tr('遠隔操作中 → SSH {sshHost}', { sshHost: (c.sshHost) });
    el.title = c.view === 'local' ? tr('このマシンのタブを表示しています（ホストのタブは左上から切り替えられます）。クリックで RC設定を開きます') : tr('ホストのボードを表示・操作しています。クリックで RC設定を開きます');
  } else {
    const code = rs.host.pairCode ? tr(' ・ コード {pairCode}', { pairCode: (rs.host.pairCode) }) : '';
    el.textContent = tr('ホスト待ち受け :{port}{code}', { port: (rs.host.port), code });
    el.title = tr('このマシンで遠隔ホストとして待ち受けています。クリックで RC設定を開きます');
  }
  el.onclick = () => openRemoteSettings();
}

// 表示する画面（カンバン管理 / タスクスケジューラ / 設定）を DOM に反映する
function applyView() {
  $('board').classList.toggle('hidden', state.view !== 'kanban');
  $('schedulerView').classList.toggle('hidden', state.view !== 'scheduler');
  $('settingsView').classList.toggle('hidden', state.view !== 'settings');
  document.querySelectorAll('#navMenu [data-view]').forEach((b) => {
    const on = b.dataset.view === state.view;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

function setView(view) {
  const next = AppView.normalizeView(view);
  if (next === state.view) return;
  // 未保存の値は確認なしで捨てる
  if (state.view === 'settings') clearSettingsView();
  state.view = next;
  AppView.saveView(localStorage, next);
  applyView();
  // タスク詳細はカンバンの横に開くものなので、ほかの画面では閉じる
  if (next !== 'kanban' && state.selected) closeDetail();
  else renderBoard();
}

// スケジューラ画面を描く。scheduler-view.js が読み込めていなくても、ほかの画面は止めない
function renderSchedulerView() {
  if (typeof window.SchedulerView?.render === 'function') window.SchedulerView.render();
  else $('schedulerView').innerHTML = tr('<div class="empty-state"><h2>タスクスケジューラを読み込めませんでした</h2><p>アプリを開き直しても直らないときは、最新の版に更新してください。</p></div>');
}

// タスクの内容をコピーして、スケジュールの登録画面を開く
function openScheduleEditor(c) {
  if (typeof window.SchedulerView?.openEditor !== 'function') return toast(tr('タスクスケジューラを読み込めませんでした'));
  setView('scheduler');
  window.SchedulerView.openEditor({ fromCard: c });
}

function renderBoard() {
  const { settings, cards } = state.board;
  renderInterruptBanner();
  renderRemoteInfo();
  // 会話は同時実行数に数えない
  const running = cards.filter((c) => c.status === 'running' && !isChat(c)).length;
  renderNotifications();
  renderChatBtn();
  $('runInfo').textContent = tr('実行中 {running}/{v}', { running, v: (settings.maxParallel || 1) });
  if (state.view === 'scheduler') return renderSchedulerView();
  if (state.view === 'settings') return renderSettingsViewIfStale();

  if (!settings.repoPath) {
    $('board').innerHTML = viewingHost()
      ? tr('<div class="empty-state"><h2>接続先（{v}）でリポジトリを選んでください</h2><p>遠隔操作中は、ホストのリポジトリでエージェントが動きます。ホストの最近開いたリポジトリや、ホストのフォルダから選べます。</p><button class="btn primary" id="emptyRepo">ホストのリポジトリを選ぶ</button></div>', { v: (esc(remoteHostLabel())) })
      : tr('<div class="empty-state"><h2>まずリポジトリを選んでください</h2><p>タスクごとにこのリポジトリの git worktree を作って、エージェント（Claude Code / Codex CLI / Gemini CLI / Cursor CLI）を並列に動かします。</p><button class="btn primary" id="emptyRepo">リポジトリを選ぶ・クローン・新規作成</button></div>');
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
    // サブタスクは親のカードにまとめて出す。サブタスクを動かしている親は「実行中」に置く
    const list = cards
      .filter((c) => !isChat(c) && !isHiddenSubtask(c) && col.statuses.includes(subtasksRunning(c) && (c.status === 'review' || c.status === 'failed') ? 'running' : c.status))
      .sort(byAttention);
    return `
      <section class="column" data-col="${col.key}">
        <header><span>${col.label}</span><span class="count">${list.length}</span></header>
        <div class="cards">${list.map(cardHtml).join('') || `<div class="col-empty">${col.key === 'todo' ? tr('「＋ 新しいタスク」から追加') : tr('なし')}</div>`}</div>
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

// 返事が来たのに、まだ開いていない会話か（開いている会話は、見たものとして扱う）
function isUnreadChat(c) {
  return isChat(c) && !!c.unread && c.status !== 'running' && c.status !== 'queued' && state.selected !== c.id;
}
function isReplyingChat(c) {
  return isChat(c) && (c.status === 'running' || c.status === 'queued');
}

// 「会話」ボタン: 会話の数と、返事を待っている・返答中・未読の会話があるかを、数と色で出す
function renderChatBtn() {
  const chats = state.board.cards.filter(isChat);
  const waiting = chats.filter(needsYou).length;
  const unread = chats.filter(isUnreadChat).length;
  const replying = chats.filter(isReplyingChat).length;
  const n = $('chatCount');
  n.textContent = String(waiting || unread || replying || chats.length);
  n.classList.toggle('hidden', !chats.length);
  n.classList.toggle('warn', !!waiting);
  n.classList.toggle('unread', !waiting && !!unread);
  n.classList.toggle('replying', !waiting && !unread && !!replying);
  const btn = $('chatBtn');
  btn.classList.toggle('has-unread', !!unread);
  btn.classList.toggle('has-replying', !!replying);
  const notes = [
    waiting && tr('あなたの対応を待っている会話が {waiting} 件', { waiting }),
    unread && tr('まだ読んでいない返事が {unread} 件', { unread }),
    replying && tr('返答中の会話が {replying} 件', { replying }),
  ].filter(Boolean);
  btn.title = notes.length ? tr('{notes}あります', { notes: notes.join(tr('、')) }) : tr('タスクを作らずに、このリポジトリについてエージェントと話します');
  if (state.chatListOpen) drawChatList();
}

// 開いている会話に返事が来ていたら、読んだことにする
// 既読にできなかった会話（遠隔の接続先のアプリが古いなど）。既読はおまけなので、
// エラーにはせず一度だけ知らせ、画面が描き直されるたびに試し直さない
const markSeenFailed = new Set();
function markSeenIfOpen() {
  const c = card(state.selected);
  if (!c || !isChat(c) || !c.unread || c.status === 'running' || c.status === 'queued' || document.hidden) return;
  if (markSeenFailed.has(c.id)) return;
  api.markSeen(c.id).catch(() => {
    markSeenFailed.add(c.id);
    toast(tr('この会話は既読にできませんでした（接続先のアプリが古いと、遠隔からは既読にできません）'), 'info');
  });
}
document.addEventListener('visibilitychange', markSeenIfOpen);

// ボード上のクリック・ドラッグ（イベント委譲）
$('board').addEventListener('click', boardClick);
function boardClick(e) {
  const rs = e.target.closest('[data-resume]');
  if (rs) {
    e.stopPropagation();
    runBusy(tr('再開しています…'), () => api.resume(rs.dataset.resume), tr('再開しました'));
    return;
  }
  const cp = e.target.closest('[data-complete]');
  if (cp) {
    e.stopPropagation();
    completeNoGit(card(cp.dataset.complete));
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
// ボードのドラッグ&ドロップ: 列を動かして状態を変える（Todo → 実行中で開始、レビュー ⇄ 完了。マージとは切り離す）
function canDragCard(c) {
  return !!c && !isChat(c) && !c.afterDone && !isHiddenSubtask(c) && ['todo', 'review', 'failed', 'done'].includes(c.status);
}
// カードが今いる列
function boardColOf(c) {
  const s = subtasksRunning(c) && (c.status === 'review' || c.status === 'failed') ? 'running' : c.status;
  return (COLUMNS.find((col) => col.statuses.includes(s)) || {}).key;
}
// その列へ動かせるか（動かせない列は、落とす場所として光らせない）
function canDropCard(c, to) {
  const from = boardColOf(c);
  if (!c || from === to) return false;
  if (from === 'todo') return to === 'running';
  if (from === 'review') return to === 'done';
  if (from === 'done') return to === 'review';
  if (from === 'running') return to === 'done' && subtasksRunning(c); // サブタスクが残っているときは、あとで理由を出す
  return false;
}
let boardDragId = null;
$('board').addEventListener('dragstart', (e) => {
  const el = e.target.closest('.card');
  if (!el) return;
  boardDragId = el.dataset.id;
  e.dataTransfer.setData('text/plain', el.dataset.id);
});
$('board').addEventListener('dragend', () => {
  boardDragId = null;
  $('board').querySelectorAll('.column.drop').forEach((x) => x.classList.remove('drop'));
});
$('board').addEventListener('dragover', (e) => {
  const col = e.target.closest('.column[data-col]');
  if (col && canDropCard(card(boardDragId), col.dataset.col)) {
    e.preventDefault();
    col.classList.add('drop');
  }
});
$('board').addEventListener('dragleave', (e) => {
  const col = e.target.closest('.column');
  if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop');
});
$('board').addEventListener('drop', (e) => {
  const col = e.target.closest('.column[data-col]');
  if (!col) return;
  e.preventDefault();
  col.classList.remove('drop');
  const c = card(e.dataTransfer.getData('text/plain'));
  boardDragId = null;
  const to = col.dataset.col;
  if (!canDropCard(c, to)) return;
  moveCardTo(c, to);
});
async function moveCardTo(c, to) {
  if (to === 'running' && c.status === 'todo') return runBusy(tr('タスクを開始しています…'), () => api.start(c.id));
  if (to === 'done' && !isNoGit(c) && c.worktreePath && !confirm(tr('「{title}」を、マージせずに完了にします。worktree とブランチ {v} は残すので、あとで「レビュー」の列へ戻して続けられます。よろしいですか？', { title: (c.title), v: (c.branch || '') }))) return;
  return runBusy(tr('列を動かしています…'), () => api.moveCard(c.id, to), to === 'done' ? tr('完了にしました') : tr('レビューに戻しました'));
}

async function answer(cardId, reqId, decision, message) {
  await run(() => api.answerPermission(cardId, reqId, decision, message), decision === 'deny' ? tr('拒否しました') : tr('許可しました'));
}

// ---- アプリの終了で中断されたタスク ----
function interruptedBoxHtml(c) {
  const it = c.interrupted;
  const how = it.kind === 'queued' ? tr('待機中だった指示を、そのままもう一度渡して始めます。') : c.sessionId ? tr('同じ会話の続きとして、中断したところから作業を続けてもらいます。') : tr('最後に渡した指示で、もう一度始めます。');
  return tr('<div class="int-box">\n    <b>{v}アプリの終了で中断されました</b>{v2}\n    <p class="small">{how}別の指示で続けたいときは、下の欄から追加指示を送ってください。</p>\n    <div class="cf-actions"><button class="btn primary" data-act="resume">{v3}再開</button><button class="btn ghost" data-act="dismissInterrupted" title="再開せずに、中断の表示だけ消します">再開しない</button></div>\n  </div>', { v: (icon('pause')), v2: (it.at ? tr('<span class="muted small">（{at}）</span>', { at: esc(new Date(it.at).toLocaleString(I18n.locale())) }) : ''), how: (esc(how)), v3: (icon('play')) });
}

// 前回の終了で中断されたタスクがあれば、ボードの上に「すべて再開」を出す
function renderInterruptBanner() {
  const el = $('interruptBanner');
  const list = state.board.cards.filter(isInterrupted);
  if (!list.length || state.interruptDismissed) {
    el.classList.add('hidden');
    return;
  }
  el.innerHTML = tr('<span>{v}前回アプリを終了したときに、<b>{n} 件</b>のタスクが中断されました。</span>\n    <button class="btn small primary" id="resumeAllBtn">{v2}すべて再開</button>\n    <button class="btn small ghost" id="interruptLater">あとで</button>', { v: (icon('pause')), n: (list.length), v2: (icon('play')) });
  el.classList.remove('hidden');
  $('resumeAllBtn').onclick = () => runBusy(tr('タスクを再開しています…'), () => api.resumeAll().then((n) => tr('{n} 件のタスクを再開しました', { n }))).then((m) => m && toast(m, 'ok'));
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

async function select(id, { subFrom = null } = {}) {
  setView('kanban'); // 通知や履歴からスケジューラ画面で開いても、カードが見えるようにする
  state.selected = id;
  state.headSig = '';
  // サブタスクを親の「サブタスク」タブから開いたときは、閉じると親に戻る
  state.subFrom = subFrom && card(subFrom) ? subFrom : null;
  if (state.chatListOpen) closeModal();
  // 会話と、親の「サブタスク」タブから開いたサブタスクは、ボードの横ではなく、画面の中央にモーダルで開く
  const chatModal = isChat(card(id)) || !!state.subFrom;
  $('detail').classList.toggle('as-modal', chatModal);
  $('detailBackdrop').classList.toggle('hidden', !chatModal);
  $('detail').classList.remove('hidden');
  $('followInput').value = '';
  followAttach.clear();
  state.followSkill = null;
  // 質問への回答はチャットの最後に、承認はログの最後に出すので、そのときはそのタブで開く
  const need = hasChatActions(card(id)) ? 'chat' : hasLogActions(card(id)) ? 'log' : null;
  if (need && state.tab !== need) setTab(need);
  renderBoard();
  renderDetailHead();
  updateBtwTab(card(id));
  updateTabsFor(card(id));
  markSeenIfOpen();
  if (!state.logs.has(id)) {
    const logs = await run(() => api.logs(id));
    state.logs.set(id, logs || []);
  }
  renderDetailBody();
}

// 会話と git で管理していないフォルダのタスクには worktree も差分もないので、そのタブは隠す
function updateTabsFor(c) {
  const chat = isChat(c) || isNoGit(c);
  document.querySelectorAll('#tabs .tab').forEach((t) => {
    if (t.dataset.tab === 'worktree' || t.dataset.tab === 'diff') t.classList.toggle('hidden', chat);
  });
  if (chat && (state.tab === 'worktree' || state.tab === 'diff')) setTab('chat');
  // 「サブタスク」タブは、サブタスクがあるタスクにだけ出す
  const subs = hasSubtasks(c);
  $('subtasksTab').classList.toggle('hidden', !subs);
  if (!subs && state.tab === 'subtasks') setTab('progress');
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
}

function closeDetail() {
  state.selected = null;
  state.subFrom = null;
  $('detail').classList.add('hidden');
  $('detail').classList.remove('as-modal');
  $('detailBackdrop').classList.add('hidden');
  renderBoard();
}
// ✕・背景・Esc で閉じる: 親から開いたサブタスクなら、親のタスクの詳細（サブタスクタブ）に戻る
function closeDetailOrBack() {
  const back = state.subFrom && card(state.subFrom) ? state.subFrom : null;
  if (!back) return closeDetail();
  state.subFrom = null;
  setTab('subtasks');
  select(back);
}

// Pipelineの工程の状態（ワークフロー表示用）
const RELAY_STATE = {
  pending: [tr('・{text}', { text: '' }), tr('待ち')],
  queued: ['…', tr('待機中')],
  running: ['▶', tr('実行中')],
  question: ['?', tr('質問中')],
  waiting: ['!', tr('承認待ち')],
  awaiting: ['?', tr('回答待ち')],
  spec: ['?', tr('仕様の確認')],
  conflict: ['!', tr('コンフリクト')],
  interrupted: ['‖', tr('中断')],
  stopped: ['■', tr('停止')],
  failed: ['✕', tr('失敗')],
  skipped: ['–', tr('スキップ')],
  done: ['✓', tr('完了')],
};
function relayStepState(c, i) {
  const r = c.relay;
  const ran = (r.history || []).some((h) => h.index === i);
  // 並列の枝を待っているあいだは、枝のタスクで動いている工程の状態を見せる
  if (r.waiting) {
    for (const id of r.waiting.children) {
      const k = state.board.cards.find((x) => x.id === id);
      if (k && k.relay && k.relay.index === i) return k.relay.atJoin ? 'done' : relayStepState(k, i);
    }
    return ran ? 'done' : 'pending';
  }
  // 分岐で飛ばした工程・Pipelineを終えたあとの、まだ動かしていない工程は「スキップ」
  if (i !== r.index) return ran ? 'done' : r.done ? 'skipped' : 'pending';
  const b = badgeFor(c)[0];
  if (b === 'review') return r.done || r.atJoin ? 'done' : 'stopped'; // 途中の工程で止まっている（停止したとき・分岐の行き先がないとき）
  if (b === 'todo') return 'pending';
  return RELAY_STATE[b] ? b : 'done';
}
function durText(ms) {
  if (!(ms > 0)) return '';
  // elapsed() の文言を切り取るのは、訳すと「分」が残らず壊れる。秒を除いた表示を別に作る
  const s = Math.floor(ms / 1000);
  if (s < 60) return tr('{s}秒', { s });
  if (s < 3600) return tr('{m}分', { m: (Math.floor(s / 60)) });
  return tr('{h}時間{m}分', { h: (Math.floor(s / 3600)), m: (Math.floor((s % 3600) / 60)) });
}
function hhmm(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ボードのカード: 工程の数だけ区切った進み具合のバー
function relayBarHtml(c) {
  const r = c.relay;
  const segs = r.steps.map((st, i) => {
    const stt = relayStepState(c, i);
    return tr('<span class="rb-seg rs-{stt}" title="{n}. {label}（{who}）: {state}"></span>', {
      stt,
      n: i + 1,
      label: esc(FlowModel.displayText(st.label, 'step')),
      who: esc(whoShort(st.agent, st.persona)),
      state: esc(RELAY_STATE[stt][1]),
    });
  });
  return `<div class="relay-bar">${segs.join('')}</div>`;
}

// 分岐・並列・合流などの行き先。種別名と、それと同じ既定の名前は訳す。付けた名前はそのまま
function flowGoto(n) {
  if (!n || !n.type) return '';
  const typeName = FlowModel.TYPE_LABEL[n.type] || '';
  const shown = FlowModel.labelOf(n) || '';
  return tr('{v}「{v2}」へ', { v: tr(typeName), v2: FlowModel.displayText(shown, n.type) });
}

// 詳細: Pipelineの工程をワークフローの形で見せる（状態・エージェント・時間・金額・前の工程の報告）
function relayFlowHtml(c) {
  if (!c.relay || isChat(c)) return '';
  const r = c.relay;
  const hist = new Map((r.history || []).map((h) => [h.index, h])); // 同じ工程を何度か動かしたら、最後の回
  const runs = (i) => (r.history || []).filter((h) => h.index === i).length + (i === r.index && !r.waiting && !r.atJoin ? 1 : 0);
  const doneN = r.steps.filter((_, i) => relayStepState(c, i) === 'done').length;
  const loopN = Object.values(r.counts || {}).reduce((a, b) => a + b, 0);
  const nodes = r.steps.map((st, i) => {
    const stt = relayStepState(c, i);
    const [mark, label] = RELAY_STATE[stt]; // icon() を隠さないよう、別の名前にする
    // 今の工程は、今の回の情報を見せる（今の回は履歴にまだない。前の回の報告は残す）
    const h = i === r.index && !r.waiting && !r.atJoin ? null : hist.get(i);
    const prev = hist.get(i);
    const info = [];
    const n = runs(i);
    if (n > 1) info.push(tr('{n}回目', { n }));
    if (h) {
      if (h.startedAt && h.at) info.push(`${icon('clock')}${durText(h.at - h.startedAt) || tr('1分未満')}`);
      if (h.costUsd) info.push(`$${h.costUsd.toFixed(3)}`);
    } else if (i === r.index && r.stepStartedAt && !r.waiting) {
      if (stt === 'running') info.push(tr('{v}<span class="elapsed" data-since="{stepStartedAt}">{v2}</span>（{v3} から）', { v: (icon('clock')), stepStartedAt: (r.stepStartedAt), v2: (elapsed(r.stepStartedAt)), v3: (hhmm(r.stepStartedAt)) }));
      else info.push(tr('{v} に開始', { v: (hhmm(r.stepStartedAt)) }));
      const cost = (c.costUsd || 0) - (r.stepCostStart || 0);
      if (cost > 0) info.push(`$${cost.toFixed(3)}`);
    }
    // すぐあとが分岐の工程: 期待値ごとの行き先と、最後の判定の値・ループで戻った回数
    const judge = FlowModel.judgeOf(r.flow, st.id);
    const back = FlowModel.backEdges(r.flow);
    const tgt = (e) => {
      const n = FlowModel.nodeOf(r.flow, e.to);
      if (!n || n.type === 'end') return tr('終了');
      if (n.type === 'step') {
        const nstep = r.steps.findIndex((x) => x.id === n.id) + 1;
        return back.has(e.id) ? tr('工程{n}に戻る', { n: nstep }) : tr('工程{n}へ', { n: nstep });
      }
      return flowGoto(n);
    };
    const result = (i === r.index && r.lastResult) || (prev && prev.result);
    const judgeHtml = judge
      ? tr('<div class="rf-info">分岐「{label}」: {v}{v2}</div>', { label: (esc(FlowModel.shownLabel(judge.node))), v: (FlowModel.outEdges(r.flow, judge.node.id)
          .map((e) => `${esc(e.value || tr('それ以外'))}${e.value && e.else ? tr('（それ以外も）') : ''} → ${esc(tgt(e))}${back.has(e.id) && (r.counts || {})[e.id] ? tr('（戻った回数 {v}/{v2}）', { v: (r.counts[e.id]), v2: (e.maxLoops || 3) }) : ''}`)
          .join(tr(' ・ '))), v2: (result ? ` <span class="rf-verdict v-${result === 'fail' ? 'fail' : result === 'pass' ? 'pass' : 'other'}">${esc(result === 'fail' ? tr('差し戻し') : result === 'pass' ? tr('合格') : result)}</span>` : '') })
      : '';
    const key = `${c.id}:${i}`;
    const report = prev && String(prev.report || '').trim()
      ? tr('<details class="rf-report" data-rkey="{key}" {open}><summary>{summary}</summary><div class="rf-report-body">{report}</div></details>', { key: (esc(key)), open: (state.relayOpen.has(key) ? 'open' : ''), summary: ((r.history || []).filter((x) => x.index === i).length > 1 ? tr('最後に次の工程へ渡した報告') : tr('次の工程へ渡した報告')), report: (esc(prev.report)) })
      : '';
    return `<li class="rf-node rs-${stt} ${i === r.index && !r.waiting ? 'cur' : ''}">
      <span class="rf-dot">${mark}</span>
      <div class="rf-body">
        <div class="rf-head"><b>${i + 1}. ${esc(FlowModel.displayText(st.label, 'step'))}</b>${h && h.branch ? tr(' <span class="rf-branch">並列の枝</span>') : ''} <span class="rf-agent">${personaIcon(st.persona, st.agent)}${esc(whoLabel(st.agent, st.persona))}${st.model ? ` / ${esc(st.model)}` : ''}</span> <span class="rf-state">${label}</span></div>
        ${info.length ? `<div class="rf-info">${info.join(tr(' ・ '))}</div>` : ''}
        ${judgeHtml}
        ${st.instruction ? `<div class="rf-inst" title="${esc(st.instruction)}">${esc(st.instruction)}</div>` : ''}
        ${report}
      </div>
    </li>`;
  });
  return tr('<div class="relay-flow"><div class="rf-title">{v}Pipeline{v2} <span class="muted small">{doneN}/{length} 工程が完了{v3}{v4}</span></div>{v5}<ol class="rf-list">{v6}</ol></div>', { v: (icon('pipeline')), v2: (r.pipeline && r.pipeline.name && r.pipeline.name !== 'Pipeline' ? tr('「{name}」', { name: esc(r.pipeline.name) }) : ''), doneN, length: (r.steps.length), v3: (loopN ? tr('・ループ {loopN} 回', { loopN }) : ''), v4: (r.limitReached ? tr('・ループの上限で終了') : ''), v5: (relayWaitHtml(c)), v6: (nodes.join('')) });
}

// ---------------- サブタスク ----------------
// 親のタスクのブランチから分けて動かし、終わったものから親のブランチにマージする。サブタスクのカードはボードに出さず、親のカードにまとめて出す
// サブタスクに分けられるタスクか（git のふつうのタスク。Pipeline・競争・会話・サブタスク自身は分けない）
const canHaveSubtasks = (c) => !!c && !isChat(c) && !isNoGit(c) && !c.relay && !c.compete && !c.subtaskOf;
const hasSubtasks = (c) => !!(c && c.subtasks && c.subtasks.items.length);
const subtaskParent = (c) => (c && c.subtaskOf ? card(c.subtaskOf.parent) || null : null);
// ボードに出さないカード（親が残っているサブタスク）
const isHiddenSubtask = (c) => !!subtaskParent(c);
// サブタスクを動かしているあいだ（親は「実行中」の列に置く）
const subtasksRunning = (c) => !!(c && c.subtasks && c.subtasks.phase === 'run');
// 親のマージ・PR を止めているか（サブタスクが終わって、仕上げが済むまで）
const subtasksBlockMerge = (c) => !!(c && c.subtasks && (c.subtasks.phase === 'run' || (c.subtasks.phase === 'plan' && c.status !== 'todo')));
const hasSubtaskProposal = (c) => !!(c && c.subtaskProposal && (c.status === 'review' || c.status === 'failed'));
// 親のブランチに取り込める状態のサブタスクか
function subtaskReady(k) {
  return !!k && !!k.worktreePath && (k.status === 'review' || k.status === 'failed') && !k.awaitingReply && !isSpecPending(k) && !k.conflict && !isInterrupted(k) && !(k.questions || []).length && !(k.permissions || []).length;
}
// サブタスクのカードの、親の一覧の項目
function subItemOf(k) {
  const p = subtaskParent(k);
  return p ? p.subtasks.items.find((x) => x.cardId === k.id) : null;
}
// 終わったら「取り込む」を押してからマージするサブタスクか（「確かめてからマージ」・サブタスクだけ開始したもの）
function subtaskChecked(k) {
  const p = subtaskParent(k);
  const item = subItemOf(k);
  return !!p && (p.subtasks.merge === 'review' || !!(item && item.manual));
}
// あなたの確認を待っているサブタスクか
function subtaskNeedsCheck(k) {
  return subtaskChecked(k) && !(k.subtaskOf && k.subtaskOf.approved) && subtaskReady(k) && k.status === 'review';
}
function subKids(c) {
  return c && c.subtasks ? c.subtasks.items.filter((x) => x.cardId && x.state === 'running').map((x) => card(x.cardId)).filter(Boolean) : [];
}
function subNeedsYou(c) {
  return subKids(c).some((k) => needsYou(k) || subtaskNeedsCheck(k));
}
const SUB_EXTRA_STATE = { check: ['!', tr('確認待ち')], merging: ['…', tr('マージ待ち')], mergedWait: ['✓', tr('取り込み済み')], closed: ['✓', tr('完了（取り込まず）')] };
const subStateInfo = (s) => SUB_EXTRA_STATE[s] || RELAY_STATE[s] || RELAY_STATE.pending;
// サブタスクひとつの状態（バーと進捗で共通）
function subItemState(c, x) {
  if (x.state === 'merged') return 'done';
  if (x.state === 'done') return 'closed';
  if (x.state === 'review') return 'mergedWait';
  if (x.state === 'skipped') return 'skipped';
  const k = x.cardId ? card(x.cardId) : null;
  if (x.state !== 'running' || !k) return 'pending';
  if (subtaskNeedsCheck(k)) return 'check';
  if (k.status === 'review' && subtaskReady(k)) return c.conflict && c.conflict.subtask === k.id ? 'conflict' : 'merging';
  const b = badgeFor(k)[0];
  if (b === 'todo') return 'queued';
  if (b === 'review') return 'stopped';
  return RELAY_STATE[b] ? b : 'running';
}
function subCounts(c) {
  const items = c.subtasks.items;
  const merged = items.filter((x) => x.state === 'merged').length;
  const closed = items.filter((x) => x.state === 'done').length;
  const skipped = items.filter((x) => x.state === 'skipped').length;
  const running = items.filter((x) => x.state === 'running' || x.state === 'review').length;
  // done: 完了の列に入っているもの（マージした・取り込まずに完了にした）
  return { total: items.length, merged, done: merged + closed, skipped, running, pending: items.length - merged - closed - skipped - running };
}
// サブタスクタブの列（ドラッグ&ドロップで状態を変える）
const SUB_COLUMNS = [
  { key: 'todo', label: tr('未着手') },
  { key: 'running', label: tr('作業中') },
  { key: 'review', label: tr('レビュー') },
  { key: 'done', label: tr('完了') },
];
function subItemColumn(x) {
  if (['merged', 'done', 'skipped'].includes(x.state)) return 'done';
  if (x.state === 'review') return 'review';
  if (x.state === 'pending') return 'todo';
  const k = x.cardId ? card(x.cardId) : null;
  return k && (k.status === 'review' || k.status === 'failed') ? 'review' : 'running';
}
// そのサブタスクを、その列へ動かせるか
function canDropSub(c, x, to) {
  if (!c || !x || c.status === 'running' || c.status === 'queued' || c.status === 'done') return false;
  const from = subItemColumn(x);
  if (from === to) return false;
  if (from === 'todo') return to === 'running' || (to === 'done' && c.status !== 'todo');
  if (c.status === 'todo') return false;
  if (from === 'review') return to === 'done' || (to === 'todo' && x.state === 'review');
  if (from === 'done') return to === 'todo' || (to === 'review' && x.state === 'merged' && !!x.merged);
  return false;
}
// 親のカードの今の段階
function subPhaseText(c) {
  const st = c.subtasks;
  const n = subCounts(c);
  if (st.phase === 'plan') return c.status === 'todo' ? tr('開始すると、順番（直列・並列）を決めてから動かします。サブタスクだけ開始することもできます') : tr('順番（直列・並列）を決めています');
  if (st.phase === 'done') return c.status === 'running' || c.status === 'queued' ? tr('すべて完了しました。全体の仕上げをしています') : tr('すべて完了しました');
  if (c.conflict && c.conflict.subtask) return tr('サブタスクのマージのコンフリクトを解消しています');
  return st.auto === false
    ? tr('手で進めています ・ 作業中 {running}・あと {pending}', { running: n.running, pending: n.pending })
    : tr('作業中 {running}・あと {pending}', { running: n.running, pending: n.pending });
}
// ボードのカード: サブタスクの数だけ区切った進み具合のバー
function subtaskBarHtml(c) {
  const segs = c.subtasks.items.map((x) => {
    const s = subItemState(c, x);
    return `<span class="rb-seg rs-${s}" title="${esc(x.title)}: ${esc(subStateInfo(s)[1])}"></span>`;
  });
  return `<div class="relay-bar sub-bar">${segs.join('')}</div>`;
}
// ボードのカードに「サブタスク」を出す。手動のサブタスクと、Pipeline の並列の枝
function subtaskChipHtml(c) {
  if (c.subtaskOf) {
    const p = subtaskParent(c);
    return p ? tr('<span class="orch-chip sub" title="「{title}」のサブタスク">{v}サブタスク</span>', { title: (esc(p.title)), v: (icon('branch')) }) : '';
  }
  if (AppView.isPipelineSubtask(c)) {
    const p = card(c.relay.branchOf.parent);
    return p
      ? tr('<span class="orch-chip sub" title="「{title}」のサブタスク（Pipeline の並列の枝）">{v}サブタスク</span>', { title: esc(p.title), v: icon('branch') })
      : tr('<span class="orch-chip sub" title="Pipeline の並列の枝のサブタスク">{v}サブタスク</span>', { v: icon('branch') });
  }
  if (!c.subtasks) return '';
  const n = subCounts(c);
  const check = subKids(c).filter(subtaskNeedsCheck).length;
  return tr('<span class="orch-chip sub" title="サブタスクに分けて進めています（{v}）">{v2}サブタスク {done}/{skipped} 完了{v3}</span>', { v: (esc(subPhaseText(c))), v2: (icon('branch')), done: (n.done), skipped: (n.total - n.skipped), v3: (check ? tr('・確認待ち {check}', { check }) : '') });
}
// サブタスクのタスク: 親のタスクと、マージのしかた（進捗タブに出す）
function subtaskChildHtml(c) {
  const p = subtaskParent(c);
  if (!p) return '';
  const how = subtaskChecked(c)
    ? tr('「<a href="#" data-open-card="{id}">{title}</a>」のサブタスクです。ブランチ {branch} から分けて作業し、終わったら、確かめてから（「取り込む」を押してから）親のブランチにマージします。', { id: esc(p.id), title: esc(p.title), branch: esc(p.branch || '') })
    : tr('「<a href="#" data-open-card="{id}">{title}</a>」のサブタスクです。ブランチ {branch} から分けて作業し、終わったら自動で親のブランチにマージします。', { id: esc(p.id), title: esc(p.title), branch: esc(p.branch || '') });
  return `<div class="sub-box"><div class="rh-row">${icon('branch')}<span>${how}</span></div>\n    ${subtaskApproveHtml(c)}</div>`;
}
// サブタスクのタスク: 確かめてから取り込むときの「親のタスクに取り込む」（チャットの最後と進捗タブに出す）
function subtaskApproveHtml(c) {
  if (!subtaskNeedsCheck(c)) return '';
  return tr('<div class="d-actions"><button class="btn primary" data-sact="approve" data-sid="{id}">{v}親のタスクに取り込む</button><small class="muted">差分タブで変更を確かめてから取り込んでください。直してほしいときは、下の欄から追加の指示を送れます。</small></div>', { id: (esc(c.id)), v: (icon('merge')) });
}
// サブタスクの一覧を編集する欄（提案を直す・開始前に決める）
function subRowHtml(x, title = new Map(), showAfter = false) {
  return tr('<div class="sub-row" data-key="{v}" data-after="{v2}" data-issue="{v3}">\n      <div class="sub-row-head"><input class="sub-title" placeholder="サブタスクの名前" value="{v4}" />{v5}<button class="icon" type="button" data-sact="remove" title="このサブタスクを外す">✕</button></div>\n      <textarea class="sub-prompt" rows="3" placeholder="このサブタスクでやること">{v6}</textarea>\n      {v7}\n    </div>', { v: (esc(x.key || '')), v2: (esc(JSON.stringify(x.after || []))), v3: (esc(x.issue ? JSON.stringify(x.issue) : '')), v4: (esc(x.title || '')), v5: (x.issue ? `<span class="muted small">#${x.issue.number}</span>` : ''), v6: (esc(x.prompt || '')), v7: (showAfter && x.after && x.after.length ? tr('<small class="muted">{v} のあとに始めます</small>', { v: quoteNames(x.after.map((a) => esc(title.get(a) || a))) }) : '') });
}
function subEditorHtml(items, { showAfter = false } = {}) {
  const title = new Map(items.map((x) => [x.key, x.title]));
  return tr('<div class="sub-editor"><div class="sub-rows">{v}</div><button class="btn small" type="button" data-sact="add">{v2}サブタスクを足す</button></div>', { v: (items.map((x) => subRowHtml(x, title, showAfter)).join('')), v2: (icon('plus')) });
}
function subRowsFrom(root) {
  return [...root.querySelectorAll('.sub-row')]
    .map((r, i) => {
      let after = [];
      let issue = null;
      try {
        after = JSON.parse(r.dataset.after || '[]');
        issue = r.dataset.issue ? JSON.parse(r.dataset.issue) : null;
      } catch {
        /* 読めなければ無し */
      }
      const keep = new Set([...root.querySelectorAll('.sub-row')].map((x) => x.dataset.key).filter(Boolean));
      return { key: r.dataset.key || `n${i + 1}`, title: r.querySelector('.sub-title').value.trim(), prompt: r.querySelector('.sub-prompt').value.trim(), after: after.filter((a) => keep.has(a)), ...(issue ? { issue } : {}) };
    })
    .filter((x) => x.title || x.prompt);
}
function subMergeSelectHtml(id, value) {
  return tr('<label class="field sub-merge"><span>サブタスクが終わったら</span><select id="{id}"><option value="auto"{v}>自動で親のブランチにマージする</option><option value="review"{v2}>確かめてからマージする（サブタスクごとに「取り込む」を押す）</option></select></label>', { id, v: (value !== 'review' ? ' selected' : ''), v2: (value === 'review' ? ' selected' : '') });
}
// サブタスクの提案: 直してから「サブタスクでやる」か、「分けずに進める」
function subtaskProposalHtml(c) {
  const who = esc(agentShort(agentOf(c)));
  const items = c.subtaskProposal.items;
  return tr('<div class="sub-box sub-proposal" id="subProposal"><b>{v}{who} が、{n} 個のサブタスクに分けて進めることを提案しています</b>\n    <small>それぞれ、このタスクのブランチから分けたブランチで別のエージェントが作業し、終わったものからこのブランチにマージします。すべてマージしたら、{who} が全体を仕上げてからレビューに回します。名前や指示は直せます。</small>\n    {v2}\n    {v3}\n    {v4}\n    <div class="d-actions"><button class="btn primary" data-sact="accept">{v5}サブタスクでやる</button><button class="btn" data-sact="decline">分けずに進める</button></div>\n    <small>ほかの分け方にしてほしいときは、下の欄に文章で書いて送ってください。</small></div>', { v: (icon('branch')), who, n: (items.length), v2: (subEditorHtml(items, { showAfter: true })), v3: (subMergeSelectHtml('subMerge', (state.board.settings || {}).subtaskMerge)), v4: (c.issue ? tr('<label class="check"><input type="checkbox" id="subIssues" /> GitHub にもサブIssue を作って、#{number} にぶら下げる</label>', { number: (c.issue.number) }) : ''), v5: (icon('play')) });
}
// サブタスク1つの金額（動いているものはカードの、終わったものは記録した金額）
function subItemCost(x) {
  const k = x.cardId && x.state === 'running' ? card(x.cardId) : null;
  return (k ? k.costUsd : x.costUsd) || 0;
}
// 親のタスクとサブタスクを合わせた金額
function subTotalCost(c) {
  return (c.subtasks ? c.subtasks.items : []).reduce((sum, x) => sum + subItemCost(x), c.costUsd || 0);
}
const subDonePct = (n) => (n.total - n.skipped ? Math.round((n.done / (n.total - n.skipped)) * 100) : 0);
// 進捗タブ: サブタスクのタスクなら親のタスクとマージのしかた、親のタスクなら全体の進み具合と今動いているサブタスク
function subtaskProgressHtml(c) {
  if (c.subtaskOf) {
    const p = subtaskParent(c);
    return p ? `<section class="pg-sec">${subtaskChildHtml(c)}</section>` : '';
  }
  if (!hasSubtasks(c)) return '';
  const n = subCounts(c);
  const pct = subDonePct(n);
  const counts = joinMid([
    n.done ? tr('完了 {n}', { n: n.done }) : '',
    n.running ? tr('作業中 {n}', { n: n.running }) : '',
    n.pending ? tr('未着手 {n}', { n: n.pending }) : '',
    n.skipped ? tr('破棄 {n}', { n: n.skipped }) : '',
  ].filter(Boolean));
  const active = c.subtasks.items.filter((x) => x.state === 'running' || x.state === 'review').map((x) => {
    const [mark, label] = subStateInfo(subItemState(c, x));
    return `<li><span class="td-mark" title="${esc(label)}">${mark}</span><span class="td-text">${esc(x.title)}</span> <span class="muted small">${esc(label)}</span></li>`;
  });
  return tr('<section class="pg-sec"><div class="pg-sec-head"><b>全体の進捗</b> <span class="muted small">サブタスク {done}/{skipped} 完了（{pct}%）</span></div>\n    <div class="pg-bar" title="{pct}%"><span style="width:{pct}%"></span></div>\n    <div class="muted small">{counts} ・ {v}</div>\n    {v2}\n  </section>', { done: (n.done), skipped: (n.total - n.skipped), pct, counts: (esc(counts)), v: (esc(subPhaseText(c))), v2: (active.length ? `<ul class="pg-todos pg-active">${active.join('')}</ul>` : '') });
}
// サブタスクタブ: サブタスクの一覧（状態・担当・金額・マージしたものの報告）
function subtaskListHtml(c) {
  if (!hasSubtasks(c)) return '';
  const n = subCounts(c);
  const st = c.subtasks;
  const pct = subDonePct(n);
  const auto = st.phase === 'run' && st.auto === false && n.pending && c.status !== 'running' && c.status !== 'queued' && !c.conflict
    ? tr(' <button class="btn small" data-sact="auto" type="button" title="まだ始めていないサブタスクを、順番（目安）どおりに自動で始めます">{v}残りを自動で進める</button>', { v: (icon('play')) })
    : '';
  return tr('<section class="pg-sec"><div class="pg-sec-head"><b>{v}サブタスク</b> <span class="muted small">{done}/{skipped} 完了{v2}{v3} ・ {v4} ・ {v5}</span>{auto}</div>\n    <div class="pg-bar" title="{pct}%"><span style="width:{pct}%"></span></div>\n    {v6}</section>', { v: (icon('branch')), done: (n.done), skipped: (n.total - n.skipped), v2: (n.merged !== n.done ? tr('（マージ {merged}）', { merged: (n.merged) }) : ''), v3: (n.skipped ? tr('・破棄 {skipped}', { skipped: (n.skipped) }) : ''), v4: (esc(subPhaseText(c))), v5: (st.merge === 'review' ? tr('確かめてからマージ') : tr('自動でマージ')), auto, pct, v6: (subBoardHtml(c)) });
}
// サブタスクタブ: サブタスクのかんばん（未着手 / 作業中 / レビュー / 完了）
function subBoardHtml(c) {
  const st = c.subtasks;
  const title = new Map(st.items.map((x) => [x.key, x.title]));
  const startable = c.status !== 'running' && c.status !== 'queued' && c.status !== 'done' && !c.conflict;
  const cols = SUB_COLUMNS.map((col) => {
    const items = st.items.filter((x) => subItemColumn(x) === col.key);
    const rows = items.map((x) => {
      const s = subItemState(c, x);
      const [mark, label] = subStateInfo(s);
      const k = x.cardId && x.state === 'running' ? card(x.cardId) : null;
      const info = [];
      if (x.issue) info.push(`<a class="issue-chip" data-url="${esc(x.issue.url)}">#${x.issue.number}</a>`);
      if (x.after && x.after.length) info.push(tr('<span class="muted small" title="自動で進めるときの順番です。サブタスクだけ開始するときは、順番に関係なく始められます">{v} のあと（目安）</span>', { v: quoteNames(x.after.map((a) => esc(title.get(a) || a))) }));
      if (x.manual) info.push(tr('<span class="muted small">個別に開始</span>'));
      if (k) info.push(`<span class="rf-agent">${personaIcon(k.persona, agentOf(k))}${esc(whoShort(agentOf(k), k.persona))}</span>`);
      else if (x.agent) info.push(`<span class="rf-agent">${esc(agentShort(x.agent))}</span>`);
      const cost = k ? k.costUsd : x.costUsd;
      if (cost) info.push(`<span class="muted small">$${cost.toFixed(3)}</span>`);
      const name = esc(x.title);
      const acts = [];
      if (x.state === 'pending' && startable) acts.push(tr('<button class="btn small" data-sact="startOne" data-key="{key}" type="button" title="ほかのサブタスクは動かさずに、このサブタスクだけを開始します">{v}開始</button>', { key: (esc(x.key)), v: (icon('play')) }));
      if (k && subtaskNeedsCheck(k)) acts.push(tr('<button class="btn small primary" data-sact="approve" data-sid="{id}" type="button" title="差分を確かめたら、親のタスクのブランチに取り込みます">{v}取り込む</button>', { id: (esc(k.id)), v: (icon('merge')) }));
      const msg = k && k.lastMessage ? `<div class="rf-info">${esc(plainText(k.lastMessage))}</div>` : '';
      const rkey = `${c.id}:sub:${x.key}`;
      const report = x.report && !k ? tr('<details class="rf-report" data-rkey="{rkey}" {v}><summary>サブタスクの報告</summary><div class="rf-report-body">{report}</div></details>', { rkey: (esc(rkey)), v: (state.relayOpen.has(rkey) ? 'open' : ''), report: (esc(x.report)) }) : '';
      const drag = SUB_COLUMNS.some((to) => canDropSub(c, x, to.key));
      return tr('<div class="sb-item rs-{s}" draggable="{drag}" data-key="{key}" title="クリックで詳細を開きます{v}"><div class="sb-head"><span class="rf-dot" title="{label}">{mark}</span><b>{name}</b></div><div class="sb-info"><span class="rf-state">{label}</span>{v2}</div>{msg}{v3}{report}</div>', { s, drag, key: (esc(x.key)), v: (drag ? tr('（ドラッグで状態を変えられます）') : ''), label: (esc(label)), mark, name, v2: (info.join('')), msg, v3: (acts.length ? `<div class="sb-acts">${acts.join('')}</div>` : ''), report });
    });
    return `<div class="sb-col" data-scol="${col.key}"><div class="sb-col-head"><span>${col.label}</span><span class="count">${items.length}</span></div><div class="sb-items">${rows.join('') || tr('<div class="col-empty">なし</div>')}</div></div>`;
  });
  return `<div class="sub-board">${cols.join('')}</div>`;
}
// サブタスクのかんばんのドラッグ&ドロップ（描き直すたびに付け直す）
function bindSubBoard(c, view) {
  const board = view.querySelector('.sub-board');
  if (!board) return;
  let dragKey = null;
  const itemOf = (key) => (card(c.id)?.subtasks?.items || []).find((x) => x.key === key);
  board.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.sb-item');
    if (!el) return;
    dragKey = el.dataset.key;
    e.dataTransfer.setData('text/plain', dragKey);
  });
  board.addEventListener('dragend', () => {
    dragKey = null;
    board.querySelectorAll('.sb-col.drop').forEach((x) => x.classList.remove('drop'));
  });
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.sb-col');
    if (col && canDropSub(card(c.id), itemOf(dragKey), col.dataset.scol)) {
      e.preventDefault();
      col.classList.add('drop');
    }
  });
  board.addEventListener('dragleave', (e) => {
    const col = e.target.closest('.sb-col');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop');
  });
  board.addEventListener('drop', (e) => {
    const col = e.target.closest('.sb-col');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('drop');
    const key = e.dataTransfer.getData('text/plain');
    dragKey = null;
    moveSubTo(card(c.id), itemOf(key), col.dataset.scol);
  });
  // カードをクリックすると、サブタスクの詳細をモーダルで開く（ボタン・リンク・報告の開け閉めは除く）
  board.addEventListener('click', (e) => {
    if (e.target.closest('button, a, details, summary, input, textarea, select')) return;
    const el = e.target.closest('.sb-item');
    if (!el) return;
    const p = card(c.id);
    const x = itemOf(el.dataset.key);
    if (p && x) openSubtaskDetail(p, x);
  });
}
// サブタスクの詳細: カードがある（作業中・レビュー）ときは、タスクの詳細と同じものをモーダルで開く。
// 閉じると親のタスクの詳細（サブタスクタブ）に戻る。カードがない（未着手・完了）ときは、やることと報告をモーダルで見せる
// 未着手のサブタスクは「編集」で名前とやることを変えられる（editing: true で入力欄を出す）
function openSubtaskDetail(p, x, { editing = false } = {}) {
  const k = x.cardId && x.state === 'running' ? card(x.cardId) : null;
  if (k) return select(k.id, { subFrom: p.id });
  const editable = x.state === 'pending';
  if (!editable) editing = false;
  const [mark, label] = subStateInfo(subItemState(p, x));
  const title = new Map(p.subtasks.items.map((y) => [y.key, y.title]));
  const startable = x.state === 'pending' && p.status !== 'running' && p.status !== 'queued' && p.status !== 'done' && !p.conflict;
  const rows = [tr('<dt>状態</dt><dd><span class="rf-state">{label}</span></dd>', { label: (esc(label)) })];
  if (x.issue) rows.push(`<dt>Issue</dt><dd><a class="issue-chip" data-url="${esc(x.issue.url)}">#${x.issue.number}</a> ${esc(x.issue.title || '')}</dd>`);
  if (x.after && x.after.length) rows.push(tr('<dt>順番（目安）</dt><dd>{v} のあと</dd>', { v: quoteNames(x.after.map((a) => esc(title.get(a) || a))) }));
  if (x.agent) rows.push(tr('<dt>エージェント</dt><dd>{v}</dd>', { v: (esc(agentLabel(x.agent))) }));
  if (x.branch) rows.push(tr('<dt>ブランチ</dt><dd>{branch}</dd>', { branch: (esc(x.branch)) }));
  if (x.merged) rows.push(tr('<dt>マージ</dt><dd>親のブランチ {v} にマージ済み{v2}</dd>', { v: (esc(p.branch || '')), v2: (x.mergedAt ? tr('（{at}）', { at: esc(hhmm(x.mergedAt)) }) : '') }));
  if (x.costUsd) rows.push(tr('<dt>コスト</dt><dd>${v}</dd>', { v: (x.costUsd.toFixed(3)) }));
  openModal(
    tr('<div class="sub-modal rs-{v}">\n      <div class="d-title-row"><span class="rf-dot" title="{label}">{mark}</span>{v2}<button class="icon" id="subModalClose" title="閉じる">✕</button></div>\n      <p class="muted small">「{title}」のサブタスク{v3}</p>\n      <dl class="d-meta">{v4}</dl>\n      <div class="pg-sec-head"><b>やること</b></div>\n      {v5}\n      {v6}\n      <div class="modal-actions">{v7}</div>\n    </div>', { v: (subItemState(p, x)), label: (esc(label)), mark, v2: (editing ? tr('<input id="subEditTitle" class="sub-edit-title" placeholder="サブタスクの名前" value="{title}" />', { title: (esc(x.title)) }) : `<h2 class="d-title">${esc(x.title)}</h2>`), title: (esc(p.title)), v3: (x.state === 'pending' ? tr('です。まだ始めていません') : tr('です。作業は終わっていて、サブタスクのカードは片付けました')), v4: (rows.join('')), v5: (editing ? tr('<textarea id="subEditPrompt" class="sub-edit-prompt" rows="14" placeholder="このサブタスクでやること（Markdown で書けます）">{v}</textarea>', { v: (esc(x.prompt || '')) }) : x.prompt ? mdHtml(x.prompt) : tr('<p class="muted small">（書かれていません）</p>')), v6: (x.report && !editing ? tr('<div class="pg-sec-head"><b>サブタスクの報告</b></div>{v}', { v: (mdHtml(x.report)) }) : ''), v7: (editing
          ? tr('<button class="btn primary" id="subModalSave">保存</button><button class="btn ghost" id="subModalCancel">やめる</button>')
          : tr('{v}{v2}<button class="btn ghost" id="subModalOk">閉じる</button>', { v: (editable ? tr('<button class="btn" id="subModalEdit" title="サブタスクの名前とやることを変えます">{v}編集</button>', { v: (icon('note')) }) : ''), v2: (startable ? tr('<button class="btn primary" id="subModalStart" title="ほかのサブタスクは動かさずに、このサブタスクだけを開始します">{v}このサブタスクだけ開始</button>', { v: (icon('play')) }) : '') })) }),
    () => {
      $('subModalClose').onclick = closeModal;
      if (editing) {
        $('subEditTitle').focus();
        $('subModalCancel').onclick = () => openSubtaskDetail(p, x);
        $('subModalSave').onclick = async () => {
          const saved = await runBusy(tr('保存しています…'), () => api.editSubtask(p.id, x.key, { title: $('subEditTitle').value, prompt: $('subEditPrompt').value }), tr('保存しました'));
          if (!saved) return;
          const np = card(p.id) || p;
          openSubtaskDetail(np, (np.subtasks?.items || []).find((y) => y.key === x.key) || { ...x, ...saved });
        };
        return;
      }
      $('subModalOk').onclick = closeModal;
      if ($('subModalEdit')) $('subModalEdit').onclick = () => openSubtaskDetail(p, x, { editing: true });
      $('modalBox').querySelectorAll('.issue-chip').forEach((a) => (a.onclick = () => run(() => api.openExternal(a.dataset.url))));
      if ($('subModalStart')) $('subModalStart').onclick = () => {
        closeModal();
        runBusy(tr('サブタスク「{title}」を開始しています…', { title: (x.title) }), () => api.startSubtaskOnly(p.id, x.key), tr('サブタスクを開始しました'));
      };
    },
  );
}
async function moveSubTo(c, x, to) {
  if (!canDropSub(c, x, to)) return;
  const from = subItemColumn(x);
  if (to === 'running') return runBusy(tr('サブタスク「{title}」を開始しています…', { title: (x.title) }), () => api.startSubtaskOnly(c.id, x.key), tr('サブタスクを開始しました'));
  if (to === 'done' && from === 'review' && x.state === 'running' && !confirm(tr('サブタスク「{title}」を、親のブランチに取り込まずに完了にします。このサブタスクの変更（worktree とブランチ）は消えます。よろしいですか？', { title: (x.title) }))) return;
  if (to === 'todo' && !confirm(tr('サブタスク「{title}」を未着手に戻します。{v}よろしいですか？', { title: (x.title), v: (x.merged ? tr('前にマージした変更は親のブランチに残ります。') : '') }))) return;
  return runBusy(tr('サブタスクを動かしています…'), () => api.moveSubtask(c.id, x.key, to), tr('動かしました'));
}
function subKidsSig(c) {
  if (c.subtaskOf) {
    const p = subtaskParent(c);
    const item = subItemOf(c);
    return p ? [p.id, p.subtasks.merge, p.branch, c.subtaskOf.approved, !!(item && item.manual)] : null;
  }
  return subKids(c).map((k) => [k.id, k.status, k.awaitingReply, k.specState, !!k.conflict, (k.permissions || []).length, (k.questions || []).length, k.lastMessage, k.costUsd]);
}
// 詳細の上のサブタスクの操作（提案に答える・取り込む・編集の行を足す/外す）
async function subtaskAction(c, el) {
  const act = el.dataset.sact;
  if (act === 'add') {
    const rows = el.closest('.sub-editor').querySelector('.sub-rows');
    rows.insertAdjacentHTML('beforeend', subRowHtml({ key: '', title: '', prompt: '', after: [] }));
    rows.lastElementChild?.querySelector('.sub-title')?.focus();
    return;
  }
  if (act === 'remove') return el.closest('.sub-row').remove();
  if (act === 'approve') return runBusy(tr('親のタスクのブランチに取り込んでいます…'), () => api.approveSubtask(el.dataset.sid), tr('取り込みました'));
  if (act === 'startOne') return runBusy(tr('サブタスクを開始しています…'), () => api.startSubtaskOnly(c.id, el.dataset.key), tr('サブタスクを開始しました'));
  if (act === 'auto') return runBusy(tr('残りのサブタスクを進めています…'), () => api.autoRunSubtasks(c.id), tr('残りを自動で進めます'));
  if (act === 'decline') return runBusy(tr('分けずに進めてもらいます…'), () => api.declineSubtasks(c.id), tr('分けずに進めてもらいます'));
  if (act === 'accept') {
    const box = $('subProposal');
    const items = subRowsFrom(box);
    if (!items.length) return toast(tr('サブタスクを1つ以上入れてください'));
    const createIssues = !!($('subIssues') && $('subIssues').checked);
    if (createIssues && !confirm(tr('GitHub に {n} 件のサブIssue を作って、#{number} にぶら下げます。よろしいですか？', { n: (items.filter((x) => !x.issue).length), number: (c.issue.number) }))) return;
    return runBusy(createIssues ? tr('サブIssue を作って、サブタスクを始めています…') : tr('サブタスクを始めています…'), () => api.acceptSubtasks(c.id, { items, merge: $('subMerge').value, createIssues }), tr('サブタスクを始めました'));
  }
}

// 「進捗」タブ: エージェントの TODO・Pipelineのフローチャート・最近の作業
const TODO_MARK = { completed: ['✓', tr('完了')], in_progress: ['▶', tr('作業中')], pending: ['○', tr('これから')], cancelled: ['–', tr('取りやめ')] };
function todoListHtml(todos, title) {
  const items = (todos && todos.items) || [];
  if (!items.length) return '';
  const live = items.filter((t) => t.status !== 'cancelled');
  const doneN = live.filter((t) => t.status === 'completed').length;
  const pct = live.length ? Math.round((doneN / live.length) * 100) : 0;
  return tr('<section class="pg-sec">\n    <div class="pg-sec-head"><b>{v}</b> <span class="muted small">{doneN}/{length} 完了{v2}</span></div>\n    <div class="pg-bar" title="{pct}%"><span style="width:{pct}%"></span></div>\n    <ul class="pg-todos">{v3}</ul>\n  </section>', { v: (title || 'TODO'), doneN, length: (live.length), v2: (todos.at ? tr('・{v} に更新', { v: (hhmm(todos.at)) }) : ''), pct, v3: (items.map((t) => `<li class="td-${t.status}"><span class="td-mark" title="${TODO_MARK[t.status][1]}">${TODO_MARK[t.status][0]}</span><span class="td-text">${esc(t.text)}</span></li>`).join('')) });
}
// 最近の作業（ログの最後のツールの呼び出し・返事）
function recentWorkHtml(c) {
  const logs = state.logs.get(c.id) || [];
  const out = [];
  for (let i = logs.length - 1; i >= 0 && out.length < 8; i--) {
    const e = logs[i];
    if (!e || (e.kind !== 'tool' && e.kind !== 'text' && e.kind !== 'error' && e.kind !== 'result')) continue;
    const txt = String(e.text || '').replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    out.push(`<li class="rw-${e.kind}"><span class="rw-t">${e.t ? hhmm(e.t) : ''}</span><span class="rw-x">${esc(txt.length > 160 ? `${txt.slice(0, 159)}…` : txt)}</span></li>`);
  }
  if (!out.length) return '';
  return tr('<section class="pg-sec"><div class="pg-sec-head"><b>最近の作業</b> <span class="muted small">新しい順（くわしくは「ログ」で見られます）</span></div><ul class="pg-recent">{v}</ul></section>', { v: (out.join('')) });
}
// Pipelineのフローチャート（読み取り専用）。終わった工程・今の工程・通った線に色を付ける
function relayChartHtml(c) {
  const r = c.relay;
  if (!r || !r.flow || typeof FlowView === 'undefined') return '';
  const idx = new Map(r.steps.map((st, i) => [st.id, i]));
  const states = FlowView.nodeStates(r.flow, (id) => (idx.has(id) ? relayStepState(c, idx.get(id)) : null), {
    started: !!(r.history || []).length || !!r.stepStartedAt || c.status !== 'todo',
    finished: !!r.done && !r.waiting && relayStepState(c, r.index) === 'done',
  });
  const marks = {};
  const labels = {};
  for (const [k, [m, l]] of Object.entries(RELAY_STATE)) (marks[k] = m), (labels[k] = l);
  const svg = FlowView.html(r.flow, states, {
    marks,
    labels,
    counts: r.counts,
    current: !r.waiting && !r.done && r.steps[r.index] ? r.steps[r.index].id : null,
    zoom: state.chartZoom,
    stepInfo: (n) => {
      const i = idx.get(n.id);
      const st = i == null ? null : r.steps[i];
      if (!st) return {};
      return { title: `${i + 1}. ${FlowModel.displayText(st.label, 'step')}`, sub: whoShort(st.agent, st.persona), tip: whoLabel(st.agent, st.persona) + (st.model ? ` / ${st.model}` : '') };
    },
  });
  if (!svg) return '';
  return tr('<div class="pg-chart-wrap"><div class="pg-chart">{svg}</div><div class="zoom-host">{v}</div></div><div class="pg-legend muted small"><span class="lg lg-done">完了</span><span class="lg lg-run">実行中</span><span class="lg lg-warn">止まっている・待っている</span><span class="lg lg-pending">これから</span><span class="lg lg-skip">スキップ</span></div>', { svg, v: (chartZoomBar()) });
}
// 進捗タブのフローチャートの拡大・縮小（state.chartZoom が null のときは、枠の幅に収める）
function chartZoomBar() {
  return state.chartZoom == null ? Zoom.toolbarHtml(1, tr('全体')) : Zoom.toolbarHtml(state.chartZoom);
}
// 今の見た目の倍率（枠に収めているときは、実際に縮んでいる割合）
function chartZoomNow(svg) {
  if (state.chartZoom != null) return state.chartZoom;
  const vw = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.width : 0;
  return vw ? svg.getBoundingClientRect().width / vw : 1;
}
// 描き直さずに、いまの SVG の大きさだけ変える（次に描き直すときも同じ倍率で描く）
function setChartZoom(chart, z, at) {
  const svg = chart.querySelector('svg.fv');
  if (!svg) return;
  const z0 = chartZoomNow(svg);
  const vb = svg.viewBox.baseVal;
  if (z == null) {
    state.chartZoom = null;
    svg.setAttribute('width', vb.width);
    svg.setAttribute('height', vb.height);
    svg.setAttribute('style', 'max-width:100%;height:auto');
    chart.scrollLeft = 0;
    chart.scrollTop = 0;
  } else {
    const z1 = Zoom.clamp(z);
    const p = at || { x: chart.clientWidth / 2, y: chart.clientHeight / 2 };
    const s = Zoom.anchor(chart.scrollLeft, chart.scrollTop, p.x, p.y, z0, z1);
    state.chartZoom = z1;
    svg.removeAttribute('style');
    svg.setAttribute('width', Math.round(vb.width * z1));
    svg.setAttribute('height', Math.round(vb.height * z1));
    chart.scrollLeft = s.left;
    chart.scrollTop = s.top;
  }
  const host = chart.parentElement.querySelector('.zoom-host');
  if (host) host.innerHTML = chartZoomBar();
}
function bindChartZoom(view) {
  const chart = view.querySelector('.pg-chart');
  if (!chart) return;
  const host = chart.parentElement.querySelector('.zoom-host');
  if (host)
    host.onclick = (ev) => {
      const b = ev.target.closest('[data-zoom]');
      if (!b) return;
      const k = b.dataset.zoom;
      const svg = chart.querySelector('svg.fv');
      if (k === 'fit') setChartZoom(chart, null);
      else if (k === 'reset') setChartZoom(chart, 1);
      else if (svg) setChartZoom(chart, Zoom.step(chartZoomNow(svg), k === 'in' ? 1 : -1));
    };
  Zoom.bindWheel(chart, { get: () => { const svg = chart.querySelector('svg.fv'); return svg ? chartZoomNow(svg) : 1; }, set: (z, at) => setChartZoom(chart, z, at) });
}
function progressHtml(c) {
  const s = c.status;
  const live = s === 'running' || s === 'queued';
  const [bcls, blabel] = badgeFor(c);
  const rows = [];
  rows.push(tr('<dt>状態</dt><dd><span class="badge b-{bcls}">{blabel}</span>{v}</dd>', { bcls, blabel: (esc(blabel)), v: (c.lastMessage && live ? ` <span class="muted small">${esc(c.lastMessage)}</span>` : '') }));
  if (c.startedAt && s !== 'todo') rows.push(`<dt>${live ? tr('開始') : tr('最後に開始')}</dt><dd>${hhmm(c.startedAt)}${s === 'running' ? tr('（<span class="elapsed" data-since="{since}">{elapsed}</span>）', { since: esc(c.startedAt), elapsed: esc(elapsed(c.startedAt)) }) : ''}</dd>`);
  if (!isChat(c) || c.persona) rows.push(tr('<dt>エージェント</dt><dd>{v}{v2}</dd>', { v: (personaIcon(c.persona, agentOf(c))), v2: (esc(whoLabel(agentOf(c), c.persona))) }));
  const cost = hasSubtasks(c) ? subTotalCost(c) : c.costUsd;
  if (cost) rows.push(tr('<dt>コスト</dt><dd>${v}{v2}</dd>', { v: (cost.toFixed(3)), v2: (hasSubtasks(c) ? tr(' <span class="muted small">サブタスクを含む</span>') : '') }));
  const parts = [`<section class="pg-sec"><dl class="d-meta pg-summary">${rows.join('')}</dl></section>`];
  // 競争の候補（採用・比べてもらう）
  const compete = competeBoxHtml(c);
  if (compete) parts.push(`<section class="pg-sec">${compete}</section>`);
  if (s === 'todo') parts.push(tr('<p class="muted small pg-note">まだ開始していません。開始すると、ここで進み具合を見られます。</p>'));
  parts.push(subtaskProgressHtml(c));
  if (c.relay && !isChat(c)) {
    parts.push(tr('<section class="pg-sec"><div class="pg-sec-head"><b>{v}フローチャート</b></div>{v2}</section>', { v: (icon('pipeline')), v2: (relayChartHtml(c)) }));
    parts.push(`<section class="pg-sec">${relayFlowHtml(c)}</section>`);
  }
  // 今のエージェントの TODO（並列の枝を待っているときは、枝ごと）
  const kids = c.relay && c.relay.waiting ? c.relay.waiting.children.map((id) => card(id)).filter(Boolean) : [];
  if (kids.length) for (const k of kids) parts.push(todoListHtml(k.todos, tr('枝「{label}」の TODO', { label: (esc(k.relay.branchOf.label)) })));
  else if (c.todos && c.todos.items && c.todos.items.length) parts.push(todoListHtml(c.todos, c.relay && c.relay.steps[c.relay.index] ? tr('工程「{v}」の TODO', { v: (esc(c.relay.steps[c.relay.index].label)) }) : tr('{v} の TODO', { v: (esc(whoShort(agentOf(c), c.persona))) })));
  else if (live) parts.push(tr('<p class="muted small pg-note">エージェントが作業の TODO を作ると、ここに出ます（作らないこともあります）。</p>'));
  parts.push(recentWorkHtml(c));
  return parts.filter(Boolean).join('');
}
// 開始する前は、進捗の下でタイトルと最初の指示を編集できる（指示は「チャット」の上でも見られます）
function bindPromptEdit(c) {
  const box = $('progressEdit');
  if (!box) return;
  box.innerHTML = tr('<section class="pg-sec">\n      <div class="pg-sec-head"><b>開始する前に編集</b></div>\n      <label class="field"><span>タイトル</span><input id="editTitle" value="{title}" /></label>\n      <div class="field"><span>最初の指示</span><div id="editSkill" class="skill-slot"></div><textarea id="editPrompt" rows="10">{prompt}</textarea>{v}</div>\n      <button class="btn primary" id="saveEdit">保存</button>\n    </section>\n    <div id="subEditSlot"></div>', { title: (esc(c.title)), prompt: (esc(c.prompt)), v: (c.attachments && c.attachments.length ? tr('<small class="muted">添付ファイル</small>{v}', { v: (attachFilesHtml(c.attachments, { all: true })) }) : '') });
  let editSkill = c.skill || null;
  const drawEditSkill = () => renderSkillSlot('editSkill', editSkill, (v) => ((editSkill = v), drawEditSkill()), { disabled: false });
  drawEditSkill();
  $('saveEdit').onclick = () => runBusy(tr('保存しています…'), () => api.updateCard({ id: c.id, title: $('editTitle').value, prompt: $('editPrompt').value, skill: editSkill || '' }), tr('保存しました'));
}
// 開始する前にサブタスクを足す・直す欄（サブタスクがあれば「サブタスク」タブ、なければ「進捗」タブに出す）
function bindSubEdit(c, slot) {
  slot.innerHTML = tr('<section class="pg-sec" id="subEdit">\n      <div class="pg-sec-head"><b>{v}サブタスクを編集</b> <span class="muted small">分けて進めるときに足します。順番（直列・並列）は、開始したときに {v2} が決めます</span></div>\n      {v3}\n      {v4}\n      <button class="btn" id="saveSubtasks">サブタスクを保存</button>\n    </section>', { v: (icon('branch')), v2: (esc(agentShort(agentOf(c)))), v3: (subEditorHtml(c.subtasks ? c.subtasks.items : [])), v4: (subMergeSelectHtml('editSubMerge', c.subtasks ? c.subtasks.merge : (state.board.settings || {}).subtaskMerge)) });
  const subBox = $('subEdit');
  subBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sact]');
    if (b) subtaskAction(c, b);
  });
  $('saveSubtasks').onclick = () => {
    const items = subRowsFrom(subBox);
    runBusy(tr('保存しています…'), () => api.setSubtasks(c.id, { items, merge: $('editSubMerge').value }), items.length ? tr('サブタスクを {n} 個にしました', { n: (items.length) }) : tr('サブタスクをやめました'));
  };
}
// 進捗タブの編集欄: サブタスクがないときだけ、ここで足せるようにする（タイトルと指示の入力中の内容は消さない）
function syncProgressSubEdit(c) {
  const slot = $('subEditSlot');
  if (!slot) return;
  const want = canHaveSubtasks(c) && !hasSubtasks(c);
  if (want === !!slot.firstChild) return;
  slot.innerHTML = '';
  if (want) bindSubEdit(c, slot);
}
// force: 作り直す（タブを開いたとき）。そうでなければ、中身が変わったときだけ描き直す（開いている報告・スクロールは保つ）
function renderProgress(c, { force = false } = {}) {
  const body = $('detailBody');
  const editable = c.status === 'todo' && !isChat(c);
  if (force || !$('progressView') || body.dataset.progressCard !== c.id || body.dataset.progressEdit !== String(editable)) {
    body.innerHTML = `<div class="pad progress"><div id="progressView"></div>${editable ? '<div id="progressEdit"></div>' : ''}</div>`;
    body.dataset.progressCard = c.id;
    body.dataset.progressEdit = String(editable);
    body.dataset.progressSig = '';
    if (editable) bindPromptEdit(c);
  }
  syncProgressSubEdit(c);
  const html = progressHtml(c);
  // 経過時間は1秒ごとに書き換わるので、比べるときは除く
  const sig = html.replace(/(<span class="elapsed"[^>]*>)[^<]*/g, '$1');
  if (body.dataset.progressSig === sig) return;
  body.dataset.progressSig = sig;
  const view = $('progressView');
  // 描き直しても、フローチャートのスクロール位置は保つ
  const oldChart = view.querySelector('.pg-chart');
  const scroll = oldChart ? [oldChart.scrollLeft, oldChart.scrollTop] : null;
  view.innerHTML = html;
  bindChartZoom(view);
  const chart = view.querySelector('.pg-chart');
  if (chart && scroll) [chart.scrollLeft, chart.scrollTop] = scroll;
  bindProgressView(c, view);
}
// 進捗タブ・サブタスクタブの中身のボタンやリンク（描き直すたびに付け直す）
function bindProgressView(c, view) {
  view.querySelectorAll('details[data-rkey]').forEach((d) => (d.ontoggle = () => (d.open ? state.relayOpen.add(d.dataset.rkey) : state.relayOpen.delete(d.dataset.rkey))));
  view.querySelectorAll('[data-open-card]').forEach((a) => (a.onclick = (e) => (e.preventDefault(), card(a.dataset.openCard) && select(a.dataset.openCard))));
  view.querySelectorAll('[data-sact]').forEach((b) => (b.onclick = () => subtaskAction(c, b)));
  bindSubBoard(c, view);
  view.onclick = (e) => {
    if (e.target.closest('[data-act], [data-goto], [data-cact]')) detailAction(e);
  };
  view.querySelectorAll('.issue-chip').forEach((a) => (a.onclick = () => run(() => api.openExternal(a.dataset.url))));
}
// サブタスクタブ。force や描き直しの考え方は renderProgress と同じ
function renderSubtasksTab(c, { force = false } = {}) {
  const body = $('detailBody');
  const editable = c.status === 'todo' && canHaveSubtasks(c);
  if (force || !$('subtasksView') || body.dataset.subtasksCard !== c.id || body.dataset.subtasksEdit !== String(editable)) {
    body.innerHTML = `<div class="pad progress"><div id="subtasksView"></div>${editable ? '<div id="subtasksEdit"></div>' : ''}</div>`;
    body.dataset.subtasksCard = c.id;
    body.dataset.subtasksEdit = String(editable);
    body.dataset.subtasksSig = '';
    if (editable) bindSubEdit(c, $('subtasksEdit'));
  }
  const html = subtaskListHtml(c);
  if (body.dataset.subtasksSig === html) return;
  body.dataset.subtasksSig = html;
  const view = $('subtasksView');
  view.innerHTML = html;
  bindProgressView(c, view);
}
// ログが届くたびに描き直すと重いので、まとめて描き直す
let progressTimer = null;
function scheduleProgress() {
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    const c = card(state.selected);
    if (c && state.tab === 'progress') renderProgress(c);
    else if (c && state.tab === 'subtasks') renderSubtasksTab(c);
  }, 300);
}

// 並列の枝のタスクの状態が変わったら、元のタスクの詳細も描き直す
function relayKidsSig(c) {
  const w = c.relay && c.relay.waiting;
  if (!w) return null;
  return w.children.map((id) => {
    const k = card(id);
    return k ? [id, k.status, k.awaitingReply, k.relay && k.relay.index, k.relay && k.relay.atJoin, (k.permissions || []).length] : [id];
  });
}

// 詳細: 並列の枝を待っているあいだの、枝ごとの状態（押すと枝のタスクを開く）。枝のタスクなら、元のタスク
function relayWaitHtml(c) {
  const r = c.relay;
  if (r.branchOf) {
    const p = state.board.cards.find((x) => x.id === r.branchOf.parent);
    const into = p
      ? tr('合流で <a href="#" data-open-card="{id}">{title}</a> にマージします。', { id: esc(p.id), title: esc(p.title) })
      : tr('合流で元のタスクにマージします。');
    const tail = r.atJoin ? tr('（この枝は終わり、ほかの枝を待っています）') : '';
    return `<div class="rf-wait">${tr('並列の枝 {n}「{label}」です。', { n: r.branchOf.index + 1, label: esc(r.branchOf.label) })}${into}${tail}</div>`;
  }
  if (!r.waiting) return '';
  const n = FlowModel.nodeOf(r.flow, r.waiting.node);
  const kids = r.waiting.children.map((id) => {
    const k = state.board.cards.find((x) => x.id === id);
    if (!k) return tr('<li>（削除された枝）</li>');
    const st = k.relay.atJoin ? (r.waiting.merged.includes(k.id) ? tr('マージ済み') : tr('合流待ち')) : badgeFor(k)[1];
    return tr('<li><a href="#" data-open-card="{id}">{label}</a>（{who}・{st}）</li>', { id: esc(k.id), label: esc(k.relay.branchOf.label), who: esc(agentShort(agentOf(k))), st: esc(st) });
  });
  return tr('<div class="rf-wait">並列「{v}」の枝を、それぞれ別の worktree で動かしています。すべて終わったら、このブランチにマージして先へ進みます。<ul>{v2}</ul></div>', { v: (esc((n && n.label) || '')), v2: (kids.join('')) });
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
      return `<button class="compete-item ${x.id === c.id ? 'cur' : ''}" data-goto="${x.id}"><span class="badge b-${bcls}">${blabel}</span> <b>${personaIcon(x.persona, agentOf(x))}${esc(whoLabel(agentOf(x), x.persona))}</b> <span class="muted small">${esc(x.lastMessage || '')}</span></button>`;
    })
    .join('');
  const canAdopt = c.status === 'review' || c.status === 'failed';
  return tr('<div class="compete-box"><b>{v}競争: 同じタスクを {length} つのエージェントで解いています</b>\n    <div class="compete-list">{rows}</div>\n    <small>{v2}差分タブでそれぞれの変更を見比べて、よいものを採用してください。採用すると、ほかの候補は worktree とブランチごと破棄します。</small>\n    <div class="d-actions">\n      {v3}\n      <button class="btn" data-act="compare" {v4}>{v5}{v6}{v7} に比べてもらう</button>\n      {v8}\n    </div></div>', { v: (icon('flag')), length: (list.length), rows, v2: (busy ? tr('まだ動いている候補があります。') : tr('すべての候補が終わりました。')), v3: (canAdopt ? tr('<button class="btn primary" data-act="adopt">{v}この案（{v2}）を採用</button>', { v: (icon('flag')), v2: (esc(agentShort(agentOf(c)))) }) : ''), v4: (busy ? tr('title="終わっていない候補は、その時点の内容で比べます"') : ''), v5: (icon('compare')), v6: (agentIcon(defaultAgent())), v7: (esc(agentShort(defaultAgent()))), v8: (c.compete.compareChat && card(c.compete.compareChat) ? tr('<button class="btn ghost" data-goto="{compareChat}">比較の会話を開く</button>', { compareChat: (c.compete.compareChat) }) : '') });
}

function renderDetailHead() {
  const c = card(state.selected);
  if (!c) return closeDetailOrBack();
  const sig = JSON.stringify([c.conflict, c.conflictResolved, c.status, c.title, c.error, c.branch, c.worktreePath, c.costUsd, c.permissions, c.alwaysAllow, c.mergedInto, c.pushedTo, c.prUrl, c.prBase, c.prState, c.prMergeable, state.board.settings.integration, c.sessionId, c.forkNext, c.sessions, c.questions, c.awaitingReply, c.specState, c.specQuestions, c.interrupted, c.agent, c.relay, c.compete, competitors(c).map((x) => [x.id, x.status, x.branch]), relayKidsSig(c), c.subtasks, c.subtaskProposal, c.subtaskOf, subKidsSig(c)]);
  if (sig === state.headSig) return;
  state.headSig = sig;
  const s = c.status;
  const chat = isChat(c);
  const btns = chat ? [
    isInterrupted(c) && tr('<button class="btn primary" data-act="resume" title="中断したところから続けます">{v}再開</button>', { v: (icon('play')) }),
    (s === 'running' || s === 'queued') && tr('<button class="btn" data-act="stop">{v}停止</button>', { v: (icon('stop')) }),
    c.sessionId && s !== 'running' && s !== 'queued' &&
      tr('<button class="btn" data-act="toTask" title="この会話の続きとして、worktree で作業するタスクを作ります（会話はそのまま残ります）">{v}タスクにする</button>', { v: (icon('note')) }),
    tr('<button class="btn danger" data-act="discard">削除</button>'),
  ].filter(Boolean) : [
    isInterrupted(c) && tr('<button class="btn primary" data-act="resume" title="中断したところから続けます">{v}再開</button>', { v: (icon('play')) }),
    s === 'todo' && !isInterrupted(c) && tr('<button class="btn primary" data-act="start">{v}開始</button>', { v: (icon('play')) }),
    (s === 'running' || s === 'queued') && tr('<button class="btn" data-act="stop">{v}停止</button>', { v: (icon('stop')) }),
    (s === 'review' || s === 'failed') && isNoGit(c) &&
      tr('<button class="btn primary" data-act="complete" title="{COMPLETE_TITLE}">{v}完了にする</button>', { COMPLETE_TITLE, v: (icon('check')) }),
    (s === 'review' || s === 'failed') && c.worktreePath && !isHiddenSubtask(c) && !subtasksBlockMerge(c) &&
      (state.board.settings.integration === 'pr'
        ? `<button class="btn primary" data-act="pr">${icon('pr')}${c.prUrl ? tr('PR を更新…') : tr('PR を作成…')}</button>`
        : tr('<button class="btn primary" data-act="merge">{v}マージ…</button>', { v: (icon('merge')) })),
    // 完了したタスクは開き直さない。修正は別のタスクにする（このタスクのやりとりを引き継ぐ）
    s === 'done' && tr('<button class="btn" data-act="fixTask" title="このタスクのやりとり（完了後の会話も含む）を引き継いで、修正のための新しいタスクを作ります">{v}修正タスクを作る</button>', { v: (icon('wrench')) }),
    (c.worktreePath || isNoGit(c)) && tr('<button class="btn ghost" data-act="open">フォルダを開く</button>'),
    AppView.canSchedule(c) && tr('<button class="btn ghost" data-act="schedule" title="このタスクの内容をコピーして、スケジュールに登録します（添付ファイルはコピーしません）">{v}スケジュール登録</button>', { v: (icon('calendar')) }),
    // 完了したタスク（完了後の会話の途中も含む）は削除できない
    s !== 'done' && !c.afterDone && tr('<button class="btn danger" data-act="discard">破棄</button>'),
  ].filter(Boolean);
  $('detailTitle').innerHTML = tr('\n    <div class="d-title-row">\n      <span class="badge b-{v}">{v2}</span>\n      <h2 class="d-title" id="detailTitleText" title="{title}">{title}</h2>\n      <button class="icon" id="closeDetail" title="閉じる">✕</button>\n    </div>', { v: (badgeFor(c)[0]), v2: (badgeFor(c)[1]), title: (esc(c.title)) });
  // 上の段はボタンだけ（1行・高さは固定）。Pipeline・全体の進み具合と競争は「進捗」タブ、サブタスクの一覧は「サブタスク」タブ、
  // 中断・エラー・コンフリクト・サブタスクの提案は「チャット」タブの最後に出す
  $('detailHead').innerHTML = `<div class="d-actions">${btns.join('')}</div>`;
  $('closeDetail').onclick = closeDetailOrBack;
  if (state.tab === 'info') renderInfo(c);
  drawLogActions(c);
  const canFollow = canSendFollow(c);
  $('followInput').disabled = !canFollow;
  drawFollowSkill();
  followAttach.sync();
  $('followBtn').disabled = !canFollow;
  $('followInput').placeholder =
    chat ? (canFollow ? tr('メッセージを送る（Ctrl/⌘ + Enter で送信）。同じ会話の続きとして話せます') : tr('返事が来たら、続きを話せます'))
    : canFollow && isSpecPending(c) ? tr('質問への答えを書く（Ctrl/⌘ + Enter で送信）。分からないところは「おまかせ」と書いてもかまいません')
    : canFollow && c.awaitingReply ? tr('{v} への回答を書く（Ctrl/⌘ + Enter で送信）', { v: (agentShort(agentOf(c))) })
    : s === 'done' ? tr('完了したタスクについて話す（Ctrl/⌘ + Enter で送信）。ファイルは変えずに答えます。修正が必要なときは「修正タスクを作る」から別のタスクにしてください')
    : c.afterDone ? tr('返事が来たら、続きを話せます')
    : canFollow ? tr('追加の指示を送る（Ctrl/⌘ + Enter で送信）。同じセッションの続きとして動きます')
    : s === 'todo' ? tr('開始すると、終わったあとに追加の指示を送れます')
    : tr('エージェントの作業中は送れません');
}

// 詳細の「情報」タブ: エージェント・会話・ブランチ・worktree・PR・コストなど
function detailMetaHtml(c) {
  const s = c.status;
  const chat = isChat(c);
  return tr('<dl class="d-meta">\n      {v}\n      {v2}\n      <dt>モデル</dt><dd>{v3}</dd>\n      {v4}\n      {v5}\n      {v6}\n      {v7}\n      {v8}\n      {v9}\n      {v10}\n      {v11}\n      {v12}\n      {v13}\n    </dl>', { v: (c.issue ? `<dt>Issue</dt><dd><a class="issue-chip" data-url="${esc(c.issue.url)}">#${c.issue.number}</a> ${esc(c.issue.url)}</dd>` : ''), v2: (!chat || c.persona ? tr('<dt>エージェント</dt><dd>{v}{v2}{v3}</dd>', { v: (personaIcon(c.persona, agentOf(c))), v2: (esc(whoLabel(agentOf(c), c.persona))), v3: (c.persona && c.persona.description ? ` <span class="muted small">${esc(c.persona.description)}</span>` : '') }) : ''), v3: (c.model ? esc(c.model) : settingsModel(agentOf(c)) ? tr('{v} <span class="muted small">（設定の既定）</span>', { v: (esc(settingsModel(agentOf(c)))) }) : tr('<span class="muted small">CLI の既定</span>')), v4: (sessionRowHtml(c)), v5: (chat ? tr('<dt>場所</dt><dd class="mono">{repoPath} <span class="muted small">（worktree は作りません）</span></dd>', { repoPath: (esc(c.repoPath)) }) : ''), v6: (!chat && c.readOnly ? tr('<dt>場所</dt><dd class="mono">{repoPath} <span class="muted small">（ソースを変更しないタスク。worktree は作らず、ファイルを書き換えるツールを止めて、このフォルダで動かします。作ったものはチャットに出ます）</span></dd>', { repoPath: (esc(c.repoPath)) }) : ''), v7: (!chat && isNoGit(c) && !c.readOnly ? tr('<dt>場所</dt><dd class="mono">{repoPath} <span class="muted small">（git で管理していないフォルダ。worktree は作らず、このフォルダで直接動かします）</span></dd>', { repoPath: (esc(c.repoPath)) }) : ''), v8: (c.branch ? tr('<dt>ブランチ</dt><dd>{branch} ← {baseBranch}</dd>', { branch: (esc(c.branch)), baseBranch: (esc(c.baseBranch)) }) : ''), v9: (c.worktreePath ? `<dt>worktree</dt><dd class="mono">${esc(c.worktreePath)}</dd>` : ''), v10: (c.prUrl ? `<dt>PR</dt><dd><a class="issue-chip" data-url="${esc(c.prUrl)}">${esc(c.prUrl)}</a>${c.prBase ? ` → ${esc(c.prBase)}` : ''}${c.prState === 'MERGED' ? tr('（マージ済み）') : c.prState === 'CLOSED' ? tr('（閉じられました）') : ''}${c.prState === 'OPEN' && c.prMergeable === 'CONFLICTING' ? tr(' <span class="badge b-conflict">コンフリクト</span>{v}', { v: (c.worktreePath && !c.conflict && (s === 'review' || s === 'failed') ? tr(' <button class="btn small" data-act="prConflict">解消する</button>') : '') }) : ''}</dd>` : ''), v11: ((c.mergedInto || []).length ? tr('<dt>マージ済み</dt><dd>{v}</dd>', { v: (c.mergedInto.map((b) => esc(b) + ((c.pushedTo || []).includes(b) ? tr('（origin にも push 済み）') : '')).join(', ')) }) : ''), v12: (c.costUsd ? tr('<dt>コスト</dt><dd>${v}</dd>', { v: (c.costUsd.toFixed(3)) }) : ''), v13: ((c.alwaysAllow || []).length ? tr('<dt>常に許可</dt><dd>{v}</dd>', { v: (c.alwaysAllow.map(esc).join(', ')) }) : '') });
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
      await run(() => api.setSession(c.id, sess), v === '__new__' ? tr('次は新しい会話で始めます') : tr('次はこの会話の続きで始めます'));
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
// 質問のすぐ下の回答欄でも、Ctrl/⌘ + Enter で送る
$('detailBody').addEventListener('keydown', (e) => {
  const box = e.target.closest('.reply-qform .q-note');
  if (!box || e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  const form = box.closest('.qform');
  const c = card(form.dataset.card);
  if (c) sendReplyAnswer(form, c);
});
function logActionClick(e) {
  const sa = e.target.closest('[data-sact]');
  if (sa) {
    const c = card(state.selected);
    if (c) subtaskAction(c, sa);
    return;
  }
  const cp = e.target.closest('[data-complete]');
  if (cp) return completeNoGit(card(cp.dataset.complete));
  const op = e.target.closest('[data-act-open]');
  if (op) return run(() => api.open(op.dataset.actOpen));
  const rq = e.target.closest('[data-rqact]');
  if (rq) {
    const form = rq.closest('.qform');
    const c = card(form.dataset.card);
    if (c) sendReplyAnswer(form, c);
    return;
  }
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
    if (empty) toast(tr('「{v}」に答えてください', { v: (empty[0]) }));
    else sendAnswer(c.id, form.dataset.req, answers);
    return;
  }
  const dec = e.target.closest('[data-decision]');
  if (dec) {
    const p = dec.closest('.perm');
    answer(p.dataset.card, p.dataset.req, dec.dataset.decision, p.querySelector('.deny-reason')?.value || '');
    return;
  }
  // 中断・コンフリクトのボタン、サブタスクの親を開くリンク
  const oc = e.target.closest('[data-open-card]');
  if (oc) {
    e.preventDefault();
    if (card(oc.dataset.openCard)) select(oc.dataset.openCard);
    return;
  }
  if (e.target.closest('[data-act], [data-goto], [data-cact]')) detailAction(e);
}
$('detailHead').addEventListener('click', (e) => detailAction(e));
// 詳細のボタン（上の段・チャットの最後・進捗タブ）
async function detailAction(e) {
  const sa = e.target.closest('[data-sact]');
  if (sa) {
    const c = card(state.selected);
    if (c) subtaskAction(c, sa);
    return;
  }
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
  if (act === 'start') runBusy(tr('タスクを開始しています…'), () => api.start(c.id));
  if (act === 'resume') runBusy(tr('再開しています…'), () => api.resume(c.id), tr('再開しました'));
  if (act === 'dismissInterrupted') run(() => api.dismissInterrupted(c.id));
  if (act === 'stop') runBusy(tr('停止しています…'), () => api.stop(c.id));
  if (act === 'open') run(() => api.open(c.id));
  if (act === 'merge') openMerge(c);
  if (act === 'complete') {
    await completeNoGit(c);
    return;
  }
  if (act === 'pr') openPr(c);
  if (act === 'prConflict') run(() => api.reopenPrConflict(c.id));
  if (act === 'toTask') newTask({ fromChat: c });
  if (act === 'fixTask') newTask({ fromChat: c });
  if (act === 'adopt') {
    const others = competitors(c).filter((x) => x.id !== c.id && x.status !== 'done' && !x.afterDone);
    const msg = others.length
      ? tr('{v} の案を採用しますか？\nほかの候補（{v2}）は worktree とブランチごと破棄され、元に戻せません。', { v: (agentLabel(agentOf(c))), v2: joinMid(others.map((x) => agentShort(agentOf(x)))) })
      : tr('{v} の案を採用しますか？\nほかの候補は完了しているので、破棄せずに残します。', { v: (agentLabel(agentOf(c))) });
    if (confirm(msg)) await runBusy(tr('ほかの候補を破棄しています…'), () => api.adoptCompetitor(c.id), tr('この案を採用しました。マージ（または PR の作成）で取り込めます'));
    return;
  }
  if (act === 'compare') {
    const id = await runBusy(tr('比べてもらう会話を始めています…'), () => api.compareCompetitors(c.id));
    if (id) selectNew(id);
    return;
  }
  if (act === 'schedule') return openScheduleEditor(c);
  if (act === 'discard' && isChat(c)) {
    if (confirm(tr('会話「{title}」をボードから削除しますか？\n{v}', { title: (c.title), v: (agentOf(c) === 'claude' ? tr('（Claude Code の会話の記録は残るので、あとで「既存の会話」から引き継げます）') : '') }))) {
      await runBusy(tr('削除しています…'), () => api.discard(c.id), tr('削除しました'));
      closeDetail();
    }
    return;
  }
  if (act === 'discard') {
    if (c.status === 'done' || c.afterDone) return toast(tr('完了したタスクは削除できません'));
    if (isNoGit(c)) {
      const note = c.readOnly ? tr('ソースを変更しないタスクなので、フォルダのファイルはそのままです。') : tr('フォルダの中で変えたファイルはそのまま残ります（git で管理していないので、元には戻しません）。');
      if (confirm(tr('「{title}」をボードから削除しますか？\n{note}', { title: (c.title), note }))) {
        await runBusy(tr('削除しています…'), () => api.discard(c.id), tr('削除しました'));
        closeDetail();
      }
      return;
    }
    if (confirm(tr('「{title}」を破棄しますか？\nworktree とブランチ {v} も削除され、元に戻せません。', { title: (c.title), v: (c.branch || '') }))) {
      await runBusy(tr('worktree とブランチを削除しています…'), () => api.discard(c.id), tr('破棄しました'));
      closeDetail();
    }
  }
}

document.querySelectorAll('#tabs .tab').forEach((t) =>
  t.addEventListener('click', () => {
    setTab(t.dataset.tab);
    renderDetailHead();
    renderDetailBody();
  }),
);

// ログはチャットの形で見せる（Claude Desktop のように、あなたの指示は右の吹き出し、エージェントの返事は左）。
// Claude の返事やあなたの指示は Markdown として整えて表示する（ツールの出力などはそのまま）
const logTime = (e) => (e && e.t ? new Date(e.t).toLocaleTimeString(I18n.locale()) : '');
function mdHtml(text) {
  return typeof Markdown !== 'undefined' ? `<div class="md">${Markdown.render(text || '')}</div>` : `<div class="c-plain">${esc(text || '')}</div>`;
}
function skillChip(e) {
  return e.skill ? `<div class="c-skill"><span class="skill-chip small">${icon('zap')}/${esc(e.skill)}</span></div>` : '';
}
function chatHeadHtml(agent, e, persona) {
  return `<div class="c-head"><span class="c-avatar">${personaIcon(persona, agent)}</span><b class="c-name">${esc(whoShort(agent, persona))}</b><span class="c-time">${esc(logTime(e))}</span></div>`;
}
// 返事の頭に出すプロフィール（Pipelineは工程ごとに変わるので出さない）
function chatPersonaOf(c) {
  return c && c.persona && !c.relay ? c.persona : null;
}
// ツールの呼び出し「名前  引数の要約」を名前と引数に分ける
function splitTool(text) {
  const t = String(text || '');
  const i = t.indexOf('  ');
  return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 2)];
}
const NOTE_ICON = { result: 'checkCircle', error: 'alert', question: 'question', permission: 'lock', stderr: 'terminal' };
function chatItemHtml(it, agent, open, persona) {
  const e = it.entry;
  const pp = (it.agent || agent) === agent ? persona : null;
  if (it.type === 'user') {
    return `<div class="c-row c-user" title="${esc(logTime(e))}"><div class="c-bubble">${skillChip(e)}${mdHtml(e.text)}${logImagesHtml(e.images)}${attachFilesHtml(e.attachments)}</div></div>`;
  }
  if (it.type === 'assistant') {
    return `<div class="c-row c-agent">${it.head ? chatHeadHtml(it.agent || agent, e, pp) : ''}<div class="c-text" title="${esc(logTime(e))}">${mdHtml(e.text)}${logImagesHtml(e.images)}</div></div>`;
  }
  if (it.type === 'tool') {
    const r = it.result;
    const [name, arg] = e ? splitTool(e.text) : [tr('ツールの結果'), ''];
    const err = r && r.kind === 'tool_error';
    const st = err ? tr('<span class="c-tool-st">エラー</span>') : '';
    const out = r && r.text ? `<pre class="c-tool-out">${esc(r.text)}</pre>` : r ? tr('<div class="c-tool-out muted small">（出力はありません）</div>') : tr('<div class="c-tool-out muted small">（結果はまだありません）</div>');
    return `<div class="c-row c-agent c-toolrow">${it.head ? chatHeadHtml(it.agent || agent, e || r, pp) : ''}<details class="c-tool${err ? ' err' : ''}"${open ? ' open' : ''}><summary title="${esc(logTime(e || r))}">${icon('wrench')}<span class="c-tool-name">${esc(name)}</span><span class="c-tool-arg">${esc(arg)}</span>${st}</summary>${out}</details>${r ? logImagesHtml(r.images) : ''}</div>`;
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
  body.innerHTML = `<div class="chat-log">${items.map((it) => chatItemHtml(it, agent, false, chatPersonaOf(c))).join('')}</div><div id="logActions" class="log-actions"></div>`;
  drawLogActions(c, true);
}

// ログの最後に出す、あなたの操作が必要なもの（承認）。質問への回答はチャットタブに出す
function logActionsHtml(c) {
  const parts = [permissionBlock(c, false)];
  if (hasChatActions(c)) parts.push(chatPending(c) ? tr('<div class="d-awaiting"><b>{v}{v2} が質問しています</b><small>「チャット」タブで答えてください。</small></div>', { v: (icon('question')), v2: (esc(agentShort(agentOf(c)))) }) : tr('<div class="d-awaiting"><b>{v}あなたの操作を待っています</b><small>「チャット」タブの最後で確かめてください。</small></div>', { v: (icon('alert')) }));
  parts.push(completeBoxHtml(c));
  return parts.join('');
}
// git で管理していないフォルダのタスクが終わったら、チャット・ログの最後に「完了にする」を出す
function completeBoxHtml(c) {
  if (!canCompleteNoGit(c)) return '';
  return tr('<div class="d-complete"><b>{v}{v2}</b>\n    <small>git で管理していないフォルダなので、マージや PR はありません。フォルダの中身を確かめて、よければ完了にしてください。直してほしいときは、下の欄から追加の指示を送れます。</small>\n    <div class="cf-actions"><button class="btn primary" data-complete="{id}" title="{COMPLETE_TITLE}">{v}完了にする</button><button class="btn ghost" data-act-open="{id}">フォルダを開く</button></div></div>', { v: (icon('check')), v2: (c.status === 'failed' ? tr('エージェントが失敗で終わりました') : tr('作業が終わりました')), id: (c.id), COMPLETE_TITLE });
}
// チャットの最後に出す、あなたの操作が必要なもの（途中の質問の回答・仕様の確認・回答待ちの案内）
function chatActionsHtml(c) {
  const s = c.status;
  const who = esc(agentShort(agentOf(c)));
  const spec = isSpecPending(c);
  const parts = [
    isInterrupted(c) ? interruptedBoxHtml(c) : c.error ? `<div class="d-error">${esc(c.error)}</div>` : '',
    conflictBoxHtml(c),
    subtaskApproveHtml(c),
    questionFormHtml(c),
    spec
      ? tr('<div class="d-awaiting d-spec"><b>{v}内容が詰まっていないので、開発を開始できません</b><small>{where}</small></div>{form}', { v: (icon('note')), where: (specQuestions(c) ? tr('このすぐ下のフォーム（または下の欄）で、上の {who} の質問に答えて仕様を詰めてください。仕様が詰まると、決まった仕様をまとめてから開発を始めます。', { who }) : tr('下の欄で、上の {who} の質問に答えて仕様を詰めてください。仕様が詰まると、決まった仕様をまとめてから開発を始めます。', { who })), form: (specFormHtml(c)) })
      : hasSubtaskProposal(c)
        ? subtaskProposalHtml(c)
      : c.awaitingReply && (s === 'review' || s === 'failed')
        ? tr('<div class="d-awaiting"><b>{v}{who} が質問しています</b><small>このすぐ下の欄（または画面のいちばん下の入力欄）に答えを書いて送ると、同じ会話の続きから進めます。</small></div>{v2}', { v: (icon('chat')), who, v2: (replyFormHtml(c)) })
        : '',
    completeBoxHtml(c),
  ];
  return parts.join('');
}
function hasLogActions(c) {
  return !!(c && (c.permissions || []).length);
}
// エージェントからの質問・提案（答えを待っている）
function chatPending(c) {
  return !!(c && ((c.questions || []).length || isSpecPending(c) || hasSubtaskProposal(c) || (c.awaitingReply && (c.status === 'review' || c.status === 'failed'))));
}
function hasChatActions(c) {
  return !!(c && (chatPending(c) || isInterrupted(c) || conflictBoxHtml(c) || subtaskNeedsCheck(c)));
}
// 中身が変わったときだけ描き直す（選びかけのラジオや入力中の文字を消さない）
function drawLogActions(c, force) {
  const tab = $('logTab');
  const attn = hasLogActions(c);
  tab.classList.toggle('attn', attn);
  tab.title = attn ? tr('ログの最後に、承認が必要なものがあります') : '';
  const ctab = $('chatTab');
  const cattn = hasChatActions(c);
  ctab.classList.toggle('attn', cattn);
  ctab.title = cattn ? (chatPending(c) ? tr('チャットの最後に、答えてほしい質問があります') : tr('チャットの最後に、あなたの操作を待っているものがあります')) : CHAT_TAB_TITLE;
  if (state.tab === 'chat') updateChatTab(c);
  if (state.tab !== 'log' && state.tab !== 'chat') return;
  const box = $('logActions');
  if (!box) return;
  const html = state.tab === 'chat' ? chatActionsHtml(c) : logActionsHtml(c);
  if (!force && box.dataset.card === c.id && box.dataset.tab === state.tab && box.dataset.html === html) return;
  const body = $('detailBody');
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  const grew = !box.dataset.html && html;
  box.dataset.card = c.id;
  box.dataset.tab = state.tab;
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
    lastEl.outerHTML = chatItemHtml(item, agent, open, chatPersonaOf(c));
  } else box.insertAdjacentHTML('beforeend', chatItemHtml(item, agent, false, chatPersonaOf(c)));
}

// 「チャット」タブ: 指示・途中の質問と、エージェントの最後の返事だけを並べる（ツールの呼び出しや結果は出さない）
const CHAT_TAB_TITLE = tr('指示や質問と、それに対するエージェントの最後の返事だけを見ます（ツールの結果などは「ログ」で見られます）');
function chatItemsHtml(c) {
  const agent = agentOf(c);
  const running = c.status === 'running';
  const items = ChatLog.final(state.logs.get(c.id) || [], agent, running);
  const html = items.map((it) => chatItemHtml(it, agent, false, chatPersonaOf(c))).join('');
  const working = running ? tr('<div class="c-note k-working">{v}<span class="c-note-x">{v2} が作業しています…（途中の様子は「ログ」で見られます）</span></div>', { v: (icon('clock')), v2: (esc(whoShort(agent, chatPersonaOf(c)))) }) : '';
  if (!html && !working) {
    return `<div class="muted pad">${isChat(c) ? tr('まだ会話はありません。') : tr('まだ返事はありません。「開始」を押すと {v} が動き出します。', { v: (agentLabel(agent)) })}</div>`;
  }
  return html + working;
}
function renderChatTab(body, c) {
  state.chat = null;
  const html = chatItemsHtml(c);
  state.chatView = { id: c.id, html };
  body.innerHTML = `<div class="chat-log" id="chatItems">${html}</div><div id="logActions" class="log-actions"></div>`;
  drawLogActions(c, true);
}
// 新しいログや状態の変化で、最後の返事が変わったときだけ描き直す
function updateChatTab(c) {
  const box = $('chatItems');
  if (!box || !state.chatView || state.chatView.id !== c.id) return;
  const html = chatItemsHtml(c);
  if (html === state.chatView.html) return;
  const body = $('detailBody');
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  state.chatView.html = html;
  box.innerHTML = html;
  if (atBottom) body.scrollTop = body.scrollHeight;
}

// ツールの結果に入っていた画像（スクリーンショットなど）。クリックで大きく表示する
const IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
function logImagesHtml(images) {
  if (!Array.isArray(images) || !images.length) return '';
  const items = images.map((im) => {
    if (im && IMG_TYPES.has(im.mediaType) && typeof im.data === 'string' && /^[A-Za-z0-9+/]+=*$/.test(im.data)) {
      return tr('<img class="log-img" src="data:{mediaType};base64,{data}" alt="画像" title="クリックで大きく表示" />', { mediaType: (im.mediaType), data: (im.data) });
    }
    return tr('<span class="log-img-omitted">{v}画像（{v2}）</span>', { v: (icon('image')), v2: (esc((im && im.omitted) || tr('表示できません'))) });
  });
  return `<div class="log-imgs">${items.join('')}</div>`;
}

document.addEventListener('click', (ev) => {
  const img = ev.target.closest && ev.target.closest('.log-img');
  if (img) {
    const ov = document.createElement('div');
    ov.className = 'img-overlay';
    ov.title = tr('クリックで閉じる');
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

const DIFF_STATUS = { A: [tr('追加'), 'fa'], M: [tr('変更'), 'fm'], D: [tr('削除'), 'fd'], R: [tr('名前変更'), 'fr'] };
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
  if (file.binary) return tr('<div class="dv-note">バイナリファイルのため表示できません</div>');
  if (!file.hunks.length) {
    const why = file.status === 'R' ? tr('中身は変わらず、名前だけ変わりました') : file.meta.length ? esc(file.meta.join(' / ')) : tr('表示できる差分はありません');
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
  const nums = file.binary ? tr('<span class="muted">バイナリ</span>') : `<span class="add">+${file.add}</span> <span class="del">-${file.del}</span>`;
  const body = big
    ? tr('<div class="dv-note">差分が大きいので折りたたんでいます（{lines} 行）<button class="btn small ghost" data-open-big="{index}">表示する</button></div>', { lines, index })
    : diffLinesHtml(file);
  return `<section class="dv-fileblock ${collapsed ? 'collapsed' : ''}" id="dvf-${index}" data-path="${esc(file.path)}">
    <header class="dv-fhead" data-toggle="${index}"><span class="dv-caret">▾</span><span class="wt-fs ${cls}">${label}</span><span class="dv-fpath" title="${esc(file.path)}">${name}</span><span class="dv-fnums">${nums}</span>${changeBar(file.add, file.del, Math.max(file.add + file.del, 1))}</header>
    <div class="dv-fbody">${body}</div></section>`;
}

function diffHtml(text, files) {
  if (!text.trim() || !files.length) return tr('<div class="muted pad">まだ変更はありません</div>');
  const tree = DiffParse.buildTree(files);
  const order = DiffParse.treeOrder(tree);
  const add = files.reduce((n, f) => n + f.add, 0);
  const del = files.reduce((n, f) => n + f.del, 0);
  return tr('<div class="dv {v}">\n    <div class="diff-stat"><button class="btn small ghost" id="toggleDiffTree" title="ファイルツリーの表示を切り替えます">{v2}</button>\n      <span><b>{length}</b> ファイル <span class="add">+{add}</span> <span class="del">-{del}</span></span>\n      <span class="spacer"></span>\n      <span class="dv-mode" role="group" aria-label="差分の並べ方"><button class="btn small ghost {v3}" data-diff-mode="unified" title="変更前と変更後を上下に並べます">上下</button><button class="btn small ghost {v4}" data-diff-mode="split" title="変更前を左、変更後を右に並べます">左右</button></span>\n      <button class="btn small ghost" id="diffExpandAll">すべて開く</button><button class="btn small ghost" id="diffCollapseAll">すべて閉じる</button>\n      <button class="btn small ghost" id="refreshDiff">更新</button>\n      <button class="btn small ghost" id="toggleDiffFull" title="{v5}">{v6}</button></div>\n    <div class="dv-main">\n      <nav class="dv-tree" id="diffTree"><ul>{v7}</ul></nav>\n      <div class="dv-files" id="diffFiles">{v8}</div>\n    </div></div>', { v: (diffUi.tree ? '' : 'no-tree'), v2: (icon('sidebar')), length: (files.length), add, del, v3: (diffUi.split ? '' : 'on'), v4: (diffUi.split ? 'on' : ''), v5: (diffUi.full ? tr('大きな表示を閉じます（Esc）') : tr('画面に大きく表示します')), v6: (diffUi.full ? icon('minimize') : icon('maximize')), v7: (diffTreeHtml(tree, 0)), v8: (order.map((i) => diffFileHtml(files[i], i)).join('')) });
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
  if (!prev) body.innerHTML = tr('<div class="muted pad">読み込み中…</div>');
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

const FILE_STATUS = { A: [tr('追加'), 'fa'], M: [tr('変更'), 'fm'], D: [tr('削除'), 'fd'], '?': [tr('新規'), 'fn'], T: [tr('種類変更'), 'fm'] };
function ago(t) {
  if (!t) return '';
  const ms = typeof t === 'number' ? t : Date.parse(t);
  if (!ms) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return tr('{s}秒前', { s });
  if (s < 3600) return tr('{m}分前', { m: (Math.floor(s / 60)) });
  if (s < 86400) return tr('{h}時間前', { h: (Math.floor(s / 3600)) });
  return tr('{d}日前', { d: (Math.floor(s / 86400)) });
}

function changeBar(add, del, max) {
  const w = (n) => (max ? Math.max(n ? 2 : 0, Math.round((n / max) * 60)) : 0);
  return `<span class="wt-bar"><span class="a" style="width:${w(add)}px"></span><span class="d" style="width:${w(del)}px"></span></span>`;
}

function fileListHtml(files, { showTime } = {}) {
  if (!files.length) return tr('<div class="muted small wt-empty">なし</div>');
  const max = Math.max(...files.map((f) => f.add + f.del), 1);
  // 新しく触ったファイルが上に来るようにする（未コミットのみ）
  const list = showTime ? [...files].sort((a, b) => (b.mtime || 0) - (a.mtime || 0)) : files;
  return `<ul class="wt-files">${list
    .map((f) => {
      const [label, cls] = FILE_STATUS[f.status] || [f.status, 'fm'];
      const slash = f.path.lastIndexOf('/');
      const dir = slash >= 0 ? f.path.slice(0, slash + 1) : '';
      const name = f.path.slice(slash + 1);
      const nums = f.binary ? tr('<span class="muted">バイナリ</span>') : `<span class="add">+${f.add}</span> <span class="del">-${f.del}</span>`;
      return `<li title="${esc(f.path)}"><span class="wt-fs ${cls}">${label}</span><span class="wt-path"><span class="muted">${esc(dir)}</span>${esc(name)}</span>
        ${showTime && f.mtime ? `<span class="wt-time muted">${ago(f.mtime)}</span>` : ''}<span class="wt-nums">${nums}</span>${changeBar(f.add, f.del, max)}</li>`;
    })
    .join('')}</ul>`;
}

function sumChanges(files) {
  return files.reduce((s, f) => ({ add: s.add + f.add, del: s.del + f.del }), { add: 0, del: 0 });
}

function worktreeHtml(c, data) {
  const refresh = tr('<button class="btn small ghost" id="refreshWt">更新</button>');
  const others = worktreeListHtml(c, data.worktrees || []);
  if (!data.exists) {
    const why =
      c.status === 'done'
        ? tr('マージが終わったので worktree は片付けられました。')
        : c.status === 'todo'
          ? tr('まだ worktree はありません。「開始」を押すと、このタスク専用の worktree とブランチが作られます。')
          : tr('worktree が見つかりません（削除された可能性があります）。');
    return `<div class="wt-toolbar"><span class="muted">${esc(why)}</span>${refresh}</div>${c.branch ? tr('<div class="pad small muted">ブランチ: <code>{branch}</code></div>', { branch: (esc(c.branch)) }) : ''}${others}`;
  }
  const s = data.status;
  const live = c.status === 'running' || c.status === 'queued';
  const cs = sumChanges(s.committed);
  const us = sumChanges(s.uncommitted);
  const latest = s.uncommitted.reduce((m, f) => Math.max(m, f.mtime || 0), 0);

  // ベース → コミット → 未コミット をつないだ縦のグラフ
  const nodes = [];
  if (s.behind > 0) nodes.push(tr('<li class="g-behind"><span class="g-dot"></span><div><b>{baseBranch}</b> はその後 <b>{behind}</b> コミット進んでいます<div class="muted small">マージ時にコンフリクトが起きることがあります</div></div></li>', { baseBranch: (esc(s.baseBranch)), behind: (s.behind) }));
  nodes.push(tr('<li class="g-base"><span class="g-dot"></span><div><span class="g-tag">ベース</span> <code>{short}</code> {subject}<div class="muted small">{v} から分岐 {v2}</div></div></li>', { short: (esc(s.base.short)), subject: (esc(s.base.subject)), v: (esc(s.baseBranch || '')), v2: (ago(s.base.date)) }));
  for (const k of s.commits) {
    nodes.push(tr('<li class="g-commit"><span class="g-dot"></span><div><code>{v}</code> {subject}<div class="muted small">{files} ファイル <span class="add">+{add}</span> <span class="del">-{del}</span> · {v2}</div></div></li>', { v: (esc(k.sha.slice(0, 7))), subject: (esc(k.subject)), files: (k.files), add: (k.add), del: (k.del), v2: (ago(k.date)) }));
  }
  if (s.uncommitted.length) {
    nodes.push(tr('<li class="g-wip {v}"><span class="g-dot"></span><div><span class="g-tag wip">{v2}</span> {length} ファイル <span class="add">+{add}</span> <span class="del">-{del}</span>{v3}</div></li>', { v: (live ? 'live' : ''), v2: (live ? tr('作業中') : tr('未コミット')), length: (s.uncommitted.length), add: (us.add), del: (us.del), v3: (latest ? tr('<div class="muted small">最後の編集 {v}</div>', { v: (ago(latest)) }) : '') }));
  } else if (live) {
    nodes.push(tr('<li class="g-wip live"><span class="g-dot"></span><div><span class="g-tag wip">作業中</span> <span class="muted">まだファイルの変更はありません</span></div></li>'));
  }
  nodes.reverse(); // 新しいものを上に

  return tr('<div class="wt-toolbar">\n      <span class="wt-sum"><b>{length}</b> コミット · <b>{length2}</b> ファイル(コミット済み) · <b>{length3}</b> ファイル(未コミット)</span>\n      {v}{refresh}</div>\n    <div class="pad wt">\n      <dl class="wt-meta">\n        <dt>場所</dt><dd><code>{path}</code></dd>\n        <dt>ブランチ</dt><dd><code>{branch}</code> ← <code>{v2}</code></dd>\n        <dt>HEAD</dt><dd><code>{short}</code> {subject}</dd>\n      </dl>\n      <h4>流れ</h4>\n      <ul class="wt-graph">{v3}</ul>\n      <h4>未コミットの変更 <span class="muted small">{v4}</span></h4>\n      {v5}\n      {v6}\n      <h4>コミット済みの変更（ベースから） <span class="muted small">{v7}</span></h4>\n      {v8}\n    </div>{others}', { length: (s.commits.length), length2: (s.committed.length), length3: (s.uncommitted.length), v: (live ? tr('<span class="muted small">自動で更新中</span>') : ''), refresh, path: (esc(s.path)), branch: (esc(s.branch)), v2: (esc(s.baseBranch || s.base.short)), short: (esc(s.head.short)), subject: (esc(s.head.subject)), v3: (nodes.join('')), v4: (s.uncommitted.length ? `+${us.add} -${us.del}` : ''), v5: (fileListHtml(s.uncommitted, { showTime: true })), v6: (s.untrackedTruncated ? tr('<div class="muted small">ほか {untrackedTruncated} 個の新規ファイルは省略しました</div>', { untrackedTruncated: (s.untrackedTruncated) }) : ''), v7: (s.committed.length ? `+${cs.add} -${cs.del}` : ''), v8: (fileListHtml(s.committed)), others });
}

// 同じリポジトリで並列に動いている worktree の一覧
function worktreeListHtml(c, list) {
  if (!list.length) return '';
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const byPath = new Map(state.board.cards.filter((x) => x.worktreePath).map((x) => [norm(x.worktreePath), x]));
  return tr('<div class="pad wt"><h4>このリポジトリの worktree（{length}）</h4><ul class="wt-list">{v}</ul></div>', { length: (list.length), v: (list
    .map((w) => {
      const owner = byPath.get(norm(w.path));
      const me = owner && owner.id === c.id;
      const label = w.main ? tr('<span class="g-tag">メイン</span>') : owner ? `<span class="badge b-${owner.status}">${STATUS_LABEL[owner.status]}</span>` : tr('<span class="badge">ほか</span>');
      return `<li class="${me ? 'me' : ''}" ${owner && !me ? `data-card="${esc(owner.id)}"` : ''}>${label}
        <span class="wt-l-title">${owner ? esc(owner.title) : esc(w.path.split(/[\\/]/).pop())}${me ? tr(' <span class="muted small">（このタスク）</span>') : ''}</span>
        <code class="muted small">${esc(w.branch || (w.detached ? 'detached' : ''))}</code></li>`;
    })
    .join('')) });
}

let wtLoading = false;
async function renderWorktree(c, { quiet } = {}) {
  const body = $('detailBody');
  if (!quiet) body.innerHTML = tr('<div class="muted pad">読み込み中…</div>');
  wtLoading = true;
  let data;
  try {
    data = quiet ? await api.worktree(c.id).catch(() => null) : await run(() => api.worktree(c.id));
  } finally {
    wtLoading = false;
  }
  if (state.selected !== c.id || state.tab !== 'worktree') return;
  if (!data) {
    if (!quiet) body.innerHTML = tr('<div class="muted pad">worktree の状況を読み込めませんでした</div>');
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

const BTW_STATE = { sent: tr('送信済み'), delivered: tr('反映済み'), queued: tr('開始時に渡します'), follow: tr('終了後に追加指示'), lost: tr('届きませんでした') };
function btwListHtml(c) {
  const list = c.btw || [];
  if (!list.length) return tr('<div class="muted small">まだ送っていません</div>');
  return list
    .map((m) => `<div class="btw-item"><div class="btw-text">${esc(m.text)}</div><div class="btw-meta"><span class="btw-st st-${m.state}">${BTW_STATE[m.state] || m.state}</span> ${new Date(m.at).toLocaleTimeString(I18n.locale())}</div></div>`)
    .join('');
}

function updateBtwTab(c) {
  const n = (c && c.btw ? c.btw.length : 0);
  $('btwTab').textContent = n ? `btw (${n})` : 'btw';
  const live = c && (c.status === 'running' || c.status === 'queued');
  $('btwTab').classList.toggle('live', !!live);
  // Codex / Gemini / Cursor は実行中の stdin 追加に対応していない（終了後に追加指示／待機中は開始の指示に付け足す）
  $('btwTab').title = c && agentOf(c) !== 'claude'
    ? tr('{v} では、実行中に送ると今の作業のあと追加指示として送ります（待機中なら開始するときの指示に付け足します）', { v: (agentLabel(agentOf(c))) })
    : tr('実行中のエージェントに、作業を止めずにメッセージを送ります');
}

async function renderDetailBody() {
  const c = card(state.selected);
  if (!c) return;
  const body = $('detailBody');
  if (state.tab === 'info') {
    renderInfo(c);
  } else if (state.tab === 'chat') {
    renderChatTab(body, c);
    body.scrollTop = body.scrollHeight;
  } else if (state.tab === 'log') {
    const logs = state.logs.get(c.id) || [];
    if (logs.length) renderChatLog(body, c, logs);
    else {
      state.chat = null;
      body.innerHTML = `<div class="muted pad">${isChat(c) ? tr('まだ会話はありません。') : tr('まだログはありません。「開始」を押すと {v} が動き出します。', { v: (agentLabel(agentOf(c))) })}</div><div id="logActions" class="log-actions"></div>`;
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
      ? tr('{v} では、作業の途中にはメッセージを差し込めません。実行中に送ると今の作業は続け、終わったあとに「追加指示」として送ります。待機中なら、開始するときの指示に付け足します。', { v: (agentLabel(agentOf(c))) })
      : tr('エージェントの作業を止めずに、メッセージを送れます（例:「テストも書いて」「その API は使わないで」）。Claude Code は今の作業の途中で読み、そのまま反映します。');
    const hint = !live
      ? (c.status === 'todo' ? tr('開始すると送れるようになります') : tr('作業が終わったあとは、下の「追加指示」を使ってください'))
      : c.status === 'queued'
        ? tr('待機中なので、開始するときの指示に付け足します')
        : nonClaude
          ? tr('今の作業は続け、終わったあとに追加指示として送ります')
          : tr('送ると、すぐに実行中のエージェントに届きます');
    body.innerHTML = tr('<div class="pad btw">\n      <p class="muted small">{help}</p>\n      <div id="btwList" class="btw-list">{v}</div>\n      <div class="composer">\n        <textarea id="btwInput" rows="3" placeholder="{v2}" {v3}></textarea>\n        <button class="composer-send" id="btwSend" title="送信（Ctrl/⌘ + Enter）" aria-label="送信" {v3}>{v4}</button>\n      </div>\n      <div class="btw-actions"><span class="muted small">{hint}</span></div>\n    </div>', { help, v: (btwListHtml(c)), v2: (live ? tr('btw: …（Ctrl/⌘ + Enter で送信）') : tr('エージェントが実行中のときに送れます')), v3: (live ? '' : 'disabled'), v4: (icon('send')), hint });
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
    onSendKey($('btwInput'), send);
    if (live) $('btwInput').focus();
  } else if (state.tab === 'progress') {
    renderProgress(c, { force: true });
  } else if (state.tab === 'subtasks') {
    renderSubtasksTab(c, { force: true });
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
    r.onerror = () => reject(new Error(tr('「{name}」を読めませんでした', { name: (file.name) })));
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
      if (items.length >= ATTACH_MAX_FILES) return toast(tr('添付できるファイルは {ATTACH_MAX_FILES} 個までです', { ATTACH_MAX_FILES }));
      if (total() + f.size > ATTACH_MAX_BYTES) return toast(tr('添付ファイルは合わせて {v} までです（「{name}」は付けられませんでした）', { v: (fmtBytes(ATTACH_MAX_BYTES)), name: (f.name) }));
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
    box.innerHTML = tr('<button type="button" class="btn small ghost attach-pick" title="ファイルを選んで添付します（貼り付け・ドラッグ＆ドロップでも付けられます）">{v}ファイルを添付</button><input type="file" multiple class="hidden attach-input" />\n      {v2}', { v: (icon('paperclip')), v2: (items.map((a, i) => tr('<span class="attach-chip" title="{name}（{v}）">{v2}<span class="attach-name">{name}</span><span class="muted">{v}</span><button type="button" class="chip-x" data-i="{i}" title="添付を外す">×</button></span>', { name: (esc(a.name)), v: (fmtBytes(a.size)), v2: (IMG_TYPES.has(a.mediaType) ? `<img src="data:${a.mediaType};base64,${a.data}" alt="" />` : icon('file')), i })).join('')) });
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

// 入力欄で Ctrl/⌘ + Enter を押したら送る（Claude Desktop のように）。
// Shift + Enter と Enter だけはふつうに改行する。日本語の変換中の Enter は送らない
function onSendKey(el, send) {
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    send();
  });
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
onSendKey($('followInput'), sendFollow);

// ---------------- モーダル ----------------

function openModal(html, onReady) {
  state.chatListOpen = false;
  $('modalBox').innerHTML = html;
  $('modal').classList.remove('hidden');
  onReady?.();
}
function closeModal() {
  // 設定画面の上の Issue ダイアログで gh にログインしたかもしれないので、後ろの gh の欄も確かめ直す
  const ghDialog = state.view === 'settings' && !$('modal').classList.contains('hidden') && $('modal').querySelector('#ghPanel');
  $('modal').classList.add('hidden');
  state.chatListOpen = false;
  if (ghDialog) refreshGh();
}
$('modal').addEventListener('mousedown', (e) => {
  if (e.target === $('modal')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('skillPicker').classList.contains('hidden')) $('skillPicker').classList.add('hidden');
  else if (!$('modal').classList.contains('hidden')) closeModal();
  else if (state.selected) closeDetailOrBack();
});

// エージェントの注意書き（Claude Code 以外は、CLI の作りの都合でできないことがある）
function agentLimitHint(a) {
  return a === 'claude' ? '' : tr('{agent} は CLI の作りの都合で、カードでの承認・選択肢の質問・作業途中へのメッセージ差し込み・既存の会話の引き継ぎに対応していません（btw は終了後の追加指示として送られます）。権限は設定の権限モードに合わせて CLI 側で許可します。', { agent: agentLabel(a) });
}

// Pipelineのフローの要点（工程の並び・直すところ・最初の工程・分岐などの数）
function relayFlowInfo(flow) {
  if (!flow || !Array.isArray(flow.nodes)) return { steps: [], errors: [tr('フローチャートがありません')], first: null, ifs: 0, pars: 0, loops: 0 };
  const start = FlowModel.startNode(flow);
  const e = start && FlowModel.outEdges(flow, start.id)[0];
  const count = (t) => flow.nodes.filter((n) => n.type === t).length;
  return { steps: FlowModel.orderSteps(flow), errors: FlowModel.validateFlow(flow), first: e ? FlowModel.nodeOf(flow, e.to) : null, ifs: count('if'), pars: count('parallel'), loops: FlowModel.backEdges(flow).size };
}
// プルダウンに出す Pipeline の名前（上限の長さで切る。名前がなければ「Pipeline」）
function pipelineShortName(p) {
  const n = [...String((p && p.name) || '').replace(/\s+/g, ' ').trim()];
  return n.length ? n.slice(0, PipelinePack.PIPELINE_NAME_MAX).join('').trim() : 'Pipeline';
}
function relayFlowLabel(info) {
  const extra = [info.ifs && tr('分岐{n}', { n: info.ifs }), info.pars && tr('並列{n}', { n: info.pars }), info.loops && tr('ループ{n}', { n: info.loops })].filter(Boolean).join(tr('・'));
  return (info.steps.map((x) => `${FlowModel.displayText(x.label, 'step')}(${whoShort(stepWho(x).agent, stepWho(x).persona)})`).join(' → ') || tr('未設定')) + (extra ? tr('（{extra}）', { extra }) : '');
}
// 設定: Pipelineのフローの要約
function relayFlowSummaryHtml(flow, enabled, cas = customAgents()) {
  const info = relayFlowInfo(flow);
  const steps = info.steps
    .map((x, i) => {
      const w = stepWho(x, cas);
      const model = w.model || x.model;
      return `<li><span class="relay-no">${i + 1}</span> ${personaIcon(w.persona, w.agent)}<b>${esc(FlowModel.displayText(x.label, 'step'))}</b> <span class="muted">${esc(whoLabel(w.agent, w.persona))}${model ? ` / ${esc(model)}` : ''}${w.missing ? tr('（カスタムエージェントが見つかりません）') : enabled.includes(w.agent) ? '' : tr('（使わない設定）')}</span>${x.instruction ? `<div class="muted small rs-inst">${esc(x.instruction)}</div>` : ''}</li>`;
    })
    .join('');
  const extra = [info.ifs && tr('分岐（if） {n}', { n: info.ifs }), info.pars && tr('並列 {n}', { n: info.pars }), info.loops && tr('ループ {n}', { n: info.loops })].filter(Boolean).join(tr(' ・ '));
  return `${steps ? `<ol class="relay-sum-list">${steps}</ol>` : `<div class="muted small">${tr('工程がありません')}</div>`}
    ${extra ? `<div class="small muted">${esc(extra)}</div>` : ''}
    ${info.errors.length ? `<div class="relay-sum-err small">${icon('alert')}${tr('直すところがあります: {error}', { error: esc(info.errors[0]) })}${info.errors.length > 1 ? tr(' ほか {n} 件', { n: info.errors.length - 1 }) : ''}</div>` : ''}`;
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
  // Pipeline はいくつでも作れる。それぞれ使えるか（フローに直すところがない・工程のエージェントを使える）を見る
  const pipes = pipelines(s).map((p) => {
    const info = relayFlowInfo(p.flow);
    const off = !info.steps.length || info.errors.length > 0 || info.steps.some((x) => stepWho(x).missing || !on.includes(stepWho(x).agent));
    return { p, info, off };
  });
  const comp = competeNames(s);
  // 設定でPipeline・競争を選んでいれば、それを最初から選んでおく（Pipeline は既定のもの。使えない状態なら、最初から選んでおくエージェント）
  const def = defaultPipeline(s);
  const defPipe = pipes.find((x) => def && x.p.id === def.id);
  const orchUsable = (orch === 'relay' && defPipe && !defPipe.off) || (orch === 'compete' && comp.length >= 2);
  const v = (value === 'relay' && def ? RELAY_PREFIX + def.id : value) || (orchUsable ? (orch === 'relay' ? RELAY_PREFIX + def.id : orch) : defaultAgent(s));
  const opt = (val, label, disabled, title) => `<option value="${val}" ${val === v && !disabled ? 'selected' : ''} ${disabled ? 'disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</option>`;
  const plain = AGENTS.filter(([a]) => on.includes(a)).map(([a, l]) => opt(a, l)).join('');
  const cas = customAgents(s);
  const custom = cas.length
    ? `<optgroup label="${esc(tr('カスタムエージェント'))}">${cas.map((ca) => opt(CUSTOM_PREFIX + ca.id, tr('{icon}{name}（{agent}{model}）{off}', { icon: ca.icon ? `${ca.icon} ` : '', name: ca.name, agent: agentShort(ca.agent), model: ca.model ? ` / ${ca.model}` : '', off: on.includes(ca.agent) ? '' : tr('（使わない設定）') }), !on.includes(ca.agent))).join('')}</optgroup>`
    : '';
  const single = custom ? `<optgroup label="${esc(tr('1つのエージェントで動かす'))}">${plain}</optgroup>${custom}` : plain;
  if (orch === 'none') return `<label class="field"><span>${tr('エージェント')}</span><select id="${idp}Agent">${single}</select><small id="${idp}AgentHint" class="muted"></small></label>`;
  const relayOpts = pipes
    // 長いと他の欄が見切れるので、名前（15文字まで）だけを出す。工程の並びは選んだときに下の説明に出す
    .map(({ p, info, off }) => opt(RELAY_PREFIX + p.id, tr('{name}{mark}', { name: pipelineShortName(p), mark: info.errors.length ? tr('（要修正）') : off ? tr('（使えません）') : '' }), off, tr('{name}: {flow}{why}', { name: p.name, flow: relayFlowLabel(info), why: info.errors.length ? tr('（設定のフローチャートを直してください）') : off ? tr('（設定で工程のエージェントを使う設定にしてください）') : '' })))
    .join('');
  return `<label class="field"><span>${tr('エージェント')}</span>
    <select id="${idp}Agent">
      ${custom ? single : `<optgroup label="${esc(tr('1つのエージェントで動かす'))}">${single}</optgroup>`}
      <optgroup label="${esc(orch === 'relay' && pipes.length > 1 ? 'Pipeline' : tr('オーケストレーション'))}">
        ${orch === 'relay'
          ? relayOpts
          : opt('compete', comp.length >= 2 ? tr('競争: {names} で同じタスクを解いて比べる', { names: comp.join(tr('・')) }) : tr('競争（設定で使うエージェントを2つ以上選んでください）'), comp.length < 2)}
      </optgroup>
    </select>
    <small id="${idp}AgentHint" class="muted"></small></label>`;
}
// 選んだ Pipeline の説明（名前と工程の並び。プルダウンには名前だけを出すので、ここで中身を見せる）
function relayHint(p) {
  if (!p) return tr('選んだ Pipeline が見つかりません。選び直してください。');
  const info = relayFlowInfo(p.flow);
  const why = info.errors.length ? tr('（設定のフローチャートを直してください）') : '';
  return tr('Pipeline「{name}」: {flow}{why}。', { name: p.name || 'Pipeline', flow: relayFlowLabel(info), why });
}
// onChange(agent): 選び直したときに呼ぶ（会話の欄の出し分けなど）
function bindAgentField(idp, onChange) {
  const sel = $(`${idp}Agent`);
  const hint = () => {
    const v = sel.value;
    $(`${idp}AgentHint`).textContent =
      isRelayRef(v) ? relayHint(pipelineOfRef(v)) + tr('設定のフローチャートに沿って、工程ごとにエージェントが作業を引き継ぎます（前の工程の報告を次に渡します。分岐・ループ・並列もフローのとおりに動きます）。フローチャートは「設定」で変えられます。')
      : v === 'compete' ? tr('エージェントごとにカードと worktree を作って並列に解きます。終わったら差分を見比べ、よい案を採用してマージします。')
      : isCustomRef(v) ? customHint(findCustomAgent(v))
      : agentLimitHint(v);
    onChange?.(v);
  };
  sel.onchange = hint;
  hint();
}
// カスタムエージェントを選んだときの説明（プロフィール・モデル）
function customHint(ca) {
  if (!ca) return tr('カスタムエージェントが見つかりません。選び直してください。');
  const parts = [tr('{agent} を「{name}」のプロフィールで動かします（モデル: {model}）。', { agent: agentLabel(ca.agent), name: ca.name, model: ca.model || settingsModel(ca.agent) || tr('CLI の既定') })];
  if (ca.description) parts.push(ca.description);
  const lim = agentLimitHint(ca.agent);
  if (lim) parts.push(lim);
  return parts.join(' ');
}
// 競争させる顔ぶれの名前（使う設定のふつうのエージェントと、このプロジェクトのカスタムエージェント）
function competeNames(s = state.board.settings || {}) {
  const on = enabledAgents(s);
  const plain = (s.competeAgents || []).filter((a) => on.includes(a)).map(agentShort);
  const custom = (s.competeCustomAgents || []).map((id) => findCustomAgent(id, customAgents(s))).filter((ca) => ca && on.includes(ca.agent)).map((ca) => ca.name);
  return [...plain, ...custom];
}
// 既存の会話（Claude Code の会話）を選べるのは、最初に動くのが Claude Code のときだけ
function firstAgentOf(v) {
  const s = state.board.settings;
  if (isRelayRef(v)) {
    const first = relayFlowInfo((pipelineOfRef(v, s) || {}).flow).first;
    return first ? stepWho(first).agent : 'claude';
  }
  if (v === 'compete') return (s.competeAgents || []).includes('claude') ? 'claude' : '';
  if (isCustomRef(v)) return (findCustomAgent(v) || {}).agent || '';
  return v;
}
// ---------------- モデルを選ぶ欄（タスク・会話を作るとき） ----------------

// 設定のエージェントごとの既定のモデルの名前（キー）と、入力欄に出す候補
const MODEL_KEY = { claude: 'model', codex: 'codexModel', gemini: 'geminiModel', cursor: 'cursorModel' };
const MODEL_SUGGEST = {
  claude: ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  codex: ['gpt-5-codex', 'gpt-5'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  cursor: ['gpt-5', 'sonnet-4.5', 'opus-4.1'],
};
function settingsModel(agent, s = state.board.settings || {}) {
  return String(s[MODEL_KEY[agent] || 'model'] || '').trim();
}
function modelFieldHtml(idp, value = '') {
  return `<label class="field"><span>${tr('モデル（空なら設定の既定）')}</span>
    <input id="${idp}Model" list="${idp}ModelList" autocomplete="off" spellcheck="false" value="${esc(value)}" /><datalist id="${idp}ModelList"></datalist>
    <small id="${idp}ModelHint" class="muted"></small></label>`;
}
// エージェントを選び直したら、候補と既定の表示を合わせる。Pipeline・競争はエージェントが複数なので、設定のモデルを使う（欄を隠す）
function updateModelField(idp, agent) {
  const input = $(`${idp}Model`);
  if (!input) return;
  // カスタムエージェントは、そのエージェントのモデルを使う
  const multi = isRelayRef(agent) || agent === 'compete' || isCustomRef(agent);
  input.closest('.field').classList.toggle('hidden', multi);
  if (multi) return;
  const def = settingsModel(agent);
  input.placeholder = def ? tr('例: {model}（設定の既定）', { model: def }) : tr('例: {model}', { model: (MODEL_SUGGEST[agent] || [])[0] || '' });
  $(`${idp}ModelList`).innerHTML = (MODEL_SUGGEST[agent] || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
  $(`${idp}ModelHint`).textContent = tr('{agent} に渡すモデルです。空なら{fallback}を使います。', { agent: agentLabel(agent), fallback: def ? tr('設定の「{model}」', { model: def }) : tr(' CLI の既定のモデル') });
}
// 送るモデル（Pipeline・競争のときは送らない）
function readModelField(idp, agent) {
  if (isRelayRef(agent) || agent === 'compete' || isCustomRef(agent)) return undefined;
  return ($(`${idp}Model`)?.value || '').trim() || undefined;
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
    `<h2>${fromDone ? tr('修正タスク') : tr('新しいタスク')}</h2>
     ${from ? '' : taskModeTabsHtml('text')}
     ${fromDone ? `<p class="muted small">${tr('完了したタスク「{title}」の修正として、新しいタスクを始めます（元のタスクのやりとりをエージェントが引き継ぎます。元のタスクはそのまま残ります）。', { title: esc(from.title) })}</p>`
     : from ? `<p class="muted small">${tr('会話「{title}」の続きとして、タスクを始めます（会話の内容をエージェントが引き継ぎます。会話そのものはそのまま残ります）。', { title: esc(from.title) })}</p>` : ''}
     <label class="field"><span>${tr('タイトル（省略すると指示の1行目）')}</span><input id="nTitle" placeholder="${esc(tr('例: ログイン画面にパスワード表示ボタンを追加'))}" /></label>
     ${agentFieldHtml('n', from && from.persona && findCustomAgent(from.persona.id) && !from.relay ? CUSTOM_PREFIX + from.persona.id : from && enabledAgents().includes(agentOf(from)) ? agentOf(from) : undefined)}
     ${modelFieldHtml('n', from && enabledAgents().includes(agentOf(from)) ? from.model || '' : '')}
     <div class="field"><span>${tr('エージェントへの指示')}</span><div id="nSkill" class="skill-slot"></div><textarea id="nPrompt" rows="10" placeholder="${esc(tr('やってほしいことを具体的に書いてください。テストの実行方法なども書いておくと確実です。画像やファイルは貼り付け・ドラッグ＆ドロップでも添付できます。'))}"></textarea><div id="nAttach" class="attach-bar"></div></div>
     ${sessionFieldHtml('n')}
     <label class="check" title="${esc(tr('SQL を作るだけ・調べるだけなど、ソースコードを変えないタスクにします。worktree とブランチは作らず、リポジトリのフォルダでファイルを書き換えるツールを止めて動かします。作ったものはチャットの返事に出るので、確かめてから「完了にする」を押します'))}"><input type="checkbox" id="nReadOnly" /> ${tr('ソースを変更しない（調べもの・SQL などの生成だけ）')}</label>
     <label class="check"><input type="checkbox" id="nStart" checked /> ${tr('作成したらすぐに開始する')}</label>
     <div class="modal-actions"><button class="btn ghost" id="nCancel">${tr('キャンセル')}</button><button class="btn primary" id="nOk">${tr('作成（Ctrl/⌘ + Enter）')}</button></div>`,
    () => {
      if (!from) bindTaskModeTabs();
      $('nPrompt').focus();
      if (from) $('nPrompt').value = fromDone ? `${tr('完了したタスクの内容をもとに、次の点を修正してください。')}\n\n` : tr('ここまでの会話の内容をもとに、作業を進めてください。');
      if (fromDone) $('nTitle').value = tr('修正: {title}', { title: from.title });
      // Claude Code の会話なら会話そのものを引き継ぐ。それ以外の会話・完了したタスクは、やりとりを指示に添えて渡す
      const fromClaude = from && !fromDone && agentOf(from) === 'claude';
      fillSessionField('n', fromClaude ? { id: from.sessionId, title: tr('会話: {title}', { title: from.title }) } : undefined);
      bindAgentField('n', (v) => {
        toggleSessionField('n', fromClaude || !from ? firstAgentOf(v) : '');
        updateModelField('n', v);
      });
      let skill = state.board.settings.defaultSkill || null;
      const drawSkill = () => renderSkillSlot('nSkill', skill, (v) => ((skill = v), drawSkill()));
      drawSkill();
      const att = attachField({ box: $('nAttach'), input: $('nPrompt'), drop: $('nPrompt').closest('.field') });
      const submit = async () => {
        const files = att.list();
        const id = await runBusy(tr('タスクを作成しています…'), () => api.createCard({ title: $('nTitle').value, prompt: $('nPrompt').value, autoStart: $('nStart').checked, session: readSessionField('n'), skill, agent: $('nAgent').value, model: readModelField('n', $('nAgent').value), fromChat: from ? from.id : undefined, attachments: files.length ? files : undefined, readOnly: $('nReadOnly').checked || undefined }));
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
  return `<nav class="tabs task-mode-tabs" role="tablist">${tab('text', tr('自然言語で作成'))}${tab('issue', tr('GitHub Issue から作成'))}</nav>`;
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
  box.innerHTML = `<h2>${icon('chat')}${tr('会話')}</h2>
    <p class="muted small">${tr('タスクを作らずに、このリポジトリについてエージェントと話した会話です。選ぶと開きます。')}</p>
    <div class="chat-list">${chats.map(cardHtml).join('') || `<div class="col-empty">${tr('会話はまだありません')}</div>`}</div>
    <div class="modal-actions"><button class="btn ghost" id="chatListClose">${tr('閉じる')}</button><button class="btn primary" id="chatListNew">${tr('＋ 新しい会話')}</button></div>`;
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
    `<h2>${icon('chat')}${tr('会話を始める')}</h2>
     <p class="muted small">${tr('タスクを作らずに、このリポジトリについてエージェントと話せます（質問・調べもの・相談など）。worktree やブランチは作らず、コミットやマージもしません。')}</p>
     ${agentFieldHtml('c', undefined, { orchestration: false })}
     ${modelFieldHtml('c')}
     <div class="field"><span>${tr('メッセージ')}</span><div id="cSkill" class="skill-slot"></div><textarea id="cMsg" rows="6" placeholder="${esc(tr('例: このリポジトリの全体の構成を教えて（画像やファイルは貼り付け・ドラッグ＆ドロップでも添付できます）'))}"></textarea><div id="cAttach" class="attach-bar"></div></div>
     <label class="field"><span>${tr('タイトル（省略するとメッセージの1行目）')}</span><input id="cTitle" /></label>
     ${sessionFieldHtml('c')}
     <p class="muted small">${tr('会話はリポジトリのフォルダ（手元の作業中のファイル）でそのまま動くので、ファイルの変更やコマンドは毎回カードで確かめます。作業してほしくなったら、詳細画面の「タスクにする」で会話の続きからタスクを作れます。')}</p>
     <div class="modal-actions"><button class="btn ghost" id="cCancel">${tr('キャンセル')}</button><button class="btn primary" id="cOk">${tr('話しかける（Ctrl/⌘ + Enter）')}</button></div>`,
    () => {
      $('cMsg').focus();
      fillSessionField('c');
      bindAgentField('c', (v) => {
        toggleSessionField('c', firstAgentOf(v));
        updateModelField('c', v);
      });
      let skill = null;
      const drawSkill = () => renderSkillSlot('cSkill', skill, (v) => ((skill = v), drawSkill()));
      drawSkill();
      const att = attachField({ box: $('cAttach'), input: $('cMsg'), drop: $('cMsg').closest('.field') });
      const submit = async () => {
        const files = att.list();
        const id = await runBusy(tr('会話を始めています…'), () => api.createChat({ message: $('cMsg').value, title: $('cTitle').value, session: firstAgentOf($('cAgent').value) === 'claude' ? readSessionField('c') : { mode: 'new' }, skill, agent: $('cAgent').value, model: readModelField('c', $('cAgent').value), attachments: files.length ? files : undefined }));
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

const SKILL_SRC = { project: tr('プロジェクト'), user: tr('自分用'), plugin: tr('プラグイン') };
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
    ? `<span class="skill-chip" title="${esc(tr('このスキルを使って実行します'))}">${icon('zap')}/${esc(value)}<button type="button" class="chip-x" title="${esc(tr('スキルを外す'))}">×</button></span><button type="button" class="btn small ghost skill-pick">${tr('変更')}</button>`
    : `<button type="button" class="btn small ghost skill-pick">${icon('zap')}${tr('スキルを選ぶ')}</button>`;
  const x = el.querySelector('.chip-x');
  if (x) x.onclick = () => onChange(null);
  el.querySelector('.skill-pick').onclick = () => openSkillPicker(value, onChange);
}

// カードの一覧から1つ選ぶ
async function openSkillPicker(current, onPick) {
  const box = $('skillPickerBox');
  box.innerHTML = `<div class="muted pad">${tr('スキルを読み込んでいます…')}</div>`;
  $('skillPicker').classList.remove('hidden');
  const skills = await getSkills(true);
  const close = () => $('skillPicker').classList.add('hidden');
  const cardHtmlFor = (s) => `
    <button type="button" class="skill-card ${s.name === current ? 'selected' : ''}" data-skill="${esc(s.name)}">
      <span class="sk-top"><b class="sk-name">/${esc(s.name)}</b><span class="sk-src src-${s.source}">${SKILL_SRC[s.source] || s.source}</span></span>
      <span class="sk-desc">${esc(s.description || tr('（説明なし）'))}</span>
    </button>`;
  const render = (q) => {
    const k = q.trim().toLowerCase();
    const list = k ? skills.filter((s) => (s.name + ' ' + s.description).toLowerCase().includes(k)) : skills;
    $('skGrid').innerHTML =
      `<button type="button" class="skill-card none ${!current ? 'selected' : ''}" data-skill=""><span class="sk-top"><b class="sk-name">${tr('スキルなし')}</b></span><span class="sk-desc">${tr('スキルを使わずに、指示だけで実行します')}</span></button>` +
      (list.map(cardHtmlFor).join('') || `<div class="muted pad">${tr('見つかりません')}</div>`);
  };
  box.innerHTML = `
    <div class="sk-head"><h2>${tr('スキルを選ぶ')}</h2><button type="button" class="icon" id="skClose">✕</button></div>
    <p class="muted small">${tr('1つだけ選べます。選んだスキルは、Claude Code には指示の先頭に ')}<code>${tr('/スキル名')}</code>${tr(' として、ほかのエージェントには SKILL.md の場所を添えて渡します。')}</p>
    <input id="skSearch" placeholder="${esc(tr('名前や説明で絞り込む'))}" autocomplete="off" />
    <div class="skill-grid" id="skGrid"></div>
    ${skills.length ? '' : `<p class="muted small">${tr('使えるスキルが見つかりません。<code>.claude/skills/&lt;名前&gt;/SKILL.md</code>（このリポジトリ）か <code>~/.claude/skills/</code> に置くと、ここに出ます。')}</p>`}`;
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
  const loc = typeof I18n !== 'undefined' ? I18n.locale() : undefined;
  const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  if (new Date().toDateString() === d.toDateString()) return time;
  return d.toLocaleDateString(loc, { month: 'numeric', day: 'numeric' }) + ' ' + time;
}

// 「新しい会話」か「既存の会話を引き継ぐ」を選ぶ欄
function sessionFieldHtml(idp) {
  return `<label class="field"><span>${tr('会話（セッション）')}</span>
    <select id="${idp}Session"><option value="">${tr('新しい会話で始める')}</option><option disabled>${tr('過去の会話を読み込んでいます…')}</option></select>
    <small>${tr('過去の Claude Code の会話を選ぶと、その続きとして始めます（元の会話はそのまま残ります）。')}</small></label>`;
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
  const related = list.filter((x) => x.related);
  const opt = (x) => `<option value="${esc(x.id)}" ${x.id === selectedId ? 'selected' : ''}>${esc(fmtTime(x.updatedAt))}  ${esc(x.title.slice(0, 70))}</option>`;
  sel.innerHTML = `<option value="">${tr('新しい会話で始める')}</option>
    ${related.length ? `<optgroup label="${esc(tr('このリポジトリの会話'))}">${related.map(opt).join('')}</optgroup>` : `<option disabled>${tr('（このリポジトリの過去の会話はありません）')}</option>`}`;
  sel._list = list;
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
    `<h2>${tr('既存の会話を引き継ぐ')}</h2>
     <p class="muted small">${tr('「{title}」の次の実行を、選んだ会話の続きとして始めます。', { title: esc(c.title) })}</p>
     ${sessionFieldHtml('p')}
     <div class="modal-actions"><button class="btn ghost" id="pCancel">${tr('キャンセル')}</button><button class="btn primary" id="pOk">${tr('この会話を使う')}</button></div>`,
    () => {
      fillSessionField('p');
      $('pCancel').onclick = closeModal;
      $('pOk').onclick = async () => {
        const sess = readSessionField('p');
        const ok = await run(() => api.setSession(c.id, sess).then(() => true));
        if (ok) {
          closeModal();
          toast(sess.mode === 'new' ? tr('次は新しい会話で始めます') : tr('次はこの会話の続きで始めます'), 'ok');
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
    `<option value="__new__" ${!c.sessionId ? 'selected' : ''}>${tr('新しい会話で始める')}</option>`,
    ...own.map((x, i) => {
      const src = x.from && (c.sessions || []).find((y) => y.id === x.from);
      const label = src ? tr('← 引き継ぎ: {label}', { label: src.label || src.id.slice(0, 8) }) : x.label || '';
      return `<option value="${esc(x.id)}" ${x.id === c.sessionId && !c.forkNext ? 'selected' : ''}>${tr('会話 {n}（{time}） {label}', { n: i + 1, time: esc(fmtTime(x.at)), label: esc(label) })}</option>`;
    }),
    imported ? `<option value="${esc(imported.id)}" selected>${tr('引き継ぐ: {label}', { label: esc(imported.label || imported.id.slice(0, 8)) })}</option>` : '',
    agentOf(c) === 'claude' ? `<option value="__pick__">${tr('既存の会話から選ぶ…')}</option>` : '',
  ].join('');
  return `<dt>${tr('会話')}</dt><dd><select id="dSession" class="d-session" ${busy ? `disabled title="${esc(tr('実行中は切り替えられません'))}"` : ''}>${opts}</select>
</dd>`;
}

// ---------------- 会話（セッション）を消す ----------------

// タスクとは別に、Claude Code の会話を一覧して選んで消す
function openSessionManager() {
  openModal(
    `<h2>${tr('会話（セッション）を消す')}</h2>
     <p class="muted small">${tr('Claude Code の会話の記録（~/.claude/projects の中）を消します。消した会話は元に戻せず、続きから再開することもできません。実行中・待機中のタスクが使っている会話は消せません。')}</p>
     <div class="row sm-tools">
       <label class="check small"><input type="checkbox" id="smToggle" />${tr(' 表示中をすべて選ぶ')}</label>
     </div>
     <div id="smList" class="sm-list muted small">${tr('会話を読み込んでいます…')}</div>
     <div class="modal-actions"><span id="smCount" class="muted small sm-count"></span><button class="btn ghost" id="smClose">${tr('閉じる')}</button><button class="btn danger" id="smDelete" disabled>${tr('選んだ会話を消す')}</button></div>`,
    async () => {
      let list = [];
      const picked = new Set();
      const visible = () => list.filter((x) => x.related);
      const updateCount = () => {
        $('smCount').textContent = picked.size ? tr('{n} 件を選択中', { n: picked.size }) : '';
        $('smDelete').disabled = !picked.size;
      };
      const render = () => {
        const box = $('smList');
        if (!box) return;
        const rows = visible();
        if (!rows.length) {
          box.innerHTML = `<p class="muted small">${tr('（消せる会話はありません）')}</p>`;
          updateCount();
          return;
        }
        box.innerHTML = rows
          .map((x) => {
            const used = x.usedBy || [];
            const busy = used.some((u) => u.busy);
            const tag = used.length ? `<span class="pill sm-used" title="${esc(used.map((u) => u.title).join('\n'))}">${busy ? tr('実行中のタスクで使用中') : used.length > 1 ? tr('タスク「{title}」 ほか {n} 件', { title: esc(used[0].title.slice(0, 30)), n: used.length - 1 }) : tr('タスク「{title}」', { title: esc(used[0].title.slice(0, 30)) })}</span>` : '';
            return `<label class="sm-row ${busy ? 'disabled' : ''}"><input type="checkbox" class="smPick" value="${esc(x.id)}" ${busy ? 'disabled' : ''} ${picked.has(x.id) ? 'checked' : ''} />
              <span class="sm-main"><span class="sm-title">${esc(x.title.slice(0, 100))}</span>
              <span class="sm-meta muted small">${esc(fmtTime(x.updatedAt))} · ${esc(x.branch || '')}</span></span>${tag}</label>`;
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
        const msg = used
          ? tr('選んだ {n} 件の会話を消しますか？\n消した会話は元に戻せません。\n（{used} 件はタスクが使っています。そのタスクは次から新しい会話で始めます）', { n: ids.length, used })
          : tr('選んだ {n} 件の会話を消しますか？\n消した会話は元に戻せません。', { n: ids.length });
        if (!confirm(msg)) return;
        const r = await runBusy(tr('会話を消しています…'), () => api.deleteSessions(ids));
        if (!r) return;
        picked.clear();
        $('smToggle').checked = false;
        toast(r.skipped.length ? tr('{n} 件の会話を消しました（実行中で使っている {skipped} 件は消していません）', { n: r.removed.length, skipped: r.skipped.length }) : tr('{n} 件の会話を消しました', { n: r.removed.length }), 'ok');
        await load();
      };
      await load();
    },
  );
}

// ---------------- GitHub Issue から作る ----------------

// Issue 番号からカードを作る（上部の枠と、詳細ダイアログの両方から使う）
async function createFromIssues(numbers, extra, autoStart, session, skill, agent, model) {
  const r = await runBusy(tr('Issue を読み込んでタスクを作成しています…'), () => api.createFromIssues({ numbers, extra, autoStart, session, skill, agent, model }));
  if (!r) return false;
  if (r.errors.length) toast(r.errors.join('\n'));
  else toast(tr('{n} 件のタスクを Issue から作りました', { n: r.ids.length }), 'ok');
  await refreshBoardFor(r.ids);
  if (r.ids.length === 1) select(r.ids[0]);
  return true;
}

// Issue から作成するダイアログ（Issue 番号・会話・追加の指示・gh の準備）
function openIssueModal(prefill = '') {
  if (!state.board.settings.repoPath) return chooseRepo();
  openModal(
    `<h2>${tr('新しいタスク')}</h2>
     ${taskModeTabsHtml('issue')}
     <label class="field"><span>${tr('Issue 番号（複数ならカンマかスペースで区切る。1つの Issue が1枚のカードになり、並列で動きます）')}</span>
       <input id="nNumbers" placeholder="${esc(tr('例: 12 または 12, 15, 18'))}" inputmode="numeric" value="${esc(prefill)}" /></label>
     <p class="muted small" id="nRepoInfo">${tr('リポジトリを確認しています…')}</p>
     <div id="ghPanel" class="gh-panel">${tr('gh（GitHub CLI）を確認しています…')}</div>
     ${agentFieldHtml('n')}
     ${modelFieldHtml('n')}
     ${sessionFieldHtml('n')}
     <div class="field"><span>${tr('追加の指示（任意・すべての Issue に付けます）')}</span><div id="nSkill" class="skill-slot"></div><textarea id="nExtra" rows="4" placeholder="${esc(tr('例: 変更したらテストを追加して npm test で確認して'))}"></textarea></div>
     <label class="check"><input type="checkbox" id="nStart" checked />${tr(' 作成したらすぐに開始する')}</label>
     <div class="modal-actions"><button class="btn ghost" id="nCancel">${tr('キャンセル')}</button><button class="btn primary" id="nOk">${tr('Issue からタスクを作成')}</button></div>`,
    () => {
      bindTaskModeTabs();
      $('nNumbers').focus();
      api.repoGithub().then(
        (g) => {
          const el = $('nRepoInfo');
          if (!el) return;
          if (!g || !g.slug) el.textContent = tr('このリポジトリの origin が GitHub ではないため、Issue を読み込めません。');
          else el.textContent = tr('{owner}/{repo} の Issue を読み込みます。', { owner: g.slug.owner, repo: g.slug.repo });
        },
        () => {},
      );
      refreshGh();
      fillSessionField('n');
      bindAgentField('n', (v) => {
        toggleSessionField('n', firstAgentOf(v));
        updateModelField('n', v);
      });
      let skill = state.board.settings.defaultSkill || null;
      const drawSkill = () => renderSkillSlot('nSkill', skill, (v) => ((skill = v), drawSkill()));
      drawSkill();
      const submit = async () => {
        $('nOk').disabled = true;
        $('nOk').textContent = tr('Issue を読み込んでいます…');
        const ok = await createFromIssues($('nNumbers').value, $('nExtra').value, $('nStart').checked, readSessionField('n'), skill, $('nAgent').value, readModelField('n', $('nAgent').value));
        if (ok) return closeModal();
        $('nOk').disabled = false;
        $('nOk').textContent = tr('Issue からタスクを作成');
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
  const opt = (b) => `<option value="${esc(b)}" ${b === def ? 'selected' : ''}>${esc(b)}${b === c.baseBranch ? tr('（ベース）') : ''}${b === info.current ? tr('（チェックアウト中）') : ''}</option>`;
  openModal(
    `<h2>${tr('マージ')}</h2>
     <p class="muted">${tr('「{title}」のブランチ <code>{branch}</code> を、選んだブランチにマージします（--no-ff）。', { title: esc(c.title), branch: esc(c.branch) })}</p>
     <label class="field"><span>${tr('マージ先のブランチ')}</span>
       <select id="mTarget">
         ${normal.map(opt).join('')}
         ${agentBranches.length ? `<optgroup label="${esc(tr('ほかのタスクのブランチ'))}">${agentBranches.map(opt).join('')}</optgroup>` : ''}
         <option value="__new__">${tr('＋ 新しいブランチを作ってマージ…')}</option>
       </select></label>
     <label class="field hidden" id="mNewWrap"><span>${tr('新しいブランチの名前（{base} から作ります）', { base: esc(c.baseBranch) })}</span><input id="mNew" placeholder="${esc(tr('例: feature/login-improvements'))}" /></label>
     <label class="check"><input type="checkbox" id="mPush" ${info.hasOrigin && state.board.settings.pushAfterMerge !== false ? 'checked' : ''} ${info.hasOrigin ? '' : 'disabled'} />${tr(' マージしたあと origin に push する（')}<code id="mPushTarget">origin/…</code>${tr(' にも反映）')}</label>
     ${info.hasOrigin ? '' : `<p class="muted small">${tr('このリポジトリには origin がないので、ローカルのブランチにだけマージします。')}</p>`}
     <label class="check"><input type="checkbox" id="mKeep" />${tr(' マージ後もタスクを続ける（worktree とブランチを残す）')}</label>
     <p class="muted small" id="mHint"></p>
     <div class="modal-actions"><button class="btn ghost" id="mCancel">${tr('キャンセル')}</button><button class="btn primary" id="mOk">${tr('マージ')}</button></div>`,
    () => {
      const update = () => {
        const isNew = $('mTarget').value === '__new__';
        $('mNewWrap').classList.toggle('hidden', !isNew);
        const t = isNew ? $('mNew').value.trim() || tr('（新しいブランチ）') : $('mTarget').value;
        $('mPushTarget').textContent = `origin/${t}`;
        const pushText = $('mPush').checked ? tr('origin の最新を取り込んでからローカルの {target} にマージし、origin/{target} に push します。', { target: t }) : tr('ローカルの {target} にだけマージします（origin には push しません）。', { target: t });
        $('mHint').textContent = pushText + ($('mKeep').checked
          ? tr('マージしたあとも、このタスクはレビュー列に残ります。')
          : tr('マージしたあと、worktree とブランチ {branch} を削除して「完了」にします。', { branch: c.branch }));
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
        if (!target) return toast(tr('ブランチ名を入力してください'));
        $('mOk').disabled = true;
        const push = $('mPush').checked;
        $('mOk').textContent = push ? tr('マージして push しています…') : tr('マージしています…');
        const res = await runBusy(push ? tr('{target} にマージして push しています…', { target }) : tr('{target} にマージしています…', { target }), () => api.merge(c.id, { target, createNew: isNew, keep: $('mKeep').checked, push }));
        $('mOk').textContent = tr('マージ');
        if (res && res.conflict) {
          closeModal();
          toast(tr('{target} とコンフリクトしたので、マージを中止しました。詳細画面から解消できます', { target }));
          return;
        }
        if (res) toast(push ? tr('{target} にマージして origin/{target} に push しました', { target }) : tr('{target} にマージしました', { target }), 'ok');
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
  const opt = (b) => `<option value="${esc(b)}" ${b === def ? 'selected' : ''}>${esc(b)}${b === c.baseBranch ? tr('（ベース）') : ''}</option>`;
  const title = c.issue ? c.title.replace(/^#\d+\s*/, '') : c.title;
  const body = [c.issue ? `Closes #${c.issue.number}\n` : '', c.lastMessage ? `${c.lastMessage}\n` : '', tr('---\nWorktree Kanban のタスクから作成しました。')].join('\n').trim();
  const updating = !!c.prUrl;
  openModal(
    `<h2>${updating ? tr('PR を更新') : tr('PR を作成')}</h2>
     <p class="muted">${updating ? tr('「{title}」のブランチ {branch} を origin に push して、開いている PR（{url}）を更新します。', { title: esc(c.title), branch: esc(c.branch), url: esc(c.prUrl) }) : tr('「{title}」のブランチ {branch} を origin に push して、GitHub にプルリクエストを作ります（gh を使います）。', { title: esc(c.title), branch: esc(c.branch) })}</p>
     <label class="field"><span>${tr('PR のマージ先（base）')}</span>
       <select id="pBase" ${updating ? 'disabled' : ''}>
         ${normal.map(opt).join('')}
         ${agentBranches.length ? `<optgroup label="${esc(tr('ほかのタスクのブランチ'))}">${agentBranches.map(opt).join('')}</optgroup>` : ''}
       </select></label>
     ${updating ? '' : `<label class="field"><span>${tr('タイトル')}</span><input id="pTitle" value="${esc(title)}" /></label>
     <label class="field"><span>${tr('本文')}</span><textarea id="pBody" rows="6">${esc(body)}</textarea></label>`}
     <label class="check"><input type="checkbox" id="pKeep" checked />${tr(' PR を作ったあともタスクを続ける（worktree とブランチを残す）')}</label>
     <p class="muted small" id="pHint"></p>
     <div class="modal-actions"><button class="btn ghost" id="pCancel">${tr('キャンセル')}</button><button class="btn primary" id="pOk">${updating ? tr('push して更新') : tr('PR を作成')}</button></div>`,
    () => {
      const update = () => {
        $('pHint').textContent = $('pKeep').checked
          ? tr('レビューで直しが入ったら、追加指示を送ってからもう一度このボタンを押すと PR に反映されます。')
          : tr('PR を作ったあと、ローカルの worktree とブランチ {branch} を削除して「完了」にします（origin のブランチと PR は残ります）。', { branch: c.branch });
      };
      $('pKeep').onchange = update;
      update();
      $('pCancel').onclick = closeModal;
      $('pOk').onclick = async () => {
        $('pOk').disabled = true;
        const r = await runBusy(updating ? tr('push して PR を更新しています…') : tr('push して PR を作成しています…'), () =>
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
          toast(r.created ? tr('PR を作成しました') : tr('PR を更新しました'), 'ok');
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
    <label class="check agent-cfg-head"><input type="checkbox" class="sUse" value="${a}" ${on ? 'checked' : ''} /> ${agentIcon(a)}${tr('<b>{v1}</b> を使う', { v1: esc(agentLabel(a)) })}</label>
    <div class="agent-cfg-body" ${on ? '' : 'hidden'}>${body}</div></div>`;
}

// ---------------- RC設定（遠隔操作） ----------------

// RC設定で最後に選んだ側（host / client）。ホストとクライアントは排他なので、選んだ側の設定だけを出す
const RC_ROLE_KEY = 'rcRole';

function openRemoteSettings() {
  openModal(
    `<h2>${tr('RC設定（遠隔操作）')}</h2>
     <small class="muted s-note">${tr('作業する PC（ホスト。Mac でも Windows でも）のボードを、別の PC（クライアント）から操作できます。この PC の役割をホストかクライアントのどちらかに選んでください。ホストは 127.0.0.1 だけで待ち受けるので、SSH のポート転送を通してつなぎます（手順は README の「遠隔操作」）。')}</small>
     <div class="remote-box" id="rcBox">${tr('遠隔の状態を読み込み中…')}</div>
     <div class="modal-actions"><button class="btn primary" id="rcClose">${tr('閉じる')}</button></div>`,
    () => {
      // 操作側の SSH の鍵。作るのはこのアプリ、公開鍵をホストに登録するのはユーザー
      const copyBtn = (id, label = tr('コピー')) => `<button class="btn small" type="button" data-copy="${id}">${label}</button>`;
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
          kb.innerHTML = `<div>${tr('<strong>① SSH の鍵を作る</strong>')}</div>
            <small class="muted">${tr('{v1} にまだ鍵がありません。このアプリで ssh-keygen を動かして、パスフレーズなしの ed25519 の鍵を作ります（アプリからはパスフレーズを入力できないため）。', { v1: (esc(st.path)) })}</small>
            <div class="row"><button class="btn small primary" type="button" id="rGenKey">${tr('鍵を作る')}</button></div>`;
          $('rGenKey').onclick = async () => {
            const r = await runBusy(tr('SSH の鍵を作っています…'), () => api.remoteGenKey({ keyPath: $('rSshKey').value, sshPath: $('rSshPath').value }));
            if (!r) return;
            if ($('rSshKey')) $('rSshKey').value = r.path;
            toast(r.created ? tr('鍵を作りました。公開鍵のファイルをホストに渡して登録してください') : tr('すでにある鍵を使います'), 'ok');
            drawKey(r);
          };
          return;
        }
        if (!st.publicKey) {
          kb.innerHTML = `<div class="warn">${tr('鍵 {v1} はありますが、公開鍵（{v2}）が読めません。ターミナルで <code>ssh-keygen -y -f "{v3}" &gt; "{v4}"</code> を実行して作り直してください。', { v1: (esc(st.path)), v2: (esc(st.pubPath)), v3: (esc(st.path)), v4: (esc(st.pubPath)) })}</div>`;
          return;
        }
        const cmd = st.commands || {};
        const user = $('rSshUser')?.value.trim() || tr('<ユーザー名>');
        const host = $('rSshHost')?.value.trim() || tr('<ホストの IP>');
        kb.innerHTML = `<div>${tr('<strong>① SSH の鍵</strong>: {v1}（できています）', { v1: (esc(st.path)) })}</div>
          <div class="remote-key-row"><div class="remote-ssh" id="rPubKey">${esc(st.publicKey)}</div>${copyBtn('rPubKey', tr('公開鍵をコピー'))}</div>
          <div>${tr('<strong>② 公開鍵をホストに渡す</strong>（ここはご自身で行ってください）')}</div>
          <small class="muted">${tr('公開鍵のファイル <b>{v1}</b> を、USB・共有フォルダ・メールなどでホストの PC の好きな場所に置き、ホストの Worktree Kanban の「RC設定」→「操作側の公開鍵を登録する」で選んで登録します。秘密鍵（{v2}）は渡さないでください。アプリを使わずに登録するなら、ホストの OS に合ったコマンドをホストで実行します:', { v1: (esc(st.pubPath)), v2: (esc(st.path)) })}</small>
          <div><small>${tr('ホストが Mac（ターミナルで）')}</small></div>
          <div class="remote-key-row"><div class="remote-ssh" id="rCmdMac">${esc(cmd.mac || '')}</div>${copyBtn('rCmdMac')}</div>
          <div><small>${tr('ホストが Windows で、ユーザーが管理者（ふつうの個人の PC。PowerShell を「管理者として実行」で）')}</small></div>
          <div class="remote-key-row"><div class="remote-ssh" id="rCmdWinAdmin">${esc(cmd.winAdmin || '')}</div>${copyBtn('rCmdWinAdmin')}</div>
          <div><small>${tr('ホストが Windows で、ユーザーが管理者ではない（PowerShell で）')}</small></div>
          <div class="remote-key-row"><div class="remote-ssh" id="rCmdWinUser">${esc(cmd.winUser || '')}</div>${copyBtn('rCmdWinUser')}</div>
          <div>${tr('<strong>③ パスワードなしで入れるか確かめる</strong>（この PC のターミナルで。初回は yes と答えます）')}</div>
          <div class="remote-key-row"><div class="remote-ssh" id="rCmdCheck">${esc(`ssh -i "${st.path}" ${user}@${host} exit`)}</div>${copyBtn('rCmdCheck')}</div>`;
        kb.querySelectorAll('[data-copy]').forEach((b) => {
          b.onclick = () => navigator.clipboard.writeText($(b.dataset.copy).textContent).then(() => toast(tr('コピーしました'), 'ok'), () => toast(tr('コピーできませんでした')));
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
          ? tr('「設定 → システム → オプション機能」で「OpenSSH サーバー」を追加し、管理者の PowerShell で <code>Start-Service sshd; Set-Service sshd -StartupType Automatic</code> を実行してください')
          : hi?.platform === 'darwin'
            ? tr('「システム設定 → 一般 → 共有 → リモートログイン」をオンにしてください')
            : tr('SSH サーバー（sshd）を起動してください');
        const hostInfoBlock = hi
          ? `<div class="remote-ssh">${tr('操作側の「SSH の接続先」: {v1}\n    ユーザー名: {v2}\n    SSH サーバー（ポート {v3}）: {v4}', { v1: (hi.tailscaleIps.length ? esc(hi.tailscaleIps.join(' / ')) : `${tr('{v1}（Tailscale の IP が見つかりません。Tailscale が接続中か確かめてください）', { v1: (esc(hi.hostname)) })}`), v2: (esc(hi.user || '?')), v3: (esc(hi.sshPort)), v4: (hi.sshServer ? tr('動いています') : tr('動いていません')) })}</div>
             ${hi.sshServer ? '' : `<div class="warn">${tr('このマシンの SSH サーバーが動いていないので、操作側からつなげません。{v1}', { v1: (sshServerHowto) })}</div>`}
             <div class="remote-key" id="rHostKeyBox">
               <div>${tr('<strong>操作側の公開鍵を登録する</strong>')}</div>
               <small class="muted">${tr('操作側の RC設定で作った公開鍵（agent-kanban_ed25519.pub）を、USB・共有フォルダ・メールなどでこの PC の好きな場所に置き、ここで選んで「登録する」を押すと、SSH で入れるように設定します（{v1} に足します）。', { v1: (hi.platform === 'win32' ? tr('管理者のユーザーは C:\\ProgramData\\ssh\\administrators_authorized_keys、それ以外は ~/.ssh/authorized_keys') : '~/.ssh/authorized_keys') })}</small>
               <div class="remote-key-row"><div class="remote-ssh" id="rHostPubPath">${tr('（まだ選んでいません）')}</div><button class="btn small" type="button" id="rPickPub">${tr('ファイルを選択…')}</button></div>
               <div id="rHostPubInfo"></div>
               <div class="row"><button class="btn small primary" type="button" id="rInstallPub" disabled>${tr('登録する')}</button></div>
             </div>`
          : '';
        const port = rs.host.port || 17831;
        const ssh = `ssh -L ${port}:127.0.0.1:${port} <user>@<host>`;
        const hostBlock = rs.host.listening
          ? `<div>${tr('<strong>ホストとして待ち受け中</strong>（ポート {v1}・接続 {v2}・ペア済み {v3}）', { v1: (esc(port)), v2: (rs.host.clients || 0), v3: (rs.host.pairedCount || 0) })}</div>
             <div>${tr('ペアリングコード: <span class="pair-code">{v1}</span>', { v1: (rs.host.pairCode ? esc(rs.host.pairCode) : tr('（期限切れ・再発行してください）')) })}</div>
             <div class="row">
               <button class="btn small" type="button" id="rRefreshPair">${tr('コードを再発行')}</button>
               <button class="btn small" type="button" id="rClearPairs">${tr('ペアを破棄')}</button>
               <button class="btn small danger" type="button" id="rStopHost">${tr('ホストを停止')}</button>
             </div>
             <div><small class="muted">${tr('操作側の「クライアント」で「SSH 経由」を選び、下の接続先とユーザー名を入れて接続します。自分でトンネルを張るなら:')}</small><div class="remote-ssh">${esc(ssh)}</div></div>
             ${hostInfoBlock}`
          : `<div>${tr('<strong>ホスト（作業側）</strong>')}</div>
             <label class="field">${tr('<span>待ち受けポート</span>')}<input id="rHostPort" type="number" min="1024" max="65535" value="${esc(port)}" /></label>
             <button class="btn small primary" type="button" id="rStartHost">${tr('ホストを開始（ペアリングコードを出す）')}</button>
             <div><small class="muted">${tr('開始後、操作側の「クライアント」で「SSH 経由」を選び、下の接続先とユーザー名・コードで接続します（このマシンの SSH サーバーをオンにしておいてください）。自分でトンネルを張るなら:')}</small><div class="remote-ssh">${esc(ssh)}</div></div>
             ${hostInfoBlock}`;
        const c = rs.client;
        const viaSsh = c.mode !== 'direct';
        const targetText = viaSsh ? `${tr('SSH 経由 {v1}{v2}（ホストのポート {v3}）', { v1: (esc(c.sshUser ? `${c.sshUser}@` : '')), v2: (esc(c.sshHost)), v3: (esc(c.port)) })}` : `${esc(c.host)}:${esc(c.port)}`;
        const resumeBlock = c.reconnecting
          ? `<div class="remote-key"><div>${tr('<strong>前回の接続を再開しています…</strong>（{v1}/{v2} 回目） → {v3}', { v1: (esc(c.reconnecting.attempt)), v2: (esc(c.reconnecting.max)), v3: (targetText) })}</div>
               ${c.reconnecting.lastError ? `<small class="muted">${tr('前回の失敗: {v1}', { v1: (esc(c.reconnecting.lastError)) })}</small>` : ''}
               <div><button class="btn small" type="button" id="rCancelResume">${tr('再開をやめる')}</button></div></div>`
          : '';
        // これまでつないだ接続先のカード。押すと、その接続先と保存したトークンでつなぐ
        const history = c.history || [];
        const connTitle = (h) => (h.mode === 'direct' ? `${h.host}:${h.port}` : `${h.sshUser ? `${h.sshUser}@` : ''}${h.sshHost}`);
        const connSub = (h) => (h.mode === 'direct' ? `${tr('直接・{v1}:{v2}', { v1: (h.host), v2: (h.port) })}` : `${tr('SSH 経由{v1}・ホストのポート {v2}', { v1: (h.sshPort && h.sshPort !== 22 ? `${tr('（ポート {v1}）', { v1: (h.sshPort) })}` : ''), v2: (h.port) })}`);
        const historyBlock = history.length
          ? `<div class="remote-key"><div>${tr('<strong>これまでの接続</strong>（カードを押すと、保存したトークンでつなぎます）')}</div>
               ${c.resumeError ? `<div class="warn">${tr('つながりませんでした: {v1}', { v1: (esc(c.resumeError)) })}</div>` : ''}
               <div class="rc-conn-list">${history
                 .map((h) => {
                   const last = h.id === c.currentId;
                   return `<div class="rc-conn-card${last ? ' last' : ''}${h.hasToken ? '' : ' no-token'}">
                     <button class="rc-conn-main" type="button" data-conn="${esc(h.id)}" ${h.hasToken ? '' : 'disabled'} title="${h.hasToken ? tr('この接続先につなぐ') : tr('トークンがないので、6 桁のコードでペアリングし直してください')}">
                       <span class="rc-conn-title">${h.hasToken ? '↻ ' : ''}${esc(connTitle(h))}${last ? tr('<span class="rc-conn-badge">前回</span>') : ''}</span>
                       <span class="rc-conn-sub">${esc(connSub(h))}</span>
                       <span class="rc-conn-sub">${h.hasToken ? (h.lastConnectedAt ? `${tr('最後の接続: {v1}', { v1: (esc(timeAgo(h.lastConnectedAt))) })}` : tr('以前の版で接続')) : tr('コードでのペアリングが必要')}</span>
                     </button>
                     <button class="rc-conn-forget" type="button" data-forget="${esc(h.id)}" title="${tr('この接続を一覧から消す（トークンも忘れます）')}">×</button>
                   </div>`;
                 })
                 .join('')}</div>
               <small class="muted">${tr('新しい接続先につなぐときや、接続先を直すときは、下の欄を入れて接続します。')}</small></div>`
          : '';
        const legacyResume = !c.reconnecting && c.canResume && !history.some((h) => h.id === c.currentId)
            ? `<div class="remote-key"><div>${tr('<strong>前回の接続</strong> → {v1}', { v1: (targetText) })}</div>
                 ${c.resumeError ? `<div class="warn">${tr('つながりませんでした: {v1}', { v1: (esc(c.resumeError)) })}</div>` : ''}
                 <div><button class="btn small primary" type="button" id="rResume">${tr('↻ 前回の接続を再開')}</button></div>
                 <small class="muted">${tr('接続先を変えるときは、下の欄を直して「保存したトークンで接続」を押します。')}</small></div>`
            : '';
        const clientBlock = c.connected
          ? `<div>${tr('<strong>クライアントとして接続中</strong> → {v1}', { v1: (targetText) })}</div>
             <small class="muted">${tr('アプリを終了しても、次に起動したときにこの接続を自動で再開します（回線が切れたときも、つなぎ直します）。「切断」を押すと、次からは自動で再開しません。')}</small>
             <button class="btn small danger" type="button" id="rDisconnect">${tr('切断してローカルボードに戻る')}</button>`
          : `<div>${tr('<strong>クライアント（操作側）</strong>')}</div>
             ${resumeBlock}
             ${historyBlock}
             ${legacyResume}
             <label class="field">${tr('<span>接続方法</span>')}
               <select id="rClientMode">
                 <option value="ssh" ${viaSsh ? 'selected' : ''}>${tr('SSH 経由（アプリがトンネルを張る・おすすめ）')}</option>
                 <option value="direct" ${viaSsh ? '' : 'selected'}>${tr('直接（自分で張ったトンネルの 127.0.0.1 などへ）')}</option>
               </select>
             </label>
             <div id="rSshFields" ${viaSsh ? '' : 'hidden'}>
               <div class="row">
                 <label class="field">${tr('<span>SSH の接続先（Tailscale の IP・名前など）</span>')}<input id="rSshHost" placeholder="${tr('100.x.x.x / マシン名')}" value="${esc(c.sshHost || '')}" /></label>
                 <label class="field">${tr('<span>ユーザー名（ホストのログイン名）</span>')}<input id="rSshUser" placeholder="kazuya" value="${esc(c.sshUser || '')}" /></label>
                 <label class="field">${tr('<span>SSH ポート</span>')}<input id="rSshPort" type="number" min="1" max="65535" value="${esc(c.sshPort || 22)}" /></label>
               </div>
               <div class="row">
                 <label class="field">${tr('<span>鍵ファイル（空ならこのアプリで作る ~/.ssh/agent-kanban_ed25519）</span>')}<input id="rSshKey" placeholder="~/.ssh/agent-kanban_ed25519" value="${esc(c.sshKey || '')}" /></label>
                 <label class="field">${tr('<span>ssh コマンド</span>')}<input id="rSshPath" value="${esc(c.sshPath || 'ssh')}" /></label>
               </div>
               <small class="muted">${tr('SSH は鍵で入れる必要があります（パスワードは入力できません）。ホスト側で SSH サーバーをオンにしてください（Mac は「リモートログイン」、Windows は「OpenSSH サーバー」）。接続先とユーザー名は、ホストの Worktree Kanban のこの画面に出ています。')}</small>
               <div class="remote-key" id="rKeyBox">${tr('SSH の鍵を確かめています…')}</div>
             </div>
             <div class="row">
               <label class="field" id="rClientHostField" ${viaSsh ? 'hidden' : ''}>${tr('<span>接続先ホスト</span>')}<input id="rClientHost" value="${esc(c.host || '127.0.0.1')}" /></label>
               <label class="field">${tr('<span>ホストの待ち受けポート</span>')}<input id="rClientPort" type="number" min="1024" max="65535" value="${esc(c.port || 17831)}" /></label>
             </div>
             <label class="field">${tr('<span>ペアリングコード（初回のみ。トークンがあれば空で再接続）</span>')}<input id="rPairCode" placeholder="${tr('6桁')}" maxlength="8" /></label>
             <div class="row">
               <button class="btn small primary" type="button" id="rConnect">${c.hasToken ? tr('保存したトークンで接続') : tr('コードでペアリング')}</button>
               ${c.hasToken ? tr('<button class="btn small" type="button" id="rForgetToken">トークンを忘れる</button>') : ''}
             </div>
             <small class="muted" id="rDirectHint" ${viaSsh ? 'hidden' : ''}>${tr('直接のときは、先に <code>{v1}</code> を張り、接続先ホストは 127.0.0.1 のままにします（ホストは 127.0.0.1 でしか待ち受けないので、Tailscale の IP を直接入れてもつながりません）', { v1: (esc(ssh)) })}</small>`;
        const roleTab = (r, label, lockedBy) =>
          `<button class="mtab${role === r ? ' active' : ''}" type="button" data-rc-role="${r}" ${lockedBy ? `disabled title="${esc(lockedBy)}"` : ''}>${label}</button>`;
        const roleTabs = `<div class="mtabs rc-role-tabs">
            ${roleTab('host', tr('ホスト（作業側）'), clientActive ? tr('クライアントとして接続中は選べません。先に切断してください') : '')}
            ${roleTab('client', tr('クライアント（操作側）'), hostActive ? tr('ホストとして待ち受け中は選べません。先にホストを停止してください') : '')}
          </div>`;
        const lockNote = hostActive
          ? tr('<small class="muted">ホストとして待ち受け中なので、クライアントには切り替えられません（ホストを停止すると選べます）。</small>')
          : clientActive
            ? tr('<small class="muted">クライアントとして接続中なので、ホストには切り替えられません（切断すると選べます）。</small>')
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
        if ($('rStartHost')) $('rStartHost').onclick = () => busy(tr('ホストを開始しています…'), () => api.remoteStartHost({ port: $('rHostPort').value }));
        if ($('rStopHost')) $('rStopHost').onclick = () => busy(tr('ホストを停止しています…'), () => api.remoteStopHost());
        if ($('rRefreshPair')) $('rRefreshPair').onclick = () => busy(tr('コードを発行しています…'), () => api.remoteRefreshPair());
        if ($('rClearPairs')) $('rClearPairs').onclick = () => {
          if (!confirm(tr('ペアリング済みのクライアントをすべて無効にしますか？'))) return;
          busy(tr('ペアを破棄しています…'), () => api.remoteClearPairs());
        };
        if ($('rClientMode')) $('rClientMode').onchange = () => {
          const ssh = $('rClientMode').value === 'ssh';
          $('rSshFields').hidden = !ssh;
          $('rClientHostField').hidden = ssh;
          $('rDirectHint').hidden = ssh;
        };
        if ($('rConnect')) $('rConnect').onclick = () => {
          const mode = $('rClientMode').value;
          if (mode === 'ssh' && !$('rSshHost').value.trim()) return toast(tr('SSH の接続先（Tailscale の IP か名前）を入れてください'));
          busy(mode === 'ssh' ? tr('SSH トンネルを張って接続しています…') : tr('接続しています…'), () =>
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
          const r = await runBusy(tr('公開鍵を読み込んでいます…'), () => api.remotePickPubKey());
          if (!r) return;
          pickedPub = r;
          $('rHostPubPath').textContent = r.path;
          $('rHostPubInfo').innerHTML = `<small class="muted">${tr('鍵: {v1}{v2}', { v1: (esc(r.type)), v2: (r.comment ? tr('（{v1}）', { v1: (esc(r.comment)) }) : '') })}</small>`;
          $('rInstallPub').disabled = false;
        };
        if ($('rInstallPub')) $('rInstallPub').onclick = async () => {
          if (!pickedPub) return toast(tr('公開鍵のファイルを選んでください'));
          const r = await runBusy(tr('公開鍵を登録しています…'), () => api.remoteInstallPubKey({ path: pickedPub.path }));
          if (!r) return;
          $('rHostPubInfo').innerHTML = `<div class="ok-note">${tr('{v1}: {v2}<br />操作側で「SSH 経由」・接続先・ユーザー名（下の値）を入れて接続できます。', { v1: (r.added ? tr('登録しました') : tr('この鍵はもう登録されています')), v2: (esc(r.file)) })}</div>`;
          toast(r.added ? tr('公開鍵を登録しました') : tr('この鍵はもう登録されています'), 'ok');
        };
        if ($('rKeyBox')) {
          drawKey();
          // 鍵ファイルの欄を変えたら、その鍵を見直す
          $('rSshKey').onchange = () => drawKey();
        }
        if ($('rResume')) $('rResume').onclick = () => busy(viaSsh ? tr('SSH トンネルを張って、前回の接続を再開しています…') : tr('前回の接続を再開しています…'), () => api.remoteResume());
        box.querySelectorAll('[data-conn]').forEach((b) => {
          b.onclick = () => {
            const h = history.find((x) => x.id === b.dataset.conn);
            busy(h?.mode === 'direct' ? `${tr('{v1} につないでいます…', { v1: (connTitle(h)) })}` : `${tr('SSH トンネルを張って、{v1} につないでいます…', { v1: (h ? connTitle(h) : '') })}`, () => api.remoteResume({ id: b.dataset.conn }));
          };
        });
        box.querySelectorAll('[data-forget]').forEach((b) => {
          b.onclick = () => {
            const h = history.find((x) => x.id === b.dataset.forget);
            if (!confirm(`${tr('「{v1}」を、これまでの接続から消しますか？（保存したトークンも忘れます）', { v1: (h ? connTitle(h) : b.dataset.forget) })}`)) return;
            busy(tr('接続を消しています…'), () => api.remoteForgetConnection({ id: b.dataset.forget }));
          };
        });
        if ($('rCancelResume')) $('rCancelResume').onclick = () => busy(tr('再開をやめています…'), () => api.remoteCancelResume());
        if ($('rDisconnect')) $('rDisconnect').onclick = () => busy(tr('切断しています…'), () => api.remoteDisconnect());
        if ($('rForgetToken')) $('rForgetToken').onclick = () => busy(tr('トークンを消しています…'), () => api.remoteForgetToken());
      };
      drawRemote();
      // 裏での再開が始まった・つながった・あきらめたときは、開いている RC設定も描き直す
      remoteDialogRedraw = drawRemote;
      $('rcClose').onclick = closeModal;
    },
  );
}

// 設定画面（ハンバーガーメニューの「設定」）。
// 入力中の値が消えないよう、開いたときと、見ているプロジェクトが変わったときにだけ描く（renderBoard は頻繁に呼ばれる）
let settingsViewKey = null; // いま描いてある設定画面のプロジェクト（描いていなければ null）
let settingsNav = null;
const currentSettingsKey = () => `${viewingHost()}:${state.board.settings.repoPath}`;

// 別のプロジェクトの値が画面に残っていると、そのまま今のプロジェクトに保存してしまうので描き直す
function renderSettingsViewIfStale() {
  if (settingsViewKey !== currentSettingsKey()) renderSettingsView();
}

// 画面を離れたら中身を消す（sBase などの ID が、ほかの画面やダイアログと紛らわしく残らないように）
function clearSettingsView() {
  $('settingsView').innerHTML = '';
  settingsViewKey = null;
  settingsNav = null;
}

// 設定画面を開く。section を渡すと、その節までスクロールする（もう開いていても、スクロールは動かす）
function openSettings(section) {
  setView('settings');
  if (section) settingsNav?.scrollTo(section);
}

function renderSettingsView() {
  const s = state.board.settings;
  const viewKey = currentSettingsKey();
  const projectName = String(s.repoPath || '').split(/[\\/]/).filter(Boolean).pop() || '';
  // ブランチ一覧は git を何回も起動するので（Windows だと遅い）、待たずに画面を描いてから後で入れる
  const baseOptions = (info) =>
    `<option value="">${tr('チェックアウト中のブランチ{v1}', { v1: (info.current ? `${tr('（今は {v1}）', { v1: (esc(info.current)) })}` : '') })}</option>` +
    [...new Set([...(s.baseBranch ? [s.baseBranch] : []), ...info.branches])]
      .map((b) => `<option ${b === s.baseBranch ? 'selected' : ''}>${esc(b)}</option>`)
      .join('');
  // 節の中身。並びと見出しは AppView.SETTINGS_NAV に合わせる
  const sections = {
    general: `<small class="muted s-note">${tr('ここの項目は、どのプロジェクトでも同じです。')}</small>
      <label class="field"><span>${tr('言語')}</span>
        <select id="sLanguage">${I18n.LANGUAGES.map((l) => `<option value="${l.code}" ${l.code === I18n.getLanguage() ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select>
        <small>${tr('表示の言語です。選ぶとすぐに保存して、画面を読み直します。')}</small></label>
      <label class="field">${tr('<span>同時に動かす数</span>')}<input id="sMax" type="number" min="1" max="10" value="${esc(s.maxParallel)}" /></label>
      <label class="check"><input type="checkbox" id="sSuggestSkills" ${s.suggestSkillsOnDone !== false ? 'checked' : ''} /> ${tr('タスクが完了したとき、前に完了したタスクと似た作業が続いていたら、スキルにしないか通知で聞く（右上のベル）')}</label>
      <label class="check"><input type="checkbox" id="sDeleteSessions" ${s.deleteSessionsOnMerge !== false ? 'checked' : ''} /> ${tr('マージして完了したら、そのタスクの作業に使った Claude Code の会話（セッション）を消す（引き継いだ元の会話は残します）')}</label>`,
    update: `<div id="updPanel" class="gh-panel upd-panel">${updatePanelHtml(state.update)}</div>`,
    branch: `<small class="muted s-note">${tr('「このプロジェクト」の項目{v1}は、プロジェクト（リポジトリ）ごとに覚えます。タブを切り替えると、そのプロジェクトの設定に変わります。初めて開いたプロジェクトは初期値から始まります。', { v1: (projectName ? tr('（<code>{v1}</code>）', { v1: (esc(projectName)) }) : '') })}</small>
      <label class="field">${tr('<span>ベースブランチ（worktree の作成元・マージ先）</span>')}
        <select id="sBase">${baseOptions({ branches: [], current: '' })}</select></label>
      <label class="field">${tr('<span>レビュー後の取り込み方</span>')}
        <select id="sIntegration">
          <option value="merge" ${s.integration !== 'pr' ? 'selected' : ''}>${tr('直接マージする（ローカルで git merge）')}</option>
          <option value="pr" ${s.integration === 'pr' ? 'selected' : ''}>${tr('PR を作成する（origin に push して gh pr create）')}</option>
        </select>
        <small>${tr('レビュー中のタスクに出るボタンが「マージ」か「PR を作成」に変わります。PR の作成には gh のインストールとログインが必要です。')}</small></label>
      <label class="field">${tr('<span>ブランチの命名規則（自然言語で書けます）</span>')}
        <textarea id="sBranchRule" rows="2" placeholder="${tr('例: feature/<Issue番号>-<内容を表す短い英語> にする。Issue がないときは feature/<内容を表す短い英語>')}">${esc(s.branchNamingRule || '')}</textarea>
        <small>${tr('書いておくと、タスクの開始時にそのタスクのエージェントがこの規則に従ってブランチ名を考えます。空なら agent/issue-12-xxxx のような名前になります。決められなかったときも、この名前になります。')}</small></label>`,
    issue: `<div class="field">
        <label class="check"><input type="checkbox" id="sIssueSync" ${s.issueStatusSync !== false ? 'checked' : ''} /> ${tr('Issue のステータスを自動で変える（GitHub Projects）')}</label>
        <small>${tr('Issue から作ったタスクが「実行中」になると In progress、「レビュー」になると In review、マージして「完了」になると Done に、Issue が入っている Project の Status を変えます。gh に project の権限が必要です。')}</small>
        <div class="status-map" id="sStatusMap" ${s.issueStatusSync !== false ? '' : 'hidden'}>
          <label class="field">${tr('<span>変える項目（Project の単一選択フィールド名。空なら Status）</span>')}<input id="sStatusField" placeholder="Status" value="${esc(s.statusFieldName || '')}" /></label>
          <div class="row">
            <label class="field">${tr('<span>実行中 →</span>')}<input id="sMapProgress" placeholder="${tr('自動（In progress など）')}" value="${esc((s.statusMapping || {}).inProgress || '')}" /></label>
            <label class="field">${tr('<span>レビュー →</span>')}<input id="sMapReview" placeholder="${tr('自動（In review など）')}" value="${esc((s.statusMapping || {}).inReview || '')}" /></label>
            <label class="field">${tr('<span>完了 →</span>')}<input id="sMapDone" placeholder="${tr('自動（Done など）')}" value="${esc((s.statusMapping || {}).done || '')}" /></label>
          </div>
          <small>${tr('列ごとに使う選択肢の名前を指定できます（カンマ区切りで候補を複数書けます。大文字小文字・絵文字・記号は無視して比べます）。空の列は名前から自動で探します。')}</small>
        </div>
        <div id="ghPanel" class="gh-panel">${tr('gh（GitHub CLI）を確認しています…')}</div></div>`,
    permission: `<label class="field">${tr('<span>権限モード</span>')}
        <select id="sMode">${PERMISSION_MODES.map(([v, l]) => `<option value="${v}" ${v === s.permissionMode ? 'selected' : ''}>${esc(tr(l))}</option>`).join('')}</select>
        <small>${tr('自動で許可されない操作は、カードに「承認待ち」として表示されます。')}</small></label>
      <label class="field">${tr('<span>Claude Code に最初から許可しておくツール（カンマか改行で区切る）</span>')}
        <textarea id="sAllowed" rows="2" placeholder="${tr('例: Bash(npm test:*), Bash(git status), WebSearch')}">${esc(s.allowedTools)}</textarea></label>`,
    task: `<div class="field">${tr('<span>新しいタスクで最初から選んでおくスキル</span>')}<div id="sSkill" class="skill-slot"></div>
        <small>${tr('「＋ 新しいタスク」（自然言語・Issue のどちらでも）を開いたときに、このスキルが選ばれた状態になります（その場で外したり変えたりできます）。')}</small></div>
      <label class="check"><input type="checkbox" id="sSpecCheck" ${s.specCheck !== false ? 'checked' : ''} /> ${tr('新しいタスクの内容が詰まっていなければ、開発を始める前にエージェントと対話して仕様を詰める')}</label>
      <small class="muted s-note">${tr('仕様を詰めるときに、分けたほうがよい大きなタスクなら、エージェントがサブタスクに分けることを提案します（「サブタスクでやる」と答えたら分けます）。開始前のタスクには、進捗タブから手動でサブタスクを足せます（足したあとは「サブタスク」タブで見られます）。')}</small>
      <label class="field">${tr('<span>サブタスクが終わったら（既定。タスクごとに開始前に変えられます）</span>')}<select id="sSubtaskMerge"><option value="auto"${s.subtaskMerge !== 'review' ? ' selected' : ''}>${tr('自動で親のブランチにマージする')}</option><option value="review"${s.subtaskMerge === 'review' ? ' selected' : ''}>${tr('確かめてからマージする')}</option></select></label>`,
    agents: `<small class="muted s-note">${tr('ここの項目は、どのプロジェクトでも同じです（「このプロジェクトの設定」と書いた項目だけは、プロジェクトごとに覚えます）。')}</small>
      <small class="muted s-note">${tr('チェックを付けたエージェントだけ、コマンドとモデルを設定でき、タスク・会話・Pipeline・競争で選べます（1つ以上）。')}</small>
      ${agentConfigHtml('claude', s, `
        <div class="row">
          <label class="field">${tr('<span>claude コマンドのパス</span>')}<input id="sClaude" value="${esc(s.claudePath || 'claude')}" /></label>
          <label class="field">${tr('<span>モデル（空なら既定）</span>')}<input id="sModel" placeholder="${tr('例: sonnet / opus')}" value="${esc(s.model || '')}" /></label>
        </div>`)}
      ${agentConfigHtml('codex', s, `
        <div class="row">
          <label class="field">${tr('<span>codex コマンドのパス</span>')}<input id="sCodex" value="${esc(s.codexPath || 'codex')}" /></label>
          <label class="field">${tr('<span>モデル（空なら既定）</span>')}<input id="sCodexModel" placeholder="${tr('例: gpt-5-codex')}" value="${esc(s.codexModel || '')}" /></label>
        </div>`)}
      ${agentConfigHtml('gemini', s, `
        <div class="row">
          <label class="field">${tr('<span>gemini コマンドのパス</span>')}<input id="sGemini" value="${esc(s.geminiPath || 'gemini')}" /></label>
          <label class="field">${tr('<span>モデル（空なら既定）</span>')}<input id="sGeminiModel" placeholder="${tr('例: gemini-2.5-pro')}" value="${esc(s.geminiModel || '')}" /></label>
        </div>`)}
      ${agentConfigHtml('cursor', s, `
        <div class="row">
          <label class="field">${tr('<span>cursor-agent コマンドのパス</span>')}<input id="sCursor" value="${esc(s.cursorPath || 'cursor-agent')}" /></label>
          <label class="field">${tr('<span>モデル（空なら既定）</span>')}<input id="sCursorModel" placeholder="${tr('例: gpt-5 / sonnet-4.5')}" value="${esc(s.cursorModel || '')}" /></label>
        </div>`)}
      <small class="muted s-note">${tr('Claude Code は、自動で許可されない操作をカードで承認できます。Codex / Gemini / Cursor はカードでの承認に対応していないため、権限モードに合わせて CLI 側で許可します（計画だけ → 読み取りのみ、すべて自動で許可 → 確認なし、それ以外 → Codex は worktree の中だけ書ける sandbox・Gemini はファイル編集だけ自動で許可・Cursor は --force でファイル編集とコマンドを許可（Cursor の cli-config.json の deny は守られます））。')}</small>
      <label class="field">${tr('<span>新しいタスク・会話で最初から選んでおくエージェント</span>')}
        <select id="sDefaultAgent"></select>
        <small>${tr('オーケストレーションで Pipeline・競争を選んでいれば、タスクを作るときの「エージェント」の欄では、そちらを最初から選んでおきます（使えない状態のときや会話では、このエージェント）。競争の比較も、このエージェントに頼みます（スキルの提案は、元のタスクのエージェントが使えればそちらに頼みます）。')}</small></label>`,
    custom: `<small class="muted s-note">${tr('カスタムエージェントは、このプロジェクトの設定です。')}</small>
         <div class="field">
        <div id="sCustomList" class="ca-list"></div>
        <div id="sCustomForm" class="ca-form" hidden></div>
        <div><button class="btn small" id="sCustomAdd" type="button">${tr('＋ カスタムエージェントを追加')}</button></div>
        <small>${tr('元にするエージェント（CLI）とモデルに、プロフィール（名前・アイコンと色・説明・振る舞いの指示）を持たせます。タスク・会話を作るときの「エージェント」の欄、Pipelineの工程、競争で選べます。振る舞いの指示は、最初の指示の前に付けて渡します。')}</small></div>`,
    orchestration: `<div class="field">${tr('<span>使うオーケストレーション（Pipelineと競争は、どちらか1つだけ使えます。使わないこともできます）</span>')}
        <div class="check-row">
          <label class="check"><input type="radio" name="sOrch" value="relay" ${orchestrationOf(s) === 'relay' ? 'checked' : ''} /> ${icon('pipeline')}Pipeline</label>
          <label class="check"><input type="radio" name="sOrch" value="compete" ${orchestrationOf(s) === 'compete' ? 'checked' : ''} /> ${tr('{v1}競争', { v1: (icon('flag')) })}</label>
          <label class="check"><input type="radio" name="sOrch" value="none" ${orchestrationOf(s) === 'none' ? 'checked' : ''} /> ${tr('なし')}</label>
        </div>
        <small>${tr('選んだ方だけ、タスクを作るときに「エージェント」の欄で選べます。「なし」なら、いつも1つのエージェントで動かします（Pipeline・競争の設定は消えずに残ります）。')}</small></div>
      <div class="field" id="sRelayField">${tr('<span>{v1}Pipeline（このプロジェクトの設定。いくつでも作れます）</span>', { v1: (icon('pipeline')) })}
        <div id="sRelayList" class="pl-list"></div>
        <div id="sRelayExport" class="ca-form" hidden></div>
        <div class="pl-tools">
          <button class="btn small" id="sRelayAdd" type="button">${tr('＋ Pipelineを追加')}</button>
          <button class="btn small" id="sRelayImport" type="button">${tr('インポート（.json / .zip）')}</button>
          <button class="btn small" id="sRelayBundle" type="button">${tr('まとめてエクスポート（zip）')}</button>
        </div>
        <small>${tr('工程（エージェントと担当の説明）を線でつなぎ、分岐（if）・ループ・並列を組めます。工程が終わるたびに変更をコミットし、最後の報告と一緒に次の工程へ渡します。タスクを作るときに、どの Pipeline で動かすかを選べます（「既定」のものを最初から選んでおきます）。<br />\n        「エクスポート」は Pipeline 1つを .json に、「まとめてエクスポート」は選んだ Pipeline とカスタムエージェントを zip にします。インポートは .json か zip を選びます（同じ中身のカスタムエージェントがあればそれを使い、なければ足します）。Pipeline の一覧の変更は、すぐに保存します。')}</small></div>
      <div class="field" id="sCompeteField">${tr('<span>{v1}競争させるエージェント（2つ以上）</span>', { v1: (icon('flag')) })}
        <div class="check-row" id="sCompeteBox"></div>
        <small>${tr('使うエージェントにチェックを付けたものと、このプロジェクトのカスタムエージェントから選べます（カスタムエージェントの選択は、プロジェクトごとに覚えます）。')}</small></div>`,
  };
  // 描き直しても（元に戻す・タブの切り替え）、見ていた節から動かさない
  const scrollTop = $('settingsMain')?.scrollTop || 0;
  const sectionsHtml = AppView.SETTINGS_NAV.flatMap((g) => g.items)
    .map(({ id, label }) => `<section id="settings-${id}" class="settings-section" data-section="${id}"><h2 class="settings-title">${esc(label)}</h2>${sections[id]}</section>`)
    .join('');
  $('settingsView').innerHTML = `<nav id="settingsNav" class="settings-nav" aria-label="${tr('設定の項目')}">${AppView.settingsNavHtml(icon)}</nav>
    <div id="settingsMain" class="settings-main">
      <div class="settings-content">${sectionsHtml}</div>
      <div class="settings-actions"><button class="btn ghost" id="sCancel">${tr('元に戻す')}</button><button class="btn primary" id="sOk">${tr('保存')}</button></div>
    </div>`;
  settingsViewKey = viewKey;
  // ダイアログの操作を待つ間に、画面を離れたりプロジェクトが変わったりしたら、この描画の値では保存も描き直しもしない
  const isStale = () => settingsViewKey !== viewKey;
  settingsNav = AppView.bindSettingsNav({ nav: $('settingsNav'), scroller: $('settingsMain'), section: (id) => $(`settings-${id}`) });

  // Pipeline の一覧（追加・編集・削除・インポートは、その場で保存する）
  let flows = JSON.parse(JSON.stringify(pipelines(s)));
  let flowDefId = (defaultPipeline(s) || {}).id || '';
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
    document.querySelectorAll('.sCompeteCustom').forEach((x) => (x.checked ? competeCustomSel.add(x.value) : competeCustomSel.delete(x.value)));
    $('sCompeteBox').innerHTML =
      list.map((a) => `<label class="check"><input type="checkbox" class="sCompete" value="${a}" ${competeSel.has(a) ? 'checked' : ''} /> ${agentIcon(a)}${esc(agentLabel(a))}</label>`).join('') +
      cas
        .filter((ca) => list.includes(ca.agent))
        .map((ca) => `<label class="check"><input type="checkbox" class="sCompeteCustom" value="${esc(ca.id)}" ${competeCustomSel.has(ca.id) ? 'checked' : ''} /> ${personaIcon(ca, ca.agent)}${esc(whoLabel(ca.agent, ca))}</label>`)
        .join('');
  };
  // ---- カスタムエージェント（保存するまでは、この画面の中の写しを変える） ----
  let cas = JSON.parse(JSON.stringify(customAgents(s)));
  let competeCustomSel = new Set(s.competeCustomAgents || []);
  const newCaId = () => {
    let id;
    do id = `ca${Math.random().toString(16).slice(2, 10)}`;
    while (cas.some((x) => x.id === id));
    return id;
  };
  const drawCustomList = () => {
    $('sCustomList').innerHTML = cas.length
      ? cas
          .map(
            (ca, i) => `<div class="ca-item" style="--pc:${esc(ca.color || '#6366f1')}">
              ${personaIcon(ca, ca.agent)}
              <div class="ca-main"><b>${esc(ca.name)}</b> <span class="muted small">${agentIcon(ca.agent)}${esc(agentLabel(ca.agent))}${ca.model ? ` / ${esc(ca.model)}` : ''}${using().includes(ca.agent) ? '' : tr('（使わない設定）')}</span>
                ${ca.description ? `<div class="small">${esc(ca.description)}</div>` : ''}
                ${ca.instruction ? `<div class="muted small rs-inst">${esc(ca.instruction)}</div>` : ''}</div>
              <div class="ca-acts"><button class="btn small" type="button" data-ca-edit="${i}">${tr('編集')}</button><button class="btn small danger" type="button" data-ca-del="${i}">${tr('削除')}</button></div>
            </div>`,
          )
          .join('')
      : tr('<div class="muted small">まだありません</div>');
    $('sCustomList').querySelectorAll('[data-ca-edit]').forEach((b) => (b.onclick = () => openCustomForm(Number(b.dataset.caEdit))));
    $('sCustomList').querySelectorAll('[data-ca-del]').forEach((b) => {
      b.onclick = () => {
        const ca = cas[Number(b.dataset.caDel)];
        const used = flows.some((p) => PipelinePack.usedCustomIds(p.flow).includes(ca.id));
        if (!confirm(`${tr('カスタムエージェント「{v1}」を削除しますか？{v2}\n（作ってあるタスクは、そのまま動きます）', { v1: (ca.name), v2: (used ? tr('\nPipelineの工程で使っています。削除すると、その工程を選び直すまでPipelineを始められません。') : '') })}`)) return;
        cas.splice(Number(b.dataset.caDel), 1);
        competeCustomSel.delete(ca.id);
        $('sCustomForm').hidden = true;
        redrawCustom();
      };
    });
  };
  const redrawCustom = () => {
    if (isStale()) return;
    drawCustomList();
    drawRelay();
    drawAgents();
  };
  // 追加（index が null）・編集のフォーム
  const openCustomForm = (index) => {
    const cur = index === null ? { id: '', name: '', icon: '', color: '#6366f1', description: '', instruction: '', agent: using()[0] || 'claude', model: '' } : cas[index];
    const box = $('sCustomForm');
    box.hidden = false;
    box.innerHTML = `<h4>${index === null ? tr('カスタムエージェントを追加') : `${tr('「{v1}」を編集', { v1: (esc(cur.name)) })}`}</h4>
      <div class="row ca-row3">
        <label class="field">${tr('<span>名前</span>')}<input id="caName" maxlength="30" placeholder="${tr('例: 慎重なレビュアー')}" value="${esc(cur.name)}" /></label>
        <label class="field">${tr('<span>アイコン（絵文字）</span>')}<input id="caIcon" maxlength="8" placeholder="${tr('絵文字か1文字')}" value="${esc(cur.icon || '')}" /></label>
        <label class="field">${tr('<span>色</span>')}<input id="caColor" type="color" value="${esc(cur.color || '#6366f1')}" /></label>
      </div>
      <label class="field">${tr('<span>説明（役割の一言）</span>')}<input id="caDesc" maxlength="200" placeholder="${tr('例: セキュリティとテストの抜けを重点的に見る')}" value="${esc(cur.description || '')}" /></label>
      <div class="row">
        <label class="field">${tr('<span>元にするエージェント</span>')}<select id="caAgent">${AGENTS.map(([a, l]) => `<option value="${a}" ${a === cur.agent ? 'selected' : ''}>${esc(l)}${using().includes(a) ? '' : tr('（使わない設定）')}</option>`).join('')}</select></label>
        <label class="field">${tr('<span>モデル（空なら設定の既定）</span>')}<input id="caModel" list="caModelList" autocomplete="off" spellcheck="false" value="${esc(cur.model || '')}" /><datalist id="caModelList"></datalist></label>
      </div>
      <label class="field">${tr('<span>振る舞いの指示（性格・やり方。最初の指示の前に付けます）</span>')}<textarea id="caInst" rows="5" maxlength="4000" placeholder="${tr('例: 変更は小さく保ち、直す前に必ず理由を説明してください。テストが通るまで完了にしないでください。')}">${esc(cur.instruction || '')}</textarea></label>
      <div class="ca-preview" id="caPreview"></div>
      <div class="modal-actions"><button class="btn ghost small" id="caCancel" type="button">${tr('やめる')}</button><button class="btn primary small" id="caOk" type="button">${index === null ? tr('追加') : tr('決定')}</button></div>`;
    const read = () => ({
      id: cur.id || newCaId(),
      name: $('caName').value.trim(),
      icon: $('caIcon').value.trim(),
      color: $('caColor').value,
      description: $('caDesc').value.trim(),
      instruction: $('caInst').value.trim(),
      agent: $('caAgent').value,
      model: $('caModel').value.trim(),
    });
    const preview = () => {
      const v = read();
      $('caModelList').innerHTML = (MODEL_SUGGEST[v.agent] || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
      $('caModel').placeholder = settingsModel(v.agent) ? `${tr('例: {v1}（設定の既定）', { v1: (settingsModel(v.agent)) })}` : `${tr('例: {v1}', { v1: ((MODEL_SUGGEST[v.agent] || [])[0] || '') })}`;
      $('caPreview').innerHTML = `<span class="orch-chip agent persona" style="--pc:${esc(v.color)}">${personaIcon(v, v.agent)}${esc(whoLabel(v.agent, { ...v, name: v.name || tr('（名前）') }))}</span>`;
    };
    box.querySelectorAll('input, select, textarea').forEach((el) => (el.oninput = el.onchange = preview));
    preview();
    $('caName').focus();
    $('caCancel').onclick = () => (box.hidden = true);
    $('caOk').onclick = () => {
      const v = read();
      if (!v.name) return toast(tr('名前を入れてください'));
      if (v.model && !/^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]*$/.test(v.model)) return toast(`${tr('モデル名に使えない文字が入っています: {v1}', { v1: (v.model) })}`);
      if (cas.some((x, i) => i !== index && x.name === v.name)) return toast(`${tr('「{v1}」という名前のカスタムエージェントはもうあります', { v1: (v.name) })}`);
      if (index === null) cas.push(v);
      else cas[index] = v;
      box.hidden = true;
      redrawCustom();
    };
  };
  $('sCustomAdd').onclick = () => openCustomForm(null);
  // ---- Pipeline の一覧 ----
  const saveFlows = async (msg, extra = {}) => {
    // フローチャートの編集中にプロジェクトが変わったら（遠隔操作の切断など）、前のプロジェクトの一覧を保存しない
    if (isStale()) {
      toast(tr('プロジェクトが変わったので保存しませんでした'));
      return false;
    }
    const r = await runBusy(msg, () => api.updateSettings({ relayFlows: flows, relayFlowId: flowDefId, customAgents: cas, ...extra }), tr('保存しました'));
    if (!r) return false;
    Object.assign(state.board.settings, r);
    flows = JSON.parse(JSON.stringify(r.relayFlows || flows));
    flowDefId = r.relayFlowId || flowDefId;
    if (Array.isArray(r.customAgents)) cas = JSON.parse(JSON.stringify(r.customAgents));
    return true;
  };
  // 名前を入れてもらう（Electron では prompt() が使えないので、一覧の下に入力欄を出す）。やめたら null
  const askName = (title, initial, okLabel) =>
    new Promise((resolve) => {
      const box = $('sRelayExport');
      box.hidden = false;
      box.innerHTML = `<h4>${esc(title)}</h4>
        <label class="field">${tr('<span>名前（{v1}文字まで）</span>', { v1: (PipelinePack.PIPELINE_NAME_MAX) })}<input id="plName" maxlength="${PipelinePack.PIPELINE_NAME_MAX}" value="${esc(initial)}" /></label>
        <div class="modal-actions"><button class="btn ghost small" id="plCancel" type="button">${tr('やめる')}</button><button class="btn primary small" id="plOk" type="button">${esc(okLabel)}</button></div>`;
      const done = (v) => {
        box.hidden = true;
        resolve(v);
      };
      $('plName').focus();
      $('plName').select();
      $('plName').onkeydown = (e) => {
        if (e.key === 'Enter' && !e.isComposing) (e.preventDefault(), $('plOk').click());
      };
      $('plCancel').onclick = () => done(null);
      $('plOk').onclick = () => {
        const v = $('plName').value.trim();
        if (!v) return toast(tr('名前を入れてください'));
        done(v);
      };
    });
  const newFlowName = (base) => PipelinePack.uniqueName(base, new Set(flows.map((p) => p.name)), PipelinePack.PIPELINE_NAME_MAX);
  const newFlowId = () => {
    let id;
    do id = `p${Math.random().toString(16).slice(2, 10)}`;
    while (flows.some((x) => x.id === id));
    return id;
  };
  const editFlow = (i) =>
    FlowEditor.open({
      flow: flows[i].flow || { nodes: [], edges: [] },
      agents: AGENTS,
      enabled: using(),
      customAgents: cas,
      modelSuggest: MODEL_SUGGEST,
      defaultAgent: $('sDefaultAgent').value || 'claude',
      generate: (request, flow, agent) => api.generateFlow({ request, flow, agent, enabled: using(), customAgents: cas }),
      onSave: async (flow) => {
        // 工程で選んだカスタムエージェントも一緒に保存する（この画面で追加したばかりのものを使えるように）
        const id = flows[i].id;
        const prev = flows[i].flow;
        flows[i].flow = flow;
        if (!(await saveFlows(tr('フローチャートを保存しています…')))) {
          const j = flows.findIndex((p) => p.id === id);
          if (j >= 0) flows[j].flow = prev;
          return false;
        }
        drawRelay();
        return true;
      },
    });
  // Pipeline 1つを .json に書き出す
  const exportOne = async (p) => {
    const data = PipelinePack.toBase64(new TextEncoder().encode(PipelinePack.exportPipelineJson(p)));
    const used = PipelinePack.usedCustomIds(p.flow).filter((id) => cas.some((x) => x.id === id));
    const r = await run(() => api.saveFile({ name: `${PipelinePack.safeFileName(p.name)}.pipeline`, data, ext: 'json' }));
    if (r) toast(`${tr('エクスポートしました{v1}', { v1: (used.length ? tr('（カスタムエージェントの工程があります。ほかのプロジェクトで使うときは「まとめてエクスポート」で一緒に書き出してください）') : '') })}`, 'ok');
  };
  // まとめてエクスポート: 書き出す Pipeline とカスタムエージェントを選んで zip にする
  const openBundle = (preset) => {
    const box = $('sRelayExport');
    const selP = new Set(preset ? [preset] : flows.map((p) => p.id));
    const usedBy = () => new Set(flows.filter((p) => selP.has(p.id)).flatMap((p) => PipelinePack.usedCustomIds(p.flow)));
    const selC = new Set([...usedBy()].filter((id) => cas.some((x) => x.id === id)));
    box.hidden = false;
    const draw = () => {
      const used = usedBy();
      box.innerHTML = `<h4>${tr('まとめてエクスポート（zip）')}</h4>
        <div class="field"><span>Pipeline</span><div class="check-row">${flows.map((p) => `<label class="check"><input type="checkbox" class="bxP" value="${esc(p.id)}" ${selP.has(p.id) ? 'checked' : ''} /> ${esc(p.name)}</label>`).join('')}</div></div>
        <div class="field">${tr('<span>カスタムエージェント</span>')}<div class="check-row">${cas.length ? cas.map((ca) => `<label class="check"><input type="checkbox" class="bxC" value="${esc(ca.id)}" ${selC.has(ca.id) ? 'checked' : ''} /> ${personaIcon(ca, ca.agent)}${esc(ca.name)}${used.has(ca.id) ? tr(' <span class="muted small">（工程で使用）</span>') : ''}</label>`).join('') : tr('<span class="muted small">まだありません</span>')}</div>
        ${[...used].some((id) => cas.some((x) => x.id === id) && !selC.has(id)) ? `<small class="relay-sum-err">${tr('{v1}工程で使っているカスタムエージェントを外すと、取り込んだ先でその工程のエージェントを選び直すことになります', { v1: (icon('alert')) })}</small>` : ''}</div>
        <div class="modal-actions"><button class="btn ghost small" id="bxCancel" type="button">${tr('やめる')}</button><button class="btn primary small" id="bxOk" type="button">${tr('zip でエクスポート')}</button></div>`;
      box.querySelectorAll('.bxP').forEach((cb) => (cb.onchange = () => {
        if (cb.checked) {
          selP.add(cb.value);
          // 選んだ Pipeline の工程が使うカスタムエージェントにも、チェックを付ける
          for (const id of PipelinePack.usedCustomIds((flows.find((p) => p.id === cb.value) || {}).flow)) if (cas.some((x) => x.id === id)) selC.add(id);
        } else selP.delete(cb.value);
        draw();
      }));
      box.querySelectorAll('.bxC').forEach((cb) => (cb.onchange = () => ((cb.checked ? selC.add(cb.value) : selC.delete(cb.value)), draw())));
      $('bxCancel').onclick = () => (box.hidden = true);
      $('bxOk').onclick = async () => {
        const ps = flows.filter((p) => selP.has(p.id));
        const cs = cas.filter((ca) => selC.has(ca.id));
        if (!ps.length && !cs.length) return toast(tr('エクスポートするものを選んでください'));
        const data = PipelinePack.toBase64(PipelinePack.exportBundleZip({ pipelines: ps, customAgents: cs }));
        const name = ps.length === 1 ? PipelinePack.safeFileName(ps[0].name) : 'pipelines';
        const r = await run(() => api.saveFile({ name, data, ext: 'zip' }));
        if (r) {
          box.hidden = true;
          toast(`${tr('Pipeline {v1} 個・カスタムエージェント {v2} 個をエクスポートしました', { v1: (ps.length), v2: (cs.length) })}`, 'ok');
        }
      };
    };
    draw();
  };
  // インポート: .json（Pipeline 1つ）か zip（Pipeline とカスタムエージェント）を読んで、一覧に足す
  const importFlows = async () => {
    const f = await run(() => api.openFile());
    if (!f) return;
    let parsed;
    try {
      parsed = await PipelinePack.parseImport(f.name, PipelinePack.fromBase64(f.data));
    } catch (e) {
      return toast(e.message || String(e));
    }
    let m;
    try {
      m = PipelinePack.mergeImport({ relayFlows: flows, customAgents: cas }, parsed);
    } catch (e) {
      return toast(e.message || String(e));
    }
    const lines = [`${tr('「{v1}」から取り込みます。', { v1: (f.name) })}`];
    if (m.addedPipelines.length) lines.push(`Pipeline: ${m.addedPipelines.join(tr('、'))}`);
    if (m.addedAgents.length) lines.push(`${tr('カスタムエージェント（追加）: {v1}', { v1: (m.addedAgents.join(tr('、'))) })}`);
    if (m.reusedAgents.length) lines.push(`${tr('カスタムエージェント（同じものがあるので、それを使う）: {v1}', { v1: (m.reusedAgents.join(tr('、'))) })}`);
    if (m.missing.length) lines.push(`
${tr('カスタムエージェントが見つからない工程があります（取り込んだあと、フローチャートで選び直してください）: {v1}', { v1: (m.missing.join(tr('、'))) })}`);
    if (parsed.skipped.length) lines.push(`
${tr('読めなかったファイル: {v1}', { v1: (parsed.skipped.join(tr('、'))) })}`);
    if (!m.addedPipelines.length && !m.addedAgents.length) return toast(`${tr('取り込むものはありません（同じカスタムエージェントがもうあります）')}`);
    if (!confirm(lines.join('\n'))) return;
    const before = { flows, cas };
    flows = m.relayFlows;
    cas = m.customAgents;
    if (!(await saveFlows(tr('取り込んでいます…')))) {
      flows = before.flows;
      cas = before.cas;
    }
    redrawCustom();
  };
  // Pipelineのフローの要約（工程の並びと、分岐・並列・ループの数）と、Pipeline ごとの操作
  const drawRelay = () => {
    if (isStale()) return;
    $('sRelayList').innerHTML = flows
      .map(
        (p, i) => `<div class="pl-item ${p.id === flowDefId ? 'is-default' : ''}">
          <div class="pl-head"><b>${icon('pipeline')}${esc(p.name)}</b>${p.id === flowDefId ? tr(' <span class="pl-badge">既定</span>') : ''}
            <div class="pl-acts">
              <button class="btn small" type="button" data-pl-edit="${i}">${tr('フローチャートを編集')}</button>
              <button class="btn small ghost" type="button" data-pl-rename="${i}">${tr('名前')}</button>
              <button class="btn small ghost" type="button" data-pl-copy="${i}">${tr('複製')}</button>
              ${p.id === flowDefId ? '' : `<button class="btn small ghost" type="button" data-pl-def="${i}">${tr('既定にする')}</button>`}
              <button class="btn small ghost" type="button" data-pl-export="${i}">${tr('エクスポート')}</button>
              <button class="btn small ghost" type="button" data-pl-bundle="${i}" title="${tr('この Pipeline と、工程で使うカスタムエージェントを zip にします')}">zip</button>
              ${flows.length > 1 ? `<button class="btn small danger" type="button" data-pl-del="${i}">${tr('削除')}</button>` : ''}
            </div></div>
          <div class="relay-summary">${relayFlowSummaryHtml(p.flow, using(), cas)}</div>
        </div>`,
      )
      .join('');
    const on = (attr, fn) => $('sRelayList').querySelectorAll(`[data-${attr}]`).forEach((b) => (b.onclick = () => fn(Number(b.getAttribute(`data-${attr}`)))));
    on('pl-edit', editFlow);
    on('pl-export', (i) => exportOne(flows[i]));
    on('pl-bundle', (i) => openBundle(flows[i].id));
    on('pl-rename', async (i) => {
      const v = await askName(`${tr('「{v1}」の名前を変える', { v1: (flows[i].name) })}`, flows[i].name, tr('決定'));
      if (v == null) return;
      const name = [...v].slice(0, PipelinePack.PIPELINE_NAME_MAX).join('').trim();
      if (flows.some((p, j) => j !== i && p.name === name)) return toast(`${tr('「{v1}」という名前の Pipeline はもうあります', { v1: (name) })}`);
      const prev = flows[i].name;
      flows[i].name = name;
      if (!(await saveFlows(tr('名前を変えています…')))) flows[i].name = prev;
      drawRelay();
    });
    on('pl-copy', async (i) => {
      flows.push({ id: newFlowId(), name: newFlowName(`${tr('{v1} のコピー', { v1: (flows[i].name) })}`), flow: JSON.parse(JSON.stringify(flows[i].flow)) });
      if (!(await saveFlows(tr('複製しています…')))) flows.pop();
      drawRelay();
    });
    on('pl-def', async (i) => {
      const prev = flowDefId;
      flowDefId = flows[i].id;
      if (!(await saveFlows(tr('既定の Pipeline を変えています…')))) flowDefId = prev;
      drawRelay();
    });
    on('pl-del', async (i) => {
      const p = flows[i];
      if (!confirm(`${tr('Pipeline「{v1}」を削除しますか？\n（作ってあるタスクは、そのまま動きます）', { v1: (p.name) })}`)) return;
      const before = { flows: [...flows], flowDefId };
      flows.splice(i, 1);
      if (flowDefId === p.id) flowDefId = flows[0].id;
      if (!(await saveFlows(tr('削除しています…')))) ({ flows, flowDefId } = before);
      drawRelay();
    });
  };
  $('sRelayAdd').onclick = async () => {
    const v = await askName(tr('Pipelineを追加'), newFlowName('Pipeline'), tr('追加してフローチャートを編集'));
    if (v == null) return;
    const name = [...v].slice(0, PipelinePack.PIPELINE_NAME_MAX).join('').trim();
    if (flows.some((p) => p.name === name)) return toast(`${tr('「{v1}」という名前の Pipeline はもうあります', { v1: (name) })}`);
    // 新しい Pipeline は「実装 → レビュー」から始める（既定の Pipeline の形をまねず、初めの形にする）
    flows.push({ id: newFlowId(), name, flow: null });
    if (!(await saveFlows(tr('Pipeline を追加しています…')))) flows.pop();
    drawRelay();
    const i = flows.findIndex((p) => p.name === name);
    if (i >= 0) editFlow(i);
  };
  $('sRelayImport').onclick = importFlows;
  $('sRelayBundle').onclick = () => openBundle(null);
  drawCustomList();
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
      redrawCustom();
    };
  });
  let defSkill = s.defaultSkill || null;
  const drawDef = () => renderSkillSlot('sSkill', defSkill, (v) => ((defSkill = v), drawDef()));
  drawDef();
  const sel = $('sBase');
  api.repoInfo().then(
    (info) => {
      // 読み込み中に描き直したり別の画面に変わっていたら何もしない
      if (!info || $('sBase') !== sel || state.view !== 'settings') return;
      const picked = sel.value;
      sel.innerHTML = baseOptions({ branches: info.branches || [], current: info.current || '' });
      sel.value = picked;
    },
    () => {},
  );
  // 「Issue のステータスを自動で変える」にチェックがあるときだけ、項目名と選択肢の指定を出す
  $('sIssueSync').onchange = () => ($('sStatusMap').hidden = !$('sIssueSync').checked);
  refreshGh();
  bindUpdatePanel();
  // 言語は保存ボタンを待たず、選んだら手元の設定へ書いて画面を読み直す
  if ($('sLanguage')) $('sLanguage').onchange = async () => {
    const code = $('sLanguage').value;
    if (!I18n.isLanguage(code) || code === I18n.getLanguage()) return;
    try {
      await api.setLanguage(code);
    } catch (err) {
      $('sLanguage').value = I18n.getLanguage();
      toast(err.message || String(err));
      return;
    }
    location.reload();
  };
  $('sCancel').onclick = () => {
    renderSettingsView();
    toast(tr('保存済みの値に戻しました'), 'ok');
  };
  $('sOk').onclick = async () => {
    const on = using();
    if (!on.length) return toast(tr('使うエージェントを1つ以上選んでください'));
    if (!$('sCustomForm').hidden && !confirm(tr('カスタムエージェントの編集を決定していません。編集中の内容を捨てて保存しますか？'))) return;
    const steps = flows.flatMap((p) => FlowModel.orderSteps(p.flow || { nodes: [], edges: [] }).map((st) => ({ ...st, label: flows.length > 1 ? `${p.name}: ${st.label || tr('（名前なし）')}` : st.label })));
    const lostStep = steps.find((st) => stepWho(st, cas).missing);
    if (lostStep && orch() === 'relay' && !confirm(`${tr('Pipelineの工程「{v1}」のカスタムエージェントがありません。このままだとPipelineを始められません。保存しますか？', { v1: (lostStep.label || tr('（名前なし）')) })}`)) return;
    const offStep = steps.find((st) => !on.includes(stepWho(st, cas).agent));
    if (offStep && orch() === 'relay' && !confirm(`${tr('Pipelineの工程「{v1}」の {v2} は使わない設定です。このままだとPipelineを始められません。保存しますか？', { v1: (offStep.label || tr('（名前なし）')), v2: (agentLabel(stepWho(offStep, cas).agent)) })}`)) return;
    const r = await runBusy(tr('設定を保存しています…'), () =>
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
        // 使わない設定にしたエージェントの競争の選択は覚えておく（また使う設定にしたら戻る）
        competeAgents: [...new Set([...[...document.querySelectorAll('.sCompete:checked')].map((x) => x.value), ...[...competeSel].filter((a) => !on.includes(a))])],
        customAgents: cas,
        // 元の CLI を使わない設定にしたカスタムエージェントの競争の選択も覚えておく
        competeCustomAgents: [...new Set([...[...document.querySelectorAll('.sCompeteCustom:checked')].map((x) => x.value), ...[...competeCustomSel].filter((id) => { const ca = cas.find((x) => x.id === id); return ca && !on.includes(ca.agent); })])],
        defaultSkill: defSkill || '',
        issueStatusSync: $('sIssueSync').checked,
        suggestSkillsOnDone: $('sSuggestSkills').checked,
        deleteSessionsOnMerge: $('sDeleteSessions').checked,
        specCheck: $('sSpecCheck').checked,
        subtaskMerge: $('sSubtaskMerge').value,
        statusFieldName: $('sStatusField').value.trim(),
        statusMapping: { inProgress: $('sMapProgress').value.trim(), inReview: $('sMapReview').value.trim(), done: $('sMapDone').value.trim() },
      }),
    );
    if (r) {
      // 画面に残るので、保存した値（サーバー側で整えた値も含む）で描き直す。ボードの更新を待たずに反映する
      Object.assign(state.board.settings, r);
      renderSettingsView();
      toast(tr('保存しました'), 'ok');
      checkEnv();
    }
  };
  // 一覧を描いて高さが決まってから戻す
  $('settingsMain').scrollTop = scrollTop;
  settingsNav.sync();
}

async function pickRepo(opts) {
  // 遠隔操作中はホストの画面にダイアログが出てしまうので、ホストのフォルダをこの画面で辿って選ぶ
  if (repoTargetHost()) return hostFolderModal(opts || {});
  const r = await run(() => api.chooseRepo({ ...(opts || {}), ...targetOpts(), tab: state.repoOpenMode }));
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
  const onHost = !remoteClient() || repoTargetHost();
  const mine = sideTabs(remoteClient() ? onHost : false);
  if (dir && mine.some((t) => t.active && t.path === dir)) {
    closeModal();
    return;
  }
  const inTab = mine.some((t) => t.path === dir);
  const r = await run(() => api.openRepo(dir, { ...targetOpts(), tab: state.repoOpenMode }));
  if (r) {
    closeModal();
    closeDetail();
    state.board = await api.getBoard();
    renderBoard();
    toast(inTab ? tr('{name} のタブに切り替えました', { name: repoFolderName(r) }) : tr('{name} を開きました', { name: repoFolderName(r) }), 'ok');
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
  const rc = remoteClient();
  // 遠隔操作中は、ホストのフォルダか、このマシンのフォルダかを選べる（既定は見ているタブの側）
  if (opts && (opts.target === 'host' || opts.target === 'local')) state.repoTarget = opts.target;
  else if (opts && opts.tab) state.repoTarget = viewingHost() ? 'host' : 'local';
  if (state.repoTarget !== 'local') state.repoTarget = 'host';
  const onHost = repoTargetHost();
  const distros = (await api.wslDistros(targetOpts()).catch(() => [])) || [];
  // 選んだ側のタブ（今開いているタブを置き換えるのは、見ている側と同じ側のときだけ）
  const tabs = rc ? sideTabs(onHost) : repoTabsList();
  const activeTab = tabs.find((t) => t.active);
  const current = activeTab ? activeTab.path : '';
  const tabbed = new Set(tabs.map((t) => t.path));
  const asNew = state.repoOpenMode === 'new' && tabs.length < MAX_REPO_TABS;
  const tabNote = !current
    ? ''
    : asNew
      ? `<p class="muted small">${tr('選んだリポジトリを新しいタブで開きます（タブは {n} つまで）。', { n: MAX_REPO_TABS })}</p>`
      : `<p class="muted small">${tr('選んだリポジトリで、今のタブ（{name}）を置き換えます。', { name: esc(repoFolderName(current)) })}${tabs.length < MAX_REPO_TABS ? tr('残しておきたいときは、タブの右の「＋」から開いてください。') : ''}</p>`;
  const bySide = state.board.recentBySide;
  const recent = ((rc && bySide ? bySide[onHost ? 'host' : 'local'] : state.board.settings.recentRepoPaths) || []).filter((p) => p);
  const host = rc ? remoteHostLabel(rc) : '';
  const recentHtml = recent.length
    ? `<p class="repo-section-label">${rc ? (onHost ? tr('ホスト（{host}）で最近開いたリポジトリ', { host: esc(host) }) : tr('このマシンで最近開いたリポジトリ')) : tr('最近開いたリポジトリ')}</p>
       <div class="repo-choices">
         ${recent
           .map((p) => {
             const on = p === current;
             const tag = on ? ` <span class="repo-current-tag">${tr('開いています')}</span>` : tabbed.has(p) ? ` <span class="repo-current-tag">${tr('タブにあります')}</span>` : '';
             return `<button class="btn repo-choice${on ? ' current' : ''}" data-recent="${esc(p)}" ${on ? 'disabled' : ''}>${icon('folder')}<b>${esc(repoFolderName(p))}${tag}</b><small>${esc(p)}</small></button>`;
           })
           .join('')}
       </div>
       <p class="repo-section-label">${tr('または新しく開く')}</p>`
    : '';
  openModal(
    `<h2>${rc ? (onHost ? tr('ホストのリポジトリを選ぶ') : tr('このマシンのリポジトリを選ぶ')) : tr('リポジトリを選ぶ')}</h2>
     ${
       rc
         ? `<div class="mtabs repo-target-tabs" role="tablist">
             <button class="mtab${onHost ? ' active' : ''}" type="button" data-repo-target="host">${icon('monitor')}${tr('ホスト（{host}）', { host: esc(host) })}</button>
             <button class="mtab${onHost ? '' : ' active'}" type="button" data-repo-target="local">${icon('folder')}${tr('このマシン')}</button>
           </div>
           <p class="muted small">${
             onHost
               ? tr('接続先（{host}）のフォルダを選びます。エージェントはホストのそのフォルダで動きます。', { host: esc(host) })
               : tr('このマシンのフォルダを選びます。エージェントはこのマシンで、ホストのタスクと並んで動きます。このマシンのタブはホストには表示されません。')
           }</p>`
         : ''
     }
     ${tabNote}
     ${distros.length ? `<p class="muted small">${tr('選んだフォルダが WSL の中なら、git とエージェント（claude / codex / gemini / cursor-agent）も WSL の中で動かします（WSL の中にも git と使うエージェントが必要です）。')}</p>` : ''}
     ${recentHtml}
     <div class="repo-choices">
       ${
         onHost
           ? `<button class="btn repo-choice" data-pick="">${icon('monitor')}<b>${tr('ホストのフォルダを開く')}</b><small>${tr('{host} のフォルダを、この画面で辿って選びます', { host: esc(host) })}</small></button>`
           : `<button class="btn repo-choice" data-pick="">${icon(distros.length ? 'monitor' : 'folder')}<b>${distros.length ? tr('このパソコンのフォルダを開く') : tr('手元のフォルダを開く')}</b><small>${distros.length ? tr('C:\\Users\\… など') : tr('git リポジトリ、または git で管理していないフォルダ')}</small></button>`
       }
       ${distros.map((d) => `<button class="btn repo-choice" data-pick="${esc(d)}">${icon('terminal')}<b>${tr('{name} のフォルダを開く', { name: esc(d) })}</b><small>${tr('\\\\wsl.localhost\\{name}\\home\\… から開きます', { name: esc(d) })}</small></button>`).join('')}
       <button class="btn repo-choice" id="rpClone">${icon('download')}<b>${tr('URL からクローンする')}</b><small>${tr('https://github.com/owner/repo・git@github.com:owner/repo.git・owner/repo')}</small></button>
       <button class="btn repo-choice" id="rpCreate">${icon('folderPlus')}<b>${tr('新しく作る')}</b><small>${tr('空のリポジトリ（GitHub にも作れます）か、git で管理しないフォルダを作ります')}</small></button>
     </div>
     <div class="modal-actions"><button class="btn ghost" id="rpCancel">${tr('キャンセル')}</button></div>`,
    () => {
      $('rpCancel').onclick = closeModal;
      $('modalBox').querySelectorAll('[data-repo-target]').forEach((b) =>
        b.addEventListener('click', () => {
          if (b.dataset.repoTarget === state.repoTarget) return;
          // 側を変えたら、その側の新しいタブで開く（空きがなければ今のタブを置き換える）
          chooseRepo({ target: b.dataset.repoTarget, tab: 'new' });
        }),
      );
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
async function mountDirBrowser(el, { start = '', wsl = '', pickLabel = tr('このフォルダを選ぶ'), onPick, onOpenRepo } = {}) {
  const st = { hidden: false, listing: null, seq: 0 };
  const load = async (dir, { first = false } = {}) => {
    const seq = ++st.seq;
    el.querySelector('.db-list')?.classList.add('loading');
    let r;
    try {
      r = await api.browseDirs({ ...targetOpts(), path: dir || '', wsl: first && !dir ? wsl : '', showHidden: st.hidden });
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
      <div class="input-row"><input class="mono db-path" spellcheck="false" autocomplete="off" value="${esc(r.path)}" title="${esc(tr('パスを入れて Enter で移動します'))}" /><button class="btn db-go">${tr('移動')}</button></div>
      <div class="db-tools">
        <button class="btn ghost small db-up" ${r.parent ? '' : 'disabled'}>${tr('↑ 上のフォルダ')}</button>
        <button class="btn ghost small db-home">${tr('ホーム')}</button>
        <label class="db-hidden"><input type="checkbox" ${st.hidden ? 'checked' : ''} />${tr(' 隠しフォルダも出す')}</label>
        ${r.repo ? `<span class="db-repo-tag">${tr('git リポジトリ')}</span>` : ''}
      </div>
      <div class="db-list">
        ${
          r.dirs.length
            ? r.dirs
                .map(
                  (d) => `<div class="db-row${d.repo ? ' repo' : ''}"><button class="db-dir" data-dir="${esc(d.path)}">${icon(d.repo ? 'branch' : 'folder')}<span>${esc(d.name)}</span></button>${d.repo && onOpenRepo ? `<button class="btn small db-open" data-open="${esc(d.path)}">${tr('開く')}</button>` : ''}</div>`,
                )
                .join('')
            : `<p class="muted small db-empty">${tr('この中にフォルダはありません')}</p>`
        }
        ${r.truncated ? `<p class="muted small db-empty">${tr('フォルダが多いので、先頭の分だけ出しています。パスを入れて移動してください')}</p>` : ''}
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
  el.innerHTML = `<p class="muted small">${tr('ホストのフォルダを読み込んでいます…')}</p>`;
  await load(start, { first: true });
}

// 遠隔操作中に、ホストのフォルダを辿って git リポジトリを開く画面
function hostFolderModal(opts = {}) {
  const host = remoteHostLabel();
  openModal(
    `<h2>${tr('ホストのフォルダを開く')}</h2>
     <p class="muted small">${tr('接続先（{host}）のフォルダです。開きたいフォルダまで移動して「このフォルダを開く」を押すか、一覧の git リポジトリの「開く」を押します。git で管理していないフォルダも開けます（worktree を作らず、そのフォルダでタスクを動かします）。', { host: esc(host) })}</p>
     <div id="hfBrowser"></div>
     <div class="modal-actions"><button class="btn ghost" id="hfBack">${tr('戻る')}</button></div>`,
    () => {
      $('hfBack').onclick = () => chooseRepo();
      mountDirBrowser($('hfBrowser'), {
        start: '',
        wsl: opts.wsl || '',
        pickLabel: tr('このフォルダを開く'),
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
    `<h2>${clone ? tr('URL からクローンする') : tr('新しく作る')}</h2>
     ${clone ? `<label class="field"><span>${tr('リポジトリの URL')}</span><input id="rsUrl" class="mono" placeholder="${esc(tr('https://github.com/owner/repo または owner/repo'))}" autocomplete="off" spellcheck="false" /></label>` : ''}
     ${distros.length ? `<label class="field"><span>${tr('作る場所')}</span><select id="rsWhere"><option value="">${tr('このパソコン')}</option>${distros.map((d) => `<option value="${esc(d)}">${esc(tr('{name}（WSL）', { name: d }))}</option>`).join('')}</select></label>` : ''}
     <label class="field"><span>${tr('置き場所（この中にフォルダを作ります）')}</span>
       <div class="input-row"><input id="rsParent" class="mono" spellcheck="false" /><button class="btn" id="rsBrowse">${tr('選ぶ…')}</button></div></label>
     <div id="rsHostBrowser" class="dir-browser-inline hidden"></div>
     <label class="field"><span>${clone ? tr('フォルダ名（空なら URL から決めます）') : tr('フォルダ名')}</span><input id="rsName" class="mono" spellcheck="false" autocomplete="off" placeholder="${clone ? 'repo' : esc(tr('例: my-app'))}" /></label>
     ${clone ? '' : `<label class="field"><span>${tr('ソース管理')}</span><select id="rsGit"><option value="git">${tr('git で管理する（タスクごとに worktree で作業し、マージ・PR で取り込む）')}</option><option value="none">${tr('git で管理しない（フォルダだけ作る。動画づくりなど、コード以外の作業に）')}</option></select><small>${tr('git で管理しないフォルダでは、タスクはそのフォルダの中で直接動きます。差分・worktree・マージ・PR は使えず、終わったら「完了にする」で完了にします')}</small></label>`}
     ${clone ? '' : `<label class="field" id="rsGhWrap"><span>GitHub</span><select id="rsGh"><option value="">${tr('作らない（手元だけ）')}</option><option value="private">${tr('GitHub にも作る（非公開）')}</option><option value="public">${tr('GitHub にも作る（公開）')}</option></select><small>${tr('GitHub にも作るときは、gh（GitHub CLI）にログインしている必要があります')}</small></label>`}
     <p class="muted small" id="rsPreview"></p>
     <div class="modal-actions"><button class="btn ghost" id="rsBack">${tr('戻る')}</button><button class="btn primary" id="rsOk">${clone ? tr('クローンして開く') : tr('作って開く')}</button></div>`,
    async () => {
      const where = () => ($('rsWhere') ? $('rsWhere').value : '');
      const sep = () => (where() || /^[A-Za-z]:\\|^\\\\/.test($('rsParent').value) ? '\\' : '/');
      const name = () => $('rsName').value.trim() || (clone ? repoNameFromUrl($('rsUrl').value) : '');
      let nameTouched = false;
      const noGit = () => !!$('rsGit') && $('rsGit').value === 'none';
      // WSL のフォルダと、git で管理しないフォルダでは GitHub に作れない
      const syncGh = () => {
        if ($('rsGhWrap')) $('rsGhWrap').hidden = !!where() || noGit();
        if (!clone) $('rsOk').textContent = noGit() ? tr('フォルダを作って開く') : tr('作って開く');
      };
      const preview = () => {
        const p = $('rsParent').value.trim().replace(/[\\/]+$/, '');
        $('rsPreview').textContent = p && name() ? tr('作るフォルダ: {path}', { path: `${p}${sep()}${name()}` }) : '';
      };
      const loadParent = async () => {
        $('rsParent').value = (await api.repoDefaultParent({ ...targetOpts(), ...(where() ? { wsl: where() } : {}) }).catch(() => '')) || '';
        syncGh();
        preview();
      };
      $('rsBack').onclick = () => chooseRepo();
      $('rsBrowse').onclick = async () => {
        // 遠隔操作中は、ホストのフォルダをこの画面で辿って選ぶ
        if (repoTargetHost()) {
          const box = $('rsHostBrowser');
          if (!box.classList.contains('hidden')) return box.classList.add('hidden');
          box.classList.remove('hidden');
          mountDirBrowser(box, {
            start: $('rsParent').value.trim(),
            wsl: where(),
            pickLabel: tr('ここを置き場所にする'),
            onPick: (dir) => {
              $('rsParent').value = dir;
              box.classList.add('hidden');
              preview();
            },
          });
          return;
        }
        const p = await run(() => api.chooseRepoParent({ ...targetOpts(), defaultPath: $('rsParent').value.trim() || undefined }));
        if (p) $('rsParent').value = p;
        preview();
      };
      if ($('rsWhere')) $('rsWhere').onchange = loadParent;
      if ($('rsGit')) $('rsGit').onchange = syncGh;
      $('rsParent').oninput = preview;
      $('rsName').oninput = () => ((nameTouched = !!$('rsName').value.trim()), preview());
      if (clone) $('rsUrl').oninput = () => (nameTouched || ($('rsName').placeholder = repoNameFromUrl($('rsUrl').value) || 'repo'), preview());
      $('rsOk').onclick = async () => {
        const parent = $('rsParent').value.trim();
        const r = clone
          ? await runBusy(tr('クローンしています…（大きいリポジトリは時間がかかります）'), () => api.cloneRepo({ ...targetOpts(), url: $('rsUrl').value.trim(), parent, name: $('rsName').value.trim(), tab: state.repoOpenMode }))
          : await runBusy(noGit() ? tr('フォルダを作っています…') : tr('リポジトリを作っています…'), () => api.createRepo({ ...targetOpts(), parent, name: $('rsName').value.trim(), github: where() || noGit() ? '' : $('rsGh').value, git: !noGit(), tab: state.repoOpenMode }));
        if (!r) return;
        closeModal();
        closeDetail();
        if (r.warning) toast(r.warning);
        else toast(clone ? tr('クローンしました') : r.git === false ? tr('git で管理しないフォルダを作りました') : r.github ? tr('リポジトリを作り、GitHub にも push しました') : tr('リポジトリを作りました'), 'ok');
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
$('detailBackdrop').addEventListener('mousedown', closeDetailOrBack);
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
  // 設定画面の上に Issue のダイアログを開くと gh の欄が2つになるので、手前のダイアログのほうを描く
  const el = document.querySelector('#modal:not(.hidden) #ghPanel') || $('ghPanel');
  if (!el) return;
  const part = (id) => el.querySelector(`#${id}`);
  const log = ghState.lines.length ? `<pre class="gh-log">${esc(ghState.lines.slice(-8).join('\n'))}</pre>` : '';
  if (ghState.busy && ghState.code) {
    el.className = 'gh-panel gh-warn';
    el.innerHTML = `${tr('<b>ブラウザで GitHub にログインしてください</b>')}
      <p>${tr('開いたページに、次のコードを入力します。')}</p>
      <div class="gh-code"><code>${esc(ghState.code.code)}</code><button class="btn small" id="ghCopy">${tr('コピー')}</button><button class="btn small ghost" id="ghOpen">${tr('ページを開く')}</button></div>
      <p class="muted small">${tr('ログインが終わると、自動でこの画面に戻ります。')}</p>${log}
      <button class="btn small ghost" id="ghCancel">${tr('やめる')}</button>`;
    part('ghCopy').onclick = () => navigator.clipboard.writeText(ghState.code.code).then(() => toast(tr('コピーしました'), 'ok'));
    part('ghOpen').onclick = () => run(() => api.openExternal(ghState.code.url));
    part('ghCancel').onclick = () => api.ghCancel();
    return;
  }
  if (ghState.busy) {
    el.className = 'gh-panel';
    el.innerHTML = `${tr('<b>処理しています…</b>{v1}', { v1: (log) })}`;
    return;
  }
  if (!st) {
    el.className = 'gh-panel';
    el.textContent = tr('gh の状態を確認できませんでした');
    return;
  }
  if (!st.installed) {
    el.className = 'gh-panel gh-warn';
    el.innerHTML = `${tr('<b>gh（GitHub CLI）が入っていません</b>')}
      <p>${tr('Issue を読み込むのに使います（private リポジトリの Issue も読めるようになります）。')}</p>
      ${st.installer
        ? `<button class="btn primary small" id="ghInstall">${tr('gh をインストールする')}</button> ${tr('<span class="muted small">{v1} で <code>{v2}</code> を実行します</span>', { v1: (esc(st.installer)), v2: (esc(st.installLabel)) })}`
        : `<button class="btn primary small" id="ghDownload">${tr('ダウンロードページを開く')}</button> ${tr('<span class="muted small">インストールしたら「もう一度確認」を押してください</span>')}`}
      <div><button class="btn small ghost" id="ghRecheck">${tr('もう一度確認')}</button></div>${log}
      <p class="muted small">${tr('public リポジトリなら、gh がなくても読み込めます。')}</p>`;
    if (part('ghInstall')) part('ghInstall').onclick = () => ghAction('install');
    if (part('ghDownload')) part('ghDownload').onclick = () => run(() => api.openExternal(st.downloadUrl));
    part('ghRecheck').onclick = refreshGh;
    return;
  }
  if (!st.loggedIn) {
    el.className = 'gh-panel gh-warn';
    el.innerHTML = `${tr('<b>gh は入っていますが、GitHub にログインしていません</b>')}
      <p><button class="btn primary small" id="ghLogin">${tr('GitHub にログイン')}</button> ${tr('<span class="muted small">ブラウザが開くので、表示されたコードを入力します</span>')}</p>
      <div><button class="btn small ghost" id="ghRecheck">${tr('もう一度確認')}</button></div>${log}`;
    part('ghLogin').onclick = () => ghAction('login');
    part('ghRecheck').onclick = refreshGh;
    return;
  }
  if (st.hasProjectScope === false && state.board.settings.issueStatusSync !== false) {
    el.className = 'gh-panel gh-warn';
    el.innerHTML = `${tr('<span>{v1}gh で GitHub にログインしています{v2}</span>', { v1: (icon('check')), v2: (st.user ? tr('（<b>{v1}</b>）', { v1: (esc(st.user)) }) : '') })}
      <p>${tr('Issue のステータス（GitHub Projects の In progress / In review / Done）を自動で変えるには、project の権限が必要です。')}</p>
      <p><button class="btn primary small" id="ghScope">${tr('Projects の権限を追加')}</button> ${tr('<span class="muted small">ブラウザが開くので、表示されたコードを入力します</span>')}</p>
      <div><button class="btn small ghost" id="ghRecheck">${tr('もう一度確認')}</button></div>${log}`;
    part('ghScope').onclick = () => ghAction('scope');
    part('ghRecheck').onclick = refreshGh;
    return;
  }
  el.className = 'gh-panel ok';
  el.innerHTML = `${tr('<span>{v1}gh で GitHub にログインしています{v2}</span>', { v1: (icon('check')), v2: (st.user ? tr('（<b>{v1}</b>）', { v1: (esc(st.user)) }) : '') })}`;
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
    toast(kind === 'install' ? tr('gh をインストールしました') : kind === 'scope' ? tr('project の権限を追加しました') : tr('GitHub にログインしました'), 'ok');
    renderGh(st);
    // インストールが終わったら、続けてログインも案内する
    if (kind === 'install' && st && st.installed && !st.loggedIn) toast(tr('続けて「GitHub にログイン」を押してください'), 'ok');
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
  if (s < 60) return tr('たった今');
  if (s < 3600) return tr('{n}分前', { n: Math.floor(s / 60) });
  if (s < 86400) return tr('{n}時間前', { n: Math.floor(s / 3600) });
  return new Date(t).toLocaleString(typeof I18n !== 'undefined' ? I18n.locale() : undefined);
}

function notifItemHtml(n) {
  const alive = !!card(n.cardId);
  const action =
    n.action && !n.actedAt && alive
      ? `<button class="btn small primary" data-nact="${esc(n.id)}">${esc(n.actionLabel || tr('実行'))}</button>`
      : n.action && n.actedAt ? `<span class="muted small">${tr('対応済み')}</span>` : '';
  return `<div class="notif-item ${n.read ? '' : 'unread'} k-${esc(n.kind)}" data-nid="${esc(n.id)}" data-card="${alive ? esc(n.cardId) : ''}">
    <span class="notif-icon">${icon(NOTIF_ICON[n.kind] || 'bell')}</span>
    <div class="notif-main">
      <div class="notif-title">${esc(n.title)}</div>
      ${n.body ? `<div class="notif-body">${esc(plainText(n.body))}</div>` : ''}
      <div class="notif-foot"><span class="muted small">${timeAgo(n.t)}</span>${action}</div>
    </div>
    <button class="icon notif-x" data-nclear="${esc(n.id)}" title="${esc(tr('この通知を消す'))}">✕</button>
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
    <div class="notif-head"><b>${tr('通知')}</b><span class="spacer"></span>
      ${unread ? `<button class="btn small ghost" data-nall="read">${tr('すべて既読')}</button>` : ''}
      ${list.length ? `<button class="btn small ghost" data-nall="clear">${tr('すべて消す')}</button>` : ''}
    </div>
    <div class="notif-list">${list.length ? list.map(notifItemHtml).join('') : `<p class="muted pad">${tr('通知はまだありません')}</p>`}</div>`;
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
    const r = await runBusy(tr('スキルの提案を頼んでいます…'), () => api.actNotification(act.dataset.nact).then((v) => v || {}), tr('スキルの提案を新しい会話で頼みました。返事が来たら、下の欄から追加したいものを伝えてください'));
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
  } else if (item && item.classList.contains('k-schedule')) {
    // カードを作れなかったスケジュールの失敗: 開くカードがないので、スケジューラ画面で確かめてもらう
    run(() => api.readNotifications([item.dataset.nid]));
    closeNotifications();
    setView('scheduler');
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
  markSeenIfOpen();
  if (state.selected) {
    renderDetailHead();
    const c = card(state.selected);
    if (c) {
      updateBtwTab(c);
      // サブタスクがなくなって、今のタブが消えたら開き直す
      const tabBefore = state.tab;
      updateTabsFor(c);
      if (state.tab !== tabBefore) renderDetailBody();
      drawLogActions(c);
      // 実行が終わった・マージしたなど状態が変わったら worktree タブを読み直す
      if (state.tab === 'worktree' && state.wtStatus !== `${c.id}:${c.status}:${c.worktreePath || ''}`) {
        if (state.wtStatus) renderWorktree(c, { quiet: true });
      }
      state.wtStatus = `${c.id}:${c.status}:${c.worktreePath || ''}`;
      if (state.tab === 'progress' || state.tab === 'subtasks') scheduleProgress();
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
// Markdown の中のリンク（ログ・チャット・モーダル）はデフォルトブラウザで開く。開いてよい URL かは main.js が確かめる
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('.md-link');
  if (!a) return;
  e.preventDefault();
  run(() => api.openExternal(a.dataset.url));
});
// コードブロックの右上の「コピー」。ログは後から足されて増えるので、document でまとめて受ける
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.md-copy');
  if (!b) return;
  const code = b.parentElement.querySelector('pre.md-code code');
  navigator.clipboard.writeText(code ? code.textContent : '').then(
    () => {
      b.textContent = tr('コピーしました');
      b.classList.add('copied');
      clearTimeout(b._copiedTimer);
      b._copiedTimer = setTimeout(() => {
        b.textContent = tr('コピー');
        b.classList.remove('copied');
      }, 1500);
    },
    () => toast(tr('コピーできませんでした')),
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
  } else if (state.selected === id && state.tab === 'chat') {
    const c = card(id);
    if (c) updateChatTab(c);
  } else if (state.selected === id && state.tab === 'progress') scheduleProgress();
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
    if (!env.git) msgs.push(tr('{v1}（WSL）の中に git が見つかりません。{v1} のターミナルで sudo apt install git を実行してください。', { v1: env.wsl }));
    for (const a of on) if (!has(a)) msgs.push(tr('{v1}（WSL）の中に {v2} が見つかりません。{v1} のターミナルで {v3} をインストールしてログインしてください（このリポジトリのタスクは {v1} の中で動きます）。', { v1: env.wsl, v2: a, v3: agentLabel(a) }));
  } else {
    if (!env.git) {
      const gitMsg = env.platform === 'win32'
        ? tr('git が見つかりません。Git for Windows（https://git-scm.com/）をインストールしてから、アプリを再起動してください。')
        : env.platform === 'darwin'
          ? tr('git が見つかりません。ターミナルで xcode-select --install を実行するか Homebrew で git をインストールしてから、アプリを再起動してください。')
          : tr('git が見つかりません。git をインストールしてから、アプリを再起動してください。');
      msgs.push(gitMsg);
    }
    for (const a of on) if (!has(a)) msgs.push(tr('{v1} コマンドが見つかりません。{v2} をインストールしてログインするか、「設定」で {v1} のフルパスを指定してください（ターミナルで which {v1}、Windows なら where {v1} で調べられます）。使わないなら、「設定」の「使うエージェント」でチェックを外してください。', { v1: a, v2: agentLabel(a) }));
  }
  const el = $('envBanner');
  el.innerHTML = msgs.map((m) => `<div>${icon('alert')}${esc(m)}</div>`).join('');
  el.classList.toggle('hidden', msgs.length === 0);
}

// ---- アプリの更新 ----
// 設定の「アプリの更新」の中身（状態は main の update:status / update:changed）
function updatePanelHtml(u) {
  if (!u) return tr('<p class="muted">新しい版を確かめています…</p>');
  const cur = `${tr('今の版: <b>v{v1}</b>', { v1: (esc(u.currentVersion)) })}`;
  if (!u.supported) return `<p>${cur}</p><p class="muted">${esc(u.reason)}</p>`;
  const checked = u.checkedAt ? `${tr('（{v1} に確かめました）', { v1: (esc(new Date(u.checkedAt).toLocaleString(I18n.locale()))) })}` : '';
  let msg;
  let actions = '';
  if (u.quitting || u.state === 'installing') msg = `<p>${tr('v{v1} に更新しています。アプリを終了して入れ替え、起動し直します…', { v1: (esc(u.latestVersion)) })}</p>`;
  else if (u.state === 'checking') msg = tr('<p class="muted">新しい版を確かめています…</p>');
  else if (u.state === 'available') {
    msg = `<p>${tr('<b>新しい版 v{v1} があります。</b> <a href="#" id="updNotes">変更点を見る</a>', { v1: (esc(u.latestVersion)) })}</p>`;
    actions = `<button class="btn primary small" id="updInstall" type="button">${tr('新しいバージョンに更新')}</button>`;
  } else if (u.state === 'preparing') msg = `<p>${tr('新しい版 v{v1} を準備中です（この OS 向けのファイルがまだそろっていません）。しばらくしてからもう一度確かめてください。', { v1: (esc(u.latestVersion)) })}</p>`;
  else if (u.state === 'latest') msg = `<p class="muted">${tr('最新の版です{v1}', { v1: (checked) })}</p>`;
  else if (u.state === 'error') msg = `<p class="upd-warn">${esc(u.error)}</p>`;
  else msg = '';
  const busy = u.quitting || u.state === 'installing' || u.state === 'checking';
  if (state.updateFailedLog) msg += tr('<p class="upd-warn">前回の更新はできませんでした。<a href="#" id="updLog">更新の記録を開く</a></p>');
  return `<p>${cur}</p>${msg}
    <div class="upd-actions">${actions}<button class="btn small" id="updCheck" type="button" ${busy ? 'disabled' : ''}>${tr('新しい版を確かめる')}</button></div>
    <label class="check"><input type="checkbox" id="updAuto" ${u.autoUpdate ? 'checked' : ''} /> ${tr('新しい版が出たら自動で更新する')}</label>
    <small>${tr('アプリは起動したときと6時間ごとに新しい版を確かめます。自動で更新するときは、実行中・待機中のタスクがなくなるのを待ってから、アプリを終了して入れ替え、起動し直します。更新すると、手で入れたときと同じ場所（{v1}）に入ります。', { v1: (u.platform === 'win32' ? '%LOCALAPPDATA%\\Programs\\Worktree Kanban' : tr('/Applications または ~/.local/bin')) })}</small>`;
}

function bindUpdatePanel() {
  const el = $('updPanel');
  if (!el) return;
  el.innerHTML = updatePanelHtml(state.update);
  const u = state.update;
  if ($('updCheck')) $('updCheck').onclick = () => run(async () => setUpdate(await api.checkUpdate()));
  if ($('updAuto')) $('updAuto').onchange = () => run(async () => setUpdate(await api.setAutoUpdate($('updAuto').checked)), $('updAuto').checked ? tr('新しい版が出たら自動で更新します') : tr('自動で更新しないようにしました'));
  if ($('updNotes')) $('updNotes').onclick = (e) => {
    e.preventDefault();
    run(() => api.openExternal(u.releaseUrl));
  };
  if ($('updInstall')) $('updInstall').onclick = () => installUpdate();
  if ($('updLog')) $('updLog').onclick = (e) => {
    e.preventDefault();
    run(() => api.openUpdateLog());
  };
}

async function installUpdate() {
  const u = await run(() => api.updateStatus());
  if (!u) return;
  const { running = 0, queued = 0 } = u.active || {};
  const tasks = running || queued ? `

${tr('{v1}のタスクは中断します（それまでの変更はタスクのブランチにコミットし、起動し直したあとに「再開」で続けられます）。', { v1: ([running && `${tr('実行中 {v1} 件', { v1: (running) })}`, queued && `${tr('待機中 {v1} 件', { v1: (queued) })}`].filter(Boolean).join(tr('・'))) })}` : '';
  if (!confirm(`${tr('v{v1} に更新します。アプリを終了して新しい版に入れ替え、起動し直します（1分ほどかかります）。{v2}\n\n更新しますか？', { v1: (u.latestVersion), v2: (tasks) })}`)) return;
  const r = await run(() => api.installUpdate());
  if (r) setUpdate(r);
}

function setUpdate(u) {
  if (!u) return;
  state.update = u;
  if ($('updPanel')) bindUpdatePanel();
  // 左上の版の横に、新しい版があることを出す（押すと設定を開く）
  const badge = $('updateBadge');
  if (badge) {
    const on = u.supported && (u.state === 'available' || u.state === 'installing' || u.quitting);
    badge.classList.toggle('hidden', !on);
    badge.textContent = u.state === 'installing' || u.quitting ? tr('更新しています…') : `${tr('v{v1} に更新できます', { v1: (u.latestVersion) })}`;
  }
}

I18n.localizeDom(document);
api.updateStatus().then((u) => {
  setUpdate(u);
  // 前の起動で更新したときの結果を一度だけ知らせる
  const r = u.lastResult;
  if (!r) return;
  if (r.ok) toast(`${tr('v{v1} に更新しました', { v1: (r.to) })}`, 'ok');
  else toast(`${tr('v{v1} に更新できませんでした（v{v2} のままです）。詳しくは設定の「アプリの更新」から記録を開いて確かめてください', { v1: (r.to), v2: (u.currentVersion) })}`);
  api.dismissUpdateResult().catch(() => {});
  if (!r.ok) state.updateFailedLog = true;
}, () => {});
api.onUpdate(setUpdate);
$('updateBadge')?.addEventListener('click', () => openSettings('update'));

// 左上に、いま動いているアプリのバージョンを出す
api.appInfo().then(
  (i) => {
    $('appVersion').textContent = `v${i.version}${i.packaged ? '' : tr('（開発版）')}`;
    $('appVersion').title = `Worktree Kanban v${i.version}`;
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

// 詳細パネルの上の2行（タイトル・ボタン）は高さを固定し、下の段（追加の指示）は境目をドラッグして高さを変えられる。
// 下の段は「ログ・worktree などのタブ」の高さより低くはできず、中のタブの中身もタブの高さより潰さない。高さは保存し、ダブルクリックで元に戻す
(function setupDetailSplit() {
  const panel = $('detail');
  const head = $('detailHead');
  const foot = $('detailFoot');
  const tabs = $('tabs');
  const body = $('detailBody');
  const title = $('detailTitle');
  const input = $('followInput');
  const KEY = 'detailFootHeight';
  localStorage.removeItem('detailHeadHeight'); // 上の段の高さは固定にしたので、前に保存した高さは使わない
  // pref: ユーザーが決めた（保存した）高さ / h: いま実際に使っている高さ（入りきらないときは pref より縮める）
  let pref = Number(localStorage.getItem(KEY)) || 0;
  let h = pref;
  const minH = () => Math.max(24, tabs.offsetHeight);
  // 下の段の入力欄は、いちばん上のタイトルと同じ高さより低くしない
  const syncInputMin = () => {
    input.style.minHeight = title.offsetHeight > 0 ? `${title.offsetHeight}px` : '';
  };
  // 下の段の最小の高さ: 入力欄がタイトルの高さを保てるだけの高さ（タブの高さより低くはしない）
  // （段の中身がはみ出しているときも正しく測れるように、scrollHeight で中身の高さを見る）
  const footMin = () => {
    const chrome = foot.offsetHeight - foot.clientHeight + foot.scrollHeight - input.offsetHeight;
    return Math.max(minH(), chrome + title.offsetHeight);
  };
  // 中のタブの中身と下の段で分け合える高さ
  const avail = () => panel.clientHeight - tabs.offsetHeight - title.offsetHeight - head.offsetHeight;
  const apply = () => {
    foot.classList.toggle('sized', h > 0);
    foot.style.height = h > 0 ? `${Math.round(h)}px` : '';
  };
  const clamp = (v) => Math.max(footMin(), Math.min(v, avail() - minH()));
  // パネルの高さが変わったら（ウィンドウの大きさ・モーダルとの切り替え）、はみ出さないように縮める
  const fit = () => {
    if (panel.classList.contains('hidden') || !panel.clientHeight) return;
    syncInputMin();
    body.style.minHeight = `${minH()}px`;
    // 毎回ユーザーが決めた高さから計算し直す（モーダルを閉じた・ウィンドウを戻したときは元の高さに戻る）
    h = pref;
    apply();
    if (h > 0) {
      h = clamp(h);
      apply();
    }
  };
  const handle = $('splitFoot');
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing-row');
    const startY = e.clientY;
    const start = foot.offsetHeight;
    const move = (ev) => {
      h = clamp(start - (ev.clientY - startY)); // 上へ動かすと下の段が高くなる
      apply();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing-row');
      pref = h > 0 ? Math.round(h) : pref;
      if (pref > 0) localStorage.setItem(KEY, String(pref));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => {
    h = pref = 0;
    apply();
    localStorage.removeItem(KEY);
  });
  apply();
  const ro = new ResizeObserver(fit);
  ro.observe(panel);
  ro.observe(title);
})();

AppView.bindNavMenu({ button: $('navBtn'), menu: $('navMenu'), doc: document, onSelect: setView });
applyView();
// scheduler-view.js は renderer.js のあとに読むので、最初の描画に間に合わなかったときは読み終わってから描き直す
document.addEventListener('DOMContentLoaded', () => {
  if (state.view === 'scheduler') renderSchedulerView();
});

(async () => {
  state.board = await api.getBoard();
  renderBoard();
  checkEnv();
})();
