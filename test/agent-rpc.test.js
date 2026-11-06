// Codex（codex app-server）と Cursor（cursor-agent acp）のカードの承認
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Store } = require('../src/store');
const { AgentManager } = require('../src/agent');
const providers = require('../src/providers');
const { codexApprovalPolicy, codexCommand, acpToolInput } = require('../src/agent-rpc');

const FAKE_CLI = path.join(__dirname, 'fake-agent-cli.js');

function setup(t, env = {}, settings = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-rpc-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const bin = (name, pre) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CLI}" ${pre} "$@"\n`, { mode: 0o755 });
    return p;
  };
  const log = path.join(tmp, 'rpc.log');
  const saved = { ...process.env };
  Object.assign(process.env, { FAKE_RPC: '1', FAKE_RPC_LOG: log, FAKE_ARGS_LOG: path.join(tmp, 'args.log') }, env);
  t.after(() => {
    process.env = saved;
  });
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, {
    repoPath: repo,
    codexPath: bin('codex', 'codex'),
    cursorPath: bin('cursor-agent', 'cursor'),
    maxParallel: 3,
    enabledAgents: ['claude', 'codex', 'cursor'],
    specCheck: false,
    ...settings,
  });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  const sent = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { agents, store, sent, tmp };
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

test('rpcKindOf: Codex は許可を聞くモードだけ、Cursor は acp で始めた会話か新しい会話だけ', () => {
  assert.strictEqual(providers.rpcKindOf('codex', 'default'), 'codex');
  assert.strictEqual(providers.rpcKindOf('codex', 'acceptEdits'), 'codex');
  assert.strictEqual(providers.rpcKindOf('codex', 'plan'), null);
  assert.strictEqual(providers.rpcKindOf('codex', 'bypassPermissions'), null);
  assert.strictEqual(providers.rpcKindOf('cursor', 'plan'), 'acp');
  assert.strictEqual(providers.rpcKindOf('cursor', 'default', { sessionId: 's', sessionVia: 'acp' }), 'acp');
  assert.strictEqual(providers.rpcKindOf('cursor', 'default', { sessionId: 's' }), null, '-p の会話は acp で続きができない');
  assert.strictEqual(providers.rpcKindOf('gemini', 'default'), null);
  assert.strictEqual(providers.rpcKindOf('antigravity', 'default'), null);
});

test('rpcArgs: Cursor のすべて許可とモデルは起動の引数で渡す', () => {
  assert.deepStrictEqual(providers.rpcArgs('codex', {}), ['app-server']);
  assert.deepStrictEqual(providers.rpcArgs('cursor', { mode: 'default' }), ['acp']);
  assert.deepStrictEqual(providers.rpcArgs('cursor', { mode: 'bypassPermissions', model: 'gpt-5' }), ['--force', '--approve-mcps', '--model', 'gpt-5', 'acp']);
});

test('codexApprovalPolicy: 毎回確認と sandbox の外だけ確認', () => {
  assert.deepStrictEqual(codexApprovalPolicy('default'), { approvalPolicy: 'untrusted', sandbox: 'workspace-write' });
  assert.deepStrictEqual(codexApprovalPolicy('acceptEdits'), { approvalPolicy: 'on-request', sandbox: 'workspace-write' });
  assert.strictEqual(codexApprovalPolicy('plan'), null);
});

test('codexCommand: シェルで包まれたコマンドの中身を出す', () => {
  assert.strictEqual(codexCommand({ command: "/bin/zsh -lc 'ls'", commandActions: [{ command: 'ls' }] }), 'ls');
  assert.strictEqual(codexCommand({ command: "/bin/zsh -lc 'a && b'", commandActions: [{ command: 'a' }, { command: 'b' }] }), "/bin/zsh -lc 'a && b'");
  assert.strictEqual(codexCommand({ command: ['git', 'status'] }), 'git status');
});

test('acpToolInput: 種類から名前を決める', () => {
  assert.deepStrictEqual(acpToolInput({ kind: 'execute', title: '`ls -la`' }), { name: 'Bash', input: { command: 'ls -la' } });
  assert.deepStrictEqual(acpToolInput({ kind: 'edit', title: 'Edit', locations: [{ path: '/a/b' }] }), { name: 'Edit', input: { file_path: '/a/b' } });
  assert.strictEqual(acpToolInput({ kind: 'other', title: 'mcp: foo' }).name, 'Tool: mcp: foo');
  assert.strictEqual(acpToolInput({ kind: 'other', title: 'AskUserQuestion' }).name, 'Tool: AskUserQuestion', 'カードの特別な名前にならない');
});

test('isAllowedTool: 許可しておくツールの書き方', () => {
  const list = ['Bash(npm test:*)', 'Bash(git status)', 'WebFetch'];
  const bash = (command) => providers.isAllowedTool(list, 'Bash', { command });
  assert.ok(bash('npm test'));
  assert.ok(bash('npm test -- x'));
  assert.ok(bash('git status'));
  assert.ok(!bash('git status -s'));
  assert.ok(!bash('npm testing'));
  assert.ok(!bash('npm test; rm -rf x'), 'つないだコマンドは通さない');
  assert.ok(!bash('npm test && rm x'));
  assert.ok(!bash('npm test $(rm x)'));
  assert.ok(providers.isAllowedTool(list, 'WebFetch', { url: 'x' }));
  assert.ok(!providers.isAllowedTool(list, 'Edit', { file_path: 'x' }));
});

