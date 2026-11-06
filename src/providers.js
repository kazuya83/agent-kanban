// エージェント CLI（Claude Code / Codex CLI / Gemini CLI / Cursor CLI）の一覧と、Claude Code 以外の起動のしかた・出力の読み取り
//
// どの CLI も「作業フォルダで起動 → 指示を渡す → 1行1つの JSON（JSONL）でイベントを出す」形で動かす。
// 指示は stdin で渡す（Cursor CLI だけは、ドキュメントどおり最後の引数で渡す。AGENTS の promptArg）。
// 出力は CLI ごとに形が違うので、ここで共通の形（アクション）に直して agent.js に渡す:
//   { type: 'session', id, model? }        会話（セッション）の ID が分かった
//   { type: 'text', text }                  エージェントの発言
//   { type: 'tool', name, summary }         ツールの呼び出し
//   { type: 'tool_result', text, error }    ツールの結果
//   { type: 'todos', items }                エージェントの TODO リスト（進捗タブに出す。todoItems の形）
//   { type: 'log_error', text }             続けられるエラー（ログに出すだけ）
//   { type: 'result', error? }              1ターンが終わった（error があれば失敗）
//
// Claude Code は承認（--permission-prompt-tool）や実行中のメッセージ（btw）に対応しているので、
// これまでどおり agent.js の中で直接扱う

const { tr } = require('../renderer/i18n');

const AGENTS = {
  claude: { label: 'Claude Code', short: 'Claude', defaultCmd: 'claude', pathKey: 'claudePath', modelKey: 'model' },
  codex: { label: 'Codex CLI', short: 'Codex', defaultCmd: 'codex', pathKey: 'codexPath', modelKey: 'codexModel' },
  gemini: { label: 'Gemini CLI', short: 'Gemini', defaultCmd: 'gemini', pathKey: 'geminiPath', modelKey: 'geminiModel' },
  cursor: { label: 'Cursor CLI', short: 'Cursor', defaultCmd: 'cursor-agent', pathKey: 'cursorPath', modelKey: 'cursorModel', promptArg: true },
};
const AGENT_IDS = Object.keys(AGENTS);

function isAgent(a) {
  return Object.prototype.hasOwnProperty.call(AGENTS, a);
}
function agentLabel(a) {
  return (AGENTS[a] || AGENTS.claude).label;
}
function agentShort(a) {
  return (AGENTS[a] || AGENTS.claude).short;
}
function agentCommand(settings, a) {
  const d = AGENTS[a] || AGENTS.claude;
  return String((settings && settings[d.pathKey]) || '').trim() || d.defaultCmd;
}
// 指示を引数で渡す CLI か（そうでなければ stdin で渡す）
function promptViaArg(a) {
  return !!(AGENTS[a] && AGENTS[a].promptArg);
}
function agentModel(settings, a) {
  const d = AGENTS[a] || AGENTS.claude;
  return String((settings && settings[d.modelKey]) || '').trim();
}

// 権限モード（Claude Code の名前）を、それぞれの CLI のやり方に直す。
// Codex / Gemini / Cursor はカードでの承認に対応していないので、自動で許可されない操作は CLI 側で止められる
function codexPolicy(mode) {
  if (mode === 'bypassPermissions') return { bypass: true };
  return { sandbox: mode === 'plan' ? 'read-only' : 'workspace-write' };
}
function geminiApproval(mode) {
  return { plan: 'plan', bypassPermissions: 'yolo', acceptEdits: 'auto_edit', default: 'default' }[mode] || 'auto_edit';
}
// Cursor CLI はヘッドレス（-p）だと、--force がないとファイルの変更を提案するだけで書かない。
// 「計画だけ」は plan モード（読み取りのみ）、それ以外は --force で変更を書かせる（cli-config.json の deny は守られる）
function cursorPolicy(mode) {
  if (mode === 'plan') return ['--mode', 'plan'];
  if (mode === 'bypassPermissions') return ['--force', '--approve-mcps'];
  return ['--force'];
}

