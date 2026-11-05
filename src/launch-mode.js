// アプリの exe が、どの用途で起動されたかを判断する（Electron に依存しない）
const path = require('path');

const MCP_SCRIPT = 'permission-mcp.js';
// 起動し直した子に付ける印（ELECTRON_RUN_AS_NODE が効かずに、また起動し直し続けないようにする）
const RELAUNCH_ENV = 'AGENT_KANBAN_MCP_RELAUNCHED';

function isMcpScript(a) {
  return typeof a === 'string' && path.win32.basename(a).toLowerCase() === MCP_SCRIPT;
}

// 承認用の MCP サーバー（permission-mcp.js）として起動されたか。
// claude には「アプリの exe + permission-mcp.js + ELECTRON_RUN_AS_NODE=1」で起動させるが、
// Windows（特に WSL の中の claude から呼んだとき）は ELECTRON_RUN_AS_NODE が届かず、exe がアプリとして起動してしまう。
// そのときは、引数にスクリプトがあることで MCP サーバーとして起動されたと分かる
function isMcpLaunch(argv) {
  return (argv || []).slice(1).some(isMcpScript);
}

// アプリとして起動してしまったときに、Node として起動し直すためのコマンド。
// ここ（Windows 側）で ELECTRON_RUN_AS_NODE を付けるので、WSL から呼ばれても確実に効く。
// すでに起動し直した子なら null（その場で MCP サーバーとして動く）
function nodeRelaunch(execPath, argv, env) {
  if (env && env[RELAUNCH_ENV]) return null;
  const list = argv || [];
  const i = list.findIndex((a, k) => k > 0 && isMcpScript(a));
  if (i < 0) return null;
  return {
    file: execPath,
    args: list.slice(i), // スクリプトと、そのあとの引数（MCP の設定ファイル）。Chromium が足したフラグは渡さない
    env: { ...env, ELECTRON_RUN_AS_NODE: '1', [RELAUNCH_ENV]: '1' },
    // WSL のフォルダ（\\wsl.localhost\...）が作業フォルダだと困ることがあるので、exe のフォルダで動かす
    cwd: (/^[A-Za-z]:[\\/]/.test(execPath) ? path.win32 : path).dirname(execPath),
  };
}

module.exports = { isMcpLaunch, nodeRelaunch, MCP_SCRIPT, RELAUNCH_ENV };
