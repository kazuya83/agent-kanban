// Agent Kanban から Worktree Kanban へ改名しても、今のユーザーのデータと自動更新を保つ
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('データの場所は前の名前のフォルダのまま（--user-data-dir があればそちら）', () => {
  assert.match(read('main.js'), /hasSwitch\('user-data-dir'\)\) app\.setPath\('userData', path\.join\(app\.getPath\('appData'\), 'agent-kanban'\)\)/);
});

test('保存済みのものに使う名前は変えない', () => {
  assert.match(read('src/ssh-key.js'), /KEY_NAME = 'agent-kanban_ed25519'/);
  assert.match(read('renderer/pipeline-pack.js'), /PIPELINE_FORMAT = 'agent-kanban-pipeline'/);
  assert.match(read('renderer/app-view.js'), /VIEW_KEY = 'agent-kanban\.view'/);
  assert.match(read('src/agent.js'), /MCP_SERVER_NAME = 'agent_kanban'/);
  assert.strictEqual(JSON.parse(read('package.json')).build.appId, 'dev.agentkanban.app');
});

test('インストーラは、前の版が自分を更新するときの指定を受け付ける', () => {
  const sh = read('install.sh');
  assert.match(sh, /\$\{WORKTREE_KANBAN_VERSION:-\$\{AGENT_KANBAN_VERSION:-latest\}\}/);
  assert.match(sh, /OLD_APP_NAMES=\("Agent Kanban" "Claude Agent Kanban"\)/);
  assert.match(sh, /ln -sf "\$\{BIN_NAME\}" "\$\{bin\}\/agent-kanban"/);
  const ps1 = read('install.ps1');
  assert.match(ps1, /\$env:AGENT_KANBAN_VERSION/);
  assert.match(ps1, /\$oldAppNames = @\('Agent Kanban', 'Claude Agent Kanban'\)/);
});

test('前の版が更新で探す名前のファイルだけを写す', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-legacy-'));
  const inDir = path.join(tmp, 'in');
  const out = path.join(tmp, 'out');
  fs.mkdirSync(inDir);
  fs.mkdirSync(out);
  const names = ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.zip', 'linux-x86_64.AppImage', 'win-setup.exe', 'win-portable.exe'].map((s) => `worktree-kanban-1.2.3-${s}`);
  for (const n of names) fs.writeFileSync(path.join(inDir, n), n);
  execFileSync('bash', [path.join(root, 'scripts/legacy-assets.sh'), out, ...names.map((n) => path.join(inDir, n))], { stdio: 'pipe' });
  assert.deepStrictEqual(fs.readdirSync(out).sort(), ['agent-kanban-1.2.3-linux-x86_64.AppImage', 'agent-kanban-1.2.3-mac-arm64.dmg', 'agent-kanban-1.2.3-mac-x64.dmg', 'agent-kanban-1.2.3-win-x64.zip']);
  assert.strictEqual(fs.readFileSync(path.join(out, 'agent-kanban-1.2.3-win-x64.zip'), 'utf8'), 'worktree-kanban-1.2.3-win-x64.zip');
  fs.rmSync(tmp, { recursive: true, force: true });
});
