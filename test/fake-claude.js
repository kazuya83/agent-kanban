#!/usr/bin/env node
// テスト用の偽 claude。本物と同じく --mcp-config の MCP サーバーを起動して承認ツールを呼び、
// 許可されたら cwd にファイルを書き、stream-json を出力する。
// --input-format stream-json のときは、stdin の各行をメッセージとして受け取り、
// --replay-user-messages と同じように受け取ったメッセージをそのまま返す。
// 作業中に届いたメッセージ（btw）は、そのターンの返事に含める。
const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---- 入力 ----
const streamIn = opt('--input-format') === 'stream-json';
const inbox = []; // まだ処理していないメッセージ
let inputEnded = false;
let wake = null;
const notify = () => {
  if (wake) {
    const w = wake;
    wake = null;
    w();
  }
};
function startInput() {
  if (!streamIn) {
    let all = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (all += c));
    process.stdin.on('end', () => {
      inbox.push(all);
      inputEnded = true;
      notify();
    });
    return;
  }
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    const text = typeof msg.message.content === 'string' ? msg.message.content : msg.message.content.map((b) => b.text || '').join('');
    if (args.includes('--replay-user-messages')) out({ type: 'user', isReplay: true, message: { role: 'user', content: text } });
    inbox.push(text);
    notify();
  });
  rl.on('close', () => {
    inputEnded = true;
    notify();
  });
}
async function nextMessage() {
  while (!inbox.length) {
    if (inputEnded) return null;
    await new Promise((r) => (wake = r));
  }
  return inbox.shift();
}

// ---- 1ターン分の作業 ----
async function turn(prompt, sessionId) {
  out({ type: 'assistant', message: { content: [{ type: 'text', text: `了解: ${prompt}` }] } });
  if (process.env.FAKE_SLEEP) await sleep(Number(process.env.FAKE_SLEEP));

  const file = `out-${Date.now()}.txt`;
  const input = { command: `echo > ${file}` };
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input }] } });
  const cfg = opt('--mcp-config');
  const decision = cfg ? await askPermission(cfg, 'Bash', input) : { behavior: 'allow', updatedInput: input };
  // 作業中に届いた btw はこのターンに取り込む（本物の claude と同じ）
  const btw = inbox.splice(0);
  if (decision.behavior === 'allow') {
    fs.writeFileSync(file, `${[prompt, ...btw].join('\n')}\n`);
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } });
  } else {
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: decision.message }] } });
  }
  const extra = btw.length ? ` / btw: ${btw.join(' | ')}` : '';
  out({ type: 'result', subtype: 'success', is_error: false, result: `done (${decision.behavior})${extra}`, session_id: sessionId, total_cost_usd: 0.01, duration_ms: 1200 });
}

(async () => {
  startInput();
  // --fork-session なら、引き継いだ会話から新しい ID の会話を作る（本物と同じ）
  const resumed = opt('--resume');
  const sessionId = resumed ? (args.includes('--fork-session') ? `fork-of-${resumed}` : resumed) : `sess-new-${process.pid}`;
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', permissionMode: opt('--permission-mode') });
  // 本物と同じく、stdin が閉じられるまで次のメッセージを待って処理する
  for (;;) {
    const msg = await nextMessage();
    if (msg === null) break;
    await turn(msg, sessionId);
  }
  process.exit(0);
})();
