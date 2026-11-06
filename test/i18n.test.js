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

test('後ろにつく括弧は、英西仏では空白のあと。空のときと中国語・日本語は空白を足さない', () => {
  const note = '（カスタムエージェントの工程があります。ほかのプロジェクトで使うときは「まとめてエクスポート」で一緒に書き出してください）';
  const compose = () => ({
    dev: `v0.1.8${I18n.tr('（開発版）')}`,
    latest: I18n.tr('最新の版です{v1}', { v1: I18n.tr('（{v1} に確かめました）', { v1: 'Nov 6' }) }),
    latestEmpty: I18n.tr('最新の版です{v1}', { v1: '' }),
    branch: I18n.tr('チェックアウト中のブランチ{v1}', { v1: I18n.tr('（今は {v1}）', { v1: 'main' }) }),
    branchEmpty: I18n.tr('チェックアウト中のブランチ{v1}', { v1: '' }),
    exported: I18n.tr('エクスポートしました{v1}', { v1: I18n.tr(note) }),
    exportedEmpty: I18n.tr('エクスポートしました{v1}', { v1: '' }),
    off: `Claude Code${I18n.tr('（使わない設定）')}`,
    ssh: I18n.tr('SSH 経由{v1}・ホストのポート {v2}', { v1: I18n.tr('（ポート {v1}）', { v1: 2222 }), v2: 17831 }),
    ssh22: I18n.tr('SSH 経由{v1}・ホストのポート {v2}', { v1: '', v2: 17831 }),
  });

  I18n.setLanguage('en');
  assert.deepStrictEqual(compose(), {
    dev: 'v0.1.8 (dev build)',
    latest: 'You are on the latest version (checked at Nov 6)',
    latestEmpty: 'You are on the latest version',
    branch: 'Checked-out branch (now main)',
    branchEmpty: 'Checked-out branch',
    exported: 'Exported (A step uses a custom agent. To use it in another project, export it together with “Export together”.)',
    exportedEmpty: 'Exported',
    off: 'Claude Code (not enabled)',
    ssh: 'via SSH (port 2222) · host port 17831',
    ssh22: 'via SSH · host port 17831',
  });

  I18n.setLanguage('es');
  assert.deepStrictEqual(compose(), {
    dev: 'v0.1.8 (versión de desarrollo)',
    latest: 'Estás en la última versión (comprobado el Nov 6)',
    latestEmpty: 'Estás en la última versión',
    branch: 'Rama actual (ahora main)',
    branchEmpty: 'Rama actual',
    exported: 'Exportado (Hay un paso con agente personalizado. Para usarlo en otro proyecto, expórtalo junto con «Exportar juntos».)',
    exportedEmpty: 'Exportado',
    off: 'Claude Code (no se usa)',
    ssh: 'por SSH (puerto 2222) · puerto del host 17831',
    ssh22: 'por SSH · puerto del host 17831',
  });

  I18n.setLanguage('fr');
  assert.deepStrictEqual(compose(), {
    dev: 'v0.1.8 (version de développement)',
    latest: 'Vous avez la dernière version (vérifié le Nov 6)',
    latestEmpty: 'Vous avez la dernière version',
    branch: 'Branche extraite (actuellement main)',
    branchEmpty: 'Branche extraite',
    exported: 'Exporté (Une étape utilise un agent personnalisé. Pour l’utiliser dans un autre projet, exportez-le avec « Exporter ensemble ».)',
    exportedEmpty: 'Exporté',
    off: 'Claude Code (non utilisé)',
    ssh: 'via SSH (port 2222) · port de l’hôte 17831',
    ssh22: 'via SSH · port de l’hôte 17831',
  });

  I18n.setLanguage('zh');
  assert.deepStrictEqual(compose(), {
    dev: 'v0.1.8（开发版）',
    latest: '已是最新版本（于 Nov 6 确认）',
    latestEmpty: '已是最新版本',
    branch: '当前检出的分支（当前是 main）',
    branchEmpty: '当前检出的分支',
    exported: '已导出（有使用自定义智能体的工序。要在其他项目使用时，请用「一起导出」一并写出。）',
    exportedEmpty: '已导出',
    off: 'Claude Code（设为不使用）',
    ssh: '通过 SSH（端口 2222） · 主机端口 17831',
    ssh22: '通过 SSH · 主机端口 17831',
  });

  I18n.setLanguage('ja');
  const ja = compose();
  assert.strictEqual(ja.dev, 'v0.1.8（開発版）');
  assert.strictEqual(ja.latestEmpty, '最新の版です');
  assert.strictEqual(ja.branchEmpty, 'チェックアウト中のブランチ');
  assert.strictEqual(ja.exportedEmpty, 'エクスポートしました');
  assert.strictEqual(ja.off, 'Claude Code（使わない設定）');
  assert.strictEqual(ja.ssh, 'SSH 経由（ポート 2222）・ホストのポート 17831');
  assert.strictEqual(ja.ssh22, 'SSH 経由・ホストのポート 17831');
  for (const s of Object.values(ja)) assert.strictEqual(s, s.trim(), s);
});

