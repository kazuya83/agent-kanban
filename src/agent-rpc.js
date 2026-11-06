// 承認のやりとりができる起動のしかた（1行1つの JSON-RPC）で、エージェントの CLI を動かす
//
//   Codex:  codex app-server（独自の JSON-RPC。"jsonrpc" の欄はない）
//   Cursor: cursor-agent acp（ACP = Agent Client Protocol）
//
// どちらも「stdin / stdout で話し続ける → エージェントが、操作の前にこちらへ許可を聞いてくる」形。
// 許可は permit() に渡すので、Claude Code と同じカードの承認になる。
// 出力は providers.js と同じ共通の形（アクション）に直して emit() に渡す。
//
// ACP は Cursor 以外の CLI でも同じ形なので、対応する CLI は createRpcSession の acp にそのまま載せられる。

const { createParser, todoItems, trunc } = require('./providers');
const { tr } = require('../renderer/i18n');

const JSONRPC_METHOD_NOT_FOUND = -32601;

function errorText(err) {
  if (!err) return '';
  const data = err.data && typeof err.data === 'object' ? err.data.message : err.data;
  return String(data || err.message || err);
}

// 行き来の土台: id の付いた問い合わせと、エージェントからの問い合わせ（requests）・お知らせ（onNotify）を振り分ける
class Rpc {
  constructor({ write, jsonrpc, requests, onNotify }) {
    this.write = write;
    this.jsonrpc = jsonrpc;
    this.requests = requests;
    this.onNotify = onNotify;
    this.nextId = 1;
    this.waiting = new Map();
    this.closed = false;
  }

  frame(m) {
    if (this.closed) return;
    this.write(`${JSON.stringify(this.jsonrpc ? { jsonrpc: '2.0', ...m } : m)}\n`);
  }

  call(method, params) {
    const id = this.nextId++;
    this.frame({ id, method, params });
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
  }

  notify(method, params) {
    this.frame({ method, ...(params ? { params } : {}) });
  }

  async onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.method && m.id != null) {
      const h = this.requests[m.method];
      if (!h) {
        this.frame({ id: m.id, error: { code: JSONRPC_METHOD_NOT_FOUND, message: `Method not found: ${m.method}` } });
        return;
      }
      try {
        this.frame({ id: m.id, result: await h(m.params || {}) });
      } catch (err) {
        this.frame({ id: m.id, error: { code: -32000, message: errorText(err) } });
      }
      return;
    }
    if (m.method) {
      this.onNotify(m.method, m.params || {});
      return;
    }
    const w = this.waiting.get(m.id);
    if (!w) return;
    this.waiting.delete(m.id);
    if (m.error) w.reject(new Error(errorText(m.error)));
    else w.resolve(m.result || {});
  }

  close(reason) {
    this.closed = true;
    for (const w of this.waiting.values()) w.reject(new Error(reason || 'closed'));
    this.waiting.clear();
  }
}

const allowed = (d) => !!d && d.behavior === 'allow';

// ---------- Codex（codex app-server） ----------

// 権限モードごとの動かし方。app-server で動かすのは、途中で許可を聞く必要があるモードだけ
//   default:     コマンドもファイルの変更も毎回聞く
//   acceptEdits: worktree の中の編集と sandbox の中のコマンドはそのまま動き、そこから出るときだけ聞く
//                （Codex は読み取りも cat などのコマンドで行うので、コマンドを毎回聞くと動かなくなる）
function codexApprovalPolicy(mode) {
  if (mode === 'default') return { approvalPolicy: 'untrusted', sandbox: 'workspace-write' };
  if (mode === 'acceptEdits') return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
  return null;
}

// `/bin/zsh -lc 'touch a'` のように包まれたコマンドから、中身だけを出す
function codexCommand(p) {
  const action = Array.isArray(p.commandActions) && p.commandActions.length === 1 ? p.commandActions[0] : null;
  if (action && typeof action.command === 'string' && action.command) return action.command;
  if (Array.isArray(p.command)) return p.command.join(' ');
  return String(p.command || '');
}

