const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { icon, agentIcon, ICON_NAMES, AGENT_ICON, NOTIF_ICON } = require('../renderer/icons.js');

// 絵文字（カラーで描かれる文字）。UI のアイコンはモノクロの SVG を使う
// （✓ ✕ → ▾ など、もともと1色で描かれる記号は使ってよい）
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{2705}\u{270A}\u{270B}\u{2728}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2795}-\u{2797}\u{27B0}\u{27BF}\u{2B1B}\u{2B1C}\u{2B50}\u{2B55}\u{231A}\u{231B}\u{23E9}-\u{23FA}\u{FE0F}]/u;

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

test('エージェントごとのブランドアイコンがある', () => {
  for (const [a, name] of Object.entries(AGENT_ICON)) {
    assert.ok(ICON_NAMES.includes(name), `${a} → ${name}`);
    assert.match(agentIcon(a), new RegExp(`class="ic"`));
    assert.doesNotMatch(agentIcon(a), /#[0-9a-f]{3,6}/i, `${a} に固定の色がある`);
  }
  // 未知のエージェントは汎用の bot
  assert.match(agentIcon('nope'), /viewBox="0 0 24 24"/);
  assert.match(agentIcon('claude', 'logo'), /class="ic logo"/);
});

test('使えるエージェントすべてに、見分けられる別々のアイコンがある', () => {
  const { AGENTS } = require('../src/providers.js');
  const ids = Object.keys(AGENTS);
  for (const a of ids) assert.ok(AGENT_ICON[a], `${a} のアイコンがない（bot になる）`);
  const svgs = ids.map((a) => agentIcon(a));
  assert.strictEqual(new Set(svgs).size, ids.length, 'エージェントのアイコンが重複している');
  for (const s of svgs) assert.notStrictEqual(s, icon('bot'));
});

test('renderer.js の agentIcon() は登録済みのエージェント ID', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  // agentIcon(agentOf(...)) / agentIcon(st.agent) / agentIcon(a) など変数渡しは除外し、直書きだけ見る
  for (const [, id] of src.matchAll(/agentIcon\('([^']+)'\)/g)) assert.ok(AGENT_ICON[id], id);
});

test('画面に出す文字に絵文字が残っていない', () => {
  // src/agent.js・main.js の文言（通知のボタン・会話のタイトル・カードの最後のメッセージ・ダイアログなど）も画面に出る
  for (const f of ['renderer/index.html', 'renderer/renderer.js', 'src/agent.js', 'main.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    src.split('\n').forEach((line, i) => assert.doesNotMatch(line, EMOJI, `${f}:${i + 1}: ${line.trim().slice(0, 80)}`));
  }
});

test('index.html の data-icon は icons.js にある名前', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  for (const [, name] of html.matchAll(/data-icon="([^"]+)"/g)) assert.ok(ICON_NAMES.includes(name), name);
  for (const [, name] of fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8').matchAll(/icon\('([^']+)'\)/g)) assert.ok(ICON_NAMES.includes(name), name);
});

test('renderer.js で icon() を同じ名前の変数で隠していない', () => {
  // const [icon, label] = ... のように隠すと、その中の icon('clock') が TypeError になり、
  // 詳細（Pipelineの工程など）が何も表示されなくなる
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  const decl = /\b(?:const|let|var)\s+(?:icon\b|[[{][^=;]*?\bicon\b[^=;]*?[\]}]\s*=)|function\s*\w*\s*\([^)]*\bicon\b[^)]*\)|\(([^()]*\b)?icon\b[^()]*\)\s*=>|\bicon\s*=>/;
  src.split('\n').forEach((line, i) => assert.doesNotMatch(line, decl, `renderer.js:${i + 1}: ${line.trim().slice(0, 80)}`));
});
