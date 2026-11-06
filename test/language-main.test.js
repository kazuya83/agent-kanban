// アプリ本体の言語（初めては英語、既存の board.json は日本語のまま、遠隔には送らない）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const I18n = require('../renderer/i18n');
const { tr } = I18n;
const { Store, languageForBoardFile, assertLanguage, defaultRepoSettings } = require('../src/store');
const { isLocalChannel, isProxyChannel, stripLocalSettings, redactForRemote, restoreLocalLanguage, RemoteHost, RemoteClient } = require('../src/remote');
const { parseMarkdownQuestions, isOtherOption, withReplyLanguage, isQuitInterrupt, buildBranchNamePrompt, AgentManager } = require('../src/agent');
const providers = require('../src/providers');
const git = require('../src/git');
const { Updater, installCommand } = require('../src/updater');
const { fetchIssue } = require('../src/github');
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
  const before = new Store(missing);
  assert.strictEqual(before.settings.language, 'ja', '初期 language は、作った時点の表示言語');
  assert.strictEqual(before.settings.relaySteps[0].label, '実装', 'setLanguage する前は原文のまま');
  assert.strictEqual(I18n.getLanguage(), 'ja', 'Store は setLanguage しない');
  const prev = I18n.getLanguage();
  try {
    // main.js と同じ順。欠けたファイルは先に英語にしてからボードを作る
    I18n.setLanguage(languageForBoardFile(missing));
    const store = new Store(missing);
    assert.strictEqual(store.settings.language, 'en');
    assert.strictEqual(store.settings.relaySteps[0].label, 'Implement');
    assert.strictEqual(I18n.getLanguage(), 'en');
  } finally {
    I18n.setLanguage(prev);
  }
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
  const prev = I18n.getLanguage();
  try {
    // ファイルは壊れていても、Store の初期値はその時点の表示言語。main.js が先に ja にする
    I18n.setLanguage('en');
    assert.strictEqual(new Store(broken).settings.language, 'en');
    I18n.setLanguage(languageForBoardFile(broken));
    assert.strictEqual(new Store(broken).settings.language, 'ja');
    assert.strictEqual(I18n.getLanguage(), 'ja');
    for (const text of ['', '   ', '{]', 'null,']) {
      fs.writeFileSync(broken, text);
      assert.strictEqual(languageForBoardFile(broken), 'ja', JSON.stringify(text));
      assert.strictEqual(new Store(broken).settings.language, 'ja', JSON.stringify(text));
    }
  } finally {
    I18n.setLanguage(prev);
  }
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
  assert.match(main, /return restoreLocalLanguage\(data, store\.settings\)/);
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

