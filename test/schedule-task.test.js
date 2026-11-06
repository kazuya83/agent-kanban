// スケジュール実行のためのタスク作成: 開いていないリポジトリへカードを作る・仕様の確認を飛ばす・スケジュールの印を付ける
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store, pickRepoSettings } = require('../src/store');
const { AgentManager, isNoGit, SPEC_MARKER } = require('../src/agent');
const providers = require('../src/providers');
const FlowModel = require('../renderer/flow-model');

const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
const FAKE_CLI = path.join(__dirname, 'fake-agent-cli.js');

const flowOf = (...agents) => FlowModel.flowFromSteps(agents.map((a, i) => ({ agent: a, label: `工程${i + 1}`, instruction: '' })));
const custom = (id, name, agent, model = '') => ({ id, name, agent, model });

function initRepo(dir) {
  fs.mkdirSync(dir);
  const g = (...a) => execFileSync('git', a, { cwd: dir });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return dir;
}

// current が開いているリポジトリ、other が開いていないリポジトリ（設定だけが保存されている）
function setup({ other: otherSettings = {}, current: currentSettings = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kanban-sched-'));
  const current = initRepo(path.join(tmp, 'current'));
  const other = initRepo(path.join(tmp, 'other'));
  const bin = (name, script, pre = '') => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${script}" ${pre} "$@"\n`, { mode: 0o755 });
    return p;
  };
  const argsLog = path.join(tmp, 'args.log');
  process.env.FAKE_ARGS_LOG = argsLog;
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, {
    repoPath: current,
    claudePath: bin('claude', FAKE_CLAUDE),
    codexPath: bin('codex', FAKE_CLI, 'codex'),
    geminiPath: bin('gemini', FAKE_CLI, 'gemini'),
    cursorPath: bin('cursor-agent', FAKE_CLI, 'cursor'),
    maxParallel: 3,
    enabledAgents: ['claude', 'codex', 'gemini', 'cursor'],
    specCheck: false,
    ...currentSettings,
  });
  store.settings.repoSettings = { [other]: pickRepoSettings({ specCheck: false, ...otherSettings }) };
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  return { tmp, current, other, store, agents, argsLog };
}

function waitFor(pred, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (pred()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error('timeout'));
      }
    }, 20);
  });
}

// ---------- 指定しないときの動き ----------

test('repoPath を指定しなければ、今まで通り今のリポジトリにカードを作り、スケジュールの項目は付かない', () => {
  const { agents, current, store } = setup();
  const [c] = agents.createTask({ title: 't', prompt: '作業', agent: 'claude' });
  assert.strictEqual(c.repoPath, current);
  assert.ok(!('scheduleId' in c));
  assert.ok(!('scheduleTitle' in c));
  assert.strictEqual(store.cards.length, 1);
});

test('repoPath を指定しなければ、今のリポジトリのカスタムエージェント・Pipeline を使う', () => {
  const { agents, store } = setup({
    current: { orchestration: 'relay', customAgents: providers.cleanCustomAgents([custom('mine', '今の人', 'codex', 'gpt-5-codex')]), relayFlow: flowOf('gemini') },
    other: { customAgents: providers.cleanCustomAgents([custom('mine', '別の人', 'gemini')]), relayFlow: flowOf('codex') },
  });
  const [c] = agents.createTask({ prompt: '作業', agent: 'custom:mine' });
  assert.strictEqual(c.agent, 'codex');
  assert.strictEqual(c.persona.name, '今の人');
  assert.strictEqual(agents.customAgents()[0].name, '今の人');
  const [r] = agents.createTask({ prompt: '作業', agent: 'relay' });
  assert.strictEqual(r.agent, 'gemini');
  assert.strictEqual(store.cards.length, 2);
});

test('repoPath が空・空白だけなら、指定なしと同じに扱う', () => {
  const { agents, current } = setup();
  for (const repoPath of ['', '   ', null, undefined]) {
    const [c] = agents.createTask({ prompt: '作業', agent: 'claude', repoPath });
    assert.strictEqual(c.repoPath, current);
  }
});

