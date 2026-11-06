// GitHub Issue を読み込んで、エージェントへの指示にする
// 1. gh コマンドがあれば使う（gh auth login 済みなら private リポジトリも読める）
// 2. gh がない・ログインしていないときは GitHub REST API（public リポジトリのみ。環境変数 GH_TOKEN があれば使う）
//    画面では gh のインストールとログインを案内する
const { execFile } = require('child_process');
const { git } = require('./git');
const { resolveCommand } = require('./env');
const { tr } = require('../renderer/i18n');

function execFileP(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    // WSL のフォルダを作業フォルダにすると、gh が Windows の git でそのフォルダを調べて止まるので、使わない
    if (opts && opts.cwd && require('./wsl').isWslPath(opts.cwd)) opts = { ...opts, cwd: undefined };
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
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
    throw new Error(tr('このリポジトリに origin がありません。GitHub のリポジトリを origin に設定してください'));
  }
  const slug = parseGithubRemote(url);
  if (!slug) throw new Error(tr('origin が GitHub のリポジトリではありません（{v}）', { v: url.trim() }));
  return slug;
}

function parseIssueNumbers(text) {
  const nums = String(text || '')
    .split(/[\s,、]+/)
    .map((s) => s.trim().replace(/^#/, ''))
    .filter(Boolean);
  const bad = nums.filter((n) => !/^\d+$/.test(n));
  if (bad.length) throw new Error(tr('Issue 番号として読めません: {v}', { v: bad.join(', ') }));
  const list = [...new Set(nums.map(Number))].filter((n) => n > 0);
  if (!list.length) throw new Error(tr('Issue 番号を入力してください（例: 12 または 12, 15）'));
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
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'worktree-kanban' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const base = `https://api.github.com/repos/${slug.owner}/${slug.repo}`;
  const res = await fetch(`${base}/issues/${number}`, { headers });
  if (res.status === 404) {
    throw new Error(
      token
        ? tr('Issue #{number} が見つかりません（{owner}/{repo}）', { number, owner: slug.owner, repo: slug.repo })
        : tr('Issue #{number} が見つかりません。private リポジトリの場合は、gh をインストールして GitHub にログインしてください（「Issue から」の画面からできます）', { number }),
    );
  }
  if (res.status === 401) throw new Error(tr('GitHub トークンが正しくありません'));
  if (res.status === 403) throw new Error(tr('GitHub API の利用制限に達しました。gh をインストールして GitHub にログインしてください（「Issue から」の画面からできます）'));
  if (!res.ok) throw new Error(tr('GitHub API がエラーを返しました（{status}）', { status: res.status }));
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

const ISSUE_LIST_LIMIT = 200; // 新しい順にこの件数まで読む

async function listViaGh(gh, repoPath, slug, { labels, author }) {
  const args = ['issue', 'list', '--repo', `${slug.owner}/${slug.repo}`, '--state', 'open', '--limit', String(ISSUE_LIST_LIMIT), '--json', 'number,title,url,createdAt'];
  for (const l of labels) args.push('--label', l);
  if (author) args.push('--author', author);
  const out = await execFileP(gh, args, { cwd: repoPath });
  return JSON.parse(out).map((d) => ({ number: d.number, title: d.title || '', url: d.url, createdAt: Date.parse(d.createdAt) }));
}

async function listViaApi(slug, { labels, author }, token) {
  if (author === '@me') throw new Error(tr('作成者の @me を使うには、gh をインストールして GitHub にログインしてください（「Issue から」の画面からできます）'));
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'worktree-kanban' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const query = new URLSearchParams({ state: 'open', sort: 'created', direction: 'desc', per_page: '100' });
  if (labels.length) query.set('labels', labels.join(','));
  if (author) query.set('creator', author);
  const res = await fetch(`https://api.github.com/repos/${slug.owner}/${slug.repo}/issues?${query}`, { headers });
  if (res.status === 404) throw new Error(tr('{owner}/{repo} の Issue を読めません。private リポジトリの場合は、gh をインストールして GitHub にログインしてください（「Issue から」の画面からできます）', { owner: slug.owner, repo: slug.repo }));
  if (res.status === 401) throw new Error(tr('GitHub トークンが正しくありません'));
  if (res.status === 403) throw new Error(tr('GitHub API の利用制限に達しました。gh をインストールして GitHub にログインしてください（「Issue から」の画面からできます）'));
  if (!res.ok) throw new Error(tr('GitHub API がエラーを返しました（{status}）', { status: res.status }));
  return (await res.json())
    .filter((d) => !d.pull_request) // この API は PR も Issue として返す
    .map((d) => ({ number: d.number, title: d.title || '', url: d.html_url, createdAt: Date.parse(d.created_at) }));
}

// gh で読み、だめなら REST API で読む
async function viaGhOrApi(cli, rest) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const gh = resolveCommand('gh');
  let ghError = null;
  if (gh) {
    try {
      return await cli(gh);
    } catch (err) {
      ghError = err;
    }
  }
  try {
    return await rest(token);
  } catch (err) {
    // gh も API もだめなら、gh のエラーのほうが原因に近いことが多いので添える
    if (ghError && ghError.stderr) err.message += `\n${tr('（gh のエラー: {message}）', { message: String(ghError.stderr).trim().split('\n')[0] })}`;
    throw err;
  }
}

/**
 * 開いている Issue を、新しい順に読む（本文やコメントは読まない）
 * @param {string} repoPath
 * @param {{ labels?: string[], author?: string }} filter labels は全部付いているものだけ。author は作成者（@me も可）
 * @returns {Promise<{ number: number, title: string, url: string, createdAt: number }[]>}
 */
async function listIssues(repoPath, { labels = [], author = '' } = {}) {
  const slug = await repoSlug(repoPath);
  return viaGhOrApi((gh) => listViaGh(gh, repoPath, slug, { labels, author }), (token) => listViaApi(slug, { labels, author }, token));
}

/**
 * @param {string} repoPath
 * @param {number} number
 * @param {{ token?: string }} opts
 */
async function fetchIssue(repoPath, number, opts = {}) {
  const slug = await repoSlug(repoPath);
  return viaGhOrApi(async (gh) => ({ ...(await viaGh(gh, repoPath, slug, number)), slug }), async (token) => ({ ...(await viaApi(slug, number, token)), slug }));
}

function clip(s, n) {
  s = String(s || '').trim();
  return s.length > n ? `${s.slice(0, n)}\n…（長いので省略）` : s;
}

// Issue からエージェントへの指示を作る
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

// ---------- GitHub Projects のステータス ----------
// カードの列に合わせて、Issue が入っている Project の「Status」を In progress / In review / Done に変える

const PROJECT_STATUS = {
  inProgress: { label: 'In progress', names: ['inprogress', 'doing', 'wip', 'started', '進行中', '作業中', '対応中', '実行中'], partial: 'progress' },
  inReview: { label: 'In review', names: ['inreview', 'review', 'reviewing', 'needsreview', 'レビュー', 'レビュー中'], partial: 'review' },
  done: { label: 'Done', names: ['done', 'completed', 'complete', 'closed', 'finished', '完了', '済み'], partial: null },
};

// 「🏗 In Progress」「in-progress」なども同じ名前として扱う
function normalizeStatusName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// 設定の「列 → 選択肢の名前」を候補の配列にする（カンマ・改行区切りで複数書ける。空なら自動で探す）
function mappingNames(mapping) {
  if (Array.isArray(mapping)) return mapping.map(normalizeStatusName).filter(Boolean);
  return String(mapping || '')
    .split(/[,、\n]/)
    .map(normalizeStatusName)
    .filter(Boolean);
}

// Status の選択肢から、key（inProgress / inReview / done）に当たるものを選ぶ
// mapping（設定で指定した選択肢の名前）があれば、その名前の選択肢だけを選ぶ
function pickStatusOption(options, key, mapping) {
  const def = PROJECT_STATUS[key];
  if (!def || !Array.isArray(options)) return null;
  const list = options.map((o) => ({ ...o, norm: normalizeStatusName(o.name) }));
  const wanted = mappingNames(mapping);
  if (wanted.length) {
    for (const n of wanted) {
      const hit = list.find((o) => o.norm === n);
      if (hit) return { id: hit.id, name: hit.name };
    }
    return null;
  }
  for (const n of def.names) {
    const hit = list.find((o) => o.norm === n);
    if (hit) return { id: hit.id, name: hit.name };
  }
  if (def.partial) {
    const hit = list.find((o) => o.norm.includes(def.partial));
    if (hit) return { id: hit.id, name: hit.name };
  }
  return null;
}

const ITEMS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $field: String!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      projectItems(first: 20) {
        nodes {
          id
          project { id title closed field(name: $field) { ... on ProjectV2SingleSelectField { id options { id name } } } }
          fieldValueByName(name: $field) { ... on ProjectV2ItemFieldSingleSelectValue { name optionId } }
        }
      }
    }
  }
}`;

const UPDATE_MUTATION = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) {
    projectV2Item { id }
  }
}`;