/**
 * 起動する引数（指示は stdin で渡す。Cursor だけは prompt を最後の引数に入れる）
 * @param {'codex'|'gemini'|'cursor'} a
 * @param {{ mode?: string, model?: string, sessionId?: string|null, prompt?: string, includeDirs?: string[] }} o
 */
function buildArgs(a, { mode, model, sessionId, prompt, includeDirs = [] } = {}) {
  if (a === 'codex') {
    const args = ['exec'];
    if (sessionId) args.push('resume');
    args.push('--json', '--skip-git-repo-check');
    const p = codexPolicy(mode);
    // resume には --sandbox がないので、どちらでも使える -c で渡す（値は TOML として読めなければ文字列になる）
    if (p.bypass) args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('-c', `sandbox_mode=${p.sandbox}`);
    if (model) args.push('-m', model);
    if (sessionId) args.push(sessionId);
    args.push('-'); // 指示は stdin から読む
    return args;
  }
  if (a === 'gemini') {
    // stdin がパイプなら、ヘッドレス（対話しない）で動く。worktree は毎回新しいフォルダなので、信頼の確認は飛ばす
    const args = ['--output-format', 'stream-json', '--skip-trust', '--approval-mode', geminiApproval(mode)];
    if (model) args.push('-m', model);
    if (sessionId) args.push('--resume', sessionId);
    // 作業フォルダの外にある添付ファイルの置き場所も読めるようにする
    if (includeDirs.length) args.push('--include-directories', includeDirs.join(','));
    return args;
  }
  if (a === 'cursor') {
    // worktree は毎回新しいフォルダなので、ワークスペースの信頼の確認は飛ばす（--trust）
    const args = ['-p', '--output-format', 'stream-json', '--trust', ...cursorPolicy(mode)];
    if (model) args.push('--model', model);
    if (sessionId) args.push('--resume', sessionId);
    // 「-」で始まる指示はオプションとして読まれてしまうので、先頭に空白を入れる
    const p = String(prompt ?? '');
    args.push(p.startsWith('-') ? ` ${p}` : p);
    return args;
  }
  throw new Error(tr('このエージェントには対応していません: {a}', { a }));
}

function trunc(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ---------- エージェントの TODO リスト（進捗タブに出す） ----------
// CLI ごとに形が違うので、[{ text, status: 'pending'|'in_progress'|'completed' }] にそろえる
//   Claude Code: TodoWrite { todos: [{ content, status, activeForm }] }
//   Codex CLI:   item.type 'todo_list' { items: [{ text, completed }] }
//   Gemini CLI:  write_todos { todos: [{ description, status }] }
//   Cursor CLI:  todoToolCall / updateTodosToolCall { args: { todos: [{ content, status: 'TODO_STATUS_COMPLETED' など }] } }
const MAX_TODOS = 50;
const TODO_TOOL_NAMES = new Set(['todowrite', 'write_todos', 'writetodos', 'todo_write', 'update_todos', 'updatetodos', 'todo']);
function isTodoTool(name) {
  return TODO_TOOL_NAMES.has(String(name || '').trim().toLowerCase());
}
function todoStatus(v, completed) {
  if (completed === true) return 'completed';
  const s = String(v || '').toLowerCase().replace(/^todo_status_/, '');
  if (/^(completed?|done|finished|success)$/.test(s)) return 'completed';
  if (/^(in[_ -]?progress|active|running|doing|started)$/.test(s)) return 'in_progress';
  if (/^(cancell?ed|skipped)$/.test(s)) return 'cancelled';
  return 'pending';
}
/** @returns {{ text: string, status: string }[] | null} TODO リストでなければ null */
function todoItems(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const status = todoStatus(t.status, t.completed);
    // 作業中のものは「〜しています」の形（Claude の activeForm）があればそれを出す
    const text = String((status === 'in_progress' && t.activeForm) || t.content || t.text || t.description || t.title || t.step || '').trim();
    if (!text) continue;
    out.push({ text: trunc(text, 200), status });
    if (out.length >= MAX_TODOS) break;
  }
  return out;
}
// ツールの呼び出しの入力から、TODO リストを取り出す（TODO のツールでなければ null）
function todosFromTool(name, input) {
  if (!isTodoTool(name) || !input || typeof input !== 'object') return null;
  return todoItems(input.todos || input.items);
}

