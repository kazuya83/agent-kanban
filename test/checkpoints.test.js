// チェックポイント（戻す時点）の判定・切り詰め・会話ファイル
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Checkpoints = require('../src/checkpoints');
const sessions = require('../src/sessions');
const I18n = require('../renderer/i18n');

function card(extra) {
  return {
    status: 'review',
    worktreePath: '/tmp/wt',
    branch: 'agent/x',
    ...extra,
  };
}

test('blockReason: 戻せない条件はすべて理由を返し、レビューと失敗は返す', () => {
  assert.strictEqual(Checkpoints.blockReason(card()), null);
  assert.strictEqual(Checkpoints.blockReason(card({ status: 'failed' })), null);
  assert.match(Checkpoints.blockReason(card({ status: 'running' })), /実行中/);
  assert.match(Checkpoints.blockReason(card({ status: 'queued' })), /実行中/);
  assert.match(Checkpoints.blockReason(card({ status: 'done' })), /完了したタスク/);
  assert.match(Checkpoints.blockReason(card({ status: 'todo' })), /開始していない/);
  assert.match(Checkpoints.blockReason(card({ status: 'elsewhere' })), /レビュー中か失敗/);
  assert.match(Checkpoints.blockReason(card({ relay: { waiting: { children: [] } } })), /並列の枝/);
  assert.match(Checkpoints.blockReason(card({ conflict: { target: 'main' } })), /コンフリクト/);
  assert.strictEqual(Checkpoints.blockReason(card({ subtasks: { phase: 'plan', items: [{}] } })), null);
  assert.match(Checkpoints.blockReason(card({ subtasks: { phase: 'run' } })), /サブタスク/);
  assert.match(Checkpoints.blockReason(card({ subtasks: { phase: 'done' } })), /サブタスク/);
  assert.strictEqual(Checkpoints.blockReason(card({ mergedInto: [] })), null);
  assert.match(Checkpoints.blockReason(card({ mergedInto: ['main'] })), /マージ済み/);
  assert.match(Checkpoints.blockReason(card({ mergedAt: 1 })), /マージ済み/);
  assert.match(Checkpoints.blockReason(card({ noGit: true })), /git で管理していない/);
  // 読み取り専用は git のリポジトリでも noGit が立つ。worktree が無いので、その理由にする
  const readOnly = Checkpoints.blockReason(card({ noGit: true, readOnly: true, worktreePath: null }));
  assert.match(readOnly, /worktree がありません/);
  assert.doesNotMatch(readOnly, /git で管理していない/);
  assert.match(Checkpoints.blockReason(card({ kind: 'chat', worktreePath: null })), /worktree がありません/);
  assert.match(Checkpoints.blockReason(card({ worktreePath: null })), /worktree がありません/);
  assert.match(Checkpoints.blockReason(card({ worktreePath: '' })), /worktree がありません/);
  assert.match(Checkpoints.blockReason(card(), { worktreeMissing: true }), /worktree がありません/);
  assert.strictEqual(Checkpoints.blockReason(card({ prUrl: '' })), null);
  assert.match(Checkpoints.blockReason(card({ prUrl: 'https://github.com/o/r/pull/1' })), /PR がある/);
  assert.match(Checkpoints.blockReason(card(), { parentMerged: true }), /すでにマージした/);
  assert.match(Checkpoints.blockReason(card(), { rewinding: true }), /戻しているところです/);
  // 戻している最中は、ほかの理由より先にそのことを返す
  assert.match(Checkpoints.blockReason(card({ status: 'running' }), { rewinding: true }), /戻しているところです/);
});

