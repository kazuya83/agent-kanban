// GitLab のプロバイダ。REST API v4 を使う（Work Items だけは REST に無いので GraphQL）。glab には依存しない。
// 認証は Personal Access Token（設定の「連携」で入れる）。接続先は変えられるので、セルフホストでも動く。
//
// Issue の key: origin のプロジェクトの Issue は #12、ほかのプロジェクトの Issue は group/project#12（GitLab の参照の書き方）。
// c.issue には key しか残らないので、どのプロジェクトの Issue かは key から読む。
const git = require('../git');
const { tr } = require('../../renderer/i18n');
const { HttpError, request, joinUrl, redact } = require('./http');

const LABEL = 'GitLab';
const DEFAULT_URL = 'https://gitlab.com';
const MAX_TITLE = 255; // GitLab の Issue と MR のタイトルの上限

const lower = (s) => String(s || '').toLowerCase();
const trimPath = (s) => String(s || '').replace(/^\/+|\/+$/g, '');
const projectId = (project) => encodeURIComponent(project);
const clipTitle = (title) => String(title || '').slice(0, MAX_TITLE);

function baseParts(baseUrl) {
  const u = new URL(baseUrl || DEFAULT_URL);
  return { host: u.host, hostname: u.hostname.toLowerCase(), root: trimPath(u.pathname) };
}

// サブパスにインストールしたセルフホスト（https://example.com/gitlab）のパスを除く
function stripRoot(pathName, root) {
  const p = trimPath(pathName);
  return root && lower(p).startsWith(`${lower(root)}/`) ? p.slice(root.length + 1) : p;
}

/**
 * origin の URL から、GitLab のプロジェクトを読む。設定の接続先と違うホストなら null（ポートは見ない。SSH と Web で違うため）
 * https://gitlab.com/group/sub/project(.git) / git@gitlab.com:group/sub/project(.git) / ssh://git@gitlab.example.com:2222/group/project.git
 * @returns {{ host: string, path: string }|null} path は group/sub/project
 */
function parseGitlabRemote(url, baseUrl = DEFAULT_URL) {
  const s = String(url || '').trim();
  let host;
  let pathName;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      host = u.hostname;
      pathName = u.pathname;
    } catch {
      return null;
    }
  } else {
    const m = s.match(/^(?:[^@/\s]+@)?([^/:\s]+):(.+)$/);
    if (!m) return null;
    [, host, pathName] = m;
  }
  const base = baseParts(baseUrl);
  if (lower(host) !== base.hostname) return null;
  const project = stripRoot(pathName, base.root).replace(/\.git$/i, '');
  return project.split('/').filter(Boolean).length >= 2 ? { host: lower(host), path: project } : null;
}

// Web の URL の、接続先より後ろのパス。別のサーバーの URL なら null
function webPath(url, baseUrl) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const base = baseParts(baseUrl);
  if (u.host.toLowerCase() !== base.host.toLowerCase()) return null;
  return stripRoot(u.pathname, base.root);
}

