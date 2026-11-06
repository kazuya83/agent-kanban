// Pipeline をプロジェクトの中で複数持つ・選んでタスクを作る・エクスポートとインポート
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store, cleanRelayFlows, relayPatchOf, pickRepoSettings, setRepoSettings, repoSettingsOf, migrateSettings, DEFAULT_SETTINGS } = require('../src/store');
const { AgentManager } = require('../src/agent');
const FlowModel = require('../renderer/flow-model');
const Pack = require('../renderer/pipeline-pack');

const twoSteps = (a, b) => FlowModel.flowFromSteps([{ agent: a, label: '実装', instruction: '' }, { agent: b, label: 'レビュー', instruction: '' }]);
const stepAgents = (flow) => FlowModel.orderSteps(flow).map((n) => n.agent);

test('前の版の relayFlow だけの設定は、Pipeline 1つの一覧になる', () => {
  const r = cleanRelayFlows(undefined, '', twoSteps('codex', 'claude'));
  assert.strictEqual(r.relayFlows.length, 1);
  assert.strictEqual(r.relayFlows[0].name, 'Pipeline');
  assert.strictEqual(r.relayFlowId, r.relayFlows[0].id);
  assert.deepStrictEqual(stepAgents(r.relayFlow), ['codex', 'claude']);
  // 読み込むとき（migrateSettings）も同じ
  const s = { ...DEFAULT_SETTINGS, repoPath: '/r', relayFlow: twoSteps('gemini', 'claude') };
  migrateSettings(s, { relayFlow: s.relayFlow, enabledAgents: ['claude'] }, []);
  assert.strictEqual(s.relayFlows.length, 1);
  assert.deepStrictEqual(stepAgents(s.relayFlows[0].flow), ['gemini', 'claude']);
});

test('一覧の ID・名前を整え、既定の Pipeline のフローを relayFlow にそろえる', () => {
  const r = cleanRelayFlows(
    [
      { id: 'a', name: '  速い  ', flow: twoSteps('claude', 'claude') },
      { id: 'a', name: '', flow: twoSteps('codex', 'codex') }, // ID が重なる・名前がない
      { id: 'bad id!', name: 'x', flow: null }, // フローがなければ初期値
      null,
    ],
    'p2',
  );
  assert.deepStrictEqual(r.relayFlows.map((p) => p.id), ['a', 'p2', 'p3']);
  assert.strictEqual(r.relayFlows[0].name, '速い');
  assert.strictEqual(r.relayFlows[1].name, 'Pipeline 2');
  assert.strictEqual(r.relayFlowId, 'p2');
  assert.deepStrictEqual(stepAgents(r.relayFlow), ['codex', 'codex']);
  // 知らない既定の ID なら先頭
  assert.strictEqual(cleanRelayFlows(r.relayFlows, 'nope').relayFlowId, 'a');
});

test('relayFlow だけを変えると既定の Pipeline が変わり、一覧を変えると relayFlow も合わせる', () => {
  const cur = cleanRelayFlows([{ id: 'a', name: 'A', flow: twoSteps('claude', 'claude') }, { id: 'b', name: 'B', flow: twoSteps('codex', 'codex') }], 'b');
  const p1 = relayPatchOf(cur, { relayFlow: twoSteps('gemini', 'gemini') });
  assert.deepStrictEqual(stepAgents(p1.relayFlows[1].flow), ['gemini', 'gemini']);
  assert.deepStrictEqual(stepAgents(p1.relayFlows[0].flow), ['claude', 'claude']);
  const p2 = relayPatchOf(cur, { relayFlowId: 'a' });
  assert.deepStrictEqual(stepAgents(p2.relayFlow), ['claude', 'claude']);
  assert.strictEqual(relayPatchOf(cur, { baseBranch: 'main' }), null);
  // 開いていないプロジェクトの設定を変えても、一覧と relayFlow はそろう
  const s = { ...DEFAULT_SETTINGS, repoPath: '/r1', repoSettings: {} };
  setRepoSettings(s, '/r2', { relayFlows: cur.relayFlows, relayFlowId: 'a' });
  const r2 = repoSettingsOf(s, '/r2');
  assert.strictEqual(r2.relayFlows.length, 2);
  assert.strictEqual(r2.relayFlowId, 'a');
  assert.deepStrictEqual(stepAgents(r2.relayFlow), ['claude', 'claude']);
  assert.strictEqual(repoSettingsOf(s, '/r1').relayFlows.length, 1);
  assert.deepStrictEqual(pickRepoSettings(r2).relayFlows.map((p) => p.name), ['A', 'B']);
});

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-pipes-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, { repoPath: repo, enabledAgents: ['claude', 'codex', 'gemini'], orchestration: 'relay', specCheck: false });
  Object.assign(store.settings, cleanRelayFlows([{ id: 'fast', name: '速い', flow: twoSteps('claude', 'claude') }, { id: 'care', name: '慎重', flow: twoSteps('codex', 'gemini') }], 'fast'));
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  return { store, agents };
}

