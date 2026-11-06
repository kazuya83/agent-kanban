// 画面の言葉（フロー・スケジュール・モーダル）が、選んだ言語に切り替わることを確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const I18n = require('../renderer/i18n.js');
const ScheduleModel = require('../renderer/schedule-model');
const FlowModel = require('../renderer/flow-model');

const LANGS = ['en', 'es', 'fr', 'zh'];
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

function withLanguage(code, fn) {
  const prev = I18n.getLanguage();
  I18n.setLanguage(code);
  try {
    return fn();
  } finally {
    I18n.setLanguage(prev);
  }
}

test.after(() => {
  I18n.setLanguage('ja');
});

test('日本語は原文のまま返し、差し込みだけ行う', () => {
  assert.strictEqual(I18n.getLanguage(), 'ja');
  assert.strictEqual(I18n.tr('曜日を1つ以上選んでください'), '曜日を1つ以上選んでください');
  assert.strictEqual(I18n.tr('毎時 {minute}分', { minute: 0 }), '毎時 0分');
  assert.strictEqual(I18n.tr('毎時 {minute}分', { minute: 0, extra: 9 }), '毎時 0分');
  assert.strictEqual(I18n.tr('毎時 {minute}分', {}), '毎時 {minute}分');
  assert.strictEqual(I18n.tr('毎時 {minute}分'), '毎時 {minute}分');
  assert.strictEqual(I18n.tr(''), '');
});

test('知らない言語には切り替わらない', () => {
  for (const bad of ['nope', '', null, undefined, 'EN', 'zh-CN', 'ja-JP', 1, 'zh ']) {
    assert.strictEqual(I18n.setLanguage('en'), 'en');
    assert.strictEqual(I18n.setLanguage(bad), 'en', JSON.stringify(bad));
    assert.strictEqual(I18n.getLanguage(), 'en');
  }
  assert.strictEqual(I18n.setLanguage('ja'), 'ja');
});

test('訳がないキーは原文に戻り、空の差し込みは残す', () => {
  withLanguage('en', () => {
    assert.strictEqual(I18n.tr('この文は訳していない'), 'この文は訳していない');
    assert.strictEqual(I18n.tr('この文は訳していない', { n: 1 }), 'この文は訳していない');
    assert.strictEqual(I18n.tr('毎時 {minute}分', { hour: 1 }), 'Every hour at minute {minute}');
    assert.strictEqual(I18n.tr(' ほか {n} 件', { n: 0 }), ' (0 more)');
    assert.strictEqual(I18n.has('この文は訳していない', 'en'), false);
    assert.strictEqual(I18n.has('毎時 {minute}分', 'en'), true);
  });
});

