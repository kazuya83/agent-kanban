// git で管理していないフォルダ（動画づくりなど）でタスクを動かす
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, isNoGitRepo, markNoGitRepo, repoTabSummary } = require('../src/store');
const { AgentManager } = require('../src/agent');
const { PermissionServer } = require('../src/permission-server');
const rs = require('../src/repo-setup');

const FAKE = path.join(__dirname, 'fake-claude.js');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-nogit-'));
  const folder = path.join(tmp, 'videos');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'script.md'), '台本\n');
  const fakeBin = path.join(tmp, 'claude');
  fs.writeFileSync(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, { repoPath: folder, claudePath: fakeBin, maxParallel: 3, specCheck: false });
  markNoGitRepo(store.settings, folder, true);
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  return { tmp, folder, store, agents };
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

test('isNoGitRepo / markNoGitRepo: git なしのフォルダを覚え、git リポジトリになったら外す', () => {
  const s = {};
  assert.strictEqual(isNoGitRepo(s, '/a'), false);
  markNoGitRepo(s, '/a', true);
  markNoGitRepo(s, '/b', true);
  markNoGitRepo(s, '/a', true);
  assert.deepStrictEqual(s.noGitRepos, ['/a', '/b']);
  assert.strictEqual(isNoGitRepo(s, '/a'), true);
  markNoGitRepo(s, '/a', false);
  assert.strictEqual(isNoGitRepo(s, '/a'), false);
  assert.deepStrictEqual(repoTabSummary(['/a', '/b'], [], s).map((t) => !!t.noGit), [false, true]);
});

test('createRepo: git: false なら、git で管理しない空のフォルダを作るだけ', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-nogit-create-'));
  const r = await rs.createRepo({ parent, name: 'movie', git: false });
  assert.strictEqual(r.dir, path.join(parent, 'movie'));
  assert.strictEqual(r.git, false);
  assert.deepStrictEqual(fs.readdirSync(r.dir), []);
  await assert.rejects(rs.createRepo({ parent, name: 'x', git: false, github: 'private' }), /GitHub には作れません/);
});

test('git なしのフォルダ: worktree を作らずにフォルダで直接動かし、「完了にする」で完了にする', async () => {
  const { tmp, folder, agents } = setup();
  const server = new PermissionServer((p, s) => agents.requestPermission(p, s));
  await server.start();
  agents.setPermissionEndpoint(server.port, server.token);
  try {
    // 並列に動かせる（同じフォルダで2つ）
    const a = agents.createCard({ title: 'サムネを作る', prompt: 'サムネを作って' });
    const b = agents.createCard({ title: '台本を書く', prompt: '台本を書いて' });
    assert.strictEqual(a.noGit, true);
    agents.start(a.id);
    agents.start(b.id);
    assert.strictEqual(a.status, 'running');
    assert.strictEqual(b.status, 'running');
    await waitFor(() => a.permissions.length === 1 && b.permissions.length === 1);
    agents.answerPermission(a.id, a.permissions[0].id, 'allow');
    agents.answerPermission(b.id, b.permissions[0].id, 'allow');
    await waitFor(() => a.status === 'review' && b.status === 'review');

    // フォルダの中に直接書かれ、worktree・ブランチは作られない
    assert.strictEqual(a.worktreePath, undefined);
    assert.strictEqual(a.branch, undefined);
    assert.ok(!fs.existsSync(path.join(tmp, 'videos.worktrees')));
    const outs = fs.readdirSync(folder).filter((f) => f.startsWith('out-'));
    assert.strictEqual(outs.length, 2);
    assert.ok(!a.logs.some((l) => /コミット/.test(l.text)));

    assert.strictEqual(await agents.diff(a.id), '');
    assert.deepStrictEqual(await agents.worktree(a.id), { exists: false, status: null, worktrees: [] });
    await assert.rejects(agents.merge(a.id), /完了にする/);
    await assert.rejects(agents.createPullRequest(a.id), /完了にする/);

    // 追加指示も同じフォルダで続けられる
    agents.send(a.id, 'もう少し明るく');
    await waitFor(() => a.permissions.length === 1);
    agents.answerPermission(a.id, a.permissions[0].id, 'allow');
    await waitFor(() => a.status === 'review');
    assert.strictEqual(fs.readdirSync(folder).filter((f) => f.startsWith('out-')).length, 3);

    agents.complete(a.id);
    assert.strictEqual(a.status, 'done');
    assert.throws(() => agents.complete(a.id), /レビュー中のタスクだけ/);

    // 破棄してもフォルダのファイルは消さない
    await agents.discard(b.id);
    assert.ok(fs.existsSync(path.join(folder, 'script.md')));
    assert.strictEqual(fs.readdirSync(folder).filter((f) => f.startsWith('out-')).length, 3);
  } finally {
    server.close();
  }
});

test('git なしのフォルダ: 競争は使えない。git のタスクは「完了にする」を使えない', () => {
  const { store, agents } = setup();
  store.settings.orchestration = 'compete';
  store.settings.enabledAgents = ['claude', 'codex'];
  store.settings.competeAgents = ['claude', 'codex'];
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete' }), /競争は使えません/);
  const c = agents.createCard({ prompt: 'y' });
  delete c.noGit;
  c.status = 'review';
  assert.throws(() => agents.complete(c.id), /マージか PR/);
});

test('git なしのフォルダ: 中断した待機中のタスクは、一度動いていればレビューに戻す', () => {
  const { store, agents } = setup();
  const c = agents.createCard({ prompt: 'z' });
  c.status = 'queued';
  c.startedAt = Date.now();
  const d = agents.createCard({ prompt: 'w' });
  d.status = 'queued';
  store.save();
  const agents2 = new AgentManager(store, agents.opts);
  assert.strictEqual(agents2.must(c.id).status, 'review');
  assert.strictEqual(agents2.must(d.id).status, 'todo');
});
