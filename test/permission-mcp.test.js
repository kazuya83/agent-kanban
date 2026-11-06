const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { loadSettings } = require('../src/permission-mcp');

const SCRIPT = path.join(__dirname, '..', 'src', 'permission-mcp.js');

function writeConf(dir, env) {
  const file = path.join(dir, 'c1.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { agent_kanban: { type: 'stdio', command: 'x', args: [SCRIPT, file], env } } }));
  return file;
}

test('接続先は env から読む。env に無ければ、引数の MCP の設定ファイルから読む', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-mcp-'));
  try {
    const file = writeConf(tmp, { KANBAN_PORT: '4321', KANBAN_TOKEN: 'tok', KANBAN_CARD: 'c1' });
    assert.deepStrictEqual(loadSettings({ KANBAN_PORT: '1', KANBAN_TOKEN: 't', KANBAN_CARD: 'x' }, ['exe', SCRIPT, file]), { port: 1, token: 't', card: 'x', language: '' });
    // WSL から Windows のアプリを呼んで、env（WSLENV）が届かなかったとき
    assert.deepStrictEqual(loadSettings({}, ['exe', SCRIPT, file]), { port: 4321, token: 'tok', card: 'c1', language: '' });
    const withLang = writeConf(tmp, { KANBAN_PORT: '9', KANBAN_TOKEN: 'tok', KANBAN_CARD: 'c9', KANBAN_LANGUAGE: 'fr' });
    assert.strictEqual(loadSettings({}, ['exe', SCRIPT, withLang]).language, 'fr', 'env が届かないときは設定ファイルの言語を使う');
    assert.strictEqual(loadSettings({ KANBAN_PORT: '1', KANBAN_TOKEN: 't', KANBAN_CARD: 'x', KANBAN_LANGUAGE: 'en' }, ['exe', SCRIPT, withLang]).language, 'en', 'env の言語が優先される');
    assert.strictEqual(loadSettings({ KANBAN_PORT: '1', KANBAN_TOKEN: 't', KANBAN_LANGUAGE: '' }, ['exe', SCRIPT, withLang]).language, 'fr', '空の env はファイルに戻る');
    // 設定ファイルが無い・壊れているとき
    assert.strictEqual(loadSettings({}, ['exe', SCRIPT]).token, '');
    fs.writeFileSync(file, '{');
    assert.strictEqual(loadSettings({}, ['exe', SCRIPT, file]).token, '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('env が届かなくても、設定ファイルの接続先に承認を問い合わせる', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-mcp-'));
  let got = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      got = { token: req.headers['x-kanban-token'], body: JSON.parse(body) };
      res.end(JSON.stringify({ behavior: 'allow', updatedInput: {} }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const file = writeConf(tmp, { KANBAN_PORT: String(server.address().port), KANBAN_TOKEN: 'tok', KANBAN_CARD: 'c1' });
    const env = { ...process.env };
    for (const k of ['KANBAN_PORT', 'KANBAN_TOKEN', 'KANBAN_CARD']) delete env[k];
    const child = spawn(process.execPath, [SCRIPT, file], { env });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Read', input: { file_path: '/a' } } } })}\n`);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout: ${out}`)), 10000);
      child.stdout.on('data', () => out.includes('\n') && (clearTimeout(t), resolve()));
    });
    child.stdin.end();
    const res = JSON.parse(out.split('\n')[0]);
    assert.deepStrictEqual(JSON.parse(res.result.content[0].text), { behavior: 'allow', updatedInput: {} });
    assert.strictEqual(got.token, 'tok');
    assert.strictEqual(got.body.cardId, 'c1');
    assert.strictEqual(got.body.toolName, 'Read');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function decisionFrom(env, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, file], { env });
    let out = '';
    const t = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout: ${out}`));
    }, 10000);
    child.stdout.on('data', (d) => {
      out += d;
      if (!out.includes('\n')) return;
      clearTimeout(t);
      child.stdin.end();
      try {
        const res = JSON.parse(out.split('\n')[0]);
        resolve(JSON.parse(res.result.content[0].text));
      } catch (err) {
        child.kill();
        reject(err);
      }
    });
    child.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Read', input: {} } } })}\n`);
  });
}

test('接続できないときの拒否理由は、起動時に渡した言語になる', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-mcp-'));
  try {
    const file = writeConf(tmp, { KANBAN_PORT: '1', KANBAN_TOKEN: 'tok', KANBAN_CARD: 'c1', KANBAN_LANGUAGE: 'en' });
    const env = { ...process.env };
    for (const k of ['KANBAN_PORT', 'KANBAN_TOKEN', 'KANBAN_CARD', 'KANBAN_LANGUAGE']) delete env[k];
    const en = await decisionFrom(env, file);
    assert.strictEqual(en.behavior, 'deny');
    assert.doesNotMatch(en.message, /Worktree Kanban に接続できなかったため拒否しました/);
    assert.match(en.message, /could not be reached/);
    const jaFile = writeConf(tmp, { KANBAN_PORT: '1', KANBAN_TOKEN: 'tok', KANBAN_CARD: 'c1' });
    const ja = await decisionFrom(env, jaFile);
    assert.match(ja.message, /Worktree Kanban に接続できなかったため拒否しました/);
    const bad = await decisionFrom({ ...env, KANBAN_LANGUAGE: 'jp' }, jaFile);
    assert.match(bad.message, /Worktree Kanban に接続できなかったため拒否しました/, '知らない言語コードは日本語のまま');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