function projectScopeMessage() {
  return tr('GitHub Projects のステータスを変えるには、gh に project の権限が必要です。設定の「Projects の権限を追加」を押すか、ターミナルで gh auth refresh -h github.com -s project を実行してください');
}

async function ghGraphql(gh, cwd, query, vars) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`);
  let out;
  try {
    out = await execFileP(gh, args, { cwd, timeout: 30000 });
  } catch (err) {
    const msg = `${err.stderr || ''}${err.stdout || ''}${err.message || ''}`;
    if (/INSUFFICIENT_SCOPES|read:project|'project'/i.test(msg)) {
      const e = new Error(projectScopeMessage());
      e.code = 'SCOPE';
      throw e;
    }
    if (/auth login|not logged/i.test(msg)) throw new Error(tr('GitHub にログインしていません。「Issue から」の画面からログインしてください'));
    throw new Error(tr('GitHub API がエラーを返しました: {message}', { message: String(err.stderr || err.message).trim().split('\n')[0] }));
  }
  const d = JSON.parse(out);
  if (d.errors && d.errors.length) {
    if (d.errors.some((e) => e.type === 'INSUFFICIENT_SCOPES')) {
      const e = new Error(projectScopeMessage());
      e.code = 'SCOPE';
      throw e;
    }
    throw new Error(tr('GitHub API がエラーを返しました: {v}', { v: d.errors[0].message }));
  }
  return d.data;
}

/**
 * Issue が入っているすべての Project（v2）で、Status を key に当たる選択肢に変える
 * @param {string} repoPath
 * @param {number} number
 * @param {'inProgress'|'inReview'|'done'} key
 * @param {{ gh?: string, fieldName?: string, mapping?: {inProgress?: string, inReview?: string, done?: string} }} opts
 *   fieldName: 変える項目（単一選択）の名前。空なら「Status」
 *   mapping: 列ごとに使う選択肢の名前（カンマ区切りで複数可）。空の列は名前から自動で探す
 * @returns {Promise<{ updated: {project: string, from: string, to: string}[], unchanged: {project: string, to: string}[], skipped: {project: string, reason: string}[], projects: number }>}
 */
async function setIssueProjectStatus(repoPath, number, key, opts = {}) {
  if (!PROJECT_STATUS[key]) throw new Error(tr('不明なステータスです: {key}', { key }));
  const gh = opts.gh || resolveCommand('gh');
  if (!gh) throw new Error(tr('Projects のステータスを変えるには GitHub CLI（gh）が必要です。「Issue から」の画面からインストールとログインができます'));
  const slug = await repoSlug(repoPath);
  const fieldName = String(opts.fieldName || '').trim() || 'Status';
  const mapping = (opts.mapping && opts.mapping[key]) || '';
  const data = await ghGraphql(gh, repoPath, ITEMS_QUERY, { owner: slug.owner, repo: slug.repo, number: Number(number), field: fieldName });
  const issue = data && data.repository && data.repository.issue;
  if (!issue) throw new Error(tr('Issue #{number} が見つかりません（{owner}/{repo}）', { number, owner: slug.owner, repo: slug.repo }));
  const items = (issue.projectItems && issue.projectItems.nodes) || [];
  const result = { updated: [], unchanged: [], skipped: [], projects: 0 };
  for (const item of items) {
    const p = item && item.project;
    if (!p || p.closed) continue;
    result.projects++;
    const field = p.field;
    if (!field || !field.id) {
      result.skipped.push({ project: p.title, reason: tr('「{field}」の項目（単一選択）がありません', { field: fieldName }) });
      continue;
    }
    const opt = pickStatusOption(field.options, key, mapping);
    if (!opt) {
      const reason = mappingNames(mapping).length
        ? tr('「{field}」に設定した選択肢「{mapping}」がありません（{label} 用）', { field: fieldName, mapping, label: PROJECT_STATUS[key].label })
        : tr('「{field}」に「{label}」に当たる選択肢がありません', { field: fieldName, label: PROJECT_STATUS[key].label });
      result.skipped.push({ project: p.title, reason });
      continue;
    }
    const cur = item.fieldValueByName || {};
    if (cur.optionId === opt.id) {
      result.unchanged.push({ project: p.title, to: opt.name });
      continue;
    }
    await ghGraphql(gh, repoPath, UPDATE_MUTATION, { projectId: p.id, itemId: item.id, fieldId: field.id, optionId: opt.id });
    result.updated.push({ project: p.title, from: cur.name || '', to: opt.name });
  }
  return result;
}

// ---------- サブIssue ----------

// Issue にぶら下がっているサブIssue（GitHub の sub-issues）。gh があれば gh api、なければ REST API（public のみ）
async function fetchSubIssues(repoPath, number) {
  const slug = await repoSlug(repoPath);
  const pathName = `repos/${slug.owner}/${slug.repo}/issues/${Number(number)}/sub_issues`;
  const gh = resolveCommand('gh');
  let list;
  if (gh) {
    const out = await execFileP(gh, ['api', '-H', 'Accept: application/vnd.github+json', `${pathName}?per_page=100`], { cwd: repoPath, timeout: 30000 });
    list = JSON.parse(out || '[]');
  } else {
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'worktree-kanban' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/${pathName}?per_page=100`, { headers });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(tr('サブIssue を読めませんでした（GitHub API {status}）', { status: res.status }));
    list = await res.json();
  }
  return (Array.isArray(list) ? list : [])
    .filter((d) => d && d.number && !d.pull_request)
    .map((d) => ({
      id: d.id,
      number: d.number,
      title: d.title || '',
      body: d.body || '',
      url: d.html_url || '',
      state: String(d.state || '').toLowerCase(),
      labels: (d.labels || []).map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean),
      comments: [],
    }));
}

