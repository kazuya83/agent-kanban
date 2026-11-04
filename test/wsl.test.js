// Windows から WSL のリポジトリを扱うしくみ（偽の wsl.exe で確かめる）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const wsl = require('../src/wsl');

test('パスの変換', () => {
  assert.deepStrictEqual(wsl.parseWslPath('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo'), { distro: 'Ubuntu', linux: '/home/me/repo' });
  assert.deepStrictEqual(wsl.parseWslPath('\\\\wsl$\\Ubuntu-22.04\\home\\me\\'), { distro: 'Ubuntu-22.04', linux: '/home/me' });
  assert.deepStrictEqual(wsl.parseWslPath('//wsl.localhost/Ubuntu/home/me'), { distro: 'Ubuntu', linux: '/home/me' });
  assert.deepStrictEqual(wsl.parseWslPath('\\\\wsl.localhost\\Ubuntu'), { distro: 'Ubuntu', linux: '/' });
  assert.strictEqual(wsl.parseWslPath('C:\\Users\\me\\repo'), null);
  assert.strictEqual(wsl.parseWslPath('/home/me/repo'), null);
  assert.strictEqual(wsl.parseWslPath('\\\\server\\share\\x'), null);
  assert.strictEqual(wsl.toUnc('Ubuntu', '/home/me/repo'), '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo');
  assert.strictEqual(wsl.toUnc('Ubuntu', '/'), '\\\\wsl.localhost\\Ubuntu\\');
  assert.strictEqual(wsl.toLinux('C:\\Users\\me\\AppData\\Roaming\\agent-kanban\\mcp\\a.json'), '/mnt/c/Users/me/AppData/Roaming/agent-kanban/mcp/a.json');
  assert.strictEqual(wsl.toLinux('\\\\wsl.localhost\\Ubuntu\\home\\me'), '/home/me');
  assert.strictEqual(wsl.fromLinux('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo', '/home/me/repo.worktrees/x'), '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo.worktrees\\x');
  assert.strictEqual(wsl.fromLinux('/home/me/repo', '/home/me/x'), '/home/me/x', 'WSL でなければそのまま');
});

test('WSL の中でコマンドを動かす引数（スペースや引用符を含む引数・環境変数）', () => {
  const c = wsl.command('Ubuntu', '/tmp', 'printf', ['%s|%s|%s', "it's a \"test\"", '$HOME', ''], { env: { FOO: "a'b c" }, path: '/usr/bin:/bin' });
  assert.deepStrictEqual(c.args.slice(0, 6), ['-d', 'Ubuntu', '--cd', '/tmp', '--exec', 'bash']);
  // bash -c の部分を、この環境でそのまま動かしてみる
  const out = execFileSync(c.args[5], c.args.slice(6), { encoding: 'utf8' });
  assert.strictEqual(out, `it's a "test"|$HOME|`);
  const env = execFileSync('bash', ['-c', c.args[7].replace('exec "$0" "$@"', 'printf %s "$FOO;$PATH"')], { encoding: 'utf8' });
  assert.strictEqual(env, "a'b c;/usr/bin:/bin");
});

function fakeWsl(tmp) {
  const bin = path.join(tmp, 'wsl');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, 'fake-wsl.js')}" "$@"\n`, { mode: 0o755 });
  return bin;
}

test('ディストリビューションの一覧（UTF-16LE・docker-desktop は除く）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-wsl-'));
  process.env.AGENT_KANBAN_WSL = fakeWsl(tmp);
  try {
    assert.deepStrictEqual(await wsl.listDistros(), ['Ubuntu', 'Debian']);
  } finally {
    delete process.env.AGENT_KANBAN_WSL;
  }
});

test('WSL のフォルダでは、git を WSL の中で動かし、返ってきたパスを Windows の形に戻す', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-wsl-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const log = path.join(tmp, 'wsl.log');
  process.env.AGENT_KANBAN_WSL = fakeWsl(tmp);
  process.env.FAKE_WSL_LOG = log;
  const git = require('../src/git');
  const unc = wsl.toUnc('Ubuntu', repo);
  try {
    assert.strictEqual(await git.toplevel(unc), unc, 'リポジトリの場所は Windows の形で返る');
    assert.strictEqual(await git.currentBranch(unc), 'main');
    // worktree を作る（引数の Windows の形のパスは、Linux の形にして渡す）
    const wtUnc = wsl.toUnc('Ubuntu', path.join(tmp, 'repo.worktrees', 'x1'));
    await git.addWorktree(unc, wtUnc, 'agent/x1', 'HEAD');
    assert.ok(fs.existsSync(path.join(tmp, 'repo.worktrees', 'x1', 'a.txt')));
    const list = await git.listWorktrees(unc);
    assert.deepStrictEqual(list.map((w) => w.path), [unc, wtUnc]);
    assert.strictEqual(await git.worktreeForBranch(unc, 'agent/x1'), wtUnc);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(calls.every((c) => c.seen.includes('distro=Ubuntu')));
    assert.ok(calls.every((c) => c.mode === 'exec'), '引数がつなげられないよう、--exec で渡す');
    assert.ok(calls.some((c) => c.rest.includes(path.join(tmp, 'repo.worktrees', 'x1'))), 'worktree add には Linux の形のパスを渡す');
    assert.ok(calls.every((c) => !JSON.stringify(c.rest).includes('wsl.localhost')), 'Windows の形のパスは渡さない');
  } finally {
    delete process.env.AGENT_KANBAN_WSL;
    delete process.env.FAKE_WSL_LOG;
  }
});

