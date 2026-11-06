// カスタムエージェント（プロジェクトごと。元にする CLI・モデルとプロフィール）を、タスク・会話・Pipeline・競争で使う
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store, pickRepoSettings, switchRepoSettings } = require('../src/store');
const { AgentManager, relayStepsOf } = require('../src/agent');
const providers = require('../src/providers');
const FlowModel = require('../renderer/flow-model');

const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
const FAKE_CLI = path.join(__dirname, 'fake-agent-cli.js');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-ca-'));
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
    specCheck: false,
    customAgents: providers.cleanCustomAgents([
      { id: 'rev', name: '慎重なレビュアー', icon: 'R', color: '#ff0000', description: 'テストの抜けを見る', instruction: '必ず理由を書くこと', agent: 'codex', model: 'gpt-5-codex' },
      { id: 'gem', name: 'ジェミ', agent: 'gemini' },
    ]),
  });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  const calls = () => (fs.existsSync(argsLog) ? fs.readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { tmp, repo, store, agents, calls };
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

test('providers: カスタムエージェントを整える（名前のないもの・重なる ID・使えないモデル名・色）', () => {
  const list = providers.cleanCustomAgents([
    { id: 'a', name: '  A  ', agent: 'codex', model: 'gpt-5', color: '#ABCDEF', icon: '🦉🦉🦉', instruction: 'x'.repeat(5000) },
    { id: 'a', name: 'B', agent: 'nope', model: 'bad model; rm', color: 'red' },
    { name: '' },
    null,
  ]);
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(
    { id: list[0].id, name: list[0].name, agent: list[0].agent, model: list[0].model, color: list[0].color, icon: list[0].icon },
    { id: 'a', name: 'A', agent: 'codex', model: 'gpt-5', color: '#abcdef', icon: '🦉🦉' },
  );
  assert.ok(list[0].instruction.length <= 4001, '長すぎる指示は切る');
  assert.notStrictEqual(list[1].id, 'a', 'ID が重なれば振り直す');
  assert.strictEqual(list[1].agent, 'claude');
  assert.strictEqual(list[1].model, '');
  assert.strictEqual(list[1].color, providers.DEFAULT_CUSTOM_COLOR);
  assert.ok(providers.isCustomRef('custom:a'));
  assert.ok(!providers.isCustomRef('codex'));
  assert.strictEqual(providers.findCustomAgent(list, 'custom:a').name, 'A');
  const note = providers.withPersona(providers.personaOf(list[0]), '本文');
  assert.match(note, /カスタムエージェント「A」/);
  assert.match(note, /振る舞いの指示/);
  assert.match(note, /本文$/);
  assert.strictEqual(providers.withPersona(null, '本文'), '本文');
});

test('store: カスタムエージェントはプロジェクトごとに持ち、競争に加える ID はあるものだけ残す', () => {
  const s = { repoPath: '/a', repoSettings: {}, customAgents: [{ id: 'x', name: 'X', agent: 'codex' }], competeCustomAgents: ['x', 'custom:x', 'zzz'] };
  const picked = pickRepoSettings(s);
  assert.deepStrictEqual(picked.customAgents.map((x) => x.id), ['x']);
  assert.deepStrictEqual(picked.competeCustomAgents, ['x']);
  switchRepoSettings(s, '/b');
  assert.deepStrictEqual(s.customAgents, [], '別のプロジェクトでは空から');
  switchRepoSettings(s, '/a');
  assert.deepStrictEqual(s.customAgents.map((x) => x.name), ['X'], '元のプロジェクトに戻ると戻る');
});

test('flow: 工程のモデルとカスタムエージェントを残し、使えないモデル名は落とす', () => {
  const flow = FlowModel.cleanFlow({
    nodes: [
      { id: 'start', type: 'start' },
      { id: 's1', type: 'step', agent: 'claude', label: 'A', model: 'opus' },
      { id: 's2', type: 'step', agent: 'codex', label: 'B', custom: 'custom:rev' },
      { id: 's3', type: 'step', agent: 'claude', label: 'C', model: 'bad model' },
      { id: 'end', type: 'end' },
    ],
    edges: [{ from: 'start', to: 's1' }, { from: 's1', to: 's2' }, { from: 's2', to: 's3' }, { from: 's3', to: 'end' }],
  });
  const [a, b, c] = FlowModel.orderSteps(flow);
  assert.strictEqual(a.model, 'opus');
  assert.strictEqual(b.custom, 'rev');
  assert.strictEqual(c.model, undefined);
  const steps = relayStepsOf(flow, providers.cleanCustomAgents([{ id: 'rev', name: 'R', agent: 'gemini', model: 'gemini-2.5-pro' }]));
  assert.deepStrictEqual([steps[1].agent, steps[1].model, steps[1].persona.name], ['gemini', 'gemini-2.5-pro', 'R']);
  assert.strictEqual(relayStepsOf(flow, [])[1].missing, 'rev', 'カスタムエージェントがなければ印を付ける');
});

test('タスク: カスタムエージェントを選ぶと、その CLI・モデル・プロフィールで動く', async () => {
  const { agents, calls } = setup();
  const [c] = agents.createTask({ title: 'ca', prompt: 'カスタムのタスク', agent: 'custom:rev', model: 'ignored' });
  assert.strictEqual(c.agent, 'codex');
  assert.strictEqual(c.model, 'gpt-5-codex');
  assert.deepStrictEqual({ name: c.persona.name, color: c.persona.color }, { name: '慎重なレビュアー', color: '#ff0000' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  const codex = calls().filter((x) => x.kind === 'codex');
  assert.ok(codex.some((x) => x.args.includes('gpt-5-codex')), 'カスタムエージェントのモデルを渡す');
  const diff = await agents.diff(c.id);
  assert.match(diff, /カスタムエージェント「慎重なレビュアー」/);
  assert.match(diff, /必ず理由を書くこと/);
  assert.match(diff, /カスタムのタスク/);
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'custom:nope' }), /カスタムエージェントが見つかりません/);
});

