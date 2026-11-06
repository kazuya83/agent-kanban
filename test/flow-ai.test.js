// 文章の指示から Pipeline のフローチャートを作る・直す
const test = require('node:test');
const assert = require('node:assert');
const FlowModel = require('../renderer/flow-model');
const { buildFlowPrompt, parseFlowReply, finishFlow, generateFlow } = require('../src/flow-ai');
const { isProxyChannel } = require('../src/remote');

const nodes = [
  { id: 'start', type: 'start' },
  { id: 'a', type: 'step', agent: 'claude', label: '実装', instruction: '作る' },
  { id: 'end', type: 'end' },
];
const edges = [
  { id: 'e1', from: 'start', to: 'a' },
  { id: 'e2', from: 'a', to: 'end' },
];
const valid = { nodes, edges };
const current = () =>
  FlowModel.cleanFlow({
    nodes: nodes.map((n, i) => ({ ...n, x: 300 + i, y: 500 + i })),
    edges,
  });
const input = (extra = {}) => ({ request: '実装する工程を作って', flow: current(), enabled: ['claude', 'codex'], customAgents: [], defaultAgent: 'claude', ...extra });

test('parseFlowReply: JSON だけ・コードブロック・前後に文があるときも取り出す', () => {
  const json = JSON.stringify(valid);
  assert.deepStrictEqual(parseFlowReply(json).nodes, nodes);
  assert.deepStrictEqual(parseFlowReply(`作りました\n\`\`\`json\n${json}\n\`\`\`\n確かめてください`).nodes, nodes);
  assert.deepStrictEqual(parseFlowReply(`こちらです: ${json} 以上`).nodes, nodes);
});

test('parseFlowReply: フローでなければ null', () => {
  assert.strictEqual(parseFlowReply('何を作りますか？'), null);
  assert.strictEqual(parseFlowReply('{"a": 1}'), null);
  assert.strictEqual(parseFlowReply('{壊れた'), null);
  assert.strictEqual(parseFlowReply(''), null);
});

test('buildFlowPrompt: 指示・使えるエージェント・カスタムエージェントを伝え、位置は渡さない', () => {
  const p = buildFlowPrompt({ ...input(), customAgents: [{ id: 'rev', name: 'レビュー係', agent: 'codex', description: '厳しい' }] });
  assert.match(p, /実装する工程を作って/);
  assert.match(p, /claude, codex/);
  assert.match(p, /ID: rev \/ 名前: レビュー係 \/ CLI: codex \/ 説明: 厳しい/);
  assert.ok(!/"x":/.test(p));
});

test('finishFlow: ノードと線が今のままなら配置を保つ', () => {
  const raw = JSON.parse(JSON.stringify(valid));
  raw.nodes[1].instruction = '直した';
  const f = finishFlow(raw, input());
  const a = f.nodes.find((n) => n.id === 'a');
  assert.strictEqual(a.instruction, '直した');
  assert.strictEqual(a.x, current().nodes[1].x);
  assert.strictEqual(a.y, current().nodes[1].y);
});

test('finishFlow: ノードが増えたら上から順に並べ直す', () => {
  const raw = {
    nodes: [...nodes, { id: 'b', type: 'step', agent: 'codex', label: 'レビュー' }],
    edges: [edges[0], { id: 'e2', from: 'a', to: 'b' }, { id: 'e3', from: 'b', to: 'end' }],
  };
  const f = finishFlow(raw, input());
  const y = (id) => f.nodes.find((n) => n.id === id).y;
  assert.ok(y('start') < y('a') && y('a') < y('b') && y('b') < y('end'));
});

test('finishFlow: 使わない設定のエージェントは既定にする。今のフローにあったものは残す', () => {
  const raw = { nodes: [...nodes.slice(0, 2), { id: 'g', type: 'step', agent: 'gemini', label: 'G' }, nodes[2]], edges: [edges[0], { from: 'a', to: 'g' }, { from: 'g', to: 'end' }] };
  assert.strictEqual(finishFlow(raw, input()).nodes.find((n) => n.id === 'g').agent, 'claude');
  const flow = current();
  flow.nodes[1].agent = 'gemini';
  const kept = { nodes: [nodes[0], { ...nodes[1], agent: 'gemini' }, nodes[2]], edges };
  assert.strictEqual(finishFlow(kept, input({ flow })).nodes.find((n) => n.id === 'a').agent, 'gemini');
});

