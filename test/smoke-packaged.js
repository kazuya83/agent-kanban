// パッケージしたアプリを実際に起動して、画面がちゃんと出るかを確かめる（CI 用）
//   node test/smoke-packaged.js <アプリの実行ファイル> [スクリーンショットの保存先]
// 画面に Worktree Kanban のボードが出ていなければ失敗にする。
const path = require('path');
const fs = require('fs');
const os = require('os');

let electron;
try {
  electron = require('playwright-core')._electron;
} catch {
  electron = require('playwright')._electron;
}

(async () => {
  const exe = process.argv[2];
  const shot = process.argv[3] || 'smoke.png';
  if (!exe || !fs.existsSync(exe)) throw new Error(`実行ファイルが見つかりません: ${exe}`);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-smoke-'));
  console.log('launching:', exe);
  const app = await electron.launch({
    executablePath: exe,
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    timeout: 60000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d) => process.stdout.write(`[app stdout] ${d}`));
  proc.stderr?.on('data', (d) => process.stdout.write(`[app stderr] ${d}`));
  const info = await app.evaluate(({ app: a }) => ({ appPath: a.getAppPath(), userData: a.getPath('userData'), version: a.getVersion(), packaged: a.isPackaged }));
  console.log('app:', JSON.stringify(info));
  console.log('launched; waiting for the first window…');
  const win = await app.firstWindow({ timeout: 60000 });
  await win.waitForTimeout(4000);
  const url = win.url();
  const title = await win.title();
  const text = (await win.evaluate(() => document.body && document.body.innerText)) || '';
  const hasBoard = await win.evaluate(() => !!document.querySelector('.topbar .brand'));
  console.log('url:', url);
  console.log('title:', title);
  console.log('body:', text.slice(0, 300).replace(/\n/g, ' | '));
  console.log('has board UI:', hasBoard);
  await win.screenshot({ path: shot });
  await app.close();
  fs.rmSync(home, { recursive: true, force: true });
  if (!hasBoard) {
    console.error('NG: アプリの画面が表示されていません');
    process.exit(1);
  }
  console.log('OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
