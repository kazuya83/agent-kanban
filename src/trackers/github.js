// GitHub のプロバイダ。src/github.js（gh を使う処理）を共通の形に載せるだけの薄いアダプタ。
// 認証は gh に任せるので、設定の欄もトークンも持たない
const github = require('../github');
const gh = require('../gh');
const git = require('../git');
const { tr } = require('../../renderer/i18n');

module.exports = {
  id: 'github',
  label: 'GitHub',
  statusLabel: 'GitHub Projects',
  refPlaceholder: '例: 12 または 12, 15, 18',
  configFields: [],

  matchesRemote: (url) => git.isGitHubUrl(url),

  async testConnection() {
    const st = await gh.status();
    if (!st.installed) return { ok: false, message: tr('gh（GitHub CLI）が入っていません') };
    if (!st.loggedIn) return { ok: false, message: tr('gh は入っていますが、GitHub にログインしていません') };
    return { ok: true, message: st.user ? tr('{user} として接続できました', { user: st.user }) : tr('接続できました') };
  },

  parseRefs: (_ctx, text) => github.parseIssueNumbers(text).map((number) => ({ number, key: `#${number}` })),

  fetchIssue: (ctx, ref) => github.fetchIssue(ctx.repoPath, ref.number),

  setStatus(ctx, ref, key) {
    return github.setIssueProjectStatus(ctx.repoPath, ref.number, key, { gh: ctx.ghPath, fieldName: ctx.settings.statusFieldName, mapping: ctx.settings.statusMapping });
  },

  addComment: (ctx, ref, body) => github.addComment(ctx.repoPath, ref.number, body),

  createSubIssue: (ctx, ref, issue) => github.createSubIssue(ctx.repoPath, ref.number, issue),

  fetchSubIssues: (ctx, ref) => github.fetchSubIssues(ctx.repoPath, ref.number),
};
