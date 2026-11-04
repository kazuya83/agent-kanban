// Claude Code 以外のエージェント（Codex / Gemini）と、オーケストレーション（Pipeline・競争）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store, migrateSettings } = require('../src/store');
const { AgentManager, promptWithSkill } = require('../src/agent');
const providers = require('../src/providers');

const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
const FAKE_CLI = path.join(__dirname, 'fake-agent-cli.js');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kanban-orch-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const bin = (name, script, pre = '') => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${script}" ${pre} "$@"\n`, { mode: 0o755 });
    return p;
  };
  const argsLog = path.join(tmp, 'args.log');
  process.env.FAKE_ARGS_LOG = argsLog;
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, {
    repoPath: repo,
    claudePath: bin('claude', FAKE_CLAUDE),
    codexPath: bin('codex', FAKE_CLI, 'codex'),
    geminiPath: bin('gemini', FAKE_CLI, 'gemini'),
    maxParallel: 3,
    enabledAgents: ['claude', 'codex', 'gemini'],
    specCheck: false, // ここでは指示をそのまま渡したときの流れを確かめる（仕様の確認は agent.test.js で確かめる）
  });
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath });
  const calls = () =>
    fs.existsSync(argsLog)
      ? fs.readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
      : [];
  return { tmp, repo, store, agents, g, calls };
}

function waitFor(pred, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = pred();
      if (v) {
        clearInterval(iv);
        resolve(v);
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error('timeout'));
      }
    }, 20);
  });
}

