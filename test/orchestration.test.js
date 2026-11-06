// Claude Code 以外のエージェント（Codex / Gemini / Cursor）と、オーケストレーション（Pipeline・競争）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store, migrateSettings } = require('../src/store');
const { AgentManager, promptWithSkill } = require('../src/agent');
const providers = require('../src/providers');
const FlowModel = require('../renderer/flow-model');

// Pipelineの工程を、前のバージョンの工程のリストの形で決める（フローチャートにして、今のプロジェクトの設定に入れる）
function useSteps(store, steps) {
  store.settings.relayFlow = FlowModel.flowFromSteps(providers.cleanRelaySteps(steps));
}

const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
const FAKE_CLI = path.join(__dirname, 'fake-agent-cli.js');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-orch-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const bin = (name, script, pre = '') => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${script}" ${pre} "$@"\n`, { mode: 0o755 });
    return p;
  };
  const argsLog = path.join(tmp, 'args.log');
  process.env.FAKE_ARGS_LOG = argsLog;
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, {
    repoPath: repo,
    claudePath: bin('claude', FAKE_CLAUDE),
    codexPath: bin('codex', FAKE_CLI, 'codex'),
    antigravityPath: bin('agy', FAKE_CLI, 'antigravity'),
    geminiPath: bin('gemini', FAKE_CLI, 'gemini'),
    cursorPath: bin('cursor-agent', FAKE_CLI, 'cursor'),
    maxParallel: 3,
    enabledAgents: ['claude', 'codex', 'antigravity', 'gemini', 'cursor'],
    specCheck: false, // ここでは指示をそのまま渡したときの流れを確かめる（仕様の確認は agent.test.js で確かめる）
  });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  const calls = () =>
    fs.existsSync(argsLog)
      ? fs.readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      : [];
  return { tmp, repo, store, agents, g, calls };
}

function waitFor(pred, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = pred();
      if (v) {
        clearInterval(iv);
        resolve(v);
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error('timeout'));
      }
    }, 20);
  });
}

test('providers: Antigravity の出力をアクションに直す', () => {
  const p = providers.createParser('antigravity', { summarize: (x) => JSON.stringify(x) });
  const up = (o) => p.onEvent({ event: 'step_update', step_update: { conversation_id: 'c1', ...o } });
  assert.deepStrictEqual(p.onEvent({ event: 'init', conversation_id: 'c1', init: { model: 'm1' } }), [{ type: 'session', id: 'c1', model: 'm1' }]);
  assert.deepStrictEqual(up({ step_index: 0, state: 'DONE', step_type: 'user_input' }), []);
  // 発言は、少しずつ届いたものをツールの呼び出しか終わりでまとめる（DONE にも続きが入っている）
  assert.deepStrictEqual(up({ step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'ファイルを' }), []);
  assert.deepStrictEqual(up({ step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: '読みます' }), []);
  // ツールは ACTIVE で1回だけ出し、DONE で結果を出す
  const cmd = { name: 'run_command', parameters: { CommandLine: 'npm test' } };
  assert.deepStrictEqual(up({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: cmd }), [{ type: 'text', text: 'ファイルを読みます' }, { type: 'tool', name: 'Bash', summary: 'npm test' }]);
  assert.deepStrictEqual(up({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: cmd }), []);
  assert.deepStrictEqual(up({ step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { ...cmd, output: 'ok!\r\n' } }), [{ type: 'tool_result', text: 'ok!\r\n', error: false }]);
  // 権限がなく拒否されたツールはエラーになる。DONE から始まるツールも取りこぼさない
  const denied = up({ step_index: 3, state: 'ERROR', step_type: 'tool', tool_name: 'write_file', tool_info: { name: 'write_file', parameters: { Path: '/w.txt' }, error: { type: 'TOOL_ERROR', message: 'permission check failed' } } });
  assert.deepStrictEqual(denied, [{ type: 'tool', name: 'Write', summary: '/w.txt' }, { type: 'tool_result', text: 'permission check failed', error: true }]);
  assert.deepStrictEqual(up({ step_index: 4, state: 'DONE', step_type: 'tool', tool_name: 'mcp_x', tool_info: { parameters: { a: 1 } } }), [{ type: 'tool', name: 'mcp_x', summary: '{"a":1}' }, { type: 'tool_result', text: 'ok', error: false }]);
  up({ step_index: 5, state: 'DONE', step_type: 'agent_response', text_delta: '完了' });
  assert.deepStrictEqual(p.onEvent({ event: 'result', result: { status: 'SUCCESS', response: '完了' } }), [{ type: 'text', text: '完了' }, { type: 'result' }]);
  // ログインしていないときの実際の形（init は来ない）
  assert.deepStrictEqual(p.onEvent({ event: 'result', result: { conversation_id: '', status: 'ERROR', error: 'authentication failed or timed out', finished_reason: 'error' } }), [{ type: 'result', error: 'authentication failed or timed out' }]);
  assert.deepStrictEqual(p.onEvent({ event: 'result', result: { status: 'CANCELED' } }), [{ type: 'result', error: 'エラー（CANCELED）' }]);
  // 種類が type のイベントは読まない
  assert.deepStrictEqual(p.onEvent({ type: 'init' }), []);
});

