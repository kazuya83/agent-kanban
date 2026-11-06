// Worktree Kanban 同士の遠隔操作（SSH トンネル前提）
// - ホスト: 127.0.0.1 で TCP 待ち受け。改行区切り JSON
// - クライアント: トンネル先（通常は 127.0.0.1:port）へ接続し、ペアリングコードまたはトークンで認証
// - 認証後、ボード操作用の invoke と、board:changed などの event を中継する
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const I18n = require('../renderer/i18n');
const { tr } = I18n;

const DEFAULT_PORT = 17831;
const PAIR_TTL_MS = 10 * 60 * 1000;
const MAX_LINE = 32 * 1024 * 1024;
// 6 桁コードの総当たりを防ぐ: これだけ間違えたらコードを無効にする（ホスト側で再発行）
const MAX_PAIR_FAILURES = 5;
// 認証しないまま居座る接続は切る
const AUTH_TIMEOUT_MS = 30 * 1000;
// クライアントの TCP 接続を待つ長さ
const CONNECT_TIMEOUT_MS = 10 * 1000;
// 遠隔へ渡さない設定（トークンなどの秘密）
const SECRET_SETTINGS = ['remotePairTokens', 'remoteClientToken', 'remoteClientHistory'];
// マシンごとの設定。ホストへ転送しない（ホストのエラー文はホストの言語のまま）
const LOCAL_SETTINGS = ['language'];

// 設定オブジェクトから、秘密とマシンごとの項目を抜いたコピー（元は変えない）
function withoutMachineSettings(settings) {
  const out = { ...settings };
  for (const k of SECRET_SETTINGS) delete out[k];
  for (const k of LOCAL_SETTINGS) delete out[k];
  return out;
}

// board:get / board:changed のボードと、settings:update が返す設定そのものから、秘密とマシンごとの項目を抜く
function redactForRemote(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
    return { ...data, settings: withoutMachineSettings(data.settings) };
  }
  // settings:update の戻り値は設定オブジェクトそのもの（data.settings が無い）
  if (SECRET_SETTINGS.some((k) => k in data) || LOCAL_SETTINGS.some((k) => k in data)) return withoutMachineSettings(data);
  return data;
}

// 操作側が受け取った settings:update の戻り値に、このマシンの言語を入れ直す
// （ホストは language を載せない。載せてしまっても、手元の言語で上書きする）
function restoreLocalLanguage(data, localSettings) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (!localSettings || typeof localSettings !== 'object' || Array.isArray(localSettings)) return data;
  if (!I18n.isLanguage(localSettings.language)) return data;
  return { ...data, language: localSettings.language };
}

// ホストへ送る設定の更新から、このマシンだけの項目を外す
function stripLocalSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  if (!LOCAL_SETTINGS.some((k) => k in patch)) return patch;
  const out = { ...patch };
  for (const k of LOCAL_SETTINGS) delete out[k];
  return out;
}

function genPairCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

function timingEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readLines(socket, onLine) {
  let buf = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > MAX_LINE) {
      socket.destroy();
      return;
    }
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) {
        try {
          onLine(JSON.parse(line));
        } catch {
          /* 壊れた行は無視 */
        }
      }
    }
  });
}

function send(socket, obj) {
  if (!socket || socket.destroyed) return;
  try {
    socket.write(`${JSON.stringify(obj)}\n`);
  } catch {
    /* 切断済み */
  }
}

