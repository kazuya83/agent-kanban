// Electron なしでコア部分（worktree・並列実行・承認・マージ・破棄）を通しで確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store } = require('../src/store');
const { AgentManager } = require('../src/agent');
const { PermissionServer } = require('../src/permission-server');

const FAKE = path.join(__dirname, 'fake-claude.js');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kanban-'));
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
  Object.assign(store.settings, { repoPath: repo, claudePath: fakeBin, maxParallel: 1 });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  return { tmp, repo, store, agents, g };
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

test('承認→レビュー→追加指示→マージ、拒否→破棄、同時実行数の制限', async () => {
  const { repo, store, agents, g } = setup();
  const server = new PermissionServer((p, s) => agents.requestPermission(p, s));
  await server.start();
  agents.setPermissionEndpoint(server.port, server.token);

  try {
    // 1枚目: 許可する
    const a = agents.createCard({ title: 'Add file', prompt: 'ファイルを作って' });
    // 2枚目: 拒否する（maxParallel=1 なので最初は待機）
    const b = agents.createCard({ title: 'Second', prompt: '2つ目' });
    agents.start(a.id);
    agents.start(b.id);
    assert.strictEqual(a.status, 'running');
    assert.strictEqual(b.status, 'queued');

    await waitFor(() => a.permissions.length === 1);
    assert.strictEqual(a.permissions[0].toolName, 'Bash');
    assert.ok(fs.existsSync(a.worktreePath));
    assert.strictEqual(b.status, 'queued', '上限1なので2枚目はまだ待機');
    agents.answerPermission(a.id, a.permissions[0].id, 'allow');

    await waitFor(() => a.status === 'review');
    assert.strictEqual(a.sessionId, 'sess-fake-1');
    const d = await agents.diff(a.id);
    assert.match(d, /ファイルを作って/);
    assert.ok(a.logs.some((l) => l.kind === 'system' && /コミット/.test(l.text)));

    // 2枚目が自動で動き出し、承認待ちになる → 拒否
    await waitFor(() => b.permissions.length === 1);
    agents.answerPermission(b.id, b.permissions[0].id, 'deny', 'だめ');
    await waitFor(() => b.status === 'review');
    assert.ok(b.logs.some((l) => l.kind === 'tool_error' && /だめ/.test(l.text)));

    // 1枚目に追加指示（--resume）→ 常に許可
    agents.send(a.id, 'もう1つ');
    await waitFor(() => a.permissions.length === 1);
    agents.answerPermission(a.id, a.permissions[0].id, 'always');
    await waitFor(() => a.status === 'review');
    assert.deepStrictEqual(a.alwaysAllow, ['Bash']);
    // 次からは自動で許可される
    agents.send(a.id, '3つ目');
    await waitFor(() => a.status === 'review' && a.logs.some((l) => /自動で許可/.test(l.text)));

    // マージ
    await agents.merge(a.id);
    assert.strictEqual(a.status, 'done');
    assert.strictEqual(a.worktreePath, null);
    const files = fs.readdirSync(repo).filter((f) => f.startsWith('out-'));
    assert.strictEqual(files.length, 3);
    assert.match(g('log', '--oneline').toString(), /Merge agent task: Add file/);
    assert.match(await agents.diff(a.id), /もう1つ/);

    // 2枚目を破棄 → worktree とブランチが消える
    const wt = b.worktreePath;
    await agents.discard(b.id);
    assert.ok(!fs.existsSync(wt));
    assert.ok(!g('branch').toString().includes(b.branch));
    assert.strictEqual(store.card(b.id), undefined);
  } finally {
    server.close();
  }
});

test('停止すると保留中の承認は拒否され、レビューに戻る', async () => {
  const { store, agents } = setup();
  const server = new PermissionServer((p, s) => agents.requestPermission(p, s));
  await server.start();
  agents.setPermissionEndpoint(server.port, server.token);
  try {
    const c = agents.createCard({ title: 'stop me', prompt: 'x' });
    agents.start(c.id);
    await waitFor(() => c.permissions.length === 1);
    agents.stop(c.id);
    await waitFor(() => c.status === 'review');
    assert.strictEqual(c.permissions.length, 0);
    assert.strictEqual(agents.pending.size, 0);
    store.flush();
  } finally {
    server.close();
  }
});

test('claude が見つからないとエラー列に入る', async () => {
  const { store, agents } = setup();
  store.settings.claudePath = '/nonexistent/claude';
  const c = agents.createCard({ title: 'x', prompt: 'x' });
  agents.start(c.id);
  await waitFor(() => c.status === 'failed');
  assert.match(c.error, /見つかりません/);
});
