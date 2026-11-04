// ツールの結果に入っている画像を取り出して、ログに残す
const test = require('node:test');
const assert = require('node:assert');
const { AgentManager, toolResultText, toolResultImages } = require('../src/agent');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('画像は [image] という文字にせず、画像として取り出す', () => {
  const content = [{ type: 'text', text: 'スクリーンショットを撮りました' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }];
  assert.strictEqual(toolResultText(content), 'スクリーンショットを撮りました');
  assert.deepStrictEqual(toolResultImages(content), [{ mediaType: 'image/png', data: PNG }]);
});

test('表示できない画像は理由つきで残す', () => {
  const ims = toolResultImages([
    { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
    { type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: PNG } },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '"><script>' } },
  ]);
  assert.strictEqual(ims.length, 3);
  assert.ok(ims.every((im) => im.omitted && !im.data));
  assert.deepStrictEqual(toolResultImages('ok'), []);
});

test('ストリームの tool_result の画像がログに入り、古い画像は消される', () => {
  const store = { cards: [], save() {}, settings: {} };
  const agents = Object.create(AgentManager.prototype);
  agents.store = store;
  agents.emit = () => {};
  const card = { id: 'c1', logs: [] };
  for (let i = 0; i < 35; i++) agents.log(card, 'tool_result', '', { images: [{ mediaType: 'image/png', data: PNG }] });
  const kept = card.logs.filter((l) => l.images[0].data).length;
  assert.strictEqual(kept, 30);
  assert.ok(card.logs[0].images[0].omitted, '一番古いものが消える');
  assert.ok(card.logs.at(-1).images[0].data, '新しいものは残る');
});
