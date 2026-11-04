// 指示に添付したファイル: 保存・指示へのパスの書き足し・Claude Code への画像の受け渡し
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store } = require('../src/store');
const { AgentManager } = require('../src/agent');
const att = require('../src/attachments');
const providers = require('../src/providers');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TXT = Buffer.from('hello attachment\n').toString('base64');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kanban-att-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  // 受け取った引数と stdin の最初の1行を書き出して、すぐに終わる偽の claude
  const dump = path.join(tmp, 'dump.json');
  const script = path.join(tmp, 'fake.js');
  fs.writeFileSync(
    script,
    `const fs = require('fs');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  const i = buf.indexOf('\\n');
  if (i < 0) return;
  fs.writeFileSync(${JSON.stringify(dump)}, JSON.stringify({ args: process.argv.slice(2), msg: JSON.parse(buf.slice(0, i)) }));
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-att-1' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0 }) + '\\n');
  process.exit(0);
});
`,
  );
  const bin = path.join(tmp, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  const store = new Store(path.join(tmp, 'data', 'board.json'));
  Object.assign(store.settings, { repoPath: repo, claudePath: bin, maxParallel: 1, specCheck: false });
  const attachDir = path.join(tmp, 'data', 'attachments');
  const agents = new AgentManager(store, { mcpScript: path.join(__dirname, '..', 'src', 'permission-mcp.js'), mcpDir: path.join(tmp, 'data', 'mcp'), nodeBin: process.execPath, attachDir });
  return { tmp, repo, store, agents, dump, attachDir };
}

function waitFor(pred, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = pred();
      if (v) {
        clearInterval(iv);
        resolve(v);
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error('timeout'));
      }
    }, 20);
  });
}

test('添付の名前はフォルダの外に出ない形にし、同じ名前には番号を付ける', () => {
  const list = att.parseAttachments([
    { name: '../../etc/passwd', data: TXT },
    { name: 'a.png', mediaType: 'image/png', data: PNG },
    { name: 'a.png', data: PNG },
    { name: '', data: TXT },
  ]);
  assert.deepStrictEqual(
    list.map((a) => a.name),
    ['passwd', 'a.png', 'a (2).png', 'attachment-4'],
  );
  assert.strictEqual(list[2].mediaType, 'image/png', '種類がなければ拡張子から決める');
  assert.strictEqual(list[0].mediaType, 'application/octet-stream');
  assert.deepStrictEqual(att.parseAttachments(undefined), []);
});

test('読めない・多すぎる・大きすぎる添付はエラーにする', () => {
  assert.throws(() => att.parseAttachments([{ name: 'x', data: '"><script>' }]), /読み取れません/);
  assert.throws(() => att.parseAttachments('x'), /形が正しくありません/);
  assert.throws(() => att.parseAttachments(Array.from({ length: att.MAX_FILES + 1 }, () => ({ name: 'a.txt', data: TXT }))), /個まで/);
  const big = Buffer.alloc(att.MAX_TOTAL_BYTES / 2 + 1).toString('base64');
  assert.throws(() => att.parseAttachments([{ name: 'a.bin', data: big }, { name: 'b.bin', data: big }]), /合わせて/);
});

test('指示に書き足すパスは、WSL ならエージェントから見えるパスにする', () => {
  const note = att.attachmentNote([{ name: 'a.png', mediaType: 'image/png', size: 10, path: 'C:\\Users\\me\\a.png' }], { toAgentPath: require('../src/wsl').toLinux, inlineImages: true });
  assert.match(note, /\/mnt\/c\/Users\/me\/a\.png/);
  assert.match(note, /画像として添付/);
  assert.strictEqual(att.attachmentNote([]), '');
});

test('Gemini には添付の置き場所を読めるフォルダとして渡す', () => {
  const args = providers.buildArgs('gemini', { mode: 'acceptEdits', includeDirs: ['/tmp/att/c1'] });
  assert.deepStrictEqual(args.slice(-2), ['--include-directories', '/tmp/att/c1']);
  assert.ok(!providers.buildArgs('gemini', { mode: 'acceptEdits' }).includes('--include-directories'));
});