test('リポジトリを開いていないときは、指定がなければエラー、指定があれば作れる', () => {
  const { agents, other, store } = setup();
  store.settings.repoPath = '';
  assert.throws(() => agents.createTask({ prompt: '作業', agent: 'claude' }), /先にリポジトリを選んでください/);
  assert.strictEqual(store.cards.length, 0);
  const [c] = agents.createTask({ prompt: '作業', agent: 'claude', repoPath: other });
  assert.strictEqual(c.repoPath, other);
});

// ---------- 開いていないリポジトリへのカード作成 ----------

test('開いていないリポジトリにカードを作っても、開いているリポジトリは変わらない', () => {
  const { agents, current, other, store } = setup();
  const [c] = agents.createTask({ title: 't', prompt: '作業', agent: 'claude', repoPath: other });
  assert.strictEqual(c.repoPath, other);
  assert.strictEqual(store.settings.repoPath, current);
  assert.ok(!c.noGit);
});

test('そのリポジトリのカスタムエージェントを使う（今のリポジトリのものは使えない）', () => {
  const { agents, other, store } = setup({
    current: { customAgents: providers.cleanCustomAgents([custom('here', 'ここだけ', 'codex')]) },
    other: { customAgents: providers.cleanCustomAgents([custom('there', 'あちら', 'gemini', 'gemini-pro')]) },
  });
  const [c] = agents.createTask({ prompt: '作業', agent: 'custom:there', repoPath: other });
  assert.strictEqual(c.agent, 'gemini');
  assert.strictEqual(c.model, 'gemini-pro');
  assert.strictEqual(c.persona.name, 'あちら');
  assert.throws(() => agents.createTask({ prompt: '作業', agent: 'custom:here', repoPath: other }), /カスタムエージェントが見つかりません/);
  assert.strictEqual(store.cards.length, 1);
});

test('そのリポジトリの既定の Pipeline を使う', () => {
  const { agents, other } = setup({ current: { orchestration: 'relay', relayFlow: flowOf('gemini') }, other: { relayFlow: flowOf('codex', 'claude') } });
  const [c] = agents.createTask({ prompt: '作業', agent: 'relay', repoPath: other });
  assert.strictEqual(c.repoPath, other);
  assert.strictEqual(c.agent, 'codex');
  assert.deepStrictEqual(c.relay.steps.map((st) => st.agent), ['codex', 'claude']);
});

test('ID で選んだ Pipeline は、そのリポジトリから探す（消えていればエラー）', () => {
  const { agents, other, store } = setup({
    current: { orchestration: 'relay', relayFlows: [{ id: 'here', name: 'こちら', flow: flowOf('gemini') }], relayFlowId: 'here' },
    other: { relayFlows: [{ id: 'a', name: 'A', flow: flowOf('claude') }, { id: 'b', name: 'B', flow: flowOf('cursor') }], relayFlowId: 'a' },
  });
  const [c] = agents.createTask({ prompt: '作業', agent: 'relay:b', repoPath: other });
  assert.strictEqual(c.agent, 'cursor');
  assert.strictEqual(c.relay.pipeline.name, 'B');
  assert.throws(() => agents.createTask({ prompt: '作業', agent: 'relay:here', repoPath: other }), /選んだ Pipeline が見つかりません/);
  assert.strictEqual(store.cards.length, 1);
});

test('Pipeline の工程のカスタムエージェントも、そのリポジトリから探す', () => {
  const flow = FlowModel.flowFromSteps([{ agent: 'codex', label: 'レビュー', instruction: '' }]);
  FlowModel.orderSteps(flow)[0].custom = 'rev';
  const { agents, other, current, store } = setup({
    current: { orchestration: 'relay', relayFlow: flowOf('claude') },
    other: { relayFlow: flow, customAgents: providers.cleanCustomAgents([custom('rev', 'レビュアー', 'gemini')]) },
  });
  const [c] = agents.createTask({ prompt: '作業', agent: 'relay', repoPath: other });
  assert.strictEqual(c.agent, 'gemini');
  assert.strictEqual(c.persona.name, 'レビュアー');
  // 工程のカスタムエージェントがないリポジトリでは作れない
  store.settings.repoSettings[other].customAgents = [];
  assert.throws(() => agents.createTask({ prompt: '作業', agent: 'relay', repoPath: other }), /カスタムエージェントが見つかりません/);
  assert.strictEqual(store.cards.filter((x) => x.repoPath === current).length, 0);
});

