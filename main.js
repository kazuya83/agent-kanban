// Electron メインプロセス
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');

// 承認用の MCP サーバーとして呼ばれたのに ELECTRON_RUN_AS_NODE が効かなかったとき
// （Windows、特に WSL の中の claude から呼ばれたときに起きる）は、ウィンドウを開かない。
// ELECTRON_RUN_AS_NODE を付けて自分を起動し直し、標準入出力をそのまま渡して MCP サーバーとして動かす。
// 起動し直せないときは、この場で MCP サーバーとして動く（stdin が閉じたら終わる）
if (require('./src/launch-mode').isMcpLaunch(process.argv)) {
  const re = require('./src/launch-mode').nodeRelaunch(process.execPath, process.argv, process.env);
  const inProcess = () => require('./src/permission-mcp').start();
  if (!re) {
    inProcess();
  } else {
    const child = require('child_process').spawn(re.file, re.args, { env: re.env, cwd: re.cwd, stdio: 'inherit', windowsHide: true });
    child.on('error', inProcess);
    child.on('exit', (code) => app.exit(code ?? 0));
  }
  return;
}
// アプリは1つだけ起動する。2つ目に起動されたら、すぐ終えて、今のウィンドウを前に出す（second-instance）
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const { Store } = require('./src/store');
const { AgentManager } = require('./src/agent');
const { PermissionServer } = require('./src/permission-server');
const git = require('./src/git');
const wsl = require('./src/wsl');
const { fixPath, resolveCommand } = require('./src/env');
const providers = require('./src/providers');
const { RemoteHost, RemoteClient, Reconnector, DEFAULT_PORT, isProxyChannel, isLocalChannel, routeSide, stripRouting, droppedSettingKeys, droppedSettingsMessage, composeTabs, VIEW_CHANNELS, connectionKey, upsertConnectionHistory, removeConnectionHistory, findConnectionHistory, publicConnectionHistory } = require('./src/remote');
const { SshTunnel, isLoopbackHost, sshHostInfo } = require('./src/ssh-tunnel');
const sshKey = require('./src/ssh-key');
const dirBrowse = require('./src/dir-browse');
const { Updater } = require('./src/updater');
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
let reconnector = null; // 前回の接続を再開する（起動時・切れたとき）
// クライアントとして接続中に、画面で見ているのがホストのタブ（'host'）か、このマシンのタブ（'local'）か
// 'local' のあいだは、ボードの操作をこのマシンで行う（ホストとこのマシンのエージェントを並べて動かせる）
let clientView = 'host';
let hostBoardCache = null; // ホストから最後に届いたボード（このマシンのタブを見ているあいだも、ホストのタブを出すため）
let updater = null; // アプリの更新（新しい版を調べて、入れ替えて起動し直す）
let updateResult = null; // 前回の起動で更新したときの結果（{ ok, from, to, log }）。画面に一度だけ知らせる
let quittingForUpdate = false; // 更新のために終了するところ（実行中のタスクの確認は画面で済ませている）
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
  // アプリの画面以外へは移動させない。新しいウインドウも開かせない（リンクは open:external で http(s) の URL だけをデフォルトブラウザで開く）
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
  const { cleanRepoTabs, repoTabSummary } = require('./src/store');
  const repoTabs = repoTabSummary(cleanRepoTabs(store.settings.repoTabs, store.settings.repoPath), store.cards, store.settings);
  return { settings: store.settings, repoTabs, cards: agents.publicCards(store.settings.repoPath), totalCostUsd: store.totalCost(store.settings.repoPath), notifications: agents.listNotifications(store.settings.repoPath) };
}

// 画面に渡すボード。クライアントとして接続中は、見ている側（ホスト / このマシン）のボードに、両方のタブを並べて載せる
// このマシンのタブは画面に出すだけで、ホストへは送らない（ホストの画面にはホストのタブだけが出る）
function viewBoard() {
  const local = boardState();
  if (!remoteClient?.connected || !hostBoardCache) return withRemoteSession(composeTabs(null, local, 'local'));
  return withRemoteSession(composeTabs(hostBoardCache, local, clientView));
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
      // 前回の接続先とトークンが残っていて、ワンクリックで再開できる
      canResume: canResumeRemote(),
      reconnecting: reconnector?.status() || null,
      resumeError: resumeError || '',
      // これまでつないだ接続先（新しい順・トークンは渡さない）。RC設定でカードにして選べるようにする
      history: publicConnectionHistory(store.settings.remoteClientHistory),
      currentId: connectionKey(currentConnection()),
      // 接続中に見ているタブの側（'host' / 'local'）
      view: c.connected ? clientView : 'host',
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
    // このマシンにつないでいる操作側へは、いつもこのマシンだけのボードを送る
    // （このマシンが別のホストにつないでいても、そのホストのタブやカードは混ぜない）
    const own = withRemoteSession(boardState());
    remoteHost?.broadcast('board:changed', own);
    // クライアント接続中の画面には、ホストのタブと並べて出す
    send('board:changed', remoteClient?.connected ? viewBoard() : own);
  }, 120);
}

function notifyRemoteOnly() {
  send('remote:changed', remoteSession());
  if (!remoteClient?.connected) notifyBoard();
}

