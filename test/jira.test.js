// Jira 連携: キーと URL の解釈、ADF、認証、トランジション、コメント、サブタスク（fetch はモック）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const trackers = require('../src/trackers');
const jira = require('../src/trackers/jira');
const { adfToText, textToAdf } = require('../src/trackers/adf');
const { buildIssuePrompt } = require('../src/trackers/prompt');
const IssueRef = require('../renderer/issue-ref');
const I18n = require('../renderer/i18n');
const { Store } = require('../src/store');
const { AgentManager } = require('../src/agent');

const TOKEN = 'sekret-token-value';
const EMAIL = 'me@example.com';
const BASIC = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const CLOUD = { deployment: 'cloud', baseUrl: 'https://acme.atlassian.net', email: EMAIL };
const DC = { deployment: 'datacenter', baseUrl: 'https://jira.example.com/jira', email: '' };

const ctxOf = (config, settings = {}, token = TOKEN) => ({ provider: 'jira', repoPath: '', config, settings, secret: () => token });

// routes: 'GET rest/api/3/myself' の形のキー → 応答（関数なら呼び出しを受け取る）。無いものは 404
function mockFetch(t, routes) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = new URL(url);
    const call = { method: opts.method, path: u.pathname.replace(/^\/+/, ''), query: Object.fromEntries(u.searchParams), auth: opts.headers.Authorization, json: opts.body ? JSON.parse(opts.body) : undefined };
    calls.push(call);
    const hit = routes[`${call.method} ${call.path}`];
    const r = typeof hit === 'function' ? hit(call) : hit;
    if (r === undefined) return new Response('{"errorMessages":["not found"]}', { status: 404 });
    if (r instanceof Response) return r;
    return new Response(r === null ? null : JSON.stringify(r), { status: r === null ? 204 : 200 });
  });
  return calls;
}

// ---------- キーと URL ----------

test('登録されていて、課題管理サービスの機能がそろっている', () => {
  const p = trackers.get('jira');
  assert.strictEqual(p, jira);
  const meta = trackers.issueProviderMeta().find((x) => x.id === 'jira');
  assert.deepStrictEqual({ ...meta, refPlaceholder: '' }, { id: 'jira', label: 'Jira', refPlaceholder: '', canSync: true, canSubIssue: true, canComment: true, canMapStatus: true });
  const github = trackers.issueProviderMeta().find((x) => x.id === 'github');
  assert.strictEqual(github.canComment, false);
  assert.strictEqual(github.canMapStatus, false);
});

test('キーを読む: 大文字にそろえ、区切りはスペース・カンマ・読点', () => {
  assert.deepStrictEqual(jira.parseRefs(ctxOf(CLOUD), 'ABC-123, abc-124、X_Y2-7'), [{ key: 'ABC-123' }, { key: 'ABC-124' }, { key: 'X_Y2-7' }]);
  for (const bad of ['123', '#12', 'ABC', 'ABC-', '-12', 'ABC-0', 'ABC-1/../x', 'ftp://acme.atlassian.net/browse/ABC-1']) assert.throws(() => jira.parseRefs(ctxOf(CLOUD), bad), /読めません/, bad);
  assert.throws(() => jira.parseRefs(ctxOf(CLOUD), '  '), /入力してください/);
});

test('URL を読む: browse・プロジェクトの画面・ボードの selectedIssue', () => {
  const urls = [
    'https://acme.atlassian.net/browse/ABC-123',
    'https://acme.atlassian.net/browse/abc-123/',
    'https://acme.atlassian.net/browse/ABC-123?focusedCommentId=9',
    'https://acme.atlassian.net/jira/software/c/projects/ABC/issues/ABC-123',
    'https://acme.atlassian.net/jira/software/projects/XYZ/boards/1?selectedIssue=ABC-123',
  ];
  for (const u of urls) assert.deepStrictEqual(jira.parseRefs(ctxOf(CLOUD), u), [{ key: 'ABC-123' }], u);
  assert.deepStrictEqual(jira.parseRefs(ctxOf(DC), 'https://jira.example.com/jira/browse/OPS-9'), [{ key: 'OPS-9' }]);
});

test('URL を読む: 接続先と違う URL は受け付けない', () => {
  assert.throws(() => jira.parseRefs(ctxOf(CLOUD), 'https://evil.example.com/browse/ABC-1'), /接続先の URL ではありません/);
  assert.throws(() => jira.parseRefs(ctxOf(DC), 'https://jira.example.com/other/browse/ABC-1'), /接続先の URL ではありません/);
  assert.throws(() => jira.parseRefs(ctxOf(DC), 'https://jira.example.com/jiraX/browse/ABC-1'), /接続先の URL ではありません/);
  assert.throws(() => jira.parseRefs(ctxOf({ deployment: 'cloud', baseUrl: '' }), 'https://acme.atlassian.net/browse/ABC-1'), /接続先の URL を設定/);
  assert.throws(() => jira.parseRefs(ctxOf(CLOUD), 'https://acme.atlassian.net/secure/Dashboard.jspa'), /読めません/);
});

