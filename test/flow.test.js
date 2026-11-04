// Pipelineのフローチャート（分岐・ループ・並列・合流）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const FlowModel = require('../renderer/flow-model');
const { Store, migrateSettings, repoSettingsOf } = require('../src/store');
const { AgentManager } = require('../src/agent');

const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
const FAKE_CLI = path.join(__dirname, 'fake-agent-cli.js');

// ノードと線を短く書く: edges は [from, to, extra?]
function flow(nodes, edges) {
  return FlowModel.cleanFlow({
    nodes: nodes.map(([id, type, extra]) => ({ id, type, x: 0, y: 0, ...(extra || {}) })),
    edges: edges.map(([from, to, extra], i) => ({ id: `e${i + 1}`, from, to, ...(extra || {}) })),
  });
}
const step = (agent, label, instruction = '') => ({ agent, label, instruction });

// 実装 → 並列（A・B）→ 合流 → 仕上げ → 終了
function parallelFlow(agentA = 'codex', agentB = 'codex') {
  return flow(
    [
      ['start', 'start'],
      ['impl', 'step', step('codex', '実装')],
      ['par', 'parallel', { label: '同時に' }],
      ['a', 'step', step(agentA, '枝A')],
      ['b', 'step', step(agentB, '枝B')],
      ['join', 'join', { label: '合流' }],
      ['fin', 'step', step('codex', '仕上げ')],
      ['end', 'end'],
    ],
    [
      ['start', 'impl'],
      ['impl', 'par'],
      ['par', 'a'],
      ['par', 'b'],
      ['a', 'join'],
      ['b', 'join'],
      ['join', 'fin'],
      ['fin', 'end'],
    ],
  );
}

test('フロー: 整える（知らない種類・壊れた線を落とし、開始は1つ。ループの上限は戻る線だけ）', () => {
  const f = FlowModel.cleanFlow({
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'start2', type: 'start' },
      { id: 'a', type: 'step', agent: 'nope', label: '' },
      { id: 'x', type: 'weird' },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'a', maxLoops: 5 },
      { id: 'e2', from: 'a', to: 'end' },
      { id: 'e3', from: 'a', to: 'missing' },
      { id: 'e4', from: 'end', to: 'a' }, // 終了からは出せない
      { id: 'e5', from: 'a', to: 'a', maxLoops: 99 },
    ],
  });
  assert.deepStrictEqual(f.nodes.map((n) => n.id), ['start', 'a', 'end']);
  assert.strictEqual(f.nodes[1].agent, 'claude');
  assert.strictEqual(f.nodes[1].label, '工程1');
  assert.deepStrictEqual(f.edges.map((e) => e.id), ['e1', 'e2', 'e5']);
  assert.strictEqual(f.edges[0].maxLoops, undefined, '戻らない線には上限を持たせない');
  assert.strictEqual(f.edges[2].maxLoops, 10, '上限は 10 回まで');
  assert.strictEqual(FlowModel.cleanFlow(null), null);
});

test('フロー: 確かめる（開始の次・線の数・期待値・並列と合流）', () => {
  const ok = parallelFlow();
  assert.deepStrictEqual(FlowModel.validateFlow(ok), []);
  // 工程から2本出す
  const two = flow([['start', 'start'], ['a', 'step', step('claude', 'A')], ['b', 'step', step('claude', 'B')], ['end', 'end']], [['start', 'a'], ['a', 'b'], ['a', 'end'], ['b', 'end']]);
  assert.ok(FlowModel.validateFlow(two).some((e) => /線を1本だけ/.test(e)));
  // 分岐の期待値がない・重なる
  const badIf = flow(
    [['start', 'start'], ['a', 'step', step('claude', 'A')], ['if', 'if', { label: '判定' }], ['end', 'end']],
    [['start', 'a'], ['a', 'if'], ['if', 'end', { value: 'ok' }], ['if', 'end', { value: 'OK' }], ['if', 'a']],
  );
  const errs = FlowModel.validateFlow(badIf);
  assert.ok(errs.some((e) => /重なっています/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /期待値がないもの/.test(e)), errs.join('\n'));
  // 並列の枝が合流につながっていない
  const noJoin = flow(
    [['start', 'start'], ['a', 'step', step('claude', 'A')], ['p', 'parallel'], ['b', 'step', step('claude', 'B')], ['c', 'step', step('claude', 'C')], ['end', 'end']],
    [['start', 'a'], ['a', 'p'], ['p', 'b'], ['p', 'c'], ['b', 'end'], ['c', 'end']],
  );
  assert.ok(FlowModel.validateFlow(noJoin).some((e) => /合流につないで/.test(e)));
  // 開始の次が工程でない
  const startIf = flow([['start', 'start'], ['p', 'parallel'], ['end', 'end']], [['start', 'p']]);
  assert.ok(FlowModel.validateFlow(startIf).some((e) => /開始の次は、工程/.test(e)));
});

