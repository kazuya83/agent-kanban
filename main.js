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

let win = null;
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => (win = null));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function boardState() {
  return { settings: store.settings, cards: agents.publicCards(store.settings.repoPath) };
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
  agents.on('log', (id, entry) => send('card:log', { id, entry }));
  agents.on('permission', (card, req) => {
    if (Notification.isSupported()) {
      const n = new Notification({ title: `承認待ち: ${card.title}`, body: `${req.toolName}  ${req.summary}`.slice(0, 200) });
      n.on('click', () => {
        if (win) {
          win.show();
          win.focus();
          send('card:focus', card.id);
        }
      });
      n.show();
    }
    if (win && !win.isFocused()) win.flashFrame(true);
  });

  handle('board:get', () => boardState());
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
    return { branches: await git.branches(repo).catch(() => []), current: await git.currentBranch(repo).catch(() => '') };
  });
  handle('settings:update', (patch) => {
    const allowed = ['baseBranch', 'permissionMode', 'allowedTools', 'model', 'claudePath', 'maxParallel'];
    for (const k of allowed) if (patch && k in patch) store.settings[k] = patch[k];
    store.settings.maxParallel = Math.min(10, Math.max(1, parseInt(store.settings.maxParallel, 10) || 1));
    store.save();
    agents.pump();
    notifyBoard();
    return store.settings;
  });
  handle('card:create', ({ title, prompt, autoStart }) => {
    const c = agents.createCard({ title, prompt });
    if (autoStart) agents.start(c.id);
    return c.id;
  });
  handle('card:update', ({ id, title, prompt }) => agents.updateCard(id, { title, prompt }));
  handle('card:start', (id) => agents.start(id));
  handle('card:stop', (id) => agents.stop(id));
  handle('card:send', ({ id, message }) => agents.send(id, message));
  handle('card:logs', (id) => agents.logs(id));
  handle('card:diff', (id) => agents.diff(id));
  handle('card:merge', ({ id, target, createNew, keep }) => agents.merge(id, { target, createNew, keep }));
  handle('card:discard', (id) => agents.discard(id));
  handle('card:permission', ({ id, reqId, decision, message }) => agents.answerPermission(id, reqId, decision, message));
  handle('card:open', async (id) => {
    const c = agents.must(id);
    if (!c.worktreePath) throw new Error('worktree がありません');
    const err = await shell.openPath(c.worktreePath);
    if (err) throw new Error(err);
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  agents?.stopAll();
  store?.flush();
  permServer?.close();
});