test('競争は、そのリポジトリの顔ぶれ（カスタムエージェント）で、そのリポジトリにカードを作る', () => {
  const { agents, other, store } = setup({
    current: { orchestration: 'compete', competeAgents: ['claude'] },
    other: { customAgents: providers.cleanCustomAgents([custom('rev', 'レビュアー', 'gemini')]), competeCustomAgents: ['rev'] },
  });
  assert.strictEqual(agents.competeEntries().length, 1); // 今のリポジトリは claude だけ
  const cards = agents.createTask({ title: '競争', prompt: '作業', agent: 'compete', repoPath: other });
  assert.deepStrictEqual(cards.map((c) => c.agent), ['claude', 'gemini']);
  assert.ok(cards.every((c) => c.repoPath === other));
  assert.strictEqual(store.cards.length, 2);
});

test('競争の顔ぶれが足りないリポジトリではエラーで、カードは作らない', () => {
  const { agents, other, store } = setup({ current: { orchestration: 'compete', competeAgents: ['claude'], customAgents: providers.cleanCustomAgents([custom('rev', 'R', 'gemini')]), competeCustomAgents: ['rev'] } });
  assert.throws(() => agents.createTask({ prompt: '作業', agent: 'compete', repoPath: other }), /2つ以上/);
  assert.strictEqual(store.cards.length, 0);
});

test('git で管理していないフォルダかどうかは、指定したリポジトリで判断する', () => {
  const { agents, other, current, store } = setup({ current: { orchestration: 'compete', competeAgents: ['claude', 'codex'] } });
  store.settings.noGitRepos = [other];
  const [c] = agents.createTask({ prompt: '作業', agent: 'claude', repoPath: other });
  assert.ok(isNoGit(c));
  assert.throws(() => agents.createTask({ prompt: '作業', agent: 'compete', repoPath: other }), /git で管理していないフォルダ/);
  // 今のリポジトリは git のまま
  assert.strictEqual(agents.createTask({ prompt: '作業', agent: 'compete', repoPath: current }).length, 2);
});

test('並列のある Pipeline は、指定したリポジトリが git で管理していないフォルダならエラー', () => {
  const step = (label) => ({ agent: 'claude', label, instruction: '' });
  const flow = {
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'first', type: 'step', ...step('最初') },
      { id: 'par', type: 'parallel', label: '同時に' },
      { id: 'a', type: 'step', ...step('A') },
      { id: 'b', type: 'step', ...step('B') },
      { id: 'join', type: 'join' },
      { id: 'end', type: 'end' },
    ],
    edges: [['start', 'first'], ['first', 'par'], ['par', 'a'], ['par', 'b'], ['a', 'join'], ['b', 'join'], ['join', 'end']].map(([from, to], i) => ({ id: `e${i}`, from, to })),
  };
  const { agents, other, store } = setup({ current: { orchestration: 'relay', relayFlow: flowOf('claude') }, other: { relayFlow: flow } });
  store.settings.noGitRepos = [other];
  assert.throws(() => agents.createTask({ prompt: '作業', agent: 'relay', repoPath: other }), /並列のあるPipelineは使えません/);
  store.settings.noGitRepos = [];
  assert.strictEqual(agents.createTask({ prompt: '作業', agent: 'relay', repoPath: other }).length, 1);
});

test('ソースを変更しないタスクも、指定したリポジトリに作る', () => {
  const { agents, other } = setup();
  const [c] = agents.createTask({ prompt: '調べて', agent: 'claude', repoPath: other, readOnly: true });
  assert.strictEqual(c.repoPath, other);
  assert.strictEqual(c.readOnly, true);
});

// ---------- 失敗する場合 ----------

