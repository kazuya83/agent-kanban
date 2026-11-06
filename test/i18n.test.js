// 画面の言葉（サブタスク1: 土台・設定・gh・更新・シェル）。原文（日本語）がキー
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const I18n = require('../renderer/i18n.js');

const LANGS = ['en', 'es', 'fr', 'zh'];
const PH = /\{(\w+)\}/g;
const TAG = /<\/?(span|b|code|strong|small|a|button|div|p|br|label)\b[^>]*>/g;

test.afterEach(() => {
  I18n.setLanguage('ja');
});

function evalString(lit) {
  return Function(`"use strict"; return ${lit};`)();
}

// tr('…') の第1引数（1行のシングルクォート）を、ソースから取り出す
function trKeys(src) {
  const keys = [];
  const re = /\btr\(\s*('(?:\\'|[^'])*')/g;
  let m;
  while ((m = re.exec(src))) keys.push(evalString(m[1]));
  return keys;
}

function sliceBetween(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, start);
  const b = end ? src.indexOf(end, a + start.length) : src.length;
  assert.ok(b > a, end || 'end');
  return src.slice(a, b);
}

function shellKeys() {
  const renderer = read('renderer/renderer.js');
  const parts = [
    sliceBetween(renderer, 'function openRemoteSettings()', 'function pickRepo('),
    sliceBetween(renderer, 'async function refreshGh()', 'function timeAgo('),
    sliceBetween(renderer, 'async function checkEnv()', null),
    read('renderer/app-view.js'),
    read('renderer/zoom.js'),
  ];
  return [...new Set(parts.flatMap(trKeys))];
}

function htmlJapanese(html) {
  const attrs = [];
  const attrRe = /\b(?:title|aria-label|placeholder)="([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(html))) if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(m[1])) attrs.push(m[1]);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(s));
  return [...new Set([...attrs, ...text])];
}

test('起動直後は日本語の原文のまま。初めて入れるときの既定は英語、既存の board.json は日本語', () => {
  assert.strictEqual(I18n.getLanguage(), 'ja');
  assert.strictEqual(I18n.locale(), 'ja-JP');
  assert.strictEqual(I18n.DEFAULT_LANGUAGE, 'en');
  assert.strictEqual(I18n.LEGACY_LANGUAGE, 'ja');
  assert.deepStrictEqual(I18n.LANGUAGES.map((l) => l.code), ['en', 'ja', 'es', 'fr', 'zh']);
  assert.deepStrictEqual(I18n.LANGUAGES.map((l) => l.locale), ['en-US', 'ja-JP', 'es-ES', 'fr-FR', 'zh-CN']);
  // 言語名そのものは訳さない（セレクトに出す名前）
  assert.deepStrictEqual(I18n.LANGUAGES.map((l) => l.label), ['English', '日本語', 'Español', 'Français', '简体中文']);
});

test('知らない言語コードは無視して、いまの言語を返す', () => {
  assert.strictEqual(I18n.setLanguage('en'), 'en');
  for (const bad of ['', 'EN', 'ja-JP', 'zh-CN', 'de', 'english', null, undefined, 0, 1, false, true, {}, [], ' ja', 'en ']) {
    assert.strictEqual(I18n.isLanguage(bad), false, String(bad));
    assert.strictEqual(I18n.setLanguage(bad), 'en', String(bad));
    assert.strictEqual(I18n.getLanguage(), 'en');
  }
  assert.strictEqual(I18n.setLanguage('ja'), 'ja');
});

test('ja は原文、訳がなければ原文、差し込みは名前で置き換える', () => {
  const key = '閉じる';
  assert.strictEqual(I18n.tr(key), '閉じる');
  I18n.setLanguage('en');
  assert.strictEqual(I18n.tr(key), 'Close');
  I18n.setLanguage('es');
  assert.notStrictEqual(I18n.tr(key), key);
  I18n.setLanguage('fr');
  assert.notStrictEqual(I18n.tr(key), key);
  I18n.setLanguage('zh');
  assert.strictEqual(I18n.tr(key), '关闭');

  I18n.setLanguage('en');
  assert.strictEqual(I18n.tr('この文は辞書にない'), 'この文は辞書にない');
  assert.strictEqual(I18n.tr('実行中 {v1} 件', { v1: 3 }), '3 running');
  assert.strictEqual(I18n.tr('実行中 {v1} 件', { v1: 0 }), '0 running');
  assert.strictEqual(I18n.tr('実行中 {v1} 件', { v1: false }), 'false running');
  assert.strictEqual(I18n.tr('実行中 {v1} 件', { v1: null }), 'null running');
  // 渡していない名前はそのまま残す。余分な値は使わない
  assert.match(I18n.tr('実行中 {v1} 件', {}), /\{v1\}/);
  assert.doesNotMatch(I18n.tr('実行中 {v1} 件', { v1: 1, extra: 'X' }), /X/);
  // ハイフンや空白の入った括弧は名前ではない
  assert.strictEqual(I18n.tr('a {v1} {v-1} { v1 }', { v1: 'Z' }), 'a Z {v-1} { v1 }');
  // tr はエスケープしない（呼び出し側が esc する）
  assert.strictEqual(I18n.tr('{v1}', { v1: '<b>x</b>' }), '<b>x</b>');
  // vars がオブジェクトでなければ置き換えない
  for (const vars of [undefined, null, 0, '', false]) assert.strictEqual(I18n.tr('実行中 {v1} 件', vars), I18n.tr('実行中 {v1} 件'));
});

test('has は載っている訳だけ true。ja は原文なので表には無い。add は足すだけで他を消さない', () => {
  assert.strictEqual(I18n.has('閉じる', 'en'), true);
  assert.strictEqual(I18n.has('閉じる', 'ja'), false);
  assert.strictEqual(I18n.has('閉じる', 'de'), false);
  assert.strictEqual(I18n.has('無いキー', 'en'), false);
  assert.strictEqual(I18n.has('閉じる', undefined), false);

  const key = 'テストだけの文 {v1}';
  I18n.add({ [key]: { en: 'only a test {v1}' } });
  assert.strictEqual(I18n.has(key, 'en'), true);
  assert.strictEqual(I18n.has(key, 'es'), false);
  I18n.setLanguage('en');
  assert.strictEqual(I18n.tr(key, { v1: 2 }), 'only a test 2');
  I18n.setLanguage('es');
  assert.strictEqual(I18n.tr(key, { v1: 2 }), 'テストだけの文 2');
  // 既存の訳は残る
  I18n.setLanguage('en');
  assert.strictEqual(I18n.tr('閉じる'), 'Close');
  I18n.add({ [key]: { es: 'solo una prueba {v1}', en: 'replaced {v1}' } });
  assert.strictEqual(I18n.tr(key, { v1: 1 }), 'replaced 1');
  I18n.setLanguage('es');
  assert.strictEqual(I18n.tr(key, { v1: 1 }), 'solo una prueba 1');
});

function fakeDoc(texts, elements) {
  let i = 0;
  return {
    body: {},
    createTreeWalker() {
      return { nextNode: () => texts[i++] || null };
    },
    querySelectorAll() {
      return elements;
    },
  };
}

function attrEl(attrs) {
  const store = { ...attrs };
  return {
    store,
    hasAttribute: (k) => Object.prototype.hasOwnProperty.call(store, k),
    getAttribute: (k) => store[k],
    setAttribute: (k, v) => {
      store[k] = v;
    },
  };
}

test('localizeDom: ja では文字を変えず、訳があるときだけ空白を残して置き換える', () => {
  const text = { nodeValue: '  閉じる  ' };
  const blank = { nodeValue: '   ' };
  const unknown = { nodeValue: 'worktree' };
  const title = attrEl({ title: '閉じる', alt: '閉じる' });
  const doc = fakeDoc([text, blank, unknown, { nodeValue: '' }], [title]);
  I18n.localizeDom(doc);
  assert.strictEqual(text.nodeValue, '  閉じる  ');
  assert.strictEqual(blank.nodeValue, '   ');
  assert.strictEqual(unknown.nodeValue, 'worktree');
  assert.strictEqual(title.store.title, '閉じる');
  assert.strictEqual(title.store.alt, '閉じる', 'title 以外の属性は触らない');

  I18n.setLanguage('en');
  const text2 = { nodeValue: '  閉じる  ' };
  const twice = { nodeValue: '閉じる閉じる' };
  const title2 = attrEl({ title: '通知', 'aria-label': 'メニュー', placeholder: '追加の指示を送る（Ctrl/⌘ + Enter で送信）' });
  const emptyAttr = attrEl({ title: '' });
  I18n.localizeDom(fakeDoc([text2, twice], [title2, emptyAttr]));
  assert.strictEqual(text2.nodeValue, '  Close  ');
  assert.strictEqual(twice.nodeValue, '閉じる閉じる', '原文と一致しないノードは置き換えない');
  assert.strictEqual(title2.store.title, 'Notifications');
  assert.strictEqual(title2.store['aria-label'], 'Menu');
  assert.match(title2.store.placeholder, /follow-up/i);
  assert.strictEqual(emptyAttr.store.title, '');
});

test('ブラウザ側は api.language を反映し、document が無くても落ちない', () => {
  const src = read('renderer/i18n.js');
  const withLang = { document: { documentElement: { lang: '' } }, api: { language: 'fr' } };
  vm.runInNewContext(src, withLang);
  assert.strictEqual(withLang.I18n.getLanguage(), 'fr');
  assert.strictEqual(withLang.document.documentElement.lang, 'fr');
  assert.strictEqual(withLang.tr, withLang.I18n.tr);
  // ブラウザ側は locales を自動では読まない（script が読む）
  assert.strictEqual(withLang.tr('閉じる'), '閉じる');

  const legacy = { document: { documentElement: {} } };
  vm.runInNewContext(src, legacy);
  assert.strictEqual(legacy.I18n.getLanguage(), 'ja');
  assert.strictEqual(legacy.document.documentElement.lang, 'ja');

  const bad = { api: { language: 'zh-CN' } };
  assert.doesNotThrow(() => vm.runInNewContext(src, bad));
  assert.strictEqual(bad.I18n.getLanguage(), 'ja');

  const none = {};
  assert.doesNotThrow(() => vm.runInNewContext(src, none));
  assert.strictEqual(none.I18n.getLanguage(), 'ja');
});

test('担当範囲の tr と index.html の日本語は、4言語とも訳があり、差し込みとタグが一致する', () => {
  const keys = [...new Set([...shellKeys(), ...htmlJapanese(read('renderer/index.html'))])];
  assert.ok(keys.length >= 300, `キーが少なすぎます: ${keys.length}`);
  const missing = [];
  const broken = [];
  for (const key of keys) {
    for (const lang of LANGS) {
      if (!I18n.has(key, lang)) missing.push(`${lang}: ${key.slice(0, 80)}`);
    }
    I18n.setLanguage('ja');
    const names = [...key.matchAll(PH)].map((m) => m[1]);
    const tags = [...key.matchAll(TAG)].map((m) => m[0]);
    for (const lang of LANGS) {
      I18n.setLanguage(lang);
      const s = I18n.tr(key);
      if (!s) broken.push(`empty ${lang}: ${key.slice(0, 40)}`);
      const got = [...s.matchAll(PH)].map((m) => m[1]);
      if (names.slice().sort().join() !== got.slice().sort().join()) broken.push(`ph ${lang}: ${key.slice(0, 40)} ${names} != ${got}`);
      const gotTags = [...s.matchAll(TAG)].map((m) => m[0]);
      if (tags.join() !== gotTags.join()) broken.push(`tag ${lang}: ${key.slice(0, 40)}`);
    }
  }
  assert.deepStrictEqual(missing, []);
  assert.deepStrictEqual(broken, []);
  // 日本語のまま返るので、訳文に置き換えたつもりが原文になっていないこと
  I18n.setLanguage('en');
  assert.notStrictEqual(I18n.tr('言語'), '言語');
  assert.strictEqual(I18n.tr('全般'), 'General');
});

test('言語のセレクトは全般にあり、選ぶと保存して読み直す。失敗したら元に戻して知らせる', () => {
  const src = read('renderer/renderer.js');
  const view = sliceBetween(src, 'function renderSettingsView()', 'function pickRepo(');
  const general = view.slice(view.indexOf('general:'), view.indexOf('update:'));
  assert.match(general, /id="sLanguage"/);
  assert.match(general, /I18n\.LANGUAGES\.map/);
  assert.match(general, /I18n\.getLanguage\(\)/);
  assert.match(general, /tr\('言語'\)/);
  assert.doesNotMatch(general, /tr\(l\.label\)/, '言語名は訳さない');
  const handler = view.slice(view.indexOf("$('sLanguage')"), view.indexOf("$('sCancel').onclick"));
  assert.match(handler, /I18n\.isLanguage\(code\)/);
  assert.match(handler, /code === I18n\.getLanguage\(\)/);
  assert.match(handler, /await api\.setLanguage\(code\)/);
  assert.match(handler, /\$\('sLanguage'\)\.value = I18n\.getLanguage\(\)/);
  assert.match(handler, /toast\(err\.message \|\| String\(err\)\)/);
  assert.match(handler, /location\.reload\(\)/);
  assert.doesNotMatch(handler, /updateSettings/, '言語は設定の保存ボタンでは書かない');
  const save = view.slice(view.indexOf("$('sOk').onclick"));
  assert.doesNotMatch(save, /sLanguage/);
});

test('更新の日時は選んだ言語の locale。画面の固定文字は初期化のときに訳す', () => {
  const src = read('renderer/renderer.js');
  const panel = sliceBetween(src, 'function updatePanelHtml(', 'function bindUpdatePanel(');
  assert.match(panel, /toLocaleString\(I18n\.locale\(\)\)/);
  const init = src.slice(src.indexOf('I18n.localizeDom(document)'));
  assert.ok(init.indexOf('I18n.localizeDom(document)') < init.indexOf('api.updateStatus()'));
});

test('index.html は英語を既定にし、辞書を画面のスクリプトより先に読む', () => {
  const html = read('renderer/index.html');
  assert.match(html, /<html lang="en">/);
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(order.slice(0, 4), ['i18n.js', 'locales/shell.js', 'locales/board.js', 'locales/screens.js']);
  assert.ok(order.indexOf('locales/screens.js') < order.indexOf('app-view.js'));
  assert.ok(order.indexOf('locales/screens.js') < order.indexOf('zoom.js'));
  assert.ok(order.indexOf('i18n.js') < order.indexOf('renderer.js'));
});

test('preload: 言語は同期で読み、保存に失敗したら例外にする', async () => {
  const src = read('preload.js');
  assert.match(src, /language: ipcRenderer\.sendSync\('app:language'\)/);
  assert.match(src, /setLanguage: \(c\) => call\('app:setLanguage', c\)/);

  const invoked = [];
  const Module = require('node:module');
  const load = Module._load;
  let api = null;
  Module._load = function (request, ...rest) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (_n, a) => (api = a) },
        ipcRenderer: {
          invoke: async (ch, arg) => {
            invoked.push([ch, arg]);
            if (arg === 'nope') return { ok: false, error: '未対応の言語' };
            if (arg === '') return { ok: false, error: '' };
            if (arg === 'boom') return null;
            return { ok: true, data: arg };
          },
          on() {},
          sendSync: (ch) => {
            assert.strictEqual(ch, 'app:language');
            return 'en';
          },
        },
      };
    }
    return load.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve('../preload.js')];
    require('../preload.js');
  } finally {
    Module._load = load;
  }
  assert.strictEqual(api.language, 'en');
  assert.strictEqual(typeof api.setLanguage, 'function');
  assert.strictEqual(await api.setLanguage('zh'), 'zh');
  await assert.rejects(() => api.setLanguage('nope'), (err) => err instanceof Error && err.message === '未対応の言語');
  await assert.rejects(() => api.setLanguage(''), (err) => err instanceof Error && err.message === '');
  await assert.rejects(() => api.setLanguage('boom'), TypeError);
  assert.deepStrictEqual(invoked, [
    ['app:setLanguage', 'zh'],
    ['app:setLanguage', 'nope'],
    ['app:setLanguage', ''],
    ['app:setLanguage', 'boom'],
  ]);
});
