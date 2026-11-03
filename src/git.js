// git コマンドの薄いラッパー
const { execFile } = require('child_process');
const fs = require('fs');

function git(cwd, args, { allowExitCodes = [], network = false } = {}) {
  return new Promise((resolve, reject) => {
    // ネットワークを使うときは、パスワード入力を待って止まらないようにする（認証はキーチェーンや SSH の設定を使う）
    const env = network ? { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } : process.env;
    execFile('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: network ? 120000 : 0 }, (err, stdout, stderr) => {
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
    const files = await conflictFiles(cwd).catch(() => []);
    await git(cwd, ['merge', '--abort']).catch(() => {});
    if (files.length) {
      const e = new Error(`${target || 'マージ先'} へのマージでコンフリクトが起きたため、マージを中止しました（${files.join(', ')}）`);
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
  const want = `refs/heads/${branch}`;
  const out = await git(repo, ['worktree', 'list', '--porcelain']).catch(() => '');
  let current = null;
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length).trim();
    else if (line.startsWith('branch ') && line.slice('branch '.length).trim() === want) return current;
  }
  // 念のため、メインのフォルダの HEAD も見る
  const head = (await git(repo, ['symbolic-ref', '-q', 'HEAD']).catch(() => '')).trim();
  if (head === want) return (await toplevel(repo)) || repo;
  return null;
}

// worktree add で「そのブランチは <フォルダ> で使われています」と断られたときの、そのフォルダ
function checkedOutAtFromError(err) {
  const m = String((err && err.message) || '').match(/(?:already used by worktree at|already checked out at|is already checked out at) '([^']+)'/);
  return m ? m[1] : null;
}

// そのフォルダで rebase / マージ / cherry-pick などが途中か
async function operationInProgress(dir) {
  const fs = require('fs');
  const path = require('path');
  const checks = [
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['MERGE_HEAD', 'マージ'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['BISECT_LOG', 'bisect'],
  ];
  for (const [name, label] of checks) {
    const p = (await git(dir, ['rev-parse', '--git-path', name]).catch(() => '')).trim();
    if (p && fs.existsSync(path.isAbsolute(p) ? p : path.join(dir, p))) return label;
  }
  return null;
}

async function addWorktreeForBranch(repo, wtPath, branch) {
  await git(repo, ['worktree', 'add', wtPath, branch]);
}

// ベースコミットからの差分（コミット済み＋未コミット＋未追跡ファイル）
// index を触らないので、エージェントの実行中に呼んでも安全
async function diff(wt, baseCommit) {
  let out = await git(wt, ['diff', baseCommit]);
  const untracked = (await git(wt, ['ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .filter(Boolean);
  for (const file of untracked.slice(0, 200)) {
    out += await git(wt, ['diff', '--no-index', '--', '/dev/null', file], { allowExitCodes: [1] }).catch(() => '');
  }
  return out;
}

// ---------- リモート（origin） ----------

async function hasRemote(repo, remote = 'origin') {
  const out = await git(repo, ['remote']).catch(() => '');
  return out.split('\n').map((s) => s.trim()).includes(remote);
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

module.exports = {
  checkedOutAtFromError,
  operationInProgress,
  conflictFiles,
  mergeInProgress,
  startMerge,
  filesWithMarkers,
  finishMerge,
  abortMerge,
  hasRemote,
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
