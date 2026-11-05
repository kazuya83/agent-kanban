const test = require('node:test');
const assert = require('node:assert');
const Zoom = require('../renderer/zoom');
const FlowView = require('../renderer/flow-view');

test('倍率は下限・上限の中に収め、おかしな値は 100% にする', () => {
  assert.strictEqual(Zoom.clamp(0.01), Zoom.MIN);
  assert.strictEqual(Zoom.clamp(99), Zoom.MAX);
  assert.strictEqual(Zoom.clamp(NaN), 1);
  assert.strictEqual(Zoom.clamp(-1), 1);
  assert.strictEqual(Zoom.clamp(1.234), 1.23);
});

test('ボタンで1段ずつ変わり、100% をまたぐときは 100% で止まる', () => {
  assert.strictEqual(Zoom.step(1, 1), 1.2);
  assert.strictEqual(Zoom.step(1, -1), 0.83);
  assert.strictEqual(Zoom.step(0.9, 1), 1);
  assert.strictEqual(Zoom.step(1.1, -1), 1);
  assert.strictEqual(Zoom.step(Zoom.MAX, 1), Zoom.MAX);
  assert.strictEqual(Zoom.step(Zoom.MIN, -1), Zoom.MIN);
});

test('⌘＋スクロールは上で拡大・下で縮小する', () => {
  assert.ok(Zoom.wheel(1, -50) > 1);
  assert.ok(Zoom.wheel(1, 50) < 1);
  assert.ok(Zoom.wheel(1, -3, 1) > 1); // 行単位の wheel
});

test('全体が見える倍率は、枠に収まる大きさで 100% を超えない', () => {
  assert.strictEqual(Zoom.fit(2000, 500, 1000, 1000), 0.5);
  assert.strictEqual(Zoom.fit(400, 300, 1000, 1000), 1);
  assert.strictEqual(Zoom.fit(0, 0, 1000, 1000), 1);
});

test('カーソルの位置を動かさずに倍率を変えるスクロール位置', () => {
  // 100% で (100,50) にあるものは、200% にすると (200,100)。カーソルが枠の (100,50) なら、スクロールは (100,50)
  assert.deepStrictEqual(Zoom.anchor(0, 0, 100, 50, 1, 2), { left: 100, top: 50 });
  assert.deepStrictEqual(Zoom.anchor(100, 50, 100, 50, 2, 1), { left: 0, top: 0 });
  assert.deepStrictEqual(Zoom.anchor(0, 0, 100, 50, 1, 0.5), { left: 0, top: 0 });
});

test('ボタンの欄は倍率を出し、端では押せない', () => {
  assert.match(Zoom.toolbarHtml(1.5), /150%/);
  assert.match(Zoom.toolbarHtml(1, '全体'), /全体/);
  assert.match(Zoom.toolbarHtml(Zoom.MAX), /data-zoom="in"[^>]*disabled/);
  assert.match(Zoom.toolbarHtml(Zoom.MIN), /data-zoom="out"[^>]*disabled/);
});

test('進捗のフローチャートは、倍率を渡すとその大きさで描く', () => {
  const f = { nodes: [{ id: 'start', type: 'start', x: 0, y: 0 }, { id: 'end', type: 'end', x: 0, y: 100 }], edges: [{ id: 'e1', from: 'start', to: 'end' }] };
  const fitSvg = FlowView.html(f, new Map());
  const vb = fitSvg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.match(fitSvg, /max-width:100%/);
  const big = FlowView.html(f, new Map(), { zoom: 2 });
  assert.doesNotMatch(big, /max-width:100%/);
  assert.match(big, new RegExp(`width="${vb[1] * 2}" height="${vb[2] * 2}"`));
});