test('タスクを作るときに Pipeline を選べる（relay だけなら既定の Pipeline）', () => {
  const { agents } = setup();
  const [a] = agents.createTask({ title: 't1', prompt: 'p', agent: 'relay' });
  assert.strictEqual(a.relay.pipeline.id, 'fast');
  assert.deepStrictEqual(a.relay.steps.map((s) => s.agent), ['claude', 'claude']);
  const [b] = agents.createTask({ title: 't2', prompt: 'p', agent: 'relay:care' });
  assert.strictEqual(b.relay.pipeline.name, '慎重');
  assert.strictEqual(b.agent, 'codex');
  assert.deepStrictEqual(b.relay.steps.map((s) => s.agent), ['codex', 'gemini']);
  assert.throws(() => agents.createTask({ title: 't3', prompt: 'p', agent: 'relay:gone' }), /Pipeline が見つかりません/);
});

test('Pipeline 1つを JSON にして読み戻せる', async () => {
  const flow = twoSteps('claude', 'codex');
  const json = Pack.exportPipelineJson({ name: 'レビュー付き', flow });
  const r = await Pack.parseImport('x.json', new TextEncoder().encode(json));
  assert.strictEqual(r.pipelines.length, 1);
  assert.strictEqual(r.pipelines[0].name, 'レビュー付き');
  assert.deepStrictEqual(r.pipelines[0].flow, flow);
  // フローだけの JSON も、ファイル名を名前にして読める
  const r2 = await Pack.parseImport('my-flow.json', new TextEncoder().encode(JSON.stringify(flow)));
  assert.strictEqual(r2.pipelines[0].name, 'my-flow');
  await assert.rejects(Pack.parseImport('x.json', new TextEncoder().encode('{"a":1}')), /Pipeline のファイル/);
});

test('Pipeline とカスタムエージェントを zip にまとめて読み戻せる（無圧縮・deflate のどちらも）', async () => {
  const flow = twoSteps('claude', 'claude');
  flow.nodes.find((n) => n.type === 'step').custom = 'caA';
  const ca = { id: 'caA', name: '慎重なレビュアー', icon: '🔍', color: '#112233', description: 'd', instruction: 'i', agent: 'codex', model: '' };
  const zip = Pack.exportBundleZip({ pipelines: [{ name: '速い', flow }, { name: '速い', flow }], customAgents: [ca] });
  assert.ok(Pack.isZip(zip));
  const entries = await Pack.readZip(zip);
  assert.deepStrictEqual(entries.map((e) => e.name), ['manifest.json', 'pipelines/01-pipeline.json', 'pipelines/02-pipeline.json', 'custom-agents/01-custom-agent.json']);
  const r = await Pack.parseImport('b.zip', zip);
  assert.strictEqual(r.pipelines.length, 2);
  assert.deepStrictEqual(r.customAgents, [ca]);
  // ほかのツールで作った（deflate で圧縮した）zip も読める
  const zlib = require('zlib');
  const data = Buffer.from(Pack.exportPipelineJson({ name: 'D', flow }));
  const comp = zlib.deflateRawSync(data);
  const plain = Pack.makeZip([{ name: 'a.json', data: new Uint8Array(comp) }]);
  const v = new DataView(plain.buffer);
  // 圧縮方式・サイズ・CRC を deflate のものに書き換える
  const crc = Pack.crc32(new Uint8Array(data));
  v.setUint16(8, 8, true);
  v.setUint32(14, crc, true);
  v.setUint32(22, data.length, true);
  const cd = v.getUint32(plain.length - 6, true);
  v.setUint16(cd + 10, 8, true);
  v.setUint32(cd + 16, crc, true);
  v.setUint32(cd + 24, data.length, true);
  const r2 = await Pack.parseImport('d.zip', plain);
  assert.strictEqual(r2.pipelines[0].name, 'D');
});

