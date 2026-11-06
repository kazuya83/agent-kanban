const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { VIEWS, VIEW_KEY, SETTINGS_NAV, normalizeView, loadView, saveView, isPipelineSubtask, canSchedule, bindNavMenu, settingsNavHtml, activeSection, bindSettingsNav } = require('../renderer/app-view.js');
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
});