test('trim: 古い順のまま最大100件。create は知らない項目を持たない', () => {
  const list = [];
  for (let i = 1; i <= Checkpoints.MAX_CHECKPOINTS + 1; i++) list.push(Checkpoints.create({ id: `c${i}`, seq: i, at: i, prompt: `p${i}` }));
  const trimmed = Checkpoints.trim(list);
  assert.strictEqual(trimmed.length, 100);
  assert.strictEqual(trimmed[0].id, 'c2');
  assert.strictEqual(trimmed[trimmed.length - 1].id, `c${Checkpoints.MAX_CHECKPOINTS + 1}`);
  assert.deepStrictEqual(Checkpoints.trim(null), []);
  assert.deepStrictEqual(Checkpoints.trim(list.slice(0, 3)).map((x) => x.seq), [1, 2, 3]);

  const cp = Checkpoints.create({ seq: 4, prompt: '指示', extra: '漏れる', commit: '', session: null, forkNext: 1, persona: { name: 'A' }, attachments: [{ path: 'a' }] });
  assert.strictEqual(cp.extra, undefined);
  assert.strictEqual(cp.commit, null);
  assert.strictEqual(cp.forkNext, true);
  assert.deepStrictEqual(cp.persona, { name: 'A' });
  const atts = [{ path: 'a' }];
  const copied = Checkpoints.create({ attachments: atts });
  assert.deepStrictEqual(copied.attachments, atts);
  assert.notStrictEqual(copied.attachments, atts);
  assert.match(cp.id, /^[0-9a-f]{8}$/);
});

test('stepStart と relay の復元', () => {
  const plain = { checkpoints: [] };
  assert.strictEqual(Checkpoints.stepStart(plain), true);
  plain.checkpoints.push({ relay: null });
  assert.strictEqual(Checkpoints.stepStart(plain), false);

  const relayCard = { relay: { index: 0 }, checkpoints: [] };
  assert.strictEqual(Checkpoints.stepStart(relayCard), true);
  relayCard.checkpoints.push({ relay: { index: 0 } });
  assert.strictEqual(Checkpoints.stepStart(relayCard), false);
  relayCard.relay.index = 1;
  assert.strictEqual(Checkpoints.stepStart(relayCard), true);
  relayCard.checkpoints.push({ relay: { index: 1 } });
  assert.strictEqual(Checkpoints.stepStart(relayCard), false);
  relayCard.relay.index = 0;
  assert.strictEqual(Checkpoints.stepStart(relayCard), true, 'ループで同じ工程に戻ったら、その回の最初');

  const relay = {
    index: 3,
    counts: { e9: 2 },
    history: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 0 }],
    stepCostStart: 1.5,
    lastResult: 'fail',
    done: true,
    limitReached: true,
    atJoin: true,
    stepStartedAt: 9,
    flow: { keep: true },
  };
  const snap = Checkpoints.relaySnapshot(relay);
  relay.counts.e9 = 9;
  assert.deepStrictEqual(snap.counts, { e9: 2 }, '記録した回数は、その後の変更で変わらない');
  relay.index = 3;
  relay.history = snap && [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 0 }, { index: 1 }];
  relay.done = true;
  relay.limitReached = true;
  relay.atJoin = true;
  relay.stepStartedAt = 9;
  relay.lastResult = 'pass';
  relay.stepCostStart = 8;
  Checkpoints.applyRelay(relay, { index: 0, counts: { e9: 1 }, historyLen: 2, stepCostStart: 0.25, lastResult: null });
  assert.strictEqual(relay.index, 0);
  assert.deepStrictEqual(relay.counts, { e9: 1 });
  assert.deepStrictEqual(relay.history, [{ index: 0 }, { index: 1 }]);
  assert.strictEqual(relay.stepCostStart, 0.25);
  assert.strictEqual(relay.lastResult, undefined);
  assert.strictEqual(relay.done, undefined);
  assert.strictEqual(relay.limitReached, undefined);
  assert.strictEqual(relay.atJoin, undefined);
  assert.strictEqual(relay.stepStartedAt, undefined);
  assert.deepStrictEqual(relay.flow, { keep: true }, 'フロー自体は残す');
  assert.strictEqual(Checkpoints.relaySnapshot(null), null);
  assert.strictEqual(Checkpoints.labelFor({ relay: { index: 0, steps: [{ label: '実装' }] } }, '長い指示'), '実装');
  assert.strictEqual(Checkpoints.labelFor({}, '1行目\n2行目'), '1行目');
});