test('WSL のフォルダでは、claude を WSL の中で起動する（Windows のパスは /mnt/c/... に、環境変数も渡す）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-wsl-'));
  const log = path.join(tmp, 'wsl.log');
  process.env.AGENT_KANBAN_WSL = fakeWsl(tmp);
  process.env.FAKE_WSL_LOG = log;
  // 偽の claude: 受け取った引数・作業フォルダ・環境変数を書き出す
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "cwd=$(pwd)" "timeout=$MCP_TOOL_TIMEOUT" "$@"\n`, { mode: 0o755 });
  const { Store } = require('../src/store');
  const { AgentManager } = require('../src/agent');
  const store = new Store(path.join(tmp, 'board.json'));
  store.settings.wslClaudePath = path.join(bin, 'claude');
  const agents = new AgentManager(store, { mcpScript: 'C:\\app\\resources\\app.asar.unpacked\\src\\permission-mcp.js', mcpDir: path.join(tmp, 'mcp'), nodeBin: 'C:\\Users\\me\\AppData\\Local\\Programs\\Claude Agent Kanban\\Claude Agent Kanban.exe' });
  try {
    const child = await agents.spawnClaude(wsl.toUnc('Ubuntu', tmp), ['-p', '--mcp-config', 'C:\\Users\\me\\AppData\\Roaming\\agent-kanban\\mcp\\c1.json', '--model', 'x y'], { MCP_TOOL_TIMEOUT: '86400000' });
    assert.strictEqual(child.viaWsl, 'Ubuntu');
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    await new Promise((r) => child.on('close', r));
    assert.deepStrictEqual(out.trim().split('\n'), [`cwd=${tmp}`, 'timeout=86400000', '-p', '--mcp-config', '/mnt/c/Users/me/AppData/Roaming/agent-kanban/mcp/c1.json', '--model', 'x y']);

    // 承認の MCP: WSL の中から Windows 側のアプリを呼ぶ設定になる
    agents.setPermissionEndpoint(4321, 'tok');
    const file = agents.writeMcpConfig({ id: 'c1' }, 'Ubuntu');
    const conf = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.agent_kanban;
    assert.strictEqual(conf.command, '/mnt/c/Users/me/AppData/Local/Programs/Claude Agent Kanban/Claude Agent Kanban.exe');
    assert.deepStrictEqual(conf.args, ['C:\\app\\resources\\app.asar.unpacked\\src\\permission-mcp.js'], 'スクリプトは Windows のプログラムが読むので Windows の形');
    assert.match(conf.env.WSLENV, /KANBAN_PORT\/u/);
    assert.match(conf.env.WSLENV, /KANBAN_TOKEN\/u/);
    assert.match(conf.env.WSLENV, /ELECTRON_RUN_AS_NODE\/u/);
    // WSL でなければ、これまでどおり
    const local = JSON.parse(fs.readFileSync(agents.writeMcpConfig({ id: 'c2' }), 'utf8')).mcpServers.agent_kanban;
    assert.strictEqual(local.command, 'C:\\Users\\me\\AppData\\Local\\Programs\\Claude Agent Kanban\\Claude Agent Kanban.exe');
    assert.strictEqual(local.env.WSLENV, undefined);
  } finally {
    delete process.env.AGENT_KANBAN_WSL;
    delete process.env.FAKE_WSL_LOG;
  }
});

test('WSL のリポジトリの会話は、WSL の中のパスで「このリポジトリの会話」を見分ける', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-wsl-'));
  const cfg = path.join(tmp, 'claude');
  const pj = path.join(cfg, 'projects', 'p');
  fs.mkdirSync(pj, { recursive: true });
  fs.writeFileSync(path.join(pj, 's1.jsonl'), JSON.stringify({ type: 'user', cwd: '/home/me/repo', message: { role: 'user', content: 'このリポジトリ' } }) + '\n');
  fs.writeFileSync(path.join(pj, 's2.jsonl'), JSON.stringify({ type: 'user', cwd: '/home/me/repo.worktrees/x', message: { role: 'user', content: 'タスクの worktree' } }) + '\n');
  fs.writeFileSync(path.join(pj, 's3.jsonl'), JSON.stringify({ type: 'user', cwd: '/home/me/other', message: { role: 'user', content: 'ほか' } }) + '\n');
  const { listSessions } = require('../src/sessions');
  const list = listSessions('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo', { configDir: cfg });
  const rel = Object.fromEntries(list.map((s) => [s.id, s.related]));
  assert.deepStrictEqual(rel, { s1: true, s2: true, s3: false });
});
