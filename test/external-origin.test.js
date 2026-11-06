// 外から来た指示のタスク（Issue から作った・Slack から頼んだ・そのサブタスク）は、「すべて自動で許可」にしない
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store } = require('../src/store');
const { AgentManager } = require('../src/agent');

const FAKE = path.join(__dirname, 'fake-claude.js');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-external-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const fakeBin = path.join(tmp, 'claude');
  fs.writeFileSync(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, { repoPath: repo, claudePath: fakeBin, maxParallel: 3, permissionMode: 'bypassPermissions', specCheck: false });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  return { tmp, repo, store, agents, g };
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

test('externalOrigin: Issue・Slack のカードと、そのサブタスク・リレーの枝だけが外から来た指示', () => {
  const { store, agents } = setup();
  const plain = agents.createCard({ title: 'a', prompt: 'a' });
  const issue = agents.createCard({ title: 'b', prompt: 'b', issue: { number: 7, title: 'x' } });
  const slack = agents.createCard({ title: 'c', prompt: 'c', slack: { channel: 'C1', user: 'U1', ts: '1.1', threadTs: '1.1' } });
  assert.strictEqual(agents.externalOrigin(plain), false);
  assert.strictEqual(agents.externalOrigin(issue), true);
  assert.strictEqual(agents.externalOrigin(slack), true);

  // サブタスク（孫まで）とリレーの枝は、親をたどる
  const sub = { id: 'sub', subtaskOf: { parent: issue.id, key: 'k' } };
  const grand = { id: 'grand', subtaskOf: { parent: 'sub', key: 'k2' } };
  const branch = { id: 'br', relay: { branchOf: { parent: slack.id, node: 'n' } } };
  const orphan = { id: 'orphan', subtaskOf: { parent: plain.id, key: 'k' } };
  store.cards.push(sub, grand, branch, orphan);
  assert.strictEqual(agents.externalOrigin(sub), true);
  assert.strictEqual(agents.externalOrigin(grand), true);
  assert.strictEqual(agents.externalOrigin(branch), true);
  assert.strictEqual(agents.externalOrigin(orphan), false);
  assert.strictEqual(agents.externalOrigin({ id: 'gone', subtaskOf: { parent: 'nope', key: 'k' } }), false, '親が無ければ外から来たとは言わない');

  // 循環していても止まる
  const x = { id: 'x', subtaskOf: { parent: 'y', key: 'k' } };
  const y = { id: 'y', subtaskOf: { parent: 'x', key: 'k' } };
  store.cards.push(x, y);
  assert.strictEqual(agents.externalOrigin(x), false);
});

test('taskPermissionMode: 外から来た指示のときだけ bypassPermissions を acceptEdits にし、ログに1回だけ書く', () => {
  const { agents } = setup();
  const plain = agents.createCard({ title: 'a', prompt: 'a' });
  const issue = agents.createCard({ title: 'b', prompt: 'b', issue: { number: 7, title: 'x' } });
  assert.strictEqual(agents.taskPermissionMode(plain, 'bypassPermissions'), 'bypassPermissions', 'ふつうのタスクは設定のまま');
  assert.strictEqual(agents.taskPermissionMode(issue, 'acceptEdits'), 'acceptEdits');
  assert.strictEqual(agents.taskPermissionMode(issue, 'default'), 'default');
  assert.strictEqual(agents.taskPermissionMode(issue, 'plan'), 'plan');
  assert.strictEqual(agents.taskPermissionMode(issue, 'bypassPermissions'), 'acceptEdits');
  assert.strictEqual(agents.taskPermissionMode(issue, 'bypassPermissions'), 'acceptEdits');
  const notes = issue.logs.filter((l) => /すべて自動で許可/.test(l.text));
  assert.strictEqual(notes.length, 1, '何度始めても知らせは1回');
  assert.ok(!plain.logs.some((l) => /すべて自動で許可/.test(l.text)));
});

test('Issue から作ったタスクは、プロジェクトが「すべて自動で許可」でも acceptEdits で起動する', async () => {
  const { store, agents } = setup();
  const plain = agents.createCard({ title: 'plain', prompt: 'ふつう' });
  const c = agents.createCard({ title: '#7 x', prompt: 'Issue の本文', issue: { number: 7, title: 'x', url: 'https://github.com/o/r/issues/7' } });
  agents.start(plain.id);
  agents.start(c.id);
  await waitFor(() => plain.status === 'review' && c.status === 'review');
  const started = (card) => card.logs.map((l) => l.text).find((t) => /セッション開始/.test(t)) || '';
  assert.match(started(plain), /権限モード: bypassPermissions/, 'ふつうのタスクは設定どおり');
  assert.match(started(c), /権限モード: acceptEdits/, 'Issue のタスクは acceptEdits');
  assert.ok(c.logs.some((l) => /外から来た指示/.test(l.text)), 'カードのログで知らせる');
  assert.strictEqual(store.card(c.id).externalModeNoted, true);
});
