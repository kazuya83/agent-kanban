const test = require('node:test');
const assert = require('node:assert');
const { droppedSettingKeys, droppedSettingsMessage } = require('../src/remote');
const { FlowEditor } = require('../renderer/flow-editor');

test('古い版のホストが受け取らなかった設定を見つける', () => {
  const patch = { relayFlow: { nodes: [] }, customAgents: [], baseBranch: 'main' };
  // 古いホストは知らない項目を捨てて、今の設定を返す
  assert.deepStrictEqual(droppedSettingKeys(patch, { baseBranch: 'main', relaySteps: [] }), ['relayFlow', 'customAgents']);
  // 新しいホストなら全部返ってくる（空の配列・空文字も「受け取った」とみなす）
  assert.deepStrictEqual(droppedSettingKeys(patch, { relayFlow: { nodes: [] }, customAgents: [], baseBranch: '' }), []);
  assert.deepStrictEqual(droppedSettingKeys(null, {}), []);
  assert.deepStrictEqual(droppedSettingKeys(patch, null), []);
  const msg = droppedSettingsMessage(['relayFlow', 'customAgents']);
  assert.match(msg, /Pipelineのフローチャート/);
  assert.match(msg, /カスタムエージェント/);
  assert.match(msg, /新しい版に更新/);
});

test('名前を入れていないカスタムエージェントの工程は、カスタムエージェントの名前にする', () => {
  const customs = [{ id: 'ca1', name: '慎重なレビュアー', agent: 'claude' }];
  const flow = {
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'a', type: 'step', agent: 'claude', custom: 'ca1', label: '' },
      { id: 'b', type: 'step', agent: 'claude', custom: 'ca1', label: 'レビュー' },
      { id: 'c', type: 'step', agent: 'codex', label: '' },
      { id: 'd', type: 'step', agent: 'claude', custom: 'gone', label: '  ' },
    ],
    edges: [],
  };
  assert.strictEqual(FlowEditor.fillCustomLabels(flow, customs), true);
  assert.deepStrictEqual(flow.nodes.map((n) => n.label), [undefined, '慎重なレビュアー', 'レビュー', '', '  ']);
  assert.strictEqual(FlowEditor.fillCustomLabels(flow, customs), false);
});
