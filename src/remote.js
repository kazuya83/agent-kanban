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
  'repo:choose',
  'repo:defaultParent',
  'repo:chooseParent',
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
  'card:open',
]);

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
        else this.emit('error', err);
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
    readLines(socket, async (msg) => {
      if (!msg || typeof msg !== 'object') return;
      const id = msg.id;
      if (msg.type === 'pair') {
        const code = String(msg.code || '').trim();
        if (!this.pairCode || Date.now() >= this.pairExpiresAt || !timingEqual(code, this.pairCode)) {
          send(socket, { id, type: 'result', ok: false, error: 'ペアリングコードが違うか、期限切れです。ホスト側で新しいコードを出してください' });
          return;
        }
        const token = genToken();
        this.tokens.add(token);
        this.onTokens?.([...this.tokens]);
        this.pairCode = null;
        this.pairExpiresAt = 0;
        authed = true;
        authedSockets.add(socket);
        send(socket, { id, type: 'result', ok: true, data: { token, port: this.port } });
        this.emit('changed');
        return;
      }
      if (msg.type === 'auth') {
        const token = String(msg.token || '');
        const ok = [...this.tokens].some((t) => timingEqual(token, t));
        if (!ok) {
          send(socket, { id, type: 'result', ok: false, error: 'トークンが無効です。もう一度ペアリングしてください' });
          return;
        }
        authed = true;
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
          const data = await this.invoke(channel, msg.arg);
          send(socket, { id, type: 'result', ok: true, data });
        } catch (err) {
          send(socket, { id, type: 'result', ok: false, error: (err && err.message) || String(err) });
        }
      }
    });
    socket.on('close', () => {
      authedSockets.delete(socket);
      this.emit('changed');
    });
    socket.on('error', () => {});
  }

  // 認証済みクライアントへイベントを配信
  broadcast(channel, payload) {
    const msg = { type: 'event', channel, payload };
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

  connect({ host = '127.0.0.1', port = DEFAULT_PORT, code = '', token = '' } = {}) {
    return new Promise((resolve, reject) => {
      this.disconnect();
      this.host = String(host || '127.0.0.1').trim() || '127.0.0.1';
      this.port = Math.min(65535, Math.max(1024, parseInt(port, 10) || DEFAULT_PORT));
      const socket = net.connect({ host: this.host, port: this.port }, async () => {
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
      socket.on('error', (err) => {
        if (!this.connected) reject(err);
        else this.emit('error', err);
      });
      socket.on('close', () => {
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
      else p.reject(new Error(msg.error || '遠隔操作に失敗しました'));
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

module.exports = {
  DEFAULT_PORT,
  PAIR_TTL_MS,
  PROXY_CHANNELS,
  isProxyChannel,
  RemoteHost,
  RemoteClient,
  genPairCode,
  genToken,
  timingEqual,
};
