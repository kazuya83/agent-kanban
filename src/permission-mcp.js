#!/usr/bin/env node
// Claude Code の --permission-prompt-tool から呼ばれる、最小構成の MCP サーバー（stdio）。
// 許可を求められたらアプリ本体（127.0.0.1 の HTTP）に問い合わせ、ユーザーがカード上で
// 「許可 / 拒否」を押すまで待ってから結果を返す。npm の依存はない。
// 言語は renderer/i18n.js（パッケージ時は permission-mcp.js と一緒に asar の外へ出す）。
const http = require('http');
const fs = require('fs');
const I18n = require('../renderer/i18n');
const { tr } = I18n;

// 接続先（ポート・トークン・カード・言語）。ふつうは env で受け取る。
// WSL の中の claude から Windows のアプリを呼ぶと env（WSLENV）が届かないことがあるので、
// env に無いときは、引数で渡された MCP の設定ファイル（mcpServers.agent_kanban.env）から読む
function loadSettings(env = process.env, argv = process.argv) {
  let fromFile = {};
  if (!env.KANBAN_PORT || !env.KANBAN_TOKEN || !env.KANBAN_LANGUAGE) {
    const file = (argv || []).slice(2).find((a) => typeof a === 'string' && /\.json$/i.test(a));
    if (file) {
      try {
        const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
        const servers = (conf && conf.mcpServers) || {};
        const s = servers.agent_kanban || Object.values(servers)[0] || {};
        fromFile = s.env || {};
      } catch {
        fromFile = {};
      }
    }
  }
  const pick = (k) => env[k] || fromFile[k] || '';
  return { port: Number(pick('KANBAN_PORT')), token: pick('KANBAN_TOKEN'), card: pick('KANBAN_CARD'), language: pick('KANBAN_LANGUAGE') };
}

let PORT = NaN;
let TOKEN = '';
let CARD = '';

const TOOL = {
  name: 'approve',
  description: 'Ask the human operator on the Worktree Kanban board to approve or deny a tool call.',
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
        serverInfo: { name: 'worktree-kanban', version: '0.1.0' },
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
      decision = { behavior: 'deny', message: tr('Worktree Kanban に接続できなかったため拒否しました: {message}', { message: err.message }) };
    }
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
  }
  if (id !== undefined && id !== null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
  // notifications/* は返事不要
}

let started = false;
function start() {
  if (started) return;
  started = true;
  const loaded = loadSettings();
  PORT = loaded.port;
  TOKEN = loaded.token;
  CARD = loaded.card;
  // このプロセスの初期言語は日本語のままなので、アプリが渡した言語に合わせる
  I18n.setLanguage(loaded.language);
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
}

module.exports = { start, loadSettings };

// claude から（ELECTRON_RUN_AS_NODE=1 か node で）直接起動されたとき
if (require.main === module) start();
