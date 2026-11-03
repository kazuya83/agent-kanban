// GitHub Issue を読み込んで、Claude への指示にする
// 1. gh コマンドがあれば使う（gh auth login 済みなら private リポジトリも読める）
// 2. gh がない・ログインしていないときは GitHub REST API（public リポジトリのみ。環境変数 GH_TOKEN があれば使う）
//    画面では gh のインストールとログインを案内する
const { execFile } = require('child_process');
const { git } = require('./git');
const { resolveCommand } = require('./env');

function execFileP(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

// https://github.com/owner/repo(.git) / git@github.com:owner/repo(.git) / ssh://git@github.com/owner/repo
function parseGithubRemote(url) {
  const m = String(url || '').trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function repoSlug(repoPath) {
  let url = '';
  try {
    url = await git(repoPath, ['remote', 'get-url', 'origin']);
  } catch {
    throw new Error('このリポジトリに origin がありません。GitHub のリポジトリを origin に設定してください');
  }
  const slug = parseGithubRemote(url);
  if (!slug) throw new Error(`origin が GitHub のリポジトリではありません（${url.trim()}）`);
  return slug;
}

function parseIssueNumbers(text) {
  const nums = String(text || '')
    .split(/[\s,、]+/)
    .map((s) => s.trim().replace(/^#/, ''))
    .filter(Boolean);
  const bad = nums.filter((n) => !/^\d+$/.test(n));
  if (bad.length) throw new Error(`Issue 番号として読めません: ${bad.join(', ')}`);
  const list = [...new Set(nums.map(Number))].filter((n) => n > 0);
  if (!list.length) throw new Error('Issue 番号を入力してください（例: 12 または 12, 15）');
  return list;
}

async function viaGh(gh, repoPath, slug, number) {
  const out = await execFileP(
    gh,
    ['issue', 'view', String(number), '--repo', `${slug.owner}/${slug.repo}`, '--json', 'number,title,body,url,state,labels,comments'],
    { cwd: repoPath },
  );
  const d = JSON.parse(out);
  return {
    number: d.number,
    title: d.title || '',
    body: d.body || '',
    url: d.url,
    state: String(d.state || '').toLowerCase(),
    labels: (d.labels || []).map((l) => l.name),
    comments: (d.comments || []).map((c) => ({ author: (c.author && c.author.login) || '', body: c.body || '' })),
  };
}

async function viaApi(slug, number, token) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-agent-kanban' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const base = `https://api.github.com/repos/${slug.owner}/${slug.repo}`;
  const res = await fetch(`${base}/issues/${number}`, { headers });
  if (res.status === 404) {
    throw new Error(
      token
        ? `Issue #${number} が見つかりません（${slug.owner}/${slug.repo}）`
        : `Issue #${number} が見つかりません。private リポジトリの場合は、gh をインストールして GitHub にログインしてください（「Issue から」の画面からできます）`,
    );
  }
  if (res.status === 401) throw new Error('GitHub トークンが正しくありません');
  if (res.status === 403) throw new Error('GitHub API の利用制限に達しました。gh をインストールして GitHub にログインしてください（「Issue から」の画面からできます）');
  if (!res.ok) throw new Error(`GitHub API がエラーを返しました（${res.status}）`);
  const d = await res.json();
  let comments = [];
  if (d.comments > 0) {
    const cr = await fetch(`${base}/issues/${number}/comments?per_page=100`, { headers });
    if (cr.ok) comments = (await cr.json()).map((c) => ({ author: (c.user && c.user.login) || '', body: c.body || '' }));
  }
  return {
    number: d.number,
    title: d.title || '',
    body: d.body || '',
    url: d.html_url,
    state: d.state,
    labels: (d.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    comments,
    isPullRequest: !!d.pull_request,
  };
}

/**
 * @param {string} repoPath
 * @param {number} number
 * @param {{ token?: string }} opts
 */
async function fetchIssue(repoPath, number, opts = {}) {
  const slug = await repoSlug(repoPath);
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const gh = resolveCommand('gh');
  let ghError = null;
  if (gh) {
    try {
      return { ...(await viaGh(gh, repoPath, slug, number)), slug };
    } catch (err) {
      ghError = err;
    }
  }
  try {
    return { ...(await viaApi(slug, number, token)), slug };
  } catch (err) {
    // gh も API もだめなら、gh のエラーのほうが原因に近いことが多いので添える
    if (ghError && ghError.stderr) err.message += `\n（gh のエラー: ${String(ghError.stderr).trim().split('\n')[0]}）`;
    throw err;
  }
}

function clip(s, n) {
  s = String(s || '').trim();
  return s.length > n ? `${s.slice(0, n)}\n…（長いので省略）` : s;
}

// Issue から Claude への指示を作る
function buildIssuePrompt(issue, extra) {
  const lines = [
    `GitHub の Issue #${issue.number} を解決してください。`,
    '',
    `タイトル: ${issue.title}`,
    `URL: ${issue.url}`,
  ];
  if (issue.labels && issue.labels.length) lines.push(`ラベル: ${issue.labels.join(', ')}`);
  lines.push('', '## 本文', clip(issue.body, 20000) || '（本文なし）');
  const comments = (issue.comments || []).slice(-20);
  if (comments.length) {
    lines.push('', '## コメント');
    for (const c of comments) lines.push('', `### @${c.author}`, clip(c.body, 3000));
  }
  if (extra && extra.trim()) lines.push('', '## 追加の指示', extra.trim());
  lines.push(
    '',
    '## 進め方',
    '- まずリポジトリのコードを読んで、Issue の内容と原因を理解してください',
    '- 必要な変更を行い、テストがあれば実行して確かめてください',
    '- 最後に、何をどう変えたかを短くまとめてください',
  );
  return lines.join('\n');
}

module.exports = { parseGithubRemote, parseIssueNumbers, repoSlug, fetchIssue, buildIssuePrompt };
