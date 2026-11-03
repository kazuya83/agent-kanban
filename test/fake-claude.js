#!/usr/bin/env node
// テスト用の偽 claude。本物と同じく --mcp-config の MCP サーバーを起動して承認ツールを呼び、
// 許可されたら cwd にファイルを書き、stream-json を出力する。
const { spawn } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

async function askPermission(configPath, toolName, input) {
  const conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const [, server] = Object.entries(conf.mcpServers)[0];
  const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const waiters = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiters.get(msg.id)?.(msg);
    }
  });
  const rpc = (id, method, params) =>
    new Promise((resolve) => {
      waiters.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '0' } });
  const list = await rpc(2, 'tools/list', {});
  if (list.result.tools[0].name !== 'approve') throw new Error('tool missing');
  const res = await rpc(3, 'tools/call', { name: 'approve', arguments: { tool_name: toolName, input, tool_use_id: 'toolu_1' } });
  child.stdin.end();
  return JSON.parse(res.result.content[0].text);
}

(async () => {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) prompt += c;
  const sessionId = opt('--resume') || 'sess-fake-1';
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', permissionMode: opt('--permission-mode') });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: `了解: ${prompt}` }] } });
  if (process.env.FAKE_SLEEP) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SLEEP)));

  const file = `out-${Date.now()}.txt`;
  const input = { command: `echo > ${file}` };
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input }] } });
  const cfg = opt('--mcp-config');
  const decision = cfg ? await askPermission(cfg, 'Bash', input) : { behavior: 'allow', updatedInput: input };
  if (decision.behavior === 'allow') {
    fs.writeFileSync(file, `${prompt}\n`);
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } });
  } else {
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: decision.message }] } });
  }
  out({ type: 'result', subtype: 'success', is_error: false, result: `done (${decision.behavior})`, session_id: sessionId, total_cost_usd: 0.01, duration_ms: 1200 });
})();