test('曜日と繰り返しの文が各言語になる', () => {
  const weekly = { kind: 'weekly', weekdays: [0, 1], hour: 9, minute: 0 };
  const expectDays = {
    ja: ['日', '月', '火', '水', '木', '金', '土'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
    fr: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
    zh: ['日', '一', '二', '三', '四', '五', '六'],
  };
  const expectWeekly = {
    ja: '毎週 日・月 09:00',
    en: 'Every week Sun, Mon 09:00',
    es: 'Cada semana dom, lun 09:00',
    fr: 'Chaque semaine dim, lun 09:00',
    zh: '每周 日、一 09:00',
  };
  for (const lang of ['ja', ...LANGS]) {
    withLanguage(lang, () => {
      assert.deepStrictEqual(ScheduleModel.WEEKDAY_NAMES, expectDays[lang]);
      assert.strictEqual(ScheduleModel.describeRule(weekly), expectWeekly[lang]);
      assert.notStrictEqual(expectWeekly[lang], '', lang);
    });
  }
  withLanguage('en', () => {
    assert.strictEqual(ScheduleModel.describeRule({ kind: 'once', at: at(2026, 11, 7, 9, 5) }), 'Once on 2026/11/07 at 09:05');
    assert.strictEqual(ScheduleModel.describeRule({ kind: 'hourly', minute: 0 }), 'Every hour at minute 0');
    assert.strictEqual(ScheduleModel.describeRule({ kind: 'daily', hour: 9, minute: 5 }), 'Every day at 09:05');
    assert.strictEqual(ScheduleModel.describeRule({ kind: 'monthly', day: 15, hour: 9, minute: 0 }), 'Day 15 of every month at 09:00');
    assert.strictEqual(
      ScheduleModel.describeRule({ kind: 'monthly', day: 29, hour: 9, minute: 0 }),
      'Day 29 of every month at 09:00 (the last day if that day does not exist)',
    );
    assert.strictEqual(ScheduleModel.describeRule(null), '');
    assert.strictEqual(ScheduleModel.describeRule({ kind: 'yearly' }), '');
  });
  withLanguage('es', () => {
    assert.strictEqual(ScheduleModel.describeRule({ kind: 'daily', hour: 9, minute: 5 }), 'Cada día a las 09:05');
  });
  withLanguage('fr', () => {
    assert.strictEqual(ScheduleModel.describeRule({ kind: 'hourly', minute: 5 }), 'Toutes les heures à la minute 5');
  });
  withLanguage('zh', () => {
    assert.strictEqual(ScheduleModel.describeRule({ kind: 'monthly', day: 15, hour: 9, minute: 0 }), '每月 15 日 09:00');
  });
});

test('フローとスケジュールの確かめ文が各言語になり、失敗のときは理由を返す', () => {
  const base = { repoPath: '/repo', prompt: '調べる' };
  const cases = [
    [{}, '先にリポジトリを選んでください'],
    [null, '先にリポジトリを選んでください'],
    [{ repoPath: '  ' }, '先にリポジトリを選んでください'],
    [{ repoPath: '/repo', prompt: '  ' }, '指示を入力してください'],
    [{ ...base, rule: { kind: 'once' } }, '実行する日時を入力してください'],
    [{ ...base, rule: { kind: 'weekly', weekdays: [] } }, '曜日を1つ以上選んでください'],
    [{ ...base, rule: { kind: 'daily', hour: 24, minute: 0 } }, '繰り返しの日時の値が正しくありません'],
    [{ ...base, rule: { kind: 'nope' } }, '繰り返しの種類を選んでください'],
  ];
  const words = {
    en: ['Choose a repository', 'Choose a repository', 'Choose a repository', 'Enter instructions', 'date and time', 'weekday', 'not valid', 'repeat type'],
    es: ['repositorio', 'repositorio', 'repositorio', 'instrucciones', 'fecha', 'día', 'no es válida', 'repetición'],
    fr: ['dépôt', 'dépôt', 'dépôt', 'instructions', 'date', 'jour', 'pas valable', 'répétition'],
    zh: ['仓库', '仓库', '仓库', '指示', '日期', '星期', '不正确', '重复'],
  };
  for (const lang of LANGS) {
    withLanguage(lang, () => {
      assert.deepStrictEqual(FlowModel.validateFlow(null), [I18n.tr('フローがありません')]);
      assert.deepStrictEqual(FlowModel.validateFlow({ nodes: [], edges: [] }), [I18n.tr('開始のノードがありません')]);
      assert.notStrictEqual(FlowModel.validateFlow(null)[0], 'フローがありません');
      assert.match(FlowModel.validateFlow(null)[0], lang === 'zh' ? /没有流程图/ : /flowchart|diagrama|organigramme/i);
      cases.forEach(([input, key], i) => {
        const msg = ScheduleModel.scheduleError(input);
        assert.strictEqual(msg, I18n.tr(key), key);
        assert.notStrictEqual(msg, key);
        assert.match(msg, new RegExp(words[lang][i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      });
      assert.strictEqual(ScheduleModel.scheduleError({ ...base, rule: { kind: 'daily', hour: 0, minute: 0 } }), '');
    });
  }
  assert.strictEqual(ScheduleModel.scheduleError({}), '先にリポジトリを選んでください');
  assert.deepStrictEqual(FlowModel.validateFlow(null), ['フローがありません']);
});

test('担当範囲の tr() は4言語すべてにあり、差し込み名が一致する', () => {
  const root = path.join(__dirname, '..', 'renderer');
  const files = [
    ['renderer.js', [2900, 3647], [4543, 4844], [4948, 5164]],
    ['flow-editor.js'],
    ['flow-view.js'],
    ['flow-model.js'],
    ['pipeline-pack.js'],
    ['scheduler-view.js'],
    ['schedule-model.js'],
  ];
  const keys = [];
  for (const [name, ...ranges] of files) {
    const lines = fs.readFileSync(path.join(root, name), 'utf8').split('\n');
    const use = ranges.length ? ranges : [[1, lines.length]];
    for (const [start, end] of use) {
      for (const line of lines.slice(start - 1, end)) {
        for (const m of line.matchAll(/tr\('((?:\\'|[^'])*)'/g)) {
          keys.push(Function(`return '${m[1]}'`)());
        }
      }
    }
  }
  assert.ok(keys.length > 100, `抽出が少なすぎます: ${keys.length}`);
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const key of new Set(keys)) {
    for (const lang of LANGS) {
      assert.strictEqual(I18n.has(key, lang), true, `${lang} に訳がありません: ${JSON.stringify(key)}`);
      withLanguage(lang, () => {
        const text = I18n.tr(key);
        assert.strictEqual(ph(text), ph(key), `${lang} の差し込みが違います: ${JSON.stringify(key)}`);
        if (lang !== 'zh' && text === key && /[\u3040-\u30ff\u4e00-\u9fff]/.test(key)) {
          assert.fail(`${lang} が原文のままです: ${JSON.stringify(key)}`);
        }
      });
    }
  }
});
