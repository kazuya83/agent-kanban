// テスト用の偽 codex app-server / 偽 cursor-agent acp。
// 本物と同じ形で話し、touch-approved.txt を作るコマンドの許可を聞いて、許可されたらファイルを作る
//（形は Codex 0.167.0・Cursor 2026.11.05 の実機のやりとりを写したもの）
const fs = require('fs');
const readline = require('readline');

const log = (o) => process.env.FAKE_RPC_LOG && fs.appendFileSync(process.env.FAKE_RPC_LOG, `${JSON.stringify(o)}\n`);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const THREAD = '01a1b259-9848-79a0-aeff-73cafc4a7399';
const SESSION = '1c90448d-0b6f-44bd-96e6-eba7e8118472';

function run(kind, args) {
  let nextServerId = 100;
  const waiting = new Map();
  const ask = (method, params, jsonrpc) =>
    new Promise((resolve) => {
      const id = nextServerId++;
      waiting.set(id, resolve);
      out({ ...(jsonrpc ? { jsonrpc: '2.0' } : {}), id, method, params });
    });
  const write = (name) => fs.writeFileSync(name, 'x');
  const handlers = kind === 'codex' ? codex(ask, write) : acp(ask, write, args);
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return;
    const m = JSON.parse(line);
    log(m);
    if (m.method == null) {
      waiting.get(m.id)?.(m.result);
      return;
    }
    if (m.id == null) return;
    const h = handlers[m.method];
    if (!h) {
      out({ ...(kind === 'cursor' ? { jsonrpc: '2.0' } : {}), id: m.id, error: { code: -32601, message: 'not found' } });
      return;
    }
    const base = { ...(kind === 'cursor' ? { jsonrpc: '2.0' } : {}), id: m.id };
    await h(m.params || {}, (result) => out({ ...base, result }), (error) => out({ ...base, error }));
  });
  process.stdin.on('end', () => process.exit(0));
}

function codex(ask, write) {
  const note = (method, params) => out({ method, params });
  const turnId = 'turn-1';
  return {
    initialize: (_p, reply) => reply({ userAgent: 'fake', platformOs: 'macos' }),
    'thread/start': (_p, reply) => reply({ thread: { id: THREAD }, model: 'fake-model' }),
    'thread/resume': (p, reply) => reply({ thread: { id: p.threadId }, model: 'fake-model' }),
    'turn/start': async (p, reply) => {
      reply({ turn: { id: turnId, status: 'inProgress' } });
      if (process.env.FAKE_RPC_CRASH) process.exit(3);
      if (process.env.FAKE_RPC_FAIL) {
        note('turn/completed', { threadId: p.threadId, turn: { id: turnId, status: 'failed', error: { message: 'model exploded' } } });
        return;
      }
      const command = "/bin/zsh -lc 'touch approved.txt'";
      const commandActions = [{ type: 'unknown', command: 'touch approved.txt' }];
      note('item/started', { item: { type: 'commandExecution', id: 'c1', command, commandActions, status: 'inProgress' }, threadId: p.threadId, turnId });
      const r = await ask('item/commandExecution/requestApproval', { threadId: p.threadId, turnId, itemId: 'c1', command, commandActions, cwd: process.cwd(), reason: 'because' });
      if (r.decision === 'accept') write('approved.txt');
      const status = r.decision === 'accept' ? 'completed' : 'declined';
      note('item/completed', { item: { type: 'commandExecution', id: 'c1', command, commandActions, status, exitCode: status === 'completed' ? 0 : null, aggregatedOutput: status === 'completed' ? 'ok' : null }, threadId: p.threadId, turnId });
      const changes = [{ path: `${process.cwd()}/edited.txt`, kind: { type: 'add' }, diff: 'one\n' }];
      note('item/started', { item: { type: 'fileChange', id: 'f1', changes, status: 'inProgress' }, threadId: p.threadId, turnId });
      const f = await ask('item/fileChange/requestApproval', { threadId: p.threadId, turnId, itemId: 'f1', reason: null, grantRoot: null });
      if (f.decision === 'accept') write('edited.txt');
      note('item/completed', { item: { type: 'fileChange', id: 'f1', changes, status: f.decision === 'accept' ? 'completed' : 'declined' }, threadId: p.threadId, turnId });
      note('turn/plan/updated', { threadId: p.threadId, turnId, plan: [{ step: 'do it', status: 'completed' }] });
      note('item/completed', { item: { type: 'agentMessage', id: 'm', text: 'できました' }, threadId: p.threadId, turnId });
      note('turn/completed', { threadId: p.threadId, turn: { id: turnId, status: 'completed' } });
    },
  };
}

function acp(ask, write, args) {
  const note = (sessionId, update) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
  return {
    initialize: (_p, reply) => reply({ protocolVersion: 1, agentCapabilities: { loadSession: true } }),
    'session/new': (_p, reply) => reply({ sessionId: SESSION }),
    'session/load': (p, reply, fail) => {
      if (process.env.FAKE_RPC_NO_LOAD) {
        fail({ code: -32602, message: 'Invalid params', data: { message: 'Session not found' } });
        return;
      }
      // 前の会話が流れてくる
      note(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '前の返事' } });
      reply({});
    },
    'session/set_mode': (_p, reply) => reply({}),
    'session/prompt': async (p, reply) => {
      const s = p.sessionId;
      if (args.includes('--force')) write('forced.txt');
      note(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '動かします' } });
      const toolCallId = 'call-1\nfc_1';
      note(s, { sessionUpdate: 'tool_call', toolCallId, title: '`touch approved.txt`', kind: 'execute', status: 'pending', rawInput: { command: 'touch approved.txt' } });
      note(s, { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' });
      const r = await ask(
        'session/request_permission',
        {
          sessionId: s,
          toolCall: { toolCallId, title: '`touch approved.txt`', kind: 'execute', status: 'pending', content: [{ type: 'content', content: { type: 'text', text: 'Not in allowlist: touch' } }] },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
        },
        true,
      );
      const ok = r.outcome.optionId === 'allow-once';
      if (ok) write('approved.txt');
      note(s, { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', ...(ok ? { rawOutput: { exitCode: 0, stdout: 'ok', stderr: '' } } : {}) });
      note(s, { sessionUpdate: 'plan', entries: [{ content: 'do it', priority: 'medium', status: 'completed' }] });
      note(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'できました' } });
      reply({ stopReason: process.env.FAKE_RPC_STOP || 'end_turn' });
    },
  };
}

module.exports = { run };