test('ブランチ名とカードの issue に Jira のキーが入る', () => {
  const issue = IssueRef.cleanIssue({ provider: 'jira', key: 'ABC-123', title: 't', url: 'https://acme.atlassian.net/browse/ABC-123' });
  assert.strictEqual(IssueRef.branchPart(issue), 'abc-123');
  assert.strictEqual(IssueRef.linkLine(issue), 'ABC-123 https://acme.atlassian.net/browse/ABC-123');
  assert.strictEqual(IssueRef.stripKey('ABC-123 t', issue), 't');
});

// ---------- ADF ----------

test('ADF をプレーンテキストにする', () => {
  const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
  const p = (...content) => ({ type: 'paragraph', content });
  const doc = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [t('見出し')] },
      p(t('太字', [{ type: 'strong' }]), t(' と '), t('リンク', [{ type: 'link', attrs: { href: 'https://a.example' } }]), t(' と '), t('x()', [{ type: 'code' }])),
      p(t('1行目'), { type: 'hardBreak' }, t('2行目'), { type: 'mention', attrs: { id: 'u1', text: '@山田' } }, { type: 'emoji', attrs: { shortName: ':ok:', text: '👌' } }, { type: 'status', attrs: { text: 'DONE' } }, { type: 'date', attrs: { timestamp: '1700000000000' } }, { type: 'inlineCard', attrs: { url: 'https://b.example' } }),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('a')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('a-1'))] }] }] }, { type: 'listItem', content: [p(t('b'))] }] },
      { type: 'orderedList', attrs: { order: 3 }, content: [{ type: 'listItem', content: [p(t('三'))] }, { type: 'listItem', content: [p(t('四'))] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [t('済')] }, { type: 'taskItem', attrs: { state: 'TODO' }, content: [t('未')] }] },
      { type: 'blockquote', content: [p(t('引用'))] },
      { type: 'codeBlock', attrs: { language: 'js' }, content: [t('let a;\nlet b;')] },
      { type: 'rule' },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('h1'))] }, { type: 'tableCell', content: [p(t('h2'))] }] }] },
      { type: 'panel', attrs: { panelType: 'info' }, content: [p(t('パネル'))] },
      { type: 'expand', attrs: { title: '詳細' }, content: [p(t('中身'))] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { alt: 'a.png' } }] },
      { type: 'futureBlock', content: [p(t('未知の中'))] },
    ],
  };
  assert.strictEqual(adfToText(doc), [
    '## 見出し',
    '太字 と リンク (https://a.example) と `x()`',
    '1行目\n2行目@山田👌DONE2023-11-14https://b.example',
    '- a\n  - a-1\n- b',
    '3. 三\n4. 四',
    '- [x] 済\n- [ ] 未',
    '> 引用',
    '```js\nlet a;\nlet b;\n```',
    '---',
    'h1 | h2',
    'パネル',
    '詳細\n中身',
    '[添付: a.png]',
    '未知の中',
  ].join('\n\n'));
});

test('ADF の変換は壊れた値でも落ちない。文字列はそのまま', () => {
  assert.strictEqual(adfToText('h1. wiki'), 'h1. wiki');
  for (const v of [null, undefined, {}, { type: 'doc' }, { type: 'doc', content: [null, 1, { type: 'paragraph' }] }]) assert.strictEqual(adfToText(v), '');
});

test('テキストを ADF にする: 段落・改行・リンク。空の text を作らない', () => {
  assert.deepStrictEqual(textToAdf('a\nb https://x.example/1。\n\n\nc'), {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b ' }, { type: 'text', text: 'https://x.example/1', marks: [{ type: 'link', attrs: { href: 'https://x.example/1' } }] }, { type: 'text', text: '。' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'c' }] },
    ],
  });
  assert.deepStrictEqual(textToAdf(''), { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [] }] });
  assert.ok(!JSON.stringify(textToAdf('https://a.example\n\n x ')).includes('"text":""'));
  assert.strictEqual(adfToText(textToAdf('前 https://a.example 後\n次')), '前 https://a.example 後\n次');
});

// ---------- 認証と読み込み ----------

