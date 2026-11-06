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
// opts.configDir: Claude Code の設定フォルダ（WSL のリポジトリなら、WSL の中の ~/.claude）
function listSessions(repoPath, opts = {}) {
  const dir = opts.configDir ? path.join(opts.configDir, 'projects') : projectsDir();
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
  // WSL のリポジトリなら、会話に記録された場所（/home/...）と Linux のパスで比べる
  const w = require('./wsl').parseWslPath(repoPath);
  const P = w ? path.posix : path;
  const norm = (p) => P.resolve(String(p || '')).replace(/[\\/]+$/, '');
  const repo = repoPath ? norm(w ? w.linux : repoPath) : '';
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
    s.related = !!repo && !!cwd && (cwd === repo || cwd.startsWith(repo + P.sep) || cwd.startsWith(wtRoot + P.sep));
    out.push(s);
  }
  return out;
}

// 会話の ID として受け付ける形（パスに使うので、記号や「..」を含むものは受け付けない）
function isValidId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
}

/**
 * 会話を消す。projects/<フォルダ>/<ID>.jsonl と、同じ名前の付属フォルダ（サブエージェントの記録など）を消す
 * @param {string[]} ids
 * @param {{ configDir?: string }} opts
 * @returns {string[]} 実際に消した会話の ID
 */
function deleteSessions(ids, opts = {}) {
  const dir = opts.configDir ? path.join(opts.configDir, 'projects') : projectsDir();
  const want = new Set((ids || []).filter(isValidId));
  if (!want.size) return [];
  let projects = [];
  try {
    projects = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const removed = new Set();
  for (const p of projects) {
    const pd = path.join(dir, p);
    for (const id of want) {
      const file = path.join(pd, `${id}.jsonl`);
      try {
        if (!fs.statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      fs.rmSync(file, { force: true });
      fs.rmSync(path.join(pd, id), { recursive: true, force: true });
      removed.add(id);
    }
  }
  return [...removed];
}

function projectsRoot(opts) {
  return opts && opts.configDir ? path.join(opts.configDir, 'projects') : projectsDir();
}

// id の会話ファイル（projects/<フォルダ>/<id>.jsonl）。新しい順
function sessionFiles(id, opts = {}) {
  if (!isValidId(id)) return [];
  const dir = projectsRoot(opts);
  let projects = [];
  try {
    projects = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found = [];
  for (const p of projects) {
    const file = path.join(dir, p, `${id}.jsonl`);
    try {
      const st = fs.statSync(file);
      if (st.isFile()) found.push({ file, mtime: st.mtimeMs, size: st.size });
    } catch {
      /* ない */
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found;
}

// その時点の会話ファイルのバイト数。無い・ID が不正なら null
function sessionSize(id, opts = {}) {
  const files = sessionFiles(id, opts);
  return files.length ? files[0].size : null;
}

// 付属ファイルの、会話の中で指している名前。短い名前は本文と重なりやすいので対象にしない
function sideToken(file) {
  let base = path.basename(file);
  if (base.endsWith('.meta.json')) base = base.slice(0, -'.meta.json'.length);
  else if (base.includes('.')) base = base.slice(0, base.lastIndexOf('.'));
  if (base.startsWith('agent-')) base = base.slice('agent-'.length);
  return base.length >= 8 ? base : '';
}

function walkFiles(dir) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function removeEmptyDirs(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name));
  try {
    if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
  } catch {
    /* ファイルが残っている */
  }
}

// size より後ろの会話にだけ出てくる付属記録（サブエージェントやツールの出力）を消す。前の会話が参照しているものは残す
function discardSideAfter(jsonlFile, id, size) {
  const dir = path.join(path.dirname(jsonlFile), id);
  let dirStat;
  try {
    dirStat = fs.statSync(dir);
  } catch {
    return;
  }
  if (!dirStat.isDirectory()) return;
  const fileSize = fs.statSync(jsonlFile).size;
  if (fileSize <= size) return;
  const head = Buffer.alloc(size);
  const tail = Buffer.alloc(fileSize - size);
  const fd = fs.openSync(jsonlFile, 'r');
  try {
    if (fs.readSync(fd, head, 0, size, 0) !== size) return;
    if (fs.readSync(fd, tail, 0, tail.length, size) !== tail.length) return;
  } finally {
    fs.closeSync(fd);
  }
  for (const file of walkFiles(dir)) {
    const token = sideToken(file);
    if (!token) continue;
    const raw = Buffer.from(token);
    if (tail.includes(raw) && !head.includes(raw)) fs.rmSync(file, { force: true });
  }
  removeEmptyDirs(dir);
}

// 会話ファイルを size バイトに切り詰める。size の直前が改行で、ファイルがそれ以上のときだけ
// 条件に合わなければ何もせず false（行の途中・小さすぎる・ID が不正）
// 切り詰めるときは、その時点よりあとの付属フォルダの記録も捨てる
function truncateSession(id, size, opts = {}) {
  try {
    return truncateSessionAt(id, size, opts);
  } catch {
    return false;
  }
}

function truncateSessionAt(id, size, opts = {}) {
  if (!isValidId(id)) return false;
  if (!Number.isInteger(size) || size <= 0) return false;
  const files = sessionFiles(id, opts);
  if (!files.length) return false;
  for (const f of files) {
    if (f.size < size) return false;
    const fd = fs.openSync(f.file, 'r');
    try {
      const buf = Buffer.alloc(1);
      const n = fs.readSync(fd, buf, 0, 1, size - 1);
      if (n !== 1 || buf[0] !== 0x0a) return false;
    } finally {
      fs.closeSync(fd);
    }
  }
  for (const f of files) if (f.size !== size) discardSideAfter(f.file, id, size);
  for (const f of files) if (f.size !== size) fs.truncateSync(f.file, size);
  return true;
}

module.exports = { listSessions, deleteSessions, projectsDir, isValidId, sessionSize, truncateSession };
