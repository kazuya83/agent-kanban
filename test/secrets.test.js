// トークンの保存: 平文で保存しないこと、画面・遠隔のクライアント・環境変数に値を渡さないこと
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SecretStore } = require('../src/secrets');
const trackers = require('../src/trackers');
const { Store } = require('../src/store');
const { isProxyChannel } = require('../src/remote');

const TOKEN = 'lin_api_SUPERSECRET123456';
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wk-secrets-'));

// 実際の暗号の代わり（元の文字がファイルに残らないように XOR する）
function fakeSafeStorage({ available = true, backend } = {}) {
  const flip = (b) => Buffer.from(b.map((x) => x ^ 0x5a));
  return {
    isEncryptionAvailable: () => available,
    ...(backend ? { getSelectedStorageBackend: () => backend } : {}),
    encryptString: (s) => flip(Buffer.from(s, 'utf8')),
    decryptString: (b) => flip(b).toString('utf8'),
  };
}

function setup(safeStorage = fakeSafeStorage()) {
  const dir = tmpDir();
  const file = path.join(dir, 'secrets.json');
  const store = new Store(path.join(dir, 'board.json'));
  const secrets = new SecretStore({ file, safeStorage });
  return { dir, file, store, secrets, t: new trackers.Trackers({ store, secrets }) };
}

let tested = null;
const fake = {
  id: 'faketrack',
  label: 'Fake',
  configFields: [
    { name: 'baseUrl', type: 'url', label: '接続先', default: 'https://fake.example.com', required: true, allowHttpField: 'allowHttp' },
    { name: 'allowHttp', type: 'checkbox', label: 'http を許可' },
    { name: 'token', type: 'secret', label: 'トークン', required: true },
  ],
  async testConnection(ctx) {
    tested = { url: ctx.config.baseUrl, token: ctx.secret('token') };
    if (tested.url.includes('boom')) throw new Error(`failed with ${tested.token}`);
    return { ok: true };
  },
};
test.before(() => trackers.register(fake));
test.after(() => trackers.unregister(fake.id));

test('平文では保存しない。読み直せて、ファイルは自分だけが読める', { skip: process.platform === 'win32' }, () => {
  const { file, secrets } = setup();
  secrets.set('a', TOKEN);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(TOKEN));
  assert.ok(!fs.readFileSync(file, 'utf8').includes(Buffer.from(TOKEN).toString('base64')));
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(new SecretStore({ file, safeStorage: fakeSafeStorage() }).get('a'), TOKEN);
});

test('safeStorage が使えないときは保存せず、分かるエラーにする', () => {
  for (const safe of [fakeSafeStorage({ available: false }), fakeSafeStorage({ backend: 'basic_text' }), null]) {
    const { file, secrets } = setup(safe);
    assert.throws(() => secrets.set('a', TOKEN), /安全な保存先/);
    assert.ok(!fs.existsSync(file));
  }
});

test('Linux の鍵の保管先があれば使える', () => {
  assert.ok(new SecretStore({ file: '', safeStorage: fakeSafeStorage({ backend: 'gnome_libsecret' }) }).available());
});

test('読めないものはエラーにし、has は暗号を解かない。delete で消える', () => {
  const { file, secrets } = setup();
  secrets.set('a', TOKEN);
  let decrypted = 0;
  const other = new SecretStore({ file, safeStorage: { ...fakeSafeStorage(), decryptString: () => { decrypted++; throw new Error('bad key'); } } });
  assert.ok(other.has('a'));
  assert.strictEqual(decrypted, 0);
  assert.throws(() => other.get('a'), /入れ直して/);
  assert.strictEqual(secrets.get('none'), '');
  assert.ok(secrets.delete('a'));
  assert.ok(!secrets.has('a'));
  assert.ok(!fs.readFileSync(file, 'utf8').includes('tracker'));
});

