// 外から入ってくる値（ブランチ名・セッション ID・承認トークンなど）の検証
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const git = require('../src/git');
const { Store } = require('../src/store');
const { AgentManager, isSessionId, quoteForCmd } = require('../src/agent');
const { PermissionServer } = require('../src/permission-server');

test('assertSafeRef: オプションとして解釈される名前や不正な名前を拒否する', () => {
  for (const ok of ['main', 'feature/login', 'release-1.2', 'agent/issue-19-abc']) assert.strictEqual(git.assertSafeRef(ok), ok);
  for (const bad of ['', '-x', '--upload-pack=touch /tmp/x', '--output=/tmp/x', 'a b', 'a..b', 'a~1', 'a^', 'a:b', 'x\ny', 'a@{1}', 'a\\b']) {
    assert.throws(() => git.assertSafeRef(bad), /使えません/, bad);
  }
});

test('isSessionId: UUID は通し、オプションや記号を含む値は拒否する', () => {
  assert.ok(isSessionId('3f2a1b4c-1234-4abc-9def-0123456789ab'));
  assert.ok(isSessionId('ext-1'));
  for (const bad of ['', '--dangerously-skip-permissions', '-x', 'a"&calc&"', 'a b', 'a;b', null, 123]) assert.ok(!isSessionId(bad), String(bad));
});

test('quoteForCmd: cmd.exe で抜けられる文字を含む引数は拒否する', () => {
  assert.strictEqual(quoteForCmd('stream-json'), 'stream-json');
  assert.strictEqual(quoteForCmd('Bash(git *)'), '"Bash(git *)"');
  assert.strictEqual(quoteForCmd('C:\\Program Files\\claude.cmd'), '"C:\\Program Files\\claude.cmd"');
  for (const bad of ['a"&calc&"', '%PATH%', 'a!b!', 'a\nb']) assert.throws(() => quoteForCmd(bad), /使えません/, bad);
});

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-sec-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, { repoPath: repo, maxParallel: 1 });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  return { tmp, agents };
}

test('不正なセッション ID ではカードを作れない・切り替えられない', () => {
  const { tmp, agents } = setup();
  try {
    assert.throws(() => agents.createCard({ title: 't', prompt: 'p', session: { mode: 'resume', id: '--dangerously-skip-permissions' } }), /ID が正しくありません/);
    const c = agents.createCard({ title: 't', prompt: 'p' });
    assert.throws(() => agents.setSession(c.id, { mode: 'resume', id: '-x' }), /ID が正しくありません/);
    assert.ok(!agents.must(c.id).sessionId);
    assert.strictEqual(agents.store.cards.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('MCP 設定ファイル（承認トークン入り）は自分だけが読める', { skip: process.platform === 'win32' }, () => {
  const { tmp, agents } = setup();
  try {
    agents.setPermissionEndpoint(12345, 'secret-token');
    const c = agents.createCard({ title: 't', prompt: 'p' });
    const file = agents.writeMcpConfig(c);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('承認サーバーは正しいトークンがないと 403 を返す', async () => {
  const server = new PermissionServer(async () => ({ behavior: 'allow' }));
  await server.start();
  const post = (token) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.port, path: '/permission', method: 'POST', headers: token == null ? {} : { 'x-kanban-token': token } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end('{}');
    });
  try {
    assert.strictEqual(await post(null), 403);
    assert.strictEqual(await post('wrong'), 403);
    assert.strictEqual(await post(server.token.slice(0, -1) + 'x'), 403);
    assert.strictEqual(await post(server.token), 200);
  } finally {
    server.close();
  }
});
