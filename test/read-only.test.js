// ソースを変更しないタスク（SQL を作るだけなど）: worktree を作らず、ファイルを書き換えるツールを止めて動かす
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store } = require('../src/store');
const { AgentManager, READ_ONLY_DISALLOWED_TOOLS } = require('../src/agent');
const { PermissionServer } = require('../src/permission-server');

const FAKE = path.join(__dirname, 'fake-claude.js');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-readonly-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', a, { cwd: repo });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'schema.sql'), 'CREATE TABLE users (id INT);\n');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  const fakeBin = path.join(tmp, 'claude');
  fs.writeFileSync(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, { repoPath: repo, claudePath: fakeBin, maxParallel: 3, specCheck: false });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  return { tmp, repo, store, agents };
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

test('ソースを変更しないタスク: worktree を作らず、書き換えるツールを止めて動かし、「完了にする」で完了にする', async () => {
  const { tmp, repo, store, agents } = setup();
  store.repoSettings(repo).permissionMode = 'bypassPermissions'; // 「すべて自動で許可」でも、書き換えるツールは止め、コマンドは確かめる
  const server = new PermissionServer((p, s) => agents.requestPermission(p, s));
  await server.start();
  agents.setPermissionEndpoint(server.port, server.token);
  try {
    const [c] = agents.createTask({ title: 'SQL を作る', prompt: 'users を数える SQL を作って', readOnly: true });
    assert.strictEqual(c.readOnly, true);
    assert.strictEqual(c.noGit, true);
    assert.match(agents.firstPrompt(c), /ソースコードを変更しません/);
    agents.start(c.id);
    await waitFor(() => c.status === 'review');

    const text = c.logs.map((l) => l.text).join('\n');
    assert.match(text, new RegExp(`書き換え禁止: ${READ_ONLY_DISALLOWED_TOOLS.join(',')}`));
    assert.match(text, /権限モード: default/);
    assert.match(text, /SELECT 1;/);
    // worktree・ブランチは作らず、リポジトリのファイルも変えない
    assert.strictEqual(c.worktreePath, undefined);
    assert.strictEqual(c.branch, undefined);
    assert.ok(!fs.existsSync(path.join(tmp, 'repo.worktrees')));
    assert.strictEqual(execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString(), '');
    await assert.rejects(agents.merge(c.id), /完了にする/);

    agents.complete(c.id);
    assert.strictEqual(c.status, 'done');
  } finally {
    server.close();
  }
});

test('ソースを変更しないタスク: 競争は使えない。チェックしなければ、これまでどおりのタスク', () => {
  const { store, agents } = setup();
  store.settings.orchestration = 'compete';
  store.settings.enabledAgents = ['claude', 'codex'];
  store.settings.competeAgents = ['claude', 'codex'];
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete', readOnly: true }), /競争は使えません/);
  const [c] = agents.createTask({ prompt: 'y', agent: 'claude' });
  assert.strictEqual(c.readOnly, undefined);
  assert.strictEqual(c.noGit, undefined);
  assert.doesNotMatch(agents.firstPrompt(c), /ソースコードを変更しません/);
});

test('ソースを変更しないタスク: Codex / Gemini / Cursor は読み取りだけの計画モードで動かす', () => {
  const { agents } = setup();
  assert.strictEqual(agents.readOnlyPermissionMode('codex', 'bypassPermissions'), 'plan');
  assert.strictEqual(agents.readOnlyPermissionMode('gemini', 'acceptEdits'), 'plan');
  assert.strictEqual(agents.readOnlyPermissionMode('claude', 'bypassPermissions'), 'default');
  assert.strictEqual(agents.readOnlyPermissionMode('claude', 'plan'), 'plan');
});