test('存在しないリポジトリ・フォルダでないパスを指定するとエラーで、今のリポジトリに作り直さない', () => {
  const { agents, tmp, other, store } = setup();
  const file = path.join(other, 'README.md');
  for (const repoPath of [path.join(tmp, 'nothing'), file]) {
    assert.throws(() => agents.createTask({ prompt: '作業', agent: 'claude', repoPath }), /リポジトリのフォルダが見つかりません/);
    assert.throws(() => agents.createCard({ prompt: '作業', agent: 'claude', repoPath }), /リポジトリのフォルダが見つかりません/);
  }
  assert.strictEqual(store.cards.length, 0);
});

test('開いたことのないリポジトリでも、フォルダがあれば初期値の設定で作れる', () => {
  const { agents, tmp } = setup();
  const fresh = initRepo(path.join(tmp, 'fresh'));
  const [c] = agents.createTask({ prompt: '作業', agent: 'claude', repoPath: fresh, skipSpecCheck: true });
  assert.strictEqual(c.repoPath, fresh);
});

test('指示が空・使わない設定のエージェント・知らないカスタムエージェントはエラーで、カードは作らない', () => {
  const { agents, other, store } = setup({ current: { enabledAgents: ['claude'] }, other: { customAgents: providers.cleanCustomAgents([custom('x', 'X', 'codex')]) } });
  const base = { repoPath: other, scheduleId: 's1', skipSpecCheck: true };
  assert.throws(() => agents.createTask({ ...base, prompt: '  ', agent: 'claude' }), /指示を入力してください/);
  assert.throws(() => agents.createTask({ ...base, prompt: '作業', agent: 'codex' }), /使わない設定/);
  assert.throws(() => agents.createTask({ ...base, prompt: '作業', agent: 'custom:x' }), /使わない設定/);
  assert.throws(() => agents.createTask({ ...base, prompt: '作業', agent: 'custom:none' }), /見つかりません/);
  assert.strictEqual(store.cards.length, 0);
});

// ---------- 仕様の確認 ----------

test('skipSpecCheck を付けると、仕様の確認をしない（ふつうのタスク・Pipeline・競争）', () => {
  const { agents, other } = setup({
    current: { specCheck: true, orchestration: 'relay', competeAgents: ['claude', 'codex'] },
    other: { specCheck: true, relayFlow: flowOf('claude') },
  });
  const [plain] = agents.createTask({ prompt: '作業', agent: 'claude', repoPath: other, skipSpecCheck: true });
  const [relay] = agents.createTask({ prompt: '作業', agent: 'relay', repoPath: other, skipSpecCheck: true });
  agents.store.settings.orchestration = 'compete';
  const cards = agents.createTask({ prompt: '作業', agent: 'compete', repoPath: other, skipSpecCheck: true });
  for (const c of [plain, relay, ...cards]) assert.ok(!c.specState, `${c.title} は仕様の確認をしない`);
  assert.strictEqual(cards.length, 2);
});

test('skipSpecCheck がなければ、指定したリポジトリの設定で仕様の確認を決める', () => {
  const on = setup({ current: { specCheck: false }, other: { specCheck: true } });
  assert.strictEqual(on.agents.createTask({ prompt: '作業', agent: 'claude', repoPath: on.other })[0].specState, 'checking');
  assert.ok(!on.agents.createTask({ prompt: '作業', agent: 'claude' })[0].specState);
  const off = setup({ current: { specCheck: true }, other: { specCheck: false } });
  assert.ok(!off.agents.createTask({ prompt: '作業', agent: 'claude', repoPath: off.other })[0].specState);
  assert.strictEqual(off.agents.createTask({ prompt: '作業', agent: 'claude' })[0].specState, 'checking');
});

// ---------- スケジュールの印 ----------

test('scheduleId・scheduleTitle をカードに残す', () => {
  const { agents, other } = setup();
  const [c] = agents.createTask({ title: 'カード名', prompt: '作業', agent: 'claude', repoPath: other, scheduleId: 'sch1', scheduleTitle: '  毎朝の点検  ' });
  assert.strictEqual(c.scheduleId, 'sch1');
  assert.strictEqual(c.scheduleTitle, '毎朝の点検');
});

