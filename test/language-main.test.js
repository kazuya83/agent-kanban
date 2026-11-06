// アプリ本体の言語（初めては英語、既存の board.json は日本語のまま、遠隔には送らない）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('../renderer/i18n');
const { tr } = I18n;
const { Store, languageForBoardFile, assertLanguage, defaultRepoSettings } = require('../src/store');
const { isLocalChannel, isProxyChannel, stripLocalSettings, redactForRemote } = require('../src/remote');
const { parseMarkdownQuestions, isOtherOption, withReplyLanguage, isQuitInterrupt, buildBranchNamePrompt } = require('../src/agent');
const { describeOrder } = require('../src/subtasks');
const { explainSshError } = require('../src/ssh-tunnel');

const INTERRUPTED = 'アプリの終了で中断されました。「再開」で中断したところから続けられます（追加指示を送っても再開できます）。';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ak-lang-'));
}

test.after(() => {
  I18n.setLanguage('ja');
});

test('初めての board.json は英語。Store は表示言語を自分では変えない', () => {
  const dir = tmpDir();
  const missing = path.join(dir, 'missing.json');
  assert.strictEqual(languageForBoardFile(missing), 'en');
  assert.strictEqual(I18n.getLanguage(), 'ja');
  const store = new Store(missing);
  assert.strictEqual(store.settings.language, 'en');
  assert.strictEqual(store.settings.relaySteps[0].label, '実装', 'setLanguage する前は原文のまま');
  assert.strictEqual(I18n.getLanguage(), 'ja');
});

test('setLanguage したあとに作る新規ボードは、その言語の既定 Pipeline になる', () => {
  const dir = tmpDir();
  const prev = I18n.getLanguage();
  try {
    I18n.setLanguage('en');
    const store = new Store(path.join(dir, 'missing.json'));
    assert.strictEqual(store.settings.language, 'en');
    assert.strictEqual(store.settings.relaySteps[0].label, 'Implement');
    assert.strictEqual(store.settings.relaySteps[1].label, 'Review');
    assert.match(store.settings.relaySteps[0].instruction, /Follow the task instructions/);
    assert.strictEqual(store.settings.relayFlow.nodes.find((n) => n.type === 'step').label, 'Implement');
    assert.strictEqual(defaultRepoSettings().relayFlow.nodes.find((n) => n.type === 'step').label, 'Implement');
  } finally {
    I18n.setLanguage(prev);
  }
});

test('language のない既存ファイルは日本語のまま。保存済みの工程名は変えない', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'board.json');
  fs.writeFileSync(file, JSON.stringify({ settings: { maxParallel: 4, relaySteps: [{ agent: 'codex', label: '実装', instruction: 'そのまま' }] }, cards: [] }));
  assert.strictEqual(languageForBoardFile(file), 'ja');
  const store = new Store(file);
  assert.strictEqual(store.settings.language, 'ja');
  assert.strictEqual(store.settings.maxParallel, 4);
  assert.strictEqual(store.settings.relaySteps[0].instruction, 'そのまま');
});