test('providers: 引数（権限モード・モデル・続き）', () => {
  assert.deepStrictEqual(providers.buildArgs('codex', { mode: 'acceptEdits' }), ['exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode=workspace-write', '-']);
  assert.deepStrictEqual(providers.buildArgs('codex', { mode: 'plan', model: 'o3', sessionId: 'abc' }), ['exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode=read-only', '-m', 'o3', 'abc', '-']);
  assert.ok(providers.buildArgs('codex', { mode: 'bypassPermissions' }).includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.deepStrictEqual(providers.buildArgs('gemini', { mode: 'acceptEdits', sessionId: 's1' }), ['--output-format', 'stream-json', '--skip-trust', '--approval-mode', 'auto_edit', '--resume', 's1']);
  assert.strictEqual(providers.geminiApproval('bypassPermissions'), 'yolo');
  assert.strictEqual(providers.geminiApproval('plan'), 'plan');
  assert.deepStrictEqual(providers.cleanCompeteAgents(['codex', 'x', 'codex', 'gemini']), ['codex', 'gemini']);
  assert.deepStrictEqual(providers.cleanRelaySteps([{ agent: 'nope', instruction: 'a' }, { label: '', instruction: '' }]), [{ agent: 'claude', label: '工程1', instruction: 'a' }]);
  // ほかのエージェントにはスキルを「/名前」ではなく SKILL.md の場所で伝える
  assert.strictEqual(promptWithSkill('claude', 'deploy', 'x'), '/deploy x');
  assert.match(promptWithSkill('codex', 'deploy', 'x'), /SKILL\.md[\s\S]*\n\nx$/);
});

test('providers: Gemini の少しずつ届く発言はまとめ、Codex のイベントを共通の形に直す', () => {
  const gp = providers.createParser('gemini');
  assert.deepStrictEqual(gp.onEvent({ type: 'message', role: 'assistant', content: 'a', delta: true }), []);
  gp.onEvent({ type: 'message', role: 'assistant', content: 'b', delta: true });
  const a = gp.onEvent({ type: 'tool_use', tool_name: 'run_shell_command', parameters: { command: 'ls' } });
  assert.deepStrictEqual(a.map((x) => x.type), ['text', 'tool']);
  assert.strictEqual(a[0].text, 'ab');
  assert.deepStrictEqual(gp.onEvent({ type: 'result', status: 'error', error: { message: 'x' } }), [{ type: 'result', error: 'x' }]);
  const cp = providers.createParser('codex');
  assert.deepStrictEqual(cp.onEvent({ type: 'thread.started', thread_id: 't' }), [{ type: 'session', id: 't' }]);
  const r = cp.onEvent({ type: 'item.completed', item: { id: '1', type: 'command_execution', command: 'false', exit_code: 1, aggregated_output: 'no' } });
  assert.deepStrictEqual(r.map((x) => x.type), ['tool', 'tool_result']);
  assert.strictEqual(r[1].error, true);
  assert.deepStrictEqual(cp.onEvent({ type: 'turn.failed', error: { message: 'bad' } }), [{ type: 'result', error: 'bad' }]);
});

test('Codex のタスク: worktree で動いてコミットし、追加指示は同じ会話の続き（resume）', async () => {
  const { agents, calls } = setup();
  const [c] = agents.createTask({ title: 'cx', prompt: 'コーデックスで作って', agent: 'codex' });
  assert.strictEqual(c.agent, 'codex');
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  assert.match(c.sessionId, /^codex-thread-/);
  assert.strictEqual(c.sessions[0].agent, 'codex');
  assert.match(c.lastText, /codex done/);
  assert.ok(c.logs.some((l) => l.kind === 'text' && l.agent === 'codex'));
  assert.ok(c.logs.some((l) => l.kind === 'tool' && /^Bash/.test(l.text)));
  assert.match(await agents.diff(c.id), /コーデックスで作って/);
  // 実行中のメッセージ（btw）は送れない
  const sid = c.sessionId;
  agents.send(c.id, 'もう1つ');
  assert.throws(() => agents.btw(c.id, 'x'), /btw/);
  await waitFor(() => c.status === 'review' && calls().filter((x) => x.kind === 'codex').length === 2);
  const second = calls().filter((x) => x.kind === 'codex')[1].args;
  assert.deepStrictEqual(second.slice(0, 2), ['exec', 'resume']);
  assert.strictEqual(second[second.length - 2], sid);
  // Codex のカードで、Claude Code の会話は選べない
  assert.throws(() => agents.setSession(c.id, { mode: 'resume', id: 'claude-sess' }), /続けられません/);
});

test('Gemini のタスク: 失敗はエラー列に、見つからないとわかりやすいエラー', async () => {
  const { agents, store } = setup();
  const [c] = agents.createTask({ title: 'gm', prompt: '[fail] ジェミニ', agent: 'gemini' });
  agents.start(c.id);
  await waitFor(() => c.status === 'failed');
  assert.strictEqual(c.error, 'gemini boom');
  assert.match(c.sessionId, /^gemini-sess-/);
  assert.ok(c.logs.some((l) => l.kind === 'text' && l.text === 'ファイルを作ります'));

  store.settings.geminiPath = '/nope/gemini';
  const [d] = agents.createTask({ title: 'gm2', prompt: 'x', agent: 'gemini' });
  agents.start(d.id);
  await waitFor(() => d.status === 'failed');
  assert.match(d.error, /gemini コマンドが見つかりません/);
});

test('Pipeline: Codex で実装 → Claude でレビューと、同じ worktree で順番に引き継ぐ', async () => {
  const { agents, store } = setup();
  store.settings.relaySteps = [
    { agent: 'codex', label: '実装', instruction: '実装して' },
    { agent: 'gemini', label: 'テスト', instruction: 'テストして' },
    { agent: 'claude', label: 'レビュー', instruction: 'レビューして' },
  ];
  const [c] = agents.createTask({ title: 'relay', prompt: 'Pipelineのタスク', agent: 'relay' });
  assert.strictEqual(c.agent, 'codex');
  agents.start(c.id);
  const wt = await waitFor(() => c.worktreePath);
  await waitFor(() => c.status === 'review' && c.relay.index === 2);
  assert.strictEqual(c.agent, 'claude');
  assert.strictEqual(c.worktreePath, wt, '同じ worktree のまま');
  assert.deepStrictEqual(c.relay.history.map((h) => h.agent), ['codex', 'gemini']);
  assert.match(c.relay.history[0].report, /codex done/);
  // ワークフロー表示のため、工程ごとの開始・終了の時刻と金額を残す
  for (const h of c.relay.history) {
    assert.ok(h.startedAt && h.at >= h.startedAt, '工程の開始と終了の時刻');
    assert.strictEqual(typeof h.costUsd, 'number');
  }
  assert.ok(c.relay.stepStartedAt >= c.relay.history[1].at, '今の工程の開始時刻');
  // レビュー待ちの通知はPipelineが終わったときの1回だけ
  assert.strictEqual(store.notifications.filter((n) => n.cardId === c.id && n.kind === 'review').length, 1);
  // 3つの工程の変更がすべてブランチに入っている
  const diff = await agents.diff(c.id);
  assert.match(diff, /工程 1\/3「実装」/);
  assert.match(diff, /工程 2\/3「テスト」/);
  assert.match(diff, /codex done/, '前の工程の報告を次の工程に渡す');
  assert.match(diff, /工程 3\/3「レビュー」/);
  assert.match(c.sessionId, /^sess-new-/);
  assert.deepStrictEqual(c.sessions.map((x) => x.agent), ['codex', 'gemini', 'claude']);
  // Pipelineが終わったあとの追加指示は、最後の工程のエージェント（Claude）が続ける
  agents.send(c.id, '追加');
  await waitFor(() => c.status === 'review' && c.logs.filter((l) => l.kind === 'result').length === 4);
  assert.strictEqual(c.relay.index, 2);
});

test('Pipeline: 途中の工程が失敗したら止まり、追加指示で直すと続きの工程へ進む', async () => {
  const { agents, store } = setup();
  store.settings.relaySteps = [
    { agent: 'codex', label: '実装', instruction: '' },
    { agent: 'gemini', label: '仕上げ', instruction: '' },
  ];
  const [c] = agents.createTask({ title: 'relay2', prompt: '[fail] だめ', agent: 'relay' });
  agents.start(c.id);
  await waitFor(() => c.status === 'failed');
  assert.strictEqual(c.relay.index, 0);
  assert.strictEqual(c.agent, 'codex');
  agents.send(c.id, 'もう一度');
  await waitFor(() => c.status === 'review' && c.relay.index === 1);
  assert.strictEqual(c.agent, 'gemini');
});

test('競争: 同じタスクを複数のエージェントで並列に解き、比べて1つを採用する', async () => {
  const { agents, store, g } = setup();
  store.settings.orchestration = 'compete';
  store.settings.competeAgents = ['claude', 'codex', 'gemini'];
  const cards = agents.createTask({ title: 'race', prompt: '競争のタスク', agent: 'compete' });
  assert.deepStrictEqual(cards.map((c) => c.agent), ['claude', 'codex', 'gemini']);
  assert.deepStrictEqual(cards.map((c) => c.title), ['race [Claude]', 'race [Codex]', 'race [Gemini]']);
  for (const c of cards) agents.start(c.id);
  await waitFor(() => cards.every((c) => c.status === 'review'));
  assert.strictEqual(new Set(cards.map((c) => c.worktreePath)).size, 3, 'それぞれ別の worktree');
  assert.strictEqual(new Set(cards.map((c) => c.branch)).size, 3);
  // 全員が終わったら一度だけ知らせる
  await waitFor(() => store.notifications.some((n) => /競争の結果がそろいました/.test(n.title)));
  assert.strictEqual(store.notifications.filter((n) => /競争の結果がそろいました/.test(n.title)).length, 1);
  assert.strictEqual(agents.competitors(cards[1].id).length, 3);

  // Claude に比べてもらう会話（候補のブランチを渡す）
  const chat = agents.compareCompetitors(cards[0].id);
  assert.strictEqual(chat.kind, 'chat');
  for (const c of cards) assert.ok(chat.prompt.includes(c.branch));
  await waitFor(() => chat.status === 'review');

  // Codex の案を採用 → ほかは worktree とブランチごと破棄
  const [cl, cx, gm] = cards;
  const removed = await agents.adoptCompetitor(cx.id);
  assert.strictEqual(removed, 2);
  assert.strictEqual(store.card(cl.id), undefined);
  assert.strictEqual(store.card(gm.id), undefined);
  assert.ok(!fs.existsSync(cl.worktreePath));
  assert.ok(!g('branch').toString().includes(gm.branch));
  assert.strictEqual(cx.compete.adopted, true);
  await agents.merge(cx.id);
  assert.strictEqual(cx.status, 'done');
});

test('競争: エージェントが2つ未満ならエラー。Issue からも競争で作れる', async () => {
  const { agents, store } = setup();
  store.settings.orchestration = 'compete';
  store.settings.competeAgents = ['codex'];
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete' }), /2つ以上/);
  store.settings.competeAgents = ['codex', 'gemini'];
  agents.fetchIssue = async (_r, n) => ({ number: n, title: `Issue ${n}`, body: 'body', url: `https://github.com/o/r/issues/${n}`, state: 'open', labels: [], comments: [] });
  const { cards } = await agents.createFromIssues({ numbers: '5', agent: 'compete' });
  assert.deepStrictEqual(cards.map((c) => c.agent), ['codex', 'gemini']);
  assert.ok(cards.every((c) => c.issue.number === 5));
});

test('使うエージェント: チェックを付けていないエージェントでは、タスク・会話・Pipeline・競争を作れない', async () => {
  const { agents, store } = setup();
  store.settings.enabledAgents = ['claude', 'codex'];
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'gemini' }), /使わない設定/);
  assert.throws(() => agents.createChat({ message: 'x', agent: 'gemini' }), /使わない設定/);
  store.settings.relaySteps = [
    { agent: 'codex', label: '実装', instruction: '' },
    { agent: 'gemini', label: 'テスト', instruction: '' },
  ];
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'relay' }), /工程「テスト」の Gemini CLI は使わない設定/);
  // 競争は使うエージェントだけで（2つ未満ならエラー）
  store.settings.orchestration = 'compete';
  store.settings.competeAgents = ['claude', 'codex', 'gemini'];
  assert.deepStrictEqual(agents.createTask({ prompt: 'x', agent: 'compete' }).map((c) => c.agent), ['claude', 'codex']);
  store.settings.enabledAgents = ['codex'];
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete' }), /2つ以上/);
  // エージェントを指定しなければ、最初から選んでおくエージェント（使わない設定なら、使うものの先頭）
  store.settings.defaultAgent = 'claude';
  assert.strictEqual(agents.createTask({ prompt: 'y' })[0].agent, 'codex');
  assert.strictEqual(agents.createChat({ message: 'y' }).agent, 'codex');
});