test('providers: 引数（権限モード・モデル・続き）', () => {
  assert.deepStrictEqual(providers.buildArgs('codex', { mode: 'acceptEdits' }), ['exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode=workspace-write', '-']);
  assert.deepStrictEqual(providers.buildArgs('codex', { mode: 'plan', model: 'o3', sessionId: 'abc' }), ['exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode=read-only', '-m', 'o3', 'abc', '-']);
  assert.ok(providers.buildArgs('codex', { mode: 'bypassPermissions' }).includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.deepStrictEqual(providers.buildArgs('gemini', { mode: 'acceptEdits', sessionId: 's1' }), ['--output-format', 'stream-json', '--skip-trust', '--approval-mode', 'auto_edit', '--resume', 's1']);
  assert.strictEqual(providers.geminiApproval('bypassPermissions'), 'yolo');
  assert.strictEqual(providers.geminiApproval('plan'), 'plan');
  // Antigravity の引数は本物の agy 1.5 で確かめたもの。指示は stdin で渡す
  assert.deepStrictEqual(providers.buildArgs('antigravity', { mode: 'acceptEdits' }), ['--output-format', 'stream-json', '--mode', 'accept-edits']);
  assert.deepStrictEqual(providers.buildArgs('antigravity', { mode: 'plan', model: 'gemini-3.8-flash-high', sessionId: 'c1', includeDirs: ['/a', '/b'] }), ['--output-format', 'stream-json', '--mode', 'plan', '--model', 'gemini-3.8-flash-high', '--conversation', 'c1', '--add-dir', '/a', '--add-dir', '/b']);
  assert.deepStrictEqual(providers.antigravityPolicy('bypassPermissions'), ['--dangerously-skip-permissions']);
  assert.deepStrictEqual(providers.antigravityPolicy('default'), []);
  assert.strictEqual(providers.promptViaArg('antigravity'), false);
  // Cursor は指示を最後の引数で渡す（「-」で始まる指示はオプションに見えないよう空白を付ける）
  assert.deepStrictEqual(providers.buildArgs('cursor', { mode: 'acceptEdits', prompt: 'やって' }), ['-p', '--output-format', 'stream-json', '--trust', '--force', 'やって']);
  assert.deepStrictEqual(providers.buildArgs('cursor', { mode: 'plan', model: 'gpt-5', sessionId: 'c1', prompt: '-x' }), ['-p', '--output-format', 'stream-json', '--trust', '--mode', 'plan', '--model', 'gpt-5', '--resume', 'c1', ' -x']);
  assert.deepStrictEqual(providers.cursorPolicy('bypassPermissions'), ['--force', '--approve-mcps']);
  assert.strictEqual(providers.promptViaArg('cursor'), true);
  assert.strictEqual(providers.promptViaArg('codex'), false);
  assert.deepStrictEqual(providers.cleanCompeteAgents(['codex', 'x', 'codex', 'gemini']), ['codex', 'gemini']);
  assert.deepStrictEqual(providers.cleanRelaySteps([{ agent: 'nope', instruction: 'a' }, { label: '', instruction: '' }]), [{ agent: 'claude', label: '工程1', instruction: 'a' }]);
  // ほかのエージェントにはスキルを「/名前」ではなく SKILL.md の場所で伝える
  assert.strictEqual(promptWithSkill('claude', 'deploy', 'x'), '/deploy x');
  assert.match(promptWithSkill('codex', 'deploy', 'x'), /SKILL\.md[\s\S]*\n\nx$/);
});

test('providers: Gemini の少しずつ届く発言はまとめ、Codex のイベントを共通の形に直す', () => {
  const gp = providers.createParser('gemini');
  assert.deepStrictEqual(gp.onEvent({ type: 'message', role: 'assistant', content: 'a', delta: true }), []);
  gp.onEvent({ type: 'message', role: 'assistant', content: 'b', delta: true });
  const a = gp.onEvent({ type: 'tool_use', tool_name: 'run_shell_command', parameters: { command: 'ls' } });
  assert.deepStrictEqual(a.map((x) => x.type), ['text', 'tool']);
  assert.strictEqual(a[0].text, 'ab');
  assert.deepStrictEqual(gp.onEvent({ type: 'result', status: 'error', error: { message: 'x' } }), [{ type: 'result', error: 'x' }]);
  const cp = providers.createParser('codex');
  assert.deepStrictEqual(cp.onEvent({ type: 'thread.started', thread_id: 't' }), [{ type: 'session', id: 't' }]);
  const r = cp.onEvent({ type: 'item.completed', item: { id: '1', type: 'command_execution', command: 'false', exit_code: 1, aggregated_output: 'no' } });
  assert.deepStrictEqual(r.map((x) => x.type), ['tool', 'tool_result']);
  assert.strictEqual(r[1].error, true);
  assert.deepStrictEqual(cp.onEvent({ type: 'turn.failed', error: { message: 'bad' } }), [{ type: 'result', error: 'bad' }]);
});

test('Antigravity のタスク: 指示を stdin で渡して worktree で動き、追加指示は --conversation で続ける', async () => {
  const { agents, calls } = setup();
  const [c] = agents.createTask({ title: 'ag', prompt: 'アンチグラビティで作って', agent: 'antigravity' });
  assert.strictEqual(c.agent, 'antigravity');
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  assert.match(c.sessionId, /^agy-conv-/);
  assert.strictEqual(c.sessions[0].agent, 'antigravity');
  assert.match(c.lastText, /antigravity done/);
  assert.ok(c.logs.some((l) => l.kind === 'text' && l.agent === 'antigravity' && l.text.trim() === 'ファイルを作ります'));
  assert.ok(c.logs.some((l) => l.kind === 'tool' && /^Write/.test(l.text)));
  assert.match(await agents.diff(c.id), /アンチグラビティで作って/);
  const first = calls().filter((x) => x.kind === 'antigravity')[0].args;
  assert.deepStrictEqual(first.slice(0, 4), ['--output-format', 'stream-json', '--mode', 'accept-edits']);
  assert.ok(!first.includes('アンチグラビティで作って'), '指示は引数に入れない');
  const sid = c.sessionId;
  agents.send(c.id, 'もう1つ');
  await waitFor(() => c.status === 'review' && calls().filter((x) => x.kind === 'antigravity').length === 2);
  const second = calls().filter((x) => x.kind === 'antigravity')[1].args;
  assert.strictEqual(second[second.indexOf('--conversation') + 1], sid);
});

test('Antigravity のタスク: 失敗はエラー列に', async () => {
  const { agents } = setup();
  const [c] = agents.createTask({ title: 'ag', prompt: '[fail] アンチグラビティ', agent: 'antigravity' });
  agents.start(c.id);
  await waitFor(() => c.status === 'failed');
  assert.strictEqual(c.error, 'agy boom');
});

test('providers: Cursor のイベントを共通の形に直す', () => {
  const p = providers.createParser('cursor', { summarize: (x) => (x && (x.command || x.path || x.query)) || JSON.stringify(x) });
  assert.deepStrictEqual(p.onEvent({ type: 'system', subtype: 'init', session_id: 'abc', model: 'GPT-5' }), [{ type: 'session', id: 'abc', model: 'GPT-5' }]);
  assert.deepStrictEqual(p.onEvent({ type: 'user', message: { content: [{ type: 'text', text: '指示' }] } }), []);
  assert.deepStrictEqual(p.onEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } }), []);
  p.onEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'b' }] } });
  const st = p.onEvent({ type: 'tool_call', subtype: 'started', call_id: '1', tool_call: { shellToolCall: { args: { command: 'npm test' } } } });
  assert.deepStrictEqual(st, [{ type: 'text', text: 'ab' }, { type: 'tool', name: 'Bash', summary: 'npm test' }]);
  const done = p.onEvent({ type: 'tool_call', subtype: 'completed', call_id: '1', tool_call: { shellToolCall: { args: { command: 'npm test' }, result: { success: { exitCode: 1, stdout: 'fail', stderr: '' } } } } });
  assert.deepStrictEqual(done, [{ type: 'tool_result', text: 'fail', error: true }]);
  // started が来なかったツールは completed で出す。中身が JSON 文字列のツール（MCP など）も読む
  const fn = p.onEvent({ type: 'tool_call', subtype: 'completed', call_id: '2', tool_call: { function: { name: 'lookup', arguments: '{"query":"q"}' } } });
  assert.deepStrictEqual(fn, [{ type: 'tool', name: 'lookup', summary: 'q' }, { type: 'tool_result', text: 'ok', error: false }]);
  const rd = p.onEvent({ type: 'tool_call', subtype: 'completed', call_id: '3', tool_call: { readToolCall: { args: { path: 'a.js' }, result: { error: { message: 'no file' } } } } });
  assert.deepStrictEqual(rd.map((x) => [x.type, x.name || x.text]), [['tool', 'Read'], ['tool_result', 'no file']]);
  assert.deepStrictEqual(p.onEvent({ type: 'result', subtype: 'success', is_error: false, result: 'ab' }), [{ type: 'result' }]);
  assert.deepStrictEqual(p.onEvent({ type: 'result', subtype: 'error', is_error: true, result: 'bad' }), [{ type: 'result', error: 'bad' }]);
});

test('Cursor のタスク: 指示を引数で渡して worktree で動き、追加指示は --resume で続ける', async () => {
  const { agents, calls } = setup();
  const [c] = agents.createTask({ title: 'cu', prompt: 'カーソルで作って', agent: 'cursor' });
  assert.strictEqual(c.agent, 'cursor');
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  assert.match(c.sessionId, /^cursor-chat-/);
  assert.strictEqual(c.sessions[0].agent, 'cursor');
  assert.match(c.lastText, /cursor done/);
  assert.ok(c.logs.some((l) => l.kind === 'text' && l.agent === 'cursor' && l.text === 'ファイルを作ります'));
  assert.ok(c.logs.some((l) => l.kind === 'tool' && /^Write/.test(l.text)));
  assert.match(await agents.diff(c.id), /カーソルで作って/);
  const first = calls().filter((x) => x.kind === 'cursor')[0].args;
  assert.ok(first.includes('--force') && first.includes('--trust'));
  assert.strictEqual(first[first.length - 1], 'カーソルで作って');
  const sid = c.sessionId;
  agents.send(c.id, 'もう1つ');
  await waitFor(() => c.status === 'review' && calls().filter((x) => x.kind === 'cursor').length === 2);
  const second = calls().filter((x) => x.kind === 'cursor')[1].args;
  assert.strictEqual(second[second.indexOf('--resume') + 1], sid);
  assert.strictEqual(second[second.length - 1], 'もう1つ');
});

