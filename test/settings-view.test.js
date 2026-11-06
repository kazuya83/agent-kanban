// 設定画面（renderer.js）。renderer.js は DOM がないと読み込めないので、切り替えの関数を取り出して偽物の中で動かし、
// 全体の形は文字列で確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');

// トップレベルの関数の本体（次の行頭の } まで）を取り出す
function fnSource(name) {
  const m = src.match(new RegExp(`^(?:async )?function ${name}\\(.*\\{\\n[\\s\\S]*?^\\}\\n`, 'm'));
  assert.ok(m, `${name} が見つかりません`);
  return m[0];
}

const SECTIONS = ['general', 'update', 'branch', 'issue', 'permission', 'task', 'agents', 'custom', 'orchestration'];

test('上部の設定ボタンとモーダルへの依存が残っていない', () => {
  assert.doesNotMatch(src, /settingsBtn/);
  for (const name of ['openSettings', 'renderSettingsView', 'clearSettingsView', 'renderSettingsViewIfStale']) {
    assert.doesNotMatch(fnSource(name), /openModal|closeModal|\$\('modal'\)|\$\('modalBox'\)/, name);
  }
});

test('設定画面に9つの節の中身があり、入力欄の ID は1つずつ', () => {
  const body = fnSource('renderSettingsView');
  const block = body.slice(body.indexOf('const sections = {'), body.indexOf('// 描き直しても'));
  assert.deepStrictEqual([...block.matchAll(/^ {4}(\w+): `/gm)].map((m) => m[1]), SECTIONS);
  const ids = [...block.matchAll(/ id="(\w+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  // 保存の処理が読む欄は全部ある（欠けると保存のときに落ちる）
  const save = body.slice(body.indexOf("$('sOk').onclick"));
  const read = new Set([...save.matchAll(/\$\('(s[A-Z]\w+)'\)\.(?:value|checked)/g)].map((m) => m[1]));
  assert.ok(read.size >= 20, `読む欄が少なすぎます: ${read.size}`);
  for (const id of read) assert.ok(ids.includes(id) || new RegExp(`id="${id}"`).test(body), `#${id} がありません`);
});

test('節の分け方: 欄が決めた節にある', () => {
  const body = fnSource('renderSettingsView');
  const block = body.slice(body.indexOf('const sections = {'), body.indexOf('// 描き直しても'));
  const parts = block.split(/^ {4}(?=\w+: `)/m).slice(1);
  const of = (id) => parts.find((p) => p.includes(`id="${id}"`))?.split(':')[0];
  const want = { sMax: 'general', updPanel: 'update', sBase: 'branch', sBranchRule: 'branch', sSetupScript: 'branch', sTeardownScript: 'branch', sRunScript: 'branch', sIssueSync: 'issue', ghPanel: 'issue', sMode: 'permission', sAllowed: 'permission', sSkill: 'task', sSubtaskMerge: 'task', sDefaultAgent: 'agents', sClaude: 'agents', sCustomList: 'custom', sRelayList: 'orchestration', sCompeteBox: 'orchestration' };
  for (const [id, section] of Object.entries(want)) assert.strictEqual(of(id), section, id);
  assert.doesNotMatch(block, /class="s-section/, '節の見出しに置き換えた');
});

test('保存しても画面に残り、「元に戻す」は描き直すだけ', () => {
  const body = fnSource('renderSettingsView');
  assert.match(body, /id="sCancel">\$\{tr\('元に戻す'\)\}</);
  assert.doesNotMatch(body, /キャンセル/);
  assert.match(body.slice(body.indexOf("$('sCancel').onclick"), body.indexOf("$('sOk').onclick")), /renderSettingsView\(\)/);
  assert.doesNotMatch(body.slice(body.indexOf("$('sCancel').onclick"), body.indexOf("$('sOk').onclick")), /updateSettings/, '元に戻すでは保存しない');
});

test('ブランチ一覧は画面を離れたら入れない（モーダルの判定を使わない）', () => {
  assert.match(fnSource('renderSettingsView'), /\$\('sBase'\) !== sel \|\| state\.view !== 'settings'/);
});

test('renderBoard は上部を更新したあとで、カンバンを描く前に設定画面へ分かれる', () => {
  const body = fnSource('renderBoard');
  const at = (t) => {
    const i = body.indexOf(t);
    assert.ok(i >= 0, t);
    return i;
  };
  const branch = at("if (state.view === 'settings') return renderSettingsViewIfStale();");
  assert.ok(at('renderRemoteInfo();') < branch);
  assert.ok(at("$('runInfo').textContent") < branch);
  assert.ok(branch < at('if (!settings.repoPath)'), 'リポジトリがなくても設定画面は開ける');
});

// 画面切り替えの関数を、偽の DOM の中で動かす
function harness({ view = 'kanban', selected = null, repoPath = '/a', host = false } = {}) {
  const log = [];
  const el = (id) => {
    const classes = new Set(id === 'settingsView' ? ['hidden'] : []);
    return {
      id,
      innerHTML: id === 'settingsView' ? '' : undefined,
      classList: {
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
      },
    };
  };
  const els = new Map();
  const $ = (id) => {
    if (!els.has(id)) els.set(id, el(id));
    return els.get(id);
  };
  const ctx = {
    $,
    state: { view, selected, board: { settings: { repoPath } } },
    host,
    localStorage: {},
    document: { querySelectorAll: () => [] },
    AppView: {
      normalizeView: (v) => (['kanban', 'scheduler', 'settings'].includes(v) ? v : 'kanban'),
      saveView: (_, v) => log.push(`save:${v}`),
    },
    viewingHost: () => ctx.host,
    closeDetail: () => {
      log.push('closeDetail');
      ctx.state.selected = null;
      ctx.renderBoard();
    },
    renderSettingsView: () => {
      log.push('draw');
      ctx.setDrawn();
      $('settingsView').innerHTML = 'SECTIONS';
    },
    renderBoard: () => {
      log.push('board');
      if (ctx.state.view === 'settings') ctx.renderSettingsViewIfStale();
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    [
      src.match(/^let settingsViewKey = null;.*$/m)[0],
      src.match(/^let settingsNav = null;$/m)[0],
      src.match(/^const currentSettingsKey = .*$/m)[0],
      'function setDrawn() { settingsViewKey = currentSettingsKey(); settingsNav = nav; }',
      'const nav = { scrolled: [], scrollTo(id) { this.scrolled.push(id); } };',
      'this.nav = nav; this.setDrawn = setDrawn; this.getKey = () => settingsViewKey; this.getNav = () => settingsNav;',
      fnSource('applyView'),
      fnSource('setView'),
      fnSource('renderSettingsViewIfStale'),
      fnSource('clearSettingsView'),
      fnSource('openSettings'),
      'this.setView = setView; this.openSettings = openSettings; this.renderSettingsViewIfStale = renderSettingsViewIfStale;',
    ].join('\n'),
    ctx,
  );
  return { ctx, log, $ };
}
const draws = (log) => log.filter((x) => x === 'draw').length;

test('開くと設定画面だけが見え、1回だけ描く', () => {
  const { ctx, log, $ } = harness();
  ctx.setView('settings');
  assert.strictEqual(ctx.state.view, 'settings');
  assert.strictEqual($('settingsView').classList.contains('hidden'), false);
  assert.strictEqual($('board').classList.contains('hidden'), true);
  assert.strictEqual($('schedulerView').classList.contains('hidden'), true);
  assert.strictEqual(draws(log), 1);
});

test('ボードの更新が何度来ても描き直さない（入力中の値を消さない）', () => {
  const { ctx, log } = harness();
  ctx.setView('settings');
  for (let i = 0; i < 5; i++) ctx.renderBoard();
  assert.strictEqual(draws(log), 1);
});

test('リポジトリのタブを切り替えると描き直す', () => {
  const { ctx, log } = harness({ repoPath: '/a' });
  ctx.setView('settings');
  ctx.state.board.settings.repoPath = '/b';
  ctx.renderBoard();
  assert.strictEqual(draws(log), 2);
  ctx.renderBoard();
  assert.strictEqual(draws(log), 2);
});

test('同じパスでも、遠隔操作でホストとこのマシンが切り替わったら描き直す', () => {
  const { ctx, log } = harness({ repoPath: '/a', host: false });
  ctx.setView('settings');
  ctx.host = true;
  ctx.renderBoard();
  assert.strictEqual(draws(log), 2);
});

test('リポジトリを開いていなくても開け、あとで開いたら描き直す', () => {
  const { ctx, log } = harness({ repoPath: '' });
  ctx.setView('settings');
  assert.strictEqual(draws(log), 1);
  ctx.state.board.settings.repoPath = '/a';
  ctx.renderBoard();
  assert.strictEqual(draws(log), 2);
});

test('離れると中身を消し、また開くと描き直す（前の入力を残さない）', () => {
  for (const next of ['kanban', 'scheduler']) {
    const { ctx, log, $ } = harness();
    ctx.setView('settings');
    ctx.setView(next);
    assert.strictEqual($('settingsView').innerHTML, '');
    assert.strictEqual($('settingsView').classList.contains('hidden'), true);
    assert.strictEqual(ctx.getKey(), null);
    assert.strictEqual(ctx.getNav(), null);
    ctx.setView('settings');
    assert.strictEqual(draws(log), 2, next);
  }
});

test('設定画面ではタスク詳細を閉じる。カンバンへ戻るときは閉じない', () => {
  const a = harness({ selected: 'c1' });
  a.ctx.setView('settings');
  assert.ok(a.log.includes('closeDetail'));
  assert.strictEqual(draws(a.log), 1, '閉じたあとの描き直しで設定画面が描かれる');

  const b = harness({ view: 'settings', selected: 'c1' });
  b.ctx.setView('kanban');
  assert.ok(!b.log.includes('closeDetail'));
});

test('同じ画面を選んでも何もしない・知らない画面はカンバンになる', () => {
  const { ctx, log } = harness();
  ctx.setView('settings');
  const n = log.length;
  ctx.setView('settings');
  assert.strictEqual(log.length, n);
  ctx.setView('nope');
  assert.strictEqual(ctx.state.view, 'kanban');
});

test('openSettings: 開いて節までスクロールする。開いていても、スクロールだけは動かす', () => {
  const { ctx, log } = harness();
  ctx.openSettings('update');
  assert.deepStrictEqual([...ctx.nav.scrolled], ['update']);
  assert.strictEqual(draws(log), 1);
  ctx.openSettings('update');
  assert.deepStrictEqual([...ctx.nav.scrolled], ['update', 'update']);
  assert.strictEqual(draws(log), 1, '開いているときは描き直さない（入力を消さない）');
});

test('openSettings: 節を指定しなければスクロールしない', () => {
  const { ctx } = harness();
  ctx.openSettings();
  assert.strictEqual(ctx.state.view, 'settings');
  assert.deepStrictEqual([...ctx.nav.scrolled], []);
});

test('更新バッジはアプリの更新の節を開く', () => {
  assert.match(src, /\$\('updateBadge'\)\?\.addEventListener\('click', \(\) => openSettings\('update'\)\)/);
});

test('前のプロジェクトの Pipeline を保存しない', () => {
  const body = fnSource('renderSettingsView');
  const save = body.slice(body.indexOf('const saveFlows ='));
  assert.ok(save.indexOf('isStale()') < save.indexOf('api.updateSettings'));
});

test('プロジェクトが変わったあとは、前の描画の一覧を描かない（新しい画面を上書きせず、画面を離れていても落ちない）', () => {
  const body = fnSource('renderSettingsView');
  assert.match(body, /const isStale = \(\) => settingsViewKey !== viewKey;/);
  for (const name of ['redrawCustom', 'drawRelay']) {
    assert.match(body, new RegExp(`const ${name} = \\(\\) => \\{\\n\\s+if \\(isStale\\(\\)\\) return;`), name);
  }
});

// Issue ダイアログを閉じたとき、後ろの設定画面の gh の欄を確かめ直すか
function closeModalWith({ view, open, gh }) {
  const classes = new Set(open ? [] : ['hidden']);
  const modal = {
    classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c) },
    querySelector: () => (gh ? {} : null),
    addEventListener() {},
  };
  const ctx = { state: { view }, $: () => modal, refreshed: 0 };
  ctx.refreshGh = () => ctx.refreshed++;
  vm.createContext(ctx);
  vm.runInContext(`${fnSource('closeModal')}; closeModal();`, ctx);
  assert.ok(classes.has('hidden'));
  return ctx.refreshed;
}

test('gh の欄があるダイアログを設定画面の上で閉じると、後ろの欄を確かめ直す', () => {
  assert.strictEqual(closeModalWith({ view: 'settings', open: true, gh: true }), 1);
  assert.strictEqual(closeModalWith({ view: 'settings', open: true, gh: false }), 0);
  assert.strictEqual(closeModalWith({ view: 'settings', open: false, gh: true }), 0);
  assert.strictEqual(closeModalWith({ view: 'kanban', open: true, gh: true }), 0);
});

// gh の欄
function ghHarness({ modal, settings }) {
  const panel = (name) => {
    const parts = {};
    return {
      name,
      className: '',
      textContent: '',
      set innerHTML(v) {
        for (const [, id] of v.matchAll(/id="(\w+)"/g)) parts[id] = { id, owner: name };
      },
      querySelector: (sel) => parts[sel.slice(1)] || null,
    };
  };
  const modalPanel = modal ? panel('modal') : null;
  const settingsPanel = settings ? panel('settings') : null;
  const ctx = {
    esc: (x) => x,
    tr: (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s),
    ghState: { busy: false, lines: [], code: null },
    document: { querySelector: () => modalPanel },
    $: (id) => (id === 'ghPanel' ? settingsPanel : null),
    api: {},
    run: () => {},
    toast: () => {},
    navigator: {},
    refreshGh: () => {},
    ghAction: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(`${fnSource('renderGh')}; this.renderGh = renderGh;`, ctx);
  return { ctx, modalPanel, settingsPanel };
}

test('設定画面の上の Issue ダイアログでも、gh の欄は手前に描き、ボタンも手前のものにつなぐ', () => {
  const { ctx, modalPanel, settingsPanel } = ghHarness({ modal: true, settings: true });
  ctx.renderGh({ installed: false });
  assert.match(modalPanel.className, /gh-warn/);
  assert.strictEqual(settingsPanel.className, '');
  assert.strictEqual(typeof modalPanel.querySelector('#ghRecheck').onclick, 'function');
});

test('ダイアログがなければ設定画面の gh の欄に描く。どちらもなければ何もしない', () => {
  const a = ghHarness({ modal: false, settings: true });
  a.ctx.renderGh({ installed: false });
  assert.match(a.settingsPanel.className, /gh-warn/);
  const b = ghHarness({ modal: false, settings: false });
  assert.doesNotThrow(() => b.ctx.renderGh({ installed: false }));
});