// app-server の項目を、codex exec --json の形に直す（読み取りは codexParser と同じものを使う）
function codexItem(item) {
  if (!item) return {};
  switch (item.type) {
    case 'agentMessage':
      return { id: item.id, type: 'agent_message', text: item.text };
    case 'commandExecution': {
      const declined = item.status === 'declined';
      const failed = declined || item.status === 'failed' ? 'failed' : item.status;
      const output = declined ? tr('ユーザーが拒否しました') : item.aggregatedOutput;
      return { id: item.id, type: 'command_execution', command: codexCommand(item), status: failed, exit_code: item.exitCode, aggregated_output: output };
    }
    case 'fileChange':
      if (item.status === 'declined') return {};
      return { id: item.id, type: 'file_change', changes: (item.changes || []).map((c) => ({ path: c.path, kind: (c.kind && c.kind.type) || c.kind })) };
    case 'mcpToolCall':
      return { id: item.id, type: 'mcp_tool_call', server: item.server, tool: item.tool, arguments: item.arguments, status: item.status, error: item.error };
    case 'webSearch':
      return { id: item.id, type: 'web_search', query: item.query };
    default:
      return {};
  }
}

function codexSession(o) {
  const { emit, permit, finish } = o;
  const parser = createParser('codex', { summarize: o.summarize });
  const changes = new Map(); // 項目の ID → 変更するファイル（承認の問い合わせには入っていない）
  const feed = (ev) => emit(parser.onEvent(ev));
  const policy = codexApprovalPolicy(o.mode);

  const rpc = new Rpc({
    write: o.write,
    jsonrpc: false,
    requests: {
      'item/commandExecution/requestApproval': async (p) => {
        const d = await permit({ toolName: 'Bash', input: { command: codexCommand(p), cwd: p.cwd, reason: p.reason || undefined } });
        return { decision: allowed(d) ? 'accept' : 'decline' };
      },
      'item/fileChange/requestApproval': async (p) => {
        const files = changes.get(p.itemId) || [];
        const input = { file_path: files.join(', ') || p.grantRoot || tr('（不明）'), files, reason: p.reason || undefined };
        const d = await permit({ toolName: 'Edit', input });
        return { decision: allowed(d) ? 'accept' : 'decline' };
      },
      'item/permissions/requestApproval': async (p) => {
        const d = await permit({ toolName: 'Permissions', input: { description: p.reason || tr('追加の権限'), permissions: p.permissions } });
        return { permissions: allowed(d) ? p.permissions : {}, scope: 'turn' };
      },
      // 選択肢の質問はカードに出さないので、答えずに進めてもらう
      'item/tool/requestUserInput': async () => ({ answers: {} }),
      'mcpServer/elicitation/request': async () => ({ action: 'decline', content: null }),
    },
    onNotify(method, p) {
      switch (method) {
        case 'item/started':
          if (p.item && p.item.type === 'fileChange') changes.set(p.item.id, (p.item.changes || []).map((c) => c.path));
          feed({ type: 'item.started', item: codexItem(p.item) });
          break;
        case 'item/completed':
          feed({ type: 'item.completed', item: codexItem(p.item) });
          break;
        case 'turn/plan/updated': {
          const items = todoItems(p.plan);
          if (items) emit([{ type: 'todos', items }]);
          break;
        }
        case 'error':
          if (p.willRetry) break;
          if (p.error && p.error.message) emit([{ type: 'log_error', text: p.error.message }]);
          break;
        case 'turn/completed': {
          const t = p.turn || {};
          if (t.status === 'failed') finish((t.error && t.error.message) || tr('ターンが失敗しました'));
          else finish(null);
          break;
        }
        default:
          break;
      }
    },
  });

  return {
    rpc,
    flush: () => parser.flush(),
    async start() {
      await rpc.call('initialize', { clientInfo: { name: 'worktree-kanban', title: 'Worktree Kanban', version: o.version || '0' }, capabilities: { experimentalApi: false } });
      rpc.notify('initialized');
      const params = { cwd: o.cwd, ...policy, ...(o.model ? { model: o.model } : {}) };
      const started = o.sessionId ? await rpc.call('thread/resume', { threadId: o.sessionId, ...params }) : await rpc.call('thread/start', params);
      const threadId = started.thread && started.thread.id;
      if (!threadId) throw new Error(tr('Codex の会話を始められませんでした'));
      emit([{ type: 'session', id: threadId, model: started.model }]);
      await rpc.call('turn/start', { threadId, input: [{ type: 'text', text: o.prompt, text_elements: [] }] });
    },
  };
}

