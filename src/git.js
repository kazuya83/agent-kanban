// git コマンドの薄いラッパー
const { execFile } = require('child_process');
const fs = require('fs');
const wsl = require('./wsl');
const I18n = require('../renderer/i18n');
const { tr } = I18n;

// 画面のボタン「マージ」とは別の文。ボタンは Merge、ここは文の中に入れる操作名
function mergeOperationName() {
  return I18n.getLanguage() === 'ja' ? 'マージ' : tr('文中の操作名（マージ）');
}

function git(cwd, args, { allowExitCodes = [], network = false, timeout } = {}) {
  return new Promise((resolve, reject) => {
    // ネットワークを使うときは、パスワード入力を待って止まらないようにする（認証はキーチェーンや SSH の設定を使う）
    const env = network ? { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } : process.env;
    // WSL のフォルダなら、git は WSL の中で動かす（パスは Linux の形にして渡す）
    let file = 'git';
    let argv = args;
    let opts = { cwd, env, maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: timeout ?? (network ? 120000 : 0) };
    const w = wsl.parseWslPath(cwd);
    if (w) {
      const c = wsl.command(w.distro, w.linux, 'git', args.map((a) => (wsl.isWslPath(a) ? wsl.toLinux(a) : a)), {
        env: network ? { GIT_TERMINAL_PROMPT: '0' } : {},
      });
      file = c.file;
      argv = c.args;
      opts = { ...opts, cwd: undefined };
    }
    execFile(file, argv, opts, (err, stdout, stderr) => {
      if (err) {
        if (typeof err.code === 'number' && allowExitCodes.includes(err.code)) return resolve(stdout);
        const e = new Error(tr('git {v} に失敗しました: {v2}', { v: args.join(' '), v2: (stderr || err.message).trim() }));
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
    return wsl.fromLinux(dir, (await git(dir, ['rev-parse', '--show-toplevel'])).trim());
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
    throw new Error(tr('{ref} が見つかりません（リポジトリにコミットが1つもない可能性があります）', { ref }));
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
  return ['-c', 'user.name=Agent Kanban', '-c', 'user.email=agent-kanban@localhost'];
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

async function isDirty(repo, { untracked = false } = {}) {
  const out = await git(repo, ['status', '--porcelain', untracked ? '--untracked-files=normal' : '--untracked-files=no']);
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
    const files = await conflictFiles(cwd).catch(() => []);
    await git(cwd, ['merge', '--abort']).catch(() => {});
    if (files.length) {
      const e = new Error(tr('{v} へのマージでコンフリクトが起きたため、マージを中止しました（{v2}）', { v: target || tr('マージ先'), v2: files.join(', ') }));
      e.conflictFiles = files;
      throw e;
    }
    throw err;
  }
}

// ---------- コンフリクト ----------

async function conflictFiles(dir) {
  const out = await git(dir, ['diff', '--name-only', '--diff-filter=U']);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function mergeInProgress(dir) {
  try {
    await git(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    return true;
  } catch {
    return false;
  }
}

// dir（タスクの worktree）に ref を取り込み始める。コンフリクトしたら途中の状態のまま、そのファイルを返す
async function startMerge(dir, ref) {
  await git(dir, [...(await identityArgs(dir)), 'merge', '--no-ff', '--no-commit', ref], { allowExitCodes: [1] });
  return conflictFiles(dir);
}

// <<<<<<< などの印が残っているファイル
async function filesWithMarkers(dir, files) {
  if (!files || !files.length) return [];
  const out = await git(dir, ['grep', '-l', '-E', '^(<<<<<<<|>>>>>>>)( |$)', '--', ...files], { allowExitCodes: [1] }).catch(() => '');
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function finishMerge(dir) {
  await git(dir, ['add', '-A']);
  await git(dir, [...(await identityArgs(dir)), 'commit', '-q', '--no-edit']);
}

async function abortMerge(dir) {
  await git(dir, ['merge', '--abort']);
}

async function branchExists(repo, name) {
  try {
    await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
    return true;
  } catch {
    return false;
  }
}

// 外から受け取ったブランチ名を git / gh の引数に渡す前に確かめる。
// 「-」で始まる名前はオプションとして解釈されてしまう（引数インジェクション）ので受け付けない
function assertSafeRef(name, label = tr('ブランチ名')) {
  const s = String(name ?? '');
  if (!s || s.startsWith('-') || /[\x00-\x20\x7f~^:?*[\\]/.test(s) || s.includes('..') || s.includes('@{')) {
    throw new Error(tr('「{s}」は{label}に使えません', { s, label }));
  }
  return s;
}

async function checkBranchName(repo, name) {
  assertSafeRef(name);
  try {
    await git(repo, ['check-ref-format', '--branch', name]);
  } catch {
    throw new Error(tr('「{name}」はブランチ名に使えません', { name }));
  }
}

async function createBranch(repo, name, startPoint) {
  await git(repo, ['branch', name, startPoint]);
}

// branch をチェックアウトしている worktree のパス（なければ null）
async function worktreeForBranch(repo, branch) {
  const want = `refs/heads/${branch}`;
  const out = await git(repo, ['worktree', 'list', '--porcelain']).catch(() => '');
  let current = null;
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (line.startsWith('worktree ')) current = wsl.fromLinux(repo, line.slice('worktree '.length).trim());
    else if (line.startsWith('branch ') && line.slice('branch '.length).trim() === want) return current;
  }
  // 念のため、メインのフォルダの HEAD も見る
  const head = (await git(repo, ['symbolic-ref', '-q', 'HEAD']).catch(() => '')).trim();
  if (head === want) return (await toplevel(repo)) || repo;
  return null;
}

// worktree add で「そのブランチは <フォルダ> で使われています」と断られたときの、そのフォルダ
function checkedOutAtFromError(err, repo) {
  const m = String((err && err.message) || '').match(/(?:already used by worktree at|already checked out at|is already checked out at) '([^']+)'/);
  return m ? wsl.fromLinux(repo, m[1]) : null;
}

// そのフォルダで rebase / マージ / cherry-pick などが途中か
async function operationInProgress(dir) {
  const fs = require('fs');
  const path = require('path');
  const checks = [
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['MERGE_HEAD', mergeOperationName()],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['BISECT_LOG', 'bisect'],
  ];
  for (const [name, label] of checks) {
    const p = wsl.fromLinux(dir, (await git(dir, ['rev-parse', '--git-path', name]).catch(() => '')).trim());
    if (p && fs.existsSync(path.isAbsolute(p) ? p : path.join(dir, p))) return label;
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
  let out = await git(wt, [...Q, 'diff', baseCommit]);
  const untracked = (await git(wt, [...Q, 'ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .filter(Boolean);
  for (const file of untracked.slice(0, 200)) {
    out += await git(wt, [...Q, 'diff', '--no-index', '--', '/dev/null', file], { allowExitCodes: [1] }).catch(() => '');
  }
  return out;
}

// ---------- リモート（origin） ----------

async function hasRemote(repo, remote = 'origin') {
  const out = await git(repo, ['remote']).catch(() => '');
  return out.split('\n').map((s) => s.trim()).includes(remote);
}

// origin が GitHub のリポジトリか（origin がない・ほかのサービスなら false）。github.com と GitHub Enterprise（ホスト名に github を含む）
async function isGitHubRemote(repo, remote = 'origin') {
  if (!(await hasRemote(repo, remote))) return false;
  const url = (await git(repo, ['remote', 'get-url', remote]).catch(() => '')).trim();
  return isGitHubUrl(url);
}

function isGitHubUrl(url) {
  const m = String(url || '').trim().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]+@)?([^/:]+)/i);
  return !!m && /github/i.test(m[1]);
}

// remote の branch を取ってくる。remote にそのブランチがなければ false
async function fetchBranch(repo, remote, branch) {
  const heads = await git(repo, ['ls-remote', '--heads', remote, branch], { network: true });
  if (!heads.trim()) return false;
  await git(repo, ['fetch', '--no-tags', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], { network: true });
  return true;
}

async function push(repo, remote, branch, setUpstream) {
  await git(repo, ['push', ...(setUpstream ? ['-u'] : []), remote, `refs/heads/${branch}:refs/heads/${branch}`], { network: true });
}

// ローカルのブランチを、remote のブランチまで早送りする（チェックアウト中ならそのフォルダで）
async function fastForward(repo, branch, toRef, checkedOutDir) {
  if (checkedOutDir) await git(checkedOutDir, ['merge', '--ff-only', toRef]);
  else await git(repo, ['fetch', '-q', '.', `${toRef}:refs/heads/${branch}`]);
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
    if (line.startsWith('worktree ')) list.push((cur = { path: wsl.fromLinux(repo, line.slice(9)), branch: null, head: null, detached: false, main: list.length === 0 }));
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
  checkedOutAtFromError,
  operationInProgress,
  conflictFiles,
  mergeInProgress,
  startMerge,
  filesWithMarkers,
  finishMerge,
  abortMerge,
  hasRemote,
  isGitHubRemote,
  isGitHubUrl,
  fetchBranch,
  push,
  fastForward,
  git,
  toplevel,
  currentBranch,
  revParse,
  branches,
  addWorktree,
  removeWorktree,
  deleteBranch,
  isDirty,
  identityArgs,
  commitAll,
  countCommits,
  merge,
  branchExists,
  checkBranchName,
  assertSafeRef,
  createBranch,
  worktreeForBranch,
  addWorktreeForBranch,
  diff,
};
