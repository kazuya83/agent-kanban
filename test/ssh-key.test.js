// 遠隔操作の SSH の鍵をアプリで作る（ホストへの登録はユーザーがやる）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { defaultKeyPath, expandHome, keyStatus, keygenCommandFor, generateKey, registerCommands, psQuote, shQuote } = require('../src/ssh-key');

const hasKeygen = (() => {
  try {
    execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' });
    return true;
  } catch (err) {
    return err.code !== 'ENOENT';
  }
})();

function tmpHome() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-key-')));
}

test('鍵の場所: 空ならアプリの専用の鍵、~ はホームに直す', () => {
  const home = path.join(path.sep, 'home', 'me');
  assert.strictEqual(defaultKeyPath(home), path.join(home, '.ssh', 'agent-kanban_ed25519'));
  assert.strictEqual(expandHome('~/.ssh/id', home), path.join(home, '.ssh', 'id'));
  assert.strictEqual(expandHome('/abs/id', home), '/abs/id');
  const st = keyStatus({ home: tmpHome() });
  assert.strictEqual(st.exists, false);
  assert.strictEqual(st.isDefault, true);
  assert.strictEqual(st.publicKey, '');
});

test('ssh のパスから ssh-keygen を探す', () => {
  assert.strictEqual(keygenCommandFor('ssh'), 'ssh-keygen');
  assert.strictEqual(keygenCommandFor(''), 'ssh-keygen');
  assert.strictEqual(keygenCommandFor('/usr/bin/ssh'), path.join('/usr/bin', 'ssh-keygen'));
  assert.ok(keygenCommandFor('C:\\Windows\\System32\\OpenSSH\\ssh.exe').endsWith('ssh-keygen.exe'));
  assert.strictEqual(keygenCommandFor('/opt/bin/my-ssh-wrapper'), 'ssh-keygen');
});

test('登録コマンド: 公開鍵が引用符の中に入る', () => {
  const k = "ssh-ed25519 AAAAC3Nza it's@me";
  const c = registerCommands(k);
  assert.ok(c.mac.includes(shQuote(k)));
  assert.ok(c.mac.includes('>> ~/.ssh/authorized_keys'));
  assert.ok(c.winAdmin.includes(psQuote(k)));
  assert.ok(c.winAdmin.includes('administrators_authorized_keys'));
  assert.ok(c.winAdmin.includes('icacls'));
  assert.ok(c.winUser.includes(psQuote(k)));
  assert.strictEqual(psQuote("a'b"), "'a''b'");
  assert.strictEqual(shQuote("a'b"), `'a'\\''b'`);
});

test('ssh-keygen が無いときは、入れ方の分かるエラー', async () => {
  const home = tmpHome();
  await assert.rejects(generateKey({ home, command: path.join(home, 'no-such-ssh-keygen') }), /ssh-keygen が見つかりません/);
});

test('鍵を作る: パスフレーズなしの ed25519、2回目は作り直さない', { skip: !hasKeygen && 'ssh-keygen がありません' }, async () => {
  const home = tmpHome();
  const r = await generateKey({ home, comment: 'test-key' });
  assert.strictEqual(r.created, true);
  assert.strictEqual(r.path, defaultKeyPath(home));
  assert.ok(fs.existsSync(r.path));
  assert.match(r.publicKey, /^ssh-ed25519 \S+ test-key$/);
  // パスフレーズなし（空のパスフレーズで公開鍵を取り出せる）
  const pub = execFileSync('ssh-keygen', ['-y', '-P', '', '-f', r.path], { encoding: 'utf8' }).trim();
  assert.strictEqual(pub.split(' ')[1], r.publicKey.split(' ')[1]);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(r.path).mode & 0o077, 0);
  const again = await generateKey({ home });
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.publicKey, r.publicKey);
  assert.strictEqual(keyStatus({ home }).exists, true);
});

test('鍵はあるのに公開鍵が無いときは、作り直し方を出す', async () => {
  const home = tmpHome();
  const p = path.join(home, 'id_x');
  fs.writeFileSync(p, 'secret');
  await assert.rejects(generateKey({ keyPath: p, home }), /ssh-keygen -y -f/);
});

// ---------------- ホスト側: 受け取った公開鍵を登録する ----------------
const { parsePublicKey, authorizedKeysPath, installPublicKey } = require('../src/ssh-key');

const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeFakeFakeFakeFakeFakeFakeFakeFakeFake worktree-kanban me@client';

test('公開鍵の読み取り: .pub の1行だけを受け付け、秘密鍵は断る', () => {
  assert.strictEqual(parsePublicKey(`${PUB}\n`).line, PUB);
  assert.strictEqual(parsePublicKey(`${PUB}\r\n`).comment, 'worktree-kanban me@client');
  assert.throws(() => parsePublicKey('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----'), /秘密鍵/);
  assert.throws(() => parsePublicKey('hello world'), /公開鍵のファイルではない/);
  assert.throws(() => parsePublicKey(`${PUB}\n${PUB}`), /公開鍵のファイルではない/);
  assert.throws(() => parsePublicKey(''), /公開鍵のファイルではない/);
});

test('公開鍵を置く場所: Windows の管理者だけ ProgramData', () => {
  const home = path.join(path.sep, 'home', 'me');
  assert.strictEqual(authorizedKeysPath({ platform: 'darwin', home }), path.join(home, '.ssh', 'authorized_keys'));
  assert.strictEqual(authorizedKeysPath({ platform: 'win32', isAdmin: false, home }), path.join(home, '.ssh', 'authorized_keys'));
  assert.strictEqual(authorizedKeysPath({ platform: 'win32', isAdmin: true, programData: home }), path.join(home, 'ssh', 'administrators_authorized_keys'));
});

test('公開鍵を authorized_keys に足す（2回目は足さない・既存の行は残す）', { skip: process.platform === 'win32' && 'POSIX の権限を見るため' }, async () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'authorized_keys'), 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQOldOldOldOldOldOldOldOldOldOld old@pc');
  const r = await installPublicKey({ text: PUB, platform: 'darwin', home });
  assert.strictEqual(r.added, true);
  const file = path.join(home, '.ssh', 'authorized_keys');
  assert.strictEqual(r.file, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[1], PUB);
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(fs.statSync(path.join(home, '.ssh')).mode & 0o777, 0o700);
  const again = await installPublicKey({ text: PUB, platform: 'darwin', home });
  assert.strictEqual(again.added, false);
  assert.strictEqual(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 2);
});

test('Windows の管理者のときは管理者用のファイルに入れて、icacls で権限を絞る', async () => {
  const pd = tmpHome();
  const calls = [];
  const r = await installPublicKey({ text: PUB, platform: 'win32', isAdmin: true, programData: pd, run: async (cmd, args) => calls.push([cmd, ...args]) });
  assert.strictEqual(r.file, path.join(pd, 'ssh', 'administrators_authorized_keys'));
  assert.ok(fs.readFileSync(r.file, 'utf8').includes(PUB));
  assert.strictEqual(r.admin, true);
  assert.strictEqual(calls[0][0], 'icacls.exe');
  assert.ok(calls[0].includes('/inheritance:r'));
});

test('書き込めないときは、手で実行するコマンドを出す', { skip: (process.platform === 'win32' || process.getuid?.() === 0) && '権限を試せない環境' }, async () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'authorized_keys'), '');
  fs.chmodSync(path.join(home, '.ssh', 'authorized_keys'), 0o400);
  await assert.rejects(installPublicKey({ text: PUB, platform: 'darwin', home }), /書き込めませんでした.*authorized_keys/);
});
