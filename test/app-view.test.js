const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { VIEWS, VIEW_KEY, SETTINGS_NAV, normalizeView, loadView, saveView, isPipelineSubtask, canSchedule, bindNavMenu, settingsNavHtml, activeSection, bindSettingsNav } = require('../renderer/app-view.js');
const { icon, ICON_NAMES, NOTIF_ICON } = require('../renderer/icons.js');

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
  assert.strictEqual(normalizeView('settings'), 'settings');
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

test('設定画面は覚えず、次の起動はその前の画面に戻る', () => {
  assert.ok(VIEWS.includes('settings'));
  const s = memoryStorage();
  saveView(s, 'scheduler');
  saveView(s, 'settings');
  assert.strictEqual(s.getItem(VIEW_KEY), 'scheduler', '前の画面を上書きしない');
  assert.strictEqual(loadView(s), 'scheduler');

  const first = memoryStorage();
  saveView(first, 'settings');
  assert.strictEqual(first.getItem(VIEW_KEY), null, '最初に設定を開いても何も書かない');
  assert.strictEqual(loadView(first), 'kanban');
});

test('保存先に settings が残っていてもカンバン管理で起動する', () => {
  assert.strictEqual(loadView(memoryStorage({ [VIEW_KEY]: 'settings' })), 'kanban');
});

test('設定を開いたときに保存先が壊れていても例外を出さない', () => {
  assert.doesNotThrow(() => saveView(brokenStorage, 'settings'));
});

test('isPipelineSubtask: 並列の枝だけ true', () => {
  assert.strictEqual(isPipelineSubtask({ relay: { branchOf: { parent: 'p', index: 0 } } }), true);
  assert.strictEqual(isPipelineSubtask({ title: 'ふつうのカード' }), false);
  assert.strictEqual(isPipelineSubtask({ relay: { index: 0 } }), false, 'Pipeline の本体（branchOf なし）');
  assert.strictEqual(isPipelineSubtask({ subtaskOf: 'parent' }), false);
  assert.strictEqual(isPipelineSubtask(null), false);
});