test('会話に添付すると、作業フォルダの外に保存し、Claude には画像をそのまま・ファイルはパスで渡す', async () => {
  const { repo, agents, dump, attachDir, store } = setup();
  const chat = agents.createChat({
    message: 'この画面を見て',
    attachments: [
      { name: 'shot.png', mediaType: 'image/png', data: PNG },
      { name: 'memo.txt', mediaType: 'text/plain', data: TXT },
    ],
  });
  await waitFor(() => chat.status === 'review' && fs.existsSync(dump));
  // 保存先は作業フォルダ（リポジトリ）の外
  assert.strictEqual(chat.attachments.length, 2);
  for (const a of chat.attachments) {
    assert.ok(a.path.startsWith(path.join(attachDir, chat.id)), a.path);
    assert.ok(!a.path.startsWith(repo));
    assert.ok(fs.existsSync(a.path));
  }
  assert.strictEqual(fs.readFileSync(chat.attachments[1].path, 'utf8'), 'hello attachment\n');

  const { args, msg } = JSON.parse(fs.readFileSync(dump, 'utf8'));
  const content = msg.message.content;
  assert.ok(Array.isArray(content));
  assert.deepStrictEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } });
  assert.strictEqual(content.length, 2, 'テキストのファイルは画像として渡さない');
  assert.match(content[1].text, /この画面を見て/);
  assert.ok(content[1].text.includes(chat.attachments[1].path), 'ファイルのパスを指示に書き足す');
  // 添付の置き場所を読めるようにする
  assert.strictEqual(args[args.indexOf('--add-dir') + 1], path.join(attachDir, chat.id));

  // ログ（あなたの指示）には、画像とファイルの一覧を残す
  const u = chat.logs.find((l) => l.kind === 'user');
  assert.strictEqual(u.text, 'この画面を見て', 'ログにはパスを書き足す前の文を残す');
  assert.deepStrictEqual(u.attachments.map((a) => a.name), ['shot.png', 'memo.txt']);
  assert.strictEqual(u.images[0].data, PNG);
  // board.json に、保存前の中身は入れない
  store.flush?.();
  assert.ok(!JSON.stringify(store.cards).includes('attachmentsParsed'));

  // 続きのメッセージにも添付できる
  fs.rmSync(dump);
  agents.send(chat.id, 'こっちも', null, [{ name: 'two.png', mediaType: 'image/png', data: PNG }]);
  await waitFor(() => chat.status === 'review' && fs.existsSync(dump));
  const second = JSON.parse(fs.readFileSync(dump, 'utf8')).msg.message.content;
  assert.strictEqual(second[0].type, 'image');
  assert.match(second[1].text, /two\.png/);
  assert.doesNotMatch(second[1].text, /memo\.txt/, '前の添付は書き足さない');

  // 添付なしなら、これまでどおり文字だけで送る
  fs.rmSync(dump);
  agents.send(chat.id, '文字だけ', null);
  await waitFor(() => chat.status === 'review' && fs.existsSync(dump));
  assert.strictEqual(JSON.parse(fs.readFileSync(dump, 'utf8')).msg.message.content, '文字だけ');
});

test('タスクの最初の指示にも添付でき、破棄すると添付も消す', async () => {
  const { agents, dump, attachDir } = setup();
  const [c] = agents.createTask({ title: 't', prompt: 'ロゴを差し替えて', agent: 'claude', attachments: [{ name: 'logo.png', mediaType: 'image/png', data: PNG }] });
  assert.ok(fs.existsSync(c.attachments[0].path));
  agents.start(c.id);
  await waitFor(() => c.status === 'review' && fs.existsSync(dump));
  const content = JSON.parse(fs.readFileSync(dump, 'utf8')).msg.message.content;
  assert.strictEqual(content[0].type, 'image');
  assert.match(content[1].text, /ロゴを差し替えて[\s\S]*## 添付ファイル[\s\S]*logo\.png/);
  await agents.discard(c.id);
  assert.ok(!fs.existsSync(path.join(attachDir, c.id)));
});

test('アプリの終了で中断しても、再開するときに添付を渡し直す', () => {
  const { store, agents, attachDir } = setup();
  const [c] = agents.createTask({ title: 't', prompt: 'x', agent: 'claude', attachments: [{ name: 'a.png', mediaType: 'image/png', data: PNG }] });
  // 待機中のまま終了した
  c.status = 'queued';
  c.pendingPrompt = 'x と添付';
  c.pendingAttachments = c.attachments;
  store.save();
  const agents2 = new AgentManager(store, { ...agents.opts, attachDir });
  assert.strictEqual(c.interrupted.kind, 'queued');
  assert.deepStrictEqual(c.interrupted.attachments, c.attachments);
  agents2.launch = async () => {};
  agents2.resume(c.id);
  assert.deepStrictEqual(c.pendingAttachments, c.attachments);
});
