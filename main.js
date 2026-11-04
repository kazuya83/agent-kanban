// Electron メインプロセス
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const { Store } = require('./src/store');
const { AgentManager } = require('./src/agent');
const { PermissionServer } = require('./src/permission-server');
const git = require('./src/git');
const wsl = require('./src/wsl');
const { fixPath, resolveCommand } = require('./src/env');
const providers = require('./src/providers');
const { RemoteHost, RemoteClient, DEFAULT_PORT, isProxyChannel, isLocalChannel } = require('./src/remote');
const { SshTunnel, isLoopbackHost, sshHostInfo } = require('./src/ssh-tunnel');
const sshKey = require('./src/ssh-key');
const fs = require('fs');

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
let remoteHost = null;
let remoteClient = null;
let sshTunnel = null;
const localHandlers = new Map();

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Agent Kanban',
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
  return { settings: store.settings, cards: agents.publicCards(store.settings.repoPath), totalCostUsd: store.totalCost(store.settings.repoPath), weeklyCost: store.weeklyCost(store.settings.repoPath), notifications: agents.listNotifications(store.settings.repoPath) };
}

function remoteSession() {
  const h = remoteHost?.status() || {};
  const c = remoteClient?.status() || {};
  return {
    role: c.connected ? 'client' : h.listening ? 'host' : 'local',
    host: {
      enabled: !!store.settings.remoteHostEnabled,
      listening: !!h.listening,
      port: h.port || store.settings.remotePort || DEFAULT_PORT,
      pairCode: h.pairCode || null,
      pairExpiresAt: h.pairExpiresAt || 0,
      pairedCount: h.pairedCount || (store.settings.remotePairTokens || []).length,
      clients: h.clients || 0,
    },
    client: {
      connected: !!c.connected,
      mode: store.settings.remoteClientMode === 'direct' ? 'direct' : 'ssh',
      host: store.settings.remoteClientHost || '127.0.0.1',
      port: store.settings.remoteClientPort || DEFAULT_PORT,
      hasToken: !!(store.settings.remoteClientToken || c.hasToken),
      sshHost: store.settings.remoteSshHost || '',
      sshUser: store.settings.remoteSshUser || '',
      sshPort: store.settings.remoteSshPort || 22,
      sshKey: store.settings.remoteSshKey || '',
      sshPath: store.settings.remoteSshPath || 'ssh',
      tunnel: !!sshTunnel?.active(),
    },
  };
}

function withRemoteSession(state) {
  return { ...state, remoteSession: remoteSession() };
}

let boardTimer = null;
function notifyBoard() {
  if (boardTimer) return;
  boardTimer = setTimeout(() => {
    boardTimer = null;
    // クライアント接続中はホスト側の board:changed を中継するので、ローカルボードは送らない
    if (remoteClient?.connected) {
      send('remote:changed', remoteSession());
      return;
    }
    const state = withRemoteSession(boardState());
    send('board:changed', state);
    remoteHost?.broadcast('board:changed', state);
  }, 120);
}

function notifyRemoteOnly() {
  send('remote:changed', remoteSession());
  if (!remoteClient?.connected) notifyBoard();
}

// ローカル処理。クライアント接続中は PROXY 対象をホストへ転送する
async function dispatch(channel, arg) {
  if (remoteClient?.connected && isProxyChannel(channel)) {
    const data = await remoteClient.invoke(channel, arg);
    // ホストの board:get に、このマシンの遠隔状態を載せる
    if (channel === 'board:get' && data && typeof data === 'object') return withRemoteSession(data);
    return data;
  }
  // 接続中に手元のボードを触る操作（リポジトリの選択ダイアログなど）は、ホストと食い違うので止める
  if (remoteClient?.connected && !isLocalChannel(channel)) throw new Error('遠隔操作中はこの操作を使えません（ホスト側で行うか、切断してから使ってください）');
  const fn = localHandlers.get(channel);
  if (!fn) throw new Error(`未対応の操作です: ${channel}`);
  return fn(arg);
}