test('Pipelineと競争は排他: 設定で選んだ方だけ使え、もう片方ではタスクを作れない', async () => {
  const { agents, store } = setup();
  store.settings.relaySteps = [{ agent: 'codex', label: '実装', instruction: '' }];
  store.settings.competeAgents = ['claude', 'codex'];
  // 初期値はPipeline
  assert.strictEqual(store.settings.orchestration, 'relay');
  assert.strictEqual(agents.createTask({ prompt: 'x', agent: 'relay' }).length, 1);
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete' }), /競争は使わない設定/);
  // 競争に切り替えると、Pipelineは使えない
  store.settings.orchestration = 'compete';
  assert.strictEqual(agents.createTask({ prompt: 'x', agent: 'compete' }).length, 2);
  assert.throws(() => agents.createTask({ prompt: 'x', agent: 'relay' }), /Pipelineは使わない設定/);
  // 1つのエージェントのタスクは、どちらを選んでいても作れる
  assert.strictEqual(agents.createTask({ prompt: 'x', agent: 'claude' })[0].agent, 'claude');
  // 知らない値はPipelineに直す
  const s1 = { orchestration: 'both', enabledAgents: ['claude'] };
  migrateSettings(s1, s1, []);
  assert.strictEqual(s1.orchestration, 'relay');
  assert.strictEqual(providers.cleanOrchestration('compete'), 'compete');
});