const CLOUD_ISSUE = {
  key: 'ABC-1',
  fields: {
    summary: 'ログインできない',
    description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文です' }] }] },
    status: { name: 'To Do', statusCategory: { key: 'new' } },
    labels: ['bug'],
  },
};

test('Cloud: v3 と Basic 認証。ADF の本文とコメントを読み、新しいコメントが後ろに来る', async (t) => {
  const calls = mockFetch(t, {
    'GET rest/api/3/issue/ABC-1': CLOUD_ISSUE,
    'GET rest/api/3/issue/ABC-1/comment': {
      comments: [
        { created: '2026-01-02T00:00:00.000+0000', author: { displayName: '後の人' }, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '新' }] }] } },
        { created: '2026-01-01T00:00:00.000+0000', author: { displayName: '先の人' }, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '古' }] }] } },
      ],
    },
  });
  const issue = await jira.fetchIssue(ctxOf(CLOUD), { key: 'abc-1' });
  assert.deepStrictEqual(issue, {
    key: 'ABC-1',
    title: 'ログインできない',
    body: '本文です',
    url: 'https://acme.atlassian.net/browse/ABC-1',
    state: 'open',
    labels: ['bug'],
    comments: [{ author: '先の人', body: '古' }, { author: '後の人', body: '新' }],
  });
  assert.ok(calls.every((c) => c.auth === `Basic ${BASIC}`));
  const prompt = buildIssuePrompt(issue, '', { label: 'Jira' });
  assert.match(prompt, /^Jira の Issue ABC-1 を解決してください/);
  assert.match(prompt, /本文です[\s\S]*### @先の人[\s\S]*### @後の人/);
});

test('Data Center: v2 と Bearer 認証。本文は文字列のまま、コンテキストパスを保つ', async (t) => {
  const calls = mockFetch(t, {
    'GET jira/rest/api/2/issue/OPS-9': { key: 'OPS-9', fields: { summary: 'S', description: 'h1. wiki の本文', status: { name: 'Done', statusCategory: { key: 'done' } } } },
    'GET jira/rest/api/2/issue/OPS-9/comment': { comments: [{ author: { name: 'jdoe' }, body: 'コメント' }] },
  });
  const issue = await jira.fetchIssue(ctxOf(DC), { key: 'OPS-9' });
  assert.strictEqual(issue.body, 'h1. wiki の本文');
  assert.strictEqual(issue.state, 'closed');
  assert.strictEqual(issue.url, 'https://jira.example.com/jira/browse/OPS-9');
  assert.deepStrictEqual(issue.comments, [{ author: 'jdoe', body: 'コメント' }]);
  assert.ok(calls.every((c) => c.auth === `Bearer ${TOKEN}`));
});

test('設定が足りないときは送らずに分かるエラーにする', async (t) => {
  const calls = mockFetch(t, {});
  await assert.rejects(jira.fetchIssue(ctxOf({ ...CLOUD, baseUrl: '' }), { key: 'A-1' }), /接続先の URL を設定/);
  await assert.rejects(jira.fetchIssue(ctxOf(CLOUD, {}, ''), { key: 'A-1' }), /トークンを設定/);
  await assert.rejects(jira.fetchIssue(ctxOf({ ...CLOUD, email: '' }), { key: 'A-1' }), /メールアドレス/);
  await assert.rejects(jira.fetchIssue(ctxOf(CLOUD), { key: '../../myself' }), /課題キーとして読めません/);
  assert.strictEqual(calls.length, 0);
});

test('接続テスト: 名前を返す。失敗は ok: false で、トークンを含めない', async (t) => {
  mockFetch(t, { 'GET rest/api/3/myself': { displayName: '山田' }, 'GET jira/rest/api/2/myself': new Response(JSON.stringify({ message: `bad ${TOKEN} ${BASIC}` }), { status: 500 }) });
  assert.deepStrictEqual(await jira.testConnection(ctxOf(CLOUD)), { ok: true, message: '山田 として接続できました' });
  const r = await jira.testConnection(ctxOf(DC));
  assert.strictEqual(r.ok, false);
  assert.ok(!r.message.includes(TOKEN));
  const missing = await jira.testConnection(ctxOf(CLOUD, {}, ''));
  assert.strictEqual(missing.ok, false);
  assert.match(missing.message, /トークン/);
});