// クライアントからホストへ転送してよいチャンネル（遠隔のボード操作）
const PROXY_CHANNELS = new Set([
  'board:get',
  'env:check',
  'wsl:distros',
  // repo:choose / repo:chooseParent はホストの画面にダイアログが出て、操作側からは閉じられないので転送しない。
  // 代わりに、ホストのフォルダを操作側の画面で辿る repo:browse と、パスを指定して開く repo:open を転送する
  'repo:open',
  'repo:switchTab',
  'repo:closeTab',
  'repo:browse',
  'repo:defaultParent',
  'repo:clone',
  'repo:create',
  'repo:info',
  'settings:update',
  'flow:generate',
  'card:create',
  'chat:create',
  'card:createFromIssues',
  'repo:github',
  // 連携の設定はホストの分（Issue を読むのはホスト）。ホストのトークンの値はどのチャンネルでも返さない
  'trackers:list',
  'trackers:save',
  'trackers:remove',
  'trackers:test',
  'gh:status',
  'gh:install',
  'gh:login',
  'gh:addProjectScope',
  'gh:cancel',
  'card:update',
  'card:start',
  'card:resume',
  'card:resumeAll',
  'card:dismissInterrupted',
  'card:stop',
  'card:send',
  'compete:adopt',
  'compete:compare',
  'subtasks:set',
  'subtasks:accept',
  'subtasks:decline',
  'subtasks:approve',
  'subtasks:startOne',
  'subtasks:move',
  'subtasks:auto',
  'subtasks:edit',
  'card:move',
  'card:suggestSkills',
  'notifications:read',
  'notifications:clear',
  'notifications:act',
  // スケジュールはホストのアプリの中で動くので、登録も実行もホストで行う
  'schedules:create',
  'schedules:update',
  'schedules:delete',
  'schedules:run',
  'skills:list',
  'card:btw',
  'card:setSession',
  'sessions:list',
  'sessions:delete',
  'card:logs',
  'card:diff',
  'card:worktree',
  'card:scripts',
  'card:runScript',
  'card:stopScript',
  'card:merge',
  'card:pr',
  'card:discard',
  'card:complete',
  'conflict:resolve',
  'conflict:complete',
  'conflict:abort',
  'conflict:dismiss',
  'conflict:fromPr',
  'ci:fix',
  'card:permission',
  'card:answer',
  // チャットを開くと画面が自動で既読にするので、転送しないと遠隔中に毎回エラーが出る
  'card:markSeen',
  // card:open（ホストの Finder を開く）も操作側では見えないので転送しない
]);

// 遠隔に接続中でも、操作側のマシンで動かすチャンネル（それ以外の非転送チャンネルは接続中は使えない）
function isLocalChannel(channel) {
  return channel === 'app:info' || channel === 'app:language' || channel === 'app:setLanguage' || channel === 'open:external' || String(channel).startsWith('file:') || String(channel).startsWith('remote:') || String(channel).startsWith('update:');
}

function isProxyChannel(channel) {
  return PROXY_CHANNELS.has(channel);
}

// クライアントとして接続中に、リポジトリを追加する操作で「ホスト / このマシン」を選べるチャンネル（arg.target）
const TARGET_CHANNELS = new Set(['repo:open', 'repo:choose', 'repo:browse', 'repo:defaultParent', 'repo:chooseParent', 'repo:clone', 'repo:create', 'wsl:distros']);
// タブの操作。arg.remote でホストのタブ（true）か、このマシンのタブ（false）かを選ぶ
const TAB_CHANNELS = new Set(['repo:switchTab', 'repo:closeTab']);
// うまくいったら、見ている側をその側に変えるチャンネル（リポジトリを開いた・タブを切り替えた）
const VIEW_CHANNELS = new Set(['repo:open', 'repo:choose', 'repo:switchTab', 'repo:clone', 'repo:create']);

// その操作を、ホスト（'host'）とこのマシン（'local'）のどちらで行うか。view は今見ているタブの側
function routeSide(channel, arg, view = 'host') {
  const a = arg && typeof arg === 'object' ? arg : {};
  if (TAB_CHANNELS.has(channel) && typeof a.remote === 'boolean') return a.remote ? 'host' : 'local';
  if (TARGET_CHANNELS.has(channel) && (a.target === 'host' || a.target === 'local')) return a.target;
  return view === 'local' ? 'local' : 'host';
}

// ホストへ送る前に、どちらで行うかの印を外す
function stripRouting(arg) {
  if (!arg || typeof arg !== 'object' || Array.isArray(arg)) return arg;
  if (!('target' in arg) && !('remote' in arg)) return arg;
  const { target, remote, ...rest } = arg;
  return rest;
}

