// Claude Code の過去の会話（セッション）の一覧を読む（読み取りのみ。ファイルは変更しない）
// 会話は ~/.claude/projects/<フォルダ名>/<セッションID>.jsonl に保存されている
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_FILES = 300; // 新しい順にこれだけ見る
const HEAD_BYTES = 256 * 1024; // 各ファイルの先頭だけ読む

function projectsDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function firstUserText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const t = content.find((b) => b && b.type === 'text' && b.text);
    return t ? t.text : '';
  }
  return '';
}

// システムが差し込んだメッセージ（<command-name> など）は、会話のタイトルに使わない
function isRealPrompt(text) {
  const t = String(text || '').trim();
  return t && !t.startsWith('<') && !t.startsWith('Caveat:');
}

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function parseSession(file) {
  const id = path.basename(file, '.jsonl');
  const st = fs.statSync(file);
  let cwd = '';
  let branch = '';
  let title = '';
  let summary = '';
  let messages = 0;
  const lines = readHead(file).split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // 途中で切れた最後の行など
    }
    if (d.type === 'summary' && d.summary && !summary) summary = d.summary;
    if (!cwd && d.cwd) cwd = d.cwd;
    if (!branch && d.gitBranch) branch = d.gitBranch;
    if (d.type === 'user' && !d.isMeta && d.message) {
      const text = firstUserText(d.message.content);
      if (isRealPrompt(text)) {
        messages++;
        if (!title) title = text.trim().replace(/\s+/g, ' ').slice(0, 120);
      }
    }
  }
  if (!title && !summary) return null; // 中身のない会話
  return { id, title: summary || title, firstPrompt: title, cwd, branch, updatedAt: st.mtimeMs, size: st.size, messages };
}

/**
 * @param {string} repoPath  このリポジトリ（と、そのタスク用 worktree）の会話を「関係あり」にする
 * @returns {Array<{id, title, cwd, branch, updatedAt, related: boolean}>} 新しい順
 */
function listSessions(repoPath) {
  const dir = projectsDir();
  let files = [];
  try {
    for (const p of fs.readdirSync(dir)) {
      const pd = path.join(dir, p);
      let entries;
      try {
        entries = fs.readdirSync(pd);
      } catch {
        continue;
      }
      for (const f of entries) {
        if (!f.endsWith('.jsonl')) continue;
        const full = path.join(pd, f);
        try {
          files.push({ full, mtime: fs.statSync(full).mtimeMs });
        } catch {
          /* 消えた */
        }
      }
    }
  } catch {
    return [];
  }
  files.sort((a, b) => b.mtime - a.mtime);
  files = files.slice(0, MAX_FILES);
  const norm = (p) => path.resolve(String(p || '')).replace(/[\\/]+$/, '');
  const repo = repoPath ? norm(repoPath) : '';
  const wtRoot = repo ? `${repo}.worktrees` : '';
  const out = [];
  const seen = new Set();
  for (const f of files) {
    let s;
    try {
      s = parseSession(f.full);
    } catch {
      continue;
    }
    if (!s || seen.has(s.id)) continue; // 同じ会話が複数のフォルダにあるときは新しいほうだけ
    seen.add(s.id);
    const cwd = s.cwd ? norm(s.cwd) : '';
    s.related = !!repo && !!cwd && (cwd === repo || cwd.startsWith(repo + path.sep) || cwd.startsWith(wtRoot + path.sep));
    out.push(s);
  }
  return out;
}

module.exports = { listSessions, projectsDir };
