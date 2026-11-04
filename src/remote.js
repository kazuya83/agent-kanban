// Agent Kanban 同士の遠隔操作（SSH トンネル前提）
// - ホスト: 127.0.0.1 で TCP 待ち受け。改行区切り JSON
// - クライアント: トンネル先（通常は 127.0.0.1:port）へ接続し、ペアリングコードまたはトークンで認証
// - 認証後、ボード操作用の invoke と、board:changed などの event を中継する
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

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
const SECRET_SETTINGS = ['remotePairTokens', 'remoteClientToken'];

// board:get / board:changed などで渡すボードから、秘密の設定を抜く
function redactForRemote(data) {
  if (!data || typeof data !== 'object' || !data.settings || typeof data.settings !== 'object') return data;
  const settings = { ...data.settings };
  for (const k of SECRET_SETTINGS) delete settings[k];
  return { ...data, settings };
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
  'repo:browse',
  'repo:defaultParent',
  'repo:clone',
  'repo:create',
  'repo:info',
  'settings:update',
  'card:create',
  'chat:create',
  'card:createFromIssues',
  'repo:github',
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
  'card:suggestSkills',
  'notifications:read',
  'notifications:clear',
  'notifications:act',
  'skills:list',
  'card:btw',
  'card:setSession',
  'sessions:list',
  'card:logs',
  'card:diff',
  'card:worktree',
  'card:merge',
  'card:pr',
  'card:discard',
  'conflict:resolve',
  'conflict:complete',
  'conflict:abort',
  'conflict:dismiss',
  'conflict:fromPr',
  'card:permission',
  'card:answer',
  // card:open（ホストの Finder を開く）も操作側では見えないので転送しない
]);

// 遠隔に接続中でも、操作側のマシンで動かすチャンネル（それ以外の非転送チャンネルは接続中は使えない）
function isLocalChannel(channel) {
  return channel === 'app:info' || channel === 'open:external' || String(channel).startsWith('remote:');
}

function isProxyChannel(channel) {
  return PROXY_CHANNELS.has(channel);
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
          send(socket, { id, type: 'result', ok: false, error: 'ペアリングコードが違うか、期限切れです。ホスト側で新しいコードを出してください' });
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
          send(socket, { id, type: 'result', ok: false, code: 'BAD_TOKEN', error: 'トークンが無効です。もう一度ペアリングしてください' });
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
        send(socket, { id, type: 'result', ok: false, error: '先にペアリングまたは認証してください' });
        return;
      }
      if (msg.type === 'invoke') {
        const channel = String(msg.channel || '');
        if (!isProxyChannel(channel)) {
          send(socket, { id, type: 'result', ok: false, error: `この操作は遠隔では使えません: ${channel}` });
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
            throw new Error('ペアリングコードかトークンが必要です');
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
        this.failPending('ホストとの接続が切れました');
        this.socket = null;
        this.connected = false;
        if (was) this.emit('disconnected');
        this.emit('changed');
      });
    });
  }

  disconnect() {
    this.failPending('切断しました');
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

  failPending(message) {
    for (const [, p] of this.pending) p.reject(new Error(message));
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
        const err = new Error(msg.error || '遠隔操作に失敗しました');
        if (msg.code) err.code = msg.code;
        p.reject(err);
      }
    }
  }

  request(fields) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) return reject(new Error('ホストに接続していません'));
      this.pending.set(id, { resolve, reject });
      send(this.socket, { id, ...fields });
    });
  }

  invoke(channel, arg) {
    if (!this.connected) return Promise.reject(new Error('ホストに接続していません'));
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

module.exports = {
  RECONNECT_DELAYS_MS,
  Reconnector,
  DEFAULT_PORT,
  PAIR_TTL_MS,
  PROXY_CHANNELS,
  isProxyChannel,
  isLocalChannel,
  redactForRemote,
  MAX_PAIR_FAILURES,
  RemoteHost,
  RemoteClient,
  genPairCode,
  genToken,
  timingEqual,
};