// ---------- Codex CLI（codex exec --json） ----------
// thread.started / turn.started / item.started / item.updated / item.completed / turn.completed / turn.failed / error
function codexParser({ summarize }) {
  const started = new Set();
  const toolOf = (item) => {
    switch (item.type) {
      case 'command_execution':
        return { name: 'Bash', summary: trunc(item.command, 300) };
      case 'mcp_tool_call':
        return { name: `mcp ${[item.server, item.tool].filter(Boolean).join('.')}`, summary: summarize(item.arguments) };
      case 'web_search':
        return { name: 'WebSearch', summary: trunc(item.query, 300) };
      default:
        return null;
    }
  };
  return {
    onEvent(ev) {
      const out = [];
      const item = ev.item || {};
      // 計画（TODO リスト）は、作り直されるたびに最新の形で届く
      if (item.type === 'todo_list' && /^item\.(started|updated|completed)$/.test(ev.type)) {
        const items = todoItems(item.items);
        return items ? [{ type: 'todos', items }] : [];
      }
      switch (ev.type) {
        case 'thread.started':
          if (ev.thread_id) out.push({ type: 'session', id: String(ev.thread_id) });
          break;
        case 'item.started': {
          const t = toolOf(item);
          if (t) {
            started.add(item.id);
            out.push({ type: 'tool', ...t });
          }
          break;
        }
        case 'item.completed':
          if (item.type === 'agent_message' && String(item.text || '').trim()) out.push({ type: 'text', text: item.text });
          else if (item.type === 'file_change') {
            const files = (item.changes || []).map((x) => `${x.kind ? `${x.kind} ` : ''}${x.path}`).join(', ');
            out.push({ type: 'tool', name: 'Edit', summary: trunc(files, 300) });
          } else if (item.type === 'error' && item.message) out.push({ type: 'log_error', text: item.message });
          else {
            const t = toolOf(item);
            if (!t) break;
            if (!started.has(item.id)) out.push({ type: 'tool', ...t });
            started.delete(item.id);
            if (item.type === 'command_execution') {
              const failed = item.status === 'failed' || (item.exit_code != null && item.exit_code !== 0);
              out.push({ type: 'tool_result', text: trunc(item.aggregated_output || tr('（終了コード {code}）', { code: item.exit_code ?? '?' }), 1500), error: failed });
            } else if (item.type === 'mcp_tool_call') {
              const r = item.error ? item.error.message || JSON.stringify(item.error) : JSON.stringify(item.result ?? '');
              out.push({ type: 'tool_result', text: trunc(r, 1500), error: item.status === 'failed' || !!item.error });
            }
          }
          break;
        case 'turn.completed':
          out.push({ type: 'result' });
          break;
        case 'turn.failed':
          out.push({ type: 'result', error: (ev.error && ev.error.message) || tr('Codex がエラーで止まりました') });
          break;
        case 'error':
          if (ev.message) out.push({ type: 'log_error', text: ev.message });
          break;
        default:
          break;
      }
      return out;
    },
    flush() {
      return [];
    },
  };
}

