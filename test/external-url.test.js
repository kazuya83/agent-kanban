// 外部ブラウザで開く URL の検証（main.js の open:external で使う）
const test = require('node:test');
const assert = require('node:assert');
const { externalUrl } = require('../src/external-url');

test('externalUrl: http(s) の URL は GitHub 以外でも通す', () => {
  assert.strictEqual(externalUrl('https://github.com/a/b/pull/1'), 'https://github.com/a/b/pull/1');
  assert.strictEqual(externalUrl('https://example.com/a?b=1&c=2#d'), 'https://example.com/a?b=1&c=2#d');
  assert.strictEqual(externalUrl('http://localhost:3000/'), 'http://localhost:3000/');
  assert.strictEqual(externalUrl('https://例え.テスト/パス').startsWith('https://xn--'), true);
});

test('externalUrl: http(s) 以外や URL でないものは拒否する', () => {
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'vscode://x', 'smb://host/share', 'ms-msdt:/id', '/etc/passwd', 'example.com', '', null, undefined, 1, {}, ['https://example.com']]) {
    assert.strictEqual(externalUrl(bad), null, String(bad));
  }
});
