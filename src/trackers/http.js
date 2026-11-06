// 課題管理・チャットサービスの API を呼ぶときの共通処理。
// - ベース URL の検証: https が基本。http はセルフホスト向けに、明示の許可があるときだけ
// - タイムアウト
// - エラーの整形: トークンを含めない（エラーの文はカードのログと画面に出る）
// - 転送（3xx）は追わない: 別のホストへトークンの入ったヘッダーごと送ってしまわないように
const { tr } = require('../../renderer/i18n');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_DETAIL = 300;

class HttpError extends Error {
  constructor(message, { status = 0, data = null, headers = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;
    this.headers = headers;
  }
}

/**
 * 接続先のベース URL を確かめて、末尾の / を除いた形にする（入力の値はエラーの文に入れない）
 * @param {string} value
 * @param {{ allowHttp?: boolean }} opts allowHttp: http を許可する（セルフホスト向けに、ユーザーが選んだときだけ）
 */
function validateBaseUrl(value, { allowHttp = false } = {}) {
  let u;
  try {
    u = new URL(String(value == null ? '' : value).trim());
  } catch {
    throw new Error(tr('接続先の URL として読めません（https:// から入れてください）'));
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(tr('接続先の URL は https:// から入れてください'));
  if (u.protocol === 'http:' && !allowHttp) throw new Error(tr('http の接続先は、許可を選んだときだけ使えます（トークンが暗号化されずに流れます）'));
  if (u.username || u.password) throw new Error(tr('接続先の URL にユーザー名やパスワードは入れられません'));
  if (u.search || u.hash) throw new Error(tr('接続先の URL に ? や # は入れられません'));
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

// ベース URL の後ろにパスをつなぐ
function joinUrl(base, pathName) {
  return `${String(base).replace(/\/+$/, '')}/${String(pathName || '').replace(/^\/+/, '')}`;
}

// 文の中から、トークンと、トークンらしいものを消す
function redact(text, secrets = []) {
  let out = String(text == null ? '' : text);
  for (const s of secrets) if (s) out = out.split(String(s)).join('***');
  return out
    .replace(/\b(Bearer|Basic|token)\s+[^\s,;]+/gi, '$1 ***')
    .replace(/\b((?:access_|api_|private_)?token|api[_-]?key|password|secret)=[^&\s]+/gi, '$1=***');
}

// API のエラー応答から、人が読める1行を取り出す（JSON の決まった項目だけ。HTML などはそのまま出さない）
function detailOf(data) {
  if (!data || typeof data !== 'object') return '';
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const e = first(data.errors);
  const picks = [data.message, data.error_description, data.error, first(data.errorMessages), e && e.message, typeof e === 'string' ? e : ''];
  const hit = picks.find((v) => typeof v === 'string' && v.trim());
  return hit ? hit.trim().split('\n')[0].slice(0, MAX_DETAIL) : '';
}

/**
 * @param {string|URL} url
 * @param {{ method?: string, headers?: object, query?: object, json?: any, body?: any, timeoutMs?: number, secrets?: string[], label?: string }} opts
 *   query: URL に足す値（undefined と null は足さない） / json: JSON にして送る
 *   secrets: エラーの文から消す値（渡したトークン）。URL の中にトークンを入れるサービスでは必ず渡す
 *   label: エラーの文に出すサービスの名前
 * @returns {Promise<{ status: number, data: any, text: string, headers: Headers }>} data は JSON ならパースしたもの
 */
async function request(url, { method = 'GET', headers = {}, query, json, body, timeoutMs = DEFAULT_TIMEOUT_MS, secrets = [], label = '' } = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  const name = label || u.host;
  const sendHeaders = { Accept: 'application/json', 'User-Agent': 'worktree-kanban', ...headers };
  let sendBody = body;
  if (json !== undefined) {
    sendBody = JSON.stringify(json);
    sendHeaders['Content-Type'] = 'application/json';
  }
  let res;
  let text;
  try {
    res = await fetch(u, { method, headers: sendHeaders, body: sendBody, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new HttpError(tr('{label} から {sec} 秒以内に返事がありませんでした', { label: name, sec: Math.round(timeoutMs / 1000) }));
    const why = (err && err.cause && (err.cause.code || err.cause.message)) || (err && err.message) || '';
    throw new HttpError(tr('{label} に接続できませんでした: {message}', { label: name, message: redact(why, secrets) }));
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* JSON でない応答。text のまま返す */
  }
  if (res.status >= 300 && res.status < 400) throw new HttpError(tr('{label} から別の場所へ転送されました（{status}）。接続先の URL を確かめてください', { label: name, status: res.status }), { status: res.status });
  if (res.status === 401 || res.status === 403) throw new HttpError(tr('{label} の認証に失敗しました（{status}）。トークンと権限を確かめてください', { label: name, status: res.status }), { status: res.status, data, headers: res.headers });
  if (!res.ok) {
    const detail = redact(detailOf(data), secrets);
    const msg = detail ? tr('{label} がエラーを返しました（{status}）: {message}', { label: name, status: res.status, message: detail }) : tr('{label} がエラーを返しました（{status}）', { label: name, status: res.status });
    throw new HttpError(msg, { status: res.status, data, headers: res.headers });
  }
  return { status: res.status, data, text, headers: res.headers };
}

module.exports = { HttpError, DEFAULT_TIMEOUT_MS, validateBaseUrl, joinUrl, redact, request };