test('Codex: 毎回確認ではコマンドと編集がカードに出て、許可すると動く', async (t) => {
  const { agents, store, sent } = setup(t);
  store.settings.permissionMode = 'default';
  const [c] = agents.createTask({ title: 'cx', prompt: 'やって', agent: 'codex' });
  agents.start(c.id);
  await waitFor(() => c.permissions.length === 1);
  assert.strictEqual(c.permissions[0].toolName, 'Bash');
  assert.match(c.permissions[0].summary, /^touch approved\.txt$/);
  agents.answerPermission(c.id, c.permissions[0].id, 'allow');
  await waitFor(() => c.permissions.length === 1 && c.permissions[0].toolName === 'Edit');
  assert.match(c.permissions[0].summary, /edited\.txt$/);
  agents.answerPermission(c.id, c.permissions[0].id, 'allow');
  await waitFor(() => c.status === 'review');
  assert.strictEqual(c.lastText, 'できました');
  assert.strictEqual(c.sessionVia, 'codex');
  assert.ok(c.todos.items.some((x) => x.text === 'do it'));
  const start = sent().find((m) => m.method === 'thread/start' && !m.params.ephemeral);
  assert.strictEqual(start.params.approvalPolicy, 'untrusted');
  assert.strictEqual(start.params.sandbox, 'workspace-write');
  assert.deepStrictEqual(sent().filter((m) => m.result && m.result.decision).map((m) => m.result.decision), ['accept', 'accept']);
  assert.ok(fs.existsSync(path.join(c.worktreePath, 'approved.txt')) || (await agents.diff(c.id)).includes('approved.txt'));
});

test('Codex: 拒否すると decline を返し、エージェントは続ける', async (t) => {
  const { agents, sent } = setup(t);
  const [c] = agents.createTask({ title: 'cx', prompt: 'やって', agent: 'codex' });
  agents.start(c.id);
  await waitFor(() => c.permissions.length === 1);
  agents.answerPermission(c.id, c.permissions[0].id, 'deny');
  await waitFor(() => c.permissions.length === 1 && c.permissions[0].toolName === 'Edit');
  agents.answerPermission(c.id, c.permissions[0].id, 'deny');
  await waitFor(() => c.status === 'review');
  assert.deepStrictEqual(sent().filter((m) => m.result && m.result.decision).map((m) => m.result.decision), ['decline', 'decline']);
  assert.ok(c.logs.some((l) => l.kind === 'tool_error'));
  assert.ok(!(await agents.diff(c.id)).includes('approved.txt'));
});

test('Codex: 常に許可はそのカードの中で覚える', async (t) => {
  const { agents, sent } = setup(t);
  const [c] = agents.createTask({ title: 'cx', prompt: 'やって', agent: 'codex' });
  c.alwaysAllow = ['Bash', 'Edit'];
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  assert.deepStrictEqual(sent().filter((m) => m.result && m.result.decision).map((m) => m.result.decision), ['accept', 'accept']);
});