// 画面に出すボード: 見ている側のボードに、ホストのタブ（remote: true）とこのマシンのタブ（remote: false）を並べる
// host が null なら（接続していない）、このマシンのタブだけ
function composeTabs(host, local, view = 'host') {
  const side = (board, remote, on) => {
    const cur = (board && board.settings && board.settings.repoPath) || '';
    return ((board && board.repoTabs) || []).filter((t) => t && t.path).map((t) => ({ ...t, remote, active: on && t.path === cur }));
  };
  // 古い版のホストのボードには schedules がない
  const withSchedules = (board) => ({ ...board, schedules: Array.isArray(board.schedules) ? board.schedules : [] });
  if (!host) return withSchedules({ ...local, repoTabs: side(local, false, true) });
  const v = view === 'local' ? 'local' : 'host';
  const base = v === 'local' ? local : host;
  return {
    ...withSchedules(base),
    repoTabs: [...side(host, true, v === 'host'), ...side(local, false, v === 'local')],
    // リポジトリを選ぶ画面で、側ごとの「最近開いたリポジトリ」を出すため
    recentBySide: { host: (host.settings && host.settings.recentRepoPaths) || [], local: (local.settings && local.settings.recentRepoPaths) || [] },
  };
}

class RemoteHost extends EventEmitter {
  // invoke(channel, arg) => Promise<any>
  // tokens: 永続化したペアリング済みトークン（配列）
  // onTokens(tokens): トークンが増えた・消えたときに呼ぶ
  constructor({ invoke, port = DEFAULT_PORT, tokens = [], onTokens } = {}) {
    super();
    this.invoke = invoke;
    this.port = port;
    this.tokens = new Set((tokens || []).filter(Boolean));
    this.onTokens = onTokens;
    this.server = null;
    this.clients = new Set();
    this.pairCode = null;
    this.pairExpiresAt = 0;
    this.pairFailures = 0;
  }

  listening() {
    return !!this.server;
  }

  status() {
    return {
      listening: this.listening(),
      port: this.port,
      pairCode: this.pairCode && Date.now() < this.pairExpiresAt ? this.pairCode : null,
      pairExpiresAt: this.pairCode && Date.now() < this.pairExpiresAt ? this.pairExpiresAt : 0,
      pairedCount: this.tokens.size,
      clients: this.clients.size,
    };
  }

  refreshPairCode() {
    this.pairCode = genPairCode();
    this.pairExpiresAt = Date.now() + PAIR_TTL_MS;
    this.pairFailures = 0;
    this.emit('changed');
    return { pairCode: this.pairCode, pairExpiresAt: this.pairExpiresAt };
  }

  clearPairs() {
    this.tokens.clear();
    this.onTokens?.([]);
    for (const c of [...this.clients]) c.destroy();
    this.clients.clear();
    this.emit('changed');
  }