test('フロー: 行き先を決める（3つ以上の分岐・どれにも合わないとき・ループの上限）', () => {
  const f = flow(
    [
      ['start', 'start'],
      ['a', 'step', step('codex', '調べる')],
      ['if', 'if', { label: '結果' }],
      ['b', 'step', step('codex', '直す')],
      ['c', 'step', step('codex', '書く')],
      ['end', 'end'],
    ],
    [
      ['start', 'a'],
      ['a', 'if'],
      ['if', 'b', { value: 'bug', when: '不具合がある' }],
      ['if', 'c', { value: 'Docs' }],
      ['if', 'end', { value: 'ok' }],
      ['if', 'a', { else: true, maxLoops: 2 }],
      ['b', 'end'],
      ['c', 'end'],
    ],
  );
  assert.deepStrictEqual(FlowModel.validateFlow(f), []);
  assert.strictEqual(FlowModel.route(f, 'a', { result: 'bug' }).node.id, 'b');
  assert.strictEqual(FlowModel.route(f, 'a', { result: 'docs' }).node.id, 'c', '大文字・小文字は区別しない');
  assert.strictEqual(FlowModel.route(f, 'a', { result: 'ok' }).kind, 'end');
  // どれにも合わない → 戻る線（ループ）。上限 2 回
  let r = FlowModel.route(f, 'a', { result: 'unknown' });
  assert.strictEqual(r.node.id, 'a');
  r = FlowModel.route(f, 'a', { result: null, counts: r.counts });
  assert.deepStrictEqual(r.counts, { e6: 2 });
  assert.strictEqual(FlowModel.route(f, 'a', { result: null, counts: r.counts }).kind, 'limit');
  // 「どれにも合わないとき」がなければ止まる
  const g = flow([['start', 'start'], ['a', 'step', step('codex', 'A')], ['if', 'if'], ['end', 'end']], [['start', 'a'], ['a', 'if'], ['if', 'end', { value: 'ok' }]]);
  assert.strictEqual(FlowModel.route(g, 'a', { result: 'ng' }).kind, 'nomatch');
  // 判定の値の読み取り（最後のものを使う。前のバージョンの印も読む）
  assert.strictEqual(FlowModel.resultValue('a [[RESULT:x]]\nb [[RESULT: Bug ]]'), 'bug');
  assert.strictEqual(FlowModel.resultValue('[[FAIL]]'), 'fail');
  assert.strictEqual(FlowModel.resultValue('なし'), null);
  // 並列と合流
  const p = parallelFlow();
  assert.strictEqual(FlowModel.route(p, 'impl').kind, 'parallel');
  assert.strictEqual(FlowModel.route(p, 'a').kind, 'join');
  assert.strictEqual(FlowModel.parallelInfo(p, 'par').join, 'join');
  assert.deepStrictEqual(FlowModel.orderSteps(p).map((n) => n.id), ['impl', 'a', 'b', 'fin']);
});

test('設定: Pipelineのフローはプロジェクトごと。前のバージョンの工程のリストは、それぞれのプロジェクトのフローに移す', () => {
  const steps = [
    { agent: 'codex', label: '実装', instruction: '' },
    { agent: 'claude', label: 'レビュー', instruction: '', onFail: 0, maxLoops: 2 },
  ];
  const raw = { repoPath: '/r1', relaySteps: steps, repoSettings: { '/r1': { baseBranch: 'main' }, '/r2': { baseBranch: 'dev' } } };
  const s = { ...raw };
  migrateSettings(s, raw, []);
  for (const p of ['/r1', '/r2']) {
    const f = repoSettingsOf(s, p).relayFlow;
    assert.deepStrictEqual(FlowModel.orderSteps(f).map((n) => n.label), ['実装', 'レビュー'], p);
    assert.ok(f.edges.some((e) => e.value === 'fail' && e.to === 's1' && e.maxLoops === 2), p);
  }
  // プロジェクトごとに別のフローを持てる
  const { setRepoSettings } = require('../src/store');
  setRepoSettings(s, '/r2', { relayFlow: parallelFlow() });
  assert.ok(repoSettingsOf(s, '/r2').relayFlow.nodes.some((n) => n.type === 'parallel'));
  assert.ok(!repoSettingsOf(s, '/r1').relayFlow.nodes.some((n) => n.type === 'parallel'));
});

