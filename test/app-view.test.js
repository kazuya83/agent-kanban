const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { VIEW_KEY, normalizeView, loadView, saveView, canSchedule, bindNavMenu } = require('../renderer/app-view.js');
const { ICON_NAMES, NOTIF_ICON } = require('../renderer/icons.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}
const brokenStorage = {
  getItem() {
    throw new Error('storage disabled');
  },
  setItem() {
    throw new Error('quota exceeded');
  },
};

test('normalizeView: 知らない値はカンバン管理にする', () => {
  assert.strictEqual(normalizeView('kanban'), 'kanban');
  assert.strictEqual(normalizeView('scheduler'), 'scheduler');
  for (const v of [undefined, null, '', 'Scheduler', 'nope', 0, {}, ['scheduler']]) assert.strictEqual(normalizeView(v), 'kanban');
});

test('選んだ画面を覚えて、次の起動で読み直す', () => {
  const s = memoryStorage();
  assert.strictEqual(loadView(s), 'kanban'); // 初回
  saveView(s, 'scheduler');
  assert.strictEqual(loadView(s), 'scheduler');
  saveView(s, 'kanban');
  assert.strictEqual(loadView(s), 'kanban');
});

test('保存された値が壊れていたらカンバン管理にする', () => {
  assert.strictEqual(loadView(memoryStorage({ [VIEW_KEY]: 'calendar' })), 'kanban');
  const s = memoryStorage();
  saveView(s, 'nope');
  assert.strictEqual(s.getItem(VIEW_KEY), 'kanban');
});

test('保存先が使えなくても例外を出さない', () => {
  assert.strictEqual(loadView(brokenStorage), 'kanban');
  assert.doesNotThrow(() => saveView(brokenStorage, 'scheduler'));
});

test('canSchedule: ふつうのタスクには出し、会話・サブタスク・Pipeline の枝には出さない', () => {
  assert.strictEqual(canSchedule({ status: 'todo' }), true);
  assert.strictEqual(canSchedule({ status: 'done' }), true);
  assert.strictEqual(canSchedule({ noGit: true, readOnly: true }), true);
  assert.strictEqual(canSchedule({ relay: { index: 0 } }), true, 'Pipeline の本体は登録できる');
  assert.strictEqual(canSchedule({ compete: { group: 'g' } }), true, '競争のタスクは登録できる');
  assert.strictEqual(canSchedule({ scheduleId: 's1' }), true, 'スケジュールから作られたタスクも登録できる');

  assert.strictEqual(canSchedule({ kind: 'chat' }), false);
  assert.strictEqual(canSchedule({ subtaskOf: 'parent' }), false);
  assert.strictEqual(canSchedule({ relay: { branchOf: { parent: 'p', index: 0 } } }), false);
  assert.strictEqual(canSchedule(null), false);
  assert.strictEqual(canSchedule(undefined), false);
});

// ---- ハンバーガーメニュー（DOM の代わりに、使う分だけの小さな偽物で動かす） ----

function fakeTarget() {
  const handlers = [];
  return {
    addEventListener(type, fn, capture) {
      handlers.push({ type, fn, capture: !!capture });
    },
    handlers,
  };
}

function fakeMenu() {
  const doc = fakeTarget();
  const inside = new Set();
  const button = {
    ...fakeTarget(),
    attrs: {},
    focused: 0,
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    focus() {
      this.focused++;
    },
    contains: (t) => t === button || inside.has(t),
  };
  const classes = new Set(['hidden']);
  const menu = {
    ...fakeTarget(),
    classList: {
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    contains: (t) => t === menu || inside.has(t),
  };
  const selected = [];
  const nav = bindNavMenu({ button, menu, doc, onSelect: (v) => selected.push(v) });
  const fire = (target, type, ev = {}) => {
    const e = { stopImmediatePropagation() { this.stopped = true; }, ...ev };
    for (const h of target.handlers.filter((x) => x.type === type)) h.fn(e);
    return e;
  };
  const item = (view) => {
    const el = { dataset: { view }, closest: () => el };
    inside.add(el);
    return el;
  };
  return { doc, button, menu, nav, fire, item, selected };
}

test('メニュー: ボタンで開け閉めでき、aria-expanded が追従する', () => {
  const m = fakeMenu();
  assert.strictEqual(m.nav.isOpen(), false);
  m.fire(m.button, 'click');
  assert.strictEqual(m.nav.isOpen(), true);
  assert.strictEqual(m.button.attrs['aria-expanded'], 'true');
  m.fire(m.button, 'click');
  assert.strictEqual(m.nav.isOpen(), false);
  assert.strictEqual(m.button.attrs['aria-expanded'], 'false');
});

test('メニュー: 項目を選ぶと閉じて、選んだ画面を知らせる', () => {
  const m = fakeMenu();
  m.fire(m.button, 'click');
  const it = m.item('scheduler');
  m.fire(m.menu, 'click', { target: it });
  assert.deepStrictEqual(m.selected, ['scheduler']);
  assert.strictEqual(m.nav.isOpen(), false);
});

test('メニュー: 項目の外（余白）のクリックでは何も選ばず、開いたまま', () => {
  const m = fakeMenu();
  m.fire(m.button, 'click');
  m.fire(m.menu, 'click', { target: { closest: () => null } });
  assert.deepStrictEqual(m.selected, []);
  assert.strictEqual(m.nav.isOpen(), true);
});

test('メニュー: 外側のクリックで閉じ、内側やボタンでは閉じない', () => {
  const m = fakeMenu();
  m.fire(m.button, 'click');
  m.fire(m.doc, 'mousedown', { target: m.item('kanban') });
  assert.strictEqual(m.nav.isOpen(), true, 'メニューの項目');
  m.fire(m.doc, 'mousedown', { target: m.button });
  assert.strictEqual(m.nav.isOpen(), true, 'ボタンは click 側で閉じる（ここで閉じると開き直してしまう）');
  m.fire(m.doc, 'mousedown', { target: {} });
  assert.strictEqual(m.nav.isOpen(), false, '外側');
});

test('メニュー: 開いているときの Esc は閉じるだけで、詳細パネルなどへ伝えない', () => {
  const m = fakeMenu();
  m.fire(m.button, 'click');
  const key = m.doc.handlers.find((h) => h.type === 'keydown');
  assert.strictEqual(key.capture, true, '詳細パネルの Esc より先に受ける');
  const e = m.fire(m.doc, 'keydown', { key: 'Escape' });
  assert.strictEqual(e.stopped, true);
  assert.strictEqual(m.nav.isOpen(), false);
  assert.strictEqual(m.button.focused, 1, 'フォーカスをボタンへ戻す');
});

test('メニュー: 閉じているときの Esc とほかのキーには触らない', () => {
  const m = fakeMenu();
  const closed = m.fire(m.doc, 'keydown', { key: 'Escape' });
  assert.strictEqual(closed.stopped, undefined, '閉じているときは、詳細パネルの Esc を止めない');
  assert.strictEqual(m.button.focused, 0);
  m.fire(m.button, 'click');
  const other = m.fire(m.doc, 'keydown', { key: 'Enter' });
  assert.strictEqual(other.stopped, undefined);
  assert.strictEqual(m.nav.isOpen(), true);
});

// ---- 画面の組み立て ----

test('index.html: メニューと画面の置き場所がある', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('id="navBtn"') < html.indexOf('class="brand"'), 'ハンバーガーはトップバーの左端');
  assert.match(html, /id="schedulerView"[^>]*class="[^"]*\bhidden\b/, '最初はスケジューラ画面を隠す');
  assert.match(html, /data-view="kanban"/);
  assert.match(html, /data-view="scheduler"/);
  assert.match(html, /href="scheduler\.css"/);
});

test('index.html: スクリプトの読み込み順', () => {
  const order = [...read('index.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const at = (f) => {
    assert.ok(order.includes(f), f);
    return order.indexOf(f);
  };
  assert.ok(at('app-view.js') < at('renderer.js'), 'renderer.js は読み込みのときから AppView を使う');
  assert.ok(at('schedule-model.js') < at('renderer.js'));
  assert.ok(at('renderer.js') < at('scheduler-view.js'), 'SchedulerView は renderer.js の関数を使う');
});

test('スケジュールのアイコンがある', () => {
  assert.ok(ICON_NAMES.includes('menu'));
  assert.ok(ICON_NAMES.includes('calendar'));
  assert.strictEqual(NOTIF_ICON.schedule, 'calendar');
});

test('app-view.js に絵文字がない', () => {
  assert.doesNotMatch(read('app-view.js'), /[\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{FE0F}]/u);
});