// ---------- Gemini CLI（gemini --output-format stream-json） ----------
// init / message（assistant は少しずつ届く delta）/ tool_use / tool_result / error / result
function geminiParser({ summarize }) {
  let text = '';
  const flush = () => {
    const t = text;
    text = '';
    return t.trim() ? [{ type: 'text', text: t }] : [];
  };
  return {
    onEvent(ev) {
      switch (ev.type) {
        case 'init':
          return ev.session_id ? [{ type: 'session', id: String(ev.session_id), model: ev.model }] : [];
        case 'message':
          if (ev.role === 'assistant' && typeof ev.content === 'string') {
            if (ev.delta) text += ev.content;
            else return [...flush(), { type: 'text', text: ev.content }].filter((a) => String(a.text).trim());
          }
          return [];
        case 'tool_use': {
          const out = [...flush(), { type: 'tool', name: String(ev.tool_name || 'tool'), summary: summarize(ev.parameters) }];
          const todos = todosFromTool(ev.tool_name, ev.parameters);
          if (todos) out.push({ type: 'todos', items: todos });
          return out;
        }
        case 'tool_result': {
          const failed = ev.status === 'error';
          const body = failed && ev.error ? ev.error.message || '' : ev.output || '';
          return [...flush(), { type: 'tool_result', text: trunc(body || (failed ? tr('エラー') : 'ok'), 1500), error: failed }];
        }
        case 'error':
          return [...flush(), { type: 'log_error', text: String(ev.message || tr('エラー')) }];
        case 'result':
          if (ev.status && ev.status !== 'success') return [...flush(), { type: 'result', error: (ev.error && ev.error.message) || tr('エラー（{subtype}）', { subtype: ev.status }) }];
          return [...flush(), { type: 'result' }];
        default:
          return [];
      }
    },
    flush,
  };
}

// ---------- Cursor CLI（cursor-agent -p --output-format stream-json） ----------
// system(init) / user / assistant / tool_call(started・completed) / result
// tool_call は { shellToolCall: { args, result } } のように、ツールの種類ごとのキーに中身が入っている
const CURSOR_TOOL_NAMES = { shell: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', delete: 'Delete', grep: 'Grep', glob: 'Glob', ls: 'LS', todo: 'TodoWrite', updateTodos: 'TodoWrite', webSearch: 'WebSearch', webFetch: 'WebFetch' };
function cursorParser({ summarize }) {
  let text = '';
  const flush = () => {
    const t = text;
    text = '';
    return t.trim() ? [{ type: 'text', text: t }] : [];
  };
  const started = new Set();
  const toolOf = (tc) => {
    if (!tc || typeof tc !== 'object') return null;
    const key = Object.keys(tc)[0];
    if (!key) return null;
    const body = tc[key] || {};
    if (key === 'function') {
      // ほかの種類のツール（MCP など）: { function: { name, arguments } }
      let args = body.arguments;
      try {
        if (typeof args === 'string') args = JSON.parse(args);
      } catch {
        /* 文字列のまま出す */
      }
      return { name: String(body.name || 'tool'), summary: typeof args === 'string' ? trunc(args, 300) : summarize(args), body };
    }
    const kind = key.replace(/ToolCall$/, '');
    const name = CURSOR_TOOL_NAMES[kind] || (key === 'mcpToolCall' ? `mcp ${[body.args && body.args.providerIdentifier, body.args && body.args.toolName].filter(Boolean).join('.')}`.trim() : kind);
    return { name, summary: summarize(body.args), body, kind };
  };
  const resultOf = (t) => {
    const r = (t.body && t.body.result) || {};
    if (r.success) {
      const ok = r.success;
      if (t.kind === 'shell') {
        const out = [ok.stdout, ok.stderr].filter((x) => String(x || '').trim()).join('\n');
        const failed = ok.exitCode != null && ok.exitCode !== 0;
        return { text: trunc(out || tr('（終了コード {code}）', { code: ok.exitCode ?? '?' }), 1500), error: failed };
      }
      if (typeof ok.content === 'string') return { text: trunc(ok.content, 1500), error: false };
      return { text: trunc(typeof ok === 'object' ? JSON.stringify(ok) : String(ok), 1500), error: false };
    }
    const bad = r.error || r.failure || r.rejected;
    if (bad) {
      const msg = typeof bad === 'string' ? bad : bad.message || bad.error || bad.reason || bad.stderr || JSON.stringify(bad);
      return { text: trunc(r.rejected ? tr('拒否されました: {msg}', { msg }) : msg, 1500), error: true };
    }
    return { text: 'ok', error: false };
  };
  const contentText = (m) => {
    const c = m && m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
    return '';
  };
  return {
    onEvent(ev) {
      switch (ev.type) {
        case 'system':
          if (ev.subtype === 'init' && ev.session_id) return [{ type: 'session', id: String(ev.session_id), model: ev.model }];
          return [];
        case 'assistant':
          // 少しずつ届くことがあるので、ツールの呼び出しか終わりまでまとめる
          text += contentText(ev.message);
          return [];
        case 'tool_call': {
          const t = toolOf(ev.tool_call);
          if (!t) return [];
          const id = ev.call_id || '';
          const todos = t.name === 'TodoWrite' || isTodoTool(t.name) ? todoItems(t.body && t.body.args && (t.body.args.todos || t.body.args.items)) : null;
          if (ev.subtype === 'started') {
            started.add(id);
            return [...flush(), { type: 'tool', name: t.name, summary: t.summary }, ...(todos ? [{ type: 'todos', items: todos }] : [])];
          }
          if (ev.subtype === 'completed') {
            const out = flush();
            if (!started.has(id)) {
              out.push({ type: 'tool', name: t.name, summary: t.summary });
              if (todos) out.push({ type: 'todos', items: todos });
            }
            started.delete(id);
            out.push({ type: 'tool_result', ...resultOf(t) });
            return out;
          }
          return [];
        }
        case 'error':
          return [...flush(), { type: 'log_error', text: String(ev.message || (ev.error && ev.error.message) || tr('エラー')) }];
        case 'result':
          if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) {
            const e = ev.error && typeof ev.error === 'object' ? ev.error.message : ev.error;
            return [...flush(), { type: 'result', error: String(e || ev.result || tr('エラー（{subtype}）', { subtype: ev.subtype || 'error' })) }];
          }
          return [...flush(), { type: 'result' }];
        default:
          return [];
      }
    },
    flush,
  };
}