// ---------- ACP（cursor-agent acp） ----------

function acpToolName(kind, title) {
  switch (kind) {
    case 'execute':
      return 'Bash';
    case 'edit':
    case 'delete':
    case 'move':
      return 'Edit';
    case 'read':
      return 'Read';
    case 'search':
      return 'Grep';
    case 'fetch':
      return 'WebFetch';
    default:
      // 名前はエージェント側が決める文字列なので、カードの特別な名前（AskUserQuestion など）にならないよう頭に付ける
      return `Tool: ${trunc(String(title || '').replace(/`/g, ''), 60)}`;
  }
}

// ツールの呼び出しを、カードに出す名前と入力に直す
function acpToolInput(call) {
  const raw = call.rawInput && typeof call.rawInput === 'object' ? call.rawInput : {};
  const title = String(call.title || '');
  const path = raw.path || raw.file_path || (Array.isArray(call.locations) && call.locations[0] && call.locations[0].path);
  const name = acpToolName(call.kind, title);
  const reason = (Array.isArray(call.content) ? call.content : []).map((c) => c && c.content && c.content.text).filter(Boolean).join('\n');
  const input = { ...raw };
  if (name === 'Bash') input.command = String(raw.command || title.replace(/^`|`$/g, ''));
  else if (path) input.file_path = String(path);
  else if (!Object.keys(input).length) input.description = title.replace(/`/g, '');
  if (reason) input.reason = reason;
  return { name, input };
}

function acpResultText(out) {
  if (typeof out === 'string') return out;
  if (!out || typeof out !== 'object') return '';
  return [out.stdout, out.stderr, out.output, out.content].filter((x) => typeof x === 'string' && x).join('\n');
}

