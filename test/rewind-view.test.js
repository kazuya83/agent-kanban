// 戻す画面。rewind は固定のデータ（publicCards が渡す形）で確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
const I18n = require('../renderer/i18n');

function fnSource(name) {
  const m = src.match(new RegExp(`^(?:async )?function ${name}\\(.*\\{\\n[\\s\\S]*?^\\}\\n`, 'm'));
  assert.ok(m, `${name} が見つかりません`);
  return m[0];
}

function identityTr(key, vars) {
  const s = String(key ?? '');
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
function agentShort(a) {
  const list = [['claude', 'Claude'], ['codex', 'Codex'], ['gemini', 'Gemini'], ['cursor', 'Cursor']];
  return (list.find((x) => x[0] === a) || list[0])[1];
}
function hhmm(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const NAMES = ['esc', 'rewindView', 'rewindStepPoint', 'rewindButtonHtml', 'rewindStepHtml', 'rewindFlowNote', 'rewindConfirmMessage', 'rewindCard', 'rewindHistoryHtml', 'readLogs', 'ensureLogsFresh'];
const body = NAMES.map(fnSource).join('\n');
const create = new Function('tr', 'agentShort', 'hhmm', 'icon', 'confirm', 'isBusy', 'runBusy', 'api', 'state', 'card', 'run', 'afterLogsReloaded', `${body}\nreturn { rewindView, rewindStepPoint, rewindStepHtml, rewindFlowNote, rewindHistoryHtml, rewindConfirmMessage, rewindCard, readLogs, ensureLogsFresh };`);
const createAfter = new Function('state', 'renderDetailBody', 'scheduleProgress', '$', `${fnSource('afterLogsReloaded')}\nreturn afterLogsReloaded;`);
const createSelect = new Function(
  'setView', 'state', 'card', 'closeModal', 'isChat', '$', 'followAttach', 'hasChatActions', 'hasLogActions', 'setTab', 'renderBoard', 'renderDetailHead', 'updateBtwTab', 'updateTabsFor', 'markSeenIfOpen', 'readLogs', 'ensureLogsFresh', 'renderDetailBody',
  `${fnSource('select')}\nreturn select;`,
);

function harness({ tr = identityTr, confirm = () => true, busy = false, logs = async () => [], rewind = async () => 'ok' } = {}) {
  const state = { logs: new Map(), logsVersion: new Map(), logsLoading: new Map(), selected: null, tab: 'log', board: { cards: [] }, body: null };
  const calls = { confirm: [], rewind: [], reloaded: [], logs: 0, rendered: 0, scheduled: 0, run: 0, toasts: [] };
  const impl = { logs, rewind };
  let cardOf = (id) => state.board.cards.find((c) => c.id === id) || null;
  const afterLogsReloaded = createAfter(
    state,
    () => { calls.rendered += 1; },
    () => { calls.scheduled += 1; },
    (id) => (id === 'detailBody' ? state.body : null),
  );
  const api = {
    logs: async (id) => {
      calls.logs += 1;
      calls.lastLogsId = id;
      return impl.logs(id);
    },
    rewind: async (id, checkpointId) => {
      calls.rewind.push([id, checkpointId]);
      return impl.rewind(id, checkpointId);
    },
  };
  const fns = create(
    tr,
    agentShort,
    hhmm,
    () => '<svg class="ic clock"></svg>',
    (m) => {
      calls.confirm.push(m);
      return confirm(m);
    },
    () => busy,
    async (_msg, fn) => {
      try {
        return await fn();
      } catch (err) {
        calls.rewindError = err;
        return undefined;
      }
    },
    api,
    state,
    (id) => cardOf(id),
    async (fn) => {
      calls.run += 1;
      try {
        return await fn();
      } catch (err) {
        calls.logsError = err;
        calls.toasts.push(err.message);
        return undefined;
      }
    },
    (id) => {
      calls.reloaded.push(id);
      afterLogsReloaded(id);
    },
  );
  return {
    ...fns,
    afterLogsReloaded,
    state,
    calls,
    impl,
    setCard: (c) => { state.board.cards = c ? [c] : []; },
    setCards: (list) => { state.board.cards = list; },
    useCard: (fn) => { cardOf = fn; },
    bindSelect() {
      const detail = { n: 0 };
      const el = () => ({ classList: { toggle() {}, remove() {}, add() {} }, value: '' });
      const select = createSelect(
        () => {},
        state,
        (id) => state.board.cards.find((c) => c.id === id) || null,
        () => {},
        () => false,
        () => el(),
        { clear() {} },
        () => false,
        () => false,
        () => {},
        () => {},
        () => {},
        () => {},
        () => {},
        () => {},
        fns.readLogs,
        fns.ensureLogsFresh,
        () => { detail.n += 1; },
      );
      return { select, detail };
    },
  };
}

function point(over = {}) {
  return { id: 'cp1', at: Date.UTC(2026, 0, 2, 0, 5), seq: 1, label: '実装', stepIndex: 0, stepStart: true, agent: 'claude', ...over };
}
function card(rewind, over = {}) {
  return { id: 'card1', title: 'タスク', rewind, ...over };
}

function cps(html) {
  return [...html.matchAll(/data-cp="([^"]*)"/g)].map((m) => m[1]);
}

test('画面は渡された points を新しい順に出し、指示文は出さない', () => {
  const h = harness();
  assert.strictEqual(h.rewindHistoryHtml(null), '');
  assert.strictEqual(h.rewindHistoryHtml({}), '');
  assert.strictEqual(h.rewindHistoryHtml({ rewind: null }), '');
  assert.strictEqual(h.rewindHistoryHtml({ rewind: { points: null, blocked: '理由' } }), '');
  assert.strictEqual(h.rewindHistoryHtml({ rewind: { points: 'x' } }), '');
  assert.deepStrictEqual(h.rewindView({ rewind: [] }), { blocked: null, points: [] });
  assert.deepStrictEqual(h.rewindView({ rewind: { blocked: 1, points: {} } }), { blocked: null, points: [] });
  assert.strictEqual(h.rewindView({ rewind: { blocked: '   \n  ', points: [] } }).blocked, null);

  const c = card({
    blocked: null,
    points: [
      null,
      { id: '', label: '空' },
      { id: 12, label: '数値' },
      { label: 'idなし' },
      point({ id: 'a', seq: 1, label: '古い', at: 0, prompt: 'SECRET', stepIndex: '0', stepStart: 'yes' }),
      point({ id: 'b', seq: 2, label: '<b>新しい</b>', agent: '<img>', stepIndex: 1.5, at: Number.NaN }),
      point({ id: 'c', seq: 0, label: '', agent: 'codex', stepStart: false, stepIndex: -1, at: null }),
    ],
  });
  const html = h.rewindHistoryHtml(c);
  assert.deepStrictEqual(cps(html), ['c', 'b', 'a']);
  assert.ok(!html.includes('SECRET'));
  assert.ok(!html.includes('数値'));
  assert.ok(!html.includes('<b>新しい</b>'));
  assert.ok(html.includes('&lt;b&gt;新しい&lt;/b&gt;'));
  assert.ok(!html.includes('<img>'));
  assert.ok(html.includes('Claude'));
  assert.ok(html.includes('Codex'));
  assert.ok(html.includes('（名前なし）'));
  assert.ok(html.includes('ここに戻す'));
  assert.ok(html.includes('履歴'));
  assert.ok(html.includes('新しい順'));
  assert.ok(html.includes('clock'));
  assert.ok(html.includes('>#0<'));
  assert.ok(html.includes(`>${hhmm(0)}<`));
  assert.equal((html.match(/class="rw-t"/g) || []).length, 1);
  assert.ok(!html.includes('disabled'));
  assert.ok(!html.includes('title='));
  const view = h.rewindView(c);
  assert.strictEqual(view.points[0].stepIndex, null);
  assert.strictEqual(view.points[0].stepStart, false);
  assert.strictEqual(view.points[1].at, null);
  assert.strictEqual(view.points[2].stepIndex, null);
});

test('工程のボタンは、その工程の最初の実行へ向く', () => {
  const h = harness();
  const points = [
    point({ id: 'later', seq: 5, stepIndex: 0, stepStart: true, label: '2回目' }),
    point({ id: 'earlier', seq: 2, stepIndex: 0, stepStart: true, label: '1回目' }),
    point({ id: 'same', seq: 2, stepIndex: 0, stepStart: true, label: '同点' }),
    point({ id: 'nostart', seq: 1, stepIndex: 0, stepStart: false }),
    point({ id: 'step1', seq: 3, stepIndex: 1, stepStart: true, label: 'レビュー' }),
    point({ id: 'nosq', seq: null, stepIndex: 1, stepStart: true, label: 'seqなし' }),
    point({ id: 'far', seq: 9, stepIndex: 1000000, stepStart: true, label: '範囲外' }),
  ];
  const view = h.rewindView(card({ points }));
  assert.strictEqual(h.rewindStepPoint(view.points, 0).id, 'earlier');
  assert.strictEqual(h.rewindStepPoint(view.points, 1).id, 'step1');
  assert.strictEqual(h.rewindStepPoint(view.points, 2), null);
  assert.strictEqual(h.rewindStepPoint(view.points, 1000000).id, 'far');
  assert.strictEqual(h.rewindStepPoint([], 0), null);
  assert.strictEqual(h.rewindStepHtml(view, 2), '');
  assert.strictEqual(h.rewindStepHtml(null, 0), '');
  const b0 = h.rewindStepHtml(view, 0);
  const b1 = h.rewindStepHtml(view, 1);
  assert.ok(b0.includes('data-cp="earlier"'));
  assert.ok(b0.includes('ここからやり直す'));
  assert.ok(!b0.includes('disabled'));
  assert.ok(!b0.includes('title='));
  assert.ok(b1.includes('data-cp="step1"'));
  assert.strictEqual(h.rewindFlowNote(view, 2).includes('rf-rewind-note'), false);
  assert.strictEqual(h.rewindFlowNote(view, 0), '');
  assert.strictEqual(h.rewindFlowNote(view, -1), '');
  assert.strictEqual(h.rewindFlowNote(view, 1.5), '');
  assert.match(h.rewindHistoryHtml(card({ points })), /工程の最初/);
  const none = h.rewindView(card({ points: [point({ id: 'x', seq: null, stepIndex: 0, stepStart: true }), point({ id: 'y', seq: 0, stepIndex: 0, stepStart: true })] }));
  assert.strictEqual(h.rewindStepPoint(none.points, 0).id, 'y');
});

test('blocked のときはボタンを無効にし、理由を出す', () => {
  const h = harness();
  const reason = '  実行中は戻せません\n<script>  ';
  const c = card({
    blocked: reason,
    points: [point({ id: 'a&"b', label: '実装' }), point({ id: 'z', stepIndex: 1, label: 'レビュー' })],
  });
  const html = h.rewindHistoryHtml(c);
  assert.equal((html.match(/ disabled/g) || []).length, 2);
  assert.ok(html.includes('実行中は戻せません'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('data-cp="a&amp;&quot;b"'));
  assert.ok(html.includes('title="実行中は戻せません &lt;script&gt;"'));
  const view = h.rewindView(c);
  const note = h.rewindFlowNote(view, 2);
  assert.ok(note.includes('実行中は戻せません'));
  assert.ok(note.includes('&lt;script&gt;'));
  assert.ok(h.rewindStepHtml(view, 0).includes(' disabled'));
  assert.strictEqual(h.rewindFlowNote(h.rewindView(card({ blocked: '理由', points: [point({ stepStart: false })] })), 3), '');
});

test('101件まで捨てずに新しい順で出す', () => {
  const h = harness();
  const points = [];
  for (let i = 0; i < 101; i++) points.push(point({ id: `p${i}`, seq: i, label: `L${i}`, stepStart: i === 0, stepIndex: 0 }));
  const html = h.rewindHistoryHtml(card({ points }));
  const ids = cps(html);
  assert.strictEqual(ids.length, 101);
  assert.strictEqual(ids[0], 'p100');
  assert.strictEqual(ids[100], 'p0');
  assert.ok(h.rewindStepHtml(h.rewindView(card({ points })), 0).includes('data-cp="p0"'));
});

test('確認してから戻す。キャンセル・拒否・失敗では動かさない', async () => {
  const c = card({ points: [point({ id: 'a&b', label: '<設計>' })] });
  const ok = harness();
  ok.setCard(c);
  await ok.rewindCard(c, 'a&b');
  assert.strictEqual(ok.calls.confirm.length, 1);
  assert.ok(ok.calls.confirm[0].includes('あとの変更は捨てられ、元に戻せません'));
  assert.ok(ok.calls.confirm[0].includes('すぐに動き始めます'));
  assert.ok(ok.calls.confirm[0].includes('<設計>'));
  assert.ok(!ok.calls.confirm[0].includes('&lt;'));
  assert.deepStrictEqual(ok.calls.rewind, [['card1', 'a&b']]);

  const cancel = harness({ confirm: () => false });
  cancel.setCard(c);
  await cancel.rewindCard(c, 'a&b');
  assert.strictEqual(cancel.calls.confirm.length, 1);
  assert.deepStrictEqual(cancel.calls.rewind, []);

  const blocked = harness();
  const bc = card({ blocked: 'PR があります', points: [point()] });
  blocked.setCard(bc);
  await blocked.rewindCard(bc, 'cp1');
  assert.deepStrictEqual(blocked.calls.confirm, []);
  assert.deepStrictEqual(blocked.calls.rewind, []);

  const missing = harness();
  missing.setCard(c);
  await missing.rewindCard(c, 'ない');
  await missing.rewindCard(c, '');
  await missing.rewindCard(c, 1);
  await missing.rewindCard(null, 'a&b');
  assert.deepStrictEqual(missing.calls.confirm, []);

  const unnamed = harness();
  unnamed.setCard(card({ points: [point({ label: '' })] }));
  await unnamed.rewindCard(unnamed.state.board.cards[0], 'cp1');
  assert.ok(unnamed.calls.confirm[0].startsWith('この時点に戻しますか？'));

  const busy = harness({ busy: true });
  busy.setCard(c);
  await busy.rewindCard(c, 'a&b');
  assert.deepStrictEqual(busy.calls.confirm, []);

  const boom = harness({ rewind: async () => { throw new Error('reset に失敗しました'); } });
  boom.setCard(c);
  await assert.doesNotReject(() => boom.rewindCard(c, 'a&b'));
  assert.strictEqual(boom.calls.rewindError.message, 'reset に失敗しました');
});

test('確認の文言は、選んだ言語になり、日本語では捨てることと動き始めることを言う', () => {
  const ja = harness();
  const en = harness({ tr: I18n.tr });
  I18n.setLanguage('ja');
  const jaMsg = ja.rewindConfirmMessage({ label: '設計' });
  assert.ok(jaMsg.includes('「設計」'));
  assert.ok(jaMsg.includes('あとの変更は捨てられ、元に戻せません'));
  assert.ok(jaMsg.includes('すぐに動き始めます'));
  I18n.setLanguage('en');
  const enMsg = en.rewindConfirmMessage({ label: 'Design' });
  assert.ok(enMsg.includes('“Design”'));
  assert.ok(enMsg.includes('cannot be undone'));
  assert.ok(enMsg.includes('starts again right away'));
  assert.ok(!enMsg.includes('あとの変更'));
  I18n.setLanguage('es');
  assert.ok(en.rewindConfirmMessage({ label: 'Diseño' }).includes('«Diseño»'));
  I18n.setLanguage('fr');
  assert.ok(en.rewindConfirmMessage({}).includes('ce moment'));
  I18n.setLanguage('zh');
  assert.ok(en.rewindConfirmMessage({ label: '设计' }).includes('「设计」'));
  I18n.setLanguage('ja');
});

test('logsVersion が変わったときだけログを読み直し、失敗や古い結果では残す', async () => {
  const h = harness({ logs: async () => [{ kind: 'text', text: '新しい' }] });
  const c = card(null, { logsVersion: 1 });
  h.setCard(c);
  await h.ensureLogsFresh(c);
  assert.strictEqual(h.calls.logs, 0, 'まだログを持っていないときは読まない');

  h.state.logs.set(c.id, [{ text: '古い' }]);
  await h.ensureLogsFresh(c);
  assert.strictEqual(h.calls.logs, 1, '覚えていない版と、カードの版が違えば読む');
  assert.deepStrictEqual(h.state.logs.get(c.id), [{ kind: 'text', text: '新しい' }]);
  assert.strictEqual(h.state.logsVersion.get(c.id), 1);
  assert.deepStrictEqual(h.calls.reloaded, [c.id]);

  await h.ensureLogsFresh(c);
  assert.strictEqual(h.calls.logs, 1, '同じ版では読まない');

  const untouched = harness();
  const cu = card(null, { id: 'u' });
  untouched.setCard(cu);
  untouched.state.logs.set(cu.id, [{ text: 'a' }]);
  await untouched.ensureLogsFresh(cu);
  assert.strictEqual(untouched.calls.logs, 0, 'どちらも undefined なら読まない');

  c.logsVersion = 0;
  await h.ensureLogsFresh(c);
  assert.strictEqual(h.calls.logs, 2, '0 も版として扱う');
  assert.strictEqual(h.state.logsVersion.get(c.id), 0);

  const empty = harness({ logs: async () => [] });
  const c2 = card(null, { id: 'card2', logsVersion: 2 });
  empty.setCard(c2);
  empty.state.logs.set(c2.id, [{ text: '残っている' }]);
  empty.state.logsVersion.set(c2.id, 1);
  await empty.ensureLogsFresh(c2);
  assert.deepStrictEqual(empty.state.logs.get(c2.id), []);
  assert.deepStrictEqual(empty.calls.reloaded, [c2.id]);

  const bad = harness({ logs: async () => { throw new Error('読めません'); } });
  const c3 = card(null, { id: 'card3', logsVersion: 4 });
  bad.setCard(c3);
  bad.state.logs.set(c3.id, [{ text: '残す' }]);
  bad.state.logsVersion.set(c3.id, 3);
  await bad.ensureLogsFresh(c3);
  assert.deepStrictEqual(bad.state.logs.get(c3.id), [{ text: '残す' }]);
  assert.strictEqual(bad.state.logsVersion.get(c3.id), 3);
  assert.deepStrictEqual(bad.calls.reloaded, []);
  assert.strictEqual(bad.calls.run, 0, '失敗でトーストを出さない');
  assert.deepStrictEqual(bad.calls.toasts, []);
  bad.impl.logs = async () => [{ text: 'やり直した' }];
  await bad.ensureLogsFresh(c3);
  assert.deepStrictEqual(bad.state.logs.get(c3.id), [{ text: 'やり直した' }]);
  assert.strictEqual(bad.state.logsVersion.get(c3.id), 4);
  assert.strictEqual(bad.calls.run, 0);

  const obj = harness({ logs: async () => ({ not: 'array' }) });
  const c4 = card(null, { id: 'card4', logsVersion: 2 });
  obj.setCard(c4);
  obj.state.logs.set(c4.id, [{ text: '残す' }]);
  obj.state.logsVersion.set(c4.id, 1);
  await obj.ensureLogsFresh(c4);
  assert.deepStrictEqual(obj.state.logs.get(c4.id), [{ text: '残す' }]);
  assert.deepStrictEqual(obj.calls.reloaded, []);
});

test('読み直しているあいだに版が変わったら、古い結果は捨てて新しい版を読む', async () => {
  let first;
  const h = harness({ logs: () => new Promise((res) => { first = res; }) });
  const c = card(null, { logsVersion: 2 });
  h.setCard(c);
  h.state.logs.set(c.id, [{ text: 'v1' }]);
  h.state.logsVersion.set(c.id, 1);
  const pending = h.ensureLogsFresh(c);
  c.logsVersion = 3;
  h.impl.logs = async () => [{ text: 'v3' }];
  first([{ text: 'v2' }]);
  await pending;
  assert.deepStrictEqual(h.state.logs.get(c.id), [{ text: 'v3' }]);
  assert.strictEqual(h.state.logsVersion.get(c.id), 3);
  assert.deepStrictEqual(h.calls.reloaded, [c.id]);
});

test('同じ版のボード更新が重なっても、ログの読みは1回で、その結果が残る', async () => {
  let release;
  const h = harness({ logs: () => new Promise((res) => { release = res; }) });
  const c = card(null, { logsVersion: 2 });
  h.setCard(c);
  h.state.logs.set(c.id, [{ text: 'old' }]);
  h.state.logsVersion.set(c.id, 1);
  const p1 = h.ensureLogsFresh(c);
  const p2 = h.ensureLogsFresh(c);
  const p3 = h.ensureLogsFresh(c);
  assert.strictEqual(h.calls.logs, 1);
  release([{ text: 'kept' }]);
  await Promise.all([p1, p2, p3]);
  assert.strictEqual(h.calls.logs, 1);
  assert.deepStrictEqual(h.state.logs.get(c.id), [{ text: 'kept' }]);
  assert.strictEqual(h.state.logsVersion.get(c.id), 2);
  assert.deepStrictEqual(h.calls.reloaded, [c.id, c.id, c.id]);
  assert.strictEqual(h.calls.run, 0);

  let releaseFail;
  const fail = harness({ logs: () => new Promise((_, rej) => { releaseFail = rej; }) });
  const cf = card(null, { id: 'cf', logsVersion: 4 });
  fail.setCard(cf);
  fail.state.logs.set(cf.id, [{ text: '残す' }]);
  fail.state.logsVersion.set(cf.id, 3);
  const f1 = fail.ensureLogsFresh(cf);
  const f2 = fail.ensureLogsFresh(cf);
  assert.strictEqual(fail.calls.logs, 1);
  releaseFail(new Error('読めません'));
  await Promise.all([f1, f2]);
  assert.deepStrictEqual(fail.state.logs.get(cf.id), [{ text: '残す' }]);
  assert.strictEqual(fail.state.logsVersion.get(cf.id), 3);
  assert.deepStrictEqual(fail.calls.reloaded, []);
  assert.deepStrictEqual(fail.calls.toasts, []);
  assert.strictEqual(fail.calls.run, 0);
  fail.impl.logs = async () => [{ text: '次の更新' }];
  await fail.ensureLogsFresh(cf);
  assert.strictEqual(fail.calls.logs, 2);
  assert.deepStrictEqual(fail.state.logs.get(cf.id), [{ text: '次の更新' }]);
  assert.strictEqual(fail.state.logsVersion.get(cf.id), 4);
});

test('重なった読み直しでは、あとから来た結果だけを残す', async () => {
  let resolve1;
  let resolve2;
  let n = 0;
  const h = harness({
    logs: () => {
      n += 1;
      if (n === 1) return new Promise((res) => { resolve1 = res; });
      return new Promise((res) => { resolve2 = res; });
    },
  });
  const c = card(null, { logsVersion: 2 });
  h.setCard(c);
  h.state.logs.set(c.id, [{ text: 'old' }]);
  h.state.logsVersion.set(c.id, 1);
  const p1 = h.ensureLogsFresh(c);
  c.logsVersion = 3;
  const p2 = h.ensureLogsFresh(c);
  resolve2([{ text: 'new' }]);
  await p2;
  resolve1([{ text: 'stale' }]);
  await p1;
  assert.deepStrictEqual(h.state.logs.get(c.id), [{ text: 'new' }]);
  assert.strictEqual(h.state.logsVersion.get(c.id), 3);
});

test('読み直したあとは、開いているログと進捗を描き直す', () => {
  const h = harness();
  h.state.selected = 'card1';
  h.state.body = { dataset: { progressSig: 'keep' } };
  h.afterLogsReloaded('other');
  assert.strictEqual(h.calls.rendered, 0);
  assert.strictEqual(h.calls.scheduled, 0);

  h.state.tab = 'log';
  h.afterLogsReloaded('card1');
  assert.strictEqual(h.calls.rendered, 1);

  h.state.tab = 'chat';
  h.afterLogsReloaded('card1');
  assert.strictEqual(h.calls.rendered, 2);

  h.state.tab = 'diff';
  h.afterLogsReloaded('card1');
  assert.strictEqual(h.calls.rendered, 2);
  assert.strictEqual(h.calls.scheduled, 0);

  h.state.tab = 'progress';
  h.afterLogsReloaded('card1');
  assert.strictEqual(h.state.body.dataset.progressSig, '');
  assert.strictEqual(h.calls.scheduled, 1);

  h.state.body = null;
  h.afterLogsReloaded('card1');
  assert.strictEqual(h.calls.scheduled, 2);
});

test('select が失敗したときは空のログとして覚えず、次に開いたら読み直す', async () => {
  const boom = harness({ logs: async () => { throw new Error('読めません'); } });
  const c = card(null, { logsVersion: 3 });
  boom.setCard(c);
  boom.state.tab = 'diff';
  const open = boom.bindSelect();
  await open.select(c.id);
  assert.strictEqual(boom.state.logs.has(c.id), false);
  assert.strictEqual(boom.state.logsVersion.has(c.id), false);
  assert.strictEqual(boom.calls.logs, 1);
  assert.strictEqual(boom.calls.run, 0);
  assert.deepStrictEqual(boom.calls.toasts, []);
  assert.strictEqual(open.detail.n, 1, '失敗でも画面は開く');

  const weird = harness({ logs: async () => ({ not: 'array' }) });
  const cw = card(null, { id: 'cw', logsVersion: 1 });
  weird.setCard(cw);
  weird.state.tab = 'diff';
  const openW = weird.bindSelect();
  await openW.select(cw.id);
  assert.strictEqual(weird.state.logs.has(cw.id), false);
  assert.strictEqual(weird.state.logsVersion.has(cw.id), false);

  boom.impl.logs = async () => [{ text: '読めた' }];
  await open.select(c.id);
  assert.deepStrictEqual(boom.state.logs.get(c.id), [{ text: '読めた' }]);
  assert.strictEqual(boom.state.logsVersion.get(c.id), 3);
  assert.strictEqual(boom.calls.logs, 2);
  assert.strictEqual(open.detail.n, 2);
});

test('select の古い応答が新しい成功のあとでも、空や古いログで上書きしない', async () => {
  const pending = [];
  const h = harness({
    logs: () => new Promise((res, rej) => { pending.push({ res, rej }); }),
  });
  const c = card(null, { logsVersion: 1 });
  h.setCard(c);
  h.state.tab = 'diff';
  const open = h.bindSelect();
  const first = open.select(c.id);
  c.logsVersion = 2;
  const second = open.select(c.id);
  assert.strictEqual(h.calls.logs, 2);
  pending[1].res([{ text: '新しい' }]);
  await second;
  assert.deepStrictEqual(h.state.logs.get(c.id), [{ text: '新しい' }]);
  assert.strictEqual(h.state.logsVersion.get(c.id), 2);
  const drawn = open.detail.n;
  assert.ok(drawn >= 1);
  pending[0].res([{ text: '古い' }]);
  await first;
  assert.deepStrictEqual(h.state.logs.get(c.id), [{ text: '新しい' }]);
  assert.strictEqual(h.state.logsVersion.get(c.id), 2);
  assert.strictEqual(open.detail.n, drawn, '捨てた結果の時点では描かない');

  const pending2 = [];
  const h2 = harness({
    logs: () => new Promise((res, rej) => { pending2.push({ res, rej }); }),
  });
  const c2 = card(null, { id: 'card2', logsVersion: 1 });
  h2.setCard(c2);
  h2.state.tab = 'diff';
  const open2 = h2.bindSelect();
  const oldRead = open2.select(c2.id);
  c2.logsVersion = 4;
  const newRead = open2.select(c2.id);
  pending2[1].res([]);
  await newRead;
  assert.deepStrictEqual(h2.state.logs.get(c2.id), []);
  assert.strictEqual(h2.state.logsVersion.get(c2.id), 4);
  const drawn2 = open2.detail.n;
  pending2[0].rej(new Error('遅い失敗'));
  await oldRead;
  assert.deepStrictEqual(h2.state.logs.get(c2.id), []);
  assert.strictEqual(h2.state.logsVersion.get(c2.id), 4);
  assert.strictEqual(open2.detail.n, drawn2);
  assert.deepStrictEqual(h2.calls.toasts, []);
});

test('select は、いちばん新しい読みが終わってから描く', async () => {
  const pending = [];
  const h = harness({
    logs: () => new Promise((res) => { pending.push(res); }),
  });
  const c = card(null, { logsVersion: 1 });
  h.setCard(c);
  h.state.tab = 'diff';
  const open = h.bindSelect();
  const done = open.select(c.id);
  assert.strictEqual(open.detail.n, 0);
  c.logsVersion = 2;
  pending[0]([{ text: '古い' }]);
  for (let i = 0; i < 20 && pending.length < 2; i++) await Promise.resolve();
  assert.strictEqual(pending.length, 2);
  assert.strictEqual(open.detail.n, 0, '古い結果の時点では描かない');
  assert.deepStrictEqual(h.state.logs.get(c.id), [{ text: '古い' }]);
  assert.strictEqual(h.state.logsVersion.get(c.id), 1);
  pending[1]([{ text: '新しい' }]);
  await done;
  assert.deepStrictEqual(h.state.logs.get(c.id), [{ text: '新しい' }]);
  assert.strictEqual(h.state.logsVersion.get(c.id), 2);
  assert.strictEqual(open.detail.n, 1);
  assert.strictEqual(h.calls.run, 0);
});

test('カードが消えていたら、届いたログは捨てる', async () => {
  let release;
  const h = harness({ logs: () => new Promise((res) => { release = res; }) });
  const c = card(null, { logsVersion: 2 });
  h.setCard(c);
  h.state.logs.set(c.id, [{ text: 'old' }]);
  h.state.logsVersion.set(c.id, 1);
  const pending = h.ensureLogsFresh(c);
  h.setCards([]);
  release([{ text: 'new' }]);
  await pending;
  assert.deepStrictEqual(h.state.logs.get(c.id), [{ text: 'old' }]);
  assert.deepStrictEqual(h.calls.reloaded, []);
});

test('工程と履歴と、ログの読み直しが画面に繋がっている', () => {
  assert.match(fnSource('relayFlowHtml'), /rewindStepHtml\(rw, i\)/);
  assert.match(fnSource('relayFlowHtml'), /rewindFlowNote\(rw, r\.steps\.length\)/);
  assert.match(fnSource('progressHtml'), /rewindHistoryHtml\(c\)/);
  const act = fnSource('detailAction');
  assert.match(act, /act === 'rewind'/);
  assert.match(act, /btn\.disabled/);
  assert.match(act, /rewindCard\(c, btn\.dataset\.cp\)/);
  assert.match(fnSource('select'), /logsVersion\.set\(id, seen\)/);
  assert.match(fnSource('select'), /ensureLogsFresh\(card\(id\)\)/);
  assert.match(fnSource('select'), /readLogs\(id, seen\)/);
  assert.match(fnSource('select'), /logs === 'superseded'/);
  assert.match(fnSource('ensureLogsFresh'), /readLogs\(c\.id, version\)/);
  assert.doesNotMatch(fnSource('ensureLogsFresh'), /\brun\s*\(/);
  assert.doesNotMatch(fnSource('readLogs'), /\brun\s*\(/);
  assert.doesNotMatch(fnSource('select'), /\brun\s*\(/);
  const onBoard = src.slice(src.indexOf('api.onBoard'));
  assert.match(onBoard, /ensureLogsFresh\(c\)/);
  assert.match(fnSource('afterLogsReloaded'), /state\.tab === 'log' \|\| state\.tab === 'chat'/);
  assert.match(fnSource('afterLogsReloaded'), /scheduleProgress\(\)/);
  assert.match(css, /\.pg-rewind/);
  assert.match(css, /\.rf-rewind-note/);
  assert.match(css, /\.rw-blocked/);
  assert.match(css, /\.btn:disabled/);
});
