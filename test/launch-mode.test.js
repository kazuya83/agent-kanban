const test = require('node:test');
const assert = require('node:assert');
const { isMcpLaunch } = require('../src/launch-mode');

test('承認用の MCP サーバーとして起動されたかを、引数のスクリプトで見分ける', () => {
  // Windows: ELECTRON_RUN_AS_NODE が届かず、exe がアプリとして起動したとき
  assert.strictEqual(isMcpLaunch(['C:\\Users\\me\\AppData\\Local\\Programs\\Agent Kanban\\Agent Kanban.exe', 'C:\\Users\\me\\AppData\\Local\\Programs\\Agent Kanban\\resources\\app.asar.unpacked\\src\\permission-mcp.js']), true);
  assert.strictEqual(isMcpLaunch(['/Applications/Agent Kanban.app/Contents/MacOS/Agent Kanban', '/Applications/Agent Kanban.app/Contents/Resources/app.asar.unpacked/src/permission-mcp.js']), true);
  assert.strictEqual(isMcpLaunch(['C:\\app\\Agent Kanban.exe', 'C:\\app\\resources\\app.asar.unpacked\\src\\PERMISSION-MCP.JS']), true, '大文字・小文字は区別しない');
});

test('ふつうにアプリを起動したときは MCP サーバーとみなさない', () => {
  assert.strictEqual(isMcpLaunch(['C:\\app\\Agent Kanban.exe']), false);
  assert.strictEqual(isMcpLaunch(['/usr/bin/electron', '.']), false);
  assert.strictEqual(isMcpLaunch(['C:\\app\\Agent Kanban.exe', '--some-flag']), false);
  // exe 自体の名前（argv[0]）は見ない
  assert.strictEqual(isMcpLaunch(['C:\\permission-mcp.js']), false);
  assert.strictEqual(isMcpLaunch(['C:\\app\\Agent Kanban.exe', 'C:\\docs\\permission-mcp.js.bak']), false);
  assert.strictEqual(isMcpLaunch(undefined), false);
});