test('Cursor のタスク: 失敗はエラー列に', async () => {
  const { agents } = setup();
  const [c] = agents.createTask({ title: 'cu', prompt: '[fail] カーソル', agent: 'cursor' });
  agents.start(c.id);
  await waitFor(() => c.status === 'failed');
  assert.strictEqual(c.error, 'cursor boom');
});

test('Codex のタスク: worktree で動いてコミットし、追加指示は同じ会話の続き（resume）', async () => {
  const { agents, calls } = setup();
  const [c] = agents.createTask({ title: 'cx', prompt: 'コーデックスで作って', agent: 'codex' });
  assert.strictEqual(c.agent, 'codex');
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  assert.match(c.sessionId, /^codex-thread-/);
  assert.strictEqual(c.sessions[0].agent, 'codex');
  assert.match(c.lastText, /codex done/);
  assert.ok(c.logs.some((l) => l.kind === 'text' && l.agent === 'codex'));
  assert.ok(c.logs.some((l) => l.kind === 'tool' && /^Bash/.test(l.text)));
  assert.match(await agents.diff(c.id), /コーデックスで作って/);
  // 終わったあとは btw ではなく追加指示
  assert.throws(() => agents.btw(c.id, 'x'), /追加指示/);
  const sid = c.sessionId;
  agents.send(c.id, 'もう1つ');
  await waitFor(() => c.status === 'review' && calls().filter((x) => x.kind === 'codex').length === 2);
  const second = calls().filter((x) => x.kind === 'codex')[1].args;
  assert.deepStrictEqual(second.slice(0, 2), ['exec', 'resume']);
  assert.strictEqual(second[second.length - 2], sid);
  // Codex のカードで、Claude Code の会話は選べない
  assert.throws(() => agents.setSession(c.id, { mode: 'resume', id: 'claude-sess' }), /続けられません/);
});

test('Codex の実行中 btw: 今の作業は続け、終わったあとに追加指示として送る', async () => {
  const { agents, calls } = setup();
  process.env.FAKE_SLEEP = '600';
  try {
    const [c] = agents.createTask({ title: 'cx-btw', prompt: 'コーデックスで作って', agent: 'codex' });
    agents.start(c.id);
    await waitFor(() => c.status === 'running' && !!c.sessionId);
    const sid = c.sessionId;
    agents.btw(c.id, 'テストも書いて');
    assert.strictEqual(c.btw[0].state, 'follow');
    agents.btw(c.id, 'コメントも');
    assert.strictEqual(c.btw[1].state, 'follow');
    // 1回目が終わるまで追加指示は走らない
    assert.strictEqual(calls().filter((x) => x.kind === 'codex').length, 1);
    await waitFor(() => c.status === 'review' && c.btw[0].state === 'delivered' && calls().filter((x) => x.kind === 'codex').length === 2);
    assert.strictEqual(c.btw[0].state, 'delivered');
    assert.strictEqual(c.btw[1].state, 'delivered');
    const second = calls().filter((x) => x.kind === 'codex')[1].args;
    assert.deepStrictEqual(second.slice(0, 2), ['exec', 'resume']);
    assert.strictEqual(second[second.length - 2], sid);
    assert.match(await agents.diff(c.id), /テストも書いて/);
    assert.match(await agents.diff(c.id), /コメントも/);
    assert.ok(c.logs.some((l) => l.kind === 'system' && /追加指示として送ります/.test(l.text)));
  } finally {
    delete process.env.FAKE_SLEEP;
  }
});

test('Codex の実行中 btw: 停止したときは予約した btw を送らない', async () => {
  const { agents, calls } = setup();
  process.env.FAKE_SLEEP = '3000';
  try {
    const [c] = agents.createTask({ title: 'cx-btw-stop', prompt: 'コーデックスで作って', agent: 'codex' });
    agents.start(c.id);
    await waitFor(() => c.status === 'running' && !!c.sessionId);
    agents.btw(c.id, 'テストも書いて');
    assert.strictEqual(c.btw[0].state, 'follow');
    agents.stop(c.id);
    await waitFor(() => c.status === 'review' && c.btw[0].state === 'lost');
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(c.status, 'review');
    assert.strictEqual(calls().filter((x) => x.kind === 'codex').length, 1);
    assert.ok(c.logs.some((l) => l.kind === 'system' && /送りませんでした/.test(l.text)));
  } finally {
    delete process.env.FAKE_SLEEP;
  }
});

test('Gemini のタスク: 失敗はエラー列に、見つからないとわかりやすいエラー', async () => {
  const { agents, store } = setup();
  const [c] = agents.createTask({ title: 'gm', prompt: '[fail] ジェミニ', agent: 'gemini' });
  agents.start(c.id);
  await waitFor(() => c.status === 'failed');
  assert.strictEqual(c.error, 'gemini boom');
  assert.match(c.sessionId, /^gemini-sess-/);
  assert.ok(c.logs.some((l) => l.kind === 'text' && l.text === 'ファイルを作ります'));

  store.settings.geminiPath = '/nope/gemini';
  const [d] = agents.createTask({ title: 'gm2', prompt: 'x', agent: 'gemini' });
  agents.start(d.id);
  await waitFor(() => d.status === 'failed');
  assert.match(d.error, /gemini コマンドが見つかりません/);
});

test('Pipeline: Codex で実装 → Claude でレビューと、同じ worktree で順番に引き継ぐ', async () => {
  const { agents, store } = setup();
  useSteps(store, [
    { agent: 'codex', label: '実装', instruction: '実装して' },
    { agent: 'gemini', label: 'テスト', instruction: 'テストして' },
    { agent: 'claude', label: 'レビュー', instruction: 'レビューして' },
  ]);
  const [c] = agents.createTask({ title: 'relay', prompt: 'Pipelineのタスク', agent: 'relay' });
  assert.strictEqual(c.agent, 'codex');
  agents.start(c.id);
  const wt = await waitFor(() => c.worktreePath);
  await waitFor(() => c.status === 'review' && c.relay.index === 2);
  assert.strictEqual(c.agent, 'claude');
  assert.strictEqual(c.worktreePath, wt, '同じ worktree のまま');
  assert.deepStrictEqual(c.relay.history.map((h) => h.agent), ['codex', 'gemini']);
  assert.match(c.relay.history[0].report, /codex done/);
  // ワークフロー表示のため、工程ごとの開始・終了の時刻と金額を残す
  for (const h of c.relay.history) {
    assert.ok(h.startedAt && h.at >= h.startedAt, '工程の開始と終了の時刻');
    assert.strictEqual(typeof h.costUsd, 'number');
  }
  assert.ok(c.relay.stepStartedAt >= c.relay.history[1].at, '今の工程の開始時刻');
  // レビュー待ちの通知はPipelineが終わったときの1回だけ
  assert.strictEqual(store.notifications.filter((n) => n.cardId === c.id && n.kind === 'review').length, 1);
  // 3つの工程の変更がすべてブランチに入っている
  const diff = await agents.diff(c.id);
  assert.match(diff, /工程 1\/3「実装」/);
  assert.match(diff, /工程 2\/3「テスト」/);
  assert.match(diff, /codex done/, '前の工程の報告を次の工程に渡す');
  assert.match(diff, /工程 3\/3「レビュー」/);
  assert.match(c.sessionId, /^sess-new-/);
  assert.deepStrictEqual(c.sessions.map((x) => x.agent), ['codex', 'gemini', 'claude']);
  // Pipelineが終わったあとの追加指示は、最後の工程のエージェント（Claude）が続ける
  agents.send(c.id, '追加');
  await waitFor(() => c.status === 'review' && c.logs.filter((l) => l.kind === 'result').length === 4);
  assert.strictEqual(c.relay.index, 2);
});

