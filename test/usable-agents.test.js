// Claude Code を前提にせず、今使えるエージェントで始められること
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const providers = require('../src/providers');
const { Store, repoSettingsOf, switchRepoSettings, setRepoSettings, DEFAULT_SETTINGS } = require('../src/store');
const { AgentManager } = require('../src/agent');
const { Scheduler } = require('../src/scheduler');

const stepAgents = (flow) => flow.nodes.filter((n) => n.type === 'step').map((n) => n.agent);
const tmpStore = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usable-agents-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { file: path.join(dir, 'board.json'), dir };
};

test('Pipeline の初期値は、今使えるエージェントで組む', () => {
  const agentsOf = (on) => providers.defaultRelaySteps(on).map((x) => x.agent);
  assert.deepStrictEqual(agentsOf(undefined), ['codex', 'claude'], '指定がなければ前と同じ');
  assert.deepStrictEqual(agentsOf(['claude', 'codex']), ['codex', 'claude']);
  assert.deepStrictEqual(agentsOf(['claude']), ['claude', 'claude']);
  assert.deepStrictEqual(agentsOf(['gemini']), ['gemini', 'gemini']);
  assert.deepStrictEqual(agentsOf(['codex', 'gemini']), ['codex', 'gemini']);
});

test('初めて開くリポジトリの Pipeline は、今使えるエージェントで組む。保存してある Pipeline は変えない', () => {
  const s = { ...DEFAULT_SETTINGS, enabledAgents: ['gemini'], repoPath: '', repoSettings: {} };
  assert.deepStrictEqual(stepAgents(repoSettingsOf(s, '/new').relayFlow), ['gemini', 'gemini']);
  setRepoSettings(s, '/patched', { baseBranch: 'develop' });
  assert.deepStrictEqual(stepAgents(repoSettingsOf(s, '/patched').relayFlow), ['gemini', 'gemini']);
  switchRepoSettings(s, '/open');
  assert.deepStrictEqual(stepAgents(s.relayFlow), ['gemini', 'gemini']);
  s.enabledAgents = ['claude'];
  assert.deepStrictEqual(stepAgents(repoSettingsOf(s, '/open').relayFlow), ['gemini', 'gemini']);
});

test('初めて起動したときは、インストールされているエージェントを使う設定にする', (t) => {
  const { file } = tmpStore(t);
  const store = new Store(file);
  assert.strictEqual(store.adoptAgents(['codex', 'gemini']), true);
  assert.deepStrictEqual(store.settings.enabledAgents, ['codex', 'gemini']);
  assert.strictEqual(store.settings.defaultAgent, 'codex');
  assert.deepStrictEqual(store.settings.competeAgents, ['codex', 'gemini']);
  assert.deepStrictEqual(stepAgents(store.settings.relayFlow), ['codex', 'gemini']);
  assert.strictEqual(store.adoptAgents(['claude']), false, '2回目は変えない');
  assert.deepStrictEqual(store.settings.enabledAgents, ['codex', 'gemini']);
});

test('見つからなければ何も変えず、次に起動したときにまた探す', (t) => {
  const { file } = tmpStore(t);
  const store = new Store(file);
  assert.strictEqual(store.adoptAgents([]), false);
  assert.deepStrictEqual(store.settings.enabledAgents, ['claude']);
  store.flush();
  const next = new Store(file);
  assert.strictEqual(next.adoptAgents(['cursor']), true);
  assert.deepStrictEqual(next.settings.enabledAgents, ['cursor']);
});

test('前から使っている設定は、起動しても変えない', (t) => {
  const { file } = tmpStore(t);
  fs.writeFileSync(file, JSON.stringify({ settings: { enabledAgents: ['claude'], defaultAgent: 'claude' }, cards: [] }));
  const store = new Store(file);
  assert.strictEqual(store.adoptAgents(['codex']), false);
  assert.deepStrictEqual(store.settings.enabledAgents, ['claude']);
});

test('エージェントを指定しないカードは、最初から選んでおくエージェントで動く', (t) => {
  const { file, dir } = tmpStore(t);
  const store = new Store(file);
  store.settings.enabledAgents = ['codex'];
  store.settings.defaultAgent = 'codex';
  store.settings.repoPath = dir;
  const agents = new AgentManager(store, {});
  const card = agents.createCard({ prompt: '作業', parsed: [], skipSpecCheck: true });
  assert.strictEqual(card.agent, 'codex');
});

test('スケジュールのエージェントを使わない設定にしたら、今使えるエージェントで動かす', () => {
  const calls = [];
  const settings = { enabledAgents: ['codex'], defaultAgent: 'codex' };
  const store = { settings, data: { schedules: [] }, save() {} };
  const agents = { on() {}, createTask: (o) => (calls.push(o), [{ id: 'x' }]), start() {} };
  const sch = new Scheduler({ store, agents, exists: () => true });
  const base = { id: 's', title: 't', prompt: 'p', rule: {}, runs: [] };
  sch.fire({ ...base, agent: 'claude', model: 'opus' });
  sch.fire({ ...base, agent: 'codex', model: 'gpt-5' });
  sch.fire({ ...base, agent: 'relay' });
  assert.deepStrictEqual(calls.map((c) => [c.agent, c.model]), [[undefined, undefined], ['codex', 'gpt-5'], ['relay', undefined]]);
});

test('after-merge-build.sh は、見つかったエージェントをそれぞれのやり方で動かす', { skip: process.platform === 'win32' }, (t) => {
  const { dir } = tmpStore(t);
  const sh = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'after-merge-build.sh'), 'utf8');
  const fns = sh.slice(sh.indexOf('# ---- 使うエージェント ----'), sh.indexOf('run_once() {'));
  for (const n of ['codex', 'gemini', 'agy']) fs.writeFileSync(path.join(dir, n), '#!/bin/sh\necho "$0 $*"\n', { mode: 0o755 });
  const run = (env) =>
    execFileSync('/bin/bash', ['-c', `set -u\nclaude_bin=claude\n${fns}\npick_agent || { echo none; exit 0; }\nrun_agent "$(skill_line)"`], {
      env: { PATH: `${dir}:/usr/bin:/bin`, ...env },
      encoding: 'utf8',
    });
  assert.match(run({}), /codex exec .*SKILL\.md/);
  assert.match(run({ AFTER_MERGE_AGENT: 'gemini' }), /gemini -p .*SKILL\.md.*--approval-mode yolo/);
  assert.match(run({ AFTER_MERGE_AGENT: 'antigravity' }), /agy -p .*SKILL\.md.*--dangerously-skip-permissions/);
  assert.strictEqual(run({ AFTER_MERGE_AGENT: 'cursor' }).trim(), 'none');
  fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\necho "$0 $*"\n', { mode: 0o755 });
  assert.match(run({}), /claude -p \/build-apps review --permission-mode acceptEdits/, 'claude があれば前と同じ');
});