test('エラーの文にトークンも Basic の値も出ない', async (t) => {
  const leak = `failed for ${TOKEN} and ${BASIC} Authorization: Basic ${BASIC}`;
  mockFetch(t, {
    'GET rest/api/3/issue/A-1': new Response(JSON.stringify({ errorMessages: [leak] }), { status: 500 }),
    'GET rest/api/3/issue/A-1/comment': new Response(JSON.stringify({ errors: { body: leak } }), { status: 500 }),
    'GET rest/api/3/issue/A-1/transitions': new Response(JSON.stringify({ errorMessages: [leak] }), { status: 500 }),
  });
  for (const run of [() => jira.fetchIssue(ctxOf(CLOUD), { key: 'A-1' }), () => jira.setStatus(ctxOf(CLOUD), { key: 'A-1' }, 'done'), () => jira.addComment(ctxOf(CLOUD), { key: 'A-1' }, 'x')]) {
    await assert.rejects(run(), (e) => {
      assert.ok(!e.message.includes(TOKEN), e.message);
      assert.ok(!e.message.includes(BASIC), e.message);
      return true;
    });
  }
});

// ---------- トランジション ----------

const tr = (id, name, to, cat, extra = {}) => ({ id, name, to: { name: to, statusCategory: { key: cat } }, ...extra });
const TODO = { name: 'To Do', statusCategory: { key: 'new' } };
const DOING = { name: 'In Progress', statusCategory: { key: 'indeterminate' } };
const REVIEW = { name: 'In Review', statusCategory: { key: 'indeterminate' } };
const FLOW = [tr('1', 'Start', 'In Progress', 'indeterminate'), tr('2', 'Send', 'In Review', 'indeterminate'), tr('3', 'Close as dup', "Won't Do", 'done'), tr('4', 'Finish', 'Done', 'done')];
const picked = (r) => r.transition && r.transition.id;

test('既定は状態カテゴリで選ぶ', () => {
  assert.strictEqual(picked(jira.pickTransition(FLOW, 'inProgress', '', TODO)), '1');
  assert.strictEqual(picked(jira.pickTransition(FLOW, 'done', '', DOING)), '4');
  assert.strictEqual(picked(jira.pickTransition(FLOW, 'inReview', '', DOING)), '2');
  // レビューから作業に戻す
  assert.strictEqual(picked(jira.pickTransition(FLOW, 'inProgress', '', REVIEW)), '1');
  // 名前が違っても、カテゴリが合えば選ぶ
  assert.strictEqual(picked(jira.pickTransition([tr('7', 'Pick up', '対応中', 'indeterminate')], 'inProgress', '', TODO)), '7');
  assert.strictEqual(picked(jira.pickTransition([tr('8', 'Ship', 'Released', 'done')], 'done', '', DOING)), '8');
});

test('もう合っている状態なら変えない', () => {
  assert.deepStrictEqual(jira.pickTransition(FLOW, 'inProgress', '', DOING), { unchanged: true });
  assert.deepStrictEqual(jira.pickTransition(FLOW, 'inReview', '', REVIEW), { unchanged: true });
  assert.deepStrictEqual(jira.pickTransition(FLOW, 'done', '', { name: 'Closed', statusCategory: { key: 'done' } }), { unchanged: true });
  assert.deepStrictEqual(jira.pickTransition(FLOW, 'inProgress', 'in-progress', DOING), { unchanged: true });
});