/**
 * Issue を作って、parent のサブIssue にする（gh が必要）
 * @returns {Promise<{ number: number, title: string, url: string }>}
 */
async function createSubIssue(repoPath, parentNumber, { title, body }) {
  const gh = resolveCommand('gh');
  if (!gh) throw new Error(tr('サブIssue を作るには GitHub CLI（gh）が必要です。「Issue から」の画面からインストールとログインができます'));
  const slug = await repoSlug(repoPath);
  const base = `repos/${slug.owner}/${slug.repo}/issues`;
  const run = async (args) => {
    try {
      return JSON.parse((await execFileP(gh, args, { cwd: repoPath, timeout: 30000 })) || '{}');
    } catch (err) {
      throw new Error(tr('GitHub がエラーを返しました: {message}', { message: String(err.stderr || err.message).trim().split('\n')[0] }));
    }
  };
  const issue = await run(['api', '-X', 'POST', base, '-f', `title=${String(title || '').slice(0, 250)}`, '-f', `body=${String(body || '')}`]);
  if (!issue.number) throw new Error(tr('Issue を作れませんでした'));
  await run(['api', '-X', 'POST', `${base}/${Number(parentNumber)}/sub_issues`, '-F', `sub_issue_id=${issue.id}`]);
  return { number: issue.number, title: issue.title || title, url: issue.html_url || '' };
}

module.exports = {
  fetchSubIssues,
  createSubIssue,
  parseGithubRemote,
  parseIssueNumbers,
  repoSlug,
  fetchIssue,
  listIssues,
  buildIssuePrompt,
  PROJECT_STATUS,
  normalizeStatusName,
  pickStatusOption,
  setIssueProjectStatus,
};