// エラーはメッセージだけをきれいに返す
function handle(channel, fn) {
  localHandlers.set(channel, fn);
  ipcMain.handle(channel, async (_e, arg) => {
    try {
      return { ok: true, data: await dispatch(channel, arg) };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
}

// ssh のパス。Windows は PATH に無くても標準の OpenSSH クライアントの場所を見る
function sshCommand(setting) {
  const cmd = String(setting || '').trim() || 'ssh';
  const found = resolveCommand(cmd);
  if (found) return found;
  if (process.platform === 'win32' && cmd === 'ssh') {
    const win = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
    if (resolveCommand(win)) return win;
  }
  return cmd;
}

async function startRemoteHost() {
  const port = store.settings.remotePort || DEFAULT_PORT;
  if (!remoteHost) {
    remoteHost = new RemoteHost({
      port,
      tokens: store.settings.remotePairTokens || [],
      onTokens: (tokens) => {
        store.settings.remotePairTokens = tokens;
        store.save();
      },
      invoke: (channel, arg) => {
        const fn = localHandlers.get(channel);
        if (!fn || !isProxyChannel(channel)) throw new Error(`この操作は遠隔では使えません: ${channel}`);
        return fn(arg);
      },
    });
    remoteHost.on('changed', notifyRemoteOnly);
  }
  await remoteHost.start(port);
  store.settings.remoteHostEnabled = true;
  store.settings.remotePort = remoteHost.port;
  store.save();
  notifyRemoteOnly();
  return remoteSession();
}

async function stopRemoteHost() {
  store.settings.remoteHostEnabled = false;
  store.save();
  if (remoteHost) await remoteHost.stop();
  notifyRemoteOnly();
  return remoteSession();
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
  agents.on('log', (id, entry) => {
    const payload = { id, entry };
    send('card:log', payload);
    remoteHost?.broadcast('card:log', payload);
  });
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

  remoteClient = new RemoteClient();
  remoteClient.on('event', (channel, payload) => {
    if (channel === 'board:changed' && payload && typeof payload === 'object') {
      send('board:changed', withRemoteSession(payload));
      return;
    }
    send(channel, payload);
  });
  remoteClient.on('disconnected', () => {
    notifyRemoteOnly();
    send('board:changed', withRemoteSession(boardState()));
  });
  remoteClient.on('changed', notifyRemoteOnly);

  handle('board:get', () => withRemoteSession(boardState()));
  handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  handle('remote:status', () => remoteSession());
  // このマシンをホストにするとき、操作側に入れてもらう接続先と SSH サーバーの状態
  handle('remote:hostInfo', () => sshHostInfo());
  // 操作側で使う SSH の鍵（作るのはアプリ、ホストへの登録はユーザー）
  const keyInfo = (st) => ({ ...st, commands: st.publicKey ? sshKey.registerCommands(st.publicKey) : null });
  // keyPath: 画面の「鍵ファイル」の欄（空ならアプリの専用の鍵 ~/.ssh/agent-kanban_ed25519）
  const keyPathOf = (keyPath) => (keyPath != null ? String(keyPath) : store.settings.remoteSshKey || '');
  handle('remote:keyStatus', ({ keyPath } = {}) => keyInfo(sshKey.keyStatus({ keyPath: keyPathOf(keyPath) })));
  handle('remote:genKey', async ({ keyPath, sshPath } = {}) => {
    const cmd = sshCommand(sshPath != null ? sshPath : store.settings.remoteSshPath);
    const st = await sshKey.generateKey({ keyPath: keyPathOf(keyPath), command: sshKey.keygenCommandFor(cmd) });
    // 接続のときにこの鍵を使う
    store.settings.remoteSshKey = st.path;
    store.save();
    return keyInfo(st);
  });
  // ホスト側: 操作側から受け取った公開鍵ファイルを選んで、authorized_keys に登録する
  handle('remote:pickPubKey', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '操作側から受け取った公開鍵（.pub）を選択',
      properties: ['openFile'],
      filters: [{ name: '公開鍵', extensions: ['pub'] }, { name: 'すべてのファイル', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const st = fs.statSync(file);
    if (st.size > 64 * 1024) throw new Error('公開鍵のファイルではないようです（大きすぎます）');
    const key = sshKey.parsePublicKey(fs.readFileSync(file, 'utf8'));
    return { path: file, key: key.line, type: key.type, comment: key.comment };
  });
  handle('remote:installPubKey', async ({ path: file } = {}) => {
    if (!file) throw new Error('公開鍵のファイルを選んでください');
    const r = await sshKey.installPublicKey({ text: fs.readFileSync(String(file), 'utf8') });
    notifyRemoteOnly();
    return r;
  });
  handle('remote:startHost', async ({ port } = {}) => {
    if (remoteClient?.connected) throw new Error('クライアントとして接続中はホストを開始できません。先に切断してください');
    if (port != null) {
      const n = parseInt(port, 10);
      store.settings.remotePort = n === 0 ? 0 : Math.min(65535, Math.max(1024, n || DEFAULT_PORT));
      store.save();
    }
    return startRemoteHost();
  });
  handle('remote:stopHost', () => stopRemoteHost());
  handle('remote:refreshPair', () => {
    if (!remoteHost?.listening()) throw new Error('ホストが起動していません');
    const r = remoteHost.refreshPairCode();
    notifyRemoteOnly();
    return r;
  });
  handle('remote:clearPairs', () => {
    if (remoteHost) remoteHost.clearPairs();
    else {
      store.settings.remotePairTokens = [];
      store.save();
    }
    notifyRemoteOnly();
    return remoteSession();
  });
  handle('remote:connect', async ({ mode, host, port, code, sshHost, sshUser, sshPort, sshKey, sshPath } = {}) => {
    if (remoteHost?.listening()) throw new Error('ホストとして待ち受け中は接続できません。先にホストを停止してください');
    const s = store.settings;
    const m = (mode || s.remoteClientMode) === 'direct' ? 'direct' : 'ssh';
    const h = String(host || s.remoteClientHost || '127.0.0.1').trim() || '127.0.0.1';
    const p = parseInt(port != null ? port : s.remoteClientPort, 10) || DEFAULT_PORT;
    s.remoteClientMode = m;
    s.remoteClientHost = h;
    s.remoteClientPort = p;
    if (sshHost != null) s.remoteSshHost = String(sshHost).trim();
    if (sshUser != null) s.remoteSshUser = String(sshUser).trim();
    if (sshPort != null) s.remoteSshPort = Math.min(65535, Math.max(1, parseInt(sshPort, 10) || 22));
    if (sshKey != null) s.remoteSshKey = String(sshKey).trim();
    if (sshPath != null) s.remoteSshPath = String(sshPath).trim() || 'ssh';
    store.save();
    const token = s.remoteClientToken || '';
    let target = { host: h, port: p };
    if (m === 'ssh') {
      // アプリが ssh -N -L を張り、手元の空きポート経由でホストの 127.0.0.1:p へつなぐ
      sshTunnel?.close();
      sshTunnel = new SshTunnel({ command: sshCommand(s.remoteSshPath) });
      sshTunnel.on('exit', () => {
        // トンネルが落ちたら接続も切れる。状態だけ画面に知らせる
        if (remoteClient?.connected) remoteClient.disconnect();
        notifyRemoteOnly();
      });
      const localPort = await sshTunnel.open({ host: s.remoteSshHost, user: s.remoteSshUser, sshPort: s.remoteSshPort, remotePort: p, identityFile: s.remoteSshKey });
      target = { host: '127.0.0.1', port: localPort };
    }
    let result;
    try {
      result = await remoteClient.connect({ ...target, code: code || '', token: code ? '' : token });
    } catch (err) {
      sshTunnel?.close();
      if (m === 'ssh' && /ECONNRESET|接続が切れました|ECONNREFUSED/.test(String(err?.message))) {
        throw new Error(`SSH はつながりましたが、ホストの Agent Kanban に届きませんでした。ホストの Agent Kanban で「ホストを開始」しているか、待ち受けポート（${p}）が合っているかを確かめてください`);
      }
      if (m === 'direct' && !isLoopbackHost(h) && /ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(String(err?.code || err?.message))) {
        throw new Error(`${h}:${p} に直接つながりません。ホストは外に見せないよう 127.0.0.1 でしか待ち受けていないため、Tailscale の IP などへは直接つなげません。接続方法を「SSH 経由」にして、SSH の接続先にその IP を入れてください`);
      }
      throw err;
    }
    if (result.token) {
      store.settings.remoteClientToken = result.token;
      store.save();
    }
    notifyRemoteOnly();
    // 接続直後にホストのボードを取る
    const board = await remoteClient.invoke('board:get');
    send('board:changed', withRemoteSession(board));
    return remoteSession();
  });
  handle('remote:disconnect', () => {
    remoteClient?.disconnect();
    sshTunnel?.close();
    send('board:changed', withRemoteSession(boardState()));
    return remoteSession();
  });
  handle('remote:forgetToken', () => {
    store.settings.remoteClientToken = '';
    store.save();
    remoteClient?.disconnect();
    sshTunnel?.close();
    notifyRemoteOnly();
    return remoteSession();
  });
  handle('env:check', async () => {
    // WSL のリポジトリなら、WSL の中に git と claude があるかを見る
    const w = wsl.parseWslPath(store.settings.repoPath);
    if (w) {
      return {
        git: await wsl.which(w.distro, 'git'),
        claude: await wsl.which(w.distro, store.settings.wslClaudePath || 'claude'),
        agents: Object.fromEntries(await Promise.all(providers.AGENT_IDS.map(async (a) => [a, await wsl.which(w.distro, a === 'claude' ? store.settings.wslClaudePath || 'claude' : providers.AGENTS[a].defaultCmd)]))),
        platform: process.platform,
        wsl: w.distro,
      };
    }
    return {
      git: resolveCommand('git'),
      claude: resolveCommand(store.settings.claudePath || 'claude'),
      agents: Object.fromEntries(providers.AGENT_IDS.map((a) => [a, resolveCommand(providers.agentCommand(store.settings, a))])),
      platform: process.platform,
    };
  });
  // Windows: WSL のディストリビューション（Ubuntu など）。リポジトリを選ぶときに、その中のフォルダも選べるようにする
  handle('wsl:distros', () => (process.platform === 'win32' || process.env.AGENT_KANBAN_WSL ? wsl.listDistros() : []));
  const { touchRecentRepo } = require('./src/store');
  const forgetRecentRepo = (dir) => {
    const s = String(dir || '').trim();
    if (!s) return;
    store.settings.recentRepoPaths = (store.settings.recentRepoPaths || []).filter((p) => p !== s);
    store.save();
    notifyBoard();
  };
  // パスが git リポジトリか調べて toplevel を返す（だめなら recent から外すこともある）
  const resolveRepoDir = async (picked, { forgetOnMissing = false } = {}) => {
    const fs = require('fs');
    if (!picked) throw new Error('パスが空です');
    if (!fs.existsSync(picked)) {
      if (forgetOnMissing) forgetRecentRepo(picked);
      throw new Error(`フォルダが見つかりません: ${picked}`);
    }
    const pw = wsl.parseWslPath(picked);
    let top = '';
    try {
      top = wsl.fromLinux(picked, (await git.git(picked, ['rev-parse', '--show-toplevel'])).trim());
    } catch (err) {
      if (/not a git repository/i.test(err.message)) {
        if (forgetOnMissing) forgetRecentRepo(picked);
        throw new Error(`選んだフォルダは git リポジトリではありません（${picked}）`);
      }
      if (pw && /not found|No such file|127/i.test(err.message)) throw new Error(`${pw.distro}（WSL）の中に git が見つかりません。${pw.distro} のターミナルで sudo apt install git を実行してください。\n${err.message}`);
      throw new Error(`git でフォルダを調べられませんでした（${picked}）\n${err.message}`);
    }
    if (!top) throw new Error(`git から答えが返ってきませんでした（${picked}）`);
    return top;
  };
  handle('repo:choose', async (opts = {}) => {
    const distro = opts && opts.wsl;
    const home = distro ? await wsl.homeDir(distro) : '';
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: distro ? `git リポジトリを選択（${distro}）` : 'git リポジトリを選択',
      ...(distro ? { defaultPath: wsl.toUnc(distro, home || '/home') } : {}),
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return openRepo(await resolveRepoDir(r.filePaths[0]));
  });
  // 最近開いたリポジトリなど、すでにパスが分かっているものを開く（フォルダダイアログは出さない）
  handle('repo:open', async ({ path: dir } = {}) => {
    const picked = String(dir || '').trim();
    return openRepo(await resolveRepoDir(picked, { forgetOnMissing: true }));
  });
  const openRepo = (dir) => {
    store.settings.repoPath = dir;
    store.settings.baseBranch = '';
    store.settings.recentRepoPaths = touchRecentRepo(store.settings.recentRepoPaths, dir);
    store.save();
    notifyBoard();
    return dir;
  };
  // クローン・新規作成の置き場所（親フォルダ）。前回使ったフォルダ → 今のリポジトリの親 → ホーム
  handle('repo:defaultParent', async (opts = {}) => {
    const distro = opts && opts.wsl;
    const fs = require('fs');
    const ok = (p) => p && (distro ? wsl.parseWslPath(p)?.distro === distro : !wsl.isWslPath(p)) && fs.existsSync(p);
    const last = store.settings.lastRepoParent;
    if (ok(last)) return last;
    const cur = store.settings.repoPath;
    if (ok(cur)) return (wsl.isWslPath(cur) ? path.win32 : path).dirname(cur);
    if (distro) {
      const home = await wsl.homeDir(distro);
      return home ? wsl.toUnc(distro, home) : '';
    }
    return app.getPath('home');
  });
  handle('repo:chooseParent', async (opts = {}) => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '置き場所のフォルダを選択',
      ...(opts && opts.defaultPath ? { defaultPath: opts.defaultPath } : {}),
    });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  const repoSetup = require('./src/repo-setup');
  handle('repo:clone', async ({ url, parent, name } = {}) => {
    const dir = await repoSetup.cloneRepo({ url, parent, name });
    store.settings.lastRepoParent = parent;
    openRepo(dir);
    const warning = (await repoSetup.hasCommit(dir)) ? '' : 'クローンしましたが、このリポジトリにはコミットがまだありません。タスクを動かすには、最初のコミットを入れて push してください';
    return { dir, warning };
  });
  handle('repo:create', async ({ parent, name, github } = {}) => {
    const r = await repoSetup.createRepo({ parent, name, github });
    store.settings.lastRepoParent = parent;
    openRepo(r.dir);
    return r;
  });
  handle('repo:info', async () => {
    const repo = store.settings.repoPath;
    if (!repo) return { branches: [], current: '' };
    // git の起動は Windows だと遅いので、並べて走らせる
    const [branches, current, hasOrigin] = await Promise.all([
      git.branches(repo).catch(() => []),
      git.currentBranch(repo).catch(() => ''),
      git.hasRemote(repo, 'origin').catch(() => false),
    ]);
    return { branches, current, hasOrigin };
  });
  handle('settings:update', (patch) => {
    const allowed = ['baseBranch', 'permissionMode', 'allowedTools', 'model', 'claudePath', 'maxParallel', 'defaultSkill', 'integration', 'issueStatusSync', 'statusFieldName', 'statusMapping', 'suggestSkillsOnDone', 'specCheck', 'branchNamingRule', 'defaultAgent', 'codexPath', 'codexModel', 'geminiPath', 'geminiModel', 'cursorPath', 'cursorModel', 'relaySteps', 'competeAgents', 'orchestration', 'enabledAgents', 'weeklyResetDay', 'weeklyResetTime', 'claudeRemoteControl'];
    if (patch && 'branchNamingRule' in patch) patch = { ...patch, branchNamingRule: String(patch.branchNamingRule || '').trim() };
    if (patch && 'integration' in patch && !['merge', 'pr'].includes(patch.integration)) patch = { ...patch, integration: 'merge' };
    if (patch && 'suggestSkillsOnDone' in patch) patch = { ...patch, suggestSkillsOnDone: !!patch.suggestSkillsOnDone };
    if (patch && 'specCheck' in patch) patch = { ...patch, specCheck: !!patch.specCheck };
    if (patch && 'claudeRemoteControl' in patch) patch = { ...patch, claudeRemoteControl: !!patch.claudeRemoteControl };
    if (patch && 'weeklyResetDay' in patch) patch = { ...patch, weeklyResetDay: /^[0-6]$/.test(String(patch.weeklyResetDay)) ? String(patch.weeklyResetDay) : '' };
    if (patch && 'weeklyResetTime' in patch) patch = { ...patch, weeklyResetTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.weeklyResetTime)) ? String(patch.weeklyResetTime) : '00:00' };
    if (patch && 'issueStatusSync' in patch) patch = { ...patch, issueStatusSync: !!patch.issueStatusSync };
    if (patch && 'baseBranch' in patch) {
      const b = String(patch.baseBranch || '').trim();
      if (b) git.assertSafeRef(b, 'ベースブランチ名');
      patch = { ...patch, baseBranch: b };
    }
    if (patch && 'enabledAgents' in patch) patch = { ...patch, enabledAgents: providers.cleanEnabledAgents(patch.enabledAgents) };
    if (patch && 'defaultAgent' in patch && !providers.isAgent(patch.defaultAgent)) patch = { ...patch, defaultAgent: 'claude' };
    for (const k of ['codexPath', 'codexModel', 'geminiPath', 'geminiModel', 'cursorPath', 'cursorModel']) if (patch && k in patch) patch = { ...patch, [k]: String(patch[k] || '').trim() };
    if (patch && 'relaySteps' in patch) patch = { ...patch, relaySteps: providers.cleanRelaySteps(patch.relaySteps) };
    if (patch && 'orchestration' in patch) patch = { ...patch, orchestration: providers.cleanOrchestration(patch.orchestration) };
    if (patch && 'competeAgents' in patch) patch = { ...patch, competeAgents: providers.cleanCompeteAgents(patch.competeAgents) };
    if (patch && 'statusFieldName' in patch) patch = { ...patch, statusFieldName: String(patch.statusFieldName || '').trim() };
    if (patch && 'statusMapping' in patch) {
      const m = patch.statusMapping || {};
      const str = (v) => String(v || '').trim();
      patch = { ...patch, statusMapping: { inProgress: str(m.inProgress), inReview: str(m.inReview), done: str(m.done) } };
    }
    for (const k of allowed) if (patch && k in patch) store.settings[k] = patch[k];
    // 最初から選んでおくエージェントは、使うエージェントの中から（使わない設定にしたら、使うものの先頭にする）
    store.settings.defaultAgent = providers.defaultAgentOf(store.settings);
    store.settings.maxParallel = Math.min(10, Math.max(1, parseInt(store.settings.maxParallel, 10) || 1));
    store.save();
    agents.pump();
    notifyBoard();
    return store.settings;
  });
  // agent: claude / codex / gemini / cursor / relay（Pipeline） / compete（競争。カードが複数できる）。返すのは最初のカードの ID
  // fromChat: 会話の続きとしてタスクを作るときの、元の会話のカードの ID
  handle('card:create', ({ title, prompt, autoStart, session, skill, agent, fromChat }) => {
    const cards = agents.createTask({ title, prompt, session, skill, agent, fromChat });
    if (autoStart) for (const c of cards) agents.start(c.id);
    return cards[0].id;
  });
  handle('chat:create', ({ message, title, session, skill, agent }) => agents.createChat({ message, title, session, skill, agent }).id);
  handle('card:createFromIssues', async ({ numbers, extra, autoStart, session, skill, agent }) => {
    const { cards, errors } = await agents.createFromIssues({ numbers, extra, session, skill, agent });
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
  const pushEvent = (channel, payload) => {
    send(channel, payload);
    remoteHost?.broadcast(channel, payload);
  };
  handle('gh:status', () => gh.status());
  handle('gh:install', () => gh.install((line) => pushEvent('gh:event', { type: 'line', line })));
  handle('gh:login', () =>
    gh.login((ev) => {
      if (ev.type === 'code') shell.openExternal(ev.url).catch(() => {});
      pushEvent('gh:event', ev);
    }),
  );
  handle('gh:addProjectScope', () =>
    gh.addProjectScope((ev) => {
      if (ev.type === 'code') shell.openExternal(ev.url).catch(() => {});
      pushEvent('gh:event', ev);
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
  handle('compete:adopt', (id) => agents.adoptCompetitor(id));
  handle('compete:compare', (id) => agents.compareCompetitors(id).id);
  handle('card:suggestSkills', ({ id }) => agents.suggestSkills(id));
  handle('notifications:read', ({ ids } = {}) => agents.readNotifications(store.settings.repoPath, ids));
  handle('notifications:clear', ({ ids } = {}) => agents.clearNotifications(store.settings.repoPath, ids));
  handle('notifications:act', ({ id }) => agents.actNotification(id));
  // WSL のリポジトリなら、WSL の中の ~/.claude からスキルと会話を読む
  const claudeConfigFor = async (repo) => {
    const w = wsl.parseWslPath(repo);
    return w ? (await wsl.claudeConfigDir(w.distro)) || undefined : undefined;
  };
  handle('skills:list', async () => require('./src/skills').listSkills(store.settings.repoPath, { configDir: await claudeConfigFor(store.settings.repoPath) }));
  handle('card:btw', ({ id, text }) => agents.btw(id, text));
  handle('card:setSession', ({ id, session }) => agents.setSession(id, session));
  handle('sessions:list', async () => require('./src/sessions').listSessions(store.settings.repoPath, { configDir: await claudeConfigFor(store.settings.repoPath) }));
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

  // 前回ホストを有効にしていたら、起動時に待ち受けを再開する
  if (store.settings.remoteHostEnabled) {
    try {
      await startRemoteHost();
    } catch (err) {
      console.error('遠隔ホストの起動に失敗:', err);
      store.settings.remoteHostEnabled = false;
      store.save();
    }
  }

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
    remoteClient?.disconnect();
    sshTunnel?.close();
    remoteHost?.stop();
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
    try {
      remoteClient?.disconnect();
      sshTunnel?.close();
      await remoteHost?.stop();
    } catch {
      /* */
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
    detail: '終了すると、実行中のタスクは中断されます（それまでの変更はタスクのブランチにコミットします）。\n次にアプリを起動したとき、ボード上部の「すべて再開」やタスクの「再開」で、中断したところから続けられます。',
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
