const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

// scheduler-view.js は renderer.js の部品（openModal など）を使う画面のスクリプトなので、
// 部品の偽物と、id と値だけを持つ小さな DOM を用意して、実際の操作の流れを試す
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'scheduler-view.js'), 'utf8');

class FakeEl {
  constructor(doc, attrs = '') {
    this.doc = doc;
    this.dataset = {};
    this.classList = new Set();
    this.classList.toggle = (c, on) => (on ? this.classList.add(c) : this.classList.delete(c));
    this.classList.contains = (c) => this.classList.has(c);
    this.classList.remove = (c) => this.classList.delete(c);
    this.value = /\bvalue="([^"]*)"/.exec(attrs)?.[1] ?? '';
    this.checked = /\bchecked\b/.test(attrs);
    for (const c of (/\bclass="([^"]*)"/.exec(attrs)?.[1] || '').split(/\s+/).filter(Boolean)) this.classList.add(c);
    this.textContent = '';
    this.listeners = {};
    this.html = '';
  }
  get innerHTML() {
    return this.html;
  }
  set innerHTML(html) {
    this.html = html;
    this.doc.scan(html);
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
}

function fakeDoc() {
  const doc = {
    els: new Map(),
    scan(html) {
      for (const [tag, attrs] of html.matchAll(/<\w+\b([^>]*)>/g).map((m) => [m[0], m[1]])) {
        const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
        if (!id) continue;
        const el = new FakeEl(doc, attrs);
        // <select> は選ばれている <option> の値、<textarea> は中身を値にする
        if (tag.startsWith('<select')) {
          const body = html.slice(html.indexOf(tag));
          const opts = [...body.slice(0, body.indexOf('</select>')).matchAll(/<option value="([^"]*)"([^>]*)>/g)];
          el.value = (opts.find((o) => /selected/.test(o[2])) || opts[0] || [])[1] ?? '';
        }
        if (tag.startsWith('<textarea')) el.value = html.slice(html.indexOf(tag) + tag.length).split('</textarea>')[0];
        doc.els.set(id, el);
      }
    },
  };
  return doc;
}