test('タスク: 元の CLI を使わない設定にしたカスタムエージェントは選べない', () => {
  const { agents, store } = setup();
  store.settings.enabledAgents = ['claude'];
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'custom:rev' }), /使わない設定/);
});

test('会話: カスタムエージェントで話す', async () => {
  const { agents } = setup();
  const c = agents.createChat({ message: 'こんにちは', agent: 'custom:gem' });
  assert.strictEqual(c.agent, 'gemini');
  assert.strictEqual(c.persona.name, 'ジェミ');
  await waitFor(() => c.status === 'review' || c.status === 'failed');
  assert.ok(c.logs.some((l) => l.kind === 'user'));
});

test('Pipeline: 工程ごとにモデルとカスタムエージェントを選べ、引き継ぐたびに入れ替わる', async () => {
  const { agents, store, calls } = setup();
  store.settings.relayFlow = FlowModel.cleanFlow({
    nodes: [
      { id: 'start', type: 'start' },
      { id: 's1', type: 'step', agent: 'codex', label: '実装', custom: 'rev', instruction: '実装して' },
      { id: 's2', type: 'step', agent: 'gemini', label: '仕上げ', model: 'gemini-2.5-flash', instruction: '仕上げて' },
      { id: 'end', type: 'end' },
    ],
    edges: [{ from: 'start', to: 's1' }, { from: 's1', to: 's2' }, { from: 's2', to: 'end' }],
  });
  const [c] = agents.createTask({ title: 'relay', prompt: 'Pipelineのタスク', agent: 'relay' });
  assert.strictEqual(c.agent, 'codex');
  assert.strictEqual(c.model, 'gpt-5-codex');
  assert.strictEqual(c.persona.name, '慎重なレビュアー');
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.relay.index === 1);
  assert.strictEqual(c.agent, 'gemini');
  assert.strictEqual(c.model, 'gemini-2.5-flash');
  assert.strictEqual(c.persona, undefined, 'ふつうのエージェントの工程ではプロフィールを外す');
  assert.strictEqual(c.relay.history[0].persona.name, '慎重なレビュアー');
  const gem = calls().filter((x) => x.kind === 'gemini');
  assert.ok(gem.some((x) => x.args.includes('gemini-2.5-flash')), '工程のモデルを渡す');
  const diff = await agents.diff(c.id);
  assert.match(diff, /カスタムエージェント「慎重なレビュアー」/);
  assert.match(diff, /慎重なレビュアー（Codex CLI）/, '次の工程には、前の工程の担当の名前を伝える');
});

test('Pipeline: 工程のカスタムエージェントが消えていたら始めない', () => {
  const { agents, store } = setup();
  store.settings.relayFlow = FlowModel.cleanFlow({
    nodes: [{ id: 'start', type: 'start' }, { id: 's1', type: 'step', agent: 'codex', label: '実装', custom: 'gone' }, { id: 'end', type: 'end' }],
    edges: [{ from: 'start', to: 's1' }, { from: 's1', to: 'end' }],
  });
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'relay' }), /カスタムエージェントが見つかりません/);
});

test('競争: ふつうのエージェントとカスタムエージェントを一緒に競争させる', () => {
  const { agents, store } = setup();
  store.settings.orchestration = 'compete';
  store.settings.competeAgents = ['claude'];
  store.settings.competeCustomAgents = ['rev'];
  const cards = agents.createTask({ title: '競争', prompt: '同じタスク', agent: 'compete' });
  assert.strictEqual(cards.length, 2);
  assert.deepStrictEqual(cards.map((c) => c.agent), ['claude', 'codex']);
  assert.match(cards[1].title, /\[慎重なレビュアー\]/);
  assert.strictEqual(cards[1].model, 'gpt-5-codex');
  assert.strictEqual(cards[1].persona.name, '慎重なレビュアー');
  assert.strictEqual(cards[0].persona, undefined);
});