test('遠隔の設定保存は、ホストの言語を手元の言語に戻す', async () => {
  const hostSettings = { language: 'ja', model: 'sonnet', maxParallel: 2, remoteClientToken: 'host-secret', remotePairTokens: ['a'] };
  const wire = redactForRemote(hostSettings);
  assert.strictEqual(wire.language, undefined);
  assert.strictEqual(wire.remoteClientToken, undefined);
  assert.strictEqual(wire.remotePairTokens, undefined);
  assert.strictEqual(wire.model, 'sonnet');
  assert.strictEqual(hostSettings.language, 'ja', 'ホスト側の保存データは変えない');
  const seen = restoreLocalLanguage(wire, { language: 'en', model: 'local-model' });
  assert.strictEqual(seen.language, 'en');
  assert.strictEqual(seen.model, 'sonnet', 'ホストが保存したほかの設定は残す');
  assert.strictEqual(restoreLocalLanguage({ language: 'ja', model: 'sonnet' }, { language: 'en' }).language, 'en', 'ホストが language を残しても手元で上書きする');
  assert.strictEqual(restoreLocalLanguage(null, { language: 'en' }), null);
  assert.strictEqual(restoreLocalLanguage(undefined, { language: 'en' }), undefined);
  assert.strictEqual(restoreLocalLanguage('en', { language: 'ja' }), 'en');
  assert.deepStrictEqual(restoreLocalLanguage([], { language: 'en' }), []);
  assert.strictEqual(restoreLocalLanguage({ language: 'ja', model: 'm' }, null).language, 'ja');
  assert.strictEqual(restoreLocalLanguage({ language: 'ja' }, { language: 'jp' }).language, 'ja');
  assert.strictEqual(restoreLocalLanguage({ language: 'ja' }, {}).language, 'ja');
  assert.strictEqual(restoreLocalLanguage({ model: 'm' }, { language: 'fr' }).language, 'fr');
  assert.strictEqual(redactForRemote(null), null);
  assert.strictEqual(redactForRemote(3), 3);
  const plain = { model: 'x' };
  assert.strictEqual(redactForRemote(plain), plain);

  const host = new RemoteHost({
    port: 0,
    tokens: [],
    invoke: async (channel) => {
      if (channel === 'settings:update') return { language: 'ja', model: 'sonnet', remoteClientToken: 'host-secret' };
      throw new Error(`unknown ${channel}`);
    },
  });
  await host.start(0);
  const prev = I18n.getLanguage();
  try {
    I18n.setLanguage('en');
    const client = new RemoteClient();
    await client.connect({ host: '127.0.0.1', port: host.port, code: host.status().pairCode });
    const data = await client.invoke('settings:update', { model: 'sonnet' });
    assert.strictEqual(data.language, undefined, '回線の上にはホストの言語を載せない');
    assert.strictEqual(data.remoteClientToken, undefined);
    assert.strictEqual(data.model, 'sonnet');
    assert.strictEqual(restoreLocalLanguage(data, { language: 'en' }).language, 'en');
    await assert.rejects(() => client.invoke('nope:nope'), (err) => {
      assert.doesNotMatch(err.message, /この操作は遠隔では使えません/);
      assert.match(err.message, /nope:nope/);
      return true;
    });
    client.disconnect();
    await assert.rejects(() => new RemoteClient().connect({ host: '127.0.0.1', port: host.port, code: '000000' }), (err) => {
      assert.doesNotMatch(err.message, /ペアリングコードが違うか/);
      assert.match(err.message, /pairing code/i);
      return true;
    });
    await assert.rejects(() => new RemoteClient().connect({ host: '127.0.0.1', port: host.port, token: 'nope' }), (err) => {
      assert.strictEqual(err.code, 'BAD_TOKEN');
      assert.doesNotMatch(err.message, /トークンが無効です/);
      assert.match(err.message, /token/i);
      return true;
    });
    await new Promise((resolve, reject) => {
      const net = require('net');
      let done = false;
      const sock = net.connect({ host: '127.0.0.1', port: host.port }, () => {
        sock.write(`${JSON.stringify({ id: 1, type: 'invoke', channel: 'board:get' })}\n`);
      });
      let buf = '';
      sock.on('data', (d) => {
        buf += d;
        const i = buf.indexOf('\n');
        if (i < 0) return;
        done = true;
        sock.destroy();
        try {
          const msg = JSON.parse(buf.slice(0, i));
          assert.strictEqual(msg.ok, false);
          assert.doesNotMatch(msg.error, /先にペアリング/);
          assert.match(msg.error, /Pair or authenticate first/);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      sock.on('error', (err) => {
        if (!done) reject(err);
      });
    });
    I18n.setLanguage('ja');
    await assert.rejects(() => new RemoteClient().connect({ host: '127.0.0.1', port: host.port, code: '000000' }), /ペアリングコード/);
  } finally {
    I18n.setLanguage(prev);
    await host.stop();
  }
});

test('英語にすると、残っていたエラーと通知が日本語のままにならない', async () => {
  const prev = I18n.getLanguage();
  const dir = tmpDir();
  const store = new Store(path.join(dir, 'board.json'));
  store.settings.repoPath = '/repo';
  store.settings.orchestration = 'relay';
  const agents = new AgentManager(store, { mcpScript: '', mcpDir: path.join(dir, 'mcp'), nodeBin: process.execPath });
  store.cards.push(
    { id: 'a', title: '競争タスク', status: 'review', agent: 'claude', repoPath: '/repo', compete: { group: 'g', index: 0, title: '競争タスク', notified: false } },
    { id: 'b', title: '競争タスク', status: 'running', agent: 'codex', repoPath: '/repo', compete: { group: 'g', index: 1, title: '競争タスク', notified: false } },
    { id: 'old', title: '既存', status: 'review', repoPath: '/repo', issue: { number: 12 } },
    { id: 'done', title: '完了分', status: 'done', repoPath: '/repo', issue: { number: 8 } },
  );
  const keys = [
    ['クローンしましたが、このリポジトリにはコミットがまだありません。タスクを動かすには、最初のコミットを入れて push してください', null],
    ['公開鍵', null],
    ['すべてのファイル', null],
    ['Pipeline（JSON）', null],
    ['Pipeline（.json / .zip）', null],
    ['競争', null],
    ['オーケストレーションを使わない設定', null],
    ['Pipelineと競争はどちらか1つだけ使えます', null],
    ['エラー', null],
    ['できた', null],
    ['#{n}: もうタスクがあります（「{title}」）', { n: 12, title: '既存' }],
    ['#{n} はクローズ済みですが、タスクを作りました', { n: 4 }],
    ['サブタスクに分けて進めることを提案しています', null],
    ['{who} が質問しています', { who: 'Claude' }],
    ['{cmd} が終了コード {code} で終わりました', { cmd: 'claude', code: 1 }],
    ['コンフリクトなしで取り込めました', null],
    ['コンフリクトを解消しました', null],
    ['コンフリクトを解消して、取り込みを完了しました', null],
    ['{who} がコンフリクトを解消しました', { who: 'Claude' }],
    ['「{field}」の項目（単一選択）がありません', { field: 'Status' }],
    ['「{field}」に設定した選択肢「{mapping}」がありません（{label} 用）', { field: 'Status', mapping: 'Released', label: 'Done' }],
    ['「{field}」に「{label}」に当たる選択肢がありません', { field: 'Status', label: 'In progress' }],
    ['手元のリポジトリは作りましたが、{message}', { message: 'gh' }],
    ['新しい版を確かめられませんでした: {message}', { message: 'offline' }],
    ['マージ', null],
    ['ペアリングコードが違うか、期限切れです。ホスト側で新しいコードを出してください', null],
    ['トークンが無効です。もう一度ペアリングしてください', null],
    ['先にペアリングまたは認証してください', null],
    ['Codex がエラーで止まりました', null],
    ['GitHub Projects のステータスを変えるには、gh に project の権限が必要です。設定の「Projects の権限を追加」を押すか、ターミナルで gh auth refresh -h github.com -s project を実行してください', null],
    ['（終了コード {code}）', { code: 0 }],
    ['拒否されました: {msg}', { msg: 'no' }],
    ['（gh のエラー: {message}）', { message: 'auth failed' }],
    ['マージ先', null],
    ['工程{n}', { n: 1 }],
    ['v{v} に更新します', { v: '1.2.3' }],
    ['更新しました', null],
    ['エラー: 更新できませんでした', null],
    ['ユーザーが拒否しました', null],
    ['Agent Kanban に接続できなかったため拒否しました: {message}', { message: 'ECONNREFUSED' }],
  ];
  try {
    for (const code of ['en', 'es', 'fr', 'zh']) {
      for (const [key, vars] of keys) {
        assert.strictEqual(I18n.has(key, code), true, `${code} ${key}`);
        I18n.setLanguage(code);
        const s = tr(key, vars || undefined);
        for (const name of key.match(/\{(\w+)\}/g) || []) {
          assert.ok(!s.includes(name), `${code} ${key} ${name}`);
          const k = name.slice(1, -1);
          if (vars && vars[k] != null) assert.ok(s.includes(String(vars[k])), `${code} ${key} ${k}`);
        }
      }
    }
    I18n.setLanguage('en');
    agents.checkCompetitionDone(store.card('a'));
    assert.strictEqual(store.notifications.length, 0, '動いている候補がいるあいだは知らせない');
    store.card('b').status = 'failed';
    agents.checkCompetitionDone(store.card('a'));
    assert.strictEqual(store.notifications.length, 1);
    assert.doesNotMatch(store.notifications[0].title, /競争の結果がそろいました/);
    assert.doesNotMatch(store.notifications[0].body, /エラー|できた/);
    assert.match(store.notifications[0].body, /Claude: Done/);
    assert.match(store.notifications[0].body, /Codex: Error/);
    agents.checkCompetitionDone(store.card('a'));
    assert.strictEqual(store.notifications.length, 1, 'そろった通知は一度だけ');
    await assert.rejects(() => agents.createFromIssues({ numbers: '12' }), (err) => {
      assert.doesNotMatch(err.message, /もうタスクがあります/);
      assert.match(err.message, /#12/);
      assert.match(err.message, /既存/);
      assert.match(err.message, /already exists/);
      return true;
    });
    agents.fetchIssue = async () => {
      throw new Error('should-fetch');
    };
    await assert.rejects(() => agents.createFromIssues({ numbers: '8' }), /should-fetch/);
    assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete' }), (err) => {
      assert.doesNotMatch(err.message, /競争|どちらか1つだけ/);
      assert.match(err.message, /Competition/);
      return true;
    });
    store.settings.orchestration = 'none';
    assert.throws(() => agents.createTask({ prompt: 'x', agent: 'compete' }), (err) => {
      assert.doesNotMatch(err.message, /オーケストレーションを使わない設定/);
      assert.match(err.message, /orchestration is turned off/);
      return true;
    });
    store.settings.orchestration = 'relay';
    agents.fetchIssue = async (_repo, n) => ({ number: n, title: '閉じた', state: 'closed', body: '' });
    agents.createTask = () => [{ id: 'made', title: '#4 閉じた', compete: { group: 'x' } }];
    const made = await agents.createFromIssues({ numbers: '4' });
    assert.strictEqual(made.cards.length, 1);
    assert.doesNotMatch(made.errors.join('\n'), /クローズ済みですが/);
    assert.match(made.errors[0], /#4/);
    assert.match(made.errors[0], /closed/);
    I18n.setLanguage('es');
    await assert.rejects(() => agents.createFromIssues({ numbers: '12' }), (err) => {
      assert.match(err.message, /ya hay una tarea/);
      assert.doesNotMatch(err.message, /もうタスクがあります/);
      return true;
    });
    I18n.setLanguage('en');
    assert.strictEqual(providers.createParser('codex').onEvent({ type: 'turn.failed' })[0].error, 'Codex stopped because of an error');
    assert.strictEqual(providers.createParser('codex').onEvent({ type: 'turn.failed', error: { message: 'bad' } })[0].error, 'bad');
    const gemini = providers.createParser('gemini');
    assert.ok(gemini.onEvent({ type: 'error' }).some((x) => x.type === 'log_error' && x.text === 'Error'));
    assert.ok(gemini.onEvent({ type: 'tool_result', status: 'error' }).some((x) => x.type === 'tool_result' && x.text === 'Error'));
    assert.ok(gemini.onEvent({ type: 'result', status: 'failed' }).some((x) => x.error === 'Error (failed)'));
    const cursor = providers.createParser('cursor');
    assert.ok(cursor.onEvent({ type: 'error' }).some((x) => x.type === 'log_error' && x.text === 'Error'));
    assert.ok(cursor.onEvent({ type: 'result', is_error: true }).some((x) => x.error === 'Error (error)'));
    const updater = new Updater({
      currentVersion: '0.0.1',
      packaged: true,
      platform: 'darwin',
      arch: 'arm64',
      fetch: async () => {
        throw new Error('offline');
      },
    });
    const st = await updater.check();
    assert.strictEqual(st.state, 'error');
    assert.strictEqual(st.error, 'Could not check for a new version: offline');
    const bare = new Updater({
      currentVersion: '0.0.1',
      packaged: true,
      platform: 'darwin',
      arch: 'arm64',
      fetch: async () => {
        throw 'nope';
      },
    });
    assert.strictEqual((await bare.check()).error, 'Could not check for a new version: nope');
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repo, encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(repo, gitDir, 'MERGE_HEAD'), 'abc\n');
    assert.strictEqual(await git.operationInProgress(repo), 'merge');
    I18n.setLanguage('ja');
    assert.strictEqual(await git.operationInProgress(repo), 'マージ');
    I18n.setLanguage('zh');
    assert.strictEqual(await git.operationInProgress(repo), '合并');
    fs.mkdirSync(path.join(repo, gitDir, 'rebase-merge'));
    assert.strictEqual(await git.operationInProgress(repo), 'rebase');
  } finally {
    I18n.setLanguage(prev);
  }
});

function toolResultText(events) {
  const hit = events.find((x) => x.type === 'tool_result');
  assert.ok(hit, 'tool_result がない');
  return hit;
}

test('英語にすると、ログ・Issue のエラー・工程名と更新ログが日本語のままにならない', async () => {
  const prev = I18n.getLanguage();
  const dir = tmpDir();
  const oldPath = process.env.PATH;
  const oldFetch = global.fetch;
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, 'gh.cmd'), '@echo auth failed>&2\r\n@echo more detail>&2\r\n@exit /b 1\r\n');
  } else {
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho auth failed >&2\necho more detail >&2\nexit 1\n', { mode: 0o755 });
  }
  const ghRepo = path.join(dir, 'gh-repo');
  fs.mkdirSync(ghRepo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: ghRepo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/o/r.git'], { cwd: ghRepo });
  const mergeRepo = path.join(dir, 'merge-repo');
  fs.mkdirSync(mergeRepo);
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: mergeRepo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(mergeRepo, 'f.txt'), 'base\n');
  g('add', 'f.txt');
  g('commit', '-qm', 'init');
  g('checkout', '-q', '-b', 'other');
  fs.writeFileSync(path.join(mergeRepo, 'f.txt'), 'other\n');
  g('commit', '-qam', 'other');
  g('checkout', '-q', 'main');
  fs.writeFileSync(path.join(mergeRepo, 'f.txt'), 'main\n');
  g('commit', '-qam', 'main');
  const store = new Store(path.join(dir, 'board.json'));
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(dir, 'mcp'), nodeBin: process.execPath });
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  try {
    I18n.setLanguage('en');
    const codex = providers.createParser('codex');
    const empty = toolResultText(codex.onEvent({ type: 'item.completed', item: { id: '1', type: 'command_execution', command: 'true', aggregated_output: '', exit_code: 0, status: 'completed' } }));
    assert.strictEqual(empty.text, '(exit code 0)');
    assert.strictEqual(empty.error, false, '終了コード 0 は失敗にしない');
    const unknown = toolResultText(codex.onEvent({ type: 'item.completed', item: { id: '2', type: 'command_execution', command: 'true', aggregated_output: '', status: 'failed' } }));
    assert.strictEqual(unknown.text, '(exit code ?)');
    assert.doesNotMatch(unknown.text, /終了コード/);
    const kept = toolResultText(codex.onEvent({ type: 'item.completed', item: { id: '3', type: 'command_execution', command: 'echo', aggregated_output: 'hello', exit_code: 1, status: 'completed' } }));
    assert.strictEqual(kept.text, 'hello', '出力があるときは終了コードの文に置き換えない');
    const cursor = providers.createParser('cursor');
    const shell = toolResultText(cursor.onEvent({ type: 'tool_call', subtype: 'completed', call_id: 'e', tool_call: { shellToolCall: { args: { command: 'true' }, result: { success: { stdout: '', stderr: '  ', exitCode: 0 } } } } }));
    assert.strictEqual(shell.text, '(exit code 0)');
    assert.doesNotMatch(shell.text, /終了コード/);
    const rejected = toolResultText(cursor.onEvent({ type: 'tool_call', subtype: 'completed', call_id: 'r', tool_call: { shellToolCall: { args: { command: 'rm' }, result: { rejected: { message: 'not allowed' } } } } }));
    assert.strictEqual(rejected.text, 'Rejected: not allowed');
    assert.strictEqual(rejected.error, true);
    assert.doesNotMatch(rejected.text, /拒否されました/);
    const plain = toolResultText(cursor.onEvent({ type: 'tool_call', subtype: 'completed', call_id: 'f', tool_call: { shellToolCall: { result: { error: { message: 'boom' } } } } }));
    assert.strictEqual(plain.text, 'boom', '拒否以外の失敗には拒否の接頭辞を付けない');

    global.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(() => fetchIssue(ghRepo, 7), (err) => {
      assert.doesNotMatch(err.message, /（gh のエラー:/);
      assert.doesNotMatch(err.message, /more detail/, 'gh の標準エラーは先頭の1行だけ足す');
      assert.match(err.message, /gh error: auth failed/);
      assert.match(err.message, /503/);
      return true;
    });
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ number: 7, title: 'T', body: '', html_url: 'https://github.com/o/r/issues/7', state: 'open', labels: [], comments: 0 }) });
    const issue = await fetchIssue(ghRepo, 7);
    assert.strictEqual(issue.title, 'T', 'API が成功したときは gh のエラーを足さない');
    assert.strictEqual(issue.slug.owner, 'o');

    await assert.rejects(() => git.merge(mergeRepo, 'other', 'm', ''), (err) => {
      assert.doesNotMatch(err.message, /マージ先/);
      assert.match(err.message, /merge target/);
      assert.match(err.message, /f\.txt/);
      return true;
    });
    await assert.rejects(() => git.merge(mergeRepo, 'other', 'm'), (err) => {
      assert.match(err.message, /merge target/, '名前を省いたときも同じフォールバック');
      return true;
    });
    const bare = { id: 'pr', title: 'PR', status: 'review', prUrl: 'https://github.com/o/r/pull/1', logs: [], repoPath: mergeRepo };
    agents.updatePrConflict(bare, { state: 'OPEN', mergeable: 'CONFLICTING', baseRefName: '' });
    assert.doesNotMatch(bare.logs.at(-1).text, /マージ先/);
    assert.match(bare.logs.at(-1).text, /merge target/);
    const named = { id: 'pr2', title: 'PR', status: 'review', prUrl: 'https://github.com/o/r/pull/2', logs: [], repoPath: mergeRepo };
    agents.updatePrConflict(named, { state: 'OPEN', mergeable: 'CONFLICTING', baseRefName: 'develop' });
    assert.match(named.logs.at(-1).text, /develop/);
    assert.doesNotMatch(named.logs.at(-1).text, /merge target|マージ先/);

    assert.deepStrictEqual(
      providers.cleanRelaySteps([
        { agent: 'claude', label: '', instruction: 'do' },
        { agent: 'codex', label: '   ', instruction: 'next' },
        { agent: 'gemini', label: '', instruction: '' },
      ]).map((s) => s.label),
      ['Step 1', 'Step 2'],
    );
    assert.strictEqual(providers.cleanRelaySteps([{ agent: 'claude', label: '実装', instruction: 'do' }])[0].label, '実装', '書いてある名前はそのまま残す');
    I18n.setLanguage('fr');
    assert.strictEqual(providers.cleanRelaySteps([{ agent: 'claude', instruction: 'do' }])[0].label, 'Étape 1');
    I18n.setLanguage('es');
    assert.match(installCommand({ platform: 'darwin', pid: 1, version: '1.0.0', execPath: '/x' }).args[1], /Actualizando a v1\.0\.0/);
    I18n.setLanguage('en');
    const mac = installCommand({ platform: 'darwin', pid: 4, version: '1.2.3', execPath: '/x/Agent Kanban.app/Contents/MacOS/Agent Kanban' });
    assert.doesNotMatch(mac.args[1], /に更新します|更新しました|更新できませんでした/);
    assert.match(mac.args[1], /Updating to v1\.2\.3/);
    assert.match(mac.args[1], /==> Updated/);
    assert.match(mac.args[1], /Error: update failed/);
    if (process.platform !== 'win32') {
      const syntax = spawnSync('/bin/bash', ['-n', '-c', mac.args[1]]);
      assert.strictEqual(syntax.status, 0, String(syntax.stderr));
    }
    const ps = installCommand({ platform: 'win32', pid: 4, version: 'v1.2.3', execPath: "C:\\a'b.exe" }).args.at(-1);
    assert.doesNotMatch(ps, /に更新します|更新しました|更新できませんでした/);
    assert.match(ps, /Updating to v1\.2\.3/);
    assert.match(ps, /Error: update failed/);
    assert.match(ps, /a''b/);

    agents.setPermissionEndpoint(9, 'tok');
    const conf = JSON.parse(fs.readFileSync(agents.writeMcpConfig({ id: 'lang' }), 'utf8')).mcpServers.agent_kanban;
    assert.strictEqual(conf.env.KANBAN_LANGUAGE, 'en');
    const wslConf = JSON.parse(fs.readFileSync(agents.writeMcpConfig({ id: 'lang-wsl' }, 'Ubuntu'), 'utf8')).mcpServers.agent_kanban;
    assert.strictEqual(wslConf.env.KANBAN_LANGUAGE, 'en');
    assert.match(wslConf.env.WSLENV, /KANBAN_LANGUAGE\/u/);
    const card = { id: 'perm', title: 'perm', status: 'running', repoPath: mergeRepo, logs: [] };
    store.cards.push(card);
    const denied = agents.requestPermission({ cardId: 'perm', toolName: 'Bash', input: { command: 'ls' } });
    agents.answerPermission('perm', card.permissions[0].id, 'deny', '   ');
    assert.strictEqual((await denied).message, 'The user denied it');
    const custom = agents.requestPermission({ cardId: 'perm', toolName: 'Bash', input: { command: 'pwd' } });
    agents.answerPermission('perm', card.permissions[0].id, 'deny', ' 自分の理由 ');
    assert.strictEqual((await custom).message, '自分の理由', 'ユーザーが書いた理由はそのまま渡す');

    I18n.setLanguage('zh');
    const refused = explainSshError('Connection refused', { host: '100.1.2.3', user: 'me', sshPort: 22 });
    assert.doesNotMatch(refused, /请如果/);
    assert.match(refused, /如果主机是 Mac，请打开/);
    assert.match(refused, /me@100\.1\.2\.3:22/);

    I18n.setLanguage('ja');
    assert.strictEqual(providers.cleanRelaySteps([{ agent: 'claude', instruction: 'do' }])[0].label, '工程1');
    const jaLog = installCommand({ platform: 'darwin', pid: 4, version: '1.2.3', execPath: '/x' }).args[1];
    assert.match(jaLog, /v1\.2\.3 に更新します/);
    assert.match(jaLog, /更新しました/);
    assert.match(jaLog, /エラー: 更新できませんでした/);
    await assert.rejects(() => git.merge(mergeRepo, 'other', 'm', ''), /マージ先/);
    global.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(() => fetchIssue(ghRepo, 7), (err) => {
      assert.match(err.message, /（gh のエラー: auth failed）/);
      assert.doesNotMatch(err.message, /more detail/);
      return true;
    });
    const jaEmpty = providers.createParser('codex').onEvent({ type: 'item.completed', item: { id: 'j', type: 'command_execution', command: 'true', aggregated_output: '', exit_code: 0, status: 'completed' } });
    assert.strictEqual(toolResultText(jaEmpty).text, '（終了コード 0）');
  } finally {
    process.env.PATH = oldPath;
    global.fetch = oldFetch;
    I18n.setLanguage(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
