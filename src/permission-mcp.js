#!/usr/bin/env node
// Claude Code の --permission-prompt-tool から呼ばれる、最小構成の MCP サーバー（stdio）。
// 許可を求められたらアプリ本体（127.0.0.1 の HTTP）に問い合わせ、ユーザーがカード上で
// 「許可 / 拒否」を押すまで待ってから結果を返す。依存パッケージなし。
const http = require('http');

const PORT = Number(process.env.KANBAN_PORT);
const TOKEN = process.env.KANBAN_TOKEN || '';
const CARD = process.env.KANBAN_CARD || '';

const TOOL = {
  name: 'approve',
  description: 'Ask the human operator on the Claude Agent Kanban board to approve or deny a tool call.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
      tool_use_id: { type: 'string' },
    },
    required: ['tool_name', 'input'],
  },
};

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function ask(args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      cardId: CARD,
      toolName: args.tool_name,
      input: args.input || {},
      toolUseId: args.tool_use_id,
    });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: '/permission',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-kanban-token': TOKEN,
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`unexpected response (${res.statusCode})`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-kanban', version: '0.1.0' },
      },
    });
  }
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/call') {
    let decision;
    try {
      decision = await ask((params && params.arguments) || {});
    } catch (err) {
      decision = { behavior: 'deny', message: `Claude Agent Kanban に接続できなかったため拒否しました: ${err.message}` };
    }
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
  }
  if (id !== undefined && id !== null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
  // notifications/* は返事不要
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
