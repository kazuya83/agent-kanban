// スキルの一覧と、スキルを付けて実行する流れ
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listSkills, withSkill, parseFrontmatter } = require('../src/skills');

function skill(dir, name, fm) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `---\n${fm}\n---\n本文\n`);
}

test('SKILL.md の先頭（name / description）を読む', () => {
  assert.deepStrictEqual(parseFrontmatter('---\nname: a\ndescription: "説明です"\n---\nx'), { name: 'a', description: '説明です' });
  assert.deepStrictEqual(parseFrontmatter('---\nname: b\ndescription: >\n  1行目\n  2行目\n---\n'), { name: 'b', description: '1行目 2行目' });
  assert.deepStrictEqual(parseFrontmatter('見出しなし'), {});
  assert.strictEqual(withSkill('review', '見て'), '/review 見て');
  assert.strictEqual(withSkill('/review', '見て'), '/review 見て');
  assert.strictEqual(withSkill(null, '見て'), '見て');
});

test('プロジェクト・自分用・プラグインのスキルを集める', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-skill-'));
  const repo = path.join(tmp, 'repo');
  const cfg = path.join(tmp, 'cfg');
  skill(path.join(repo, '.claude', 'skills'), 'deploy', 'name: deploy\ndescription: 本番に出す');
  skill(path.join(repo, '.claude', 'skills'), 'shared', 'name: shared\ndescription: プロジェクト版');
  skill(path.join(cfg, 'skills'), 'shared', 'name: shared\ndescription: 自分用（プロジェクトが優先）');
  skill(path.join(cfg, 'skills'), 'notes', 'name: notes\ndescription: メモを書く');
  skill(path.join(cfg, 'skills'), 'internal', 'name: internal\ndescription: 内部用\nuser-invocable: false');
  const p1 = path.join(tmp, 'plugins', 'p1');
  const p2 = path.join(tmp, 'plugins', 'p2');
  skill(path.join(p1, 'skills'), 'lint', 'name: lint\ndescription: 整形');
  skill(path.join(p2, 'skills'), 'off', 'name: off\ndescription: 無効なプラグイン');
  fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'tools@mkt': [{ installPath: p1 }], 'old@mkt': [{ installPath: p2 }] } }));
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ enabledPlugins: { 'tools@mkt': true, 'old@mkt': false } }));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    const list = listSkills(repo);
    const by = Object.fromEntries(list.map((s) => [s.name, s]));
    assert.deepStrictEqual(Object.keys(by).sort(), ['deploy', 'notes', 'shared', 'tools:lint']);
    assert.strictEqual(by.shared.source, 'project');
    assert.strictEqual(by.notes.source, 'user');
    assert.strictEqual(by['tools:lint'].source, 'plugin');
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
});