function createParser(a, opts = {}) {
  const o = { summarize: opts.summarize || ((x) => trunc(JSON.stringify(x ?? ''), 300)) };
  if (a === 'codex') return codexParser(o);
  if (a === 'gemini') return geminiParser(o);
  if (a === 'cursor') return cursorParser(o);
  throw new Error(tr('このエージェントには対応していません: {a}', { a }));
}

// ---------- オーケストレーション ----------

// Pipeline（順番に引き継ぐ）の工程の初期値。呼んだときの言語で作る（新規インストールと、新しいリポジトリ）
function defaultRelaySteps() {
  return [
    { agent: 'codex', label: tr('実装'), instruction: tr('タスクの指示に沿って実装してください。必要ならテストも追加・実行してください。') },
    {
      agent: 'claude',
      label: tr('レビュー'),
      instruction: tr('前の工程の変更をレビューしてください（git log / git diff でベースブランチからの変更を確かめられます）。バグ・抜け・テスト不足があれば直し、最後に何を確かめて何を直したかを短く報告してください。'),
    },
  ];
}
// 読み込み時の言語（テストは原文）で固めたもの。実行中に言語を変えたあとは defaultRelaySteps() を使う
const DEFAULT_RELAY_STEPS = defaultRelaySteps();
// 競争（同じタスクを複数のエージェントで並列に解く）の初期値
const DEFAULT_COMPETE_AGENTS = ['claude', 'codex'];

// Pipelineと競争は排他。設定でどちらか1つだけを使うか、使わない（'relay' / 'compete' / 'none'。ほかの値はPipeline）
const ORCHESTRATIONS = ['relay', 'compete', 'none'];
function cleanOrchestration(v) {
  return ORCHESTRATIONS.includes(v) ? v : 'relay';
}

