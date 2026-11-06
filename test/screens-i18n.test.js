// 画面の言葉（フロー・スケジュール・モーダル）が、選んだ言語に切り替わることを確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const I18n = require('../renderer/i18n.js');
const ScheduleModel = require('../renderer/schedule-model');
const FlowModel = require('../renderer/flow-model');
const FlowView = require('../renderer/flow-view');

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

test('フォルダ名と「を使う」は、4言語で語順の通った1文になる', () => {
  const use = {
    ja: 'Claude を使う',
    en: 'Use Claude',
    es: 'Usar Claude',
    fr: 'Utiliser Claude',
    zh: '使用 Claude',
  };
  const folder = {
    ja: 'フォルダ名（空なら URL から決めます）',
    en: 'Folder name (taken from the URL if blank)',
    es: 'Nombre de la carpeta (si está vacío, se decide a partir de la URL)',
    fr: 'Nom du dossier (déduit de l\'URL si vide)',
    zh: '文件夹名（留空则根据 URL 决定）',
  };
  const wsl = {
    ja: 'Ubuntu（WSL）',
    en: 'Ubuntu (WSL)',
    es: 'Ubuntu (WSL)',
    fr: 'Ubuntu (WSL)',
    zh: 'Ubuntu（WSL）',
  };
  const save = {
    ja: '保存（Ctrl/⌘ + Enter）',
    en: 'Save (Ctrl/⌘ + Enter)',
    es: 'Guardar (Ctrl/⌘ + Enter)',
    fr: 'Enregistrer (Ctrl/⌘ + Entrée)',
    zh: '保存（Ctrl/⌘ + Enter）',
  };
  const add = {
    ja: '登録（Ctrl/⌘ + Enter）',
    en: 'Add (Ctrl/⌘ + Enter)',
    es: 'Registrar (Ctrl/⌘ + Enter)',
    fr: 'Enregistrer (Ctrl/⌘ + Entrée)',
    zh: '登记（Ctrl/⌘ + Enter）',
  };
  const how = {
    ja: 'ソースを変更しない・起動後に1回だけ追いつく',
    en: 'Do not change source, Catch up once after launch',
    es: 'No cambiar el código, Ponerse al día una vez al abrir',
    fr: 'Ne pas modifier le code, Rattraper une fois après le lancement',
    zh: '不修改源代码、启动后补跑一次',
  };
  for (const lang of ['ja', ...LANGS]) {
    withLanguage(lang, () => {
      assert.strictEqual(I18n.tr('{name} を使う', { name: 'Claude' }), use[lang], lang);
      assert.strictEqual(I18n.tr('フォルダ名（空なら URL から決めます）'), folder[lang], lang);
      assert.strictEqual(I18n.tr('{name}（WSL）', { name: 'Ubuntu' }), wsl[lang], lang);
      assert.strictEqual(I18n.tr('保存（Ctrl/⌘ + Enter）'), save[lang], lang);
      assert.strictEqual(I18n.tr('登録（Ctrl/⌘ + Enter）'), add[lang], lang);
      assert.strictEqual([I18n.tr('ソースを変更しない'), I18n.tr('起動後に1回だけ追いつく')].join(I18n.tr('・')), how[lang], lang);
      if (lang === 'en' || lang === 'es' || lang === 'fr') {
        assert.match(folder[lang], / \(/);
        assert.doesNotMatch(use[lang], / — /);
        assert.match(how[lang], /, /);
      }
    });
  }
  withLanguage('en', () => {
    assert.strictEqual(I18n.tr('{name} を使う', {}), 'Use {name}');
    assert.strictEqual(I18n.tr('{name} を使う', { name: '' }), 'Use ');
    assert.strictEqual(I18n.tr('{name} を使う', { name: 0 }), 'Use 0');
    assert.strictEqual(I18n.tr('{name}（WSL）', { name: '' }), ' (WSL)');
    assert.strictEqual(I18n.tr('{name}（WSL）', { extra: 1 }), '{name} (WSL)');
  });
  const root = path.join(__dirname, '..', 'renderer');
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const sched = fs.readFileSync(path.join(root, 'scheduler-view.js'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'flow-editor.js'), 'utf8');
  assert.match(renderer, /tr\('<b>\{v1\}<\/b> を使う'/);
  assert.doesNotMatch(renderer, /tr\(' を使う'\)/);
  assert.match(renderer, /tr\('フォルダ名（空なら URL から決めます）'\)/);
  assert.doesNotMatch(renderer, /tr\('（空なら URL から決めます）'\)/);
  assert.match(renderer, /tr\('\{name\}（WSL）'/);
  assert.doesNotMatch(renderer, /（WSL）<\/option>/);
  assert.match(sched, /join\(tr\('・'\)\)/);
  assert.match(sched, /tr\('保存（Ctrl\/⌘ \+ Enter）'\)/);
  assert.match(sched, /tr\('登録（Ctrl\/⌘ \+ Enter）'\)/);
  assert.doesNotMatch(sched, /\}（Ctrl\/⌘ \+ Enter）/);
  assert.match(editor, /tr\('\{icon\}\{name\}（\{agent\}\{model\}）\{off\}'/);
  assert.doesNotMatch(editor, /\$\{ca\.name\}（/);
});

test('言語が英語でもプロンプト用の種別名は日本語のままで、文字列化できる', () => {
  const flow = {
    nodes: [
      { id: 'start', type: 'start', x: 0, y: 0 },
      { id: 's1', type: 'step', x: 0, y: 100, agent: 'claude', label: '実装', instruction: 'do' },
      { id: 'end', type: 'end', x: 0, y: 200 },
      { id: 'br', type: 'if', x: 40, y: 300, label: 'レビュー' },
    ],
    edges: [{ id: 'e1', from: 'start', to: 's1' }],
  };
  withLanguage('en', () => {
    assert.strictEqual(FlowModel.TYPE_LABEL.if, '分岐');
    assert.strictEqual(FlowModel.TYPE_LABEL.start, '開始');
    assert.strictEqual(FlowModel.TYPE_LABEL.end, '終了');
    assert.strictEqual(FlowModel.TYPE_LABEL.nope, undefined);
    assert.strictEqual(FlowModel.labelOf({ type: 'if', label: 'レビュー' }), 'レビュー');
    assert.strictEqual(FlowModel.labelOf({ type: 'if' }), '分岐');
    assert.strictEqual(FlowModel.labelOf({ type: 'end' }), '終了');
    assert.strictEqual(FlowModel.labelOf(null), '');
    assert.strictEqual(`${FlowModel.TYPE_LABEL.if}「${FlowModel.labelOf({ type: 'if', label: '判定' })}」へ進みます`, '分岐「判定」へ進みます');
    let text = '';
    assert.doesNotThrow(() => {
      text = String(FlowModel.TYPE_LABEL);
    });
    assert.strictEqual(typeof text, 'string');
    assert.strictEqual(text, '[object Object]');
    assert.strictEqual(typeof FlowModel.TYPE_LABEL.toString, 'function');
    const errs = FlowModel.validateFlow(flow);
    const endErr = errs.find((e) => e.includes('End'));
    assert.ok(endErr, errs.join('\n'));
    assert.doesNotMatch(endErr, /終了|分岐/);
    assert.ok(errs.every((e) => !e.includes('分岐')), errs.join('\n'));
    const svg = FlowView.html(flow, new Map());
    assert.match(svg, />Start/);
    assert.match(svg, />End/);
    assert.match(svg, /Branch/);
    assert.match(svg, /レビュー/);
    assert.doesNotMatch(svg, />開始/);
  });
  withLanguage('ja', () => {
    const errs = FlowModel.validateFlow(flow);
    assert.ok(errs.some((e) => e.includes('終了「終了」に入る線がありません')), errs.join('\n'));
    assert.strictEqual(FlowModel.TYPE_LABEL.if, '分岐');
  });
  withLanguage('fr', () => {
    const svg = FlowView.html(flow, new Map());
    assert.match(svg, /Début/);
    assert.match(svg, /Fin/);
    assert.strictEqual(FlowModel.TYPE_LABEL.if, '分岐');
  });
});

test('言語が英語でも、保存する既定の名前は日本語のまま', () => {
  const raw = {
    nodes: [
      { id: 'start', type: 'start', x: 0, y: 0 },
      { id: 's1', type: 'step', x: 0, y: 80, agent: 'claude', label: '  ' },
      { id: 's2', type: 'step', x: 0, y: 160, agent: 'codex', label: '実装' },
      { id: 'br', type: 'if', x: 0, y: 240, label: '' },
      { id: 'par', type: 'parallel', x: 0, y: 320, label: '   ' },
      { id: 'join', type: 'join', x: 0, y: 400 },
      { id: 'end', type: 'end', x: 0, y: 480 },
    ],
    edges: [],
  };
  for (const lang of ['en', 'es', 'fr', 'zh', 'ja']) {
    withLanguage(lang, () => {
      const flow = FlowModel.cleanFlow(raw);
      const label = (id) => flow.nodes.find((n) => n.id === id).label;
      assert.strictEqual(label('s1'), '工程1', lang);
      assert.strictEqual(label('s2'), '実装', lang);
      assert.strictEqual(label('br'), '分岐', lang);
      assert.strictEqual(label('par'), '並列', lang);
      assert.strictEqual(label('join'), '合流', lang);
      assert.strictEqual(FlowModel.labelOf(flow.nodes.find((n) => n.id === 'br')), '分岐', lang);
      assert.strictEqual(FlowModel.labelOf(flow.nodes.find((n) => n.id === 's1')), '工程1', lang);
      const translated = I18n.tr('工程{n}', { n: 1 });
      if (translated !== '工程1') assert.notStrictEqual(label('s1'), translated, lang);
    });
  }
  withLanguage('en', () => {
    const long = FlowModel.cleanFlow({ nodes: [{ id: 's', type: 'step', label: 'あ'.repeat(40) }], edges: [] });
    assert.strictEqual(long.nodes.find((n) => n.type === 'step').label, 'あ'.repeat(30));
    const kept = FlowModel.cleanFlow({ nodes: [{ id: 's', type: 'step', label: '0' }, { id: 'b', type: 'if', label: 'Branch' }], edges: [] });
    assert.strictEqual(kept.nodes.find((n) => n.id === 's').label, '0');
    assert.strictEqual(kept.nodes.find((n) => n.id === 'b').label, 'Branch');
    assert.strictEqual(FlowModel.cleanFlow(null), null);
    assert.strictEqual(FlowModel.cleanFlow({}), null);
    assert.strictEqual(FlowModel.cleanFlow({ nodes: 'x' }), null);

    const made = FlowModel.flowFromSteps([{ agent: 'claude', instruction: '', onPass: 'end', onFail: 'end' }]);
    const step = made.nodes.find((n) => n.type === 'step');
    const branch = made.nodes.find((n) => n.type === 'if');
    assert.strictEqual(step.label, '工程1');
    assert.strictEqual(branch.label, '工程1の判定');
    assert.strictEqual(branch.question, '作業の結果を判定してください');
    assert.strictEqual(FlowModel.labelOf(branch), '工程1の判定');
    assert.strictEqual(FlowModel.labelOf(step), '工程1');
    const pass = made.edges.find((e) => e.value === 'pass');
    const fail = made.edges.find((e) => e.value === 'fail');
    assert.strictEqual(pass.when, '問題がない（合格）');
    assert.strictEqual(fail.when, '直す必要がある（差し戻し）');
    assert.ok(pass.else);
    assert.notStrictEqual(branch.label, 'Judgment of Step 1');

    const named = FlowModel.flowFromSteps([{ agent: 'codex', label: '実装', onPass: 1 }]);
    assert.strictEqual(named.nodes.find((n) => n.type === 'step').label, '実装');
    assert.strictEqual(named.nodes.find((n) => n.type === 'if').label, '実装の判定');
    assert.strictEqual(named.nodes.find((n) => n.type === 'if').question, '作業の結果を判定してください');
    const plain = FlowModel.flowFromSteps([{ agent: 'claude', label: '書く' }]);
    assert.strictEqual(plain.nodes.find((n) => n.type === 'if'), undefined);
    const none = FlowModel.flowFromSteps(null);
    assert.ok(none.nodes.some((n) => n.type === 'start'));
    assert.strictEqual(none.nodes.find((n) => n.type === 'if'), undefined);
    assert.strictEqual(none.nodes.find((n) => n.type === 'step'), undefined);

    assert.strictEqual(FlowModel.displayText('工程2', 'step'), 'Step 2');
    assert.strictEqual(FlowModel.displayText('工程1の判定', 'if'), 'Judgment of Step 1');
    assert.strictEqual(FlowModel.displayText('実装の判定', 'if'), 'Judgment of 実装');
    assert.strictEqual(FlowModel.displayText('分岐', 'if'), 'Branch');
    assert.strictEqual(FlowModel.displayText('分岐', 'step'), '分岐');
    assert.strictEqual(FlowModel.displayText('レビュー', 'if'), 'レビュー');
    assert.strictEqual(FlowModel.displayText('', 'step'), '');
    assert.strictEqual(FlowModel.displayText('の判定', 'if'), 'の判定');
    assert.strictEqual(FlowModel.displayText(null), '');
    assert.strictEqual(FlowModel.shownLabel({ type: 'parallel', label: '並列' }), 'Parallel');
    assert.strictEqual(FlowModel.shownLabel({ type: 'join' }), 'Join');
    assert.strictEqual(FlowModel.shownLabel(null), '');
    assert.strictEqual(FlowModel.labelOf({ type: 'if' }), '分岐');
    assert.strictEqual(FlowModel.isDefaultLabel({ type: 'step', label: '工程1' }), true);
    assert.strictEqual(FlowModel.isDefaultLabel({ type: 'if', label: '工程1の判定' }), true);
    assert.strictEqual(FlowModel.isDefaultLabel({ type: 'if', label: '分岐' }), true);
    assert.strictEqual(FlowModel.isDefaultLabel({ type: 'parallel', label: '' }), true);
    assert.strictEqual(FlowModel.isDefaultLabel({ type: 'step', label: '実装' }), false);
    assert.strictEqual(FlowModel.isDefaultLabel({ type: 'if', label: 'Branch' }), false);
    assert.strictEqual(FlowModel.isDefaultLabel(null), false);
    assert.strictEqual(FlowModel.isDefaultLabel({ label: '分岐' }), false);

    const svg = FlowView.html(made, new Map());
    assert.match(svg, /Step 1/);
    assert.match(svg, /Judgment of Step 1/);
    assert.doesNotMatch(svg, /工程1/);
    const node = { type: 'if', label: '分岐' };
    assert.strictEqual(FlowModel.shownLabel(node), 'Branch');
    assert.strictEqual(node.label, '分岐');
  });
  withLanguage('ja', () => {
    const made = FlowModel.flowFromSteps([{ agent: 'claude', onPass: 'end' }]);
    assert.strictEqual(made.nodes.find((n) => n.type === 'if').label, '工程1の判定');
    assert.strictEqual(FlowModel.displayText('工程1', 'step'), '工程1');
    assert.strictEqual(FlowModel.displayText('工程1の判定'), '工程1の判定');
    assert.strictEqual(FlowModel.shownLabel({ type: 'if', label: '分岐' }), '分岐');
  });
  withLanguage('es', () => {
    assert.strictEqual(FlowModel.displayText('工程3', 'step'), 'Paso 3');
    assert.strictEqual(FlowModel.cleanFlow({ nodes: [{ id: 'b', type: 'if', label: '' }] }).nodes.find((n) => n.type === 'if').label, '分岐');
  });
  withLanguage('fr', () => {
    const made = FlowModel.flowFromSteps([{ agent: 'claude', onFail: 'end' }]);
    assert.strictEqual(made.nodes.find((n) => n.type === 'if').question, '作業の結果を判定してください');
    assert.strictEqual(made.edges.find((e) => e.value === 'pass').when, '問題がない（合格）');
    assert.strictEqual(FlowModel.displayText('工程1の判定'), 'Jugement de Étape 1');
  });
  withLanguage('zh', () => {
    assert.strictEqual(FlowModel.displayText('工程4'), '步骤4');
    assert.notStrictEqual(FlowModel.displayText('工程4'), '工程4');
  });

  const editor = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'flow-editor.js'), 'utf8');
  const add = editor.match(/const type = b\.dataset\.type;[\s\S]*?select\(\{ kind: 'node', id: n\.id \}\);/);
  assert.ok(add, 'ノードを足す処理がある');
  assert.doesNotMatch(add[0], /tr\(/);
  assert.match(add[0], /label: '分岐'/);
  assert.match(add[0], /n\.label = '並列'/);
  assert.match(add[0], /n\.label = '合流'/);
  assert.match(editor, /FM\.isDefaultLabel\(n\) \? ''/);
  assert.match(editor, /value="\$\{esc\(labelValue\(n\)\)\}"/);
  assert.doesNotMatch(editor, /id="feLabel"[^>]*value="\$\{esc\(n\.label/);
  withLanguage('en', () => {
    assert.notStrictEqual(I18n.tr('分岐'), '分岐');
    assert.notStrictEqual(I18n.tr('並列'), '並列');
    assert.notStrictEqual(I18n.tr('合流'), '合流');
  });

  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  const tgt = renderer.match(/const tgt = \(e\) => \{([\s\S]*?)\n    \};/);
  assert.ok(tgt, '行き先の関数がある');
  assert.match(tgt[1], /tr\('終了'\)/);
  assert.match(tgt[1], /tr\('工程\{n\}へ'/);
  assert.match(tgt[1], /tr\('工程\{n\}に戻る'/);
  assert.match(tgt[1], /return flowGoto\(n\)/);
  assert.doesNotMatch(tgt[1], /`工程/);
  assert.doesNotMatch(tgt[1], /」へ`/);
  const dest = {
    en: ['End', 'to step 2', 'back to step 1', 'to Branch “Review”'],
    es: ['Fin', 'al paso 2', 'volver al paso 1', 'a Bifurcación «Review»'],
    fr: ['Fin', 'vers l’étape 2', 'retour à l’étape 1', 'vers Branchement « Review »'],
    zh: ['结束', '前往步骤2', '返回步骤1', '前往分支“Review”'],
    ja: ['終了', '工程2へ', '工程1に戻る', '分岐「Review」へ'],
  };
  for (const lang of ['ja', ...LANGS]) {
    withLanguage(lang, () => {
      assert.strictEqual(I18n.tr('終了'), dest[lang][0], lang);
      assert.strictEqual(I18n.tr('工程{n}へ', { n: 2 }), dest[lang][1], lang);
      assert.strictEqual(I18n.tr('工程{n}に戻る', { n: 1 }), dest[lang][2], lang);
      assert.strictEqual(I18n.tr('{type}「{label}」へ', { type: I18n.tr('分岐'), label: 'Review' }), dest[lang][3], lang);
      assert.strictEqual(I18n.tr('工程{n}へ', { n: 0 }), dest[lang][1].replace('2', '0').replace('2', '0'), lang);
      assert.strictEqual(I18n.tr('工程{n}へ', {}), dest[lang][1].includes('{n}') ? dest[lang][1] : dest[lang][1].replace('2', '{n}'), lang);
    });
  }
});

test('fmtTime と同じ日付表示は I18n.locale() を渡す', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  const m = src.match(/function fmtTime\(ms\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'fmtTime がある');
  assert.match(m[1], /I18n\.locale\(\)/);
  assert.match(m[1], /toLocaleTimeString\(loc,/);
  assert.match(m[1], /toLocaleDateString\(loc,/);
  const fmtTime = new Function('I18n', `return function fmtTime(ms) {${m[1]}\n}`)(I18n);
  const optsD = { month: 'numeric', day: 'numeric' };
  const optsT = { hour: '2-digit', minute: '2-digit' };
  const past = new Date(2020, 0, 2, 15, 4);
  const composed = (loc) => past.toLocaleDateString(loc, optsD) + ' ' + past.toLocaleTimeString(loc, optsT);
  withLanguage('en', () => {
    assert.strictEqual(I18n.locale(), 'en-US');
    assert.strictEqual(fmtTime(past.getTime()), composed(I18n.locale()));
    assert.strictEqual(fmtTime(past.getTime()), composed('en-US'));
  });
  withLanguage('ja', () => {
    assert.strictEqual(fmtTime(past.getTime()), composed('ja-JP'));
  });
  withLanguage('zh', () => {
    assert.strictEqual(fmtTime(past.getTime()), composed('zh-CN'));
  });
  const enText = composed('en-US');
  const jaText = composed('ja-JP');
  if (enText !== jaText) {
    withLanguage('en', () => assert.notStrictEqual(fmtTime(past.getTime()), jaText));
    withLanguage('ja', () => assert.notStrictEqual(fmtTime(past.getTime()), enText));
  } else {
    assert.fail('en-US と ja-JP の日付表示が同じなので、ロケールの違いを確かめられません');
  }
  const now = new Date();
  withLanguage('fr', () => {
    assert.strictEqual(fmtTime(now.getTime()), now.toLocaleTimeString('fr-FR', optsT));
  });
  withLanguage('es', () => {
    const bad = new Date(NaN);
    const expect = bad.toLocaleDateString('es-ES', optsD) + ' ' + bad.toLocaleTimeString('es-ES', optsT);
    assert.strictEqual(fmtTime(NaN), expect);
  });
  const bare = new Function('I18n', `return function fmtTime(ms) {${m[1]}\n}`)(undefined);
  assert.strictEqual(bare(past.getTime()), composed(undefined));
});

test('担当範囲の tr() は4言語すべてにあり、差し込み名が一致する', () => {
  const root = path.join(__dirname, '..', 'renderer');
  const files = [
    ['renderer.js', [2900, 3650], [4543, 4844], [4948, 5164]],
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
