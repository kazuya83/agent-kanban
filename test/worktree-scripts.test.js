// worktree のセットアップ / 片付け / 実行スクリプト
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store, repoSettingsOf, switchRepoSettings, REPO_SETTING_KEYS } = require('../src/store');
const { AgentManager } = require('../src/agent');
const net = require('net');
const { PORT_START, PORT_END, PORT_COUNT, portsFree, cleanScript, appendOutput, commandFor, startScript } = require('../src/worktree-scripts');
const { isProxyChannel } = require('../src/remote');

const FAKE = path.join(__dirname, 'fake-claude.js');
const posixOnly = { skip: process.platform === 'win32' };

function setup(settings = {}, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-scripts-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const fakeBin = path.join(tmp, 'claude');
  fs.writeFileSync(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, { repoPath: repo, claudePath: fakeBin, maxParallel: 1, specCheck: false, permissionMode: 'bypassPermissions', ...settings });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath, ...opts });
  return { tmp, repo, store, agents, g };
}

async function waitFor(pred, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

function start(ctx, title = 't') {
  const c = ctx.agents.createCard({ title, prompt: 'hello', repoPath: ctx.repo });
  ctx.agents.start(c.id);
  return ctx.store.card(c.id);
}

const logText = (c) => c.logs.map((l) => l.text).join('\n');

test('スクリプトの設定はプロジェクトごとに覚える', () => {
  for (const k of ['setupScript', 'teardownScript', 'runScript']) assert.ok(REPO_SETTING_KEYS.includes(k), k);
  const { store, tmp } = setup({ setupScript: 'npm install' });
  const s = store.settings;
  switchRepoSettings(s, path.join(tmp, 'other'));
  assert.strictEqual(s.setupScript, '');
  assert.strictEqual(repoSettingsOf(s, path.join(tmp, 'repo')).setupScript, 'npm install');
});

test('遠隔操作からもスクリプトを動かせる', () => {
  for (const ch of ['card:scripts', 'card:runScript', 'card:stopScript']) assert.ok(isProxyChannel(ch), ch);
});

test('cleanScript: 改行をそろえて前後の空白を取る', () => {
  assert.strictEqual(cleanScript('  a\r\nb\rc  \n'), 'a\nb\nc');
  assert.strictEqual(cleanScript(null), '');
});

test('appendOutput: 色の指定を消し、長い出力は最後だけ残す', () => {
  assert.strictEqual(appendOutput('', '\x1b[32mok\x1b[0m'), 'ok');
  const long = appendOutput('x'.repeat(200000), 'END');
  assert.strictEqual(long.length, 200000);
  assert.ok(long.endsWith('END'));
});

test('WSL のフォルダでは、WSL の bash で動かす', async () => {
  const env = process.env.AGENT_KANBAN_WSL;
  process.env.AGENT_KANBAN_WSL = process.execPath;
  try {
    const cm = await commandFor('\\\\wsl.localhost\\Ubuntu\\home\\me\\wt', 'npm i', { A: 'b' });
    assert.strictEqual(cm.file, process.execPath);
    assert.deepStrictEqual(cm.args.slice(0, 4), ['-d', 'Ubuntu', '--cd', '/home/me/wt']);
    assert.ok(cm.args.includes('bash'));
    assert.ok(cm.args.includes('set -e\nnpm i'));
    assert.ok(cm.args.some((a) => a.includes("export A='b'")));
  } finally {
    if (env === undefined) delete process.env.AGENT_KANBAN_WSL;
    else process.env.AGENT_KANBAN_WSL = env;
  }
});

test('途中の行が失敗したら、そこで止まる', posixOnly, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-script-'));
  const r = await startScript({ cwd: dir, script: 'touch a\nfalse\ntouch b' }).done;
  assert.strictEqual(r.code, 1);
  assert.ok(fs.existsSync(path.join(dir, 'a')));
  assert.ok(!fs.existsSync(path.join(dir, 'b')));
});

test('止めると、シェルの子プロセスも止まる', posixOnly, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-script-'));
  const h = startScript({ cwd: dir, script: 'sleep 30 &\necho $! > pid\nwait' });
  await waitFor(() => fs.existsSync(path.join(dir, 'pid')) && fs.readFileSync(path.join(dir, 'pid'), 'utf8').trim());
  const pid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'));
  const r = await h.stop();
  assert.strictEqual(r.stopped, true);
  await waitFor(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });
});