test('Pipeline の取り込み確認は、名前の区切りを訳す', () => {
  const src = read('renderer/renderer.js');
  const block = sliceBetween(src, 'const importFlows = async () => {', 'if (!m.addedPipelines.length');
  assert.match(block, /m\.addedPipelines\.join\(tr\('、'\)\)/);
  assert.doesNotMatch(block, /addedPipelines\.join\('、'\)/);
  I18n.setLanguage('en');
  assert.strictEqual(['速い', '丁寧'].join(I18n.tr('、')), '速い, 丁寧');
  I18n.setLanguage('es');
  assert.strictEqual(['速い', '丁寧'].join(I18n.tr('、')), '速い, 丁寧');
  I18n.setLanguage('fr');
  assert.strictEqual(['速い', '丁寧'].join(I18n.tr('、')), '速い, 丁寧');
  I18n.setLanguage('zh');
  assert.strictEqual(['速い', '丁寧'].join(I18n.tr('、')), '速い、丁寧');
  I18n.setLanguage('ja');
  assert.strictEqual(['速い', '丁寧'].join(I18n.tr('、')), '速い、丁寧');
  assert.strictEqual(['ひとつ'].join(I18n.tr('、')), 'ひとつ');
  assert.strictEqual([].join(I18n.tr('、')), '');
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

test('設定・公開鍵・gh の後ろにつく括弧は、英西仏では空白のあと。空のときと中国語・日本語は空白を足さない', () => {
  const src = read('renderer/renderer.js');
  const remote = sliceBetween(src, 'function openRemoteSettings()', 'function pickRepo(');
  const gh = sliceBetween(src, 'async function refreshGh()', 'function timeAgo(');
  assert.match(remote, /projectName \? tr\('（<code>\{v1\}<\/code>）'/);
  assert.match(remote, /r\.comment \? tr\('（\{v1\}）'/);
  assert.match(gh, /st\.user \? tr\('（<b>\{v1\}<\/b>）'/);
  assert.doesNotMatch(src, /`（<code>\$\{esc\(projectName\)\}<\/code>）`/);
  assert.doesNotMatch(src, /`（\$\{esc\(r\.comment\)\}）`/);
  assert.doesNotMatch(src, /`（<b>\$\{esc\(st\.user\)\}<\/b>）`/);

  const projectKey = '「このプロジェクト」の項目{v1}は、プロジェクト（リポジトリ）ごとに覚えます。タブを切り替えると、そのプロジェクトの設定に変わります。初めて開いたプロジェクトは初期値から始まります。';
  const compose = (name, comment, user) => ({
    project: I18n.tr(projectKey, { v1: name ? I18n.tr('（<code>{v1}</code>）', { v1: name }) : '' }),
    key: I18n.tr('鍵: {v1}{v2}', { v1: 'ssh-ed25519', v2: comment ? I18n.tr('（{v1}）', { v1: comment }) : '' }),
    gh: I18n.tr('<span>{v1}gh で GitHub にログインしています{v2}</span>', { v1: '', v2: user ? I18n.tr('（<b>{v1}</b>）', { v1: user }) : '' }),
  });
  const noExtra = (row) => {
    for (const s of Object.values(row)) {
      assert.strictEqual(s, s.trim(), s);
      assert.doesNotMatch(s, /  /, s);
    }
    // 外側の文に元からある括弧（「プロジェクト（リポジトリ）」）は残る。足した括弧だけが無いこと
    assert.doesNotMatch(row.project, /<code>/);
    assert.doesNotMatch(row.key, /[（(]/);
    assert.doesNotMatch(row.gh, /<b>/);
  };

  I18n.setLanguage('en');
  assert.deepStrictEqual(compose('repo', 'comment', 'user'), {
    project: 'Settings under “This project” (<code>repo</code>) are remembered per repository. Switching tabs switches to that project’s settings. A project opened for the first time starts from the defaults.',
    key: 'Key: ssh-ed25519 (comment)',
    gh: '<span>Signed in to GitHub with gh (<b>user</b>)</span>',
  });
  noExtra(compose('', '', ''));

  I18n.setLanguage('es');
  assert.deepStrictEqual(compose('repo', 'comment', 'user'), {
    project: 'Las opciones de «Este proyecto» (<code>repo</code>) se recuerdan por repositorio. Al cambiar de pestaña cambian los ajustes de ese proyecto. Un proyecto abierto por primera vez empieza con los valores iniciales.',
    key: 'Clave: ssh-ed25519 (comment)',
    gh: '<span>Sesión iniciada en GitHub con gh (<b>user</b>)</span>',
  });
  noExtra(compose('', '', ''));

  I18n.setLanguage('fr');
  assert.deepStrictEqual(compose('repo', 'comment', 'user'), {
    project: 'Les réglages de « Ce projet » (<code>repo</code>) sont mémorisés par dépôt. Changer d’onglet charge les réglages de ce projet. Un projet ouvert pour la première fois part des valeurs initiales.',
    key: 'Clé : ssh-ed25519 (comment)',
    gh: '<span>Connecté à GitHub avec gh (<b>user</b>)</span>',
  });
  noExtra(compose('', '', ''));

  I18n.setLanguage('zh');
  assert.deepStrictEqual(compose('repo', 'comment', 'user'), {
    project: '「此项目」中的项（<code>repo</code>）会按仓库分别记住。切换标签会换成该项目的设置。第一次打开的项目从初始值开始。',
    key: '密钥：ssh-ed25519（comment）',
    gh: '<span>已用 gh 登录 GitHub（<b>user</b>）</span>',
  });
  noExtra(compose('', '', ''));

  I18n.setLanguage('ja');
  const ja = compose('repo', 'comment', 'user');
  assert.strictEqual(ja.project, '「このプロジェクト」の項目（<code>repo</code>）は、プロジェクト（リポジトリ）ごとに覚えます。タブを切り替えると、そのプロジェクトの設定に変わります。初めて開いたプロジェクトは初期値から始まります。');
  assert.strictEqual(ja.key, '鍵: ssh-ed25519（comment）');
  assert.strictEqual(ja.gh, '<span>gh で GitHub にログインしています（<b>user</b>）</span>');
  noExtra(compose('', '', ''));
});

test('権限モードと「を使う」は描画時に tr を通り、4言語の訳がある', () => {
  const src = read('renderer/renderer.js');
  const modes = [
    '毎回確認する（すべての操作をカードで承認）',
    'ファイル編集は自動で許可、コマンドなどは確認する（おすすめ）',
    '計画だけ立てる（ファイルは変更しない）',
    'すべて自動で許可する（注意）',
  ];
  const head = src.slice(0, src.indexOf('function openRemoteSettings()'));
  const listed = [...head.matchAll(/^\s+\['(?:default|acceptEdits|plan|bypassPermissions)', tr\('([^']+)'\)\],$/gm)].map((m) => m[1]);
  assert.deepStrictEqual(listed, modes);
  const view = sliceBetween(src, 'function renderSettingsView()', 'function pickRepo(');
  const perm = view.slice(view.indexOf('permission:'), view.indexOf('task:'));
  assert.match(perm, /esc\(tr\(l\)\)/);
  assert.doesNotMatch(perm, />\$\{esc\(l\)\}</);
  // tr(l) は文字列リテラルではないので、openRemoteSettings からの漏れ検出には入らない
  for (const key of modes) assert.ok(!shellKeys().includes(key), key);

  const useKey = '<b>{v1}</b> を使う';
  const agent = sliceBetween(src, 'function agentConfigHtml(', 'function openRemoteSettings()');
  assert.match(agent, /\$\{agentIcon\(a\)\}\$\{tr\('<b>\{v1\}<\/b> を使う'/);
  assert.doesNotMatch(agent, /\$\{esc\(agentLabel\(a\)\)\}<\/b> を使う/);
  assert.ok(!shellKeys().includes(useKey), 'agentConfigHtml は検出範囲の外');

  const en = {
    [modes[0]]: 'Ask every time (approve every action on a card)',
    [modes[1]]: 'Allow file edits automatically, and confirm commands and the rest (recommended)',
    [modes[2]]: 'Plan only (do not change files)',
    [modes[3]]: 'Allow everything automatically (caution)',
  };
  const es = {
    [modes[0]]: 'Preguntar cada vez (aprobar todas las acciones en una tarjeta)',
    [modes[1]]: 'Permitir automáticamente las ediciones de archivos y confirmar los comandos y lo demás (recomendado)',
    [modes[2]]: 'Solo planificar (no modificar archivos)',
    [modes[3]]: 'Permitir todo automáticamente (precaución)',
  };
  const fr = {
    [modes[0]]: 'Demander à chaque fois (approuver chaque action sur une carte)',
    [modes[1]]: 'Autoriser automatiquement les modifications de fichiers, et confirmer les commandes et le reste (recommandé)',
    [modes[2]]: 'Planifier seulement (ne pas modifier les fichiers)',
    [modes[3]]: 'Tout autoriser automatiquement (attention)',
  };
  const zh = {
    [modes[0]]: '每次都确认（所有操作都在卡片上批准）',
    [modes[1]]: '自动允许文件编辑，命令等操作需要确认（推荐）',
    [modes[2]]: '只制定计划（不修改文件）',
    [modes[3]]: '全部自动允许（注意）',
  };
  for (const [lang, table] of [['en', en], ['es', es], ['fr', fr], ['zh', zh]]) {
    I18n.setLanguage(lang);
    for (const key of modes) {
      assert.strictEqual(I18n.has(key, lang), true, `${lang}: ${key}`);
      assert.strictEqual(I18n.tr(key), table[key]);
      assert.notStrictEqual(I18n.tr(key), key);
    }
    assert.strictEqual(I18n.has(useKey, lang), true);
    assert.notStrictEqual(I18n.tr(useKey, { v1: 'Claude Code' }), `${useKey}`);
  }
  I18n.setLanguage('en');
  assert.strictEqual(I18n.tr(useKey, { v1: 'Claude Code' }), 'Use <b>Claude Code</b>');
  I18n.setLanguage('es');
  assert.strictEqual(I18n.tr(useKey, { v1: 'Claude Code' }), 'Usar <b>Claude Code</b>');
  I18n.setLanguage('fr');
  assert.strictEqual(I18n.tr(useKey, { v1: 'Claude Code' }), 'Utiliser <b>Claude Code</b>');
  I18n.setLanguage('zh');
  assert.strictEqual(I18n.tr(useKey, { v1: 'Claude Code' }), '使用 <b>Claude Code</b>');
  I18n.setLanguage('ja');
  for (const key of modes) assert.strictEqual(I18n.tr(key), key);
  assert.strictEqual(I18n.tr(useKey, { v1: 'Claude Code' }), '<b>Claude Code</b> を使う');
  assert.strictEqual(I18n.tr(useKey, { v1: '' }), '<b></b> を使う');
});
