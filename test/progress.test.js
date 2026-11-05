// 進捗タブ: エージェントの TODO リストの読み取りと、Pipelineのフローチャートの状態
const test = require('node:test');
const assert = require('node:assert');
const providers = require('../src/providers');
const FlowModel = require('../renderer/flow-model');
const FlowView = require('../renderer/flow-view');

test('Claude Code の TodoWrite を TODO リストにそろえる（作業中は activeForm を出す）', () => {
  const items = providers.todosFromTool('TodoWrite', {
    todos: [
      { content: '調べる', status: 'completed', activeForm: '調べています' },
      { content: '直す', status: 'in_progress', activeForm: '直しています' },
      { content: 'テスト', status: 'pending', activeForm: 'テストしています' },
    ],
  });
  assert.deepStrictEqual(items, [
    { text: '調べる', status: 'completed' },
    { text: '直しています', status: 'in_progress' },
    { text: 'テスト', status: 'pending' },
  ]);
  assert.strictEqual(providers.todosFromTool('Bash', { todos: [] }), null);
});

test('Codex の todo_list・Gemini の write_todos・Cursor の todo を読み取る', () => {
  const cp = providers.createParser('codex');
  const out = cp.onEvent({ type: 'item.updated', item: { id: 'x', type: 'todo_list', items: [{ text: 'A', completed: true }, { text: 'B', completed: false }] } });
  assert.deepStrictEqual(out, [{ type: 'todos', items: [{ text: 'A', status: 'completed' }, { text: 'B', status: 'pending' }] }]);

  const gp = providers.createParser('gemini');
  const g = gp.onEvent({ type: 'tool_use', tool_name: 'write_todos', parameters: { todos: [{ description: 'C', status: 'in_progress' }, { description: 'D', status: 'cancelled' }] } });
  assert.deepStrictEqual(g.find((a) => a.type === 'todos').items, [{ text: 'C', status: 'in_progress' }, { text: 'D', status: 'cancelled' }]);

  const up = providers.createParser('cursor');
  const u = up.onEvent({ type: 'tool_call', subtype: 'started', call_id: '1', tool_call: { updateTodosToolCall: { args: { todos: [{ content: 'E', status: 'TODO_STATUS_COMPLETED' }, { content: 'F', status: 'TODO_STATUS_IN_PROGRESS' }] } } } });
  assert.deepStrictEqual(u.find((a) => a.type === 'todos').items, [{ text: 'E', status: 'completed' }, { text: 'F', status: 'in_progress' }]);
});

// 開始 → 実装 → レビュー → 分岐（fail は実装へ戻る / pass は終了）
function loopFlow() {
  return FlowModel.cleanFlow({
    nodes: [
      { id: 'start', type: 'start', x: 60, y: 30 },
      { id: 'impl', type: 'step', agent: 'claude', label: '実装', x: 60, y: 120 },
      { id: 'rev', type: 'step', agent: 'codex', label: 'レビュー', x: 60, y: 240 },
      { id: 'if', type: 'if', label: '判定', x: 60, y: 360 },
      { id: 'end', type: 'end', x: 60, y: 480 },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'impl' },
      { id: 'e2', from: 'impl', to: 'rev' },
      { id: 'e3', from: 'rev', to: 'if' },
      { id: 'e4', from: 'if', to: 'impl', value: 'fail', maxLoops: 3 },
      { id: 'e5', from: 'if', to: 'end', value: 'pass' },
    ],
  });
}

test('フローチャート: 今の工程の手前までが完了で、分岐は先へ進むまで通っていない', () => {
  const f = loopFlow();
  const steps = { impl: 'done', rev: 'running' };
  const st = FlowView.nodeStates(f, (id) => steps[id] || null, { started: true });
  assert.strictEqual(st.get('start'), 'done');
  assert.strictEqual(st.get('impl'), 'done');
  assert.strictEqual(st.get('rev'), 'running');
  // 戻る線の先（実装）が完了していても、分岐はまだ通っていない
  assert.strictEqual(st.get('if'), 'pending');
  assert.strictEqual(st.get('end'), 'pending');
  const back = FlowModel.backEdges(f);
  const e = (id) => FlowView.edgeState(f.edges.find((x) => x.id === id), st, back, {});
  assert.strictEqual(e('e1'), 'done');
  assert.strictEqual(e('e2'), 'active');
  assert.strictEqual(e('e3'), '');
  assert.strictEqual(e('e4'), '');
  // ループで戻ったら、戻る線も通ったことにする
  assert.strictEqual(FlowView.edgeState(f.edges.find((x) => x.id === 'e4'), st, back, { e4: 1 }), 'done');
});

test('フローチャート: 終えたら終了と分岐も完了になり、SVG に工程の名前と状態が入る', () => {
  const f = loopFlow();
  const st = FlowView.nodeStates(f, () => 'done', { started: true, finished: true });
  assert.ok([...st.values()].every((v) => v === 'done'));
  const svg = FlowView.html(f, st, { marks: { done: '✓' }, labels: { done: '完了' }, stepInfo: (n) => ({ title: n.label, sub: n.agent }) });
  assert.match(svg, /<svg class="fv"/);
  assert.match(svg, /実装/);
  assert.match(svg, /fv-node t-step rs-done/);
  assert.match(svg, /fv-edge e-done/);
  // 位置のないフロー（前の版のカード）は描かない
  assert.strictEqual(FlowView.html({ nodes: [{ id: 'a', type: 'step' }], edges: [] }, new Map()), '');
});