test('Codex: 許可しておくツールに入っていれば聞かない', async (t) => {
  const { agents, sent } = setup(t, {}, { allowedTools: 'Bash(touch:*), Edit' });
  const [c] = agents.createTask({ title: 'cx', prompt: 'やって', agent: 'codex' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  assert.strictEqual(sent().filter((m) => m.result && m.result.decision).length, 2);
});

test('Codex: ターンの失敗は失敗にする', async (t) => {
  const { agents } = setup(t, { FAKE_RPC_FAIL: '1' });
  const [c] = agents.createTask({ title: 'cx', prompt: 'やって', agent: 'codex' });
  agents.start(c.id);
  await waitFor(() => c.status === 'failed');
  assert.match(c.error, /model exploded/);
});

test('Codex: ターンの途中で落ちたら失敗にする', async (t) => {
  const { agents } = setup(t, { FAKE_RPC_CRASH: '1' });
  const [c] = agents.createTask({ title: 'cx', prompt: 'やって', agent: 'codex' });
  agents.start(c.id);
  await waitFor(() => c.status === 'failed');
});

test('Codex: 計画だけは exec のまま', async (t) => {
  const { agents, store, tmp } = setup(t);
  store.settings.permissionMode = 'plan';
  const [c] = agents.createTask({ title: 'cx', prompt: 'コーデックスで作って', agent: 'codex' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  const calls = fs.readFileSync(path.join(tmp, 'args.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls.some((x) => x.args[0] === 'exec'));
  assert.ok(!calls.some((x) => x.args.includes('app-server')));
});

test('対応していない版は、確かめたうえで前の起動のしかたに戻す', async (t) => {
  const { agents, tmp } = setup(t, { FAKE_RPC: '' });
  const [c] = agents.createTask({ title: 'cx', prompt: 'コーデックスで作って', agent: 'codex' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  assert.ok(c.logs.some((l) => l.kind === 'system' && /承認のやりとりに対応していない/.test(l.text)));
  const calls = fs.readFileSync(path.join(tmp, 'args.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls.some((x) => x.args[0] === 'exec'));
});

test('Cursor: コマンドがカードに出て、許可すると動く。会話は acp で続ける', async (t) => {
  const { agents, sent } = setup(t);
  const [c] = agents.createTask({ title: 'cu', prompt: 'やって', agent: 'cursor' });
  agents.start(c.id);
  await waitFor(() => c.permissions.length === 1);
  assert.strictEqual(c.permissions[0].toolName, 'Bash');
  assert.strictEqual(c.permissions[0].summary, 'touch approved.txt');
  assert.match(c.permissions[0].detail, /Not in allowlist/);
  agents.answerPermission(c.id, c.permissions[0].id, 'allow');
  await waitFor(() => c.status === 'review');
  assert.strictEqual(c.lastText, 'できました');
  assert.strictEqual(c.sessionVia, 'acp');
  assert.ok(c.logs.some((l) => l.kind === 'text' && l.text === '動かします'));
  assert.ok(c.logs.some((l) => l.kind === 'tool' && /^Bash/.test(l.text)));
  assert.ok(c.logs.some((l) => l.kind === 'tool_result' && l.text === 'ok'));
  assert.deepStrictEqual(sent().filter((m) => m.result && m.result.outcome).map((m) => m.result.outcome.optionId), ['allow-once']);

  // 追加指示: 前の会話を読み込んで続ける（流れてくる前の返事は出さない）
  agents.send(c.id, '続けて');
  await waitFor(() => c.permissions.length === 1);
  assert.ok(sent().some((m) => m.method === 'session/load' && m.params.sessionId === c.sessionId));
  assert.ok(!c.logs.some((l) => l.kind === 'text' && /前の返事/.test(l.text)));
  agents.answerPermission(c.id, c.permissions[0].id, 'deny');
  await waitFor(() => c.status === 'review');
  assert.strictEqual(sent().filter((m) => m.result && m.result.outcome).pop().result.outcome.optionId, 'reject-once');
});

test('Cursor: 会話を読み込めないときは新しい会話で始める', async (t) => {
  const { agents, sent } = setup(t, { FAKE_RPC_NO_LOAD: '1' });
  const [c] = agents.createTask({ title: 'cu', prompt: 'やって', agent: 'cursor' });
  c.sessionId = 'aaaaaaaa-0000-4000-8000-000000000000';
  c.sessionVia = 'acp';
  agents.start(c.id);
  await waitFor(() => c.permissions.length === 1);
  assert.ok(sent().some((m) => m.method === 'session/new'));
  assert.notStrictEqual(c.sessionId, 'aaaaaaaa-0000-4000-8000-000000000000');
  agents.answerPermission(c.id, c.permissions[0].id, 'allow');
  await waitFor(() => c.status === 'review');
});

test('Cursor: 計画だけは plan モードにする', async (t) => {
  const { agents, store, sent } = setup(t);
  store.settings.permissionMode = 'plan';
  const [c] = agents.createTask({ title: 'cu', prompt: 'やって', agent: 'cursor' });
  agents.start(c.id);
  await waitFor(() => c.permissions.length === 1);
  assert.ok(sent().some((m) => m.method === 'session/set_mode' && m.params.modeId === 'plan'));
  agents.answerPermission(c.id, c.permissions[0].id, 'deny');
  await waitFor(() => c.status === 'review');
});

test('Cursor: 途中で止まった理由は失敗として出す', async (t) => {
  const { agents } = setup(t, { FAKE_RPC_STOP: 'refusal' });
  const [c] = agents.createTask({ title: 'cu', prompt: 'やって', agent: 'cursor' });
  agents.start(c.id);
  await waitFor(() => c.permissions.length === 1);
  agents.answerPermission(c.id, c.permissions[0].id, 'allow');
  await waitFor(() => c.status === 'failed');
  assert.match(c.error, /refusal/);
});

test('実行を止めると、待っている承認は取り消される', async (t) => {
  const { agents } = setup(t);
  const [c] = agents.createTask({ title: 'cu', prompt: 'やって', agent: 'cursor' });
  agents.start(c.id);
  await waitFor(() => c.permissions.length === 1);
  agents.stop(c.id);
  await waitFor(() => c.status === 'review');
  assert.strictEqual(c.permissions.length, 0);
});

test('Cursor: 前の版の -p の会話は -p で続ける', async (t) => {
  const { agents, tmp } = setup(t);
  const [c] = agents.createTask({ title: 'cu', prompt: 'カーソルで作って', agent: 'cursor' });
  c.sessionId = 'cursor-chat-1';
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  const calls = fs.readFileSync(path.join(tmp, 'args.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls.some((x) => x.args.includes('-p') && x.args.includes('--resume')));
  assert.ok(!calls.some((x) => x.args.includes('acp')));
});