test('finishFlow: カスタムエージェントはその CLI にし、知らない ID は外す', () => {
  const raw = {
    nodes: [
      nodes[0],
      { id: 'a', type: 'step', agent: 'claude', custom: 'rev', label: 'A' },
      { id: 'b', type: 'step', agent: 'claude', custom: 'nothing', label: 'B' },
      nodes[2],
    ],
    edges: [edges[0], { from: 'a', to: 'b' }, { from: 'b', to: 'end' }],
  };
  const f = finishFlow(raw, input({ customAgents: [{ id: 'rev', name: 'R', agent: 'codex' }] }));
  assert.strictEqual(f.nodes.find((n) => n.id === 'a').agent, 'codex');
  assert.strictEqual(f.nodes.find((n) => n.id === 'b').custom, undefined);
});

test('generateFlow: 正しいフローなら1回で返す', async () => {
  let calls = 0;
  const f = await generateFlow(async () => (calls++, JSON.stringify(valid)), input());
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(FlowModel.validateFlow(f), []);
});

test('generateFlow: 形が正しくなければ、直すところを伝えて1回だけ作り直す', async () => {
  const prompts = [];
  const broken = { nodes, edges: [edges[0]] }; // 工程から先の線がない
  const f = await generateFlow(async (p) => (prompts.push(p), JSON.stringify(prompts.length === 1 ? broken : valid)), input());
  assert.strictEqual(prompts.length, 2);
  assert.match(prompts[1], /先の線がありません/);
  assert.deepStrictEqual(FlowModel.validateFlow(f), []);
});

test('generateFlow: 作り直しても形が正しくなければ、そのまま返して編集画面で直してもらう', async () => {
  let calls = 0;
  const broken = { nodes, edges: [edges[0]] };
  const f = await generateFlow(async () => (calls++, JSON.stringify(broken)), input());
  assert.strictEqual(calls, 2);
  assert.ok(FlowModel.validateFlow(f).length > 0);
});

test('generateFlow: 作り直しの返事が読めないときは、1回目のフローを返す', async () => {
  let calls = 0;
  const broken = { nodes, edges: [edges[0]] };
  const f = await generateFlow(async () => (calls++ ? 'ごめんなさい' : JSON.stringify(broken)), input());
  assert.strictEqual(f.nodes.length, 3);
});

test('generateFlow: フローが返ってこなければ、返事を添えてエラーにする', async () => {
  await assert.rejects(generateFlow(async () => '何を作りますか？', input()), /フローの形で返ってきませんでした: 何を作りますか/);
});

test('generateFlow: 指示が空なら、エージェントに聞かない', async () => {
  let calls = 0;
  await assert.rejects(generateFlow(async () => (calls++, ''), input({ request: '  ' })), /書いてください/);
  assert.strictEqual(calls, 0);
});

test('autoLayout: 並列の枝は横に並び、長い枝のあとに合流し、戻る線で段が崩れない', () => {
  const f = FlowModel.cleanFlow({
    nodes: [
      { id: 's', type: 'start' },
      { id: 'p', type: 'step', label: '準備', agent: 'claude' },
      { id: 'par', type: 'parallel', label: '並列' },
      { id: 'a', type: 'step', label: 'A', agent: 'claude' },
      { id: 'b1', type: 'step', label: 'B1', agent: 'claude' },
      { id: 'b2', type: 'step', label: 'B2', agent: 'claude' },
      { id: 'j', type: 'join', label: '合流' },
      { id: 'r', type: 'step', label: 'レビュー', agent: 'claude' },
      { id: 'c', type: 'if', label: '判定' },
      { id: 'e', type: 'end' },
    ],
    edges: [
      { from: 's', to: 'p' },
      { from: 'p', to: 'par' },
      { from: 'par', to: 'a' },
      { from: 'par', to: 'b1' },
      { from: 'b1', to: 'b2' },
      { from: 'a', to: 'j' },
      { from: 'b2', to: 'j' },
      { from: 'j', to: 'r' },
      { from: 'r', to: 'c' },
      { from: 'c', to: 'e', value: 'pass', else: true },
      { from: 'c', to: 'p', value: 'fail' },
    ],
  });
  FlowModel.autoLayout(f);
  const n = (id) => f.nodes.find((x) => x.id === id);
  assert.strictEqual(n('a').y, n('b1').y);
  assert.notStrictEqual(n('a').x, n('b1').x);
  assert.ok(n('j').y > n('b2').y);
  assert.ok(n('e').y > n('c').y);
  assert.ok(n('s').y < n('p').y);
  // 保存し直しても位置が崩れない（範囲の中）
  assert.ok(f.nodes.every((x) => x.x >= 0 && x.y >= 0 && x.x <= 6000 && x.y <= 6000));
});

test('flow:generate は遠隔操作でホストへ転送する', () => {
  assert.strictEqual(isProxyChannel('flow:generate'), true);
});
