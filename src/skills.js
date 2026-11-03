// 使えるスキルの一覧を読む（読み取りのみ）
// - プロジェクト: <リポジトリ>/.claude/skills/<名前>/SKILL.md
// - 自分用:       ~/.claude/skills/<名前>/SKILL.md
// - プラグイン:   ~/.claude/plugins/installed_plugins.json に載っているプラグインの skills/<名前>/SKILL.md
//                 （「プラグイン名:スキル名」で呼ぶ。settings.json の enabledPlugins で無効なものは除く）
// スキルは、指示の先頭に「/スキル名」を付けて claude に渡すと使われる
const fs = require('fs');
const os = require('os');
const path = require('path');

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// SKILL.md の先頭の --- で囲まれた部分（name / description）を読む
function parseFrontmatter(text) {
  const m = String(text).match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    val = val.trim();
    // 「description: >」や「|」で複数行になっている場合
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      const buf = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) buf.push(lines[++i].trim());
      val = buf.join(val.startsWith('>') ? ' ' : '\n');
    }
    out[key] = val.replace(/^["']|["']$/g, '');
  }
  return out;
}

function readSkillDir(skillsDir, source, prefix) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const file = path.join(skillsDir, e.name, 'SKILL.md');
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    const base = fm.name || e.name;
    // user-invocable: false のスキルは、ユーザーが選んで使うものではないので出さない
    if (String(fm['user-invocable']).toLowerCase() === 'false') continue;
    out.push({
      name: prefix ? `${prefix}:${base}` : base,
      description: fm.description || '',
      source,
      plugin: prefix || undefined,
      path: file,
    });
  }
  return out;
}

function pluginSkills() {
  const dir = configDir();
  const installed = readJson(path.join(dir, 'plugins', 'installed_plugins.json'));
  if (!installed || !installed.plugins) return [];
  const settings = readJson(path.join(dir, 'settings.json')) || {};
  const enabled = settings.enabledPlugins || {};
  const out = [];
  for (const [key, val] of Object.entries(installed.plugins)) {
    if (enabled[key] === false) continue;
    const pluginName = key.split('@')[0];
    // v1: { installPath } / v2: [{ installPath, scope, ... }]
    const installs = Array.isArray(val) ? val : [val];
    const install = installs.find((x) => x && x.installPath);
    if (!install) continue;
    out.push(...readSkillDir(path.join(install.installPath, 'skills'), 'plugin', pluginName));
  }
  return out;
}

/**
 * @param {string} repoPath
 * @returns {Array<{name: string, description: string, source: 'project'|'user'|'plugin', plugin?: string}>}
 */
function listSkills(repoPath) {
  const list = [
    ...(repoPath ? readSkillDir(path.join(repoPath, '.claude', 'skills'), 'project') : []),
    ...readSkillDir(path.join(configDir(), 'skills'), 'user'),
    ...pluginSkills(),
  ];
  // 同じ名前はプロジェクト → 自分用 → プラグインの順で優先
  const seen = new Set();
  return list.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
}

// 指示にスキルを付ける（「/スキル名 指示」の形にする）
function withSkill(skill, prompt) {
  const name = String(skill || '').trim().replace(/^\//, '');
  return name ? `/${name} ${prompt}` : prompt;
}

module.exports = { listSkills, withSkill, parseFrontmatter };
