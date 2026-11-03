// Electron メインプロセス
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const { Store } = require('./src/store');
const { AgentManager } = require('./src/agent');
const { PermissionServer } = require('./src/permission-server');
const git = require('./src/git');
const { fixPath, resolveCommand } = require('./src/env');

// Finder やスタートメニューから起動しても claude / git / node が見つかるようにする
fixPath();
if (process.platform === 'win32') app.setAppUserModelId('dev.agentkanban.app'); // Windows の通知に必要

// 起動したあとにアプリの中身（app.asar）が入れ替えられたか（アップデートを起動中に入れたとき）。
// 入れ替わったまま古いプロセスで新しいウィンドウを開くと、ファイルの位置がずれて画面が壊れるので、再起動する
const appStamp = (() => {
  if (!app.isPackaged) return null;
  try {
    const st = require('original-fs').statSync(app.getAppPath()); // asar を書庫ファイルとして調べる
    return `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
})();
function appReplaced() {
  if (!appStamp) return false;
  try {
    const st = require('original-fs').statSync(app.getAppPath());
    return `${st.ino}:${st.size}:${st.mtimeMs}` !== appStamp;
  } catch {
    return true;
  }
}

let win = null;
let quitState = 'idle'; // 終了の流れ: idle → confirming → stopping → done
let store;
let agents;
let permServer;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Claude Agent Kanban',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // アプリの画面以外へは移動させない。新しいウインドウも開かせない（リンクは open:external で許可した URL だけを外部ブラウザで開く）
  const appUrl = require('url').pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== appUrl) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => (win = null));
  // Windows / Linux はウインドウを閉じるとアプリも終わるので、閉じる前に終了の確認を出す（キャンセルならウインドウを残す）
  win.on('close', (e) => {
    if (process.platform === 'darwin' || quitState === 'done' || !agents) return;
    const { running, queued } = agents.activeCount();
    if (!running && !queued) return;
    e.preventDefault();
    app.quit();
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function boardState() {
  return { settings: store.settings, cards: agents.publicCards(store.settings.repoPath), totalCostUsd: store.totalCost(store.settings.repoPath), notifications: agents.listNotifications(store.settings.repoPath) };
}

let boardTimer = null;
function notifyBoard() {
  if (boardTimer) return;
  boardTimer = setTimeout(() => {
    boardTimer = null;
    send('board:changed', boardState());
  }, 120);
}

// エラーはメッセージだけをきれいに返す
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, arg) => {
    try {
      return { ok: true, data: await fn(arg) };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  store = new Store(path.join(userData, 'board.json'));
  agents = new AgentManager(store, {
    // パッケージ後は asar の外に出した MCP スクリプトを使う
    mcpScript: path.join(__dirname, 'src', 'permission-mcp.js').replace('app.asar', 'app.asar.unpacked'),
    mcpDir: path.join(userData, 'mcp'),
    nodeBin: process.execPath, // ELECTRON_RUN_AS_NODE=1 で Node として動かす
  });

  permServer = new PermissionServer((payload, signal) => agents.requestPermission(payload, signal));
  await permServer.start();
  agents.setPermissionEndpoint(permServer.port, permServer.token);

  agents.on('changed', notifyBoard);
  // 作った PR がマージされたら、タスクを完了にする（1分ごとに GitHub で確かめる）
  agents.watchPullRequests(60000);
  agents.on('log', (id, entry) => send('card:log', { id, entry }));
  // 通知（右上のベルに貯まるもの）は、デスクトップ通知でも知らせる
  agents.on('notification', (n) => {
    notifyBoard();
    if (Notification.isSupported()) {
      const dn = new Notification({ title: n.title, body: String(n.body || '').slice(0, 200) });
      dn.on('click', () => {
        if (win) {
          win.show();
          win.focus();
          send('card:focus', n.cardId);
        }
      });
      dn.show();
    }
    if (win && !win.isFocused()) win.flashFrame(true);
  });

  handle('board:get', () => boardState());
  handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  handle('env:check', () => ({
    git: resolveCommand('git'),
    claude: resolveCommand(store.settings.claudePath || 'claude'),
    platform: process.platform,
  }));
  handle('repo:choose', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'git リポジトリを選択' });
    if (r.canceled || !r.filePaths[0]) return null;
    const top = await git.toplevel(r.filePaths[0]);
    if (!top) throw new Error('選んだフォルダは git リポジトリではありません');
    store.settings.repoPath = top;
    store.settings.baseBranch = '';
    store.save();
    notifyBoard();
    return top;
  });
  handle('repo:info', async () => {
    const repo = store.settings.repoPath;
    if (!repo) return { branches: [], current: '' };
    return {
      branches: await git.branches(repo).catch(() => []),
      current: await git.currentBranch(repo).catch(() => ''),
      hasOrigin: await git.hasRemote(repo, 'origin').catch(() => false),
    };
  });
  handle('settings:update', (patch) => {
    const allowed = ['baseBranch', 'permissionMode', 'allowedTools', 'model', 'claudePath', 'maxParallel', 'defaultSkill', 'integration', 'issueStatusSync', 'statusFieldName', 'statusMapping', 'suggestSkillsOnDone', 'branchNamingRule'];
    if (patch && 'branchNamingRule' in patch) patch = { ...patch, branchNamingRule: String(patch.branchNamingRule || '').trim() };
    if (patch && 'integration' in patch && !['merge', 'pr'].includes(patch.integration)) patch = { ...patch, integration: 'merge' };
    if (patch && 'suggestSkillsOnDone' in patch) patch = { ...patch, suggestSkillsOnDone: !!patch.suggestSkillsOnDone };
    if (patch && 'issueStatusSync' in patch) patch = { ...patch, issueStatusSync: !!patch.issueStatusSync };
    if (patch && 'baseBranch' in patch) {
      const b = String(patch.baseBranch || '').trim();
      if (b) git.assertSafeRef(b, 'ベースブランチ名');
      patch = { ...patch, baseBranch: b };
    }
    if (patch && 'statusFieldName' in patch) patch = { ...patch, statusFieldName: String(patch.statusFieldName || '').trim() };
    if (patch && 'statusMapping' in patch) {
      const m = patch.statusMapping || {};
      const str = (v) => String(v || '').trim();
      patch = { ...patch, statusMapping: { inProgress: str(m.inProgress), inReview: str(m.inReview), done: str(m.done) } };
    }
    for (const k of allowed) if (patch && k in patch) store.settings[k] = patch[k];
    store.settings.maxParallel = Math.min(10, Math.max(1, parseInt(store.settings.maxParallel, 10) || 1));
    store.save();
    agents.pump();
    notifyBoard();
    return store.settings;
  });
  handle('card:create', ({ title, prompt, autoStart, session, skill }) => {
    const c = agents.createCard({ title, prompt, session, skill });
    if (autoStart) agents.start(c.id);
    return c.id;
  });
  handle('chat:create', ({ message, title, session, skill }) => agents.createChat({ message, title, session, skill }).id);
  handle('card:createFromIssues', async ({ numbers, extra, autoStart, session, skill }) => {
    const { cards, errors } = await agents.createFromIssues({ numbers, extra, session, skill });
    if (autoStart) for (const c of cards) agents.start(c.id);
    return { ids: cards.map((c) => c.id), errors };
  });
  handle('repo:github', async () => {
    const repo = store.settings.repoPath;
    if (!repo) return null;
    const { repoSlug } = require('./src/github');
    const slug = await repoSlug(repo).catch(() => null);
    return { slug, gh: !!resolveCommand('gh') };
  });
  handle('open:external', async (url) => {
    if (!/^https:\/\/([a-z0-9-]+\.)?github\.com\//.test(String(url))) throw new Error('開けない URL です');
    await shell.openExternal(url);
  });
  // gh（GitHub CLI）: 状態の確認・インストール・ログイン
  const gh = require('./src/gh');
  handle('gh:status', () => gh.status());
  handle('gh:install', () => gh.install((line) => send('gh:event', { type: 'line', line })));
  handle('gh:login', () =>
    gh.login((ev) => {
      if (ev.type === 'code') shell.openExternal(ev.url).catch(() => {});
      send('gh:event', ev);
    }),
  );
  handle('gh:addProjectScope', () =>
    gh.addProjectScope((ev) => {
      if (ev.type === 'code') shell.openExternal(ev.url).catch(() => {});
      send('gh:event', ev);
    }),
  );
  handle('gh:cancel', () => gh.cancel());
  handle('card:update', ({ id, title, prompt, skill }) => agents.updateCard(id, { title, prompt, skill }));
  handle('card:start', (id) => agents.start(id));
  handle('card:resume', (id) => agents.resume(id));
  handle('card:resumeAll', () => agents.resumeAll(store.settings.repoPath));
  handle('card:dismissInterrupted', (id) => agents.dismissInterrupted(id));
  handle('card:stop', (id) => agents.stop(id));
  handle('card:send', ({ id, message, skill }) => agents.send(id, message, skill));
  handle('card:suggestSkills', ({ id }) => agents.suggestSkills(id));
  handle('notifications:read', ({ ids } = {}) => agents.readNotifications(store.settings.repoPath, ids));
  handle('notifications:clear', ({ ids } = {}) => agents.clearNotifications(store.settings.repoPath, ids));
  handle('notifications:act', ({ id }) => agents.actNotification(id));
  handle('skills:list', () => require('./src/skills').listSkills(store.settings.repoPath));
  handle('card:btw', ({ id, text }) => agents.btw(id, text));
  handle('card:setSession', ({ id, session }) => agents.setSession(id, session));
  handle('sessions:list', () => require('./src/sessions').listSessions(store.settings.repoPath));
  handle('card:logs', (id) => agents.logs(id));
  handle('card:diff', (id) => agents.diff(id));
  handle('card:worktree', (id) => agents.worktree(id));
  handle('card:merge', async ({ id, target, createNew, keep, push }) => {
    // push するかどうかは覚えておき、次のマージでも同じにする
    store.settings.pushAfterMerge = !!push;
    store.save();
    return agents.merge(id, { target, createNew, keep, push });
  });
  handle('card:pr', ({ id, base, title, body, keep }) => agents.createPullRequest(id, { base, title, body, keep }));
  handle('card:discard', (id) => agents.discard(id));
  handle('conflict:resolve', ({ id, mode }) => agents.resolveConflict(id, mode));
  handle('conflict:complete', (id) => agents.completeConflict(id));
  handle('conflict:abort', (id) => agents.abortConflict(id));
  handle('conflict:dismiss', (id) => agents.dismissConflict(id));
  handle('conflict:fromPr', (id) => agents.reopenPrConflict(id));
  handle('card:permission', ({ id, reqId, decision, message }) => agents.answerPermission(id, reqId, decision, message));
  handle('card:answer', ({ id, reqId, answers }) => agents.answerQuestion(id, reqId, answers));
  handle('card:open', async (id) => {
    const c = agents.must(id);
    if (!c.worktreePath) throw new Error('worktree がありません');
    const err = await shell.openPath(c.worktreePath);
    if (err) throw new Error(err);
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    // ウィンドウを閉じて裏で動いているあいだに新しい版が入ったら、新しい版で起動し直す
    if (appReplaced()) {
      app.relaunch();
      app.quit();
      return;
    }
    createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 実行中・待機中のタスクがあるときは、終了してよいか確かめる。
// 終了するときは claude を止めて作業内容をブランチにコミットしてから終わる（次の起動で「再開」できる）
app.on('before-quit', (e) => {
  if (quitState === 'done' || !agents) {
    store?.flush();
    permServer?.close();
    return;
  }
  e.preventDefault();
  if (quitState !== 'idle') return;
  const { running, queued } = agents.activeCount();
  const finish = async () => {
    quitState = 'stopping';
    try {
      await agents.shutdown();
    } catch {
      /* 終了は続ける */
    }
    quitState = 'done';
    app.quit();
  };
  if (!running && !queued) return finish();
  quitState = 'confirming';
  const parts = [running && `実行中 ${running} 件`, queued && `待機中 ${queued} 件`].filter(Boolean).join('・');
  const opts = {
    type: 'warning',
    buttons: ['中断して終了', 'キャンセル'],
    defaultId: 1,
    cancelId: 1,
    title: '実行中のタスクがあります',
    message: `${parts}のタスクがあります。終了しますか？`,
    detail: '終了すると、実行中のタスクは中断されます（それまでの変更はタスクのブランチにコミットします）。\n次にアプリを起動したとき、ボード上部の「すべて再開」やタスクの「▶ 再開」で、中断したところから続けられます。',
  };
  const ask = win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
  ask.then(
    ({ response }) => {
      if (response === 0) return finish();
      quitState = 'idle';
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    },
    () => finish(),
  );
});