test('publicView: prompt も commit も渡さない', () => {
  const secret = `${'a'.repeat(40)}SECRET-PROMPT-TAIL`;
  const c = card({
    checkpoints: [
      Checkpoints.create({ id: 'a', seq: 1, at: 10, prompt: secret, label: '実装', commit: 'b'.repeat(40), agent: 'codex', stepStart: true, relay: { index: 0 }, session: { id: 's', size: 3 } }),
      Checkpoints.create({ id: 'b', seq: 2, at: 20, prompt: secret, label: '続き', agent: 'claude', stepStart: false }),
    ],
  });
  const view = Checkpoints.publicView(c);
  assert.strictEqual(view.blocked, null);
  assert.deepStrictEqual(view.points, [
    { id: 'a', at: 10, seq: 1, label: '実装', stepIndex: 0, stepStart: true, agent: 'codex' },
    { id: 'b', at: 20, seq: 2, label: '続き', stepIndex: null, stepStart: false, agent: 'claude' },
  ]);
  const json = JSON.stringify(view);
  assert.ok(!json.includes('SECRET-PROMPT-TAIL'));
  assert.ok(!json.includes('prompt'));
  assert.ok(!json.includes('commit'));
  assert.ok(!json.includes('"session"'));
  assert.match(Checkpoints.publicView(card({ status: 'running', checkpoints: c.checkpoints })).blocked, /実行中/);
});

test('shouldRecord: 完了後・コンフリクト解消・git なしは記録しない。読み取り専用は記録する', () => {
  assert.strictEqual(Checkpoints.shouldRecord({ status: 'review' }), true);
  assert.strictEqual(Checkpoints.shouldRecord({ afterDone: true }), false);
  assert.strictEqual(Checkpoints.shouldRecord({ conflict: { resolving: true } }), false);
  assert.strictEqual(Checkpoints.shouldRecord({ conflict: { resolving: false } }), true);
  assert.strictEqual(Checkpoints.shouldRecord({ noGit: true }), false);
  assert.strictEqual(Checkpoints.shouldRecord({ noGit: true, readOnly: true }), true);
  assert.strictEqual(Checkpoints.shouldRecord(null), false);
});

test('handoffText: 指示と返事だけ、時点より前、8000字まで', () => {
  const logs = [
    { t: 1, kind: 'user', text: '最初の指示' },
    { t: 2, kind: 'system', text: 'システムは入れない' },
    { t: 3, kind: 'text', text: '最初の返事' },
    { t: 4, kind: 'tool', text: 'Bash ls' },
    { t: 5, kind: 'user', text: '次の指示' },
    { t: 6, kind: 'text', text: '   ' },
  ];
  const text = Checkpoints.handoffText(logs, { before: 5 });
  assert.match(text, /【ユーザー】 最初の指示/);
  assert.match(text, /【エージェント】 最初の返事/);
  assert.doesNotMatch(text, /次の指示/);
  assert.doesNotMatch(text, /システムは入れない/);
  assert.doesNotMatch(text, /Bash/);
  assert.strictEqual(Checkpoints.handoffText(logs, { before: 1 }), '');
  assert.strictEqual(Checkpoints.handoffText([]), '');

  const long = [];
  for (let i = 0; i < 50; i++) long.push({ t: i, kind: i % 2 ? 'text' : 'user', text: `行${i}-${'x'.repeat(300)}` });
  const big = Checkpoints.handoffText(long);
  assert.ok(big.length <= Checkpoints.HANDOFF_LIMIT);
  assert.match(big, /行49-/);
  assert.doesNotMatch(big, /行0-/);
  const exact = Checkpoints.handoffText([{ t: 1, kind: 'user', text: 'あ' }], { max: 8000 });
  assert.ok(exact.length <= 8000);
  assert.match(exact, /【ユーザー】 あ/);
  assert.ok(exact.startsWith('## ここまでのやりとり\n'));

  // 今から送り直す指示は引き継ぎ文に入れない。長い指示が 8,000 字を先に使わない
  const huge = '送'.repeat(9000);
  const again = [
    { t: 1, kind: 'user', text: '残したい指示' },
    { t: 2, kind: 'text', text: '残したい返事' },
    { t: 3, kind: 'user', text: huge },
  ];
  const kept = Checkpoints.handoffText(again, { before: 4, omitLatestUser: true });
  assert.ok(kept.startsWith('## ここまでのやりとり\n'));
  assert.match(kept, /残したい指示/);
  assert.match(kept, /残したい返事/);
  assert.doesNotMatch(kept, /送送送/);
  const eaten = Checkpoints.handoffText(again, { before: 4 });
  assert.match(eaten, /送送送/);
  assert.doesNotMatch(eaten, /残したい指示/);
});

