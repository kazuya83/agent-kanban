// Linear のプロバイダ。GraphQL API（https://api.linear.app/graphql）を API キーで呼ぶ。
// リポジトリ自体は GitHub や GitLab のままなので、PR / MR の作成はそちらの処理に任せ、ここでは Issue だけを扱う
const { request, redact, HttpError } = require('./http');
const { pickStatusOption } = require('../github');
const { tr } = require('../../renderer/i18n');

const LABEL = 'Linear';
const API_URL = 'https://api.linear.app/graphql';
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*-[1-9]\d*$/;
const MAX_DETAIL = 300;

const ISSUE_FIELDS = 'id identifier title description url state { id name type } labels(first: 50) { nodes { name } }';
const VIEWER_QUERY = 'query { viewer { displayName name } }';
const ISSUE_QUERY = `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} comments(first: 100) { nodes { body createdAt user { displayName name } botActor { name } } } } }`;
const CHILDREN_QUERY = `query($id: String!) { issue(id: $id) { id children(first: 100) { nodes { ${ISSUE_FIELDS} } } } }`;
const STATES_QUERY = 'query($id: String!) { issue(id: $id) { id state { id name type } team { id name states(first: 100) { nodes { id name type position } } } } }';
const PARENT_QUERY = 'query($id: String!) { issue(id: $id) { id team { id } project { id } } }';
const UPDATE_MUTATION = 'mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }';
const COMMENT_MUTATION = 'mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { url } } }';
const CREATE_MUTATION = 'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier title url } } }';

const nodes = (x) => (x && Array.isArray(x.nodes) ? x.nodes : []);
const firstLine = (s) => String(s || '').trim().split('\n')[0].slice(0, MAX_DETAIL);

// レート制限が解けるまでのミリ秒（分からなければ 0）。reset の値は UNIX 時刻（ミリ秒）
function rateLimitWait(headers, now = Date.now()) {
  if (!headers || typeof headers.get !== 'function') return 0;
  const after = Number(headers.get('retry-after'));
  if (after > 0) return after * 1000;
  let wait = 0;
  for (const name of ['requests', 'complexity']) {
    if (headers.get(`x-ratelimit-${name}-remaining`) !== '0') continue;
    const reset = Number(headers.get(`x-ratelimit-${name}-reset`));
    if (reset > now) wait = Math.max(wait, reset - now);
  }
  return wait;
}

function rateLimitError(headers) {
  const wait = rateLimitWait(headers);
  const err = new Error(wait ? tr('Linear のレート制限に達しました。約 {min} 分後にもう一度試してください', { min: Math.ceil(wait / 60000) }) : tr('Linear のレート制限に達しました。しばらく待ってからもう一度試してください'));
  err.rateLimited = true;
  return err;
}

// GraphQL の errors を、ログに出せる1つの例外にする
function graphqlError(errors, headers, key) {
  const e = errors[0] || {};
  const ext = e.extensions || {};
  const code = String(ext.code || '').toUpperCase();
  const type = String(ext.type || '').toLowerCase();
  if (code === 'RATELIMITED' || type === 'ratelimited') return rateLimitError(headers);
  if (code === 'AUTHENTICATION_ERROR' || type === 'authentication error') return new Error(tr('Linear の認証に失敗しました。API キーを確かめてください'));
  const detail = redact(firstLine(ext.userPresentableMessage || e.message), [key]);
  if (code === 'FORBIDDEN' || type === 'forbidden') return new Error(tr('Linear でこの操作をする権限がありません: {message}', { message: detail }));
  const err = new Error(detail ? tr('Linear がエラーを返しました: {message}', { message: detail }) : tr('Linear がエラーを返しました'));
  if (/not found/i.test(String(e.message || ''))) err.notFound = true;
  return err;
}

const hasErrors = (data) => !!data && Array.isArray(data.errors) && data.errors.length > 0;

async function gql(ctx, query, variables) {
  const key = ctx.secret('apiKey');
  if (!key) throw new Error(tr('Linear に接続していません。設定の「連携」で API キーを入れてください'));
  let res;
  try {
    // 個人の API キーは Bearer を付けずに、そのまま送る
    res = await request(API_URL, { method: 'POST', headers: { Authorization: key }, json: { query, variables }, secrets: [key], label: LABEL });
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) throw rateLimitError(err.headers);
    if (err instanceof HttpError && hasErrors(err.data)) throw graphqlError(err.data.errors, err.headers, key);
    throw err;
  }
  if (hasErrors(res.data)) throw graphqlError(res.data.errors, res.headers, key);
  if (!res.data || !res.data.data) throw new Error(tr('Linear の応答を読めませんでした'));
  return res.data.data;
}

// Issue を1件読む。無ければ分かる文言にする
async function issueOf(ctx, ref, query) {
  const notFound = () => new Error(tr('Linear に {key} が見つかりません。識別子と、API キーのワークスペースを確かめてください', { key: ref.key }));
  let data;
  try {
    data = await gql(ctx, query, { id: ref.key });
  } catch (err) {
    throw err.notFound ? notFound() : err;
  }
  if (!data.issue) throw notFound();
  return data.issue;
}

function issueShape(x) {
  const type = (x.state && x.state.type) || '';
  return {
    key: x.identifier,
    title: x.title,
    body: x.description || '',
    url: x.url,
    state: type === 'completed' || type === 'canceled' ? 'closed' : 'open',
    labels: nodes(x.labels).map((l) => l.name).filter(Boolean),
  };
}

const authorOf = (c) => (c.user && (c.user.displayName || c.user.name)) || (c.botActor && c.botActor.name) || LABEL;

// 成功しなかったミューテーションを例外にする
function mustSucceed(result) {
  if (!result || result.success === false) throw new Error(tr('Linear が変更を受け付けませんでした'));
  return result;
}

