const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { icon, ICON_NAMES, NOTIF_ICON } = require('../renderer/icons.js');

// 絵文字（カラーで描かれる文字）。UI のアイコンはモノクロの SVG を使う
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{2B50}\u{23E9}-\u{23FA}\u{FE0F}]/u;

test('icon() はモノクロ（currentColor）の SVG を返す', () => {
  for (const name of ICON_NAMES) {
    const svg = icon(name);
    assert.match(svg, /^<svg class="ic" viewBox="0 0 24 24"/, name);
    assert.match(svg, /stroke="currentColor"/, name);
    assert.doesNotMatch(svg, /#[0-9a-f]{3,6}/i, `${name} に固定の色がある`);
  }
  assert.strictEqual(icon('nope'), '');
  assert.match(icon('chat', 'logo'), /class="ic logo"/);
});

test('通知の種類ごとのアイコンがある', () => {
  for (const name of Object.values(NOTIF_ICON)) assert.ok(ICON_NAMES.includes(name), name);
});

test('画面（renderer）に絵文字が残っていない', () => {
  for (const f of ['index.html', 'renderer.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');
    src.split('\n').forEach((line, i) => assert.doesNotMatch(line, EMOJI, `${f}:${i + 1}: ${line.trim().slice(0, 80)}`));
  }
});

test('index.html の data-icon は icons.js にある名前', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  for (const [, name] of html.matchAll(/data-icon="([^"]+)"/g)) assert.ok(ICON_NAMES.includes(name), name);
  for (const [, name] of fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8').matchAll(/icon\('([^']+)'\)/g)) assert.ok(ICON_NAMES.includes(name), name);
});