test('Pipeline: 途中の工程が失敗したら止まり、追加指示で直すと続きの工程へ進む', async () => {
  const { agents, store } = setup();
  useSteps(store, [
    { agent: 'codex', label: '実装', instruction: '' },
    { agent: 'gemini', label: '仕上げ', instruction: '' },
  ]);
  const [c] = agents.createTask({ title: 'relay2', prompt: '[fail] だめ', agent: 'relay' });
  agents.start(c.id);
  await waitFor(() => c.status === 'failed');
  assert.strictEqual(c.relay.index, 0);
  assert.strictEqual(c.agent, 'codex');
  agents.send(c.id, 'もう一度');
  await waitFor(() => c.status === 'review' && c.relay.index === 1);
  assert.strictEqual(c.agent, 'gemini');
});

test('Pipeline: 分岐・ループの設定を整える（落とした工程の分だけ行き先を詰める・上限は 1〜10）', () => {
  const steps = providers.cleanRelaySteps([
    { agent: 'codex', label: '実装', instruction: '' },
    { label: '', instruction: '' }, // 落とす
    { agent: 'claude', label: 'レビュー', instruction: '', onPass: 'end', onFail: 0, maxLoops: 99 },
    { agent: 'claude', label: 'x', instruction: '', onFail: 1 }, // 落とした工程を指す → 次の工程
    { agent: 'claude', label: 'y', instruction: '', onPass: 2, maxLoops: 'a' },
  ]);
  assert.deepStrictEqual(steps[1], { agent: 'claude', label: 'レビュー', instruction: '', onPass: 'end', onFail: 0, maxLoops: 10 });
  assert.deepStrictEqual(steps[2], { agent: 'claude', label: 'x', instruction: '' });
  assert.deepStrictEqual(steps[3], { agent: 'claude', label: 'y', instruction: '', onPass: 1, maxLoops: 3 });
  assert.strictEqual(providers.relayJudges(steps[1]), true);
  assert.strictEqual(providers.relayJudges(steps[0]), false);
});

test('Pipeline: ループ — レビューで差し戻されたら実装に戻り、合格したら終える', async () => {
  const { agents, store } = setup();
  useSteps(store, [
    { agent: 'gemini', label: '実装', instruction: '実装して' },
    { agent: 'codex', label: 'レビュー', instruction: 'レビューして', onFail: 0, maxLoops: 3 },
  ]);
  const [c] = agents.createTask({ title: 'loop', prompt: '[judge] ループのタスク', agent: 'relay' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.relay.done, 20000);
  assert.deepStrictEqual(c.relay.history.map((h) => [h.index, h.run, h.result || null]), [[0, 1, null], [1, 1, 'fail'], [0, 2, null]]);
  assert.strictEqual(c.relay.index, 1);
  assert.strictEqual(c.relay.lastResult, 'pass');
  assert.deepStrictEqual(c.relay.counts, { e5: 1 }, 'レビューの差し戻しから実装へ戻る線を1回通った');
  assert.ok(!c.relay.limitReached);
  assert.strictEqual(store.notifications.filter((n) => n.cardId === c.id && n.kind === 'review').length, 1);
  const diff = await agents.diff(c.id);
  assert.match(diff, /工程 1\/2「実装」（2回目）/, '戻ってきた工程は2回目と分かる');
  assert.match(diff, /差し戻し）の報告/, '差し戻しの報告を実装に渡す');
  assert.match(diff, /\[\[RESULT:pass\]\]/, '判定の値の書き方を伝える');
});

test('Pipeline: ループの上限に達したら、Pipelineを終えてレビューに回す（その後の追加指示では進まない）', async () => {
  const { agents, store } = setup();
  useSteps(store, [
    { agent: 'gemini', label: '実装', instruction: '' },
    { agent: 'codex', label: 'レビュー', instruction: '', onFail: 0, maxLoops: 1 },
  ]);
  const [c] = agents.createTask({ title: 'limit', prompt: '[judge-always-fail] だめなタスク', agent: 'relay' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.relay.done, 20000);
  assert.strictEqual(c.relay.limitReached, true);
  assert.deepStrictEqual(c.relay.history.map((h) => h.index), [0, 1, 0]);
  assert.ok(c.logs.some((l) => /戻れる上限（1回）に達した/.test(l.text)));
  assert.ok(store.notifications.some((n) => n.cardId === c.id && /ループの上限/.test(n.title)));
  agents.send(c.id, '追加');
  await waitFor(() => c.status === 'review' && c.logs.filter((l) => l.kind === 'result').length === 5, 20000);
  assert.strictEqual(c.relay.index, 1);
  assert.strictEqual(c.relay.history.length, 3);
});

test('Pipeline: 分岐 — 判定で行き先を変え、飛ばした工程は動かさない', async () => {
  const { agents, store } = setup();
  useSteps(store, [
    { agent: 'codex', label: '確認', instruction: '', onFail: 2 },
    { agent: 'gemini', label: '飛ばす', instruction: '' },
    { agent: 'gemini', label: '直す', instruction: '' },
  ]);
  const [c] = agents.createTask({ title: 'branch', prompt: '[judge] 分岐のタスク', agent: 'relay' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.relay.done, 20000);
  assert.deepStrictEqual(c.relay.history.map((h) => [h.index, h.result]), [[0, 'fail']]);
  assert.strictEqual(c.relay.index, 2);
  assert.deepStrictEqual(c.sessions.map((x) => x.agent), ['codex', 'gemini']);
});

test('Pipeline: 判定する工程の返事に値がなければ、「どれにも合わないとき」の線（合格）へ進む', async () => {
  const { agents, store } = setup();
  useSteps(store, [
    { agent: 'gemini', label: '確認', instruction: '', onFail: 'end' },
    { agent: 'codex', label: '実装', instruction: '' },
  ]);
  const [c] = agents.createTask({ title: 'nomark', prompt: '印なし', agent: 'relay' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.relay.done, 20000);
  assert.deepStrictEqual(c.relay.history.map((h) => [h.index, h.result]), [[0, undefined]]);
  assert.ok(c.logs.some((l) => /判定の値.*がなかったので.*どれにも合わないとき/.test(l.text)));
});

test('競争: 同じタスクを複数のエージェントで並列に解き、比べて1つを採用する', async () => {
  const { agents, store, g } = setup();
  store.settings.orchestration = 'compete';
  store.settings.competeAgents = ['claude', 'codex', 'gemini'];
  const cards = agents.createTask({ title: 'race', prompt: '競争のタスク', agent: 'compete' });
  assert.deepStrictEqual(cards.map((c) => c.agent), ['claude', 'codex', 'gemini']);
  assert.deepStrictEqual(cards.map((c) => c.title), ['race [Claude]', 'race [Codex]', 'race [Gemini]']);
  for (const c of cards) agents.start(c.id);
  await waitFor(() => cards.every((c) => c.status === 'review'));
  assert.strictEqual(new Set(cards.map((c) => c.worktreePath)).size, 3, 'それぞれ別の worktree');
  assert.strictEqual(new Set(cards.map((c) => c.branch)).size, 3);
  // 全員が終わったら一度だけ知らせる
  await waitFor(() => store.notifications.some((n) => /競争の結果がそろいました/.test(n.title)));
  assert.strictEqual(store.notifications.filter((n) => /競争の結果がそろいました/.test(n.title)).length, 1);
  assert.strictEqual(agents.competitors(cards[1].id).length, 3);

  // Claude に比べてもらう会話（候補のブランチを渡す）
  const chat = agents.compareCompetitors(cards[0].id);
  assert.strictEqual(chat.kind, 'chat');
  for (const c of cards) assert.ok(chat.prompt.includes(c.branch));
  await waitFor(() => chat.status === 'review');

  // Codex の案を採用 → ほかは worktree とブランチごと破棄
  const [cl, cx, gm] = cards;
  const removed = await agents.adoptCompetitor(cx.id);
  assert.strictEqual(removed, 2);
  assert.strictEqual(store.card(cl.id), undefined);
  assert.strictEqual(store.card(gm.id), undefined);
  assert.ok(!fs.existsSync(cl.worktreePath));
  assert.ok(!g('branch').toString().includes(gm.branch));
  assert.strictEqual(cx.compete.adopted, true);
  await agents.merge(cx.id);
  assert.strictEqual(cx.status, 'done');
});

test('競争: 採用しても、完了した候補は削除せずに残す', async () => {
  const { agents, store } = setup();
  store.settings.orchestration = 'compete';
  store.settings.competeAgents = ['claude', 'codex'];
  const [cl, cx] = agents.createTask({ title: 'race2', prompt: '競争のタスク', agent: 'compete' });
  for (const c of [cl, cx]) agents.start(c.id);
  await waitFor(() => cl.status === 'review' && cx.status === 'review');
  cl.status = 'done'; // もう取り込んだ候補
  assert.strictEqual(await agents.adoptCompetitor(cx.id), 0);
  assert.ok(store.card(cl.id), '完了した候補はボードに残る');
  assert.strictEqual(cx.compete.adopted, true);
  await assert.rejects(agents.discard(cl.id), /完了したタスクは削除できません/);
});

test('競争: エージェントが2つ未満ならエラー。Issue からも競争で作れる', async () => {
  const { agents, store } = setup();
  store.settings.orchestration = 'compete';
  store.settings.competeAgents = ['codex'];
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete' }), /2つ以上/);
  store.settings.competeAgents = ['codex', 'gemini'];
  agents.fetchIssue = async (_r, n) => ({ number: n, title: `Issue ${n}`, body: 'body', url: `https://github.com/o/r/issues/${n}`, state: 'open', labels: [], comments: [] });
  const { cards } = await agents.createFromIssues({ numbers: '5', agent: 'compete' });
  assert.deepStrictEqual(cards.map((c) => c.agent), ['codex', 'gemini']);
  assert.ok(cards.every((c) => c.issue.number === 5));
});

test('使うエージェント: チェックを付けていないエージェントでは、タスク・会話・Pipeline・競争を作れない', async () => {
  const { agents, store } = setup();
  store.settings.enabledAgents = ['claude', 'codex'];
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'gemini' }), /使わない設定/);
  assert.throws(() => agents.createChat({ message: 'x', agent: 'gemini' }), /使わない設定/);
  useSteps(store, [
    { agent: 'codex', label: '実装', instruction: '' },
    { agent: 'gemini', label: 'テスト', instruction: '' },
  ]);
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'relay' }), /工程「テスト」の Gemini CLI は使わない設定/);
  // 競争は使うエージェントだけで（2つ未満ならエラー）
  store.settings.orchestration = 'compete';
  store.settings.competeAgents = ['claude', 'codex', 'gemini'];
  assert.deepStrictEqual(agents.createTask({ prompt: 'x', agent: 'compete' }).map((c) => c.agent), ['claude', 'codex']);
  store.settings.enabledAgents = ['codex'];
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete' }), /2つ以上/);
  // エージェントを指定しなければ、最初から選んでおくエージェント（使わない設定なら、使うものの先頭）
  store.settings.defaultAgent = 'claude';
  assert.strictEqual(agents.createTask({ prompt: 'y' })[0].agent, 'codex');
  assert.strictEqual(agents.createChat({ message: 'y' }).agent, 'codex');
});