// ローカル処理。クライアント接続中は、見ている側（またはリポジトリの操作で選んだ側）がホストなら PROXY 対象をホストへ転送する
async function dispatch(channel, arg) {
  if (remoteClient?.connected && !isLocalChannel(channel)) {
    const side = routeSide(channel, arg, clientView);
    if (side === 'host') {
      // 手元のボードを触る操作（リポジトリの選択ダイアログなど）は、ホストの画面に出てしまうので止める
      if (!isProxyChannel(channel)) throw new Error('ホストのタブではこの操作を使えません（このマシンのタブで行うか、ホスト側で行ってください）');
      const data = await remoteClient.invoke(channel, stripRouting(arg));
      // 古い版のホストは知らない設定を黙って捨てる。「保存しました」と出て残らないので、エラーにして知らせる
      if (channel === 'settings:update') {
        const dropped = droppedSettingKeys(stripRouting(arg), data);
        if (dropped.length) throw new Error(droppedSettingsMessage(dropped));
      }
      if (channel === 'board:get' && data && typeof data === 'object') {
        hostBoardCache = data;
        return viewBoard();
      }
      if (VIEW_CHANNELS.has(channel)) setClientView('host');
      // ホストの最後のタブを閉じたら、このマシンのタブを見る
      else if (channel === 'repo:closeTab' && data === '') setClientView('local');
      return data;
    }
    const fn = localHandlers.get(channel);
    if (!fn) throw new Error(`未対応の操作です: ${channel}`);
    const data = await fn(arg);
    if (VIEW_CHANNELS.has(channel) && data) setClientView('local');
    // このマシンの最後のタブを閉じたら、ホストのタブを見る
    else if (channel === 'repo:closeTab' && data === '') setClientView('host');
    return data;
  }
  const fn = localHandlers.get(channel);
  if (!fn) throw new Error(`未対応の操作です: ${channel}`);
  return fn(arg);
}

// 見ている側を変える（タブを切り替えた・リポジトリを開いた）
function setClientView(side) {
  if (clientView === side) return;
  clientView = side;
  notifyBoard();
}

// エラーはメッセージだけをきれいに返す
// WSL のリポジトリなら、WSL の中の ~/.claude からスキルと会話を読む（会話を消すときも同じ場所）
async function claudeConfigFor(repo) {
  const w = wsl.parseWslPath(repo);
  return w ? (await wsl.claudeConfigDir(w.distro)) || undefined : undefined;
}

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
        // 操作側へは、このマシンのボードだけを返す（画面用の viewBoard は、このマシンが別のホストにつないでいると
        // そのホストのタブとカードが混ざり、操作側に「自分の PC のリポジトリ」が出てしまう）
        if (channel === 'board:get') return withRemoteSession(boardState());
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

let resumeError = ''; // 自動の再開をあきらめたときの理由（画面に出す）
// 裏で再開している最中に、切断や別の接続をされたら、古い試みは結果を捨てる
let connectSeq = 0;
let wantConnected = false;
const cancelledError = () => Object.assign(new Error('接続を取り消しました'), { cancelled: true });

// いまの設定にある接続先
function currentConnection() {
  const s = store.settings;
  return { mode: s.remoteClientMode, host: s.remoteClientHost, port: s.remoteClientPort, sshHost: s.remoteSshHost, sshUser: s.remoteSshUser, sshPort: s.remoteSshPort, sshKey: s.remoteSshKey, sshPath: s.remoteSshPath };
}

// これまでの接続から1つ選んで、いまの設定にする（トークンもその接続のものにする）
function useConnection(entry) {
  const s = store.settings;
  s.remoteClientMode = entry.mode === 'direct' ? 'direct' : 'ssh';
  s.remoteClientHost = entry.host || '127.0.0.1';
  s.remoteClientPort = entry.port || DEFAULT_PORT;
  s.remoteSshHost = entry.sshHost || '';
  s.remoteSshUser = entry.sshUser || '';
  s.remoteSshPort = entry.sshPort || 22;
  s.remoteSshKey = entry.sshKey || '';
  s.remoteSshPath = entry.sshPath || 'ssh';
  s.remoteClientToken = entry.token || '';
  store.save();
}

function canResumeRemote() {
  const s = store.settings;
  if (!s.remoteClientToken || remoteClient?.connected || remoteHost?.listening()) return false;
  return s.remoteClientMode === 'direct' ? true : !!String(s.remoteSshHost || '').trim();
}

