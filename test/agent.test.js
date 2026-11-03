// Electron なしでコア部分（worktree・並列実行・承認・マージ・破棄）を通しで確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store } = require('../src/store');
const { AgentManager, SKILL_SUGGEST_PROMPT } = require('../src/agent');
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
    assert.match(a.sessionId, /^sess-new-/);
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
    const before = store.totalCost(repo);
    assert.ok(before > 0);
    assert.strictEqual(before, store.cards.reduce((s, c) => s + (c.costUsd || 0), 0));
    await agents.discard(b.id);
    // 削除したタスクの分も合計金額に残る
    assert.strictEqual(store.totalCost(repo), before);
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

test('アプリの終了で中断 → 次の起動で「中断」になり、再開すると続きから動く（待機中だったものも）', async () => {
  const { tmp, store, agents } = setup();
  const server = new PermissionServer((p, s) => agents.requestPermission(p, s));
  await server.start();
  agents.setPermissionEndpoint(server.port, server.token);
  let server2;
  try {
    const a = agents.createCard({ title: 'running one', prompt: '1つ目' });
    const b = agents.createCard({ title: 'queued one', prompt: '2つ目' });
    agents.start(a.id);
    agents.start(b.id);
    await waitFor(() => a.permissions.length === 1 && a.sessionId);
    assert.deepStrictEqual(agents.activeCount(), { running: 1, queued: 1 });
    await agents.shutdown();
    assert.strictEqual(a.status, 'running', '終了中は状態を変えずに保存する');
    assert.strictEqual(b.status, 'queued', '終了中は待機中のカードを起動しない');
    assert.throws(() => agents.send(a.id, 'x'));

    // 次の起動
    const store2 = new Store(path.join(tmp, 'data', 'board.json'));
    const agents2 = new AgentManager(store2, agents.opts);
    server2 = new PermissionServer((p, s) => agents2.requestPermission(p, s));
    await server2.start();
    agents2.setPermissionEndpoint(server2.port, server2.token);
    const a2 = store2.card(a.id);
    const b2 = store2.card(b.id);
    assert.strictEqual(a2.status, 'failed');
    assert.strictEqual(a2.interrupted.kind, 'running');
    assert.match(a2.error, /再開/);
    assert.strictEqual(b2.status, 'todo');
    assert.strictEqual(b2.interrupted.kind, 'queued');
    assert.strictEqual(agents2.interruptedCards().length, 2);

    assert.strictEqual(agents2.resumeAll(), 2);
    assert.ok(!a2.interrupted && !b2.interrupted);
    await waitFor(() => a2.permissions.length === 1);
    agents2.answerPermission(a2.id, a2.permissions[0].id, 'allow');
    await waitFor(() => a2.status === 'review');
    assert.ok(a2.logs.some((l) => l.kind === 'user' && /再開/.test(l.text)));
    await waitFor(() => b2.permissions.length === 1);
    agents2.answerPermission(b2.id, b2.permissions[0].id, 'allow');
    await waitFor(() => b2.status === 'review');
    assert.match(await agents2.diff(b2.id), /2つ目/);
    assert.throws(() => agents2.resume(b2.id), /中断されていません/);

    // 再開しない: 中断の表示だけ消す
    a2.interrupted = { at: Date.now(), kind: 'running', prompt: 'x' };
    a2.status = 'failed';
    a2.error = agents2.store.card(a2.id).error;
    agents2.dismissInterrupted(a2.id);
    assert.strictEqual(a2.interrupted, null);
    store2.flush();
  } finally {
    server.close();
    server2?.close();
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

test('指定したブランチへマージ（チェックアウトしていないブランチ・続ける・新しいブランチ）', async () => {
  const { repo, store, agents, g } = setup();
  store.settings.permissionMode = 'bypassPermissions'; // 承認なし（MCP なし）で走らせる
  g('branch', 'develop');
  const c = agents.createCard({ title: 'feature', prompt: 'develop向け' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');

  // develop はどこにもチェックアウトしていない → 一時 worktree でマージ。main と作業フォルダは変わらない
  const mainBefore = g('rev-parse', 'main').toString().trim();
  await agents.merge(c.id, { target: 'develop', keep: true });
  assert.strictEqual(c.status, 'review', 'keep なのでレビューに残る');
  assert.ok(fs.existsSync(c.worktreePath));
  assert.strictEqual(g('rev-parse', 'main').toString().trim(), mainBefore);
  assert.match(g('log', '--oneline', 'develop').toString(), /Merge agent task: feature/);
  assert.ok(!g('worktree', 'list').toString().includes('_merge-'), '一時 worktree は消える');
  assert.deepStrictEqual(c.mergedInto, ['develop']);

  // 存在しないブランチはエラー
  await assert.rejects(agents.merge(c.id, { target: 'nope' }), /見つかりません/);

  // チェックアウト中のブランチ（main）に未コミットの変更があるとエラー
  fs.writeFileSync(path.join(repo, 'README.md'), 'dirty\n');
  await assert.rejects(agents.merge(c.id, { target: 'main' }), /未コミット/);
  g('checkout', '--', 'README.md');

  // 新しいブランチを作ってマージ → 完了
  await agents.merge(c.id, { target: 'release/1.0', createNew: true });
  assert.strictEqual(c.status, 'done');
  assert.match(g('log', '--oneline', 'release/1.0').toString(), /Merge agent task: feature/);
  assert.strictEqual(g('rev-parse', 'main').toString().trim(), mainBefore, 'main は触らない');
  assert.deepStrictEqual(c.mergedInto, ['develop', 'release/1.0']);
});

test('設定が PR のとき: origin に push して PR を作り、2回目は既存の PR を更新する', async () => {
  const { tmp, repo, store, agents, g } = setup();
  store.settings.permissionMode = 'bypassPermissions';
  store.settings.integration = 'pr';
  const remote = path.join(tmp, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  g('remote', 'add', 'origin', remote);
  g('push', '-q', 'origin', 'main');

  // 偽の gh: 呼ばれた引数を記録し、pr view は2回目以降だけ OPEN の PR を返す
  const ghLog = path.join(tmp, 'gh.log');
  const ghBin = path.join(tmp, 'gh');
  fs.writeFileSync(
    ghBin,
    `#!/bin/sh\necho "$@" >> "${ghLog}"\nif [ "$1 $2" = "pr view" ]; then\n  if grep -q "^pr create" "${ghLog}"; then echo '{"url":"https://github.com/o/r/pull/7","number":7,"state":"OPEN"}'; exit 0; fi\n  echo 'no pull requests found' >&2; exit 1\nfi\nif [ "$1 $2" = "pr create" ]; then echo 'https://github.com/o/r/pull/7'; exit 0; fi\nexit 1\n`,
    { mode: 0o755 },
  );
  agents.opts.ghPath = ghBin;

  const c = agents.createCard({ title: 'pr task', prompt: 'PR向け' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  const mainBefore = g('rev-parse', 'main').toString().trim();

  const r = await agents.createPullRequest(c.id, { title: 'My PR' });
  assert.deepStrictEqual(r, { url: 'https://github.com/o/r/pull/7', created: true });
  assert.strictEqual(c.prUrl, 'https://github.com/o/r/pull/7');
  assert.strictEqual(c.prBase, 'main');
  assert.strictEqual(c.status, 'review', '既定では続ける');
  assert.strictEqual(g('rev-parse', 'main').toString().trim(), mainBefore, 'main にはマージしない');
  const pushed = execFileSync('git', ['rev-parse', `refs/heads/${c.branch}`], { cwd: remote }).toString().trim();
  assert.strictEqual(pushed, g('rev-parse', c.branch).toString().trim());
  const log = fs.readFileSync(ghLog, 'utf8');
  assert.match(log, new RegExp(`pr create --head ${c.branch} --base main --title My PR`));

  // 2回目: 既存の PR に push するだけ。続けないので完了になる
  const r2 = await agents.createPullRequest(c.id, { keep: false });
  assert.strictEqual(r2.created, false);
  assert.strictEqual((fs.readFileSync(ghLog, 'utf8').match(/^pr create/gm) || []).length, 1);
  assert.strictEqual(c.status, 'done');
  assert.strictEqual(c.worktreePath, null);
  assert.ok(execFileSync('git', ['branch', '--list', c.branch], { cwd: remote }).toString().includes(c.branch), 'origin のブランチは残る');
});

// PR を作ったタスクを用意する（gh は偽物、PR の状態は pullRequestState を差し替える）
async function setupPr(title) {
  const ctx = setup();
  const { tmp, store, agents, g } = ctx;
  store.settings.permissionMode = 'bypassPermissions';
  const remote = path.join(tmp, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  g('remote', 'add', 'origin', remote);
  g('push', '-q', 'origin', 'main');
  const ghBin = path.join(tmp, 'gh');
  fs.writeFileSync(ghBin, `#!/bin/sh\nif [ "$1 $2" = "pr create" ]; then echo 'https://github.com/o/r/pull/9'; exit 0; fi\nexit 1\n`, { mode: 0o755 });
  agents.opts.ghPath = ghBin;
  const c = agents.createCard({ title, prompt: 'PR向け' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  await agents.createPullRequest(c.id);
  let pr = { state: 'OPEN', mergedAt: null, headRefOid: g('rev-parse', c.branch).toString().trim(), baseRefName: 'main' };
  agents.pullRequestState = async () => pr;
  return { ...ctx, c, setPr: (p) => (pr = { ...pr, ...p }) };
}

test('PR がマージされたら、タスクを完了にして worktree を片付ける', async () => {
  const { agents, c, setPr, g } = await setupPr('pr merged');
  const wt = c.worktreePath;
  assert.strictEqual(c.prState, 'OPEN');

  assert.strictEqual(await agents.checkPullRequests(), 0, 'まだ開いている');
  assert.strictEqual(c.status, 'review');

  setPr({ state: 'MERGED', mergedAt: '2026-11-04T00:00:00Z' });
  assert.strictEqual(await agents.checkPullRequests(), 1);
  assert.strictEqual(c.status, 'done');
  assert.strictEqual(c.prState, 'MERGED');
  assert.strictEqual(c.prMergedAt, Date.parse('2026-11-04T00:00:00Z'));
  assert.deepStrictEqual(c.mergedInto, ['main']);
  assert.strictEqual(c.worktreePath, null);
  assert.ok(!fs.existsSync(wt));
  assert.strictEqual(g('branch', '--list', c.branch).toString().trim(), '');
  assert.strictEqual(agents.issueStatusKey({ ...c, issue: { number: 1 } }), 'done');
  // 一度マージを見つけたら、もう確かめない
  agents.pullRequestState = async () => assert.fail('呼ばれない');
  assert.strictEqual(await agents.checkPullRequests(), 0);
});

test('PR を作って片付けたタスクも、マージされたら Projects のステータスが Done になる', async () => {
  const { agents, c, setPr } = await setupPr('pr closed card');
  c.issue = { number: 5, title: 'x', url: 'u' };
  const calls = [];
  agents.setIssueProjectStatus = async (_r, n, key) => (calls.push(key), { projects: 1, updated: [], skipped: [] });
  await agents.createPullRequest(c.id, { keep: false });
  assert.strictEqual(c.status, 'done');
  await agents.flushIssueSync();
  assert.strictEqual(calls.at(-1), 'inReview');

  setPr({ state: 'MERGED', mergedAt: '2026-11-04T00:00:00Z' });
  assert.strictEqual(await agents.checkPullRequests(), 1);
  await agents.flushIssueSync();
  assert.strictEqual(calls.at(-1), 'done');
});

test('PR がマージされても、PR にない変更が worktree にあれば消さずに残す', async () => {
  const { agents, c, setPr } = await setupPr('pr dirty');
  fs.writeFileSync(path.join(c.worktreePath, 'extra.txt'), 'まだ PR にない\n');
  setPr({ state: 'MERGED', mergedAt: '2026-11-04T00:00:00Z' });
  assert.strictEqual(await agents.checkPullRequests(), 0);
  assert.strictEqual(c.status, 'review');
  assert.ok(fs.existsSync(path.join(c.worktreePath, 'extra.txt')));
  assert.strictEqual(c.prState, 'MERGED');
  assert.match(agents.logs(c.id).at(-1).text, /未コミットの変更/);
});

test('PR が閉じられたときと、状態を取れないとき', async () => {
  const { agents, c, setPr } = await setupPr('pr closed');
  setPr({ state: 'CLOSED' });
  await agents.checkPullRequests();
  assert.strictEqual(c.prState, 'CLOSED');
  assert.strictEqual(c.status, 'review');
  agents.pullRequestState = async () => {
    throw new Error('network down');
  };
  await agents.checkPullRequests();
  await agents.checkPullRequests();
  assert.strictEqual(agents.logs(c.id).filter((l) => /network down/.test(l.text)).length, 1, '同じエラーは1回だけ');
  assert.strictEqual(c.status, 'review');
});

test('PR: origin がないとエラー', async () => {
  const { store, agents } = setup();
  store.settings.permissionMode = 'bypassPermissions';
  const c = agents.createCard({ title: 'x', prompt: 'x' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  await assert.rejects(agents.createPullRequest(c.id), /origin/);
});

test('btw: 実行中のエージェントにメッセージを送ると、今の作業に反映される', async () => {
  const { store, agents } = setup();
  store.settings.permissionMode = 'bypassPermissions';
  store.settings.maxParallel = 1;
  process.env.FAKE_SLEEP = '800';
  try {
    const a = agents.createCard({ title: 'btw-a', prompt: '作業A' });
    const b = agents.createCard({ title: 'btw-b', prompt: '作業B' });
    assert.throws(() => agents.btw(a.id, 'まだ'), /実行中だけ/);
    agents.start(a.id);
    agents.start(b.id); // 上限1なので待機
    await waitFor(() => a.sessionId); // 実行中
    agents.btw(a.id, 'テストも書いて');
    assert.strictEqual(a.btw[0].state, 'sent');
    agents.btw(b.id, '待機中の追加'); // 待機中 → 開始時の指示に付け足す
    assert.strictEqual(b.btw[0].state, 'queued');

    await waitFor(() => a.status === 'review');
    assert.strictEqual(a.btw[0].state, 'delivered');
    assert.match(a.lastMessage, /btw: （作業中のユーザーからの追加メッセージ）\nテストも書いて/);
    const d = await agents.diff(a.id);
    assert.match(d, /テストも書いて/, '作業内容（ファイル）にも反映');
    assert.throws(() => agents.btw(a.id, 'もう終わった'), /追加指示/);

    await waitFor(() => b.status === 'review');
    assert.strictEqual(b.btw[0].state, 'delivered');
    assert.match(await agents.diff(b.id), /待機中の追加/);
  } finally {
    delete process.env.FAKE_SLEEP;
  }
});

test('会話（セッション）: 既存の会話を引き継ぐ・新しい会話にする・カードの会話に戻る', async () => {
  const { store, agents } = setup();
  store.settings.permissionMode = 'bypassPermissions';
  const c = agents.createCard({ title: 'sess', prompt: '続きから', session: { mode: 'resume', id: 'ext-1', title: 'ターミナルでの会話' } });
  assert.strictEqual(c.sessionId, 'ext-1');
  assert.strictEqual(c.forkNext, true);
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  // 元の会話はフォークされ、新しい ID の会話になる
  assert.strictEqual(c.sessionId, 'fork-of-ext-1');
  assert.strictEqual(c.forkNext, false);
  assert.deepStrictEqual(c.sessions.map((x) => [x.id, x.origin]), [['ext-1', 'imported'], ['fork-of-ext-1', 'task']]);
  assert.strictEqual(c.sessions[0].forkedTo, 'fork-of-ext-1');

  // 新しい会話に切り替えて追加指示
  agents.setSession(c.id, { mode: 'new' });
  assert.strictEqual(c.sessionId, null);
  agents.send(c.id, '新しい会話で');
  await waitFor(() => c.status === 'review' && c.sessionId);
  const fresh = c.sessionId;
  assert.match(fresh, /^sess-new-/);
  assert.strictEqual(c.sessions.length, 3);

  // カードの最初の会話に戻る（自分の会話なのでフォークしない）
  agents.setSession(c.id, { mode: 'resume', id: 'fork-of-ext-1' });
  assert.strictEqual(c.forkNext, false);
  agents.send(c.id, '最初の会話に戻って');
  await waitFor(() => c.status === 'review' && c.logs.some((l) => l.kind === 'user' && l.text === '最初の会話に戻って') && c.sessionId === 'fork-of-ext-1');
  assert.strictEqual(c.sessions.length, 3, '同じ会話は増えない');

  // 実行中は切り替えられない
  process.env.FAKE_SLEEP = '600';
  try {
    agents.send(c.id, 'もう一度');
    await waitFor(() => c.status === 'running');
    assert.throws(() => agents.setSession(c.id, { mode: 'new' }), /切り替えられません/);
    await waitFor(() => c.status === 'review');
  } finally {
    delete process.env.FAKE_SLEEP;
  }
});

test('過去の会話の一覧（このリポジトリの会話を見分ける）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-sess-'));
  const proj = path.join(tmp, 'projects');
  const repo = path.join(tmp, 'my-app');
  const w = (dir, id, lines) => {
    fs.mkdirSync(path.join(proj, dir), { recursive: true });
    fs.writeFileSync(path.join(proj, dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  };
  w('a', 'aaa', [{ type: 'user', cwd: repo, message: { role: 'user', content: '<command-name>/clear</command-name>' } }, { type: 'user', cwd: repo, message: { role: 'user', content: 'ログイン画面を直して' } }]);
  w('b', 'bbb', [{ type: 'user', cwd: `${repo}.worktrees/x1`, message: { role: 'user', content: [{ type: 'text', text: 'タスクの会話' }] } }]);
  w('c', 'ccc', [{ type: 'user', cwd: path.join(tmp, 'other'), message: { role: 'user', content: 'ほかのプロジェクト' } }]);
  w('d', 'ddd', [{ type: 'summary', summary: '要約つき' }, { type: 'user', cwd: repo, message: { role: 'user', content: 'x' } }]);
  w('e', 'eee', [{ type: 'attachment' }]); // 中身なし → 出さない
  const old = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tmp;
  try {
    const { listSessions } = require('../src/sessions');
    const list = listSessions(repo);
    const byId = Object.fromEntries(list.map((s) => [s.id, s]));
    assert.deepStrictEqual(Object.keys(byId).sort(), ['aaa', 'bbb', 'ccc', 'ddd']);
    assert.strictEqual(byId.aaa.title, 'ログイン画面を直して');
    assert.strictEqual(byId.ddd.title, '要約つき');
    assert.strictEqual(byId.aaa.related, true);
    assert.strictEqual(byId.bbb.related, true, 'タスク用 worktree の会話も関係あり');
    assert.strictEqual(byId.ccc.related, false);
  } finally {
    if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = old;
  }
});

test('スキルを付けて実行する（最初の指示と追加指示）', async () => {
  const { store, agents } = setup();
  store.settings.permissionMode = 'bypassPermissions';
  const c = agents.createCard({ title: 'skill', prompt: 'READMEを整える', skill: '/docs-writer' });
  assert.strictEqual(c.skill, 'docs-writer');
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  // claude には「/スキル名 指示」の形で渡る
  assert.match(await agents.diff(c.id), /\+\/docs-writer READMEを整える/);
  assert.strictEqual(c.logs.find((l) => l.kind === 'user').skill, 'docs-writer');
  // 追加指示は、そのときに選んだスキルで
  agents.send(c.id, 'テストも', 'test-writer');
  await waitFor(() => c.status === 'review' && c.logs.filter((l) => l.kind === 'user').length === 2);
  await waitFor(() => c.status === 'review');
  assert.match(await agents.diff(c.id), /\+\/test-writer テストも/);
  agents.send(c.id, 'スキルなしで');
  await waitFor(() => c.status === 'review' && c.logs.filter((l) => l.kind === 'user').length === 3);
  await waitFor(() => c.status === 'review');
  assert.match(await agents.diff(c.id), /\+スキルなしで/);
  assert.strictEqual(c.logs.filter((l) => l.kind === 'user')[2].skill, undefined);
});

test('エージェントからの質問: 選択肢（複数選択・その他）に答える / 答えずに続ける / 文章の質問は「回答待ち」', async () => {
  const { store, agents } = setup();
  const server = new PermissionServer((p, s) => agents.requestPermission(p, s));
  await server.start();
  agents.setPermissionEndpoint(server.port, server.token);
  try {
    const c = agents.createCard({ title: 'ask', prompt: '[ask] 設定して' });
    agents.start(c.id);
    await waitFor(() => (c.questions || []).length === 1);
    const req = c.questions[0];
    assert.strictEqual(req.questions.length, 2);
    assert.strictEqual(req.questions[1].multiSelect, true);
    assert.strictEqual(c.permissions.length, 0, '質問は承認とは別');
    assert.throws(() => agents.answerQuestion(c.id, req.id, { 'どの色にしますか？': '青' }), /答えてください/);
    assert.throws(() => agents.answerPermission(c.id, req.id, 'allow'), /もう終わっています/);
    agents.answerQuestion(c.id, req.id, { 'どの色にしますか？': '青', '対応する OS は？': 'Mac, Linux' });
    assert.strictEqual(c.questions.length, 0);
    // このあと Bash の承認が来る
    await waitFor(() => c.permissions.length === 1);
    agents.answerPermission(c.id, c.permissions[0].id, 'allow');
    await waitFor(() => c.status === 'review');
    const d = await agents.diff(c.id);
    assert.match(d, /"どの色にしますか？"="青"/);
    assert.match(d, /"対応する OS は？"="Mac, Linux"/);
    assert.strictEqual(c.awaitingReply, false);

    // 答えずに続ける
    agents.send(c.id, '[ask] もう一度');
    await waitFor(() => (c.questions || []).length === 1);
    agents.answerQuestion(c.id, c.questions[0].id, null);
    await waitFor(() => c.permissions.length === 1);
    agents.answerPermission(c.id, c.permissions[0].id, 'allow');
    await waitFor(() => c.status === 'review' && c.logs.some((l) => l.text === '答えずに続ける'));
    assert.match(await agents.diff(c.id), /did not answer/);

    // 文章で質問して止まる → 回答待ち。答えると外れる
    agents.send(c.id, '[q] 方法を決めて');
    await waitFor(() => c.status === 'review' && c.awaitingReply === true);
    assert.match(c.lastText, /進めますか？/);
    agents.send(c.id, 'B で');
    assert.strictEqual(c.awaitingReply, false);
    await waitFor(() => c.permissions.length === 1);
    agents.answerPermission(c.id, c.permissions[0].id, 'allow');
    await waitFor(() => c.status === 'review');
    assert.strictEqual(c.awaitingReply, false);
  } finally {
    server.close();
  }
});

test('マージして origin に push する（origin が進んでいれば取り込む・分岐していれば止める・新しいブランチ）', async () => {
  const { tmp, repo, store, agents, g } = setup();
  store.settings.permissionMode = 'bypassPermissions';
  // origin（bare リポジトリ）を用意する
  const remote = path.join(tmp, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  g('remote', 'add', 'origin', remote);
  g('push', '-q', 'origin', 'main');
  const rg = (...a) => execFileSync('git', ['--git-dir', remote, ...a]).toString().trim();

  // 1) ふつうに push
  const a = agents.createCard({ title: 'push-a', prompt: 'A' });
  agents.start(a.id);
  await waitFor(() => a.status === 'review');
  await agents.merge(a.id, { target: 'main', push: true });
  assert.strictEqual(a.status, 'done');
  assert.strictEqual(rg('rev-parse', 'main'), g('rev-parse', 'main').toString().trim(), 'origin/main がローカルの main と同じ');
  assert.match(rg('log', '--oneline', '-1', 'main'), /Merge agent task: push-a/);
  assert.deepStrictEqual(a.pushedTo, ['main']);

  // 2) 他の人が origin/main に push していた → ローカルに取り込んでからマージして push
  const other = path.join(tmp, 'other');
  execFileSync('git', ['clone', '-q', remote, other]);
  fs.writeFileSync(path.join(other, 'other.txt'), 'x\n');
  execFileSync('git', ['add', '.'], { cwd: other });
  execFileSync('git', ['-c', 'user.name=o', '-c', 'user.email=o@o', 'commit', '-qm', 'other change'], { cwd: other });
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: other });
  const b = agents.createCard({ title: 'push-b', prompt: 'B' });
  agents.start(b.id);
  await waitFor(() => b.status === 'review');
  await agents.merge(b.id, { target: 'main', push: true });
  const log = rg('log', '--oneline', 'main');
  assert.match(log, /Merge agent task: push-b/);
  assert.match(log, /other change/, '他の人の変更も残っている');
  assert.ok(fs.existsSync(path.join(repo, 'other.txt')), 'チェックアウト中の main にも取り込まれた');

  // 3) ローカルと origin が分岐 → 止める（ローカルは変えない）
  fs.writeFileSync(path.join(other, 'o2.txt'), 'y\n');
  execFileSync('git', ['add', '.'], { cwd: other });
  execFileSync('git', ['-c', 'user.name=o', '-c', 'user.email=o@o', 'commit', '-qm', 'other 2'], { cwd: other });
  execFileSync('git', ['-c', 'user.name=o', '-c', 'user.email=o@o', 'pull', '-q', '--no-rebase', 'origin', 'main'], { cwd: other });
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: other });
  fs.writeFileSync(path.join(repo, 'local.txt'), 'z\n');
  g('add', 'local.txt');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'local only');
  const c = agents.createCard({ title: 'push-c', prompt: 'C' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  const before = g('rev-parse', 'main').toString().trim();
  await assert.rejects(agents.merge(c.id, { target: 'main', push: true }), /別々に進んでいます/);
  assert.strictEqual(g('rev-parse', 'main').toString().trim(), before);
  assert.strictEqual(c.status, 'review');

  // 4) 新しいブランチを作ってマージ → origin にも新しいブランチができる（-u）
  await agents.merge(c.id, { target: 'feature/new', createNew: true, push: true });
  assert.match(rg('log', '--oneline', '-1', 'feature/new'), /Merge agent task: push-c/);
  assert.strictEqual(g('rev-parse', '--abbrev-ref', 'feature/new@{upstream}').toString().trim(), 'origin/feature/new');
});

test('コンフリクト: マージで止まる → Claude に解消してもらう / 自分で解消する → もう一度マージ', async () => {
  const { repo, store, agents, g } = setup();
  store.settings.permissionMode = 'bypassPermissions';
  const commitIn = (dir, file, text, msg) => {
    fs.writeFileSync(path.join(dir, file), text);
    execFileSync('git', ['add', file], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg], { cwd: dir });
  };
  // タスクのブランチと main の両方で README.md を変えて、コンフリクトさせる
  const make = async (title) => {
    const c = agents.createCard({ title, prompt: title });
    agents.start(c.id);
    await waitFor(() => c.status === 'review');
    commitIn(c.worktreePath, 'README.md', `hello from ${title}\n`, `task ${title}`);
    return c;
  };

  // 1) Claude に解消してもらう
  const a = await make('a');
  commitIn(repo, 'README.md', 'hello from main 1\n', 'main 1');
  const r = await agents.merge(a.id, { target: 'main' });
  assert.ok(r.conflict);
  assert.deepStrictEqual(a.conflict.files, ['README.md']);
  assert.strictEqual(a.status, 'review');
  assert.ok(!(await require('../src/git').mergeInProgress(repo)), 'main 側のマージは中止済み');
  await agents.resolveConflict(a.id, 'agent');
  await waitFor(() => a.status === 'review' && a.conflictResolved);
  assert.strictEqual(a.conflict, null);
  const merged = fs.readFileSync(path.join(a.worktreePath, 'README.md'), 'utf8');
  assert.match(merged, /hello from a/);
  assert.match(merged, /hello from main 1/);
  const r2 = await agents.merge(a.id, { target: 'main' });
  assert.ok(r2.merged);
  assert.strictEqual(a.status, 'done');

  // 2) Claude が解消しきれなかった → 「まだ残っています」。印付きのファイルはコミットしない
  const b = await make('b');
  commitIn(repo, 'README.md', 'hello from main 2\n', 'main 2');
  assert.ok((await agents.merge(b.id, { target: 'main' })).conflict);
  process.env.FAKE_BAD_RESOLVE = '1';
  try {
    await agents.resolveConflict(b.id, 'agent');
    await waitFor(() => b.status === 'review' && b.conflict && b.conflict.unresolved);
  } finally {
    delete process.env.FAKE_BAD_RESOLVE;
  }
  assert.deepStrictEqual(b.conflict.unresolved, ['README.md']);
  assert.ok(await require('../src/git').mergeInProgress(b.worktreePath), '取り込みの途中のまま（コミットしていない）');
  await assert.rejects(agents.merge(b.id, { target: 'main' }), /解消が終わっていません/);

  // 3) 自分で解消する: 印が残っているうちは完了できない → 直すと完了 → マージ
  await assert.rejects(agents.completeConflict(b.id), /印/);
  fs.writeFileSync(path.join(b.worktreePath, 'README.md'), 'hello from b and main 2\n');
  await agents.completeConflict(b.id);
  assert.strictEqual(b.conflictResolved.target, 'main');
  assert.ok((await agents.merge(b.id, { target: 'main' })).merged);
  assert.strictEqual(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), 'hello from b and main 2\n');

  // 4) 取り込みを中止
  const c = await make('c');
  commitIn(repo, 'README.md', 'hello from main 3\n', 'main 3');
  assert.ok((await agents.merge(c.id, { target: 'main' })).conflict);
  const res = await agents.resolveConflict(c.id, 'manual');
  assert.ok(res.manual);
  assert.match(fs.readFileSync(path.join(c.worktreePath, 'README.md'), 'utf8'), /<<<<<<</);
  await agents.abortConflict(c.id);
  assert.ok(!(await require('../src/git').mergeInProgress(c.worktreePath)));
  assert.strictEqual(fs.readFileSync(path.join(c.worktreePath, 'README.md'), 'utf8'), 'hello from c\n');
  assert.ok(c.conflict, 'コンフリクトの情報は残る（あとで解消できる）');
});

test('マージ先がメインのフォルダでチェックアウトされていて、一覧から見つからなくても、そのフォルダでマージする', async () => {
  const { repo, store, agents, g } = setup();
  store.settings.permissionMode = 'bypassPermissions';
  const git = require('../src/git');
  const c = agents.createCard({ title: 'wt', prompt: 'x' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  // 一覧から見つけられない環境を再現する
  const orig = git.worktreeForBranch;
  git.worktreeForBranch = async () => null;
  try {
    const r = await agents.merge(c.id, { target: 'main' });
    assert.ok(r.merged);
  } finally {
    git.worktreeForBranch = orig;
  }
  assert.match(g('log', '--oneline', '-1', 'main').toString(), /Merge agent task: wt/);
  assert.ok(fs.readdirSync(repo).some((f) => f.startsWith('out-')), 'チェックアウト中のフォルダにも反映');
  assert.ok(!g('worktree', 'list').toString().includes('_merge-'));
});

test('マージ先のフォルダで rebase が途中なら、わかりやすく止める', async () => {
  const { repo, store, agents, g } = setup();
  store.settings.permissionMode = 'bypassPermissions';
  const c = agents.createCard({ title: 'rb', prompt: 'x' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  const p = g('rev-parse', '--git-path', 'rebase-merge').toString().trim();
  fs.mkdirSync(path.isAbsolute(p) ? p : path.join(repo, p), { recursive: true });
  await assert.rejects(agents.merge(c.id, { target: 'main' }), /rebase が途中です/);
});

test('完了（マージ済み）のタスクでも会話を続けられる: 同じ場所に worktree を作り直して同じ会話の続きから動く', async () => {
  const { repo, agents, g } = setup();
  const c = agents.createCard({ title: 'reopen', prompt: '最初の作業' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  const sess = c.sessionId;
  const wt = c.worktreePath;
  const firstBranch = c.branch;
  await agents.merge(c.id);
  assert.strictEqual(c.status, 'done');
  assert.ok(!fs.existsSync(wt));

  // 完了したタスクに追加指示を送る
  agents.send(c.id, 'スキルを追加して');
  await waitFor(() => c.status === 'review');
  assert.strictEqual(c.worktreePath, wt, '前と同じ場所に作り直す（会話がフォルダごとに保存されているため）');
  assert.strictEqual(c.sessionId, sess, '同じ会話の続き（--resume）');
  assert.strictEqual(c.branch, firstBranch, 'マージ後に消したブランチ名をそのまま使う');
  assert.strictEqual(c.baseCommit, g('rev-parse', 'main').toString().trim(), 'マージ先の最新から始める');
  assert.match(await agents.diff(c.id), /スキルを追加して/);
  assert.doesNotMatch(await agents.diff(c.id), /最初の作業/, '前の作業はもう取り込み済みなので差分に出ない');

  // もう一度マージできる
  await agents.merge(c.id);
  assert.strictEqual(c.status, 'done');
  assert.strictEqual(fs.readdirSync(repo).filter((f) => f.startsWith('out-')).length, 2);

  // 完了に入ったら、通知で「スキルにしませんか？」と聞く（1つのタスクで1回だけ）
  const notes = agents.listNotifications(c.repoPath).filter((n) => n.cardId === c.id);
  assert.ok(notes.some((n) => n.kind === 'review'), '作業が終わったらレビュー待ちの通知');
  assert.ok(notes.filter((n) => n.kind === 'done').length >= 2, '完了の通知（マージのたび）');
  const skillNotes = notes.filter((n) => n.kind === 'skill');
  assert.strictEqual(skillNotes.length, 1, 'スキルの提案の通知は1回だけ');
  assert.strictEqual(skillNotes[0].action, 'suggestSkills');

  // 通知のボタンからスキルの提案を頼む（完了したタスクからでも）
  agents.actNotification(skillNotes[0].id);
  assert.ok(skillNotes[0].actedAt && skillNotes[0].read, '対応済み・既読になる');
  assert.throws(() => agents.actNotification(skillNotes[0].id), /対応済み/);
  await waitFor(() => c.status === 'review');
  assert.ok(c.logs.some((l) => l.kind === 'user' && l.text === SKILL_SUGGEST_PROMPT));
  assert.match(await agents.diff(c.id), /スキル（SKILL\.md）として残しておく/);
});

test('PR を作って完了したタスクの続きは、origin の前のブランチとぶつからない名前のブランチで動く', async () => {
  const { tmp, store, agents, g } = setup();
  store.settings.integration = 'pr';
  const remote = path.join(tmp, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  g('remote', 'add', 'origin', remote);
  g('push', '-q', 'origin', 'main');
  const ghBin = path.join(tmp, 'gh');
  fs.writeFileSync(ghBin, `#!/bin/sh\nif [ "$1 $2" = "pr view" ]; then echo 'no pull requests found' >&2; exit 1; fi\nif [ "$1 $2" = "pr create" ]; then echo 'https://github.com/o/r/pull/9'; exit 0; fi\nexit 1\n`, { mode: 0o755 });
  agents.opts.ghPath = ghBin;

  const c = agents.createCard({ title: 'pr reopen', prompt: 'PR向け' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  const first = c.branch;
  await agents.createPullRequest(c.id, { keep: false });
  assert.strictEqual(c.status, 'done');

  agents.send(c.id, '続き');
  await waitFor(() => c.status === 'review');
  assert.strictEqual(c.branch, `${first}-2`);
  assert.strictEqual(c.prUrl, null, '次は新しい PR を作る');
  assert.ok(fs.existsSync(c.worktreePath));
});

test('通知: 既読・削除、設定で完了時のスキル提案を止められる', () => {
  const { store, agents } = setup();
  const c = agents.createCard({ title: 'n', prompt: 'x' });
  c.sessionId = 'sess-1';
  store.settings.suggestSkillsOnDone = false;
  agents.completed(c);
  assert.deepStrictEqual(agents.listNotifications(c.repoPath).map((n) => n.kind), ['done']);
  store.settings.suggestSkillsOnDone = true;
  agents.completed(c);
  assert.deepStrictEqual(agents.listNotifications(c.repoPath).map((n) => n.kind), ['skill', 'done', 'done'], '新しいものが先頭');
  assert.strictEqual(agents.listNotifications('/other').length, 0, 'ほかのリポジトリの通知は出ない');

  const [first] = agents.listNotifications(c.repoPath);
  agents.readNotifications(c.repoPath, [first.id]);
  assert.deepStrictEqual(agents.listNotifications(c.repoPath).map((n) => n.read), [true, false, false]);
  agents.readNotifications(c.repoPath);
  assert.ok(agents.listNotifications(c.repoPath).every((n) => n.read));
  agents.clearNotifications(c.repoPath, [first.id]);
  assert.strictEqual(agents.listNotifications(c.repoPath).length, 2);
  agents.clearNotifications(c.repoPath);
  assert.strictEqual(agents.listNotifications(c.repoPath).length, 0);
});

test('会話（チャット）: worktree を作らずリポジトリで話し、同時実行数に数えず、続きも話せる。マージはできない', async () => {
  const { repo, store, agents, g } = setup();
  const server = new PermissionServer((p, s) => agents.requestPermission(p, s));
  await server.start();
  agents.setPermissionEndpoint(server.port, server.token);
  try {
    store.settings.permissionMode = 'acceptEdits';
    // タスクが上限（1）まで動いていても、会話はすぐに動く
    const t = agents.createCard({ title: 'task', prompt: 'タスク' });
    agents.start(t.id);
    await waitFor(() => t.permissions.length === 1);

    assert.throws(() => agents.createChat({ message: '  ' }), /メッセージ/);
    const c = agents.createChat({ message: 'この構成を教えて\n詳しく' });
    assert.strictEqual(c.kind, 'chat');
    assert.strictEqual(c.title, 'この構成を教えて');
    assert.strictEqual(c.status, 'running', '会話は同時実行数に数えない');
    await waitFor(() => c.permissions.length === 1);
    assert.ok(c.logs.some((l) => /権限モード: default/.test(l.text)), '会話はリポジトリで直接動くので、毎回確認する');
    agents.answerPermission(c.id, c.permissions[0].id, 'allow');
    await waitFor(() => c.status === 'review');
    assert.ok(!c.worktreePath && !c.branch, 'worktree もブランチも作らない');
    assert.strictEqual(c.awaitingReply, false);
    assert.ok(!c.logs.some((l) => /コミット/.test(l.text)), 'コミットしない');
    assert.ok(fs.readdirSync(repo).some((f) => f.startsWith('out-')), 'リポジトリのフォルダで動く');
    assert.ok(!g('branch', '--list', 'agent/*').toString().trim().split('\n').some((b) => b.includes(c.id)));
    const first = c.sessionId;
    assert.ok(first);
    assert.strictEqual(await agents.diff(c.id), '');
    await assert.rejects(agents.merge(c.id, { target: 'main' }), /会話はマージできません/);
    await assert.rejects(agents.createPullRequest(c.id, {}), /PR/);

    // 続きを話す: 同じ会話の続き
    agents.send(c.id, 'ありがとう');
    await waitFor(() => c.permissions.length === 1);
    agents.answerPermission(c.id, c.permissions[0].id, 'allow');
    await waitFor(() => c.status === 'review');
    assert.strictEqual(c.sessionId, first);

    // 会話の続きからタスクを作る（会話はフォークして残す）
    const t2 = agents.createCard({ title: 'from chat', prompt: '作業して', session: { mode: 'resume', id: c.sessionId, title: c.title } });
    assert.strictEqual(t2.forkNext, true);

    agents.answerPermission(t.id, t.permissions[0].id, 'allow');
    await waitFor(() => t.status === 'review');

    // 削除しても、タスクのブランチなどには触らない
    await agents.discard(c.id);
    assert.ok(!store.card(c.id));
    assert.ok(fs.existsSync(t.worktreePath));
    store.flush();
  } finally {
    server.close();
  }
});

test('会話（チャット）: アプリの終了で中断 → 再開すると同じ会話の続きから', async () => {
  const { tmp, store, agents } = setup();
  const server = new PermissionServer((p, s) => agents.requestPermission(p, s));
  await server.start();
  agents.setPermissionEndpoint(server.port, server.token);
  let server2;
  try {
    const c = agents.createChat({ message: 'こんにちは' });
    await waitFor(() => c.permissions.length === 1 && c.sessionId);
    await agents.shutdown();
    const store2 = new Store(path.join(tmp, 'data', 'board.json'));
    const agents2 = new AgentManager(store2, agents.opts);
    server2 = new PermissionServer((p, s) => agents2.requestPermission(p, s));
    await server2.start();
    agents2.setPermissionEndpoint(server2.port, server2.token);
    const c2 = store2.card(c.id);
    assert.strictEqual(c2.interrupted.kind, 'running');
    assert.doesNotMatch(c2.interrupted.prompt, /worktree/);
    agents2.resume(c2.id);
    await waitFor(() => c2.permissions.length === 1);
    agents2.answerPermission(c2.id, c2.permissions[0].id, 'allow');
    await waitFor(() => c2.status === 'review');
    assert.strictEqual(c2.sessionId, c.sessionId);
    assert.ok(!c2.worktreePath);
    store2.flush();
  } finally {
    server.close();
    server2?.close();
  }
});

test('ブランチの命名規則（自然言語）: Claude が考えた名前で worktree を作る。ぶつかれば番号、失敗ならいつもの名前', async () => {
  const { store, agents, g } = setup();
  store.settings.permissionMode = 'bypassPermissions';
  store.settings.branchNamingRule = 'feature/my-task';
  const a = agents.createCard({ title: 'A', prompt: 'a' });
  agents.start(a.id);
  await waitFor(() => a.status === 'review');
  assert.strictEqual(a.branch, 'feature/my-task');
  assert.ok(g('branch', '--list', 'feature/my-task').toString().includes('feature/my-task'));

  const b = agents.createCard({ title: 'B', prompt: 'b' });
  agents.start(b.id);
  await waitFor(() => b.status === 'review');
  assert.strictEqual(b.branch, 'feature/my-task-2', '同じ名前がもうあれば番号を付ける');

  process.env.FAKE_BRANCH_FAIL = '1';
  try {
    const c = agents.createCard({ title: 'Fallback', prompt: 'c' });
    agents.start(c.id);
    await waitFor(() => c.status === 'review');
    assert.strictEqual(c.branch, `agent/fallback-${c.id}`);
    assert.ok(c.logs.some((l) => l.kind === 'error' && /命名規則/.test(l.text)));
  } finally {
    delete process.env.FAKE_BRANCH_FAIL;
  }
});

test('cleanBranchName / buildBranchNamePrompt', () => {
  const { cleanBranchName, buildBranchNamePrompt } = require('../src/agent');
  assert.strictEqual(cleanBranchName('`feature/12-add login`'), 'feature/12-add-login');
  assert.strictEqual(cleanBranchName('ブランチ名:\n"fix/日本語-bug..x"'), 'fix/bug.x');
  assert.strictEqual(cleanBranchName('```\nfeat/x.lock\n```'), 'feat/x');
  assert.strictEqual(cleanBranchName(''), '');
  const p = buildBranchNamePrompt('feature/<番号>-<英語>', { id: 'ab12', title: '#3 ログイン', prompt: 'やって', issue: { number: 3, title: 'ログイン' } });
  assert.match(p, /feature\/<番号>-<英語>/);
  assert.match(p, /Issue 番号: 3/);
  assert.match(p, /タスク ID: ab12/);
});