function acpSession(o) {
  const { emit, permit, finish } = o;
  const calls = new Map(); // toolCallId → そこまでに分かった中身
  let text = '';
  let replaying = false; // session/load の間は、前の会話が流れてくる
  let id = null;

  const flushText = () => {
    if (text.trim()) emit([{ type: 'text', text }]);
    text = '';
  };
  const showTool = (call) => {
    if (call.shown) return;
    call.shown = true;
    flushText();
    const { name, input } = acpToolInput(call);
    emit([{ type: 'tool', name, summary: o.summarize(input) }]);
  };
  const onUpdate = (u) => {
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
        if (u.content && u.content.type === 'text') text += u.content.text || '';
        break;
      case 'plan': {
        const items = todoItems(u.entries);
        if (items) emit([{ type: 'todos', items }]);
        break;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const call = { ...(calls.get(u.toolCallId) || {}), ...u };
        calls.set(u.toolCallId, call);
        // 編集のパスなどは、最初の知らせには入っていない。動き始めるところで出す
        if (u.status === 'in_progress' || u.status === 'completed' || u.status === 'failed') showTool(call);
        if (u.status === 'completed' || u.status === 'failed') {
          const body = acpResultText(u.rawOutput);
          const failed = u.status === 'failed' || (u.rawOutput && u.rawOutput.exitCode != null && u.rawOutput.exitCode !== 0);
          if (body || failed) emit([{ type: 'tool_result', text: trunc(body || tr('（終了コード {code}）', { code: (u.rawOutput && u.rawOutput.exitCode) ?? '?' }), 1500), error: !!failed }]);
          calls.delete(u.toolCallId);
        }
        break;
      }
      default:
        break;
    }
  };

  const rpc = new Rpc({
    write: o.write,
    jsonrpc: true,
    requests: {
      'session/request_permission': async (p) => {
        const known = calls.get(p.toolCall && p.toolCall.toolCallId) || {};
        const { name, input } = acpToolInput({ ...known, ...(p.toolCall || {}) });
        const d = await permit({ toolName: name, input });
        const options = Array.isArray(p.options) ? p.options : [];
        const pick = (...kinds) => kinds.map((k) => options.find((x) => x.kind === k)).find(Boolean);
        // 「常に許可」はカードの中で覚える。CLI の設定には書き残さない
        const opt = allowed(d) ? pick('allow_once', 'allow_always') : pick('reject_once', 'reject_always');
        return opt ? { outcome: { outcome: 'selected', optionId: opt.optionId } } : { outcome: { outcome: 'cancelled' } };
      },
    },
    onNotify(method, p) {
      if (method === 'session/update' && !replaying && p.update && (!id || p.sessionId === id)) onUpdate(p.update);
    },
  });

  return {
    rpc,
    flush() {
      flushText();
      return [];
    },
    async start() {
      await rpc.call('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'worktree-kanban', version: o.version || '0' } });
      if (o.sessionId) {
        replaying = true;
        try {
          await rpc.call('session/load', { sessionId: o.sessionId, cwd: o.cwd, mcpServers: [] });
          id = o.sessionId;
        } catch (err) {
          emit([{ type: 'log_error', text: tr('前の会話を読み込めなかったので、新しい会話で始めます: {message}', { message: err.message }) }]);
        }
        replaying = false;
      }
      if (!id) {
        const s = await rpc.call('session/new', { cwd: o.cwd, mcpServers: [] });
        id = s.sessionId;
        if (!id) throw new Error(tr('会話を始められませんでした'));
      }
      emit([{ type: 'session', id }]);
      if (o.mode === 'plan') await rpc.call('session/set_mode', { sessionId: id, modeId: 'plan' });
      const r = await rpc.call('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: o.prompt }] });
      flushText();
      const stop = r.stopReason;
      if (stop === 'end_turn' || stop === 'cancelled' || !stop) finish(null);
      else finish(tr('途中で止まりました（{reason}）', { reason: stop }));
    },
  };
}

/**
 * @param {'codex'|'acp'} kind
 * @param {object} o
 *   write(text)               stdin に書く
 *   emit(actions)             共通の形のアクションを渡す
 *   permit({toolName,input})  カードで許可を聞く（{ behavior } を返す）
 *   done()                    ターンが終わった（CLI を閉じてよい）
 *   mode / model / sessionId / cwd / prompt / summarize / version
 * @returns {{ start(): Promise<void>, onMessage(m): void, flush(): object[], close(): void, ended: boolean }}
 */
function createRpcSession(kind, opts) {
  const state = { ended: false };
  const finish = (error) => {
    if (state.ended) return;
    state.ended = true;
    if (error) opts.emit([{ type: 'result', error }]);
    else opts.emit([{ type: 'result' }]);
    opts.done();
  };
  const impl = (kind === 'codex' ? codexSession : acpSession)({ ...opts, finish });
  return {
    get ended() {
      return state.ended;
    },
    start: () =>
      impl.start().catch((err) => {
        if (!state.ended && !impl.rpc.closed) finish(err.message);
      }),
    onMessage: (m) => impl.rpc.onMessage(m),
    flush: () => impl.flush(),
    close: (reason) => impl.rpc.close(reason),
  };
}

/**
 * この CLI が使えるかを、会話を始めずに確かめる（Codex は版によって app-server の形が違うので、実際に thread/start まで通す）
 * @returns {{ onMessage(m): void, close(): void, run: Promise<void> }} run は使えなければ reject する
 */
function probeRpc(kind, { write, cwd, version }) {
  const rpc = new Rpc({ write, jsonrpc: kind === 'acp', requests: {}, onNotify() {} });
  const steps = async () => {
    if (kind === 'acp') {
      const r = await rpc.call('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'worktree-kanban', version: version || '0' } });
      if (typeof r.protocolVersion !== 'number') throw new Error('unknown protocol');
      return;
    }
    await rpc.call('initialize', { clientInfo: { name: 'worktree-kanban', title: 'Worktree Kanban', version: version || '0' }, capabilities: { experimentalApi: false } });
    rpc.notify('initialized');
    const r = await rpc.call('thread/start', { cwd, ephemeral: true });
    if (!r.thread || !r.thread.id) throw new Error('unknown protocol');
  };
  return { onMessage: (m) => rpc.onMessage(m), close: (reason) => rpc.close(reason), run: steps() };
}

module.exports = { createRpcSession, probeRpc, codexApprovalPolicy, codexCommand, codexItem, acpToolInput };