test('Pipelineと競争は排他: 設定で選んだ方だけ使え、もう片方ではタスクを作れない', async () => {
  const { agents, store } = setup();
  useSteps(store, [{ agent: 'codex', label: '実装', instruction: '' }]);
  store.settings.competeAgents = ['claude', 'codex'];
  // 初期値はPipeline
  assert.strictEqual(store.settings.orchestration, 'relay');
  assert.strictEqual(agents.createTask({ prompt: 'x', agent: 'relay' }).length, 1);
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete' }), /競争は使わない設定/);
  // 競争に切り替えると、Pipelineは使えない
  store.settings.orchestration = 'compete';
  assert.strictEqual(agents.createTask({ prompt: 'x', agent: 'compete' }).length, 2);
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'relay' }), /Pipelineは使わない設定/);
  // 「なし」にすると、Pipelineも競争も使えない
  store.settings.orchestration = 'none';
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'relay' }), /Pipelineは使わない設定/);
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete' }), /競争は使わない設定/);
  // 1つのエージェントのタスクは、どれを選んでいても作れる
  assert.strictEqual(agents.createTask({ prompt: 'x', agent: 'claude' })[0].agent, 'claude');
  // 知らない値はPipelineに直す
  const s1 = { orchestration: 'both', enabledAgents: ['claude'] };
  migrateSettings(s1, s1, []);
  assert.strictEqual(s1.orchestration, 'relay');
  assert.strictEqual(providers.cleanOrchestration('compete'), 'compete');
  assert.strictEqual(providers.cleanOrchestration('none'), 'none');
  const s2 = { orchestration: 'none', enabledAgents: ['claude'] };
  migrateSettings(s2, s2, []);
  assert.strictEqual(s2.orchestration, 'none');
});

test('使うエージェント: 前のバージョンの設定は、使っていたエージェントにチェックを付け、最初のエージェントからPipeline・競争を外す', () => {
  const s1 = { defaultAgent: 'relay', relaySteps: [{ agent: 'codex', label: 'a', instruction: '' }], competeAgents: ['claude', 'gemini'] };
  migrateSettings(s1, { defaultAgent: 'relay' }, []);
  assert.deepStrictEqual(s1.enabledAgents, ['claude', 'codex']);
  assert.strictEqual(s1.defaultAgent, 'claude');
  const s2 = { defaultAgent: 'gemini', relaySteps: [], competeAgents: [] };
  migrateSettings(s2, { defaultAgent: 'gemini' }, [{ agent: 'codex' }]);
  assert.deepStrictEqual(s2.enabledAgents, ['claude', 'codex', 'gemini']);
  assert.strictEqual(s2.defaultAgent, 'gemini');
  // 保存してある「使うエージェント」はそのまま。最初のエージェントが使わない設定なら、使うものの先頭
  const s3 = { defaultAgent: 'claude', enabledAgents: ['gemini'] };
  migrateSettings(s3, { enabledAgents: ['gemini'] }, []);
  assert.deepStrictEqual(s3.enabledAgents, ['gemini']);
  assert.strictEqual(s3.defaultAgent, 'gemini');
  assert.deepStrictEqual(providers.cleanEnabledAgents([]), ['claude'], '1つもなければ Claude Code');
});

