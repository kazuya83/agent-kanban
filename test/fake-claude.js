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

  // [ask] があれば、選択肢の質問（AskUserQuestion）をする
  const cfgQ = opt('--mcp-config');
  if (prompt.includes('[ask]') && cfgQ) {
    const qinput = { questions: [
      { question: 'どの色にしますか？', header: '色', multiSelect: false, options: [{ label: '赤', description: '情熱' }, { label: '青', description: '落ち着き' }] },
      { question: '対応する OS は？', header: 'OS', multiSelect: true, options: [{ label: 'Mac', description: '' }, { label: 'Windows', description: '' }] },
    ] };
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_q', name: 'AskUserQuestion', input: qinput }] } });
    const d = await askPermission(cfgQ, 'AskUserQuestion', qinput);
    const text = d.behavior === 'allow' && d.updatedInput.answers
      ? `Your questions have been answered: ${Object.entries(d.updatedInput.answers).map(([q, a]) => `"${q}"="${a}"`).join(', ')}`
      : 'The user did not answer the questions.';
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_q', content: text }] } });
    prompt += `\n[answers] ${text}`;
  }
  // コンフリクトの解消を頼まれたら、印を消して取り込みを完了する（FAKE_BAD_RESOLVE なら何もしない）
  if (prompt.includes('コンフリクトしているファイル:')) {
    const files = prompt.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
    if (!process.env.FAKE_BAD_RESOLVE) {
      const { execFileSync } = require('child_process');
      for (const f of files) {
        const body = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^(<<<<<<<|=======|>>>>>>>)/.test(l)).join('\n');
        fs.writeFileSync(f, body);
        out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: { file_path: f } }] } });
      }
      execFileSync('git', ['add', '-A']);
      execFileSync('git', ['-c', 'user.name=f', '-c', 'user.email=f@f', 'commit', '-q', '--no-edit']);
    }
    out({ type: 'result', subtype: 'success', is_error: false, result: '両方の変更を残して解消しました', session_id: sessionId, total_cost_usd: 0, duration_ms: 10 });
    return;
  }
  // サブタスクの順番を頼まれたら、印とブロックで返す（[serial] なら直列、なければ並列）
  if (prompt.includes('このタスクはサブタスクに分けて進めます')) {
    const keys = [...prompt.matchAll(/^### key: (\S+)/gm)].map((m) => m[1]);
    const serial = prompt.includes('[serial]');
    const items = keys.map((k, i) => ({ key: k, title: k, prompt: k, after: serial && i ? [keys[i - 1]] : [] }));
    out({ type: 'assistant', message: { content: [{ type: 'text', text: `[[SUBTASKS]]\n順番を決めました。\n\n\`\`\`subtasks\n${JSON.stringify(items)}\n\`\`\`` }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: '順番を決めました。', session_id: sessionId, total_cost_usd: 0, duration_ms: 10 });
    return;
  }
  // [split-me] があれば（サブタスクの提案を頼まれていれば）、2つのサブタスクを提案して止まる
  if (prompt.includes('[split-me]') && prompt.includes('[[SUBTASKS]]')) {
    const items = [{ key: 'api', title: 'API', prompt: 'API を作る [same-file]', after: [] }, { key: 'ui', title: '画面', prompt: '画面を作る [same-file]', after: [] }];
    out({ type: 'assistant', message: { content: [{ type: 'text', text: `[[SUBTASKS]]\n2つに分けると速く進められます。\n1. API\n2. 画面\nこの分け方で、サブタスクにして進めますか？\n\n\`\`\`subtasks\n${JSON.stringify(items)}\n\`\`\`` }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'この分け方で、サブタスクにして進めますか？', session_id: sessionId, total_cost_usd: 0, duration_ms: 10 });
    return;
  }
  // [vague] があれば（仕様の確認を頼まれていて、まだ答え [spec-ok] をもらっていなければ）、印を付けて質問して止まる
  if (prompt.includes('[vague]') && prompt.includes('[[SPEC_UNCLEAR]]') && !prompt.includes('[spec-ok]')) {
    // [split] なら、質問の本文とフォーム用のブロックを別々のメッセージで返す
    if (prompt.includes('[split]')) {
      out({ type: 'assistant', message: { content: [{ type: 'text', text: '[[SPEC_UNCLEAR]]\n内容が詰まっていないので、開発を開始できません。\n1. 色はどうしますか？' }] } });
      out({ type: 'assistant', message: { content: [{ type: 'text', text: '```spec-questions\n[{"question":"色はどうしますか？","options":[]}]\n```' }] } });
      out({ type: 'result', subtype: 'success', is_error: false, result: '[[SPEC_UNCLEAR]]\n色はどうしますか？\n```spec-questions\n[]\n```', session_id: sessionId, total_cost_usd: 0, duration_ms: 10 });
      return;
    }
    out({ type: 'assistant', message: { content: [{ type: 'text', text: '[[SPEC_UNCLEAR]]\n内容が詰まっていないので、開発を開始できません。\n1. 対象の画面はどれですか？\n\n```spec-questions\n[{"question":"対象の画面はどれですか？","header":"画面","options":[{"label":"設定画面（おすすめ）","description":"いちばん使われる画面"},{"label":"一覧画面"}]}]\n```' }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: '対象の画面はどれですか？', session_id: sessionId, total_cost_usd: 0, duration_ms: 10 });
    return;
  }
  // [q] があれば、最後に文章で質問して止まる
  if (prompt.includes('[q]')) {
    out({ type: 'assistant', message: { content: [{ type: 'text', text: 'どちらの方法で進めますか？\n- A: 速い\n- B: 安全' }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'どちらの方法で進めますか？', session_id: sessionId, total_cost_usd: 0, duration_ms: 10 });
    return;
  }
  // ファイルを書き換えるツールを止められていれば、ファイルを変えず、止められたツールと文章で答えるだけ
  if (args.includes('--disallowedTools')) {
    const i = args.indexOf('--disallowedTools');
    const tools = [];
    for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) tools.push(args[j]);
    out({ type: 'assistant', message: { content: [{ type: 'text', text: `（書き換え禁止: ${tools.join(',')} / 権限モード: ${opt('--permission-mode')}）\n\n\`\`\`sql\nSELECT 1;\n\`\`\`` }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'SELECT 1;', session_id: sessionId, total_cost_usd: 0, duration_ms: 10 });
    return;
  }
  // 計画モードではファイルを変えず、文章で答えるだけ（本物の claude と同じ）
  if (opt('--permission-mode') === 'plan') {
    out({ type: 'assistant', message: { content: [{ type: 'text', text: `（計画モード）${prompt.slice(-200)}` }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: sessionId, total_cost_usd: 0, duration_ms: 10 });
    return;
  }
  // [same-file] があれば、同じファイル（shared.txt）に書く（サブタスク同士のコンフリクトを起こす）
  const file = prompt.includes('[same-file]') ? 'shared.txt' : `out-${Date.now()}-${process.pid}.txt`; // 同じミリ秒に動いても重ならないように
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
  // --output-format text は、ブランチ名を考えてもらうときの1回だけの呼び出し。
  // FAKE_BRANCH_NAME があればそれを返し、FAKE_BRANCH_FAIL なら失敗する。なければ命名規則の行をそのまま返す
  if (opt('--output-format') === 'text') {
    let all = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) all += chunk;
    if (process.env.FAKE_BRANCH_FAIL) {
      process.stderr.write('boom\n');
      process.exit(1);
    }
    const lines = all.split('\n');
    const rule = lines[lines.indexOf('## 命名規則') + 1] || '';
    process.stdout.write(`${process.env.FAKE_BRANCH_NAME || `\`${rule.trim()}\``}\n`);
    process.exit(0);
  }
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