function setup({ schedules = [], settings = { repoPath: '/repo' }, cards = [], apiOverride = {} } = {}) {
  const doc = fakeDoc();
  const calls = [];
  const toasts = [];
  const record = (name) => async (...args) => {
    calls.push([name, ...args]);
    return 'id1';
  };
  const box = new FakeEl(doc);
  doc.els.set('schedulerView', box);
  const ctx = {
    state: { board: { settings, cards, schedules } },
    api: { createSchedule: record('create'), updateSchedule: record('update'), deleteSchedule: record('delete'), runSchedule: record('run'), ...apiOverride },
    $: (id) => doc.els.get(id) || null,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    icon: (n) => `[${n}]`,
    ScheduleModel: {
      describeRule: (r) => `rule:${r.kind}`,
      WEEKDAY_NAMES: ['日', '月', '火', '水', '木', '金', '土'],
      RULE_KINDS: ['once', 'interval', 'hourly', 'daily', 'weekly', 'monthly'],
      INTERVAL_MIN: 1,
      INTERVAL_MAX: 1440,
      ISSUE_BATCH: 10,
    },
    RELAY_PREFIX: 'relay:',
    CUSTOM_PREFIX: 'custom:',
    isRelayRef: (v) => typeof v === 'string' && v.startsWith('relay:'),
    isCustomRef: (v) => typeof v === 'string' && v.startsWith('custom:'),
    pipelineOfRef: (v) => (v === 'relay:p1' ? { id: 'p1', name: '標準', flow: { pars: 0 } } : v === 'relay:par' ? { id: 'par', name: '並列', flow: { pars: 1 } } : null),
    relayFlowInfo: (flow) => ({ pars: flow ? flow.pars : 0 }),
    findCustomAgent: (v) => (v === 'custom:ca1' ? { id: 'ca1', name: 'レビュー係' } : null),
    agentLabel: (a) => ({ claude: 'Claude Code', codex: 'Codex CLI' })[a] || 'Claude Code',
    // 実物と同じく、選べない指定なら先頭のエージェントになる
    agentFieldHtml: (idp, v) => {
      const list = ['claude', 'codex', 'relay:p1', 'relay:par', 'compete', 'custom:ca1'];
      return `<select id="${idp}Agent">${list.map((x) => `<option value="${x}" ${x === v ? 'selected' : ''}></option>`).join('')}</select>`;
    },
    bindAgentField: () => {},
    updateModelField: () => {},
    modelFieldHtml: (idp, v) => `<input id="${idp}Model" value="${v}" />`,
    readModelField: (idp, a) => (a === 'claude' || a === 'codex' ? doc.els.get(`${idp}Model`).value.trim() || undefined : undefined),
    renderSkillSlot: () => {},
    openModal(html, onReady) {
      doc.modalOpen = true;
      doc.modalHtml = html;
      doc.scan(html);
      onReady?.();
    },
    closeModal() {
      doc.modalOpen = false;
      doc.els.delete('schedDetail');
    },
    async runBusy(_msg, fn, okMsg) {
      try {
        const r = await fn();
        if (okMsg) toasts.push(['ok', okMsg]);
        return r;
      } catch (e) {
        toasts.push(['error', e.message]);
        return undefined;
      }
    },
    toast: (m) => toasts.push(['error', m]),
    chooseRepo: () => calls.push(['chooseRepo']),
    select: (id) => calls.push(['select', id]),
    confirm: () => true,
    Date,
    console,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const view = ctx.SchedulerView;
  const el = (id) => doc.els.get(id);
  // data-* の付いた部品を押す（closest は、その部品が見つかったことにする）
  const click = (container, dataset) => container.onclick({ target: { closest: (sel) => (Object.keys(dataset).some((k) => sel.includes(`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)) ? { dataset, disabled: dataset.disabled } : null) } });
  return { ctx, doc, view, calls, toasts, el, click, box };
}

const sched = (over = {}) => ({ id: 's1', repoPath: '/repo', title: '毎朝の掃除', prompt: '依存を更新', skill: '', agent: 'claude', model: '', readOnly: false, rule: { kind: 'daily', hour: 9, minute: 0 }, enabled: true, catchUp: false, nextRunAt: new Date(2026, 10, 7, 9, 0).getTime(), createdAt: 1, lastRunAt: null, lastStatus: '', lastError: '', runs: [], ...over });
const plain = (v) => JSON.parse(JSON.stringify(v));

test('一覧: タスク名と最終実行日（未実行・実行済み）を出す', () => {
  const at = new Date(2026, 10, 6, 7, 5).getTime();
  const { view, box } = setup({ schedules: [sched(), sched({ id: 's2', title: '夜の<集計>', lastRunAt: at })] });
  view.render();
  assert.match(box.innerHTML, /毎朝の掃除/);
  assert.match(box.innerHTML, /未実行/);
  assert.match(box.innerHTML, /2026\/11\/06 07:05/);
  assert.match(box.innerHTML, /夜の&lt;集計&gt;/, 'タイトルをエスケープする');
  assert.doesNotMatch(box.innerHTML, /<集計>/);
});

test('一覧: 動いているものを次回が近い順に、停止中をあとに並べる', () => {
  const { view } = setup();
  const list = view.sortedSchedules([sched({ id: 'off', enabled: false, nextRunAt: null }), sched({ id: 'late', nextRunAt: 200 }), sched({ id: 'none', nextRunAt: null }), sched({ id: 'soon', nextRunAt: 100 })]);
  assert.deepStrictEqual(plain(list.map((s) => s.id)), ['soon', 'late', 'none', 'off']);
});

test('一覧: スケジュールがないときの案内と、古いホストで schedules がないとき', () => {
  for (const schedules of [[], undefined]) {
    const { view, box } = setup({ schedules });
    view.render();
    assert.match(box.innerHTML, /スケジュールはまだありません/);
  }
});

test('一覧: リポジトリ未選択なら案内を出し、選ぶ画面へ進める', () => {
  const { view, box, calls, click } = setup({ settings: {} });
  view.render();
  assert.match(box.innerHTML, /まずリポジトリを選んでください/);
  assert.doesNotMatch(box.innerHTML, /data-sched-act="new"/);
  click(box, { schedAct: 'repo' });
  assert.deepStrictEqual(calls, [['chooseRepo']]);
});

test('一覧: 内容が同じなら描き直さない（スクロールが飛ばない）', () => {
  const { view, box } = setup({ schedules: [sched()] });
  view.render();
  let writes = 0;
  const html = box.html;
  Object.defineProperty(box, 'innerHTML', { get: () => html, set: () => writes++ });
  view.render();
  assert.strictEqual(writes, 0);
});

test('一覧: 失敗と停止中の目印を出す', () => {
  const { view, box } = setup({ schedules: [sched({ enabled: false, lastStatus: 'failed' })] });
  view.render();
  assert.match(box.innerHTML, /停止中/);
  assert.match(box.innerHTML, /前回は失敗/);
});

test('詳細: スケジュール・指示・エージェント・スキル・履歴を出す', () => {
  const at = new Date(2026, 10, 6, 9, 0).getTime();
  const runs = [{ at, status: 'ok', cardId: 'c1', message: 'タスクを作って開始しました' }, { at, status: 'failed', cardId: '', message: 'リポジトリが見つかりません' }, { at, status: 'missed', cardId: 'gone', message: '予定から10分より遅れました' }];
  const { view, box, click, el } = setup({ schedules: [sched({ agent: 'relay:p1', skill: 'release', lastStatus: 'failed', lastError: '失敗の理由', runs })], cards: [{ id: 'c1' }] });
  view.render();
  click(box, { schedId: 's1' });
  const html = el('schedDetail').innerHTML;
  for (const want of ['rule:daily', '2026/11/07 09:00', '依存を更新', 'Pipeline「標準」', '/release', '失敗の理由', '>見送り<', '予定から10分より遅れました']) assert.ok(html.includes(want), want);
  assert.match(html, /data-sched-card="c1"/);
  assert.doesNotMatch(html, /data-sched-card="gone"/, '消えたカードへは移動させない');
  assert.match(html, /カードは削除済み/);
});

test('詳細: 消えた Pipeline・カスタムエージェントは見つからないと出す', () => {
  for (const [agent, want] of [['relay:gone', 'Pipeline（見つかりません）'], ['custom:gone', 'カスタムエージェント（見つかりません）'], ['custom:ca1', 'レビュー係'], ['compete', '競争'], ['', '設定の既定']]) {
    const { view, box, click, el } = setup({ schedules: [sched({ agent })] });
    view.render();
    click(box, { schedId: 's1' });
    assert.ok(el('schedDetail').innerHTML.includes(want), want);
  }
});

test('詳細: 履歴からカンバンのカードへ移動する', () => {
  const { view, box, click, el, calls, doc } = setup({ schedules: [sched()] });
  view.render();
  click(box, { schedId: 's1' });
  click(el('schedDetail'), { schedCard: 'c1' });
  assert.strictEqual(doc.modalOpen, false);
  assert.deepStrictEqual(calls, [['select', 'c1']]);
});

test('詳細: 今すぐ実行とタスクだけ作成', async () => {
  const { view, box, click, el, calls, toasts } = setup({ schedules: [sched()] });
  view.render();
  click(box, { schedId: 's1' });
  await click(el('schedDetail'), { schedDo: 'run' });
  await click(el('schedDetail'), { schedDo: 'task' });
  assert.deepStrictEqual(plain(calls), [['run', { id: 's1', start: true }], ['run', { id: 's1', start: false }]]);
  assert.strictEqual(toasts.length, 2);
  assert.ok(toasts.every(([k]) => k === 'ok'));
});

test('詳細: 実行に失敗したら理由を出して、完了とは言わない', async () => {
  const { view, box, click, el, toasts, doc } = setup({ schedules: [sched()], apiOverride: { runSchedule: async () => { throw new Error('リポジトリが見つかりません'); } } });
  view.render();
  click(box, { schedId: 's1' });
  await click(el('schedDetail'), { schedDo: 'run' });
  assert.deepStrictEqual(plain(toasts), [['error', 'リポジトリが見つかりません']]);
  assert.strictEqual(doc.modalOpen, true);
});

test('詳細: 停止と再開', async () => {
  const { view, box, click, el, calls, ctx } = setup({ schedules: [sched()] });
  view.render();
  click(box, { schedId: 's1' });
  assert.match(el('schedDetail').innerHTML, />停止</);
  await click(el('schedDetail'), { schedDo: 'toggle' });
  ctx.state.board.schedules[0].enabled = false;
  view.render();
  assert.match(el('schedDetail').innerHTML, />再開</);
  await click(el('schedDetail'), { schedDo: 'toggle' });
  assert.deepStrictEqual(plain(calls), [['update', { id: 's1', enabled: false }], ['update', { id: 's1', enabled: true }]]);
});

test('詳細: 実行済みの1回だけは再開できない（日時を変えるよう案内する）', () => {
  const past = Date.now() - 1000;
  const { view, box, click, el } = setup({ schedules: [sched({ enabled: false, rule: { kind: 'once', at: past }, nextRunAt: null })] });
  view.render();
  click(box, { schedId: 's1' });
  assert.match(el('schedDetail').innerHTML, /data-sched-do="toggle" disabled/);
  assert.match(el('schedDetail').innerHTML, /予定なし/);
});

test('詳細: 削除は確認してから。キャンセルなら消さない', async () => {
  const { view, box, click, el, calls, doc, ctx } = setup({ schedules: [sched()] });
  view.render();
  click(box, { schedId: 's1' });
  ctx.confirm = () => false;
  await click(el('schedDetail'), { schedDo: 'delete' });
  assert.deepStrictEqual(calls, []);
  ctx.confirm = () => true;
  await click(el('schedDetail'), { schedDo: 'delete' });
  assert.deepStrictEqual(plain(calls), [['delete', 's1']]);
  assert.strictEqual(doc.modalOpen, false);
});

test('詳細: 開いているあいだに更新されたら描き直し、消されたら閉じる', () => {
  const { view, box, click, el, ctx, doc } = setup({ schedules: [sched()] });
  view.render();
  click(box, { schedId: 's1' });
  ctx.state.board.schedules[0].lastRunAt = new Date(2026, 10, 6, 9, 0).getTime();
  view.render();
  assert.match(el('schedDetail').innerHTML, /2026\/11\/06 09:00/);
  ctx.state.board.schedules = [];
  view.render();
  assert.strictEqual(doc.modalOpen, false);
});

test('作成: 入力した内容で登録する', async () => {
  const { view, el, calls, toasts, doc } = setup();
  view.openEditor();
  el('schedTitle').value = ' 週次 ';
  el('schedPrompt').value = ' 集計して ';
  el('schedKind').value = 'weekly';
  el('schedTime').value = '08:30';
  // 初期値は今日の曜日にチェックが入る。入力した曜日だけを見る
  for (let i = 0; i < 7; i++) el(`schedWd${i}`).checked = false;
  el('schedWd1').checked = true;
  el('schedWd5').checked = true;
  await el('schedOk').onclick();
  assert.deepStrictEqual(plain(calls), [['create', { title: '週次', prompt: '集計して', skill: null, agent: 'claude', model: '', readOnly: false, catchUp: false, rule: { kind: 'weekly', hour: 8, minute: 30, weekdays: [1, 5] }, issues: null, enabled: true }]]);
  assert.strictEqual(toasts[0][0], 'ok');
  assert.strictEqual(doc.modalOpen, false);
});

test('Issue の監視: 欄を切り替え、指示なしで登録できる', async () => {
  const { ctx, doc, calls } = setup();
  ctx.SchedulerView.openEditor();
  const el = (id) => doc.els.get(id);
  assert.strictEqual(el('schedIssueBox').classList.contains('hidden'), true);
  el('schedType').value = 'issues';
  el('schedType').onchange();
  assert.strictEqual(el('schedIssueBox').classList.contains('hidden'), false);
  assert.strictEqual(el('schedCatchUpBox').classList.contains('hidden'), true);
  assert.strictEqual(el('schedKind').value, 'interval');
  assert.strictEqual(el('schedIntervalBox').classList.contains('hidden'), false);
  assert.strictEqual(el('schedAutoWarn').classList.contains('hidden'), true);
  el('schedAutoStart').value = '1';
  el('schedAutoStart').onchange();
  assert.strictEqual(el('schedAutoWarn').classList.contains('hidden'), false);
  el('schedLabels').value = 'agent';
  await el('schedOk').onclick();
  const [name, data] = calls[0];
  assert.strictEqual(name, 'create');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(data.issues)), { labels: 'agent', author: '', autoStart: true });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(data.rule)), { kind: 'interval', minutes: 15 });
});

test('Issue の監視: 詳細に対象を出し、今すぐ確認で結果を知らせる', async () => {
  const s = { id: 's1', title: '監視', prompt: '', enabled: true, rule: { kind: 'interval', minutes: 5 }, runs: [], issues: { labels: ['agent'], author: '', autoStart: false, lastCheckedAt: null } };
  const { ctx, doc, toasts } = setup({ schedules: [s], apiOverride: { runSchedule: async () => ['c1', 'c2'] } });
  ctx.SchedulerView.render();
  doc.els.get('schedulerView').onclick({ target: { closest: (q) => (q === '[data-sched-id]' ? { dataset: { schedId: 's1' } } : null) } });
  const wrap = doc.els.get('schedDetail');
  assert.match(wrap.innerHTML, /ラベル: agent/);
  assert.match(wrap.innerHTML, /Todo に置くだけ/);
  assert.doesNotMatch(wrap.innerHTML, /タスクだけ作成/);
  await wrap.onclick({ target: { closest: (q) => (q === '[data-sched-do]' ? { dataset: { schedDo: 'check' } } : null) } });
  assert.ok(toasts.some((x) => JSON.stringify(x).includes('新しい Issue のタスクを 2 件作りました')), JSON.stringify(toasts));
});

test('ruleFromForm: N分おき', () => {
  const { ctx } = setup();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.SchedulerView.ruleFromForm({ kind: 'interval', minutes: '30' }).rule)), { kind: 'interval', minutes: 30 });
  for (const minutes of ['0', '1441', 'x', '']) assert.match(ctx.SchedulerView.ruleFromForm({ kind: 'interval', minutes }).error, /間隔は/);
});

test('作成: 種類に合う欄だけを出す', () => {
  const { view, el } = setup();
  view.openEditor();
  const shown = (kind) => {
    el('schedKind').value = kind;
    el('schedKind').onchange();
    return ['schedAtBox', 'schedMinuteBox', 'schedWeekBox', 'schedDayBox', 'schedTimeBox'].filter((id) => !el(id).classList.contains('hidden'));
  };
  assert.deepStrictEqual(shown('once'), ['schedAtBox']);
  assert.deepStrictEqual(shown('hourly'), ['schedMinuteBox']);
  assert.deepStrictEqual(shown('daily'), ['schedTimeBox']);
  assert.deepStrictEqual(shown('weekly'), ['schedWeekBox', 'schedTimeBox']);
  assert.deepStrictEqual(shown('monthly'), ['schedDayBox', 'schedTimeBox']);
});

test('作成: 指示が空・曜日なしなら登録せず、画面も閉じない', async () => {
  const { view, el, calls, toasts, doc } = setup();
  view.openEditor();
  el('schedPrompt').value = '   ';
  await el('schedOk').onclick();
  el('schedPrompt').value = '指示';
  el('schedKind').value = 'weekly';
  for (let i = 0; i < 7; i++) el(`schedWd${i}`).checked = false;
  await el('schedOk').onclick();
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(plain(toasts.map((t) => t[1])), ['エージェントへの指示を入れてください', '曜日を1つ以上選んでください']);
  assert.strictEqual(doc.modalOpen, true);
});

test('作成: 保存に失敗したら入力を残したまま理由を出す', async () => {
  const { view, el, toasts, doc } = setup({ apiOverride: { createSchedule: async () => { throw new Error('実行する日時が過ぎています'); } } });
  view.openEditor();
  el('schedPrompt').value = '指示';
  await el('schedOk').onclick();
  assert.deepStrictEqual(plain(toasts), [['error', '実行する日時が過ぎています']]);
  assert.strictEqual(doc.modalOpen, true);
  assert.strictEqual(el('schedPrompt').value, '指示');
});

test('作成: ソースを変更しないタスクで使えない組み合わせを止める', async () => {
  for (const agent of ['compete', 'relay:par']) {
    const { view, el, calls, toasts } = setup();
    view.openEditor();
    el('schedPrompt').value = '指示';
    el('schedAgent').value = agent;
    el('schedReadOnly').checked = true;
    await el('schedOk').onclick();
    assert.deepStrictEqual(calls, [], agent);
    assert.strictEqual(toasts[0][0], 'error', agent);
  }
});

test('作成: リポジトリ未選択なら編集画面を開かず、選ぶ画面へ', () => {
  const { view, calls, doc } = setup({ settings: {} });
  view.openEditor();
  assert.deepStrictEqual(calls, [['chooseRepo']]);
  assert.ok(!doc.modalOpen);
});

test('タスクから登録: Pipeline・競争・カスタムエージェントの指定を元に戻す', () => {
  const { view } = setup();
  assert.strictEqual(view.agentRefOfCard({ agent: 'claude', relay: { pipeline: { id: 'p1' } } }), 'relay:p1');
  assert.strictEqual(view.agentRefOfCard({ agent: 'claude', relay: {} }), 'relay');
  assert.strictEqual(view.agentRefOfCard({ agent: 'codex', compete: { group: 'g', title: 'x' } }), 'compete');
  assert.strictEqual(view.agentRefOfCard({ agent: 'claude', persona: { id: 'ca1' } }), 'custom:ca1');
  assert.strictEqual(view.agentRefOfCard({ agent: 'codex' }), 'codex');
  assert.strictEqual(view.agentRefOfCard({}), '');
});

test('タスクから登録: 内容をコピーして、元のカードを覚える', async () => {
  const { view, el, calls, doc } = setup();
  const card = { id: 'c1', title: 'リリース', prompt: '手順どおりに', skill: 'release', agent: 'codex', model: 'gpt-5', readOnly: true, attachments: [{ name: 'a.png' }, { name: 'b.png' }] };
  view.openEditor({ fromCard: card });
  assert.match(doc.modalHtml, /タスク「リリース」の内容をコピー/);
  assert.match(doc.modalHtml, /添付ファイル（2 件）はコピーしません/);
  assert.strictEqual(el('schedTitle').value, 'リリース');
  assert.strictEqual(el('schedPrompt').value, '手順どおりに');
  assert.strictEqual(el('schedAgent').value, 'codex');
  assert.strictEqual(el('schedModel').value, 'gpt-5');
  assert.strictEqual(el('schedReadOnly').checked, true);
  await el('schedOk').onclick();
  const [, data] = calls[0];
  assert.strictEqual(data.sourceCardId, 'c1');
  assert.strictEqual(data.skill, 'release');
  assert.strictEqual(data.attachments, undefined);
  assert.strictEqual(data.agent, 'codex');
});

test('タスクから登録: 競争のカードは、エージェント名の付かない元のタイトルと、モデルなしで登録する', () => {
  const { view } = setup();
  const d = view.draftFromCard({ id: 'c', title: '直す [Claude]', prompt: 'p', agent: 'claude', model: 'opus', compete: { group: 'g', title: '直す' } });
  assert.strictEqual(d.title, '直す');
  assert.strictEqual(d.agent, 'compete');
  assert.strictEqual(d.model, '');
});

test('タスクから登録: Pipeline のカードは Pipeline を選んだ状態で開く', () => {
  const { view, el, doc } = setup();
  view.openEditor({ fromCard: { id: 'c', title: 't', prompt: 'p', agent: 'claude', relay: { pipeline: { id: 'p1' } } } });
  assert.strictEqual(el('schedAgent').value, 'relay:p1');
  assert.ok(el('schedAgentLost').classList.contains('hidden'));
  assert.doesNotMatch(doc.modalHtml, /添付ファイル/);
});

test('タスクから登録: 元の Pipeline が消えていたら、置き換わったことを知らせる', () => {
  const { view, el } = setup();
  view.openEditor({ fromCard: { id: 'c', title: 't', prompt: 'p', agent: 'claude', relay: { pipeline: { id: 'gone' } } } });
  assert.strictEqual(el('schedAgent').value, 'claude');
  assert.ok(!el('schedAgentLost').classList.contains('hidden'));
  assert.match(el('schedAgentLost').textContent, /Pipeline（見つかりません）/);
});

test('編集: 今の内容を出して保存し、詳細に戻る', async () => {
  const s = sched({ title: '月次', agent: 'codex', model: 'gpt-5', skill: 'release', catchUp: true, rule: { kind: 'monthly', day: 31, hour: 23, minute: 59 } });
  const { view, box, click, el, calls, doc } = setup({ schedules: [s] });
  view.render();
  click(box, { schedId: 's1' });
  await click(el('schedDetail'), { schedDo: 'edit' });
  assert.strictEqual(el('schedKind').value, 'monthly');
  assert.strictEqual(el('schedDay').value, '31');
  assert.strictEqual(el('schedTime').value, '23:59');
  assert.strictEqual(el('schedCatchUp').checked, true);
  el('schedTitle').value = '月次2';
  await el('schedOk').onclick();
  assert.deepStrictEqual(plain(calls), [['update', { id: 's1', title: '月次2', prompt: '依存を更新', skill: 'release', agent: 'codex', model: 'gpt-5', readOnly: false, catchUp: true, rule: { kind: 'monthly', hour: 23, minute: 59, day: 31 }, issues: null }]]);
  assert.ok(el('schedDetail'), '保存後は詳細に戻る');
  assert.strictEqual(doc.modalOpen, true);
});

test('編集: Pipeline に変えたら古いモデルを消す', async () => {
  const { view, el, calls } = setup({ schedules: [sched({ model: 'opus' })] });
  view.openEditor({ schedule: sched({ model: 'opus' }) });
  el('schedAgent').value = 'relay:p1';
  await el('schedOk').onclick();
  assert.strictEqual(calls[0][1].model, '');
});

test('編集: 過ぎた1回だけも、日時を変えなければ指示などを直せる', async () => {
  const at = new Date(2026, 0, 1, 9, 0).getTime();
  const s = sched({ enabled: false, rule: { kind: 'once', at }, nextRunAt: null });
  const { view, el, calls, toasts } = setup({ schedules: [s] });
  view.openEditor({ schedule: s });
  await el('schedOk').onclick();
  assert.strictEqual(toasts[0][0], 'ok');
  assert.strictEqual(calls[0][1].rule.at, at);
});

test('編集: キャンセルで詳細に戻る', () => {
  const s = sched();
  const { view, el } = setup({ schedules: [s] });
  view.openEditor({ schedule: s });
  el('schedCancel').onclick();
  assert.ok(el('schedDetail'));
});

test('ruleFromForm: 種類ごとの値と境界', () => {
  const { view } = setup();
  const now = new Date(2026, 10, 6, 12, 0).getTime();
  const r = (f) => plain(view.ruleFromForm(f, now));
  assert.deepStrictEqual(r({ kind: 'hourly', minute: '0' }), { rule: { kind: 'hourly', minute: 0 } });
  assert.deepStrictEqual(r({ kind: 'hourly', minute: '59' }), { rule: { kind: 'hourly', minute: 59 } });
  assert.ok(r({ kind: 'hourly', minute: '60' }).error);
  assert.ok(r({ kind: 'hourly', minute: '' }).error, '空は 0 にしない');
  assert.ok(r({ kind: 'hourly', minute: '-1' }).error);
  assert.ok(r({ kind: 'hourly', minute: '1.5' }).error);
  assert.deepStrictEqual(r({ kind: 'daily', time: '00:00' }), { rule: { kind: 'daily', hour: 0, minute: 0 } });
  assert.deepStrictEqual(r({ kind: 'daily', time: '23:59' }), { rule: { kind: 'daily', hour: 23, minute: 59 } });
  assert.ok(r({ kind: 'daily', time: '' }).error);
  assert.ok(r({ kind: 'daily', time: '24:00' }).error);
  assert.deepStrictEqual(r({ kind: 'weekly', time: '09:00', weekdays: [6, 0, 6, 9] }).rule.weekdays, [0, 6], '重なりと範囲の外を落として並べる');
  assert.ok(r({ kind: 'weekly', time: '09:00', weekdays: [9] }).error);
  assert.strictEqual(r({ kind: 'monthly', time: '09:00', day: '1' }).rule.day, 1);
  assert.strictEqual(r({ kind: 'monthly', time: '09:00', day: '31' }).rule.day, 31);
  assert.ok(r({ kind: 'monthly', time: '09:00', day: '0' }).error);
  assert.ok(r({ kind: 'monthly', time: '09:00', day: '32' }).error);
  assert.ok(r({ kind: 'nope' }).error);
});

test('ruleFromForm: 1回だけは未来の日時だけ受け付ける', () => {
  const { view } = setup();
  const now = new Date(2026, 10, 6, 12, 0).getTime();
  assert.strictEqual(view.ruleFromForm({ kind: 'once', at: '2026-11-06T12:01' }, now).rule.at, new Date(2026, 10, 6, 12, 1).getTime());
  assert.ok(view.ruleFromForm({ kind: 'once', at: '2026-11-06T12:00' }, now).error, 'ちょうど今は過去あつかい');
  assert.ok(view.ruleFromForm({ kind: 'once', at: '' }, now).error);
  assert.ok(view.ruleFromForm({ kind: 'once', at: 'x' }, now).error);
});

test('fmtDateTime: ゼロ埋めと、日付がないとき', () => {
  const { view } = setup();
  assert.strictEqual(view.fmtDateTime(new Date(2026, 0, 2, 3, 4).getTime()), '2026/01/02 03:04');
  for (const v of [null, undefined, 0, '', 'x']) assert.strictEqual(view.fmtDateTime(v), '');
});