test('Claude 以外でも: 会話・ブランチの命名・競争の比較・スキルの提案ができる', async () => {
  const { agents, store, g } = setup();
  store.settings.defaultAgent = 'codex';
  // 会話
  const chat = agents.createChat({ message: '構成を教えて' });
  assert.strictEqual(chat.agent, 'codex');
  await waitFor(() => chat.status === 'review');
  assert.match(chat.lastText, /codex done: 構成を教えて/);
  // ブランチの命名規則（Gemini のタスクなら Gemini に聞く）
  store.settings.branchNamingRule = 'feature/<内容> にする';
  const [c] = agents.createTask({ title: 'gm', prompt: 'ジェミニで作る', agent: 'gemini' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  assert.strictEqual(c.branch, 'feature/fake-gemini-branch');
  const [d] = agents.createTask({ title: 'cx', prompt: 'コーデックスで作る', agent: 'codex' });
  agents.start(d.id);
  await waitFor(() => d.status === 'review');
  assert.strictEqual(d.branch, 'feature/fake-codex-branch');
  assert.ok(g('branch').toString().includes('feature/fake-codex-branch'));
  store.settings.branchNamingRule = '';
  // 競争の比較は、最初から選んでおくエージェントに頼む
  store.settings.orchestration = 'compete';
  store.settings.competeAgents = ['codex', 'gemini'];
  const cards = agents.createTask({ title: 'race', prompt: '競争', agent: 'compete' });
  for (const x of cards) agents.start(x.id);
  await waitFor(() => cards.every((x) => x.status === 'review'));
  const cmp = agents.compareCompetitors(cards[0].id);
  assert.strictEqual(cmp.agent, 'codex');
  await waitFor(() => cmp.status === 'review');
  // スキルの提案は、元のタスクのエージェントに頼む
  const sk = agents.suggestSkills(c.id);
  assert.strictEqual(sk.agent, 'gemini');
  await waitFor(() => sk.status === 'review');
});

test('Claude 以外の会話からタスクにすると、会話のやりとりを最初の指示に添えて渡す', async () => {
  const { agents } = setup();
  const chat = agents.createChat({ message: 'ログイン画面の相談', agent: 'codex' });
  await waitFor(() => chat.status === 'review');
  const [t] = agents.createTask({ prompt: '会話の内容で作って', agent: 'gemini', fromChat: chat.id, session: { mode: 'resume', id: chat.sessionId } });
  assert.ok(!t.sessionId, 'Codex の会話のセッションは Gemini には渡さない');
  agents.start(t.id);
  await waitFor(() => t.status === 'review');
  const diff = await agents.diff(t.id);
  assert.match(diff, /これまでの会話/);
  assert.match(diff, /【ユーザー】 ログイン画面の相談/);
  assert.match(diff, /【Codex】 codex done/);
  assert.match(diff, /会話の内容で作って/);
  // Claude Code どうしなら、会話そのもの（セッション）を引き継ぐ
  const cc = agents.createChat({ message: 'claude と相談', agent: 'claude' });
  await waitFor(() => cc.status === 'review');
  const [t2] = agents.createTask({ prompt: '続きを', agent: 'claude', fromChat: cc.id, session: { mode: 'resume', id: cc.sessionId } });
  assert.strictEqual(t2.sessionId, cc.sessionId);
  assert.strictEqual(t2.chatContext, undefined);
});

test('タスク・会話を作るときに選んだモデルで動かす（空なら設定の既定）', async () => {
  const { agents, store, calls } = setup();
  store.settings.codexModel = 'o3';
  const [t] = agents.createTask({ prompt: 'モデルを変えて作って', agent: 'codex', model: ' gpt-5-codex ' });
  assert.strictEqual(t.model, 'gpt-5-codex');
  agents.start(t.id);
  await waitFor(() => t.status === 'review');
  const modelArg = (args) => args[args.indexOf('-m') + 1];
  assert.strictEqual(modelArg(calls().at(-1).args), 'gpt-5-codex');
  // 選ばなければ設定の既定
  const chat = agents.createChat({ message: '相談', agent: 'codex' });
  assert.strictEqual(chat.model, undefined);
  await waitFor(() => chat.status === 'review');
  assert.strictEqual(modelArg(calls().at(-1).args), 'o3');
  // 会話でも選べる
  const chat2 = agents.createChat({ message: '相談2', agent: 'gemini', model: 'gemini-2.5-flash' });
  await waitFor(() => chat2.status === 'review');
  assert.strictEqual(modelArg(calls().at(-1).args), 'gemini-2.5-flash');
  // シェルに渡ると困る文字は受け付けない
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'codex', model: 'gpt; rm -rf /' }), /モデル名/);
  assert.throws(() => agents.createChat({ message: 'x', agent: 'codex', model: '$(whoami)' }), /モデル名/);
  // Pipeline・競争は、設定のモデルを使う
  Object.assign(store.settings, { orchestration: 'compete', competeAgents: ['codex', 'gemini'] });
  const cards = agents.createTask({ prompt: 'くらべて', agent: 'compete', model: 'gpt-5' });
  assert.ok(cards.every((c) => !c.model));
});