test('完了のカテゴリでも、見送りの状態（Won\'t Do など）は選ばない。保留も選ばない', () => {
  const r = jira.pickTransition([tr('3', 'x', "Won't Do", 'done'), tr('5', 'y', 'Cancelled', 'done')], 'done', '', DOING);
  assert.strictEqual(r.transition, undefined);
  assert.match(r.reason, /「Done」に当たるトランジションがありません（使えるもの: Won't Do, Cancelled）/);
  assert.strictEqual(picked(jira.pickTransition([tr('6', 'x', 'Blocked', 'indeterminate'), tr('7', 'y', 'Working', 'indeterminate')], 'inProgress', '', TODO)), '7');
});

test('名前の指定はトランジションの名前と移動先の状態の名前のどちらでも効き、ほかは選ばない', () => {
  assert.strictEqual(picked(jira.pickTransition(FLOW, 'done', 'Close as dup', DOING)), '3');
  assert.strictEqual(picked(jira.pickTransition(FLOW, 'done', "won't do", DOING)), '3');
  assert.strictEqual(picked(jira.pickTransition(FLOW, 'done', 'Nope, Done', DOING)), '4');
  assert.strictEqual(picked(jira.pickTransition(FLOW, 'inReview', 'Send', TODO)), '2');
  assert.match(jira.pickTransition(FLOW, 'done', 'Nope', DOING).reason, /設定した「Nope」に当たるトランジションがありません（使えるもの: In Progress, In Review, Won't Do, Done）/);
});

test('使えるトランジションが無いときは、理由を返す', () => {
  assert.match(jira.pickTransition([], 'done', '', DOING).reason, /今使えるトランジションがありません/);
  assert.match(jira.pickTransition(undefined, 'done', 'Done', DOING).reason, /今使えるトランジションがありません/);
  assert.match(jira.pickTransition([tr('1', 'x', 'Done', 'done', { isAvailable: false })], 'done', '', DOING).reason, /今使えるトランジションがありません/);
  assert.match(jira.pickTransition(FLOW.slice(0, 1), 'inReview', '', DOING).reason, /「In review」に当たるトランジションがありません/);
});

test('setStatus: 選んだトランジションを実行して、変更を返す', async (t) => {
  const calls = mockFetch(t, {
    'GET rest/api/3/issue/ABC-1': { key: 'ABC-1', fields: { status: DOING } },
    'GET rest/api/3/issue/ABC-1/transitions': { transitions: FLOW },
    'POST rest/api/3/issue/ABC-1/transitions': null,
  });
  assert.deepStrictEqual(await jira.setStatus(ctxOf(CLOUD), { key: 'ABC-1' }, 'done'), { updated: [{ from: 'In Progress', to: 'Done' }], skipped: [] });
  assert.deepStrictEqual(calls.find((c) => c.method === 'POST').json, { transition: { id: '4' } });
  await assert.rejects(jira.setStatus(ctxOf(CLOUD), { key: 'ABC-1' }, 'weird'), /不明なステータス/);
});

test('setStatus: プロジェクトの設定の名前を使う。同じ状態なら送らない', async (t) => {
  const calls = mockFetch(t, {
    'GET jira/rest/api/2/issue/OPS-1': { key: 'OPS-1', fields: { status: TODO } },
    'GET jira/rest/api/2/issue/OPS-1/transitions': { transitions: FLOW },
    'POST jira/rest/api/2/issue/OPS-1/transitions': null,
  });
  const r = await jira.setStatus(ctxOf(DC, { statusMapping: { inProgress: 'In Review' } }), { key: 'OPS-1' }, 'inProgress');
  assert.deepStrictEqual(r.updated, [{ from: 'To Do', to: 'In Review' }]);
  const same = await jira.setStatus(ctxOf(DC, { statusMapping: { done: 'To Do' } }), { key: 'OPS-1' }, 'done');
  assert.deepStrictEqual(same, { updated: [], skipped: [] });
  assert.strictEqual(calls.filter((c) => c.method === 'POST').length, 1);
});

test('setStatus: Jira に断られたトランジションは失敗にせず理由を返す。認証の失敗はエラーのまま', async (t) => {
  let status = 400;
  mockFetch(t, {
    'GET rest/api/3/issue/ABC-1': { key: 'ABC-1', fields: { status: DOING } },
    'GET rest/api/3/issue/ABC-1/transitions': { transitions: FLOW },
    'POST rest/api/3/issue/ABC-1/transitions': () => new Response(JSON.stringify({ errorMessages: [], errors: { resolution: '解決状況が必要です' } }), { status }),
  });
  const r = await jira.setStatus(ctxOf(CLOUD), { key: 'ABC-1' }, 'done');
  assert.deepStrictEqual(r.updated, []);
  assert.match(r.skipped[0].reason, /「Done」へのトランジションを実行できませんでした: .*解決状況が必要です/);
  status = 401;
  await assert.rejects(jira.setStatus(ctxOf(CLOUD), { key: 'ABC-1' }, 'done'), /認証に失敗/);
});

// ---------- コメント ----------

test('コメント: Cloud は ADF、Data Center は文字列で送る', async (t) => {
  const calls = mockFetch(t, {
    'POST rest/api/3/issue/ABC-1/comment': { id: '77' },
    'POST jira/rest/api/2/issue/OPS-1/comment': { id: '5' },
  });
  const a = await jira.addComment(ctxOf(CLOUD), { key: 'ABC-1' }, 'PR: https://x.example/1');
  assert.strictEqual(a.url, 'https://acme.atlassian.net/browse/ABC-1?focusedCommentId=77');
  assert.deepStrictEqual(calls[0].json.body, textToAdf('PR: https://x.example/1'));
  await jira.addComment(ctxOf(DC), { key: 'OPS-1' }, 'PR: https://x.example/1');
  assert.strictEqual(calls[1].json.body, 'PR: https://x.example/1');
});

// ---------- サブタスク ----------

test('サブタスクの一覧', async (t) => {
  mockFetch(t, {
    'GET rest/api/3/issue/ABC-1': { key: 'ABC-1', fields: { subtasks: [{ key: 'ABC-2', fields: { summary: '子1', status: TODO } }, { key: 'ABC-3', fields: { summary: '子2', status: { name: 'Done', statusCategory: { key: 'done' } } } }] } },
  });
  const list = await jira.fetchSubIssues(ctxOf(CLOUD), { key: 'ABC-1' });
  assert.deepStrictEqual(list.map((x) => [x.key, x.title, x.state, x.url]), [['ABC-2', '子1', 'open', 'https://acme.atlassian.net/browse/ABC-2'], ['ABC-3', '子2', 'closed', 'https://acme.atlassian.net/browse/ABC-3']]);
});

test('サブタスクの作成: プロジェクトのサブタスク用の課題タイプを使う', async (t) => {
  const calls = mockFetch(t, {
    'GET rest/api/3/issue/ABC-1': { key: 'ABC-1', fields: { project: { key: 'ABC' }, issuetype: { subtask: false } } },
    'GET rest/api/3/project/ABC': { issueTypes: [{ id: '10', name: 'Task', subtask: false }, { id: '11', name: 'サブタスク', subtask: true }] },
    'POST rest/api/3/issue': { key: 'ABC-9' },
  });
  const made = await jira.createSubIssue(ctxOf(CLOUD), { key: 'ABC-1' }, { title: ' 子の\nタスク ', body: '本文' });
  assert.deepStrictEqual(made, { key: 'ABC-9', title: '子の タスク', url: 'https://acme.atlassian.net/browse/ABC-9' });
  assert.deepStrictEqual(calls.find((c) => c.method === 'POST').json, { fields: { project: { key: 'ABC' }, parent: { key: 'ABC-1' }, issuetype: { id: '11' }, summary: '子の タスク', description: textToAdf('本文') } });
  assert.strictEqual(calls.find((c) => c.path.endsWith('project/ABC')).query.expand, 'issueTypes');
});

test('サブタスクの作成: Data Center の本文は文字列。作れないときは分かるエラー', async (t) => {
  let types = [{ id: '5', subtask: true }];
  let parentType = { subtask: false };
  const calls = mockFetch(t, {
    'GET jira/rest/api/2/issue/OPS-1': () => ({ key: 'OPS-1', fields: { project: { key: 'OPS' }, issuetype: parentType } }),
    'GET jira/rest/api/2/project/OPS': () => ({ issueTypes: types }),
    'POST jira/rest/api/2/issue': { key: 'OPS-2' },
  });
  await jira.createSubIssue(ctxOf(DC), { key: 'OPS-1' }, { title: 't', body: '本文' });
  assert.strictEqual(calls.find((c) => c.method === 'POST').json.fields.description, '本文');
  types = [{ id: '1', subtask: false }];
  await assert.rejects(jira.createSubIssue(ctxOf(DC), { key: 'OPS-1' }, { title: 't', body: '' }), /プロジェクト OPS にサブタスク用の課題タイプがありません/);
  parentType = { subtask: true };
  await assert.rejects(jira.createSubIssue(ctxOf(DC), { key: 'OPS-1' }, { title: 't', body: '' }), /OPS-1 はサブタスクなので/);
});

test('必須項目のエラーは、項目ごとの文を見せる', async (t) => {
  mockFetch(t, {
    'GET rest/api/3/issue/ABC-1': { key: 'ABC-1', fields: { project: { key: 'ABC' } } },
    'GET rest/api/3/project/ABC': { issueTypes: [{ id: '1', subtask: true }] },
    'POST rest/api/3/issue': new Response(JSON.stringify({ errorMessages: [], errors: { components: 'コンポーネントは必須です' } }), { status: 400 }),
  });
  await assert.rejects(jira.createSubIssue(ctxOf(CLOUD), { key: 'ABC-1' }, { title: 't', body: '' }), /コンポーネントは必須です/);
});

// ---------- 設定 ----------

function setup(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-jira-'));
  const store = new Store(path.join(dir, 'board.json'));
  store.settings.repoPath = dir;
  Object.assign(store.settings, settings);
  store.settings.trackerConfigs = { jira: CLOUD };
  const secrets = { has: (n) => n === 'tracker:jira:token', get: () => TOKEN, delete: () => true };
  const agents = new AgentManager(store, { mcpScript: '', mcpDir: path.join(dir, 'mcp'), nodeBin: process.execPath, trackers: new trackers.Trackers({ store, secrets }) });
  return { store, agents, repo: dir };
}

test('設定の欄: トークンは config に入らず、URL は検証する。一覧にトークンの値は出ない', () => {
  assert.deepStrictEqual(trackers.cleanConfig(jira, { baseUrl: 'https://acme.atlassian.net/', email: EMAIL, token: 'x' }), { deployment: 'cloud', baseUrl: 'https://acme.atlassian.net', allowHttp: false, email: EMAIL });
  assert.throws(() => trackers.cleanConfig(jira, { baseUrl: 'http://jira.local' }), /許可/);
  assert.strictEqual(trackers.cleanConfig(jira, { baseUrl: 'http://jira.local', allowHttp: true, deployment: 'datacenter' }).baseUrl, 'http://jira.local');
  const { agents } = setup();
  const row = agents.trackers.publicOne('jira');
  assert.strictEqual(row.configured, true);
  assert.ok(!JSON.stringify(row).includes(TOKEN));
});

test('画面の文言は4言語すべてに訳がある', () => {
  const texts = jira.configFields.flatMap((f) => [f.label, f.help]).filter((s) => s && !s.startsWith('Jira Cloud'));
  texts.push(jira.refPlaceholder);
  for (const lang of ['en', 'es', 'fr', 'zh']) {
    I18n.setLanguage(lang);
    for (const s of texts) assert.notStrictEqual(I18n.tr(s), s, `${lang}: ${s}`);
  }
  I18n.setLanguage('ja');
});

test('設定の説明文の切り替え: hidden が CSS の display に負けない', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.ok(css.includes('.field small[hidden] { display: none; }'));
});

// ---------- カードの動きとつなげる ----------

const openRoutes = (extra = {}) => ({
  'GET rest/api/3/issue/ABC-1': CLOUD_ISSUE,
  'GET rest/api/3/issue/ABC-1/comment': { comments: [] },
  'GET rest/api/3/issue/ABC-1/transitions': { transitions: [] },
  'POST rest/api/3/issue/ABC-1/comment': { id: '1' },
  ...extra,
});

test('Issue からカードを作る: 題名・指示・PR の本文に Jira のキーと URL が入る', async (t) => {
  mockFetch(t, { ...openRoutes(), 'GET rest/api/3/issue/ABC-1': (c) => (c.query.fields === 'subtasks' ? { key: 'ABC-1', fields: { subtasks: [] } } : CLOUD_ISSUE) });
  const { agents } = setup({ issueProvider: 'jira' });
  const { cards } = await agents.createFromIssues({ numbers: 'https://acme.atlassian.net/browse/ABC-1', agent: 'claude' });
  const [c] = cards;
  assert.strictEqual(c.title, 'ABC-1 ログインできない');
  assert.deepStrictEqual(c.issue, { provider: 'jira', key: 'ABC-1', title: 'ログインできない', url: 'https://acme.atlassian.net/browse/ABC-1' });
  assert.match(c.prompt, /Jira の Issue ABC-1/);
  assert.strictEqual(agents.prDefaults(c).body.split('\n')[0], 'ABC-1 https://acme.atlassian.net/browse/ABC-1');
  assert.strictEqual(agents.commitMessage(c), 'agent: ログインできない (ABC-1)');
});

function jiraCard(store, repo, over = {}) {
  const c = { id: 'c1', title: 'ABC-1 t', status: 'todo', repoPath: repo, issue: { provider: 'jira', key: 'ABC-1', title: 't', url: 'u' }, logs: [], ...over };
  store.cards.push(c);
  return c;
}

test('開始・PR の作成・完了のときに、それぞれ1回だけコメントする', async (t) => {
  const calls = mockFetch(t, openRoutes());
  const { store, agents, repo } = setup();
  const c = jiraCard(store, repo);
  const comments = () => calls.filter((x) => x.method === 'POST' && x.path.endsWith('/comment')).map((x) => adfToText(x.json.body));
  c.status = 'running';
  agents.changed(c);
  agents.changed(c);
  await agents.flushIssueSync();
  assert.deepStrictEqual(comments(), ['Worktree Kanban でタスクを開始しました']);
  c.status = 'review';
  c.prUrl = 'https://github.com/o/r/pull/1';
  agents.changed(c);
  agents.changed(c);
  await agents.flushIssueSync();
  assert.deepStrictEqual(comments().slice(1), ['PR を作成しました: https://github.com/o/r/pull/1']);
  c.status = 'done';
  c.mergedInto = ['main'];
  agents.changed(c);
  agents.changed(c);
  await agents.flushIssueSync();
  assert.deepStrictEqual(comments().slice(2), ['Worktree Kanban のタスクが完了しました']);
  assert.ok(c.logs.some((l) => /ABC-1 にコメントしました/.test(l.text)));
});

test('PR を作っただけの完了では、完了のコメントをしない', async (t) => {
  const calls = mockFetch(t, openRoutes());
  const { store, agents, repo } = setup();
  const c = jiraCard(store, repo, { status: 'done', prUrl: 'p', issueCommented: { started: true, pr: 'p' } });
  agents.changed(c);
  await agents.flushIssueSync();
  assert.ok(!calls.some((x) => x.method === 'POST'));
});

test('プロジェクトの設定で切ると、コメントしない', async (t) => {
  const calls = mockFetch(t, openRoutes());
  const { store, agents, repo } = setup({ issueComments: false });
  const c = jiraCard(store, repo, { status: 'running' });
  agents.changed(c);
  await agents.flushIssueSync();
  assert.ok(!calls.some((x) => x.path.endsWith('/comment')));
});

test('競争では、同じ Issue の候補全体で1回だけコメントする', async (t) => {
  const calls = mockFetch(t, openRoutes());
  const { store, agents, repo } = setup();
  const a = jiraCard(store, repo, { id: 'a', status: 'running', compete: { group: 'g', index: 0 } });
  const b = jiraCard(store, repo, { id: 'b', status: 'running', compete: { group: 'g', index: 1 } });
  agents.changed(a);
  agents.changed(b);
  await agents.flushIssueSync();
  assert.strictEqual(calls.filter((x) => x.method === 'POST' && x.path.endsWith('/comment')).length, 1);
});

test('コメントに失敗してもカードは止まらず、トークンを出さずにログに残す', async (t) => {
  mockFetch(t, openRoutes({ 'POST rest/api/3/issue/ABC-1/comment': new Response(JSON.stringify({ errorMessages: [`no ${TOKEN}`] }), { status: 500 }) }));
  const { store, agents, repo } = setup();
  const c = jiraCard(store, repo, { status: 'running' });
  agents.changed(c);
  await agents.flushIssueSync();
  const line = c.logs.find((l) => /コメントできませんでした/.test(l.text));
  assert.ok(line);
  assert.ok(!JSON.stringify(c.logs).includes(TOKEN));
  assert.strictEqual(c.status, 'running');
});

test('使えるトランジションが無いときは、カードのログに理由を出して失敗にしない', async (t) => {
  mockFetch(t, openRoutes());
  const { store, agents, repo } = setup({ issueComments: false });
  const c = jiraCard(store, repo, { status: 'running' });
  agents.changed(c);
  await agents.flushIssueSync();
  assert.ok(c.logs.some((l) => l.kind === 'system' && /Jiraのステータスは変えませんでした: この課題で今使えるトランジションがありません/.test(l.text)), JSON.stringify(c.logs));
  assert.strictEqual(c.issueSync.error, null);
});

test('GitHub のカードではコメントしない（今までどおり）', async (t) => {
  const { store, agents, repo } = setup();
  const seen = [];
  t.mock.method(trackers.get('github'), 'addComment', async () => seen.push(1));
  t.mock.method(trackers.get('github'), 'setStatus', async () => ({ updated: [], skipped: [] }));
  const c = { id: 'g', title: '#1 t', status: 'running', repoPath: repo, issue: { number: 1, title: 't', url: 'u' }, logs: [] };
  store.cards.push(c);
  agents.changed(c);
  await agents.flushIssueSync();
  assert.strictEqual(seen.length, 0);
  assert.strictEqual(c.issueCommented, undefined);
});

test('サブタスクの提案から Jira のサブタスクを作れる', async (t) => {
  const calls = mockFetch(t, {
    'GET rest/api/3/issue/ABC-1': { key: 'ABC-1', fields: { project: { key: 'ABC' }, issuetype: { subtask: false } } },
    'GET rest/api/3/project/ABC': { issueTypes: [{ id: '11', subtask: true }] },
    'POST rest/api/3/issue': { key: 'ABC-5' },
    'POST rest/api/3/issue/ABC-1/comment': { id: '1' },
    'GET rest/api/3/issue/ABC-1/transitions': { transitions: [] },
  });
  const { store, agents, repo } = setup({ issueComments: false });
  const c = jiraCard(store, repo, { status: 'review', worktreePath: '/w', branch: 'b', subtaskProposal: { items: [{ title: 'a', prompt: 'p' }] } });
  t.mock.method(agents, 'advanceSubtasks', async () => {});
  await agents.acceptSubtasks('c1', { createIssues: true });
  assert.strictEqual(c.subtasks.items[0].issue.key, 'ABC-5');
  assert.strictEqual(c.subtasks.items[0].issue.provider, 'jira');
  assert.strictEqual(c.subtasks.items[0].issue.url, 'https://acme.atlassian.net/browse/ABC-5');
  assert.strictEqual(calls.find((x) => x.method === 'POST' && x.path.endsWith('issue')).json.fields.parent.key, 'ABC-1');
  await agents.flushIssueSync();
});
