// git コマンドの薄いラッパー
const { execFile } = require('child_process');
const fs = require('fs');

function git(cwd, args, { allowExitCodes = [] } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        if (typeof err.code === 'number' && allowExitCodes.includes(err.code)) return resolve(stdout);
        const e = new Error(`git ${args.join(' ')} に失敗しました: ${(stderr || err.message).trim()}`);
        e.stdout = stdout;
        e.stderr = stderr;
        return reject(e);
      }
      resolve(stdout);
    });
  });
}

async function toplevel(dir) {
  try {
    return (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return null;
  }
}

async function currentBranch(repo) {
  return (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

async function revParse(repo, ref) {
  try {
    return (await git(repo, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
  } catch {
    throw new Error(`${ref} が見つかりません（リポジトリにコミットが1つもない可能性があります）`);
  }
}

async function branches(repo) {
  const out = await git(repo, ['branch', '--format=%(refname:short)']);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// user.name / user.email が未設定でもコミットできるようにする
async function identityArgs(cwd) {
  try {
    const email = (await git(cwd, ['config', 'user.email'])).trim();
    if (email) return [];
  } catch {
    /* 未設定 */
  }
  return ['-c', 'user.name=Claude Agent Kanban', '-c', 'user.email=agent-kanban@localhost'];
}

async function addWorktree(repo, wtPath, branch, baseCommit) {
  await git(repo, ['worktree', 'add', '-b', branch, wtPath, baseCommit]);
}

async function removeWorktree(repo, wtPath) {
  if (!wtPath) return;
  try {
    await git(repo, ['worktree', 'remove', '--force', wtPath]);
  } catch {
    fs.rmSync(wtPath, { recursive: true, force: true });
    await git(repo, ['worktree', 'prune']).catch(() => {});
  }
}

async function deleteBranch(repo, branch) {
  if (!branch) return;
  await git(repo, ['branch', '-D', branch]).catch(() => {});
}

async function isDirty(repo) {
  const out = await git(repo, ['status', '--porcelain', '--untracked-files=no']);
  return out.trim().length > 0;
}

// 変更があればすべてコミットする。コミットしたら true
async function commitAll(cwd, message) {
  await git(cwd, ['add', '-A']);
  const status = await git(cwd, ['status', '--porcelain']);
  if (!status.trim()) return false;
  await git(cwd, [...(await identityArgs(cwd)), 'commit', '-q', '-m', message]);
  return true;
}

async function countCommits(repo, range) {
  return parseInt((await git(repo, ['rev-list', '--count', range])).trim(), 10) || 0;
}

// cwd でチェックアウトしているブランチに branch をマージする
async function merge(cwd, branch, message, target) {
  try {
    await git(cwd, [...(await identityArgs(cwd)), 'merge', '--no-ff', '-m', message, branch]);
  } catch (err) {
    await git(cwd, ['merge', '--abort']).catch(() => {});
    throw new Error(`${target || 'マージ先'} へのマージでコンフリクトが起きたため中止しました。追加指示で「${target || 'マージ先'} を取り込んでコンフリクトを解消して」と頼むか、手動でマージしてください。\n${err.message}`);
  }
}

async function branchExists(repo, name) {
  try {
    await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
    return true;
  } catch {
    return false;
  }
}

async function checkBranchName(repo, name) {
  try {
    await git(repo, ['check-ref-format', '--branch', name]);
  } catch {
    throw new Error(`「${name}」はブランチ名に使えません`);
  }
}

async function createBranch(repo, name, startPoint) {
  await git(repo, ['branch', name, startPoint]);
}

// branch をチェックアウトしている worktree のパス（なければ null）
async function worktreeForBranch(repo, branch) {
  const out = await git(repo, ['worktree', 'list', '--porcelain']);
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}`) return current;
  }
  return null;
}

async function addWorktreeForBranch(repo, wtPath, branch) {
  await git(repo, ['worktree', 'add', wtPath, branch]);
}

// 日本語などのファイル名を "\343..." のようにエスケープさせない
const Q = ['-c', 'core.quotepath=false'];

// ベースコミットからの差分（コミット済み＋未コミット＋未追跡ファイル）
// index を触らないので、エージェントの実行中に呼んでも安全
async function diff(wt, baseCommit) {
  let out = await git(wt, ['diff', baseCommit]);
  const untracked = (await git(wt, [...Q, 'ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .filter(Boolean);
  for (const file of untracked.slice(0, 200)) {
    out += await git(wt, ['diff', '--no-index', '--', '/dev/null', file], { allowExitCodes: [1] }).catch(() => '');
  }
  return out;
}

// `git diff --numstat` と `--name-status` の出力をまとめて [{ path, status, add, del, binary }] にする
function parseChanges(numstat, nameStatus) {
  const stat = new Map();
  for (const line of numstat.split('\n')) {
    const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
    if (!m) continue;
    stat.set(m[3], { add: m[1] === '-' ? 0 : +m[1], del: m[2] === '-' ? 0 : +m[2], binary: m[1] === '-' });
  }
  const out = [];
  for (const line of nameStatus.split('\n')) {
    const m = line.match(/^([A-Z])\d*\t(.+)$/);
    if (!m) continue;
    const s = stat.get(m[2]) || { add: 0, del: 0, binary: false };
    out.push({ path: m[2], status: m[1], ...s });
  }
  return out;
}

function countLines(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return { add: 0, binary: st.isFile() };
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return { add: 0, binary: true };
    const text = buf.toString('utf8');
    return { add: text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0, binary: false };
  } catch {
    return { add: 0, binary: false };
  }
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * worktree の作業状況（ベースからのコミット・未コミットの変更・ベースブランチの進み具合）
 * index を触らないので、エージェントの実行中に呼んでも安全
 */
async function worktreeStatus(wt, baseCommit, baseBranch) {
  const path = require('path');
  const head = (await git(wt, ['rev-parse', 'HEAD'])).trim();
  const branch = (await git(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();

  // ブランチに積まれたコミット（古い順）
  const SEP = '\x1f';
  const logOut = baseCommit === head ? '' : await git(wt, ['log', '--reverse', '--no-merges', `--format=%H${SEP}%s${SEP}%an${SEP}%aI`, '--shortstat', `${baseCommit}..HEAD`]);
  const commits = [];
  for (const line of logOut.split('\n')) {
    if (line.includes(SEP)) {
      const [sha, subject, author, date] = line.split(SEP);
      commits.push({ sha, subject, author, date, files: 0, add: 0, del: 0 });
    } else if (commits.length && /changed/.test(line)) {
      const c = commits[commits.length - 1];
      c.files = +(line.match(/(\d+) files? changed/) || [0, 0])[1];
      c.add = +(line.match(/(\d+) insertions?/) || [0, 0])[1];
      c.del = +(line.match(/(\d+) deletions?/) || [0, 0])[1];
    }
  }

  // コミット済みの変更（ベース → HEAD）
  const committed =
    baseCommit === head
      ? []
      : parseChanges(
          await git(wt, [...Q, 'diff', '--no-renames', '--numstat', baseCommit, 'HEAD']),
          await git(wt, [...Q, 'diff', '--no-renames', '--name-status', baseCommit, 'HEAD']),
        );

  // 未コミットの変更（HEAD → 作業ツリー）と未追跡ファイル
  const uncommitted = parseChanges(
    await git(wt, [...Q, 'diff', '--no-renames', '--numstat', 'HEAD']),
    await git(wt, [...Q, 'diff', '--no-renames', '--name-status', 'HEAD']),
  );
  const untracked = (await git(wt, [...Q, 'ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean);
  for (const file of untracked.slice(0, 500)) {
    uncommitted.push({ path: file, status: '?', del: 0, ...countLines(path.join(wt, file)) });
  }
  for (const f of uncommitted) f.mtime = f.status === 'D' ? null : mtime(path.join(wt, f.path));

  // ベースブランチがその後どれだけ進んだか
  let behind = 0;
  if (baseBranch) {
    behind = await countCommits(wt, `${baseCommit}..${baseBranch}`).catch(() => 0);
  }

  const headInfo = (await git(wt, ['log', '-1', `--format=%h${SEP}%s${SEP}%aI`, 'HEAD'])).trim().split(SEP);
  const baseInfo = (await git(wt, ['log', '-1', `--format=%h${SEP}%s${SEP}%aI`, baseCommit]).catch(() => '')).trim().split(SEP);

  return {
    path: wt,
    branch,
    baseBranch: baseBranch || null,
    base: { sha: baseCommit, short: baseInfo[0] || baseCommit.slice(0, 7), subject: baseInfo[1] || '', date: baseInfo[2] || null },
    head: { sha: head, short: headInfo[0], subject: headInfo[1] || '', date: headInfo[2] || null },
    behind,
    commits,
    committed,
    uncommitted,
    untrackedTruncated: Math.max(0, untracked.length - 500),
  };
}

// リポジトリにある worktree の一覧
async function listWorktrees(repo) {
  const out = await git(repo, ['worktree', 'list', '--porcelain']);
  const list = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) list.push((cur = { path: line.slice(9), branch: null, head: null, detached: false, main: list.length === 0 }));
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
  }
  return list;
}

module.exports = {
  worktreeStatus,
  listWorktrees,
  git,
  toplevel,
  currentBranch,
  revParse,
  branches,
  addWorktree,
  removeWorktree,
  deleteBranch,
  isDirty,
  commitAll,
  countCommits,
  merge,
  branchExists,
  checkBranchName,
  createBranch,
  worktreeForBranch,
  addWorktreeForBranch,
  diff,
};
