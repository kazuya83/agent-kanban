// カードの issue（どのサービスの、どの Issue か）の読み方。アプリ本体（require）と画面（<script>）の両方から使う
// c.issue の形: { provider, key, number, title, url, linkLine }
//   provider: サービスの ID（前の版のカードには無いので、無ければ github）
//   key: 表示に使う文字（#12 / ENG-123 など。前の版のカードには無いので、無ければ #number）
//   number: 番号（ENG-123 のように番号だけでは決まらないサービスでは無くてもよい）
//   linkLine: PR / MR の本文に入れる1行（無ければ下の linkLine が決める）
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IssueRef = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_PROVIDER = 'github';
  const providerOf = (issue) => (issue && issue.provider) || DEFAULT_PROVIDER;
  const keyOf = (issue) => (!issue ? '' : issue.key ? String(issue.key) : `#${issue.number}`);
  const sameIssue = (a, b) => !!a && !!b && providerOf(a) === providerOf(b) && keyOf(a) === keyOf(b);

  // カードの題名の先頭の「#12 」「ENG-123 」を除く
  function stripKey(title, issue) {
    const s = String(title == null ? '' : title);
    const key = issue && issue.key ? `${issue.key} ` : '';
    return key && s.startsWith(key) ? s.slice(key.length) : s.replace(/^#\d+\s*/, '');
  }

  // ブランチ名に入れる部分（#12 → 12、ENG-123 → eng-123）
  function branchPart(issue) {
    return keyOf(issue).replace(/^#/, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // PR / MR の本文に入れる1行。GitHub は Closes #12
  function linkLine(issue) {
    if (issue.linkLine) return String(issue.linkLine);
    if (providerOf(issue) === DEFAULT_PROVIDER) return `Closes ${keyOf(issue)}`;
    return `${keyOf(issue)} ${issue.url || ''}`.trim();
  }

  // PR の URL から、コードのホストを読む（GitLab の MR の URL は /-/merge_requests/ を含む）。それ以外は ''
  const reviewHostOf = (url) => (/\/-\/merge_requests\/\d+/.test(String(url || '')) ? 'gitlab' : '');

  // 保存する形にそろえる（前の版の { number, title, url } も受け取る）。読み取れなければ null
  function cleanIssue(x) {
    if (!x || typeof x !== 'object') return null;
    const number = Number(x.number);
    const hasNumber = Number.isFinite(number) && number > 0;
    const key = String(x.key || '').trim();
    if (!hasNumber && !key) return null;
    const out = { provider: providerOf(x), key: key || `#${number}`, title: String(x.title || ''), url: String(x.url || '') };
    if (hasNumber) out.number = number;
    if (x.linkLine) out.linkLine = String(x.linkLine);
    return out;
  }

  return { DEFAULT_PROVIDER, providerOf, keyOf, sameIssue, stripKey, branchPart, linkLine, reviewHostOf, cleanIssue };
});