test('壊れた board.json は日本語。保存された言語コードはそのまま残す', () => {
  const dir = tmpDir();
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{');
  assert.strictEqual(languageForBoardFile(broken), 'ja');
  const file = path.join(dir, 'board.json');
  for (const code of ['en', 'es', 'fr', 'zh']) {
    fs.writeFileSync(file, JSON.stringify({ settings: { language: code }, cards: [] }));
    assert.strictEqual(languageForBoardFile(file), code);
    assert.strictEqual(new Store(file).settings.language, code);
  }
  fs.writeFileSync(file, JSON.stringify({ settings: { language: 'jp' }, cards: [] }));
  assert.strictEqual(languageForBoardFile(file), 'ja');
  assert.strictEqual(new Store(file).settings.language, 'ja');
});

test('対応していない言語コードは受け付けない', () => {
  for (const code of ['en', 'ja', 'es', 'fr', 'zh']) assert.strictEqual(assertLanguage(code), code);
  for (const bad of ['', null, undefined, 'jp', 'EN', 'en-US', 'zh-CN', ' ja ', 1, 'zh-Hans']) {
    assert.throws(() => assertLanguage(bad), (err) => err.code === 'BAD_LANGUAGE' && /対応していない言語です/.test(err.message));
  }
  const prev = I18n.getLanguage();
  try {
    I18n.setLanguage('en');
    assert.throws(() => assertLanguage('nope'), (err) => err.code === 'BAD_LANGUAGE' && err.message === 'Unsupported language: nope');
  } finally {
    I18n.setLanguage(prev);
  }
});

test('言語の読み書きは遠隔中でもこのマシンで行い、ホストへは送らない', () => {
  assert.strictEqual(isLocalChannel('app:language'), true);
  assert.strictEqual(isLocalChannel('app:setLanguage'), true);
  assert.strictEqual(isProxyChannel('app:language'), false);
  assert.strictEqual(isProxyChannel('app:setLanguage'), false);
  const stripped = stripLocalSettings({ language: 'fr', model: 'sonnet', baseBranch: 'main' });
  assert.deepStrictEqual(stripped, { model: 'sonnet', baseBranch: 'main' });
  assert.strictEqual(stripLocalSettings({ model: 'sonnet' }).model, 'sonnet');
  assert.strictEqual(stripLocalSettings(null), null);
  assert.strictEqual(stripLocalSettings('en'), 'en');
  const redacted = redactForRemote({ settings: { language: 'es', remoteClientToken: 'secret', model: 'x' }, cards: [] });
  assert.strictEqual(redacted.settings.language, undefined);
  assert.strictEqual(redacted.settings.remoteClientToken, undefined);
  assert.strictEqual(redacted.settings.model, 'x');
  assert.strictEqual(redactForRemote(null), null);
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.match(main, /I18n\.setLanguage\(languageForBoardFile\(boardFile\)\)/);
  assert.match(main, /new Store\(boardFile\)/);
  assert.ok(main.indexOf('setLanguage(languageForBoardFile') < main.indexOf('new Store(boardFile)'));
  assert.match(main, /err\?\.code === 'ECONNRESET'/);
  assert.match(main, /err\?\.code === 'ECONNREFUSED'/);
  assert.doesNotMatch(main, /接続が切れました/);
  assert.match(main, /ipcMain\.on\('app:language'/);
  assert.match(main, /handle\('app:setLanguage'/);
});

test('返事の言語の指示は ja 以外だけ、空や二度目は足さない。ブランチ名の生成には入れない', () => {
  const prev = I18n.getLanguage();
  try {
    I18n.setLanguage('ja');
    assert.strictEqual(withReplyLanguage('本文'), '本文');
    assert.strictEqual(withReplyLanguage(''), '');
    assert.strictEqual(withReplyLanguage(null), '');
    I18n.setLanguage('en');
    const once = withReplyLanguage('本文');
    assert.match(once, /^【返事の言語】[\s\S]*English/);
    assert.ok(once.endsWith('本文'));
    assert.strictEqual(withReplyLanguage(once), once);
    I18n.setLanguage('es');
    assert.match(withReplyLanguage('x'), /español/);
    I18n.setLanguage('fr');
    assert.match(withReplyLanguage('x'), /français/);
    I18n.setLanguage('zh');
    assert.match(withReplyLanguage('x'), /简体中文/);
    const branch = buildBranchNamePrompt('feature/{slug}', { title: '直す', issue: null });
    assert.doesNotMatch(branch, /返事の言語/);
    assert.match(branch, /命名規則/);
  } finally {
    I18n.setLanguage(prev);
  }
});

test('質問の「おすすめ」と「その他」を各言語で読み分ける', () => {
  const prev = I18n.getLanguage();
  try {
    const form = (opt) => ['1. Which?', `   - A ${opt}: Add it`, '   - B: Skip', '   - C: Other (write your own)'].join('\n');
    I18n.setLanguage('ja');
    const ja = parseMarkdownQuestions(['1. どれ？', '   - A（おすすめ）: 足す', '   - B: やめる', '   - C: その他（具体的に）'].join('\n'));
    assert.deepStrictEqual(ja[0].options.map((o) => o.label), ['A: 足す（おすすめ）', 'B: やめる']);
    for (const word of ['(Recommended)', '(Recomendado)', '(Recommandé)', '（推荐）']) {
      const labels = parseMarkdownQuestions(form(word))[0].options.map((o) => o.label);
      assert.deepStrictEqual(labels, [`A: Add it（おすすめ）`, 'B: Skip'], word);
    }
    I18n.setLanguage('en');
    assert.deepStrictEqual(parseMarkdownQuestions(form('(Recommended)'))[0].options.map((o) => o.label), ['A: Add it (Recommended)', 'B: Skip']);
    I18n.setLanguage('zh');
    assert.deepStrictEqual(parseMarkdownQuestions(form('（推荐）'))[0].options.map((o) => o.label), ['A: Add it（推荐）', 'B: Skip']);
    assert.strictEqual(isOtherOption('C: その他（具体的に書いてください）'), true);
    assert.strictEqual(isOtherOption('Other'), true);
    assert.strictEqual(isOtherOption('otro'), true);
    assert.strictEqual(isOtherOption('Autre chose'), true);
    assert.strictEqual(isOtherOption('其他'), true);
    assert.strictEqual(isOtherOption('Otherwise keep it'), false);
    assert.strictEqual(isOtherOption('その他の案'), false);
    assert.strictEqual(isOtherOption(''), false);
    assert.strictEqual(isOtherOption(null), false);
  } finally {
    I18n.setLanguage(prev);
  }
});

test('終了で中断した文は、保存された言語が今と違っても中断として扱う', () => {
  const prev = I18n.getLanguage();
  try {
    I18n.setLanguage('fr');
    const fr = tr(INTERRUPTED);
    assert.notStrictEqual(fr, INTERRUPTED);
    I18n.setLanguage('ja');
    assert.strictEqual(isQuitInterrupt(INTERRUPTED), true);
    assert.strictEqual(isQuitInterrupt(fr), true);
    assert.strictEqual(isQuitInterrupt('ただのエラー'), false);
    assert.strictEqual(isQuitInterrupt(''), false);
    assert.strictEqual(I18n.getLanguage(), 'ja');
  } finally {
    I18n.setLanguage(prev);
  }
});

test('サブタスクの順番の説明と SSH の案内は、選んだ言語になる', () => {
  const prev = I18n.getLanguage();
  const items = [
    { key: 'a', title: '調査', after: [] },
    { key: 'b', title: '実装', after: [] },
    { key: 'c', title: '確認', after: ['a'] },
  ];
  try {
    I18n.setLanguage('ja');
    assert.strictEqual(describeOrder(items), '並列: 「調査」・「実装」 / 「確認」は 「調査」 のあと');
    assert.match(explainSshError('Connection refused', { host: 'h', user: 'u', sshPort: 22 }), /リモートログイン/);
    assert.match(explainSshError('', { spawnError: { code: 'ENOENT' } }), /OpenSSH クライアント/);
    I18n.setLanguage('en');
    assert.match(describeOrder(items), /^Parallel: /);
    assert.match(describeOrder([{ key: 'a', title: '調査', after: [] }]), /^First: /);
    assert.match(explainSshError('Connection refused', { host: 'h', user: 'u', sshPort: 22 }), /Remote Login/);
    assert.match(explainSshError('timed out', { host: 'h', sshPort: 22 }), /timed out/i);
    assert.match(explainSshError('something odd', { host: 'h' }), /Could not open the SSH tunnel/);
  } finally {
    I18n.setLanguage(prev);
  }
});
