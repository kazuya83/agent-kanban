// ボード・詳細・チャット・差分の言語切り替え（原文は日本語）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const I18n = require('../renderer/i18n');
const { render } = require('../renderer/markdown');
const { parseDiff } = require('../renderer/diff-parse');

const LANGS = ['en', 'es', 'fr', 'zh'];
const HAS_JP = /[\u3040-\u309F\u30A1-\u30FA\u3400-\u9FFF]/;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// tr('…') の第1引数。キーは1行のシングルクォートなので、正規表現で足りる
function trKeys(src) {
  const keys = [];
  const re = /(?:^|[^A-Za-z0-9_$])tr\(\s*'((?:\\.|[^'\\])*)'/g;
  for (const m of src.matchAll(re)) keys.push(m[1].replace(/\\(.)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] || c));
  return keys;
}

function placeholders(s) {
  return [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

function boardSrc() {
  const src = read('renderer/renderer.js');
  const at = src.indexOf('// ---------------- モーダル ----------------');
  assert.ok(at > 0, '詳細より前の範囲が分かること');
  return src.slice(0, at);
}

function ownKeys() {
  const keys = new Set(trKeys(boardSrc()));
  for (const f of ['renderer/markdown.js', 'renderer/diff-parse.js']) for (const k of trKeys(read(f))) keys.add(k);
  return [...keys];
}

test('担当範囲の文言は4言語に訳され、差し込み名が一致する', () => {
  const keys = ownKeys();
  assert.ok(keys.length > 100);
  for (const key of keys) {
    for (const lang of LANGS) {
      assert.strictEqual(I18n.has(key, lang), true, `${lang}: ${key.slice(0, 80)}`);
      I18n.setLanguage(lang);
      const translated = I18n.tr(key);
      assert.deepStrictEqual(placeholders(translated), placeholders(key), key.slice(0, 80));
    }
  }
  I18n.setLanguage('ja');
});

test('日本語のときは原文のまま、未登録の文も原文のまま', () => {
  I18n.setLanguage('ja');
  assert.strictEqual(I18n.getLanguage(), 'ja');
  assert.strictEqual(I18n.locale(), 'ja-JP');
  assert.strictEqual(I18n.tr('実行中'), '実行中');
  assert.strictEqual(I18n.tr('まだ訳していない文'), 'まだ訳していない文');
  assert.strictEqual(I18n.tr('{n} 件', { n: 2 }), '2 件');
});

test('言語を選ぶと訳し、不正なコードは今の言語のまま', () => {
  assert.strictEqual(I18n.setLanguage('en'), 'en');
  assert.strictEqual(I18n.tr('実行中'), 'Running');
  assert.strictEqual(I18n.tr('レビュー'), 'Review');
  assert.strictEqual(I18n.locale(), 'en-US');
  for (const bad of ['de', 'EN', '', null, undefined, 1, {}, 'ja-JP']) {
    assert.strictEqual(I18n.setLanguage(bad), 'en', String(bad));
    assert.strictEqual(I18n.getLanguage(), 'en');
  }
  assert.strictEqual(I18n.setLanguage('es'), 'es');
  assert.strictEqual(I18n.tr('実行中'), 'En ejecución');
  assert.strictEqual(I18n.locale(), 'es-ES');
  assert.strictEqual(I18n.setLanguage('fr'), 'fr');
  assert.strictEqual(I18n.tr('実行中'), 'En cours');
  assert.strictEqual(I18n.setLanguage('zh'), 'zh');
  assert.strictEqual(I18n.tr('実行中'), '运行中');
  assert.strictEqual(I18n.locale(), 'zh-CN');
  assert.strictEqual(I18n.has('実行中', 'ja'), false);
  assert.strictEqual(I18n.has('ないキー', 'en'), false);
  I18n.setLanguage('ja');
});

test('差し込みは欠け・空・0・余分をそのまま扱う', () => {
  I18n.setLanguage('en');
  assert.strictEqual(I18n.tr('{m}分', { m: 0 }), '0 min');
  assert.strictEqual(I18n.tr('{m}分', { m: '' }), ' min');
  assert.strictEqual(I18n.tr('{m}分', {}), '{m} min');
  assert.strictEqual(I18n.tr('{m}分', { m: false, extra: 1 }), 'false min');
  assert.strictEqual(I18n.tr('{m}分', null), '{m} min');
  assert.strictEqual(I18n.tr(''), '');
  // 値の中の {name} はもう一度展開しない
  assert.strictEqual(I18n.tr('{m}分', { m: '{m}' }), '{m} min');
  I18n.setLanguage('ja');
  assert.strictEqual(I18n.tr('{m}分', { m: 0 }), '0分');
  assert.strictEqual(I18n.tr('{m}分', {}), '{m}分');
});

test('経過時間は訳した文言を切り出さず、分までの表示を別に作る', () => {
  const src = boardSrc();
  assert.ok(!src.includes('(\\d+分)'), '分と秒の正規表現で文言を加工していない');
  const elapsedSrc = src.slice(src.indexOf('function elapsed('), src.indexOf('function toast('));
  const durSrc = src.slice(src.indexOf('function durText('), src.indexOf('function hhmm('));
  const { elapsed, durText } = new Function('tr', `${elapsedSrc}\n${durSrc}\nreturn { elapsed, durText };`)(I18n.tr);
  assert.strictEqual(durText(0), '');
  assert.strictEqual(durText(-1), '');
  assert.strictEqual(durText(Number.NaN), '');
  I18n.setLanguage('ja');
  assert.strictEqual(durText(59000), '59秒');
  assert.strictEqual(durText(90000), '1分');
  assert.strictEqual(durText(3600000), '1時間0分');
  assert.strictEqual(elapsed(0), '');
  assert.match(elapsed(Date.now() - 5000), /^[45]秒$/);
  I18n.setLanguage('en');
  assert.strictEqual(durText(59000), '59 sec');
  assert.strictEqual(durText(90000), '1 min');
  assert.ok(!durText(90000).includes('秒'));
  assert.strictEqual(durText(3600000), '1 hr 0 min');
  assert.match(elapsed(Date.now() - 5000), /^[45] sec$/);
  I18n.setLanguage('zh');
  assert.strictEqual(durText(90000), '1 分钟');
  I18n.setLanguage('fr');
  assert.strictEqual(durText(90000), '1 min');
  I18n.setLanguage('es');
  assert.strictEqual(durText(90000), '1 min');
  I18n.setLanguage('ja');
});

test('日時の表示には選んだ言語のロケールを渡す', () => {
  const src = boardSrc();
  assert.match(src, /\.toLocaleString\(I18n\.locale\(\)\)/);
  assert.match(src, /\.toLocaleTimeString\(I18n\.locale\(\)\)/);
  assert.ok(!/\.toLocale(?:String|TimeString|DateString)\(\)/.test(src));
});

test('コードのコピーボタンと不明なパスは、選んだ言語になる', () => {
  const html = '```\necho <a>\n```';
  I18n.setLanguage('ja');
  assert.match(render(html), /title="このコードをコピー"/);
  assert.match(render(html), />コピー</);
  I18n.setLanguage('en');
  assert.match(render(html), /title="Copy this code"/);
  assert.match(render(html), />Copy</);
  I18n.setLanguage('es');
  assert.match(render(html), />Copiar</);
  I18n.setLanguage('fr');
  assert.match(render(html), />Copier</);
  I18n.setLanguage('zh');
  assert.match(render(html), />复制</);
  const unknown = 'diff --git "/dev/null" "/dev/null"\n';
  I18n.setLanguage('ja');
  assert.strictEqual(parseDiff(unknown)[0].path, '(不明)');
  I18n.setLanguage('en');
  assert.strictEqual(parseDiff(unknown)[0].path, '(unknown)');
  I18n.setLanguage('zh');
  assert.strictEqual(parseDiff(unknown)[0].path, '（未知）');
  // パスがあるふつうの diff は訳語に置き換わらない
  assert.strictEqual(parseDiff('diff --git a/foo b/foo\n')[0].path, 'foo');
  I18n.setLanguage('ja');
});

test('担当範囲の表示文は tr の外に残っていない', () => {
  const noComment = boardSrc().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const stripped = noComment.replace(/tr\(\s*'(?:\\.|[^'\\])*'/g, "tr(''");
  const left = [];
  for (const m of stripped.matchAll(/'((?:\\.|[^'\\])*)'/g)) if (HAS_JP.test(m[1])) left.push(m[1].slice(0, 40));
  for (const m of stripped.matchAll(/"((?:\\.|[^"\\])*)"/g)) if (HAS_JP.test(m[1])) left.push(m[1].slice(0, 40));
  for (const m of stripped.matchAll(/`([^`]*)`/g)) if (HAS_JP.test(m[1])) left.push(m[1].slice(0, 40));
  assert.deepStrictEqual(left, []);
});

const PUNCT = /[・「」（）]/;

function grab(src, startName, endName) {
  const s = src.indexOf(`function ${startName}(`);
  const e = src.indexOf(`function ${endName}(`);
  assert.ok(s >= 0 && e > s, startName);
  return src.slice(s, e);
}

test('括弧と区切りは tr の中にあり、英西仏の訳では全角のまま残らない', () => {
  const src = boardSrc();
  const noComment = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const stripped = noComment.replace(/tr\(\s*'(?:\\.|[^'\\])*'/g, "tr(''");
  assert.strictEqual(stripped.match(/[^\n]*[・「」（）][^\n]*/)?.[0] || '', '');

  const keys = ownKeys();
  for (const lang of ['en', 'es', 'fr']) {
    I18n.setLanguage(lang);
    for (const key of keys) assert.ok(!PUNCT.test(I18n.tr(key)), `${lang}: ${key.slice(0, 80)}`);
  }

  const bar = '<span class="rb-seg rs-{stt}" title="{n}. {label}（{who}）: {state}"></span>';
  const li = '<li><a href="#" data-open-card="{id}">{label}</a>（{who}・{st}）</li>';
  const elapsed = '（<span class="elapsed" data-since="{since}">{elapsed}</span>）';
  const chip = keys.find((k) => k.includes('attach-chip') && k.includes('（{v}）'));
  const progress = keys.find((k) => k.includes('{counts} ・ {v}'));
  assert.ok(chip && progress);

  I18n.setLanguage('ja');
  assert.strictEqual(I18n.tr('{name}（{cli}）', { name: 'Pat', cli: 'Claude' }), 'Pat（Claude）');
  assert.strictEqual(I18n.tr('「{name}」', { name: '設計' }), '「設計」');
  assert.strictEqual(I18n.tr('{a}・{b}', { a: '「設計」', b: '「実装」' }), '「設計」・「実装」');
  assert.strictEqual(I18n.tr('（{at}）', { at: '09:00' }), '（09:00）');
  assert.strictEqual(I18n.tr('完了 {n}', { n: 0 }), '完了 0');
  assert.strictEqual(I18n.tr(bar, { stt: 'running', n: 1, label: 'L', who: 'C', state: '実行中' }), '<span class="rb-seg rs-running" title="1. L（C）: 実行中"></span>');

  I18n.setLanguage('en');
  assert.strictEqual(I18n.tr('{name}（{cli}）', { name: 'Pat', cli: 'Claude' }), 'Pat (Claude)');
  assert.strictEqual(I18n.tr('「{name}」', { name: 'Design' }), '“Design”');
  assert.strictEqual(I18n.tr('{a}・{b}', { a: '“Design”', b: '“Build”' }), '“Design” · “Build”');
  assert.strictEqual(I18n.tr(' ・ '), ' · ');
  assert.strictEqual(I18n.tr('（{at}）', { at: '' }), ' ()');
  assert.strictEqual(I18n.tr('{name}（{cli}）', {}), '{name} ({cli})');
  assert.strictEqual(I18n.tr('{name}（{cli}）', { name: 'A<B>', cli: 'C"D', extra: 1 }), 'A<B> (C"D)');
  assert.strictEqual(I18n.tr('完了 {n}', { n: 0 }), 'Done 0');
  assert.strictEqual(I18n.tr('完了 {n}', { n: '' }), 'Done ');
  assert.strictEqual(I18n.tr(bar, { stt: 'running', n: 2, label: 'A&amp;B', who: 'Pat', state: 'Running' }), '<span class="rb-seg rs-running" title="2. A&amp;B (Pat): Running"></span>');
  assert.strictEqual(I18n.tr(li, { id: 'a&quot;b', label: 'Branch', who: 'Claude', st: 'Review' }), '<li><a href="#" data-open-card="a&quot;b">Branch</a> (Claude · Review)</li>');
  assert.strictEqual(I18n.tr(elapsed, { since: '12', elapsed: '1 min' }), ' (<span class="elapsed" data-since="12">1 min</span>)');
  assert.match(I18n.tr(chip, { name: 'a.txt', v: '1 KB', v2: '', i: 0 }), /title="a\.txt \(1 KB\)"/);
  assert.match(I18n.tr(progress), /\{counts\} · \{v\}/);
  assert.ok(!I18n.tr(progress).includes('・'));

  I18n.setLanguage('es');
  assert.strictEqual(I18n.tr('「{name}」', { name: 'Diseño' }), '«Diseño»');
  assert.strictEqual(I18n.tr(li, { id: '1', label: 'Rama', who: 'Claude', st: 'Revisión' }), '<li><a href="#" data-open-card="1">Rama</a> (Claude · Revisión)</li>');
  I18n.setLanguage('fr');
  assert.strictEqual(I18n.tr('「{name}」', { name: 'Plan' }), '« Plan »');
  assert.strictEqual(I18n.tr(bar, { stt: 'done', n: 3, label: 'L', who: 'C', state: 'Terminé' }), '<span class="rb-seg rs-done" title="3. L (C) : Terminé"></span>');
  assert.strictEqual(I18n.setLanguage('EN'), 'fr');
  assert.strictEqual(I18n.tr('「{name}」', { name: 'Plan' }), '« Plan »');

  I18n.setLanguage('zh');
  assert.strictEqual(I18n.tr('{name}（{cli}）', { name: 'Pat', cli: 'Claude' }), 'Pat（Claude）');
  assert.strictEqual(I18n.tr('「{name}」', { name: '设计' }), '「设计」');
  assert.strictEqual(I18n.tr('{a}・{b}', { a: '甲', b: '乙' }), '甲、乙');
  assert.strictEqual(I18n.tr(bar, { stt: 'pending', n: 1, label: 'L', who: 'C', state: '等待' }), '<span class="rb-seg rs-pending" title="1. L（C）：等待"></span>');
  assert.strictEqual(I18n.tr(li, { id: '1', label: '分支', who: 'Claude', st: '审查' }), '<li><a href="#" data-open-card="1">分支</a>（Claude、审查）</li>');
  assert.strictEqual(I18n.tr(elapsed, { since: '12', elapsed: '1 分钟' }), '（<span class="elapsed" data-since="12">1 分钟</span>）');
  assert.match(I18n.tr(chip, { name: 'a.txt', v: '1 KB', v2: '', i: 0 }), /title="a\.txt（1 KB）"/);
  assert.match(I18n.tr(progress), /\{counts\} · \{v\}/);
  I18n.setLanguage('ja');
});

test('名前の列と箇条書きの区切りは、空や1件でも崩れない', () => {
  const src = boardSrc();
  const { joinMid, quoteNames } = new Function('tr', `${grab(src, 'joinMid', 'stepWho')}\nreturn { joinMid, quoteNames };`)(I18n.tr);
  const { plainText } = new Function('tr', `${grab(src, 'plainText', 'card')}\nreturn { plainText };`)(I18n.tr);
  assert.strictEqual(src.match(/quoteNames\(x\.after\.map\(\(a\) => esc\(title\.get\(a\) \|\| a\)\)\)/g).length, 3);
  assert.match(src, /tr\('「\{name\}」', \{ name: esc\(r\.pipeline\.name\) \}\)/);
  assert.match(src, /tr\('<span class="muted small">（\{at\}）<\/span>', \{ at: esc\(/);
  assert.match(src, /tr\('（\{at\}）', \{ at: esc\(hhmm\(x\.mergedAt\)\) \}\)/);
  assert.match(src, /label: esc\(st\.label\),\s*who: esc\(whoShort\(st\.agent, st\.persona\)\),\s*state: esc\(RELAY_STATE\[stt\]\[1\]\)/);
  assert.match(src, /id: esc\(k\.id\), label: esc\(k\.relay\.branchOf\.label\), who: esc\(agentShort\(agentOf\(k\)\)\), st: esc\(st\)/);

  I18n.setLanguage('ja');
  assert.strictEqual(joinMid(null), '');
  assert.strictEqual(joinMid(undefined), '');
  assert.strictEqual(joinMid([]), '');
  assert.strictEqual(joinMid(['だけ']), 'だけ');
  assert.strictEqual(joinMid(['A', 'B', 'C']), 'A・B・C');
  assert.strictEqual(joinMid(['', '']), '・');
  assert.strictEqual(quoteNames(null), '');
  assert.strictEqual(quoteNames([]), '');
  assert.strictEqual(quoteNames(['設計']), '「設計」');
  assert.strictEqual(quoteNames(['設計', '実装']), '「設計」・「実装」');
  assert.strictEqual(quoteNames(['<b>']), '「<b>」');
  assert.strictEqual(plainText(null), '');
  assert.strictEqual(plainText(''), '');
  assert.strictEqual(plainText('-'), '-');
  assert.strictEqual(plainText('- 実行中\n* 次\n+ 最後'), '・実行中 ・次 ・最後');
  assert.strictEqual(plainText('```\n- hidden\n```'), '');

  I18n.setLanguage('en');
  assert.strictEqual(joinMid(['A', 'B', 'C']), 'A · B · C');
  assert.strictEqual(joinMid([0, false]), '0 · false');
  assert.strictEqual(quoteNames(['Design', 'Build']), '“Design” · “Build”');
  assert.strictEqual(quoteNames(['']), '“”');
  assert.strictEqual(plainText('- 実行中\n* 次'), '·実行中 ·次');
  I18n.setLanguage('zh');
  assert.strictEqual(joinMid(['甲', '乙']), '甲、乙');
  assert.strictEqual(quoteNames(['设计', '实现']), '「设计」、「实现」');
  assert.strictEqual(I18n.setLanguage(''), 'zh');
  assert.strictEqual(quoteNames(['设计']), '「设计」');
  I18n.setLanguage('ja');
});