// 保存した設定（とトークンかコード）でホストへつなぐ。ssh なら先にトンネルを張る
async function connectRemote({ code = '' } = {}) {
  if (remoteHost?.listening()) throw new Error('ホストとして待ち受け中は接続できません。先にホストを停止してください');
  const s = store.settings;
  const m = s.remoteClientMode === 'direct' ? 'direct' : 'ssh';
  const h = s.remoteClientHost || '127.0.0.1';
  const p = s.remoteClientPort || DEFAULT_PORT;
  const token = s.remoteClientToken || '';
  const seq = ++connectSeq;
  wantConnected = true;
  let target = { host: h, port: p };
  if (m === 'ssh') {
    // アプリが ssh -N -L を張り、手元の空きポート経由でホストの 127.0.0.1:p へつなぐ
    sshTunnel?.close();
    const tunnel = new SshTunnel({ command: sshCommand(s.remoteSshPath) });
    sshTunnel = tunnel;
    tunnel.on('exit', () => {
      if (sshTunnel !== tunnel) return; // 張り直した古いトンネル
      // トンネルが落ちたら接続も切れる。自分で切ったのでなければ、つなぎ直す
      if (remoteClient?.connected) {
        remoteClient.disconnect();
        onRemoteLost();
      }
      notifyRemoteOnly();
    });
    const localPort = await tunnel.open({ host: s.remoteSshHost, user: s.remoteSshUser, sshPort: s.remoteSshPort, remotePort: p, identityFile: s.remoteSshKey });
    if (seq !== connectSeq) {
      if (sshTunnel === tunnel) tunnel.close();
      throw cancelledError();
    }
    target = { host: '127.0.0.1', port: localPort };
  }
  let result;
  try {
    result = await remoteClient.connect({ ...target, code: code || '', token: code ? '' : token });
  } catch (err) {
    if (seq !== connectSeq) throw cancelledError();
    sshTunnel?.close();
    if (err?.code === 'BAD_TOKEN') {
      // ホスト側でペアが破棄された。コードでペアリングし直すしかない
      store.settings.remoteClientToken = '';
      store.settings.remoteClientResume = false;
      // これまでの接続からも外す（トークンなしでは選んでもつながらない）
      store.settings.remoteClientHistory = removeConnectionHistory(store.settings.remoteClientHistory, connectionKey(currentConnection()));
      store.save();
      const e = new Error('保存したトークンがホストで無効になっています。ホストに出ている 6 桁のコードで、もう一度ペアリングしてください');
      e.fatal = true;
      throw e;
    }
    if (m === 'ssh' && /ECONNRESET|接続が切れました|ECONNREFUSED/.test(String(err?.message))) {
      throw new Error(`SSH はつながりましたが、ホストの Agent Kanban に届きませんでした。ホストの Agent Kanban で「ホストを開始」しているか、待ち受けポート（${p}）が合っているかを確かめてください`);
    }
    if (m === 'direct' && !isLoopbackHost(h) && /ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(String(err?.code || err?.message))) {
      throw new Error(`${h}:${p} に直接つながりません。ホストは外に見せないよう 127.0.0.1 でしか待ち受けていないため、Tailscale の IP などへは直接つなげません。接続方法を「SSH 経由」にして、SSH の接続先にその IP を入れてください`);
    }
    throw err;
  }
  if (seq !== connectSeq) {
    // つながる前に切断を押された（新しい接続の途中なら、そちらに任せる）
    if (!wantConnected) {
      remoteClient.disconnect();
      sshTunnel?.close();
    }
    throw cancelledError();
  }
  if (result.token) store.settings.remoteClientToken = result.token;
  // これまでの接続に残す（RC設定のカードから選んで、またつなげる）
  store.settings.remoteClientHistory = upsertConnectionHistory(store.settings.remoteClientHistory, currentConnection(), { token: store.settings.remoteClientToken });
  // 次の起動時や切れたときは、この接続を再開する
  store.settings.remoteClientResume = true;
  store.save();
  resumeError = '';
  notifyRemoteOnly();
  // 接続直後にホストのボードを取る
  hostBoardCache = await remoteClient.invoke('board:get');
  send('board:changed', viewBoard());
  return remoteSession();
}

// 前回の接続を再開する（起動時・切れたとき・「前回の接続を再開」）。つながるまで間をあけて何度か試す
function resumeRemote() {
  if (!canResumeRemote()) return false;
  resumeError = '';
  reconnector.start();
  notifyRemoteOnly();
  return true;
}

// 自分で切断したのではなく、接続が切れたとき
function onRemoteLost() {
  if (quitState !== 'idle') return;
  hostBoardCache = null;
  send('board:changed', viewBoard());
  if (store.settings.remoteClientResume) resumeRemote();
}

// 裏での再開や、つないでいる途中の接続をやめる
function cancelConnecting() {
  connectSeq++;
  wantConnected = false;
  reconnector?.cancel();
}