  start(port = this.port) {
    if (this.server) return Promise.resolve(this.status());
    // 0 なら OS が空きポートを選ぶ（テスト用）。それ以外は 1024–65535
    const n = parseInt(port, 10);
    const listenPort = n === 0 ? 0 : Math.min(65535, Math.max(1024, n || DEFAULT_PORT));
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.accept(socket));
      server.on('error', (err) => {
        if (!this.server) reject(err);
        // 'error' の聞き手がいないと例外でメインプロセスが落ちるので、いるときだけ流す
        else if (this.listenerCount('error')) this.emit('error', err);
      });
      server.listen(listenPort, '127.0.0.1', () => {
        this.port = server.address().port;
        this.server = server;
        this.refreshPairCode();
        this.emit('changed');
        resolve(this.status());
      });
    });
  }

  stop() {
    for (const c of [...this.clients]) c.destroy();
    this.clients.clear();
    this.pairCode = null;
    this.pairExpiresAt = 0;
    const s = this.server;
    this.server = null;
    return new Promise((resolve) => {
      if (!s) return resolve();
      s.close(() => {
        this.emit('changed');
        resolve();
      });
    });
  }

  accept(socket) {
    let authed = false;
    const authedSockets = this.clients;
    const authTimer = setTimeout(() => {
      if (!authed) socket.destroy();
    }, AUTH_TIMEOUT_MS);
    authTimer.unref?.();
    readLines(socket, async (msg) => {
      if (!msg || typeof msg !== 'object') return;
      const id = msg.id;
      if (msg.type === 'pair') {
        const code = String(msg.code || '').trim();
        if (!this.pairCode || Date.now() >= this.pairExpiresAt || !timingEqual(code, this.pairCode)) {
          if (this.pairCode && ++this.pairFailures >= MAX_PAIR_FAILURES) {
            this.pairCode = null;
            this.pairExpiresAt = 0;
            this.emit('changed');
          }
          send(socket, { id, type: 'result', ok: false, error: tr('ペアリングコードが違うか、期限切れです。ホスト側で新しいコードを出してください') });
          return;
        }
        const token = genToken();
        this.tokens.add(token);
        this.onTokens?.([...this.tokens]);
        this.pairCode = null;
        this.pairExpiresAt = 0;
        this.pairFailures = 0;
        authed = true;
        clearTimeout(authTimer);
        authedSockets.add(socket);
        send(socket, { id, type: 'result', ok: true, data: { token, port: this.port } });
        this.emit('changed');
        return;
      }
      if (msg.type === 'auth') {
        const token = String(msg.token || '');
        const ok = [...this.tokens].some((t) => timingEqual(token, t));
        if (!ok) {
          send(socket, { id, type: 'result', ok: false, code: 'BAD_TOKEN', error: tr('トークンが無効です。もう一度ペアリングしてください') });
          return;
        }
        authed = true;
        clearTimeout(authTimer);
        authedSockets.add(socket);
        send(socket, { id, type: 'result', ok: true, data: { port: this.port } });
        this.emit('changed');
        return;
      }
      if (!authed) {
        send(socket, { id, type: 'result', ok: false, error: tr('先にペアリングまたは認証してください') });
        return;
      }
      if (msg.type === 'invoke') {
        const channel = String(msg.channel || '');
        if (!isProxyChannel(channel)) {
          send(socket, { id, type: 'result', ok: false, error: tr('この操作は遠隔では使えません: {channel}', { channel }) });
          return;
        }
        try {
          const data = redactForRemote(await this.invoke(channel, msg.arg));
          send(socket, { id, type: 'result', ok: true, data });
        } catch (err) {
          send(socket, { id, type: 'result', ok: false, error: (err && err.message) || String(err) });
        }
      }
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      authedSockets.delete(socket);
      this.emit('changed');
    });
    socket.on('error', () => {});
  }

  // 認証済みクライアントへイベントを配信
  broadcast(channel, payload) {
    if (!this.clients.size) return;
    const msg = { type: 'event', channel, payload: redactForRemote(payload) };
    for (const s of this.clients) send(s, msg);
  }
}

class RemoteClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.pending = new Map();
    this.nextId = 1;
    this.host = '127.0.0.1';
    this.port = DEFAULT_PORT;
    this.token = '';
    this.connected = false;
  }

  status() {
    return {
      connected: this.connected,
      host: this.host,
      port: this.port,
      hasToken: !!this.token,
    };
  }

  connect({ host = '127.0.0.1', port = DEFAULT_PORT, code = '', token = '', timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      this.disconnect();
      this.host = String(host || '127.0.0.1').trim() || '127.0.0.1';
      this.port = Math.min(65535, Math.max(1024, parseInt(port, 10) || DEFAULT_PORT));
      const socket = net.connect({ host: this.host, port: this.port }, async () => {
        clearTimeout(connectTimer);
        this.socket = socket;
        readLines(socket, (msg) => this.onMessage(msg));
        try {
          let data;
          if (code) {
            data = await this.request({ type: 'pair', code: String(code).trim() });
            this.token = data.token;
          } else if (token) {
            this.token = token;
            data = await this.request({ type: 'auth', token });
          } else {
            throw new Error(tr('ペアリングコードかトークンが必要です'));
          }
          this.connected = true;
          this.emit('changed');
          resolve({ token: this.token, ...data });
        } catch (err) {
          this.disconnect();
          reject(err);
        }
      });
      // OS の既定（Windows で 20 秒ほど）まで待たずに、届かないことを知らせる
      const connectTimer = setTimeout(() => {
        const err = new Error(`connect ETIMEDOUT ${this.host}:${this.port}`);
        err.code = 'ETIMEDOUT';
        socket.destroy(err);
      }, timeoutMs);
      connectTimer.unref?.();
      socket.on('error', (err) => {
        clearTimeout(connectTimer);
        if (!this.connected) reject(err);
        else if (this.listenerCount('error')) this.emit('error', err);
      });
      socket.on('close', () => {
        // 再接続で入れ替わった古いソケットの close は、新しい接続の状態を消さない
        if (this.socket && this.socket !== socket) return;
        const was = this.connected;
        this.failPending(tr('ホストとの接続が切れました'), 'ECONNRESET');
        this.socket = null;
        this.connected = false;
        if (was) this.emit('disconnected');
        this.emit('changed');
      });
    });
  }

  disconnect() {
    this.failPending(tr('切断しました'));
    const s = this.socket;
    this.socket = null;
    this.connected = false;
    if (s) {
      try {
        s.destroy();
      } catch {
        /* */
      }
    }
    this.emit('changed');
  }

  failPending(message, code) {
    for (const [, p] of this.pending) {
      const err = new Error(message);
      if (code) err.code = code;
      p.reject(err);
    }
    this.pending.clear();
  }

  onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'event') {
      this.emit('event', msg.channel, msg.payload);
      return;
    }
    if (msg.type === 'result' && msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.data);
      else {
        const err = new Error(msg.error || tr('遠隔操作に失敗しました'));
        if (msg.code) err.code = msg.code;
        p.reject(err);
      }
    }
  }

  request(fields) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) return reject(new Error(tr('ホストに接続していません')));
      this.pending.set(id, { resolve, reject });
      send(this.socket, { id, ...fields });
    });
  }

  invoke(channel, arg) {
    if (!this.connected) return Promise.reject(new Error(tr('ホストに接続していません')));
    return this.request({ type: 'invoke', channel, arg });
  }
}