test('handoffText: 上限ぎりぎりでも見出しを残す', () => {
  const head = '## ここまでのやりとり\n';
  const max = Checkpoints.HANDOFF_LIMIT;
  const prefix = '【ユーザー】 ';
  const room = max - head.length - 2;
  const body = 'あ'.repeat(room - prefix.length);
  const filled = Checkpoints.handoffText([{ t: 1, kind: 'user', text: body }], { max });
  assert.strictEqual(filled.length, max);
  assert.ok(filled.startsWith(head));
  assert.ok(filled.endsWith('\n\n'));
  assert.ok(filled.includes(body));

  // 以前の予算（見出しだけ引いて末尾の空行を入れない）だと、ぴったりで見出しの先頭が切れた
  const older = '古'.repeat(40);
  const olderLine = prefix.length + older.length;
  const newerLen = max - head.length - olderLine - 1;
  const newer = '新'.repeat(newerLen - prefix.length);
  const tight = Checkpoints.handoffText(
    [
      { t: 1, kind: 'user', text: older },
      { t: 2, kind: 'user', text: newer },
    ],
    { max },
  );
  assert.ok(tight.startsWith(head));
  assert.ok(tight.length <= max);
  assert.ok(tight.endsWith('\n\n'));
  assert.match(tight, /【ユーザー】 新/);
  assert.doesNotMatch(tight, /古古古/);

  const over = Checkpoints.handoffText([{ t: 1, kind: 'user', text: `${body}あ` }], { max });
  assert.strictEqual(over.length, max);
  assert.ok(over.startsWith(head));
  assert.ok(over.endsWith('\n\n'));
});

