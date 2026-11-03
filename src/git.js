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

module.exports = {
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