// 前回の接続を再開する（起動時・切れたとき）。間をあけて何度かつなぎ直す
// connect() => Promise。投げたエラーに fatal: true があれば、それ以上は試さない（トークンが無効など）
const RECONNECT_DELAYS_MS = [0, 2000, 5000, 10000, 20000, 30000];

class Reconnector extends EventEmitter {
  constructor({ connect, delays = RECONNECT_DELAYS_MS } = {}) {
    super();
    this.connect = connect;
    this.delays = delays;
    this.timer = null;
    this.attempt = 0;
    this.nextAt = 0;
    this.running = false; // 試している最中
    this.lastError = '';
    this.gen = 0;
  }

  active() {
    return !!this.timer || this.running;
  }

  status() {
    if (!this.active()) return null;
    return { attempt: this.attempt, max: this.delays.length, nextAt: this.timer ? this.nextAt : 0, lastError: this.lastError };
  }

  start() {
    if (this.active()) return;
    this.gen++;
    this.attempt = 0;
    this.lastError = '';
    this.schedule();
  }

  cancel() {
    this.gen++;
    clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
    this.attempt = 0;
    this.emit('changed');
  }

  schedule() {
    const gen = this.gen;
    const wait = this.delays[this.attempt] || 0;
    this.nextAt = Date.now() + wait;
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (gen !== this.gen) return;
      this.running = true;
      this.attempt++;
      this.emit('changed');
      try {
        await this.connect();
        if (gen !== this.gen) return;
        this.running = false;
        this.lastError = '';
        this.emit('changed');
        this.emit('connected');
      } catch (err) {
        if (gen !== this.gen) return;
        this.running = false;
        this.lastError = (err && err.message) || String(err);
        if (err?.fatal || this.attempt >= this.delays.length) {
          this.emit('changed');
          this.emit('failed', err);
          return;
        }
        this.schedule();
        this.emit('changed');
      }
    }, wait);
    this.timer.unref?.();
  }
}

// ---- これまでつないだ接続先（クライアント側）。RC設定でカードにして、選んでつなぎ直せるようにする ----
const MAX_CONNECTION_HISTORY = 10;

// 接続先の中身（設定の値から）。トークンは別に持つ
function normalizeConnection(c = {}) {
  const mode = c.mode === 'direct' ? 'direct' : 'ssh';
  return {
    mode,
    host: String(c.host || '127.0.0.1').trim() || '127.0.0.1',
    port: parseInt(c.port, 10) || DEFAULT_PORT,
    sshHost: String(c.sshHost || '').trim(),
    sshUser: String(c.sshUser || '').trim(),
    sshPort: parseInt(c.sshPort, 10) || 22,
    sshKey: String(c.sshKey || '').trim(),
    sshPath: String(c.sshPath || '').trim() || 'ssh',
  };
}