// 12 / #12 / group/project#12 / Issue の URL。読めなければ null
function parseIssueToken(text, baseUrl) {
  const s = String(text || '').trim();
  let m = s.match(/^#?(\d+)$/);
  if (m) return { iid: Number(m[1]) };
  m = s.match(/^([\w.-]+(?:\/[\w.-]+)+)#(\d+)$/);
  if (m) return { project: m[1], iid: Number(m[2]) };
  if (!/^https?:\/\//i.test(s)) return null;
  m = String(webPath(s, baseUrl) || '').match(/^(.+)\/-\/(?:issues|work_items)\/(?:incident\/)?(\d+)$/);
  return m ? { project: m[1], iid: Number(m[2]) } : null;
}

// MR の URL から、プロジェクトと番号を読む。別のサーバーの URL なら null
function parseMergeRequestUrl(url, baseUrl) {
  const m = String(webPath(url, baseUrl) || '').match(/^(.+)\/-\/merge_requests\/(\d+)$/);
  return m ? { project: m[1], iid: Number(m[2]) } : null;
}

function tokenOf(ctx) {
  const token = ctx.secret('token');
  if (!token) throw new Error(tr('GitLab のトークンが設定されていません。設定の「連携」で入れてください'));
  return token;
}

async function api(ctx, pathName, opts = {}) {
  const token = tokenOf(ctx);
  const r = await request(joinUrl(ctx.config.baseUrl, `api/v4/${pathName}`), { ...opts, headers: { 'PRIVATE-TOKEN': token }, secrets: [token], label: LABEL });
  return r.data;
}

async function originProject(ctx) {
  const url = await git.git(ctx.repoPath, ['remote', 'get-url', 'origin']).catch(() => '');
  if (!String(url).trim()) throw new Error(tr('このリポジトリに origin がありません。GitLab のリポジトリを origin に設定してください'));
  const hit = parseGitlabRemote(url, ctx.config.baseUrl);
  // origin の URL にはパスワードが入っていることがあるので、文に入れない
  if (!hit) throw new Error(tr('origin が {host} のリポジトリではありません。設定の「連携」の接続先を確かめてください', { host: baseParts(ctx.config.baseUrl).host }));
  return hit.path;
}

// ref がどのプロジェクトの何番か。prefix: key の # より前（origin のプロジェクトなら空）
async function locate(ctx, ref) {
  const m = String((ref && ref.key) || '').match(/^(.*)#(\d+)$/);
  const prefix = m ? m[1] : '';
  const iid = Number((ref && ref.number) || (m && m[2]));
  return { prefix, iid, project: prefix || (await originProject(ctx)) };
}

const keyOf = (at, iid) => `${at.prefix}#${iid}`;
const issuePath = (at) => `projects/${projectId(at.project)}/issues/${at.iid}`;
const issueUrl = (ctx, at, iid) => joinUrl(ctx.config.baseUrl, `${at.project}/-/issues/${iid}`);

function toIssue(d, at) {
  return {
    id: d.id,
    number: d.iid,
    key: keyOf(at, d.iid),
    title: d.title || '',
    body: d.description || '',
    url: d.web_url || '',
    state: d.state === 'closed' ? 'closed' : 'open',
    labels: (d.labels || []).map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean),
  };
}

// 新しい順に取って古い順に戻す（コメントが多いときは、新しいほうを渡すため）。システムノートは除く
async function fetchComments(ctx, at) {
  const notes = await api(ctx, `${issuePath(at)}/notes`, { query: { per_page: 100, order_by: 'created_at', sort: 'desc' } });
  return (Array.isArray(notes) ? notes : [])
    .filter((n) => n && !n.system)
    .reverse()
    .map((n) => ({ author: (n.author && n.author.username) || '', body: n.body || '' }));
}

// ---------- 状態 ----------

const DEFAULT_LABELS = { inProgress: 'In progress', inReview: 'In review', done: 'Done' };

// プロジェクトの設定の「列 → 名前」（statusMapping）を、ラベルの名前にする。空の列は既定の名前
function statusLabels(settings) {
  const mapping = (settings && settings.statusMapping) || {};
  const out = {};
  for (const [key, label] of Object.entries(DEFAULT_LABELS)) out[key] = String(mapping[key] || '').split(/[,、\n]/)[0].trim() || label;
  return out;
}

// ---------- Work Items（GraphQL） ----------

class WorkItemsUnavailable extends Error {}

const WORK_ITEM_QUERY = `query($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    workItems(iid: $iid, first: 1) {
      nodes {
        id
        widgets {
          ... on WorkItemWidgetHierarchy {
            children(first: 100) {
              nodes {
                iid
                title
                state
                widgets { ... on WorkItemWidgetDescription { description } }
              }
            }
          }
        }
      }
    }
    workItemTypes(name: TASK) { nodes { id } }
  }
}`;

const CREATE_WORK_ITEM = `mutation($input: WorkItemCreateInput!) {
  workItemCreate(input: $input) {
    errors
    workItem { iid title }
  }
}`;

// 認証の失敗やタイムアウトはそのまま投げる（作れたのに関連 Issue も作ってしまわないように）。
// GraphQL が無い・項目を知らない古い版は WorkItemsUnavailable にする
async function graphql(ctx, query, variables) {
  const token = tokenOf(ctx);
  let r;
  try {
    r = await request(joinUrl(ctx.config.baseUrl, 'api/graphql'), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, json: { query, variables }, secrets: [token], label: LABEL });
  } catch (err) {
    if (err instanceof HttpError && [400, 404].includes(err.status)) throw new WorkItemsUnavailable();
    throw err;
  }
  const d = r.data || {};
  if ((d.errors && d.errors.length) || !d.data) throw new WorkItemsUnavailable();
  return d.data;
}

async function loadWorkItem(ctx, at) {
  const data = await graphql(ctx, WORK_ITEM_QUERY, { path: at.project, iid: String(at.iid) });
  const project = data.project;
  const item = project && project.workItems && project.workItems.nodes && project.workItems.nodes[0];
  const hierarchy = item && (item.widgets || []).find((w) => w && w.children);
  if (!hierarchy) throw new WorkItemsUnavailable();
  const type = project.workItemTypes && project.workItemTypes.nodes && project.workItemTypes.nodes[0];
  return { id: item.id, children: hierarchy.children.nodes || [], taskTypeId: type ? type.id : null };
}

// Work Items が使えるあいだは work、使えない版では fallback
async function withWorkItems(work, fallback) {
  try {
    return await work();
  } catch (err) {
    if (!(err instanceof WorkItemsUnavailable)) throw err;
  }
  return fallback();
}

function childIssue(ctx, at, x) {
  const desc = (x.widgets || []).find((w) => w && typeof w.description === 'string');
  const iid = Number(x.iid);
  return { number: iid, key: keyOf(at, iid), title: x.title || '', body: desc ? desc.description : '', url: issueUrl(ctx, at, iid), state: lower(x.state) === 'closed' ? 'closed' : 'open', labels: [], comments: [] };
}

// 関連 Issue（Work Items が使えない版のサブIssue）。別のプロジェクトの Issue は key に full path を入れる
async function fetchLinkedIssues(ctx, at) {
  const list = await api(ctx, `${issuePath(at)}/links`, { query: { per_page: 100 } });
  return (Array.isArray(list) ? list : [])
    .filter((d) => d && d.iid && (!d.link_type || d.link_type === 'relates_to'))
    .map((d) => {
      const full = String((d.references && d.references.full) || '').replace(/#\d+$/, '');
      const other = full && lower(full) !== lower(at.project);
      return { ...toIssue(d, { prefix: other ? full : at.prefix }), comments: [] };
    });
}

async function createLinkedIssue(ctx, at, { title, body }) {
  const made = await api(ctx, `projects/${projectId(at.project)}/issues`, { method: 'POST', json: { title: clipTitle(title), description: String(body || '') } });
  await api(ctx, `${issuePath(at)}/links`, { method: 'POST', json: { target_project_id: made.project_id, target_issue_iid: made.iid } });
  return { number: made.iid, key: keyOf(at, made.iid), title: made.title || title, url: made.web_url || '' };
}

// ---------- MR ----------

const MR_STATE = { opened: 'OPEN', locked: 'OPEN', merged: 'MERGED', closed: 'CLOSED' };
// GitLab がまだ計算しているあいだの状態
const MERGE_CHECKING = ['checking', 'unchecked', 'cannot_be_merged_recheck', 'preparing', 'approvals_syncing'];

function mergeableOf(d) {
  const st = d.detailed_merge_status || d.merge_status;
  if (MERGE_CHECKING.includes(st)) return 'UNKNOWN';
  return d.has_conflicts || st === 'conflict' ? 'CONFLICTING' : 'MERGEABLE';
}

const PIPELINE_STATE = { success: 'SUCCESS', skipped: 'SUCCESS', failed: 'FAILURE', canceled: 'ATTENTION', canceling: 'ATTENTION', manual: 'ATTENTION' };

// 失敗したジョブ。読めないときは、パイプライン全体を1件として出す（見張りは止めない）
async function failedJobs(ctx, project, pipeline) {
  const whole = [{ name: tr('パイプライン'), url: pipeline.web_url || null }];
  try {
    const jobs = await api(ctx, `projects/${projectId(pipeline.project_id || project)}/pipelines/${pipeline.id}/jobs`, { query: { 'scope[]': 'failed', per_page: 100 } });
    const failed = (Array.isArray(jobs) ? jobs : []).filter((j) => j && !j.allow_failure).map((j) => ({ name: j.name || '?', url: j.web_url || null }));
    return failed.length ? failed : whole;
  } catch {
    return whole;
  }
}

// head_pipeline を、gh.summarizeChecks と同じ形にする
async function pipelineChecks(ctx, project, pipeline, sha) {
  if (!pipeline) return { state: 'NONE', sha: sha || null, total: 0, passed: 0, pending: 0, failed: [] };
  const state = PIPELINE_STATE[pipeline.status] || 'PENDING';
  const failed = state === 'FAILURE' ? await failedJobs(ctx, project, pipeline) : [];
  return { state, sha: pipeline.sha || sha || null, total: Math.max(failed.length, 1), passed: state === 'SUCCESS' ? 1 : 0, pending: state === 'PENDING' ? 1 : 0, failed };
}

module.exports = {
  id: 'gitlab',
  label: LABEL,
  refPlaceholder: '例: 12 または Issue の URL',
  statusHelp: 'Issue から作ったタスクの列に合わせて、Issue のラベルを付け替えます。「完了」では Issue を閉じ、動き出したら開き直します。下の欄でラベルの名前を変えられます（空なら In progress / In review / Done）。ラベルが無ければ GitLab が作ります。',
  commentEvents: true,
  configFields: [
    { name: 'baseUrl', type: 'url', label: '接続先の URL', placeholder: DEFAULT_URL, default: DEFAULT_URL, required: true, allowHttpField: 'allowHttp', help: 'セルフホストの GitLab では、そのサーバーの URL を入れます。' },
    { name: 'allowHttp', type: 'checkbox', label: 'http の接続先を許可する（トークンが暗号化されずに流れます）', default: false },
    { name: 'token', type: 'secret', label: 'Personal Access Token', required: true, help: 'api のスコープを付けて作ってください。' },
  ],

  matchesRemote: (url, config) => !!parseGitlabRemote(url, config && config.baseUrl),

  // GitLab は本文の Closes で Issue を閉じられる。ほかのプロジェクトの Issue も group/project#12 で書ける
  linkLine: (ref) => `Closes ${ref.key}`,

  async testConnection(ctx) {
    const me = await api(ctx, 'user');
    return { ok: true, message: me && me.username ? tr('{user} として接続できました', { user: me.username }) : tr('接続できました') };
  },

  async parseRefs(ctx, text) {
    const tokens = String(text || '').split(/[\s,、]+/).filter(Boolean);
    const parsed = tokens.map((t) => parseIssueToken(t, ctx.config.baseUrl));
    const bad = tokens.filter((_, i) => !parsed[i] || !parsed[i].iid);
    if (bad.length) throw new Error(tr('Issue 番号として読めません: {v}', { v: redact(bad.join(', ')) }));
    if (!tokens.length) throw new Error(tr('Issue を入力してください'));
    // URL で書いた origin のプロジェクトの Issue も #12 にそろえる（同じ Issue はいつも同じ key にする）
    const needsOrigin = parsed.some((x) => !x.project);
    const origin = needsOrigin ? await originProject(ctx) : await originProject(ctx).catch(() => '');
    return parsed.map(({ project, iid }) => ({ number: iid, key: `${project && lower(project) !== lower(origin) ? project : ''}#${iid}` }));
  },

  async fetchIssue(ctx, ref) {
    const at = await locate(ctx, ref);
    let d;
    try {
      d = await api(ctx, issuePath(at));
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw new Error(tr('Issue {key} が見つかりません（{project}）', { key: keyOf(at, at.iid), project: at.project }));
      throw err;
    }
    const comments = await fetchComments(ctx, at).catch(() => []);
    return { ...toIssue(d, at), comments };
  },

  async setStatus(ctx, ref, key) {
    const labels = statusLabels(ctx.settings);
    if (!(key in labels)) throw new Error(tr('不明なステータスです: {key}', { key }));
    const to = labels[key];
    const at = await locate(ctx, ref);
    const cur = await api(ctx, issuePath(at));
    const have = cur.labels || [];
    const remove = Object.values(labels).filter((l) => l !== to && have.includes(l));
    const closing = key === 'done';
    const stateEvent = closing === (cur.state === 'closed') ? undefined : closing ? 'close' : 'reopen';
    if (have.includes(to) && !remove.length && !stateEvent) return { updated: [], unchanged: [{ to }], skipped: [], projects: 1 };
    const res = await api(ctx, issuePath(at), { method: 'PUT', json: { add_labels: to, remove_labels: remove.join(',') || undefined, state_event: stateEvent } });
    // Guest の権限では、エラーにならずラベルだけ無視される
    if (res && Array.isArray(res.labels) && !res.labels.includes(to)) return { updated: [], skipped: [{ reason: tr('ラベル「{label}」を付けられませんでした。トークンの権限を確かめてください', { label: to }) }], projects: 1 };
    return { updated: [{ from: remove[0] || '', to }], skipped: [], projects: 1 };
  },

  async addComment(ctx, ref, body) {
    const at = await locate(ctx, ref);
    const note = await api(ctx, `${issuePath(at)}/notes`, { method: 'POST', json: { body: String(body || '') } });
    return { url: ref.url && note && note.id ? `${ref.url}#note_${note.id}` : '' };
  },

  async fetchSubIssues(ctx, ref) {
    const at = await locate(ctx, ref);
    return withWorkItems(
      async () => (await loadWorkItem(ctx, at)).children.map((x) => childIssue(ctx, at, x)),
      () => fetchLinkedIssues(ctx, at),
    );
  },

  async createSubIssue(ctx, ref, { title, body }) {
    const at = await locate(ctx, ref);
    return withWorkItems(
      async () => {
        const parent = await loadWorkItem(ctx, at);
        if (!parent.taskTypeId) throw new WorkItemsUnavailable();
        const input = { namespacePath: at.project, title: clipTitle(title), workItemTypeId: parent.taskTypeId, descriptionWidget: { description: String(body || '') }, hierarchyWidget: { parentId: parent.id } };
        const r = (await graphql(ctx, CREATE_WORK_ITEM, { input })).workItemCreate;
        // 親が子を持てない種類（Task の下など）。Issue と関連づけで扱う
        if (!r || !r.workItem || (r.errors && r.errors.length)) throw new WorkItemsUnavailable();
        const iid = Number(r.workItem.iid);
        return { number: iid, key: keyOf(at, iid), title: r.workItem.title || title, url: issueUrl(ctx, at, iid) };
      },
      () => createLinkedIssue(ctx, at, { title, body }),
    );
  },

  /**
   * MR を作る。同じブランチの MR が開いていれば、それを返す（push はアプリの git の処理が済ませている）
   * @returns {Promise<{ url: string, number: number, created: boolean }>}
   */
  async createMergeRequest(ctx, { head, base, title, body }) {
    const root = `projects/${projectId(await originProject(ctx))}/merge_requests`;
    const open = await api(ctx, root, { query: { state: 'opened', source_branch: head, per_page: 1 } });
    if (Array.isArray(open) && open[0]) return { url: open[0].web_url, number: open[0].iid, created: false };
    const d = await api(ctx, root, { method: 'POST', json: { source_branch: head, target_branch: base, title: clipTitle(title), description: String(body || '') } });
    return { url: d.web_url, number: d.iid, created: true };
  },

  /** MR の今の状態。形は gh.pullRequestState と同じ */
  async mergeRequestState(ctx, { url }) {
    const mr = parseMergeRequestUrl(url, ctx.config.baseUrl);
    if (!mr) throw new Error(tr('この MR は、設定の「連携」の接続先のものではありません: {url}', { url }));
    // with_merge_status_recheck: GitLab はコンフリクトの有無を聞かれたときにしか計算し直さない
    const d = await api(ctx, `projects/${projectId(mr.project)}/merge_requests/${mr.iid}`, { query: { with_merge_status_recheck: true } });
    const state = MR_STATE[d.state] || String(d.state || '').toUpperCase();
    return {
      state,
      mergedAt: d.merged_at || null,
      headRefOid: d.sha || null,
      baseRefName: d.target_branch || null,
      mergeable: mergeableOf(d),
      checks: state === 'OPEN' ? await pipelineChecks(ctx, mr.project, d.head_pipeline, d.sha) : null,
    };
  },

  // テストで使う
  parseGitlabRemote,
  parseMergeRequestUrl,
};