test('isPipelineSubtask: 空や偽の branchOf は枝にせず、カードも書き換えない', () => {
  for (const c of [undefined, 0, '', false, [], {}]) assert.strictEqual(isPipelineSubtask(c), false, String(c));
  for (const relay of [null, undefined, 0, '', false, [], {}]) assert.strictEqual(isPipelineSubtask({ relay }), false);
  for (const branchOf of [null, undefined, '', 0, false]) {
    assert.strictEqual(isPipelineSubtask({ relay: { branchOf } }), false, String(branchOf));
  }
  // index が 0 でも、branchOf 自体があれば枝。空のオブジェクトも真
  assert.strictEqual(isPipelineSubtask({ relay: { branchOf: { parent: 'p', index: 0 } } }), true);
  assert.strictEqual(isPipelineSubtask({ relay: { branchOf: { parent: '', index: 0, label: '' } } }), true);
  assert.strictEqual(isPipelineSubtask({ relay: { branchOf: {} } }), true);
  assert.strictEqual(isPipelineSubtask({ subtaskOf: { parent: 'p' }, relay: { branchOf: { parent: 'p', index: 0 } } }), true, '手動のサブタスクと重なっても branchOf があれば true');

  const c = { title: '枝', subtaskOf: undefined, relay: { branchOf: { parent: 'p', index: 0, label: '実装' } } };
  const snap = JSON.stringify(c);
  assert.strictEqual(isPipelineSubtask(c), true);
  assert.strictEqual(JSON.stringify(c), snap, '判定は branchOf を subtaskOf に移さない');
  assert.strictEqual(c.subtaskOf, undefined);
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

test('canSchedule: 偽の branchOf は登録でき、真の branchOf は index が 0 でも登録できない', () => {
  const src = read('app-view.js');
  const fn = src.slice(src.indexOf('function canSchedule'), src.indexOf('function bindNavMenu'));
  assert.match(fn, /!isPipelineSubtask\(c\)/);
  assert.doesNotMatch(fn, /branchOf/, '枝の判定は isPipelineSubtask に任せている');

  for (const branchOf of [null, undefined, '', 0, false]) {
    assert.strictEqual(canSchedule({ relay: { index: 0, branchOf } }), true, String(branchOf));
  }
  assert.strictEqual(canSchedule({ relay: { branchOf: { parent: 'p', index: 0 } } }), false, '最初の枝（index 0）も登録しない');
  assert.strictEqual(canSchedule({ relay: { branchOf: {} } }), false);
  assert.strictEqual(canSchedule({ kind: 'chat', relay: { branchOf: { parent: 'p', index: 0 } } }), false);
  assert.strictEqual(canSchedule({ subtaskOf: { parent: 'p' }, relay: { branchOf: { parent: 'p', index: 0 } } }), false);
  assert.strictEqual(canSchedule({ subtaskOf: '', relay: { index: 0 } }), true, '空文字の subtaskOf は手動のサブタスクにしない');
  assert.strictEqual(canSchedule({ subtaskOf: '', relay: { branchOf: { parent: 'p', index: 0 } } }), false);
  assert.strictEqual(canSchedule({}), true);
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

// ---- 設定画面の左の一覧 ----

const SECTION_IDS = ['general', 'update', 'branch', 'issue', 'permission', 'task', 'agents', 'custom', 'orchestration'];

test('SETTINGS_NAV: 節の並びとグループが取り決めどおり', () => {
  assert.deepStrictEqual(SETTINGS_NAV.flatMap((g) => g.items.map((i) => i.id)), SECTION_IDS);
  assert.deepStrictEqual(SETTINGS_NAV.map((g) => g.heading), [null, 'このプロジェクト', 'エージェント']);
  assert.deepStrictEqual(SETTINGS_NAV.map((g) => g.items.length), [2, 4, 3]);
});

test('SETTINGS_NAV: すべての項目にラベルと、存在するアイコンがある', () => {
  for (const { id, label, icon } of SETTINGS_NAV.flatMap((g) => g.items)) {
    assert.ok(label, id);
    assert.ok(ICON_NAMES.includes(icon), `${id} のアイコン ${icon}`);
  }
});

test('settingsNavHtml: 項目ごとのリンクと、見出しのあるグループの見出しを出す', () => {
  const asked = [];
  const html = settingsNavHtml((name) => {
    asked.push(name);
    return `<i data-i="${name}"></i>`;
  });
  assert.strictEqual(asked.length, SECTION_IDS.length);
  assert.deepStrictEqual([...html.matchAll(/href="#settings-([a-z]+)" data-section="([a-z]+)"/g)].map((m) => [m[1], m[2]]), SECTION_IDS.map((id) => [id, id]));
  assert.strictEqual(html.match(/class="settings-nav-item"/g).length, SECTION_IDS.length);
  assert.deepStrictEqual([...html.matchAll(/settings-nav-heading">([^<]*)</g)].map((m) => m[1]), ['このプロジェクト', 'エージェント']);
  assert.ok(html.indexOf('data-section="update"') < html.indexOf('このプロジェクト'), '見出しはグループの先頭に出す');
  assert.ok(html.includes('<i data-i="pipeline"></i><span>オーケストレーション</span>'));
  assert.doesNotMatch(html, /null|undefined/);
});

test('activeSection: 先頭が基準線に届いた最後の節を返す', () => {
  const tops = [{ id: 'a', top: 0 }, { id: 'b', top: 300 }, { id: 'c', top: 700 }];
  assert.strictEqual(activeSection(tops, 0), 'a');
  assert.strictEqual(activeSection(tops, 275), 'a', '基準線の 1px 手前');
  assert.strictEqual(activeSection(tops, 276), 'b', 'ちょうど scrollTop + 24');
  assert.strictEqual(activeSection(tops, 300), 'b');
  assert.strictEqual(activeSection(tops, 99999), 'c');
});

test('activeSection: どこにも届かないときは先頭、節がないときは null', () => {
  assert.strictEqual(activeSection([{ id: 'a', top: 100 }, { id: 'b', top: 200 }], 0), 'a');
  assert.strictEqual(activeSection([{ id: 'a', top: 0 }], 0), 'a');
  assert.strictEqual(activeSection([], 0), null);
});

function fakeSettingsNav({ ids = ['a', 'b', 'c'], sectionTops = { a: 0, b: 300, c: 700 }, scrollerRectTop = 50 } = {}) {
  const item = (id) => {
    const classes = new Set();
    const el = {
      dataset: { section: id },
      attrs: {},
      classList: {
        contains: (c) => classes.has(c),
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      },
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      removeAttribute(k) {
        delete this.attrs[k];
      },
      closest: () => el,
    };
    return el;
  };
  const items = ids.map(item);
  const nav = { ...fakeTarget(), querySelectorAll: () => items };
  const scroller = {
    ...fakeTarget(),
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: scrollerRectTop }),
  };
  const sections = new Map(
    Object.entries(sectionTops).map(([id, top]) => [
      id,
      {
        getBoundingClientRect: () => ({ top: scrollerRectTop + top - scroller.scrollTop }),
        scrollIntoView() {
          scroller.scrollTop = top;
        },
      },
    ]),
  );
  const bound = bindSettingsNav({ nav, scroller, section: (id) => sections.get(id) || null });
  const fire = (target, type, ev = {}) => {
    const e = { preventDefault() { this.prevented = true; }, ...ev };
    for (const h of target.handlers.filter((x) => x.type === type)) h.fn(e);
    return e;
  };
  const current = () => items.filter((i) => i.classList.contains('active')).map((i) => i.dataset.section);
  const at = (id) => items.find((i) => i.dataset.section === id);
  return { nav, scroller, bound, fire, current, at };
}

test('一覧: つないだ時点で先頭の項目が現在地になる', () => {
  const n = fakeSettingsNav();
  assert.deepStrictEqual(n.current(), ['a']);
  assert.strictEqual(n.at('a').attrs['aria-current'], 'true');
});

test('一覧: 項目を押すと既定のリンク移動を止めて、その節へスクロールする', () => {
  const n = fakeSettingsNav();
  const e = n.fire(n.nav, 'click', { target: n.at('c') });
  assert.strictEqual(e.prevented, true, 'location の # を変えない');
  assert.strictEqual(n.scroller.scrollTop, 700);
  assert.deepStrictEqual(n.current(), ['c']);
  assert.strictEqual(n.at('c').attrs['aria-current'], 'true');
  assert.strictEqual(n.at('a').attrs['aria-current'], undefined, '前の現在地の印を外す');
});

test('一覧: 項目の外（余白）のクリックでは何もしない', () => {
  const n = fakeSettingsNav();
  const e = n.fire(n.nav, 'click', { target: { closest: () => null } });
  assert.strictEqual(e.prevented, undefined);
  assert.strictEqual(n.scroller.scrollTop, 0);
});

test('一覧: スクロールに合わせて現在地が動く（scroller の画面上の位置に左右されない）', () => {
  const n = fakeSettingsNav({ scrollerRectTop: 120 });
  n.scroller.scrollTop = 276;
  n.fire(n.scroller, 'scroll');
  assert.deepStrictEqual(n.current(), ['b']);
  n.scroller.scrollTop = 275;
  n.fire(n.scroller, 'scroll');
  assert.deepStrictEqual(n.current(), ['a']);
});

test('一覧: scrollTo は外からも呼べて、sync は今の位置を反映する', () => {
  const n = fakeSettingsNav();
  n.bound.scrollTo('b');
  assert.strictEqual(n.scroller.scrollTop, 300);
  assert.deepStrictEqual(n.current(), ['b']);
  n.scroller.scrollTop = 800;
  n.bound.sync();
  assert.deepStrictEqual(n.current(), ['c']);
});

test('一覧: 節がない項目は、押しても動かず現在地にもならない', () => {
  const n = fakeSettingsNav({ ids: ['a', 'gone', 'c'], sectionTops: { a: 0, c: 700 } });
  n.scroller.scrollTop = 800;
  n.bound.sync();
  assert.deepStrictEqual(n.current(), ['c']);
  n.scroller.scrollTop = 0;
  n.bound.scrollTo('gone');
  assert.strictEqual(n.scroller.scrollTop, 0);
  assert.doesNotThrow(() => n.bound.scrollTo('nope'));
});

test('一覧: 節がひとつもなくても例外を出さない', () => {
  const n = fakeSettingsNav({ ids: [], sectionTops: {} });
  assert.deepStrictEqual(n.current(), []);
  assert.doesNotThrow(() => n.bound.sync());
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

test('index.html: 設定はメニューから開く全画面で、上部のボタンはない', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /settingsBtn/);
  assert.match(html, /data-view="settings"><span data-icon="settings"><\/span>設定</);
  assert.ok(html.indexOf('data-view="scheduler"') < html.indexOf('data-view="settings"'), 'メニューの3つ目');
  assert.match(html, /<main id="settingsView" class="settings-view hidden"><\/main>/, '中身は開いたときに描く');
  assert.match(html, /href="settings\.css"/);
  assert.match(html, /id="updateBadge"[^>]*title="設定の「アプリの更新」を開きます"/);
  assert.match(html, /id="rcBtn"/, 'RC設定は残す');
  assert.match(html, /id="sessionsBtn"/, 'セッションは残す');
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

test('subtaskChipHtml: 並列の枝は AppView.isPipelineSubtask で「サブタスク」を出す', () => {
  const src = read('renderer.js');
  const start = src.indexOf('function subtaskChipHtml');
  const end = src.indexOf('function subtaskChildHtml');
  assert.ok(start >= 0 && end > start);
  const fn = src.slice(start, end);
  assert.ok(fn.indexOf('if (c.subtaskOf)') < fn.indexOf('AppView.isPipelineSubtask(c)'), '手動のサブタスクを先に判定する');
  assert.match(fn, /「\$\{esc\(p\.title\)\}」のサブタスク（Pipeline の並列の枝）/);
  assert.match(fn, /Pipeline の並列の枝のサブタスク/);
  assert.match(fn, /class="orch-chip sub"/);
  assert.match(fn, /card\(c\.relay\.branchOf\.parent\)/);
  assert.doesNotMatch(fn, /subtaskOf\s*=/, 'branchOf を subtaskOf に書き換えない');
});

// renderer.js は DOM がないと読み込めないので、ラベルの関数だけ取り出して偽物のボードで動かす
function rendererFn(name) {
  const m = read('renderer.js').match(new RegExp(`^(?:async )?function ${name}\\(.*\\{\\n[\\s\\S]*?^\\}\\n`, 'm'));
  assert.ok(m, `${name} が見つかりません`);
  return m[0];
}
function rendererLine(re) {
  const m = read('renderer.js').match(re);
  assert.ok(m, String(re));
  return m[0];
}
const PIPE_FALLBACK = 'Pipeline の並列の枝のサブタスク';

function loadChipFns(cards) {
  const ctx = {
    AppView: { isPipelineSubtask },
    icon,
    state: { board: { cards } },
  };
  vm.createContext(ctx);
  vm.runInContext(
    [
      rendererFn('esc'),
      rendererFn('card'),
      rendererLine(/^const subtaskParent = .*$/m),
      rendererLine(/^const isHiddenSubtask = .*$/m),
      rendererLine(/^const isChat = .*$/m),
      'function subCounts() { return { done: 1, total: 2, skipped: 0 }; }',
      'function subKids() { return []; }',
      'function subtaskNeedsCheck() { return false; }',
      'function subPhaseText() { return "作業中"; }',
      rendererFn('subtaskChipHtml'),
      'function personaIcon() { return ""; }',
      'function agentOf(c) { return (c && c.agent) || "claude"; }',
      'function whoShort() { return "Cursor"; }',
      'function whoLabel() { return "Claude Code"; }',
      'function agentLabel() { return "Claude Code"; }',
      'function agentIcon() { return ""; }',
      'function relayBarHtml() { return `<div class="relay-bar"></div>`; }',
      'function subtaskBarHtml() { return `<div class="sub-bar"></div>`; }',
      'const FlowModel = { nodeOf: () => ({ label: "実装" }) };',
      'function competitors(c) { return c ? [c] : []; }',
      rendererFn('orchChipsHtml'),
      'Object.assign(this, { subtaskChipHtml, orchChipsHtml, isHiddenSubtask, esc });',
    ].join('\n'),
    ctx,
  );
  return ctx;
}

function relaySteps(n, at) {
  return Array.from({ length: n }, (_, i) => ({ label: at[i] || `工程${i + 1}` }));
}
function branchCard({ id = 'branch', parent = 'parent', index = 0, step = 1, steps = 16, label = '実装・テスト' } = {}) {
  return {
    id,
    title: `親 [枝${index + 1}: ${label}]`,
    agent: 'cursor',
    relay: {
      index: step,
      steps: relaySteps(steps, { [step]: label }),
      branchOf: { parent, node: 'n', join: 'j', index, label, histStart: 0 },
    },
  };
}
// 既定値のままでは undefined を渡せないので、親の id を明示して欠ける場合を作る
function branchCardWithoutParent(parent) {
  const c = branchCard();
  c.relay.branchOf.parent = parent;
  return c;
}
function subSpan(html) {
  const m = html.match(/<span class="orch-chip sub" title="[^"]*">[\s\S]*?<\/span>/);
  assert.ok(m, html);
  return m[0];
}
function pipeTip(ctx, title) {
  return `「${ctx.esc(title)}」のサブタスク（Pipeline の並列の枝）`;
}

test('subtaskChipHtml: 親がある枝は、親のタイトル入りの「サブタスク」を出す', () => {
  const parent = { id: 'parent', title: '親のタイトル' };
  const ctx = loadChipFns([parent]);
  const html = ctx.subtaskChipHtml(branchCard());
  const chip = subSpan(html);
  assert.match(chip, /class="orch-chip sub"/);
  assert.ok(chip.includes(`title="${pipeTip(ctx, parent.title)}"`));
  assert.match(chip, /<svg[^>]*class="ic"/, '手動のサブタスクと同じ枝アイコン');
  assert.match(chip, />サブタスク<\/span>$/);
  assert.doesNotMatch(chip, /2\/16|枝1|確認待ち/);
  assert.strictEqual(html.match(/orch-chip sub/g).length, 1);
});

test('subtaskChipHtml: 親が見つからなくてもラベルは残し、文言だけ変える', () => {
  const ctx = loadChipFns([{ id: 'other', title: '別のカード' }]);
  for (const parent of ['missing', undefined, null, '']) {
    const html = ctx.subtaskChipHtml(branchCardWithoutParent(parent));
    const chip = subSpan(html);
    assert.ok(chip.includes(`title="${PIPE_FALLBACK}"`), `parent=${String(parent)}`);
    assert.match(chip, />サブタスク<\/span>$/);
    assert.doesNotMatch(chip, /「/);
  }
  // id の型が違う（数値と文字列）ときは、別のカードとして見つからなかった扱いにする
  const typed = loadChipFns([{ id: '1', title: '文字列のID' }]);
  const mismatched = typed.subtaskChipHtml(branchCardWithoutParent(1));
  assert.ok(subSpan(mismatched).includes(`title="${PIPE_FALLBACK}"`));
});

test('subtaskChipHtml: 親のタイトルは属性用にエスケープし、長くても省略しない', () => {
  const title = `A&B <C> "D" 'E'\n${'あ'.repeat(300)}`;
  const ctx = loadChipFns([{ id: 'parent', title }]);
  const chip = subSpan(ctx.subtaskChipHtml(branchCard()));
  assert.ok(chip.includes(`title="${pipeTip(ctx, title)}"`));
  assert.doesNotMatch(chip, /<img|<C>|"D"/);
  assert.ok(chip.includes('あ'.repeat(300)));

  const nasty = '"><img src=x onerror=alert(1)>';
  const attacked = loadChipFns([{ id: 'parent', title: nasty }]);
  const safe = subSpan(attacked.subtaskChipHtml(branchCard()));
  assert.ok(safe.includes(`title="${pipeTip(attacked, nasty)}"`));
  assert.doesNotMatch(safe, /<img/);
  assert.match(safe, /&lt;img src=x onerror=alert\(1\)&gt;/);

  const blank = loadChipFns([{ id: 'parent' }, { id: 'empty', title: '' }]);
  assert.match(subSpan(blank.subtaskChipHtml(branchCard({ parent: 'parent' }))), /title="「」のサブタスク（Pipeline の並列の枝）"/);
  assert.match(subSpan(blank.subtaskChipHtml(branchCard({ parent: 'empty' }))), /title="「」のサブタスク（Pipeline の並列の枝）"/);
});

test('subtaskChipHtml: 同じ親の枝は、枝番号が違っても同じラベルになる', () => {
  const ctx = loadChipFns([{ id: 'parent', title: '親' }]);
  const a = ctx.subtaskChipHtml(branchCard({ id: 'a', index: 0 }));
  const b = ctx.subtaskChipHtml(branchCard({ id: 'b', index: 2, step: 7, label: 'レビュー' }));
  assert.strictEqual(a, b);
  assert.match(a, /title="「親」のサブタスク（Pipeline の並列の枝）"/);
});

test('subtaskChipHtml: 同名の親が複数あるときは、先に並んでいるカードのタイトルを使う', () => {
  const ctx = loadChipFns([
    { id: 'parent', title: '先の親' },
    { id: 'parent', title: '後の親' },
  ]);
  assert.match(ctx.subtaskChipHtml(branchCard()), /title="「先の親」のサブタスク（Pipeline の並列の枝）"/);
  const self = { id: 'self', title: '自分自身', relay: { branchOf: { parent: 'self', index: 0 } } };
  assert.match(loadChipFns([self]).subtaskChipHtml(self), /title="「自分自身」のサブタスク（Pipeline の並列の枝）"/);
});

test('subtaskChipHtml: 手動のサブタスクを先に判定し、枝のラベルにはしない', () => {
  const cards = [
    { id: 'manual-parent', title: '手動の親' },
    { id: 'branch-parent', title: '枝の親' },
  ];
  const ctx = loadChipFns(cards);
  const both = {
    id: 'both',
    subtaskOf: { parent: 'manual-parent' },
    relay: { branchOf: { parent: 'branch-parent', index: 0 } },
  };
  const html = ctx.subtaskChipHtml(both);
  assert.match(html, /title="「手動の親」のサブタスク"/);
  assert.doesNotMatch(html, /Pipeline/);
  assert.match(html, />サブタスク<\/span>$/);

  // 手動の親が消えているときは、これまでどおりラベル自体を出さない（枝の親が残っていても）
  const gone = { subtaskOf: { parent: 'gone' }, relay: { branchOf: { parent: 'branch-parent', index: 0 } } };
  assert.strictEqual(ctx.subtaskChipHtml(gone), '');

  // 空文字の subtaskOf は手動のサブタスクではないので、枝のラベルに進む
  const empty = { subtaskOf: '', relay: { branchOf: { parent: 'branch-parent', index: 0 } } };
  assert.match(ctx.subtaskChipHtml(empty), /title="「枝の親」のサブタスク（Pipeline の並列の枝）"/);

  const child = { id: 'child', subtaskOf: { parent: 'manual-parent' } };
  assert.match(ctx.subtaskChipHtml(child), /title="「手動の親」のサブタスク"/);
  assert.strictEqual(ctx.subtaskChipHtml({ subtaskOf: { parent: 'gone' } }), '');
  assert.strictEqual(ctx.isHiddenSubtask(child), true);
  assert.strictEqual(ctx.isHiddenSubtask(gone), false, '親がボードにいない手動のサブタスクは隠さない');
});

test('subtaskChipHtml: 親カード・ふつうのカード・並列のない Pipeline には枝のラベルを出さない', () => {
  const parent = { id: 'parent', title: '親', subtasks: { phase: 'run', items: [{}, {}] } };
  const plain = { id: 'plain', title: 'ふつうのカード', agent: 'claude' };
  const pipe = { id: 'pipe', title: '直列', relay: { index: 0, steps: relaySteps(2, { 0: '設計' }) } };
  const ctx = loadChipFns([parent, plain, pipe]);

  const parentHtml = ctx.subtaskChipHtml(parent);
  assert.match(parentHtml, /title="サブタスクに分けて進めています（作業中）"/);
  assert.match(parentHtml, />サブタスク 1\/2 完了<\/span>$/);
  assert.doesNotMatch(parentHtml, /Pipeline の並列の枝/);

  assert.strictEqual(ctx.subtaskChipHtml(plain), '');
  assert.strictEqual(ctx.subtaskChipHtml(pipe), '');
  assert.strictEqual(ctx.subtaskChipHtml({ kind: 'chat', title: '会話' }), '');
  assert.strictEqual(ctx.subtaskChipHtml({ relay: { branchOf: null, index: 0, steps: [{ label: '設計' }] } }), '');
  assert.strictEqual(ctx.subtaskChipHtml('card'), '');

  // 枝であると同時に subtasks を持っていても、進み具合のチップではなく枝のラベルを出す
  const mixed = branchCard();
  mixed.subtasks = { phase: 'run', items: [{}] };
  assert.match(ctx.subtaskChipHtml(mixed), /Pipeline の並列の枝/);
  assert.doesNotMatch(ctx.subtaskChipHtml(mixed), /1\/2 完了/);
});

test('subtaskChipHtml: カードが null のときと、カード一覧が壊れているときは例外になる', () => {
  const ctx = loadChipFns([{ id: 'parent', title: '親' }]);
  // 描画関数は別の領域で動くので、こちら側の TypeError とは原型が違う。名前で見る
  const typeError = { name: 'TypeError' };
  assert.throws(() => ctx.subtaskChipHtml(null), typeError);
  assert.throws(() => ctx.subtaskChipHtml(undefined), typeError);
  ctx.state.board.cards = null;
  assert.throws(() => ctx.subtaskChipHtml(branchCard()), typeError);
  ctx.state.board = null;
  assert.throws(() => ctx.subtaskChipHtml(branchCard()), typeError);
});

test('orchChipsHtml: 枝のカードは工程のチップを残したまま「サブタスク」を足す', () => {
  const parent = { id: 'parent', title: '親のタイトル' };
  const branch = branchCard({ label: 'A<B>' });
  const ctx = loadChipFns([parent, branch]);
  const html = ctx.orchChipsHtml(branch);
  assert.match(html, /class="orch-chip relay"/);
  assert.match(html, /title="Pipelineの並列の枝: 合流で元のタスクにマージします"/);
  assert.match(html, /枝1 · 2\/16 A&lt;B&gt;/);
  assert.doesNotMatch(html, /A<B>/);
  const chip = subSpan(html);
  assert.ok(chip.includes(`title="${pipeTip(ctx, parent.title)}"`));
  assert.doesNotMatch(chip, /2\/16|A&lt;B&gt;/);
  assert.match(html, /<div class="relay-bar"><\/div>/);
  assert.strictEqual(html.match(/orch-chip sub/g).length, 1);

  const later = branchCard({ id: 'later', index: 2, step: 7, label: 'レビュー' });
  const laterHtml = loadChipFns([parent, later]).orchChipsHtml(later);
  assert.match(laterHtml, /枝3 · 8\/16 レビュー/);
  assert.match(subSpan(laterHtml), /title="「親のタイトル」のサブタスク（Pipeline の並列の枝）"/);

  const orphan = branchCard({ id: 'orphan', parent: 'missing' });
  const orphanHtml = ctx.orchChipsHtml(orphan);
  assert.match(orphanHtml, /枝1 · 2\/16/);
  assert.ok(subSpan(orphanHtml).includes(`title="${PIPE_FALLBACK}"`));
});

test('orchChipsHtml: 工程の並びが壊れた枝でも、ラベル単体は出せる', () => {
  const parent = { id: 'parent', title: '親' };
  const broken = { id: 'broken', relay: { index: 0, branchOf: { parent: 'parent', index: 0 } } };
  const ctx = loadChipFns([parent, broken]);
  assert.match(ctx.subtaskChipHtml(broken), /title="「親」のサブタスク（Pipeline の並列の枝）"/);
  const typeError = { name: 'TypeError' };
  assert.throws(() => ctx.orchChipsHtml(broken), typeError);
  broken.relay.steps = [];
  assert.throws(() => ctx.orchChipsHtml(broken), typeError);
  broken.relay.steps = [{ label: '実装' }];
  broken.relay.index = 3;
  assert.throws(() => ctx.orchChipsHtml(broken), typeError);
});

test('orchChipsHtml: 親・ふつうのカード・並列のない Pipeline・手動のサブタスクはこれまでどおり', () => {
  const parent = { id: 'parent', title: '親のタスク', subtasks: { phase: 'run', items: [{}, {}] } };
  const plain = { id: 'plain', title: 'ふつう', agent: 'claude' };
  const pipe = { id: 'pipe', title: '直列の Pipeline', agent: 'claude', relay: { index: 0, steps: relaySteps(2, { 0: '設計' }) } };
  const waiting = {
    id: 'waiting',
    title: '並列の親',
    relay: { index: 0, steps: [{ label: '並列' }], waiting: { node: 'n', children: ['a', 'b'] } },
  };
  const child = { id: 'child', title: '手動', agent: 'claude', subtaskOf: { parent: 'parent' } };
  const ctx = loadChipFns([parent, plain, pipe, waiting, child]);

  const pipeHtml = ctx.orchChipsHtml(pipe);
  assert.match(pipeHtml, /title="Pipeline: フローチャートの工程ごとに、エージェントが作業を引き継ぎます"/);
  assert.match(pipeHtml, /1\/2 設計/);
  assert.doesNotMatch(pipeHtml, /枝\d|orch-chip sub/);
  assert.match(pipeHtml, /<div class="relay-bar"><\/div>/);

  const waitingHtml = ctx.orchChipsHtml(waiting);
  assert.match(waitingHtml, /並列「実装」の枝 2 本を待機中/);
  assert.doesNotMatch(waitingHtml, /orch-chip sub/);

  assert.doesNotMatch(ctx.orchChipsHtml(plain), /orch-chip sub|orch-chip relay/);
  assert.match(ctx.orchChipsHtml(plain), /orch-chip agent/);

  const parentHtml = ctx.orchChipsHtml(parent);
  assert.match(parentHtml, />サブタスク 1\/2 完了</);
  assert.match(parentHtml, /<div class="sub-bar"><\/div>/);
  assert.doesNotMatch(parentHtml, /Pipeline の並列の枝/);

  const childHtml = ctx.orchChipsHtml(child);
  assert.match(childHtml, /title="「親のタスク」のサブタスク"/);
  assert.doesNotMatch(childHtml, /Pipeline|orch-chip relay/);
  assert.doesNotMatch(childHtml, /relay-bar|sub-bar/);
});

test('isHiddenSubtask: 並列の枝は、親がボードにいても隠さない', () => {
  const parent = { id: 'parent', title: '親' };
  const branch = branchCard();
  const child = { id: 'child', subtaskOf: { parent: 'parent' } };
  const ctx = loadChipFns([parent, branch, child]);
  assert.strictEqual(ctx.isHiddenSubtask(branch), false);
  assert.strictEqual(ctx.isHiddenSubtask(parent), false);
  assert.strictEqual(ctx.isHiddenSubtask(child), true);
  assert.strictEqual(ctx.isHiddenSubtask(null), false);
  assert.strictEqual(ctx.isHiddenSubtask(undefined), false);
  assert.strictEqual(ctx.isHiddenSubtask({ relay: { branchOf: { parent: 'missing', index: 0 } } }), false);

  const src = read('renderer.js');
  const hidden = src.slice(src.indexOf('const subtaskParent'), src.indexOf('const subtasksRunning'));
  assert.match(hidden, /c\.subtaskOf/);
  assert.doesNotMatch(hidden, /branchOf|isPipelineSubtask/);
});

test('使い方: 並列の枝のカードに「サブタスク」のラベルが付くと書いてある', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'usage.md'), 'utf8');
  assert.match(doc, /Pipeline の並列で自動で作られた枝のカードには、ボード上で「サブタスク」のラベルが付きます（工程の名前に「サブタスク」がなくても付きます）/);
});