// 同じ接続先かどうかの目印（鍵や ssh コマンドが変わっても同じ接続先とみなす）
function connectionKey(c = {}) {
  const n = normalizeConnection(c);
  return n.mode === 'direct' ? `direct|${n.host.toLowerCase()}|${n.port}` : `ssh|${n.sshUser}@${n.sshHost.toLowerCase()}:${n.sshPort}|${n.port}`;
}

// つながった接続先を、いちばん前に入れる（同じ接続先は置き換える）
function upsertConnectionHistory(list, conn, { token = '', at = Date.now(), max = MAX_CONNECTION_HISTORY } = {}) {
  const n = normalizeConnection(conn);
  const id = connectionKey(n);
  const prev = (Array.isArray(list) ? list : []).filter((e) => e && typeof e === 'object');
  const old = prev.find((e) => connectionKey(e) === id);
  const entry = { ...n, id, token: token || old?.token || '', lastConnectedAt: at };
  return [entry, ...prev.filter((e) => connectionKey(e) !== id)].slice(0, max);
}

function removeConnectionHistory(list, id) {
  return (Array.isArray(list) ? list : []).filter((e) => e && connectionKey(e) !== id);
}

function findConnectionHistory(list, id) {
  return (Array.isArray(list) ? list : []).find((e) => e && connectionKey(e) === id) || null;
}

// 画面に渡す形（トークンは渡さない）
function publicConnectionHistory(list) {
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({ ...normalizeConnection(e), id: connectionKey(e), hasToken: !!e.token, lastConnectedAt: e.lastConnectedAt || 0 }));
}

// 保存を頼んだ設定のうち、保存先（ホスト）が受け取らなかった項目
// 古い版のホストは知らない設定を黙って捨てるので、返ってきた設定に無い項目を探す
function settingLabel(k) {
  if (k === 'customAgents') return tr('カスタムエージェント');
  if (k === 'issueProvider') return tr('使う課題管理サービス');
  if (k === 'relayFlow') return tr('Pipelineのフローチャート');
  if (k === 'relayFlows') return tr('Pipelineの一覧');
  if (k === 'relayFlowId') return tr('既定のPipeline');
  if (k === 'competeCustomAgents') return tr('競争させるカスタムエージェント');
  if (k === 'enabledAgents') return tr('使うエージェント');
  if (k === 'orchestration') return tr('オーケストレーション');
  return k;
}
function droppedSettingKeys(patch, result) {
  if (!patch || typeof patch !== 'object' || !result || typeof result !== 'object') return [];
  return Object.keys(patch).filter((k) => patch[k] !== undefined && result[k] === undefined);
}
function droppedSettingsMessage(keys) {
  const sep = I18n.getLanguage() === 'ja' || I18n.getLanguage() === 'zh' ? '、' : ', ';
  const names = [...new Set(keys.map((k) => settingLabel(k)))];
  return tr('ホストの Worktree Kanban の版が古いため、次の設定を保存できませんでした: {names}。ホストのアプリを新しい版に更新してから、もう一度保存してください。', { names: names.join(sep) });
}

module.exports = {
  droppedSettingKeys,
  droppedSettingsMessage,
  stripLocalSettings,
  LOCAL_SETTINGS,
  MAX_CONNECTION_HISTORY,
  normalizeConnection,
  connectionKey,
  upsertConnectionHistory,
  removeConnectionHistory,
  findConnectionHistory,
  publicConnectionHistory,
  RECONNECT_DELAYS_MS,
  Reconnector,
  DEFAULT_PORT,
  PAIR_TTL_MS,
  PROXY_CHANNELS,
  isProxyChannel,
  isLocalChannel,
  routeSide,
  stripRouting,
  composeTabs,
  VIEW_CHANNELS,
  redactForRemote,
  restoreLocalLanguage,
  MAX_PAIR_FAILURES,
  RemoteHost,
  RemoteClient,
  genPairCode,
  genToken,
  timingEqual,
};