test('チェックポイント: 2回動かして1回目の前へ戻すと、あとの変更を捨てて同じ指示を自動でやり直す', async () => {
  const { agents } = setup();
  const [c] = agents.createTask({ title: 'rw', prompt: '一度目の作業' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.checkpoints && c.checkpoints.length === 1);
  const wt = c.worktreePath;
  fs.writeFileSync(path.join(wt, 'manual.txt'), 'hand\n');
  const cost = c.costUsd;
  agents.send(c.id, '二度目だけ');
  await waitFor(() => c.status === 'review' && c.checkpoints.length === 2);
  assert.ok(c.costUsd >= cost);
  const show = execFileSync('git', ['show', `${c.checkpoints[1].commit}:manual.txt`], { cwd: wt, encoding: 'utf8' });
  assert.strictEqual(show, 'hand\n', '起動前の手直しは、その回のチェックポイントに入る');
  const first = c.checkpoints[0];
  const spent = c.costUsd;
  c.lastMessage = '捨てる返事';
  c.rewindPrompt = '画面に出さない指示';
  assert.strictEqual(agents.publicCards().find((x) => x.id === c.id).rewindPrompt, undefined);
  delete c.rewindPrompt;
  await agents.rewind(c.id, first.id);
  assert.notStrictEqual(c.lastMessage, '捨てる返事');
  assert.ok(c.costUsd >= spent, '使った金額は戻さない');
  assert.ok(!c.checkpoints.some((x) => x.id === first.id));
  assert.ok(!fs.existsSync(path.join(wt, 'manual.txt')));
  assert.deepStrictEqual(fs.readdirSync(wt).filter((f) => f.startsWith('out-')), [], '戻した直後は、その時点よりあとのファイルがない');
  assert.ok(c.logs.some((l) => l.kind === 'system' && /戻しました/.test(l.text)));
  assert.ok(c.logsVersion >= 1);
  const pub = agents.publicCards().find((x) => x.id === c.id);
  assert.strictEqual(pub.checkpoints, undefined);
  assert.ok(pub.rewind && pub.rewind.points.length >= 0);
  assert.ok(!JSON.stringify(pub.rewind).includes('二度目だけ'));
  await waitFor(() => c.status === 'review' && c.checkpoints.length >= 1);
  const diff = await agents.diff(c.id);
  assert.match(diff, /一度目の作業/);
  assert.doesNotMatch(diff, /二度目だけ/);
});

test('チェックポイント: Pipeline の工程へ戻すと index と history と counts が戻り、同じ指示で再実行される', async () => {
  const { agents, store } = setup();
  useSteps(store, [
    { agent: 'gemini', label: '実装', instruction: '実装して' },
    { agent: 'codex', label: 'レビュー', instruction: 'レビューして', onFail: 0, maxLoops: 3 },
  ]);
  const [c] = agents.createTask({ title: 'relay-rw', prompt: '[judge] ループのタスク', agent: 'relay' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.relay.done, 20000);
  const again = c.checkpoints.find((x) => x.stepStart && x.relay && x.relay.index === 0 && x.seq > 1);
  assert.ok(again, 'ループで工程の最初に戻った時点');
  await agents.rewind(c.id, again.id);
  assert.strictEqual(c.relay.index, again.relay.index);
  assert.strictEqual(c.relay.history.length, again.relay.historyLen);
  assert.deepStrictEqual(c.relay.counts, again.relay.counts);
  assert.strictEqual(c.relay.done, undefined);
  assert.strictEqual(c.relay.limitReached, undefined);
  assert.strictEqual(c.relay.stepStartedAt, c.startedAt, '戻したあとの実行が、工程の開始時刻になる');
  await waitFor(() => c.lastPromptSent === again.prompt, 20000);
  await waitFor(() => c.status === 'review' && c.relay.done, 20000);
  assert.ok(c.relay.history.length >= again.relay.historyLen);
});

test('チェックポイント: Codex は引き継ぎ文を付けて新しい会話でやり直す', async () => {
  const { agents, calls } = setup();
  const [c] = agents.createTask({ title: 'cx-rw', prompt: '最初の指示', agent: 'codex' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  agents.send(c.id, '二度目の指示');
  await waitFor(() => c.status === 'review' && c.checkpoints.length === 2);
  const cp = c.checkpoints[1];
  assert.ok(cp.session && cp.session.id);
  assert.strictEqual(cp.session.size, undefined, 'Codex の会話はバイト数を持たない');
  await agents.rewind(c.id, cp.id);
  await waitFor(() => c.status === 'review' && c.lastPromptSent && c.lastPromptSent.includes('ここまでのやりとり'));
  assert.ok(c.lastPromptSent.startsWith('## ここまでのやりとり\n'));
  assert.ok(c.lastPromptSent.endsWith('二度目の指示'));
  const handoff = c.lastPromptSent.slice(0, -'二度目の指示'.length);
  assert.match(handoff, /【ユーザー】 最初の指示/);
  assert.match(handoff, /codex done/);
  assert.doesNotMatch(handoff, /二度目の指示/, '送り直す指示は引き継ぎ文に入れない');
  const last = calls().filter((x) => x.kind === 'codex').at(-1);
  assert.notStrictEqual(last.args[1], 'resume');
});

test('チェックポイント: 戻したあとの記録は引き継ぎ文を含まず、もう一度戻しても引き継ぎは一つ', async () => {
  const { agents } = setup();
  const [c] = agents.createTask({ title: 'cx-rw2', prompt: '最初の指示', agent: 'codex' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  agents.send(c.id, '二度目の指示');
  await waitFor(() => c.status === 'review' && c.checkpoints.length === 2);
  await agents.rewind(c.id, c.checkpoints[1].id);
  await waitFor(() => c.status === 'review' && c.checkpoints.some((x) => x.prompt === '二度目の指示'));
  const again = c.checkpoints.find((x) => x.prompt === '二度目の指示');
  assert.ok(again);
  assert.strictEqual(again.label, '二度目の指示');
  assert.ok(!again.prompt.includes('ここまでのやりとり'));
  assert.strictEqual(agents.publicCards().find((x) => x.id === c.id).rewindPrompt, undefined);
  await agents.rewind(c.id, again.id);
  await waitFor(() => c.status === 'review' && !c.checkpoints.some((x) => x.id === again.id) && c.checkpoints.some((x) => x.prompt === '二度目の指示'));
  const sent = c.lastPromptSent;
  assert.strictEqual((sent.match(/## ここまでのやりとり/g) || []).length, 1);
  assert.ok(sent.startsWith('## ここまでのやりとり\n'));
  assert.ok(sent.endsWith('二度目の指示'));
});

test('チェックポイント: forkNext のときは元の会話ファイルを切り詰めない', async () => {
  const { agents, tmp } = setup();
  const configDir = path.join(tmp, 'claude-config');
  agents.opts.claudeConfigFor = async () => configDir;
  const [c] = agents.createTask({ title: 'fork-rw', prompt: '最初' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  const id = 'forksess01';
  const proj = path.join(configDir, 'projects', 'repo');
  fs.mkdirSync(proj, { recursive: true });
  const file = path.join(proj, `${id}.jsonl`);
  const body = '{"type":"user"}\n{"type":"assistant"}\n';
  fs.writeFileSync(file, body);
  agents.setSession(c.id, { mode: 'resume', id, title: '元の会話' });
  assert.strictEqual(c.forkNext, true);
  agents.send(c.id, 'フォークして続ける');
  await waitFor(() => c.status === 'review' && c.checkpoints.some((x) => x.forkNext));
  fs.appendFileSync(file, '{"extra":true}\n');
  const grown = fs.readFileSync(file, 'utf8');
  const cp = c.checkpoints.find((x) => x.forkNext);
  await agents.rewind(c.id, cp.id);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), grown);
  assert.strictEqual(c.sessionId, id);
  assert.strictEqual(c.forkNext, true);
  await waitFor(() => c.sessionId === `fork-of-${id}`);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), grown, 'やり直しのあとも元の会話はそのまま');
});

test('チェックポイント: Claude の会話は size まで切り詰めて続きから動かす。ほかのカードが使っていたら切り詰めない', async () => {
  const { agents, tmp } = setup();
  const configDir = path.join(tmp, 'claude-config');
  agents.opts.claudeConfigFor = async () => configDir;
  const [c] = agents.createTask({ title: 'trunc', prompt: '一度目' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.sessionId);
  const sid = c.sessionId;
  const proj = path.join(configDir, 'projects', 'repo');
  fs.mkdirSync(proj, { recursive: true });
  const file = path.join(proj, `${sid}.jsonl`);
  const body = '{"id":"toolu_KEEPKEEP1"}\n{"b":2}\n';
  fs.writeFileSync(file, body);
  const side = path.join(proj, sid);
  fs.mkdirSync(path.join(side, 'tool-results'), { recursive: true });
  fs.mkdirSync(path.join(side, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(side, 'tool-results', 'toolu_KEEPKEEP1.txt'), 'keep');
  fs.writeFileSync(path.join(side, 'tool-results', 'toolu_DROPDROP1.txt'), 'drop');
  fs.writeFileSync(path.join(side, 'subagents', 'agent-abc123def4567890.jsonl'), 'later');
  fs.writeFileSync(path.join(side, 'ccr-tip.json'), '{}');
  agents.send(c.id, '二度目');
  await waitFor(() => c.status === 'review' && c.checkpoints.length === 2);
  const cp = c.checkpoints[1];
  assert.strictEqual(cp.session.size, Buffer.byteLength(body));
  fs.appendFileSync(file, '{"id":"toolu_DROPDROP1","agentId":"abc123def4567890"}\n');
  await agents.rewind(c.id, cp.id);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  assert.ok(fs.existsSync(path.join(side, 'tool-results', 'toolu_KEEPKEEP1.txt')));
  assert.ok(!fs.existsSync(path.join(side, 'tool-results', 'toolu_DROPDROP1.txt')));
  assert.ok(!fs.existsSync(path.join(side, 'subagents', 'agent-abc123def4567890.jsonl')));
  assert.ok(fs.existsSync(path.join(side, 'ccr-tip.json')));
  assert.strictEqual(c.sessionId, sid);
  assert.strictEqual(c.forkNext, false);
  await waitFor(() => c.status === 'review' && c.lastPromptSent === cp.prompt);
  assert.doesNotMatch(c.lastPromptSent, /ここまでのやりとり/);
  assert.strictEqual(c.sessionId, sid);

  fs.appendFileSync(file, '{"d":4}\n');
  const kept = fs.readFileSync(file, 'utf8');
  const [other] = agents.createTask({ title: 'other', prompt: '別' });
  other.sessionId = sid;
  const again = c.checkpoints[c.checkpoints.length - 1];
  await agents.rewind(c.id, again.id);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), kept, 'ほかのカードが使っている会話は切らない');
  await waitFor(() => c.status === 'review' && /ここまでのやりとり/.test(c.lastPromptSent || ''));
  assert.ok(c.lastPromptSent.startsWith('## ここまでのやりとり\n'));
  const handoff = c.lastPromptSent.slice(0, -String(again.prompt || '').length);
  assert.doesNotMatch(handoff, /【ユーザー】 二度目/);
  assert.notStrictEqual(c.sessionId, sid);
});

test('チェックポイント: 会話を切り詰められなくても、戻したカードは新しい会話でやり直す', async () => {
  const { agents, tmp } = setup();
  const configDir = path.join(tmp, 'claude-config');
  agents.opts.claudeConfigFor = async () => configDir;
  const [c] = agents.createTask({ title: 'trunc-fail', prompt: '一度目' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.sessionId);
  const sid = c.sessionId;
  const proj = path.join(configDir, 'projects', 'repo');
  fs.mkdirSync(proj, { recursive: true });
  const file = path.join(proj, `${sid}.jsonl`);
  const body = '{"a":1}\n';
  fs.writeFileSync(file, body);
  agents.send(c.id, '二度目');
  await waitFor(() => c.status === 'review' && c.checkpoints.length === 2 && c.checkpoints[1].session && c.checkpoints[1].session.size);
  const cp = c.checkpoints[1];
  const sessions = require('../src/sessions');
  const orig = sessions.truncateSession;
  let calls = 0;
  sessions.truncateSession = () => {
    calls += 1;
    throw new Error('disk');
  };
  try {
    await agents.rewind(c.id, cp.id);
  } finally {
    sessions.truncateSession = orig;
  }
  assert.strictEqual(calls, 1);
  assert.ok(!c.checkpoints.some((x) => x.id === cp.id));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  await waitFor(() => c.status === 'review' && /ここまでのやりとり/.test(c.lastPromptSent || ''));
  assert.notStrictEqual(c.sessionId, sid);
});

test('チェックポイント: 実行中と、戻しているあいだは拒否する。ファイルを戻せないときはカードを変えない', async () => {
  const { agents } = setup();
  process.env.FAKE_SLEEP = '1500';
  try {
    const [running] = agents.createTask({ title: 'run', prompt: '作業中' });
    agents.start(running.id);
    await waitFor(() => running.status === 'running' && running.sessionId);
    await assert.rejects(() => agents.rewind(running.id, 'x'), /実行中/);
    agents.stop(running.id);
    await waitFor(() => running.status === 'review');
  } finally {
    delete process.env.FAKE_SLEEP;
  }

  const [c] = agents.createTask({ title: 'guard', prompt: '守る' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.checkpoints.length === 1);
  agents.rewinding.add(c.id);
  assert.throws(() => agents.send(c.id, 'x'), /戻しているところです/);
  assert.throws(() => agents.moveCard(c.id, 'done'), /戻しているところです/);
  await assert.rejects(() => agents.merge(c.id), /戻しているところです/);
  await assert.rejects(() => agents.createPullRequest(c.id), /戻しているところです/);
  await assert.rejects(() => agents.discard(c.id), /戻しているところです/);
  await assert.rejects(() => agents.rewind(c.id, c.checkpoints[0].id), /戻しているところです/);
  agents.rewinding.delete(c.id);
  assert.strictEqual(c.status, 'review');

  const cp = c.checkpoints[0];
  const logs = c.logs.length;
  cp.commit = 'a'.repeat(40);
  await assert.rejects(() => agents.rewind(c.id, cp.id), /コミットが見つかりません/);
  assert.strictEqual(c.status, 'review');
  assert.strictEqual(c.logs.length, logs);
  cp.commit = null;
  await assert.rejects(() => agents.rewind(c.id, cp.id), /コミットがありません/);
  assert.strictEqual(c.logs.length, logs);

  const wt = c.worktreePath;
  execFileSync('git', ['checkout', '-q', '--detach'], { cwd: wt });
  cp.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
  await assert.rejects(() => agents.rewind(c.id, cp.id), /ブランチ/);
  execFileSync('git', ['checkout', '-q', c.branch], { cwd: wt });
  const gitDir = path.resolve(wt, execFileSync('git', ['rev-parse', '--git-dir'], { cwd: wt, encoding: 'utf8' }).trim());
  fs.writeFileSync(path.join(gitDir, 'MERGE_HEAD'), `${cp.commit}\n`);
  await assert.rejects(() => agents.rewind(c.id, cp.id), /途中なので戻せません/);
  fs.rmSync(path.join(gitDir, 'MERGE_HEAD'));
  assert.strictEqual(c.status, 'review');
  assert.strictEqual(c.logs.length, logs);
});

test('チェックポイント: 中断の再開・コンフリクト解消・完了後の会話は記録しない', async () => {
  const { agents, store } = setup();
  const [c] = agents.createTask({ title: 'skip', prompt: '一度だけ' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.checkpoints.length === 1);
  const n = c.checkpoints.length;
  c.status = 'running';
  const agents2 = new AgentManager(store, agents.opts);
  assert.ok(c.interrupted);
  agents2.resume(c.id);
  await waitFor(() => c.status === 'review' && !c.interrupted);
  assert.strictEqual(c.checkpoints.length, n, '中断からの再開は記録しない');

  c.conflict = { resolving: true, target: 'main', files: [] };
  agents.send(c.id, '解消して');
  await waitFor(() => c.status === 'review' && !c.conflict);
  assert.strictEqual(c.checkpoints.length, n, 'コンフリクト解消の実行は記録しない');

  c.status = 'done';
  agents.send(c.id, '完了後の質問');
  await waitFor(() => c.status === 'done' && /完了後の質問/.test(c.lastPromptSent || ''));
  assert.strictEqual(c.checkpoints.length, n, '完了後の会話は記録しない');
});

test('チェックポイント: マージ途中の追加指示ではコミットせず、MERGE_HEAD とマーカーを残す', async () => {
  const { agents, repo } = setup();
  const [c] = agents.createTask({ title: 'merge-cp', prompt: '一度目' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.checkpoints && c.checkpoints.length === 1);
  const wt = c.worktreePath;
  const commit = (cwd, msg) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg], { cwd });
  fs.writeFileSync(path.join(wt, 'conflict.txt'), 'branch\n');
  execFileSync('git', ['add', 'conflict.txt'], { cwd: wt });
  commit(wt, 'branch side');
  fs.writeFileSync(path.join(repo, 'conflict.txt'), 'main\n');
  execFileSync('git', ['add', 'conflict.txt'], { cwd: repo });
  commit(repo, 'main side');
  let merged = false;
  try {
    execFileSync('git', ['merge', '--no-ff', 'main'], { cwd: wt, encoding: 'utf8' });
    merged = true;
  } catch {
    /* コンフリクトで終了コード 1 */
  }
  assert.strictEqual(merged, false);
  const gitDir = path.resolve(wt, execFileSync('git', ['rev-parse', '--git-dir'], { cwd: wt, encoding: 'utf8' }).trim());
  assert.ok(fs.existsSync(path.join(gitDir, 'MERGE_HEAD')));
  assert.match(fs.readFileSync(path.join(wt, 'conflict.txt'), 'utf8'), /<<<<<<< /);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
  const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
  agents.send(c.id, 'マージ途中の追加');
  await waitFor(() => c.status === 'review' && c.checkpoints.length === 2 && /マージ途中の追加/.test(c.lastPromptSent || ''));
  assert.ok(fs.existsSync(path.join(gitDir, 'MERGE_HEAD')), 'MERGE_HEAD が残る');
  assert.strictEqual(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim(), head);
  assert.strictEqual(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim(), commits, 'マーカー入りのコミットは増えない');
  assert.match(fs.readFileSync(path.join(wt, 'conflict.txt'), 'utf8'), /<<<<<<< /);
  assert.strictEqual(execFileSync('git', ['show', 'HEAD:conflict.txt'], { cwd: wt, encoding: 'utf8' }), 'branch\n');
  assert.strictEqual(c.checkpoints[1].commit, head, '起動直前の HEAD を記録する');
});