// ---------- 動かす ----------

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kanban-flow-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo }).toString();
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const bin = (name, script, pre = '') => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${script}" ${pre} "$@"\n`, { mode: 0o755 });
    return p;
  };
  process.env.FAKE_ARGS_LOG = path.join(tmp, 'args.log');
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, {
    repoPath: repo,
    claudePath: bin('claude', FAKE_CLAUDE),
    codexPath: bin('codex', FAKE_CLI, 'codex'),
    geminiPath: bin('gemini', FAKE_CLI, 'gemini'),
    cursorPath: bin('cursor-agent', FAKE_CLI, 'cursor'),
    maxParallel: 4,
    enabledAgents: ['claude', 'codex', 'gemini', 'cursor'],
    specCheck: false,
  });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  return { tmp, repo, store, agents, g };
}

function waitFor(pred, ms = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      let v;
      try {
        v = pred();
      } catch {
        v = false;
      }
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

test('Pipeline: 分岐 — 返事の判定の値で、3つ以上の行き先から選ぶ', async () => {
  const { agents, store } = setup();
  store.settings.relayFlow = flow(
    [
      ['start', 'start'],
      ['a', 'step', step('codex', '調べる')],
      ['if', 'if', { label: '結果', question: '何をするか' }],
      ['b', 'step', step('gemini', '直す')],
      ['c', 'step', step('gemini', '書く')],
      ['d', 'step', step('gemini', '消す')],
      ['end', 'end'],
    ],
    [
      ['start', 'a'],
      ['a', 'if'],
      ['if', 'b', { value: 'bug', when: '不具合がある' }],
      ['if', 'c', { value: 'docs', when: '説明が足りない' }],
      ['if', 'd', { value: 'remove' }],
      ['b', 'end'],
      ['c', 'end'],
      ['d', 'end'],
    ],
  );
  const [c] = agents.createTask({ title: 'multi', prompt: '[result=docs] 3つに分ける', agent: 'relay' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && c.relay.done);
  assert.deepStrictEqual(c.relay.history.map((h) => [c.relay.steps[h.index].label, h.result || null]), [['調べる', 'docs']]);
  assert.strictEqual(c.relay.steps[c.relay.index].label, '書く');
  const diff = await agents.diff(c.id);
  assert.match(diff, /\[\[RESULT:bug\]\]`: 不具合がある → 工程\d「直す」/, '期待値と条件を伝える');
  assert.match(diff, /\[\[RESULT:remove\]\]/);
});

test('Pipeline: 分岐 — どの期待値にも合わず「どれにも合わないとき」の線もなければ、止めて知らせる', async () => {
  const { agents, store } = setup();
  store.settings.relayFlow = flow(
    [['start', 'start'], ['a', 'step', step('codex', '調べる')], ['if', 'if', { label: '結果' }], ['b', 'step', step('gemini', '直す')], ['end', 'end']],
    [['start', 'a'], ['a', 'if'], ['if', 'b', { value: 'bug' }], ['if', 'end', { value: 'ok' }], ['b', 'end']],
  );
  const [c] = agents.createTask({ title: 'nomatch', prompt: '[result=what] 合わない', agent: 'relay' });
  agents.start(c.id);
  await waitFor(() => store.notifications.some((n) => n.cardId === c.id && /分岐の行き先がありません/.test(n.title)));
  assert.strictEqual(c.status, 'review');
  assert.ok(!c.relay.done, '追加指示で判定し直せるよう、Pipelineは終えない');
  assert.strictEqual(c.relay.index, 0);
  assert.ok(!store.notifications.some((n) => n.cardId === c.id && /レビュー待ち/.test(n.title)));
});

test('Pipeline: 並列 — 枝ごとに別の worktree で動かし、合流ですべてマージしてから次の工程へ進む', async () => {
  const { agents, store, g } = setup();
  store.settings.relayFlow = parallelFlow('codex', 'gemini');
  const [c] = agents.createTask({ title: 'par', prompt: '並列のタスク', agent: 'relay' });
  agents.start(c.id);
  // 枝のタスクが2つでき、それぞれ親のブランチから分けた worktree で動く
  const kids = await waitFor(() => (c.relay.waiting && c.relay.waiting.children.length === 2 ? c.relay.waiting.children.map((id) => store.card(id)) : null));
  await waitFor(() => kids.every((k) => k.worktreePath));
  assert.notStrictEqual(kids[0].worktreePath, kids[1].worktreePath);
  for (const k of kids) {
    assert.strictEqual(k.baseBranch, c.branch, '親のブランチから分ける');
    assert.ok(k.relay.branchOf && k.relay.branchOf.parent === c.id);
  }
  assert.deepStrictEqual(kids.map((k) => k.agent), ['codex', 'gemini']);
  assert.throws(() => agents.send(c.id, 'x'), /並列の枝が終わるのを待っています/);
  await assert.rejects(agents.merge(kids[0].id, {}), /合流で元のタスクにマージします/);
  // 合流してから、仕上げの工程が親のカードで動き、Pipelineが終わる
  await waitFor(() => c.status === 'review' && c.relay.done, 30000);
  assert.strictEqual(c.relay.steps[c.relay.index].label, '仕上げ');
  assert.ok(!c.relay.waiting);
  assert.deepStrictEqual(
    c.relay.history.map((h) => [c.relay.steps[h.index].label, h.branch || null]),
    [['実装', null], ['枝A', '枝A'], ['枝B', '枝B']],
  );
  // 枝のタスクは片付けている（worktree・ブランチも）
  for (const k of kids) {
    assert.strictEqual(store.card(k.id), undefined);
    assert.ok(!fs.existsSync(k.worktreePath));
  }
  // 親のブランチに、両方の枝の変更が入っている
  const files = g('ls-tree', '-r', '--name-only', c.branch);
  assert.ok((files.match(/^codex-/gm) || []).length >= 3, files);
  assert.ok((files.match(/^gemini-/gm) || []).length >= 1, files);
  const diff = await agents.diff(c.id);
  assert.match(diff, /並列の枝 枝A/, '枝の報告を次の工程に渡す');
  assert.strictEqual(store.notifications.filter((n) => n.cardId === c.id && n.kind === 'review').length, 1);
});

test('Pipeline: 並列 — 合流でコンフリクトしたら止めて知らせ、解消すると続きへ進む', async () => {
  const { agents, store } = setup();
  store.settings.relayFlow = parallelFlow('codex', 'codex');
  const [c] = agents.createTask({ title: 'conflict', prompt: '[same-file] 同じファイル', agent: 'relay' });
  agents.start(c.id);
  await waitFor(() => c.conflict && c.conflict.join);
  assert.strictEqual(c.status, 'failed');
  assert.match(c.error, /コンフリクトしました（same.txt）/);
  assert.ok(store.notifications.some((n) => n.cardId === c.id && /合流でコンフリクト/.test(n.title)));
  assert.strictEqual(c.relay.waiting.merged.length, 1, '1本目の枝はマージ済み');
  // 自分で解消する
  const r = await agents.resolveConflict(c.id, 'manual');
  assert.ok(r.manual);
  fs.writeFileSync(path.join(c.worktreePath, 'same.txt'), 'resolved\n');
  await agents.completeConflict(c.id);
  await waitFor(() => c.status === 'review' && c.relay.done, 30000);
  assert.strictEqual(c.relay.steps[c.relay.index].label, '仕上げ');
  assert.ok(!c.conflict);
});

test('Pipeline: 並列の枝が失敗したら、親は待ったまま。枝を直すと合流して進む', async () => {
  const { agents, store } = setup();
  store.settings.relayFlow = flow(
    [
      ['start', 'start'],
      ['impl', 'step', step('codex', '実装')],
      ['par', 'parallel'],
      ['a', 'step', step('codex', '枝A')],
      ['b', 'step', step('codex', '枝B', '[fail-step]')],
      ['join', 'join'],
      ['end', 'end'],
    ],
    [['start', 'impl'], ['impl', 'par'], ['par', 'a'], ['par', 'b'], ['a', 'join'], ['b', 'join'], ['join', 'end']],
  );
  const [c] = agents.createTask({ title: 'kidfail', prompt: '枝が失敗', agent: 'relay' });
  agents.start(c.id);
  const kids = await waitFor(() => (c.relay.waiting && c.relay.waiting.children.length === 2 ? c.relay.waiting.children.map((id) => store.card(id)) : null));
  await waitFor(() => kids[1].status === 'failed' && kids[0].relay.atJoin && kids[0].status === 'review');
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(c.relay.waiting, '1つの枝が止まっていれば、合流しない');
  assert.ok(c.logs.some((l) => /並列の枝「枝B」が止まっています（失敗）/.test(l.text)));
  agents.send(kids[1].id, 'もう一度');
  await waitFor(() => c.status === 'review' && c.relay.done, 30000);
  assert.ok(!c.relay.waiting);
  assert.strictEqual(store.card(kids[1].id), undefined);
});

test('Pipeline: 並列の枝を待っているタスクを削除すると、枝のタスクも消す', async () => {
  const { agents, store } = setup();
  store.settings.relayFlow = parallelFlow('codex', 'codex');
  const [c] = agents.createTask({ title: 'del', prompt: '[q] 質問で止まる', agent: 'relay' });
  agents.start(c.id);
  // [q] なので最初の工程で質問して止まる → 答えて進める
  await waitFor(() => c.status === 'review' && c.awaitingReply);
  agents.send(c.id, 'はい');
  const kids = await waitFor(() => (c.relay.waiting && c.relay.waiting.children.length === 2 ? c.relay.waiting.children.map((id) => store.card(id)) : null));
  await waitFor(() => kids.every((k) => k.status === 'review' && k.awaitingReply));
  await agents.discard(c.id);
  for (const k of kids) assert.strictEqual(store.card(k.id), undefined);
});