test('使うエージェント: 前のバージョンの設定は、使っていたエージェントにチェックを付け、最初のエージェントからPipeline・競争を外す', () => {
  const s1 = { defaultAgent: 'relay', relaySteps: [{ agent: 'codex', label: 'a', instruction: '' }], competeAgents: ['claude', 'gemini'] };
  migrateSettings(s1, { defaultAgent: 'relay' }, []);
  assert.deepStrictEqual(s1.enabledAgents, ['claude', 'codex']);
  assert.strictEqual(s1.defaultAgent, 'claude');
  const s2 = { defaultAgent: 'gemini', relaySteps: [], competeAgents: [] };
  migrateSettings(s2, { defaultAgent: 'gemini' }, [{ agent: 'codex' }]);
  assert.deepStrictEqual(s2.enabledAgents, ['claude', 'codex', 'gemini']);
  assert.strictEqual(s2.defaultAgent, 'gemini');
  // 保存してある「使うエージェント」はそのまま。最初のエージェントが使わない設定なら、使うものの先頭
  const s3 = { defaultAgent: 'claude', enabledAgents: ['gemini'] };
  migrateSettings(s3, { enabledAgents: ['gemini'] }, []);
  assert.deepStrictEqual(s3.enabledAgents, ['gemini']);
  assert.strictEqual(s3.defaultAgent, 'gemini');
  assert.deepStrictEqual(providers.cleanEnabledAgents([]), ['claude'], '1つもなければ Claude Code');
});