// 分岐の行き先: 'end'（終了してレビュー列へ）か、工程の番号（0 から）。それ以外（null など）は「次の工程」
const RELAY_MAX_LOOPS_DEFAULT = 3;
function cleanRelayTarget(v, map) {
  if (v === 'end') return 'end';
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || !map.has(n)) return null;
  return map.get(n);
}

// 設定から読んだPipelineの工程を整える（知らないエージェント・空の工程は落とす）
// 分岐（onPass / onFail）・戻る上限（maxLoops）は、判定する工程だけに残す。行き先は落とした工程の分だけ番号を詰める
function cleanRelaySteps(steps) {
  if (!Array.isArray(steps)) return [];
  const base = steps.map((x) => ({
    agent: isAgent(x && x.agent) ? x.agent : 'claude',
    label: trunc(String((x && x.label) || '').trim(), 30),
    instruction: trunc(String((x && x.instruction) || '').trim(), 4000),
    raw: x || {},
  }));
  // 元の番号 → 残した工程の番号
  const map = new Map();
  base.forEach((x, i) => {
    if ((x.label || x.instruction) && map.size < 8) map.set(i, map.size);
  });
  return base
    .filter((_, i) => map.has(i))
    .map(({ raw, ...x }, i) => {
      const out = { ...x, label: x.label || tr('工程{n}', { n: i + 1 }) };
      const onPass = cleanRelayTarget(raw.onPass, map);
      const onFail = cleanRelayTarget(raw.onFail, map);
      if (onPass !== null) out.onPass = onPass;
      if (onFail !== null) out.onFail = onFail;
      if (onPass !== null || onFail !== null) {
        const m = Number(raw.maxLoops);
        out.maxLoops = Number.isInteger(m) && m >= 1 ? Math.min(m, 10) : RELAY_MAX_LOOPS_DEFAULT;
      }
      return out;
    });
}
// 判定する工程か（合格・差し戻しで行き先が変わる）
function relayJudges(st) {
  return !!st && (st.onPass !== undefined || st.onFail !== undefined);
}
function cleanCompeteAgents(list) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) if (isAgent(a) && !out.includes(a)) out.push(a);
  return out;
}

// ---------- カスタムエージェント（プロジェクトごと） ----------
// 元にする CLI・モデルに、プロフィール（名前・アイコンと色・説明・振る舞いの指示）を持たせたもの。
// タスク・会話・Pipelineの工程・競争で、ふつうのエージェントの代わりに選べる。
// 選ぶときの値は「custom:<ID>」。タスクを作るときに中身（persona）をカードに写すので、あとで直したり消したりしても動いているタスクは変わらない
const MAX_CUSTOM_AGENTS = 30;
const CUSTOM_PREFIX = 'custom:';
const DEFAULT_CUSTOM_COLOR = '#6366f1';
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]*$/;