test('scheduleTitle を省くとカードのタスク名を使い、タスク名もなければ指示の1行目を使う', () => {
  const { agents, other } = setup();
  const [a] = agents.createTask({ title: 'カード名', prompt: '作業', agent: 'claude', repoPath: other, scheduleId: 'sch1' });
  assert.strictEqual(a.scheduleTitle, 'カード名');
  const [b] = agents.createTask({ title: ' ', prompt: '1行目\n2行目', agent: 'claude', repoPath: other, scheduleId: 'sch1', scheduleTitle: ' ' });
  assert.strictEqual(b.scheduleTitle, '1行目');
});

test('scheduleId がなければ scheduleTitle だけを渡しても項目は付かない', () => {
  const { agents } = setup();
  const [c] = agents.createTask({ prompt: '作業', agent: 'claude', scheduleTitle: 'x' });
  assert.ok(!('scheduleTitle' in c));
});

test('競争の各カードの scheduleTitle は、エージェント名を付ける前の名前にする', () => {
  const { agents, other } = setup({ current: { orchestration: 'compete', competeAgents: ['claude', 'codex'] } });
  const cards = agents.createTask({ title: '毎朝の点検', prompt: '作業', agent: 'compete', repoPath: other, scheduleId: 'sch1', skipSpecCheck: true });
  assert.strictEqual(cards.length, 2);
  for (const c of cards) {
    assert.strictEqual(c.scheduleId, 'sch1');
    assert.strictEqual(c.scheduleTitle, '毎朝の点検');
    assert.notStrictEqual(c.title, '毎朝の点検');
  }
});

test('Pipeline のカードにもスケジュールの印を付ける', () => {
  const { agents, other } = setup({ current: { orchestration: 'relay' }, other: { relayFlow: flowOf('claude') } });
  const [c] = agents.createTask({ title: 't', prompt: '作業', agent: 'relay', repoPath: other, scheduleId: 'sch1' });
  assert.strictEqual(c.scheduleId, 'sch1');
  assert.strictEqual(c.scheduleTitle, 't');
});

test('スケジュールをそのまま広げて渡しても（スケジュールの id・rule など）カードに混ざらない', () => {
  const { agents, other, tmp } = setup();
  const schedule = { id: 'sch1', repoPath: path.join(tmp, 'nothing'), title: '点検', prompt: '作業', skill: null, agent: 'claude', model: '', readOnly: false, rule: { kind: 'daily', hour: 9, minute: 0 }, enabled: true, runs: [], nextRunAt: 1, lastCardId: 'old' };
  const [c] = agents.createTask({ ...schedule, repoPath: other, skipSpecCheck: true, scheduleId: schedule.id });
  assert.notStrictEqual(c.id, 'sch1');
  assert.strictEqual(c.repoPath, other);
  assert.strictEqual(c.scheduleTitle, '点検');
  for (const k of ['rule', 'enabled', 'runs', 'nextRunAt', 'lastCardId', 'skipSpecCheck']) assert.ok(!(k in c), `${k} はカードに入らない`);
});

// ---------- 実際に動かす ----------

test('開いていないリポジトリのカードは、そのリポジトリの worktree で、仕様の確認なしで動く', async () => {
  const { agents, other, current, store } = setup({ current: { specCheck: true }, other: { specCheck: true } });
  const [c] = agents.createTask({ title: 't', prompt: '作業して', agent: 'claude', repoPath: other, skipSpecCheck: true, scheduleId: 'sch1' });
  assert.ok(!agents.firstPrompt(c).includes(SPEC_MARKER), '仕様の確認の指示を付けない');
  agents.start(c.id);
  await waitFor(() => c.status === 'review' || c.status === 'failed');
  assert.strictEqual(c.status, 'review', c.error);
  assert.ok(!c.specState);
  assert.ok(c.worktreePath, 'worktree が作られている');
  const worktrees = (cwd) => execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
  const name = path.basename(c.worktreePath);
  assert.ok(worktrees(other).includes(name), worktrees(other));
  assert.ok(!worktrees(current).includes(name), worktrees(current));
  assert.strictEqual(store.settings.repoPath, current);
});