test('Claude 以外でも: 会話・ブランチの命名・競争の比較・スキルの提案ができる', async () => {
  const { agents, store, g } = setup();
  store.settings.defaultAgent = 'codex';
  // 会話
  const chat = agents.createChat({ message: '構成を教えて' });
  assert.strictEqual(chat.agent, 'codex');
  await waitFor(() => chat.status === 'review');
  assert.match(chat.lastText, /codex done: 構成を教えて/);
  // ブランチの命名規則（Gemini のタスクなら Gemini に聞く）
  store.settings.branchNamingRule = 'feature/<内容> にする';
  const [c] = agents.createTask({ title: 'gm', prompt: 'ジェミニで作る', agent: 'gemini' });
  agents.start(c.id);
  await waitFor(() => c.status === 'review');
  assert.strictEqual(c.branch, 'feature/fake-gemini-branch');
  const [d] = agents.createTask({ title: 'cx', prompt: 'コーデックスで作る', agent: 'codex' });
  agents.start(d.id);
  await waitFor(() => d.status === 'review');
  assert.strictEqual(d.branch, 'feature/fake-codex-branch');
  assert.ok(g('branch').toString().includes('feature/fake-codex-branch'));
  store.settings.branchNamingRule = '';
  // 競争の比較は、最初から選んでおくエージェントに頼む
  store.settings.orchestration = 'compete';
  store.settings.competeAgents = ['codex', 'gemini'];
  const cards = agents.createTask({ title: 'race', prompt: '競争', agent: 'compete' });
  for (const x of cards) agents.start(x.id);
  await waitFor(() => cards.every((x) => x.status === 'review'));
  const cmp = agents.compareCompetitors(cards[0].id);
  assert.strictEqual(cmp.agent, 'codex');
  await waitFor(() => cmp.status === 'review');
  // スキルの提案は、元のタスクのエージェントに頼む
  const sk = agents.suggestSkills(c.id);
  assert.strictEqual(sk.agent, 'gemini');
  await waitFor(() => sk.status === 'review');
});

test('Claude 以外の会話からタスクにすると、会話のやりとりを最初の指示に添えて渡す', async () => {
  const { agents } = setup();
  const chat = agents.createChat({ message: 'ログイン画面の相談', agent: 'codex' });
  await waitFor(() => chat.status === 'review');
  const [t] = agents.createTask({ prompt: '会話の内容で作って', agent: 'gemini', fromChat: chat.id, session: { mode: 'resume', id: chat.sessionId } });
  assert.ok(!t.sessionId, 'Codex の会話のセッションは Gemini には渡さない');
  agents.start(t.id);
  await waitFor(() => t.status === 'review');
  const diff = await agents.diff(t.id);
  assert.match(diff, /これまでの会話/);
  assert.match(diff, /【ユーザー】 ログイン画面の相談/);
  assert.match(diff, /【Codex】 codex done/);
  assert.match(diff, /会話の内容で作って/);
  // Claude Code どうしなら、会話そのもの（セッション）を引き継ぐ
  const cc = agents.createChat({ message: 'claude と相談', agent: 'claude' });
  await waitFor(() => cc.status === 'review');
  const [t2] = agents.createTask({ prompt: '続きを', agent: 'claude', fromChat: cc.id, session: { mode: 'resume', id: cc.sessionId } });
  assert.strictEqual(t2.sessionId, cc.sessionId);
  assert.strictEqual(t2.chatContext, undefined);
});
