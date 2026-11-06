#!/usr/bin/env node
// テスト用の偽 Codex CLI / 偽 Antigravity CLI / 偽 Gemini CLI / 偽 Cursor CLI（1つ目の引数 codex / antigravity / gemini / cursor で切り替える）。
// 本物と同じく、指示を stdin から（Cursor は最後の引数から）読み、cwd にファイルを書いて、JSONL のイベントを出す。
// 受け取った引数は FAKE_ARGS_LOG があればそこに1行ずつ追記する
const fs = require('fs');

const [kind, ...args] = process.argv.slice(2);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (process.env.FAKE_ARGS_LOG) fs.appendFileSync(process.env.FAKE_ARGS_LOG, `${JSON.stringify({ kind, args })}\n`);

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', async () => {
  if (kind === 'cursor') prompt = args[args.length - 1].replace(/^ (?=-)/, '');
  // ブランチ名を聞かれたら、ファイルは書かずに名前だけ返す
  const branchAsk = prompt.startsWith('git のブランチ名を1つだけ考えてください');
  if (branchAsk && kind === 'codex') {
    out({ type: 'thread.started', thread_id: `codex-thread-${process.pid}` });
    out({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'feature/fake-codex-branch' } });
    out({ type: 'turn.completed' });
    process.exit(0);
  }
  if (branchAsk && kind === 'gemini') {
    out({ type: 'init', session_id: `gemini-sess-${process.pid}` });
    out({ type: 'message', role: 'assistant', content: 'feature/fake-', delta: true });
    out({ type: 'message', role: 'assistant', content: 'gemini-branch', delta: true });
    out({ type: 'result', status: 'success' });
    process.exit(0);
  }
  if (branchAsk && kind === 'cursor') {
    out({ type: 'system', subtype: 'init', session_id: `cursor-chat-${process.pid}`, model: 'fake' });
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'feature/fake-cursor-branch' }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'feature/fake-cursor-branch' });
    process.exit(0);
  }
  // [same-file] なら、どの工程も同じファイルに書く（並列の枝のマージでコンフリクトさせる）
  const file = prompt.includes('[same-file]') ? 'same.txt' : `${kind}-${Date.now()}-${process.pid}.txt`;
  // 先頭にあるときだけ（Pipelineの次の工程の指示には元の指示が入るので）。[fail-step] は工程の担当の説明に書いて、その工程だけ失敗させる
  const fail = prompt.startsWith('[fail]') || prompt.includes('[fail-step]');
  const ask = prompt.includes('[q]');
  if (kind === 'codex') {
    // codex exec [resume] --json ... [SESSION_ID] -
    const resumed = args[1] === 'resume' ? args[args.length - 2] : null;
    out({ type: 'thread.started', thread_id: resumed || `codex-thread-${process.pid}` });
    // 実行中の btw（終了後の追加指示予約）を試すとき用。会話 ID が付いたあとに待つ
    if (process.env.FAKE_SLEEP) await sleep(Number(process.env.FAKE_SLEEP));
    out({ type: 'turn.started' });
    out({ type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: `bash -lc 'echo > ${file}'`, status: 'in_progress' } });
    fs.writeFileSync(file, `${prompt}\n`);
    out({ type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command: `bash -lc 'echo > ${file}'`, aggregated_output: '', exit_code: 0, status: 'completed' } });
    out({ type: 'item.completed', item: { id: 'item_1', type: 'file_change', changes: [{ path: file, kind: 'add' }], status: 'completed' } });
    if (fail) {
      out({ type: 'turn.failed', error: { message: 'codex boom' } });
      process.exit(1);
    }
    // Pipelineの判定する工程（指示に判定の印の説明があるとき）: [judge-always-fail] ならいつも差し戻し、
    // [judge] なら1回目は差し戻し・2回目以降（見出しに「回目」がある）は合格
    // [result=値] なら、その値をいつも書く
    let verdict = '';
    const judging = prompt.includes('[[RESULT:');
    const fixed = /\[result=([^\]]+)\]/.exec(prompt);
    if (judging && fixed) verdict = `\n[[RESULT:${fixed[1]}]]`;
    else if (judging && prompt.includes('[judge-always-fail]')) verdict = '\n[[RESULT:fail]]';
    else if (judging && prompt.includes('[judge]')) verdict = prompt.split('\n')[0].includes('回目') ? '\n[[RESULT:pass]]' : '\n直してください\n[[RESULT:fail]]';
    out({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: ask ? 'どちらにしますか？' : `codex done: ${prompt.split('\n')[0]}${verdict}` } });
    out({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
    process.exit(0);
  }
  if (kind === 'antigravity') {
    // 本物の agy 1.5 の出力と同じ形（--output-format stream-json）。種類は event に入っている
    const sid = opt('--conversation') || `agy-conv-${process.pid}`;
    const step = (o) => out({ event: 'step_update', step_update: { conversation_id: sid, ...o } });
    out({ event: 'init', conversation_id: sid, init: { cwd: process.cwd(), tools: ['run_command'], permission_mode: args.includes('--dangerously-skip-permissions') ? 'always-proceed' : 'request-review', ...(opt('--model') ? { model: opt('--model') } : {}) } });
    step({ step_index: 0, state: 'DONE', step_type: 'user_input' });
    step({ step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'ファイルを' });
    step({ step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: '作ります\n' });
    step({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'write_file', tool_info: { name: 'write_file', parameters: { Path: file } } });
    if (opt('--mode') === 'plan' || (opt('--mode') !== 'accept-edits' && !args.includes('--dangerously-skip-permissions'))) {
      // 許可されていないと、確認を出せないのでその場で拒否される
      step({ step_index: 2, state: 'ERROR', step_type: 'tool', tool_name: 'write_file', tool_info: { name: 'write_file', parameters: { Path: file }, error: { type: 'TOOL_ERROR', message: 'permission check failed' } } });
    } else {
      fs.writeFileSync(file, `${prompt}\n`);
      step({ step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'write_file', tool_info: { name: 'write_file', parameters: { Path: file } } });
    }
    if (fail) {
      out({ event: 'result', result: { conversation_id: sid, status: 'ERROR', response: '', error: 'agy boom', num_turns: 1, finished_reason: 'error' } });
      process.exit(3);
    }
    step({ step_index: 3, state: 'DONE', step_type: 'agent_response', text_delta: `antigravity done: ${prompt.split('\n')[0]}\n` });
    out({ event: 'result', result: { conversation_id: sid, status: 'SUCCESS', response: 'done', num_turns: 1 } });
    process.exit(0);
  }
  if (kind === 'gemini') {
    const sid = opt('--resume') || `gemini-sess-${process.pid}`;
    out({ type: 'init', session_id: sid, model: opt('-m') || 'gemini-fake' });
    out({ type: 'message', role: 'user', content: prompt });
    out({ type: 'message', role: 'assistant', content: 'ファイルを', delta: true });
    out({ type: 'message', role: 'assistant', content: '作ります', delta: true });
    out({ type: 'tool_use', tool_name: 'write_file', tool_id: 't1', parameters: { file_path: file } });
    fs.writeFileSync(file, `${prompt}\n`);
    out({ type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' });
    if (fail) {
      out({ type: 'result', status: 'error', error: { type: 'X', message: 'gemini boom' } });
      process.exit(1);
    }
    out({ type: 'message', role: 'assistant', content: `gemini done: ${prompt.split('\n')[0]}`, delta: true });
    out({ type: 'result', status: 'success', stats: {} });
    process.exit(0);
  }
  if (kind === 'cursor') {
    // cursor-agent -p --output-format stream-json ... [--resume ID] PROMPT
    const sid = opt('--resume') || `cursor-chat-${process.pid}`;
    out({ type: 'system', subtype: 'init', session_id: sid, model: opt('--model') || 'cursor-fake', permissionMode: 'default' });
    out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] }, session_id: sid });
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ファイルを' }] }, session_id: sid });
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '作ります' }] }, session_id: sid });
    out({ type: 'tool_call', subtype: 'started', call_id: 'c1', tool_call: { writeToolCall: { args: { path: file, fileText: prompt } } }, session_id: sid });
    if (!args.includes('--force')) {
      // --force がないと書かない（本物と同じ）
      out({ type: 'tool_call', subtype: 'completed', call_id: 'c1', tool_call: { writeToolCall: { args: { path: file }, result: { rejected: { reason: 'not forced' } } } }, session_id: sid });
    } else {
      fs.writeFileSync(file, `${prompt}\n`);
      out({ type: 'tool_call', subtype: 'completed', call_id: 'c1', tool_call: { writeToolCall: { args: { path: file }, result: { success: { path: file, linesCreated: 1 } } } }, session_id: sid });
    }
    if (fail) {
      out({ type: 'result', subtype: 'error', is_error: true, result: 'cursor boom', session_id: sid });
      process.exit(1);
    }
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ask ? 'どちらにしますか？' : `cursor done: ${prompt.split('\n')[0]}` }] }, session_id: sid });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: sid });
    process.exit(0);
  }
  process.stderr.write(`unknown kind ${kind}\n`);
  process.exit(2);
});