test('会話ファイル: 改行の位置で切り詰め、小さい・行の途中・不正な ID は変えない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-sess-'));
  const configDir = path.join(dir, 'claude');
  const proj = path.join(configDir, 'projects', 'repo');
  fs.mkdirSync(proj, { recursive: true });
  const id = 'sessABC_01';
  const file = path.join(proj, `${id}.jsonl`);
  const body = '{"a":1}\n{"b":2}\n';
  fs.writeFileSync(file, `${body}{"c":3}\n`);
  const size = Buffer.byteLength(body);
  assert.strictEqual(sessions.sessionSize(id, { configDir }), Buffer.byteLength(`${body}{"c":3}\n`));
  assert.strictEqual(sessions.sessionSize(id), null, 'configDir を渡さないときは、そこを見ない');

  assert.strictEqual(sessions.truncateSession(id, size, { configDir }), true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  assert.strictEqual(sessions.sessionSize(id, { configDir }), size);
  // ちょうどその大きさ（直前が改行）なら、そのままで成功
  assert.strictEqual(sessions.truncateSession(id, size, { configDir }), true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);

  const mid = size - 3;
  assert.notStrictEqual(body[mid - 1], '\n');
  assert.strictEqual(sessions.truncateSession(id, mid, { configDir }), false);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body, '行の途中では切らない');

  assert.strictEqual(sessions.truncateSession(id, size + 10, { configDir }), false, 'ファイルより大きい');
  assert.strictEqual(sessions.truncateSession(id, 0, { configDir }), false);
  assert.strictEqual(sessions.truncateSession(id, -1, { configDir }), false);
  assert.strictEqual(sessions.truncateSession(id, 1.5, { configDir }), false);
  for (const bad of ['../sess', 'a/b', '', '.hidden', 'sess ABC', null]) {
    assert.strictEqual(sessions.truncateSession(bad, size, { configDir }), false);
    assert.strictEqual(sessions.sessionSize(bad, { configDir }), null);
  }
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  assert.strictEqual(sessions.truncateSession('missingID1', 1, { configDir }), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('会話ファイル: 切り詰めるとき、その時点よりあとの付属記録だけ消す', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-sess-side-'));
  const configDir = path.join(dir, 'claude');
  const proj = path.join(configDir, 'projects', 'repo');
  const id = 'sessSide01';
  const side = path.join(proj, id);
  fs.mkdirSync(path.join(side, 'tool-results'), { recursive: true });
  fs.mkdirSync(path.join(side, 'subagents'), { recursive: true });
  const keepId = 'toolu_KEEPKEEP1';
  const dropId = 'toolu_DROPDROP1';
  const bothId = 'toolu_BOTHBOTH1';
  const agentId = 'abc123def4567890';
  const body = `{"id":"${keepId}"}\n{"id":"${bothId}"}\n`;
  const tail = `{"id":"${dropId}","agentId":"${agentId}","also":"${bothId}"}\n`;
  const file = path.join(proj, `${id}.jsonl`);
  fs.writeFileSync(file, body + tail);
  const keepFile = path.join(side, 'tool-results', `${keepId}.txt`);
  const dropFile = path.join(side, 'tool-results', `${dropId}.txt`);
  const bothFile = path.join(side, 'tool-results', `${bothId}.txt`);
  const agentFile = path.join(side, 'subagents', `agent-${agentId}.jsonl`);
  const agentMeta = path.join(side, 'subagents', `agent-${agentId}.meta.json`);
  const tip = path.join(side, 'ccr-tip.json');
  fs.writeFileSync(keepFile, 'keep');
  fs.writeFileSync(dropFile, 'drop');
  fs.writeFileSync(bothFile, 'both');
  fs.writeFileSync(agentFile, 'agent');
  fs.writeFileSync(agentMeta, '{}');
  fs.writeFileSync(tip, '{}');

  const mid = Buffer.byteLength(body) - 3;
  assert.strictEqual(sessions.truncateSession(id, mid, { configDir }), false);
  assert.ok(fs.existsSync(dropFile), '切り詰めないときは付属記録も残す');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body + tail);

  const size = Buffer.byteLength(body);
  assert.strictEqual(sessions.truncateSession(id, size, { configDir }), true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
  assert.ok(fs.existsSync(keepFile), '時点より前のツール出力は残す');
  assert.ok(fs.existsSync(bothFile), '前後の両方にあるものは残す');
  assert.ok(fs.existsSync(tip), '会話が参照しない付属ファイルは残す');
  assert.ok(!fs.existsSync(dropFile), '時点よりあとだけのツール出力は消す');
  assert.ok(!fs.existsSync(agentFile), '時点よりあとのサブエージェントの記録は消す');
  assert.ok(!fs.existsSync(agentMeta));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('戻す機能の表示文は4言語にあり、差し込みが一致する', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const keysOf = (src) => {
    const keys = [];
    const re = /\btr\(\s*'((?:\\'|[^'])*)'/g;
    let m;
    while ((m = re.exec(src))) keys.push(m[1].replace(/\\'/g, "'"));
    return keys;
  };
  const keys = [
    ...keysOf(read('src/checkpoints.js')),
    ...keysOf(read('src/agent.js')).filter((k) => k.includes('戻')),
    ...keysOf(read('src/git.js')).filter((k) => k.includes('コミットの指定')),
  ];
  assert.ok(keys.includes('戻しているところです'));
  assert.ok(keys.includes('コミットの指定が正しくありません'));
  const prev = I18n.getLanguage();
  try {
    for (const key of keys) {
      for (const lang of ['en', 'es', 'fr', 'zh']) {
        assert.strictEqual(I18n.has(key, lang), true, `${lang} ${key}`);
        I18n.setLanguage(lang);
        const vars = {};
        for (const name of key.match(/\{(\w+)\}/g) || []) vars[name.slice(1, -1)] = 'X';
        const s = I18n.tr(key, vars);
        for (const name of Object.keys(vars)) assert.ok(!s.includes(`{${name}}`), `${lang} ${key}`);
      }
    }
  } finally {
    I18n.setLanguage(prev);
  }
});