test('セットアップはエージェントの前に worktree で動く', posixOnly, async () => {
  const ctx = setup({ setupScript: 'echo "$WORKTREE_KANBAN_BRANCH" > setup-done\necho "$WORKTREE_KANBAN_ROOT" >> setup-done' });
  const c = start(ctx);
  await waitFor(() => c.status === 'review');
  const lines = fs.readFileSync(path.join(c.worktreePath, 'setup-done'), 'utf8').trim().split('\n');
  assert.deepStrictEqual(lines, [c.branch, ctx.repo]);
  assert.ok(!c.setupPending);
  assert.match(logText(c), /セットアップスクリプトが終わりました/);
  assert.ok(c.logs.findIndex((l) => /セットアップスクリプトが終わりました/.test(l.text)) < c.logs.findIndex((l) => l.kind === 'result' || l.kind === 'assistant' || l.kind === 'text'));
});

test('セットアップが失敗したらエージェントを始めず、直してやり直すと動く', posixOnly, async () => {
  const ctx = setup({ setupScript: 'echo broken-output\nexit 3' });
  const c = start(ctx);
  await waitFor(() => c.status === 'failed');
  assert.match(c.error, /終了コード 3/);
  assert.match(c.error, /broken-output/);
  assert.strictEqual(c.sessionId || null, null);
  assert.ok(c.setupPending);

  ctx.store.settings.setupScript = 'touch fixed';
  c.pendingPrompt = 'hello';
  c.status = 'queued';
  c.queuedAt = Date.now();
  ctx.agents.pump();
  await waitFor(() => c.status === 'review');
  assert.ok(fs.existsSync(path.join(c.worktreePath, 'fixed')));
  assert.ok(!c.setupPending);
});

test('開始前のセットアップは「停止」で止められる', posixOnly, async () => {
  const ctx = setup({ setupScript: 'sleep 30' });
  const c = start(ctx);
  await waitFor(() => ctx.agents.scriptState(c.id).run?.running);
  ctx.agents.stop(c.id);
  await waitFor(() => c.status === 'failed');
  assert.match(c.error, /止めました/);
});

test('破棄すると片付けが worktree の中で動いてから消える。失敗しても消える', posixOnly, async () => {
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wk-script-')), 'out');
  const ctx = setup({ teardownScript: `pwd > '${marker}'\nexit 1` });
  const c = start(ctx);
  await waitFor(() => c.status === 'review');
  const wt = c.worktreePath;
  const real = fs.realpathSync(wt);
  await ctx.agents.discard(c.id);
  assert.strictEqual(fs.readFileSync(marker, 'utf8').trim(), real);
  assert.ok(!fs.existsSync(wt));
  assert.match(logText(c), /片付けスクリプトが失敗しましたが/);
});

test('マージで worktree を消す前に、実行中のスクリプトを止めて片付ける', posixOnly, async () => {
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wk-script-')), 'out');
  const ctx = setup({ runScript: 'sleep 30', teardownScript: `echo cleaned > '${marker}'`, integration: 'merge' });
  const c = start(ctx);
  await waitFor(() => c.status === 'review');
  await ctx.agents.startScriptNow(c.id, 'run');
  await ctx.agents.merge(c.id, {});
  assert.strictEqual(c.status, 'done');
  assert.strictEqual(fs.readFileSync(marker, 'utf8').trim(), 'cleaned');
});

test('片付けが終わらなくても、時間切れで worktree は消える', posixOnly, async () => {
  const ctx = setup({ teardownScript: 'sleep 30' }, { teardownTimeoutMs: 100 });
  const c = start(ctx);
  await waitFor(() => c.status === 'review');
  const wt = c.worktreePath;
  await ctx.agents.discard(c.id);
  assert.ok(!fs.existsSync(wt));
  assert.match(logText(c), /時間切れ/);
});

test('ボタンから動かす・止める・二重に動かさない・未設定は断る', posixOnly, async () => {
  const ctx = setup({ runScript: 'echo started\nsleep 30' });
  const c = start(ctx);
  await waitFor(() => c.status === 'review');
  assert.deepStrictEqual(ctx.agents.scriptState(c.id).scripts, { setup: false, teardown: false, run: true });
  await assert.rejects(ctx.agents.startScriptNow(c.id, 'setup'), /設定されていません/);
  await assert.rejects(ctx.agents.startScriptNow(c.id, 'rm'), /種類/);
  await ctx.agents.startScriptNow(c.id, 'run');
  await assert.rejects(ctx.agents.startScriptNow(c.id, 'run'), /ほかのスクリプト/);
  await waitFor(() => /started/.test(ctx.agents.scriptState(c.id).run.output));
  const st = await ctx.agents.stopScriptNow(c.id);
  assert.strictEqual(st.run.running, false);
  assert.strictEqual(st.run.stopped, true);
  assert.ok(!('handle' in st.run));
});