// 自分で切断する。次の起動時には自動で再開しない
function disconnectRemote() {
  cancelConnecting();
  store.settings.remoteClientResume = false;
  store.save();
  remoteClient?.disconnect();
  sshTunnel?.close();
  hostBoardCache = null;
  clientView = 'host'; // 次につないだときは、ホストのタブから見せる
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  store = new Store(path.join(userData, 'board.json'));
  agents = new AgentManager(store, {
    // パッケージ後は asar の外に出した MCP スクリプトを使う
    mcpScript: path.join(__dirname, 'src', 'permission-mcp.js').replace('app.asar', 'app.asar.unpacked'),
    mcpDir: path.join(userData, 'mcp'),
    attachDir: path.join(userData, 'attachments'), // 指示に添付したファイル（作業フォルダの外に置く）
    nodeBin: process.execPath, // ELECTRON_RUN_AS_NODE=1 で Node として動かす
    claudeConfigFor, // 会話を消すときの Claude Code の設定フォルダ（WSL のリポジトリなら WSL の中）
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
      dn.on('click', async () => {
        if (!win) return;
        win.show();
        win.focus();
        // ホストのタブを見ているときは、このマシンのタブに移ってから開く
        if (remoteClient?.connected && clientView === 'host') {
          const c = store.cards.find((x) => x.id === n.cardId);
          clientView = 'local';
          if (c && c.repoPath && c.repoPath !== store.settings.repoPath) await dispatch('repo:open', { path: c.repoPath, target: 'local' }).catch(() => {});
          send('board:changed', viewBoard());
        }
        send('card:focus', n.cardId);
      });
      dn.show();
    }
    if (win && !win.isFocused()) win.flashFrame(true);
  });

  remoteClient = new RemoteClient();
  remoteClient.on('event', (channel, payload) => {
    if (channel === 'board:changed' && payload && typeof payload === 'object') {
      hostBoardCache = payload;
      send('board:changed', viewBoard());
      return;
    }
    send(channel, payload);
  });
  // 'disconnected' は自分で切ったときには来ない（ホストが落ちた・回線が切れたとき）
  remoteClient.on('disconnected', () => {
    sshTunnel?.close();
    notifyRemoteOnly();
    onRemoteLost();
  });
  remoteClient.on('changed', notifyRemoteOnly);
  reconnector = new Reconnector({ connect: () => connectRemote() });
  reconnector.on('changed', notifyRemoteOnly);
  reconnector.on('failed', (err) => {
    resumeError = (err && err.message) || String(err);
    notifyRemoteOnly();
  });

  handle('board:get', () => viewBoard());
  handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  setupUpdater(userData);
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
    // ホストになるなら、クライアントとしての再開はしない
    cancelConnecting();
    store.settings.remoteClientResume = false;
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
    // 前にトークンをもらった接続先なら、そのトークンを使う
    const known = findConnectionHistory(s.remoteClientHistory, connectionKey(currentConnection()));
    if (known?.token) s.remoteClientToken = known.token;
    store.save();
    // 手で接続するときは、裏でのつなぎ直しを止める
    reconnector.cancel();
    resumeError = '';
    return connectRemote({ code });
  });
  // 保存した接続先とトークンで、前回の接続を再開する（ボード上部の「前回の接続を再開」）
  // id を渡したときは、これまでの接続（RC設定のカード）から選んだ接続先につなぐ
  handle('remote:resume', async ({ id } = {}) => {
    if (remoteClient?.connected) return remoteSession();
    if (id) {
      if (remoteHost?.listening()) throw new Error('ホストとして待ち受け中は接続できません。先にホストを停止してください');
      const entry = findConnectionHistory(store.settings.remoteClientHistory, String(id));
      if (!entry) throw new Error('その接続は見つかりません。RC設定を開き直してください');
      if (!entry.token) throw new Error('この接続にはトークンがありません。ホストに出ている 6 桁のコードで、もう一度ペアリングしてください');
      cancelConnecting();
      sshTunnel?.close();
      useConnection(entry);
    }
    if (!canResumeRemote()) throw new Error('再開できる前回の接続がありません。RC設定から接続してください');
    reconnector.cancel();
    resumeError = '';
    notifyRemoteOnly();
    try {
      return await connectRemote();
    } catch (err) {
      resumeError = (err && err.message) || String(err);
      notifyRemoteOnly();
      throw err;
    }
  });
  handle('remote:cancelResume', () => {
    if (remoteClient?.connected) return remoteSession();
    cancelConnecting();
    sshTunnel?.close();
    notifyRemoteOnly();
    return remoteSession();
  });
  handle('remote:disconnect', () => {
    disconnectRemote();
    send('board:changed', viewBoard());
    return remoteSession();
  });
  // これまでの接続から1つ消す（いまの設定の接続先なら、そのトークンも忘れる）
  handle('remote:forgetConnection', ({ id } = {}) => {
    const key = String(id || '');
    const isCurrent = key === connectionKey(currentConnection());
    if (isCurrent && (remoteClient?.connected || reconnector?.active())) throw new Error('つないでいる接続は消せません。先に切断してください');
    store.settings.remoteClientHistory = removeConnectionHistory(store.settings.remoteClientHistory, key);
    if (isCurrent) {
      store.settings.remoteClientToken = '';
      store.settings.remoteClientResume = false;
      resumeError = '';
    }
    store.save();
    notifyRemoteOnly();
    return remoteSession();
  });
  handle('remote:forgetToken', () => {
    disconnectRemote();
    store.settings.remoteClientToken = '';
    store.settings.remoteClientHistory = removeConnectionHistory(store.settings.remoteClientHistory, connectionKey(currentConnection()));
    store.save();
    resumeError = '';
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
  const { touchRecentRepo, cleanRepoTabs, openRepoTab, closeRepoTab, markNoGitRepo } = require('./src/store');
  const forgetRecentRepo = (dir) => {
    const s = String(dir || '').trim();
    if (!s) return;
    store.settings.recentRepoPaths = (store.settings.recentRepoPaths || []).filter((p) => p !== s);
    store.save();
    notifyBoard();
  };
  // パスが git リポジトリか調べて toplevel を返す（だめなら recent から外すこともある）
  // git で管理していないフォルダ（動画づくりなど）は、そのフォルダをそのまま返し、git なしのフォルダとして覚えておく
  const resolveRepoDir = async (picked, { forgetOnMissing = false } = {}) => {
    const fs = require('fs');
    if (!picked) throw new Error('パスが空です');
    if (!fs.existsSync(picked)) {
      if (forgetOnMissing) forgetRecentRepo(picked);
      throw new Error(`フォルダが見つかりません: ${picked}`);
    }
    if (!fs.statSync(picked).isDirectory()) throw new Error(`フォルダではありません: ${picked}`);
    const pw = wsl.parseWslPath(picked);
    const asFolder = () => {
      const dir = pw ? picked.replace(/[\\/]+$/, '') : path.resolve(picked);
      markNoGitRepo(store.settings, dir, true);
      return dir;
    };
    let top = '';
    try {
      top = wsl.fromLinux(picked, (await git.git(picked, ['rev-parse', '--show-toplevel'])).trim());
    } catch (err) {
      if (/not a git repository/i.test(err.message)) return asFolder();
      // このパソコンに git が入っていなくても、git なしのフォルダとしてなら開ける
      if (!pw && /ENOENT/.test(err.message)) return asFolder();
      if (pw && /not found|No such file|127/i.test(err.message)) throw new Error(`${pw.distro}（WSL）の中に git が見つかりません。${pw.distro} のターミナルで sudo apt install git を実行してください。\n${err.message}`);
      throw new Error(`git でフォルダを調べられませんでした（${picked}）\n${err.message}`);
    }
    if (!top) throw new Error(`git から答えが返ってきませんでした（${picked}）`);
    markNoGitRepo(store.settings, top, false);
    return top;
  };
  handle('repo:choose', async (opts = {}) => {
    const distro = opts && opts.wsl;
    const home = distro ? await wsl.homeDir(distro) : '';
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: distro ? `フォルダを選択（${distro}）` : 'フォルダを選択（git リポジトリ、または git で管理していないフォルダ）',
      ...(distro ? { defaultPath: wsl.toUnc(distro, home || '/home') } : {}),
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return openRepo(await resolveRepoDir(r.filePaths[0]), opts || {});
  });
  // 最近開いたリポジトリなど、すでにパスが分かっているものを開く（フォルダダイアログは出さない）
  handle('repo:open', async ({ path: dir, tab } = {}) => {
    const picked = String(dir || '').trim();
    return openRepo(await resolveRepoDir(picked, { forgetOnMissing: true }), { tab });
  });
  // フォルダの中のフォルダを返す。遠隔操作中に、ホストのフォルダを操作側の画面で辿って選ぶのに使う
  // path が空なら、今のリポジトリの親（WSL を選んだときはその中のホーム）→ ホームから始める
  handle('repo:browse', async ({ path: dir, wsl: distro, showHidden } = {}) => {
    let start = String(dir || '').trim();
    if (!start && distro) {
      const home = await wsl.homeDir(distro);
      start = wsl.toUnc(distro, home || '/');
    }
    if (!start) {
      const cur = store.settings.repoPath;
      start = cur && fs.existsSync(cur) ? (wsl.isWslPath(cur) ? path.win32 : path).dirname(cur) : app.getPath('home');
    }
    return { ...dirBrowse.listDirs(start, { showHidden: !!showHidden }), home: app.getPath('home') };
  });
  // リポジトリを開く（tab: 'new' なら新しいタブ、'replace' なら今のタブを置き換える。すでにタブにあればそのタブに移る）
  // 設定（ベースブランチ・取り込み方など）はプロジェクト（リポジトリ）ごとに覚えておき、開いたリポジトリの分に切り替える
  const { switchRepoSettings, hasRepoSettings, isNoGitRepo } = require('./src/store');
  const switchRepo = (dir, tabs) => {
    const s = store.settings;
    switchRepoSettings(s, dir);
    s.repoTabs = tabs;
  };
  // 初めて開いたプロジェクトは初期値から始める。取り込み方は PR を作成。ただし origin が GitHub でない・git なしなら直接マージ
  const initRepoSettings = async (dir) => {
    const gh = isNoGitRepo(store.settings, dir) ? false : await git.isGitHubRemote(dir).catch(() => false);
    if (gh) return;
    store.setRepoSettings(dir, { integration: 'merge' });
    store.save();
    notifyBoard();
  };
  const openRepo = (dir, { tab } = {}) => {
    const s = store.settings;
    const fresh = !!dir && !hasRepoSettings(s, dir);
    switchRepo(dir, openRepoTab(s.repoTabs, s.repoPath, dir, { mode: tab === 'replace' ? 'replace' : 'new' }));
    s.recentRepoPaths = touchRecentRepo(s.recentRepoPaths, dir);
    store.save();
    notifyBoard();
    if (fresh) initRepoSettings(dir).catch(() => {});
    return dir;
  };
  // タブを切り替える（タブにあるリポジトリだけ）
  handle('repo:switchTab', async ({ path: dir } = {}) => {
    const picked = String(dir || '').trim();
    if (!cleanRepoTabs(store.settings.repoTabs, store.settings.repoPath).includes(picked)) throw new Error('そのリポジトリはタブにありません');
    if (picked === store.settings.repoPath) return picked;
    return openRepo(await resolveRepoDir(picked));
  });
  // タブを閉じる。動いているタスクは止めない。今のタブを閉じたら隣のタブに移る
  // allowEmpty: 遠隔操作中に、片方の側（ホスト / このマシン）の最後のタブを閉じる（もう片方の側にタブが残るとき）
  handle('repo:closeTab', ({ path: dir, allowEmpty } = {}) => {
    const s = store.settings;
    const tabs = cleanRepoTabs(s.repoTabs, s.repoPath);
    if (tabs.length <= 1 && allowEmpty && tabs[0] === String(dir || '').trim()) {
      switchRepo('', []);
      store.save();
      notifyBoard();
      return '';
    }
    if (tabs.length <= 1) throw new Error('最後のタブは閉じられません');
    const r = closeRepoTab(tabs, s.repoPath, dir);
    switchRepo(r.next, r.tabs);
    store.save();
    notifyBoard();
    return r.next;
  });
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
  handle('repo:clone', async ({ url, parent, name, tab } = {}) => {
    const dir = await repoSetup.cloneRepo({ url, parent, name });
    store.settings.lastRepoParent = parent;
    markNoGitRepo(store.settings, dir, false);
    openRepo(dir, { tab });
    const warning = (await repoSetup.hasCommit(dir)) ? '' : 'クローンしましたが、このリポジトリにはコミットがまだありません。タスクを動かすには、最初のコミットを入れて push してください';
    return { dir, warning };
  });
  handle('repo:create', async ({ parent, name, github, git: useGit, tab } = {}) => {
    const r = await repoSetup.createRepo({ parent, name, github, git: useGit !== false });
    store.settings.lastRepoParent = parent;
    markNoGitRepo(store.settings, r.dir, useGit === false);
    openRepo(r.dir, { tab });
    return r;
  });
  handle('repo:info', async () => {
    const repo = store.settings.repoPath;
    if (!repo) return { branches: [], current: '' };
    if (require('./src/store').isNoGitRepo(store.settings, repo)) return { branches: [], current: '', hasOrigin: false, noGit: true };
    // git の起動は Windows だと遅いので、並べて走らせる
    const [branches, current, hasOrigin] = await Promise.all([
      git.branches(repo).catch(() => []),
      git.currentBranch(repo).catch(() => ''),
      git.hasRemote(repo, 'origin').catch(() => false),
    ]);
    return { branches, current, hasOrigin };
  });
  handle('settings:update', (patch) => {
    const allowed = ['baseBranch', 'permissionMode', 'allowedTools', 'model', 'claudePath', 'maxParallel', 'defaultSkill', 'integration', 'issueStatusSync', 'statusFieldName', 'statusMapping', 'suggestSkillsOnDone', 'deleteSessionsOnMerge', 'specCheck', 'subtaskMerge', 'branchNamingRule', 'defaultAgent', 'codexPath', 'codexModel', 'geminiPath', 'geminiModel', 'cursorPath', 'cursorModel', 'relaySteps', 'relayFlow', 'relayFlows', 'relayFlowId', 'competeAgents', 'competeCustomAgents', 'customAgents', 'orchestration', 'enabledAgents', 'weeklyResetDay', 'weeklyResetTime'];
    if (patch && 'branchNamingRule' in patch) patch = { ...patch, branchNamingRule: String(patch.branchNamingRule || '').trim() };
    if (patch && 'integration' in patch && !['merge', 'pr'].includes(patch.integration)) patch = { ...patch, integration: 'merge' };
    if (patch && 'suggestSkillsOnDone' in patch) patch = { ...patch, suggestSkillsOnDone: !!patch.suggestSkillsOnDone };
    if (patch && 'deleteSessionsOnMerge' in patch) patch = { ...patch, deleteSessionsOnMerge: !!patch.deleteSessionsOnMerge };
    if (patch && 'specCheck' in patch) patch = { ...patch, specCheck: !!patch.specCheck };
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
    // Pipeline（複数）: 一覧・既定の Pipeline・既定のフローを、そろえて保存する
    const relay = patch && require('./src/store').relayPatchOf(store.settings, patch);
    if (relay) patch = { ...patch, ...relay };
    if (patch && 'orchestration' in patch) patch = { ...patch, orchestration: providers.cleanOrchestration(patch.orchestration) };
    if (patch && 'competeAgents' in patch) patch = { ...patch, competeAgents: providers.cleanCompeteAgents(patch.competeAgents) };
    if (patch && 'customAgents' in patch) patch = { ...patch, customAgents: providers.cleanCustomAgents(patch.customAgents) };
    if (patch && 'competeCustomAgents' in patch) {
      const ids = new Set(((patch.customAgents || store.settings.customAgents) || []).map((x) => x.id));
      patch = { ...patch, competeCustomAgents: [...new Set((Array.isArray(patch.competeCustomAgents) ? patch.competeCustomAgents : []).map((v) => String(v || '').replace(/^custom:/, '')))].filter((id) => ids.has(id)) };
    }
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
  // 文章の指示から Pipeline のフローチャートを作る・直す（保存はしない。編集画面で確かめてから保存してもらう）
  handle('flow:generate', ({ request, flow, agent, enabled, customAgents } = {}) => {
    const use = providers.isAgent(agent) ? agent : 'claude';
    const cwd = store.settings.repoPath || require('os').homedir();
    const ask = (prompt) => agents.askOnce(use, cwd, prompt, undefined, 300000);
    return require('./src/flow-ai').generateFlow(ask, { request, flow, defaultAgent: use, enabled: providers.cleanEnabledAgents(enabled), customAgents: providers.cleanCustomAgents(customAgents) });
  });
  // Pipeline・カスタムエージェントのエクスポート・インポート（このマシンのファイル。遠隔操作中も、操作している側のマシンに保存する・から読む）
  // 中身（JSON・zip）を作る・読むのは画面（renderer/pipeline-pack.js）。ここはファイルを選んで書く・読むだけ
  const PACK_EXTS = ['json', 'zip'];
  handle('file:save', async ({ name, data, ext } = {}) => {
    const e = PACK_EXTS.includes(ext) ? ext : 'json';
    const base = String(name || 'pipeline').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 80) || 'pipeline';
    const r = await dialog.showSaveDialog(win, {
      title: e === 'zip' ? 'Pipelineとカスタムエージェントをまとめてエクスポート' : 'Pipelineをエクスポート',
      defaultPath: path.join(app.getPath('downloads'), base.endsWith(`.${e}`) ? base : `${base}.${e}`),
      filters: [e === 'zip' ? { name: 'zip', extensions: ['zip'] } : { name: 'Pipeline（JSON）', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const buf = Buffer.from(String(data || ''), 'base64');
    if (buf.length > 20 * 1024 * 1024) throw new Error('エクスポートするファイルが大きすぎます');
    fs.writeFileSync(r.filePath, buf);
    return { path: r.filePath };
  });
  handle('file:open', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Pipeline（.json）か、Pipelineとカスタムエージェントをまとめた zip を選択',
      properties: ['openFile'],
      filters: [{ name: 'Pipeline（.json / .zip）', extensions: PACK_EXTS }, { name: 'すべてのファイル', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('ファイルが大きすぎます（20MB まで）');
    return { name: path.basename(file), data: fs.readFileSync(file).toString('base64') };
  });
  // agent: claude / codex / gemini / cursor / relay（Pipeline） / compete（競争。カードが複数できる）。返すのは最初のカードの ID
  // fromChat: 会話の続きとしてタスクを作るときの、元の会話のカードの ID
  // attachments: 添付ファイル [{ name, mediaType, data(base64) }]
  // model: このタスク・会話で使うモデル（空なら設定のエージェントごとの既定）
  // readOnly: ソースを変更しないタスク（SQL を作るだけなど。worktree を作らず、ファイルを書き換えるツールを止める）
  handle('card:create', ({ title, prompt, autoStart, session, skill, agent, model, fromChat, attachments, readOnly }) => {
    const cards = agents.createTask({ title, prompt, session, skill, agent, model, fromChat, attachments, readOnly: !!readOnly });
    if (autoStart) for (const c of cards) agents.start(c.id);
    return cards[0].id;
  });
  handle('chat:create', ({ message, title, session, skill, agent, model, attachments }) => agents.createChat({ message, title, session, skill, agent, model, attachments }).id);
  handle('card:createFromIssues', async ({ numbers, extra, autoStart, session, skill, agent, model }) => {
    const { cards, errors } = await agents.createFromIssues({ numbers, extra, session, skill, agent, model });
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
    const target = require('./src/external-url').externalUrl(url);
    if (!target) throw new Error('開けない URL です');
    await shell.openExternal(target);
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
  handle('card:markSeen', (id) => agents.markSeen(id));
  handle('card:stop', (id) => agents.stop(id));
  handle('card:send', ({ id, message, skill, attachments }) => agents.send(id, message, skill, attachments));
  handle('compete:adopt', (id) => agents.adoptCompetitor(id));
  // サブタスク: 開始前に決める・提案に答える・確かめたサブタスクを親のブランチに取り込む
  handle('subtasks:set', ({ id, items, merge }) => agents.setSubtasks(id, { items, merge }));
  handle('subtasks:accept', ({ id, items, merge, createIssues }) => agents.acceptSubtasks(id, { items, merge, createIssues: !!createIssues }));
  handle('subtasks:decline', (id) => agents.declineSubtasks(id));
  handle('subtasks:approve', (id) => agents.approveSubtask(id));
  // サブタスクだけ開始する・状態をドラッグ&ドロップで変える・残りを自動で進める。ボードのカードの列を変える
  handle('subtasks:startOne', ({ id, key }) => agents.startSubtaskOnly(id, key));
  handle('subtasks:move', ({ id, key, to }) => agents.moveSubtask(id, key, to));
  handle('subtasks:auto', (id) => agents.autoRunSubtasks(id));
  handle('subtasks:edit', ({ id, key, title, prompt }) => agents.editSubtask(id, key, { title, prompt }));
  handle('card:move', ({ id, to }) => agents.moveCard(id, to));
  handle('compete:compare', (id) => agents.compareCompetitors(id).id);
  handle('card:suggestSkills', ({ id }) => agents.suggestSkills(id));
  handle('notifications:read', ({ ids } = {}) => agents.readNotifications(store.settings.repoPath, ids));
  handle('notifications:clear', ({ ids } = {}) => agents.clearNotifications(store.settings.repoPath, ids));
  handle('notifications:act', ({ id }) => agents.actNotification(id));
  handle('skills:list', async () => require('./src/skills').listSkills(store.settings.repoPath, { configDir: await claudeConfigFor(store.settings.repoPath) }));
  handle('card:btw', ({ id, text }) => agents.btw(id, text));
  handle('card:setSession', ({ id, session }) => agents.setSession(id, session));
  // 会話の一覧（このリポジトリとタスク用 worktree の会話だけ）。どのカードが使っているか（usedBy）も付ける
  handle('sessions:list', async () => {
    const usage = agents.sessionUsage();
    return require('./src/sessions')
      .listSessions(store.settings.repoPath, { configDir: await claudeConfigFor(store.settings.repoPath) })
      .filter((s) => s.related)
      .map((s) => ({ ...s, usedBy: usage.get(s.id) || [] }));
  });
  handle('sessions:delete', ({ ids } = {}) => agents.deleteSessions(ids));
  handle('card:logs', (id) => agents.logs(id));
  handle('card:diff', (id) => agents.diff(id));
  handle('card:worktree', (id) => agents.worktree(id));
  handle('card:merge', async ({ id, target, createNew, keep, push }) => {
    // push するかどうかはプロジェクトごとに覚えておき、次のマージでも同じにする
    const card = store.card(id);
    store.setRepoSettings((card && card.repoPath) || store.settings.repoPath, { pushAfterMerge: !!push });
    store.save();
    return agents.merge(id, { target, createNew, keep, push });
  });
  handle('card:pr', ({ id, base, title, body, keep }) => agents.createPullRequest(id, { base, title, body, keep }));
  handle('card:discard', (id) => agents.discard(id));
  handle('card:complete', (id) => agents.complete(id));
  handle('conflict:resolve', ({ id, mode }) => agents.resolveConflict(id, mode));
  handle('conflict:complete', (id) => agents.completeConflict(id));
  handle('conflict:abort', (id) => agents.abortConflict(id));
  handle('conflict:dismiss', (id) => agents.dismissConflict(id));
  handle('conflict:fromPr', (id) => agents.reopenPrConflict(id));
  handle('card:permission', ({ id, reqId, decision, message }) => agents.answerPermission(id, reqId, decision, message));
  handle('card:answer', ({ id, reqId, answers }) => agents.answerQuestion(id, reqId, answers));
  handle('card:open', async (id) => {
    const c = agents.must(id);
    const dir = c.noGit ? c.repoPath : c.worktreePath;
    if (!dir) throw new Error('worktree がありません');
    const err = await shell.openPath(dir);
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

  // 以前の版で保存したトークン（接続先1つ分）を、これまでの接続に移す
  if (store.settings.remoteClientToken && (store.settings.remoteClientMode === 'direct' || String(store.settings.remoteSshHost || '').trim()) && !findConnectionHistory(store.settings.remoteClientHistory, connectionKey(currentConnection()))) {
    store.settings.remoteClientHistory = upsertConnectionHistory(store.settings.remoteClientHistory, currentConnection(), { token: store.settings.remoteClientToken, at: 0 });
    store.save();
  }

  createWindow();
  // 前回クライアントとして接続したまま終えていたら、その接続を裏で再開する（自分で切断していたらしない）
  if (store.settings.remoteClientResume && !remoteHost?.listening()) resumeRemote();
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

// ---- アプリの更新 ----
function updateStatus() {
  return { ...updater.status(), autoUpdate: !!store.settings.autoUpdate, lastResult: updateResult, active: agents.activeCount(), quitting: quittingForUpdate };
}

// 入れ替えのスクリプトを起動して、アプリを終了する（終了するときに実行中のタスクは止めてブランチにコミットする）
function installUpdate() {
  const st = updater.install();
  store.settings.updatePending = { from: app.getVersion(), to: st.latestVersion, at: Date.now() };
  store.save();
  quittingForUpdate = true;
  send('update:changed', updateStatus());
  // 画面に「更新しています」を出してから終了する
  setTimeout(() => app.quit(), 800);
  return updateStatus();
}

// 「新しい版が出たら自動で更新する」: 実行中・待機中のタスクがないときだけ入れ替える（あれば、なくなるまで待つ）
function maybeAutoUpdate() {
  if (!store.settings.autoUpdate || quittingForUpdate || updater.status().state !== 'available') return;
  if (remoteClient?.connected) return; // 遠隔操作中は、勝手に切らない
  const { running, queued } = agents.activeCount();
  if (running || queued) return;
  try {
    installUpdate();
  } catch {
    /* 次に確かめたときにもう一度 */
  }
}

function setupUpdater(userData) {
  const logFile = path.join(userData, 'update.log');
  updater = new Updater({ currentVersion: app.getVersion(), packaged: app.isPackaged, logFile });
  // 前の起動で更新したなら、その結果を一度だけ知らせる
  const pending = store.settings.updatePending;
  if (pending && pending.to) {
    updateResult = { ok: app.getVersion() === pending.to, from: pending.from, to: pending.to, log: logFile };
    store.settings.updatePending = null;
    store.save();
  }
  updater.on('changed', () => {
    send('update:changed', updateStatus());
    maybeAutoUpdate();
  });
  updater.startAutoCheck();
  // 自動で更新する設定なら、タスクが終わって手が空いたときにも入れ替える
  setInterval(maybeAutoUpdate, 60000).unref?.();

  handle('update:status', () => updateStatus());
  handle('update:check', async () => {
    await updater.check();
    return updateStatus();
  });
  handle('update:install', () => installUpdate());
  handle('update:setAuto', (on) => {
    store.settings.autoUpdate = !!on;
    store.save();
    maybeAutoUpdate();
    return updateStatus();
  });
  handle('update:dismissResult', () => {
    updateResult = null;
    return updateStatus();
  });
  handle('update:openLog', () => shell.openPath(logFile));
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 2つ目のアプリが起動されかけたとき（そちらはすぐ終わる）は、新しいウィンドウを作らず、今のウィンドウを前に出す
app.on('second-instance', () => {
  if (!agents) return; // まだ起動の途中
  if (!win || win.isDestroyed()) {
    if (quitState === 'idle') createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// 実行中・待機中のタスクがあるときは、終了してよいか確かめる。
// 終了するときは claude を止めて作業内容をブランチにコミットしてから終わる（次の起動で「再開」できる）
app.on('before-quit', (e) => {
  if (quitState === 'done' || !agents) {
    store?.flush();
    permServer?.close();
    reconnector?.cancel();
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
      reconnector?.cancel();
      remoteClient?.disconnect();
      sshTunnel?.close();
      await remoteHost?.stop();
    } catch {
      /* */
    }
    quitState = 'done';
    app.quit();
  };
  if ((!running && !queued) || quittingForUpdate) return finish();
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
