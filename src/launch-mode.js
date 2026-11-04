// アプリの exe が、どの用途で起動されたかを判断する（Electron に依存しない）
const path = require('path');

const MCP_SCRIPT = 'permission-mcp.js';

// 承認用の MCP サーバー（permission-mcp.js）として起動されたか。
// claude には「アプリの exe + permission-mcp.js + ELECTRON_RUN_AS_NODE=1」で起動させるが、
// Windows などで ELECTRON_RUN_AS_NODE が届かないと、exe がアプリとして起動してウィンドウがもう1つ開いてしまう。
// そのときは、引数にスクリプトがあることで MCP サーバーとして起動されたと分かる
function isMcpLaunch(argv) {
  return (argv || []).slice(1).some((a) => typeof a === 'string' && path.win32.basename(a).toLowerCase() === MCP_SCRIPT);
}

module.exports = { isMcpLaunch, MCP_SCRIPT };