test('取り込むとき: 同じ中身のカスタムエージェントは使い回し、違えば足して工程の ID を付け替える', () => {
  const flow = twoSteps('claude', 'claude');
  const steps = flow.nodes.filter((n) => n.type === 'step');
  steps[0].custom = 'caA';
  steps[1].custom = 'caB';
  const A = { id: 'caA', name: 'A', icon: '', color: '#6366f1', description: '', instruction: 'x', agent: 'claude', model: '' };
  const B = { id: 'caB', name: 'B', icon: '', color: '#6366f1', description: '', instruction: 'y', agent: 'codex', model: '' };
  const current = {
    relayFlows: [{ id: 'default', name: '速い', flow: twoSteps('claude', 'claude') }],
    customAgents: [{ ...A, id: 'mine' }, { ...B, id: 'caB', instruction: 'ちがう' }],
  };
  const m = Pack.mergeImport(current, { pipelines: [{ name: '速い', flow }], customAgents: [A, B] });
  assert.deepStrictEqual(m.reusedAgents, ['A']);
  assert.deepStrictEqual(m.addedAgents, ['B (2)']);
  assert.deepStrictEqual(m.addedPipelines, ['速い (2)']);
  const added = m.customAgents.find((x) => x.name === 'B (2)');
  assert.notStrictEqual(added.id, 'caB');
  const ns = m.relayFlows[1].flow.nodes.filter((n) => n.type === 'step');
  assert.deepStrictEqual(ns.map((n) => n.custom), ['mine', added.id]);
  assert.deepStrictEqual(m.missing, []);
  // 今の一覧は変えない
  assert.strictEqual(current.relayFlows.length, 1);
  // カスタムエージェントがないまま Pipeline だけを取り込むと、見つからない工程として知らせる
  const m2 = Pack.mergeImport({ relayFlows: [], customAgents: [] }, { pipelines: [{ name: 'X', flow }], customAgents: [] });
  assert.strictEqual(m2.missing.length, 2);
});

test('Pipeline の名前は15文字まで（前の版の長い名前も切り、重なったら番号を付ける）', () => {
  const { PIPELINE_NAME_MAX } = require('../src/store');
  assert.strictEqual(PIPELINE_NAME_MAX, 15);
  assert.strictEqual(Pack.PIPELINE_NAME_MAX, PIPELINE_NAME_MAX);
  const long = 'とても長い名前のパイプラインでプルダウンが見切れる';
  const r = cleanRelayFlows([
    { id: 'a', name: long, flow: twoSteps('claude', 'claude') },
    { id: 'b', name: long + 'その2', flow: twoSteps('claude', 'claude') },
  ], 'a');
  assert.strictEqual(r.relayFlows[0].name, [...long].slice(0, 15).join(''));
  assert.ok([...r.relayFlows[1].name].length <= 15);
  assert.ok(r.relayFlows[1].name.endsWith(' (2)'));
  // インポートでも15文字まで
  const m = Pack.mergeImport({ relayFlows: [], customAgents: [] }, { pipelines: [{ name: long, flow: twoSteps('claude', 'claude') }], customAgents: [] });
  assert.strictEqual(m.addedPipelines[0], [...long].slice(0, 15).join(''));
});
