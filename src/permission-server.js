// permission-mcp.js からの問い合わせを受けるローカル HTTP サーバー（127.0.0.1 のみ、トークン必須）
const http = require('http');
const crypto = require('crypto');

class PermissionServer {
  // onRequest(payload, signal) => Promise<{behavior, updatedInput?, message?}>
  constructor(onRequest) {
    this.onRequest = onRequest;
    this.token = crypto.randomBytes(24).toString('hex');
    this.port = 0;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      // 承認はいくらでも待てるようにタイムアウトを無効化
      this.server.requestTimeout = 0;
      this.server.timeout = 0;
      this.server.on('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve();
      });
    });
  }

  // トークンの比較は、一致した文字数で時間が変わらないようにする
  validToken(got) {
    const a = Buffer.from(String(got || ''));
    const b = Buffer.from(this.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  handle(req, res) {
    if (req.method !== 'POST' || req.url !== '/permission' || !this.validToken(req.headers['x-kanban-token'])) {
      res.writeHead(403).end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => {
      body += d;
      if (body.length > 10 * 1024 * 1024) req.destroy();
    });
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      // claude が止められて MCP プロセスが死んだら、接続が切れるので保留中の承認を取り消す
      const ac = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) ac.abort();
      });
      let decision;
      try {
        decision = await this.onRequest(payload, ac.signal);
      } catch (err) {
        decision = { behavior: 'deny', message: err.message };
      }
      if (!res.destroyed) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(decision));
      }
    });
  }

  close() {
    this.server?.close();
  }
}

module.exports = { PermissionServer };