test('手で動かしたセットアップが通ると、やり直しでは動かさない', posixOnly, async () => {
  const ctx = setup({ setupScript: 'test -f ok || exit 1\necho run >> count' });
  const c = start(ctx);
  await waitFor(() => c.status === 'failed');
  fs.writeFileSync(path.join(c.worktreePath, 'ok'), '');
  await ctx.agents.startScriptNow(c.id, 'setup');
  await waitFor(() => !c.setupPending);
  assert.strictEqual(fs.readFileSync(path.join(c.worktreePath, 'count'), 'utf8'), 'run\n');
});

test('終了するときは、動いているスクリプトも止める', posixOnly, async () => {
  const ctx = setup({ runScript: 'sleep 30' });
  const c = start(ctx);
  await waitFor(() => c.status === 'review');
  await ctx.agents.startScriptNow(c.id, 'run');
  await ctx.agents.shutdown(5000);
  assert.strictEqual(ctx.agents.scriptState(c.id).run.running, false);
});

// ---------- タスクごとのポート ----------

test('portsFree: 組の中に使われているポートが1つでもあれば空いていない', async () => {
  for (const host of ['127.0.0.1', '0.0.0.0', '::1', '::']) {
    const server = net.createServer();
    const listening = await new Promise((r) => {
      server.once('error', () => r(false));
      server.listen(0, host, () => r(true));
    });
    if (!listening) continue; // IPv6 が使えない環境
    const { port } = server.address();
    assert.strictEqual(await portsFree(port - 2, 5), false, host);
    await new Promise((r) => server.close(r));
    assert.strictEqual(await portsFree(port, 1), true, host);
  }
});

test('並列のタスクには、重ならないポートの組を割り当てて、スクリプトとエージェントに渡す', posixOnly, async () => {
  const ctx = setup({ runScript: 'echo "port=$PORT/$WORKTREE_KANBAN_PORT"' });
  ctx.store.settings.maxParallel = 2;
  const seen = [];
  const spawnAgent = ctx.agents.spawnAgent.bind(ctx.agents);
  ctx.agents.spawnAgent = (agent, cwd, args, env) => {
    if (env?.PORT) seen.push(env);
    return spawnAgent(agent, cwd, args, env);
  };
  const a = start(ctx, 'a');
  const b = start(ctx, 'b');
  await waitFor(() => a.status === 'review' && b.status === 'review', 20000);
  assert.ok(a.devPort >= PORT_START && a.devPort + PORT_COUNT <= PORT_END, String(a.devPort));
  assert.ok(Math.abs(a.devPort - b.devPort) >= PORT_COUNT, `${a.devPort} ${b.devPort}`);
  assert.deepStrictEqual(seen.map((e) => e.PORT).sort(), [String(a.devPort), String(b.devPort)].sort());
  assert.ok(seen.every((e) => e.WORKTREE_KANBAN_PORT === e.PORT));

  await ctx.agents.startScriptNow(a.id, 'run');
  await waitFor(() => !ctx.agents.scriptState(a.id).run.running);
  const state = ctx.agents.scriptState(a.id);
  assert.match(state.run.output, new RegExp(`port=${a.devPort}/${a.devPort}`));
  assert.strictEqual(state.port, a.devPort);
  assert.strictEqual(state.portCount, PORT_COUNT);
});

test('ほかのアプリが使っているポートの組は避ける', async () => {
  const ctx = setup();
  const c = ctx.agents.createCard({ title: 't', prompt: 'hello', repoPath: ctx.repo });
  // 先頭の組はほかのタスクが持っているものとして、次の組の途中のポートをふさぐ
  const held = ctx.agents.createCard({ title: 'held', prompt: 'hello', repoPath: ctx.repo });
  await ctx.agents.ensureDevPort(held);
  const server = net.createServer();
  const blocked = held.devPort + PORT_COUNT + 3;
  const listening = await new Promise((r) => {
    server.once('error', () => r(false));
    server.listen(blocked, '127.0.0.1', () => r(true));
  });
  await ctx.agents.ensureDevPort(c);
  if (listening) await new Promise((r) => server.close(r));
  assert.notStrictEqual(c.devPort, held.devPort);
  assert.ok(blocked < c.devPort || blocked >= c.devPort + PORT_COUNT, String(c.devPort));
  const first = c.devPort;
  await ctx.agents.ensureDevPort(c);
  assert.strictEqual(c.devPort, first, '一度決めたら変えない');
});

test('worktree を消すとポートを返す', async () => {
  const ctx = setup();
  const c = start(ctx);
  await waitFor(() => c.status === 'review');
  assert.ok(c.devPort);
  await ctx.agents.removeWorktreeOf(c, ctx.repo);
  assert.strictEqual(c.devPort, undefined);
});
