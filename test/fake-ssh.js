// テスト用の ssh 代わり。-L 127.0.0.1:L:127.0.0.1:R を見て、L → R へ TCP を転送する
// FAKE_SSH_FAIL に文字列を入れると、それを標準エラーに出して終わる（ssh の失敗のまね）
const net = require('net');

const args = process.argv.slice(2);
if (process.env.FAKE_SSH_FAIL) {
  process.stderr.write(`${process.env.FAKE_SSH_FAIL}\n`);
  process.exit(255);
}
const spec = args[args.indexOf('-L') + 1] || '';
const m = spec.match(/^127\.0\.0\.1:(\d+):127\.0\.0\.1:(\d+)$/);
if (!m || !args.includes('-N') || !args.includes('BatchMode=yes')) {
  process.stderr.write(`bad args: ${args.join(' ')}\n`);
  process.exit(2);
}
const [, local, remote] = m;
const server = net.createServer((c) => {
  const up = net.connect({ host: '127.0.0.1', port: Number(remote) });
  c.pipe(up).pipe(c);
  up.on('error', () => c.destroy());
  c.on('error', () => up.destroy());
});
server.listen(Number(local), '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
