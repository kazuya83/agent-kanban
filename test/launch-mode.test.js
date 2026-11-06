const test = require('node:test');
const assert = require('node:assert');
const { isMcpLaunch } = require('../src/launch-mode');

test('承認用の MCP サーバーとして起動されたかを、引数のスクリプトで見分ける', () => {
  // Windows: ELECTRON_RUN_AS_NODE が届かず、exe がアプリとして起動したとき
  assert.strictEqual(isMcpLaunch(['C:\\Users\\me\\AppData\\Local\\Programs\\Worktree Kanban\\Worktree Kanban.exe', 'C:\\Users\\me\\AppData\\Local\\Programs\\Worktree Kanban\\resources\\app.asar.unpacked\\src\\permission-mcp.js']), true);
  assert.strictEqual(isMcpLaunch(['/Applications/Worktree Kanban.app/Contents/MacOS/Worktree Kanban', '/Applications/Worktree Kanban.app/Contents/Resources/app.asar.unpacked/src/permission-mcp.js']), true);
  assert.strictEqual(isMcpLaunch(['C:\\app\\Worktree Kanban.exe', 'C:\\app\\resources\\app.asar.unpacked\\src\\PERMISSION-MCP.JS']), true, '大文字・小文字は区別しない');
});

test('ふつうにアプリを起動したときは MCP サーバーとみなさない', () => {
  assert.strictEqual(isMcpLaunch(['C:\\app\\Worktree Kanban.exe']), false);
  assert.strictEqual(isMcpLaunch(['/usr/bin/electron', '.']), false);
  assert.strictEqual(isMcpLaunch(['C:\\app\\Worktree Kanban.exe', '--some-flag']), false);
  // exe 自体の名前（argv[0]）は見ない
  assert.strictEqual(isMcpLaunch(['C:\\permission-mcp.js']), false);
  assert.strictEqual(isMcpLaunch(['C:\\app\\Worktree Kanban.exe', 'C:\\docs\\permission-mcp.js.bak']), false);
  assert.strictEqual(isMcpLaunch(undefined), false);
});

const { nodeRelaunch, RELAUNCH_ENV } = require('../src/launch-mode');

test('アプリとして起動してしまったら、ELECTRON_RUN_AS_NODE を付けて起動し直す（WSL から env が届かないとき）', () => {
  const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\Worktree Kanban\\Worktree Kanban.exe';
  const script = 'C:\\Users\\me\\AppData\\Local\\Programs\\Worktree Kanban\\resources\\app.asar.unpacked\\src\\permission-mcp.js';
  const conf = 'C:\\Users\\me\\AppData\\Roaming\\Worktree Kanban\\mcp\\c1.json';
  const re = nodeRelaunch(exe, [exe, '--some-chromium-flag', script, conf], { PATH: 'x' });
  assert.strictEqual(re.file, exe);
  assert.deepStrictEqual(re.args, [script, conf], 'スクリプトと設定ファイルだけを渡す');
  assert.strictEqual(re.env.ELECTRON_RUN_AS_NODE, '1');
  assert.strictEqual(re.env.PATH, 'x');
  assert.strictEqual(re.cwd, 'C:\\Users\\me\\AppData\\Local\\Programs\\Worktree Kanban', 'WSL のフォルダではなく exe のフォルダで動かす');
  // 起動し直した子でも効かなかったときは、もう起動し直さない（その場で動く）
  assert.strictEqual(nodeRelaunch(exe, [exe, script, conf], re.env), null);
  assert.strictEqual(nodeRelaunch(exe, [exe], {}), null);
  assert.ok(RELAUNCH_ENV);
});