// 入力の1語を識別子にする（ENG-123 か、linear.app の Issue の URL）。読めなければ null
function identifierOf(word) {
  const m = /^(?:https?:\/\/)?(?:www\.)?linear\.app\/[^/?#]+\/issue\/([^/?#]+)(?:[/?#].*)?$/i.exec(word);
  const id = m ? m[1] : word;
  return IDENTIFIER.test(id) ? id.toUpperCase() : null;
}

function parseRefs(_ctx, text) {
  const words = String(text || '').split(/[\s,、]+/).filter(Boolean);
  const bad = words.filter((w) => !identifierOf(w));
  if (bad.length) throw new Error(tr('Linear の Issue として読めません: {v}（ENG-123 か Issue の URL を入れてください）', { v: bad.join(', ') }));
  return words.map((w) => ({ key: identifierOf(w) }));
}

// ワークフローの状態から、statusKey に当たるものを選ぶ
// mapping（設定で指定した名前）があれば、その名前の状態だけを選ぶ。なければ型で絞って、名前の近いものを選ぶ
function pickState(states, key, mapping) {
  const list = [...(states || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
  if (String(mapping || '').trim()) return pickStatusOption(list, key, mapping);
  const started = list.filter((s) => s.type === 'started');
  if (key === 'done') {
    const completed = list.filter((s) => s.type === 'completed');
    return pickStatusOption(completed, key) || completed[0] || null;
  }
  const review = pickStatusOption(started, 'inReview');
  // チームにレビューの状態が無ければ、開始済みのままにする
  if (key === 'inReview' && review) return review;
  const working = started.filter((s) => !review || s.id !== review.id);
  return pickStatusOption(working, 'inProgress') || working[0] || started[0] || null;
}

module.exports = {
  id: 'linear',
  label: LABEL,
  refPlaceholder: '例: ENG-123 または https://linear.app/acme/issue/ENG-123',
  statusHelp: 'Issue から作ったタスクが「実行中」になると started、「レビュー」になると In Review などの started、マージして「完了」になると completed の型の状態に、Issue を変えます。',
  commentEvents: true,
  mapsStatusNames: true,
  configFields: [
    { name: 'apiKey', type: 'secret', label: 'API キー', placeholder: 'lin_api_…', required: true, help: 'Linear の Settings の Security & access にある Personal API keys で作れます。Issue の読み書きとコメントの権限が必要です。' },
  ],

  async testConnection(ctx) {
    const key = ctx.secret('apiKey');
    if (!key) return { ok: false, message: tr('API キーを入れてください') };
    try {
      const { viewer } = await gql(ctx, VIEWER_QUERY);
      const user = viewer && (viewer.displayName || viewer.name);
      return { ok: true, message: user ? tr('{user} として接続できました', { user }) : tr('接続できました') };
    } catch (err) {
      return { ok: false, message: redact(err.message, [key]) };
    }
  },

  // Linear の連携は、本文の識別子や URL でリンクする。Ref なら Linear 側で勝手に閉じない（閉じるのは状態同期の設定に任せる）
  linkLine: (ref) => `Ref ${ref.key} ${ref.url || ''}`.trim(),

  parseRefs,

  async fetchIssue(ctx, ref) {
    const x = await issueOf(ctx, ref, ISSUE_QUERY);
    const comments = [...nodes(x.comments)].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return { ...issueShape(x), comments: comments.map((c) => ({ author: authorOf(c), body: c.body })) };
  },

  async setStatus(ctx, ref, statusKey) {
    const x = await issueOf(ctx, ref, STATES_QUERY);
    const mapping = String(((ctx.settings || {}).statusMapping || {})[statusKey] || '').trim();
    const next = pickState(nodes(x.team && x.team.states), statusKey, mapping);
    if (!next) {
      const team = (x.team && x.team.name) || '';
      const reason = mapping ? tr('チーム「{team}」に、設定した状態「{mapping}」がありません', { team, mapping }) : tr('チーム「{team}」に、当てはまる状態がありません（{key}）', { team, key: statusKey });
      return { updated: [], skipped: [{ reason }], projects: 1 };
    }
    if (x.state && x.state.id === next.id) return { updated: [], unchanged: [{ to: next.name }], skipped: [], projects: 1 };
    const data = await gql(ctx, UPDATE_MUTATION, { id: x.id, stateId: next.id });
    mustSucceed(data.issueUpdate);
    return { updated: [{ from: (x.state && x.state.name) || '', to: next.name }], skipped: [], projects: 1 };
  },

  async addComment(ctx, ref, body) {
    const x = await issueOf(ctx, ref, PARENT_QUERY);
    const data = await gql(ctx, COMMENT_MUTATION, { input: { issueId: x.id, body: String(body) } });
    const r = mustSucceed(data.commentCreate);
    return { url: r.comment && r.comment.url };
  },

  async createSubIssue(ctx, ref, { title, body }) {
    const parent = await issueOf(ctx, ref, PARENT_QUERY);
    const input = { teamId: parent.team.id, parentId: parent.id, title, description: body };
    if (parent.project && parent.project.id) input.projectId = parent.project.id;
    const data = await gql(ctx, CREATE_MUTATION, { input });
    const made = mustSucceed(data.issueCreate).issue;
    if (!made) throw new Error(tr('Linear が変更を受け付けませんでした'));
    return { key: made.identifier, title: made.title, url: made.url };
  },

  async fetchSubIssues(ctx, ref) {
    const x = await issueOf(ctx, ref, CHILDREN_QUERY);
    return nodes(x.children).map(issueShape);
  },

  // テスト用
  _pickState: pickState,
  _rateLimitWait: rateLimitWait,
};