test('トークンは store の JSON にも、画面へ返す値にも、環境変数にも入らない', () => {
  const { store, t, dir } = setup();
  const r = t.save('faketrack', { config: { token: TOKEN, baseUrl: 'https://fake.example.com' }, secrets: { token: TOKEN } });
  store.flush();
  assert.ok(!fs.readFileSync(path.join(dir, 'board.json'), 'utf8').includes(TOKEN));
  assert.ok(!JSON.stringify(store.settings).includes(TOKEN));
  for (const out of [r, t.publicList(), t.publicOne('faketrack')]) assert.ok(!JSON.stringify(out).includes(TOKEN));
  assert.strictEqual(r.secrets.token, true);
  assert.strictEqual(r.configured, true);
  assert.deepStrictEqual(store.settings.trackerConfigs.faketrack, { baseUrl: 'https://fake.example.com', allowHttp: false });
  assert.ok(!Object.values(process.env).some((v) => String(v).includes(TOKEN)));
  // ボードに載る一覧には、設定もトークンの有無も入らない
  assert.ok(!JSON.stringify(trackers.issueProviderMeta()).includes('secret'));
});

test('遠隔のクライアントに開くのは一覧・保存・削除・接続テストだけ。値を読むチャンネルはない', () => {
  for (const ch of ['trackers:list', 'trackers:save', 'trackers:remove', 'trackers:test']) assert.ok(isProxyChannel(ch), ch);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.deepStrictEqual([...main.matchAll(/handle\('(trackers:\w+)'/g)].map((m) => m[1]).sort(), ['trackers:list', 'trackers:remove', 'trackers:save', 'trackers:test']);
  assert.ok(!/secrets\.get|\.secret\(/.test(main));
});

test('接続先を変えたら、一緒に入れ直さなかったトークンは消す（別の接続先へ送らない）', async () => {
  const { t } = setup();
  t.save('faketrack', { secrets: { token: TOKEN } });
  assert.throws(() => t.save('faketrack', { config: { baseUrl: 'https://evil.example.com' } }), /トークン/);
  await assert.rejects(t.test('faketrack', { config: { baseUrl: 'https://evil.example.com' } }), /入れ直して/);
  tested = null;
  await t.test('faketrack', {});
  assert.deepStrictEqual(tested, { url: 'https://fake.example.com', token: TOKEN });

  fake.configFields[2].required = false;
  try {
    const r = t.save('faketrack', { config: { baseUrl: 'https://other.example.com' } });
    assert.deepStrictEqual(r.cleared, ['token']);
    assert.strictEqual(r.secrets.token, false);
  } finally {
    fake.configFields[2].required = true;
  }
});

test('接続テストは入力中の値を使い、保存しない。例外の文からトークンを消す', async () => {
  const { t, store } = setup();
  await t.test('faketrack', { config: { baseUrl: 'https://draft.example.com' }, secrets: { token: 'draft-token' } });
  assert.deepStrictEqual(tested, { url: 'https://draft.example.com', token: 'draft-token' });
  assert.deepStrictEqual(store.settings.trackerConfigs, {});
  assert.ok(!t.hasSecret('faketrack', 'token'));
  await assert.rejects(t.test('faketrack', { config: { baseUrl: 'https://boom.example.com' }, secrets: { token: TOKEN } }), (err) => !err.message.includes(TOKEN) && /\*\*\*/.test(err.message));
});

test('削除すると設定とトークンが消える', () => {
  const { t, store } = setup();
  t.save('faketrack', { secrets: { token: TOKEN } });
  const r = t.remove('faketrack');
  assert.strictEqual(r.secrets.token, false);
  assert.strictEqual(r.configured, false);
  assert.ok(!('faketrack' in store.settings.trackerConfigs));
});

test('保存先が使えないときは、設定も保存しない', () => {
  const { t, store } = setup(fakeSafeStorage({ available: false }));
  assert.throws(() => t.save('faketrack', { secrets: { token: TOKEN } }), /安全な保存先/);
  assert.deepStrictEqual(store.settings.trackerConfigs, {});
});