function isCustomRef(v) {
  return typeof v === 'string' && v.startsWith(CUSTOM_PREFIX) && /^[A-Za-z0-9_-]{1,32}$/.test(v.slice(CUSTOM_PREFIX.length));
}
function customIdOf(v) {
  return isCustomRef(v) ? v.slice(CUSTOM_PREFIX.length) : '';
}
function cleanCustomModel(v) {
  const m = String(v || '').trim();
  return m && m.length <= 100 && MODEL_RE.test(m) ? m : '';
}
function cleanCustomColor(v) {
  const c = String(v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : DEFAULT_CUSTOM_COLOR;
}
// アイコンは絵文字など短い文字（書記素で2つ・16 文字まで）
function cleanCustomIcon(v) {
  const s = String(v || '').trim().replace(/[\s<>"'`&]/g, '');
  if (!s) return '';
  const parts = typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : [...s];
  return parts.slice(0, 2).join('').slice(0, 16);
}

/**
 * 設定から読んだカスタムエージェントの一覧を整える（名前のないもの・ID が重なるものは落とす）
 * @returns {{ id: string, name: string, icon: string, color: string, description: string, instruction: string, agent: string, model: string }[]}
 */
function cleanCustomAgents(list) {
  const out = [];
  const ids = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x !== 'object' || out.length >= MAX_CUSTOM_AGENTS) continue;
    const name = trunc(String(x.name || '').trim(), 30);
    if (!name) continue;
    let id = String(x.id || '').trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || ids.has(id)) {
      let n = out.length + 1;
      while (ids.has(`ca${n}`)) n++;
      id = `ca${n}`;
    }
    ids.add(id);
    out.push({
      id,
      name,
      icon: cleanCustomIcon(x.icon),
      color: cleanCustomColor(x.color),
      description: trunc(String(x.description || '').trim(), 200),
      instruction: trunc(String(x.instruction || '').trim(), 4000),
      agent: isAgent(x.agent) ? x.agent : 'claude',
      model: cleanCustomModel(x.model),
    });
  }
  return out;
}
function findCustomAgent(list, id) {
  const k = customIdOf(id) || String(id || '');
  return (Array.isArray(list) ? list : []).find((x) => x && x.id === k) || null;
}
// カードに写すプロフィール
function personaOf(ca) {
  if (!ca) return null;
  return { id: ca.id, name: ca.name, icon: ca.icon || '', color: ca.color || DEFAULT_CUSTOM_COLOR, description: ca.description || '', instruction: ca.instruction || '' };
}
// 指示に付けるプロフィールの説明（説明・振る舞いの指示がなければ名前だけ）
function personaNote(p) {
  if (!p || !p.name) return '';
  const lines = ['## あなたのプロフィール', `あなたはカスタムエージェント「${p.name}」です。${p.description ? `役割: ${p.description}` : ''}`.trim()];
  if (p.instruction) lines.push('', '### 振る舞いの指示（いつも守ってください）', p.instruction);
  return lines.join('\n');
}
function withPersona(p, prompt) {
  const note = personaNote(p);
  return note ? `${note}\n\n---\n\n${prompt}` : prompt;
}

// ---------- 使うエージェント ----------
// 設定でチェックを付けたエージェントだけを、タスク・会話・Pipeline・競争で選べるようにする（1つは必ず残す）
const DEFAULT_ENABLED_AGENTS = ['claude'];
function cleanEnabledAgents(list) {
  const out = cleanCompeteAgents(list).sort((a, b) => AGENT_IDS.indexOf(a) - AGENT_IDS.indexOf(b));
  return out.length ? out : [...DEFAULT_ENABLED_AGENTS];
}
function enabledAgents(settings) {
  return cleanEnabledAgents(settings && settings.enabledAgents);
}
function isEnabled(settings, a) {
  return enabledAgents(settings).includes(a);
}
// 新しいタスク・会話で最初から選んでおくエージェント（使わない設定のものなら、使うものの先頭）
function defaultAgentOf(settings) {
  const list = enabledAgents(settings);
  const d = settings && settings.defaultAgent;
  return list.includes(d) ? d : list[0];
}

module.exports = {
  AGENTS,
  AGENT_IDS,
  isAgent,
  agentLabel,
  agentShort,
  agentCommand,
  agentModel,
  promptViaArg,
  buildArgs,
  createParser,
  todoItems,
  todosFromTool,
  codexPolicy,
  geminiApproval,
  cursorPolicy,
  defaultRelaySteps,
  DEFAULT_RELAY_STEPS,
  DEFAULT_COMPETE_AGENTS,
  cleanRelaySteps,
  relayJudges,
  RELAY_MAX_LOOPS_DEFAULT,
  cleanOrchestration,
  ORCHESTRATIONS,
  cleanCompeteAgents,
  DEFAULT_ENABLED_AGENTS,
  cleanEnabledAgents,
  enabledAgents,
  isEnabled,
  defaultAgentOf,
  MAX_CUSTOM_AGENTS,
  CUSTOM_PREFIX,
  DEFAULT_CUSTOM_COLOR,
  isCustomRef,
  customIdOf,
  cleanCustomAgents,
  findCustomAgent,
  personaOf,
  personaNote,
  withPersona,
};
