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

async function merge(repo, branch, message) {
  try {
    await git(repo, [...(await identityArgs(repo)), 'merge', '--no-ff', '-m', message, branch]);
  } catch (err) {
    await git(repo, ['merge', '--abort']).catch(() => {});
    throw new Error(`マージでコンフリクトが起きたため中止しました。追加指示で ${branch} を最新のベースに合わせるよう頼むか、手動でマージしてください。\n${err.message}`);
  }
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
  diff,
};
