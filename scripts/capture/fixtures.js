// 撮影用の架空のボード・ログ・差分。すべて作りものの値で、実在のリポジトリや人の情報は入れない
const content = require('./content');

const ROOT = '/Users/dev/work';
const SHOP = `${ROOT}/shop-app`;
const ADMIN = `${ROOT}/admin-dashboard`;
const API = `${ROOT}/api-server`;
const MOBILE = `${ROOT}/mobile-app`;
const HOST_IP = '100.101.102.103';
const SHA = { base: '530cb3e', head: '1e4a41c' };

const wt = (repo, id) => `${repo}.worktrees/${id}`;

function buildFixtures(lang, tr, now = Date.now()) {
  const t = content[lang];
  const ago = (s) => now - s * 1000;
  const base = { agent: 'claude', baseBranch: 'main', repoPath: SHOP, createdAt: ago(300), logs: [] };
  const issue = (number) => ({ number, url: `https://github.com/acme/shop-app/issues/${number}` });

  const question = {
    id: 'q1',
    questions: [{
      header: t.qHeader, question: t.qText, multiSelect: false,
      options: [{ label: t.o10, description: t.o10d }, { label: t.o50, description: t.o50d }, { label: t.o100, description: t.o100d }],
    }],
  };
  const permission = { id: 'p1', toolName: 'Bash', summary: 'npm test -- tests/theme.test.js', input: { command: 'npm test -- tests/theme.test.js' }, detail: 'npm test -- tests/theme.test.js' };

  const cards = {
    logs: { ...base, id: 'logs', title: t.tLogs, status: 'todo', createdAt: ago(200) },
    paging: { ...base, id: 'paging', title: t.tPaging, status: 'todo', skill: 'test-writer', createdAt: ago(300) },
    limit: { ...base, id: 'limit', title: t.tLimit, status: 'running', skill: 'code-review', startedAt: ago(8), branch: 'agent/api-6792c82b', worktreePath: wt(SHOP, '6792c82b'), questions: [question], createdAt: ago(70) },
    dark: { ...base, id: 'dark', title: `#15 ${t.tDark}`, issue: issue(15), status: 'running', startedAt: ago(10), branch: 'agent/issue-15-dbf9834c', worktreePath: wt(SHOP, 'dbf9834c'), permissions: [permission], createdAt: ago(80) },
    csv: { ...base, id: 'csv', title: `#18 ${t.tCsv}`, issue: issue(18), status: 'running', startedAt: ago(10), branch: 'agent/issue-18-97cc633a', worktreePath: wt(SHOP, '97cc633a'), lastMessage: 'Write tests/utils/csv.test.js', createdAt: ago(85) },
    readme: { ...base, id: 'readme', title: t.tReadme, status: 'review', awaitingReply: true, branch: 'agent/readme-39c817a8', worktreePath: wt(SHOP, '39c817a8'), costUsd: 0.012, createdAt: ago(60), sessionId: 's-readme' },
    enter: { ...base, id: 'enter', title: `#12 ${t.tEnter}`, issue: issue(12), status: 'review', branch: 'agent/issue-12-6329ceac', worktreePath: wt(SHOP, '6329ceac'), lastMessage: t.mEnter, costUsd: 0.06, createdAt: ago(50), sessionId: 's-enter' },
    speed: { ...base, id: 'speed', title: t.tSpeed, status: 'done', branch: 'agent/task-0649b289', lastMessage: t.mSpeed, costUsd: 0.02, createdAt: ago(40), mergedInto: 'main', sessionId: 's-speed' },
    pay: { ...base, id: 'pay', kind: 'chat', title: t.tPay, status: 'review', costUsd: 0.018, createdAt: ago(30), sessionId: 's-pay' },
  };
  cards.csv.btw = [{ id: 'b1', text: t.btw, state: 'delivered', at: ago(25) }];

  const adminCards = [
    { ...base, repoPath: ADMIN, id: 'roles', title: t.tRoles, status: 'running', startedAt: ago(8), branch: 'agent/task-ef3c6a9f', worktreePath: wt(ADMIN, 'ef3c6a9f'), permissions: [{ ...permission, summary: 'npm test', input: { command: 'npm test' }, detail: 'npm test' }] },
    { ...base, repoPath: ADMIN, id: 'chart', title: t.tChart, status: 'running', startedAt: ago(8), branch: 'agent/task-650d47df', worktreePath: wt(ADMIN, '650d47df'), lastMessage: 'Write src/new-feature.js' },
    { ...base, repoPath: ADMIN, id: 'dates', title: t.tDates, status: 'review', branch: 'agent/task-74d237e7', worktreePath: wt(ADMIN, '74d237e7'), lastMessage: t.mDates, costUsd: 0.01 },
  ];

  const tool = (text, tt) => ({ kind: 'tool', text, t: tt });
  const res = (text, tt) => ({ kind: 'tool_result', text, t: tt });
  const sys = (text, tt) => ({ kind: 'system', text, t: tt });
  const start = (id, branch, tt, perm = 'acceptEdits') => [
    sys(tr('worktree を作成しました: {wt}（ブランチ {branch} / ベース {base}）', { wt: wt(SHOP, id), branch, base: 'main' }), tt),
    sys(tr('セッション開始（モデル: {model} / 権限モード: {mode}）', { model: 'sonnet', mode: perm }), tt),
  ];
  const T = ago(120);
  const logs = {
    dark: [
      { kind: 'user', text: `${t.pDark}\n\n${t.pHow}`, t: T }, ...start('dbf9834c', 'agent/issue-15-dbf9834c', T),
      { kind: 'text', text: t.aDark, t: T + 3000 }, tool('Read  src/styles/theme.css', T + 4000), res('...', T + 4100), tool('Edit  src/styles/theme.css', T + 5000), res('ok', T + 5100),
      { kind: 'text', text: t.aDark2, t: T + 6000 }, tool('Bash  npm test -- tests/theme.test.js', T + 7000),
      { kind: 'permission', text: tr('承認待ち: {toolName}  {summary}', { toolName: 'Bash', summary: 'npm test -- tests/theme.test.js' }), t: T + 7100 },
    ],
    limit: [
      { kind: 'user', text: t.pLimit, t: T }, ...start('6792c82b', 'agent/api-6792c82b', T),
      tool('Read  src/api/orders.js', T + 2000), res('...', T + 2100), { kind: 'text', text: t.aLimit, t: T + 3000 },
      { kind: 'question', text: `${tr('質問')}: ${t.qText}`, t: T + 4000 },
    ],
    readme: [
      { kind: 'user', text: t.pReadme, t: T }, ...start('39c817a8', 'agent/readme-39c817a8', T),
      tool('Read  README.md', T + 2000), res('...', T + 2100), tool('Read  package.json', T + 2500), res('...', T + 2600),
      { kind: 'text', text: `${t.aReadme1}\n\n${t.aReadme2}\n\n${t.aReadme3}`, t: T + 3000 },
      { kind: 'result', text: tr('完了しました（{secs}秒 / ${amount}）', { secs: 48, amount: '0.012' }), t: T + 4000 },
    ],
    enter: [
      { kind: 'user', text: t.tEnter, t: T }, ...start('6329ceac', 'agent/issue-12-6329ceac', T),
      { kind: 'text', text: t.aEnter, t: T + 1000 },
      tool('Read  src/components/LoginForm.jsx', T + 2000), res('...', T + 2100), tool('Grep  src', T + 2200), res('...', T + 2300),
      tool('Edit  src/components/LoginForm.jsx', T + 2400), res('ok', T + 2500), tool('Edit  src/styles/form.css', T + 2600), res('ok', T + 2700),
      tool('Write  tests/components/LoginForm.test.jsx', T + 2800), res('ok', T + 2900), tool('Bash  npm test -- tests/components', T + 3000), res('PASS', T + 3100),
      { kind: 'text', text: t.aEnterDone, t: T + 3500 },
      { kind: 'result', text: tr('完了しました（{secs}秒 / ${amount}）', { secs: 52, amount: '0.060' }), t: T + 3600 },
    ],
    pay: [
      { kind: 'user', text: t.pPay, t: T },
      sys(tr('セッション開始（モデル: {model} / 権限モード: {mode}）', { model: 'sonnet', mode: 'default' }), T),
      tool('Grep  src', T + 1000), res('...', T + 1100), tool('Read  src/api/payments.js', T + 1200), res('...', T + 1300),
      { kind: 'text', text: [
        t.payIntro, '',
        `| ${t.payFile} | ${t.payRole} |`, '| --- | --- |',
        `| \`src/api/payments.js\` | ${t.payR1} |`, `| \`src/api/orders.js\` | ${t.payR2} |`, `| \`src/components/Cart.jsx\` | ${t.payR3} |`, '',
        `## ${t.payFlow}`, '', `1. ${t.payS1}`, `2. ${t.payS2}`, `3. ${t.payS3}`, '',
        '```js', 'const order = await createOrder(cart);', 'await authorize(order.id, cart.total);', '```', '', t.payEnd,
      ].join('\n'), t: T + 2000 },
      { kind: 'result', text: tr('完了しました（{secs}秒 / ${amount}）', { secs: 48, amount: '0.018' }), t: T + 3000 },
    ],
    csv: [{ kind: 'user', text: t.tCsv, t: T }, ...start('97cc633a', 'agent/issue-18-97cc633a', T)],
  };

  const diff = `diff --git a/src/components/LoginForm.jsx b/src/components/LoginForm.jsx
index 3f1a9c2..8d2e7b4 100644
--- a/src/components/LoginForm.jsx
+++ b/src/components/LoginForm.jsx
@@ -4,12 +4,25 @@ import { login } from '../api/auth';
 export function LoginForm() {
   const [email, setEmail] = useState('');
   const [password, setPassword] = useState('');
+  const [sending, setSending] = useState(false);
+
+  // ${t.comment}
+  async function onSubmit(e) {
+    e.preventDefault();
+    if (sending) return;
+    setSending(true);
+    try {
+      await login(email, password);
+    } finally {
+      setSending(false);
+    }
+  }
 
   return (
-    <div className="login">
+    <form className="login" onSubmit={onSubmit}>
       <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
       <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
-      <button onClick={() => login(email, password)}>Sign in</button>
-    </div>
+      <button type="submit" disabled={sending}>Sign in</button>
+    </form>
   );
 }
diff --git a/src/styles/form.css b/src/styles/form.css
index 11aa22b..33cc44d 100644
--- a/src/styles/form.css
+++ b/src/styles/form.css
@@ -1,3 +1,10 @@
-.login button { opacity: 1; }
+.login button { opacity: 1; }
+.login button:disabled {
+  opacity: 0.5;
+  cursor: not-allowed;
+}
+.login {
+  display: grid;
+  gap: 8px;
+}
diff --git a/tests/components/LoginForm.test.jsx b/tests/components/LoginForm.test.jsx
new file mode 100644
index 0000000..55ee66f
--- /dev/null
+++ b/tests/components/LoginForm.test.jsx
@@ -0,0 +1,8 @@
+import { render, screen, fireEvent } from '@testing-library/react';
+import { LoginForm } from '../../src/components/LoginForm';
+
+test('Enter submits the form', () => {
+  render(<LoginForm />);
+  fireEvent.submit(screen.getByRole('button'));
+  expect(screen.getByRole('button')).toBeDisabled();
+});
`;

  const worktree = {
    exists: true,
    status: {
      path: wt(SHOP, '6329ceac'), branch: 'agent/issue-12-6329ceac', baseBranch: 'main', behind: 0,
      head: { short: SHA.head, subject: t.subject },
      base: { short: SHA.base, subject: t.mergeSubject, date: new Date(ago(19)).toISOString() },
      commits: [{ sha: `${SHA.head}aaaa`, subject: t.subject, files: 3, add: 32, del: 4, date: new Date(ago(17)).toISOString() }],
      committed: [
        { status: 'M', path: 'src/components/LoginForm.jsx', add: 16, del: 3 },
        { status: 'M', path: 'src/styles/form.css', add: 8, del: 1 },
        { status: 'A', path: 'tests/components/LoginForm.test.jsx', add: 8, del: 0 },
      ],
      uncommitted: [],
    },
    worktrees: [
      { path: SHOP, branch: 'main', main: true },
      { path: wt(SHOP, '39c817a8'), branch: 'agent/readme-39c817a8' },
      { path: wt(SHOP, '6329ceac'), branch: 'agent/issue-12-6329ceac' },
      { path: wt(SHOP, '6792c82b'), branch: 'agent/api-6792c82b' },
      { path: wt(SHOP, '97cc633a'), branch: 'agent/issue-18-97cc633a' },
      { path: wt(SHOP, 'dbf9834c'), branch: 'agent/issue-15-dbf9834c' },
    ],
  };

  const notes = [
    ['awaiting', cards.readme, tr('回答待ち: {title}', { title: t.tReadme }), t.nReadme],
    ['result', cards.pay, tr('返事: {title}', { title: t.tPay }), t.nPay],
    ['question', cards.limit, tr('質問: {title}', { title: t.tLimit }), t.qText],
    ['review', cards.enter, tr('レビュー待ち: {title}', { title: cards.enter.title }), t.mEnter],
    ['permission', cards.dark, tr('承認待ち: {title}', { title: cards.dark.title }), 'Bash npm test -- tests/theme.test.js'],
  ];
  const notifications = notes.map(([kind, c, title, body], i) => ({ id: `n${i}`, kind, cardId: c.id, title, body, t: ago(20 + i), read: false }));
  // 古い通知を足して、未読の数を実際に近づける
  for (let i = 0; i < 4; i++) notifications.push({ id: `old${i}`, kind: 'review', cardId: cards.speed.id, title: tr('レビュー待ち: {title}', { title: t.tSpeed }), body: t.mSpeed, t: ago(60 + i), read: false });

  const pubKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK3m9pQx7vYc2LrWfT8sNbJ4eH1uXo6dZgVqR0aMkCyE dev@laptop';
  const keyPath = '/Users/dev/.ssh/agent-kanban_ed25519';
  const keyStatus = {
    exists: true, path: keyPath, pubPath: `${keyPath}.pub`, publicKey: pubKey,
    commands: {
      mac: `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${pubKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
      winAdmin: `Add-Content -Path "$env:ProgramData\\ssh\\administrators_authorized_keys" -Value '${pubKey}'`,
      winUser: `Add-Content -Path "$env:USERPROFILE\\.ssh\\authorized_keys" -Value '${pubKey}'`,
    },
  };
  const remote = (over = {}) => ({
    role: 'local',
    host: { enabled: false, listening: false, port: 17831, pairCode: null, pairExpiresAt: 0, pairedCount: 0, clients: 0 },
    client: { connected: false, mode: 'ssh', host: '127.0.0.1', port: 17831, hasToken: false, sshHost: HOST_IP, sshUser: 'dev', sshPort: 22, sshKey: keyPath, sshPath: 'ssh', tunnel: false, canResume: false, reconnecting: null, resumeError: '', history: [], currentId: '', view: 'host' },
    ...over,
  });
  const remoteClient = remote({ role: 'client' });
  remoteClient.client = { ...remoteClient.client, connected: true, tunnel: true, hasToken: true };

  const tabs = (active, shop = { attention: 3, running: 3 }) => [
    { path: SHOP, ...shop, ...(active === SHOP ? { attention: 0, running: 0 } : {}) },
    { path: ADMIN, attention: active === ADMIN ? 0 : 1, running: active === ADMIN ? 0 : 2 },
    { path: API, attention: 1, running: 2 },
  ];

  return {
    t, cards, adminCards, logs, diff, worktree, notifications, keyStatus, remote, remoteClient, tabs,
    paths: { SHOP, ADMIN, API, MOBILE },
    skills: [
      { name: 'db-migration', source: 'project', description: t.skDb },
      { name: 'release-notes', source: 'project', description: t.skRel },
      { name: 'code-review', source: 'user', description: t.skCode },
      { name: 'refactor', source: 'user', description: t.skRef },
      { name: 'test-writer', source: 'user', description: t.skTest },
    ],
    sessions: [{ id: 's-stock', title: t.sess, updatedAt: ago(7200), related: true }],
    repoInfo: { branches: ['main', 'develop', 'agent/readme-39c817a8'], current: 'main', hasOrigin: true },
  };
}

module.exports = { buildFixtures, HOST_IP };
