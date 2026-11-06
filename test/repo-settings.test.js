// プロジェクト（リポジトリ）ごとの設定（src/store.js）を確かめる
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, DEFAULT_SETTINGS, REPO_SETTING_KEYS, migrateSettings, switchRepoSettings, setRepoSettings, repoSettingsOf, hasRepoSettings, defaultRepoSettings } = require('../src/store');
const { isGitHubUrl } = require('../src/git');

const fresh = (over = {}) => ({ ...DEFAULT_SETTINGS, statusMapping: { ...DEFAULT_SETTINGS.statusMapping }, repoSettings: {}, ...over });

test('取り込み方の初期値は「PR を作成」', () => {
  assert.strictEqual(DEFAULT_SETTINGS.integration, 'pr');
  assert.strictEqual(defaultRepoSettings().integration, 'pr');
});

test('リポジトリに関わる設定だけをプロジェクトごとに持つ', () => {
  for (const k of ['baseBranch', 'integration', 'branchNamingRule', 'issueStatusSync', 'statusFieldName', 'statusMapping', 'permissionMode', 'allowedTools', 'defaultSkill', 'specCheck']) assert.ok(REPO_SETTING_KEYS.includes(k), k);
  for (const k of ['claudePath', 'model', 'maxParallel', 'autoUpdate', 'enabledAgents', 'weeklyResetDay', 'deleteSessionsOnMerge']) assert.ok(!REPO_SETTING_KEYS.includes(k), k);
});

test('タブを切り替えると、そのプロジェクトの設定に変わり、初めてのプロジェクトは初期値から始まる', () => {
  const s = fresh({ repoPath: '/a' });
  Object.assign(s, { baseBranch: 'develop', integration: 'merge', permissionMode: 'bypassPermissions', branchNamingRule: 'feature/x', maxParallel: 5 });
  switchRepoSettings(s, '/b');
  assert.strictEqual(s.repoPath, '/b');
  assert.deepStrictEqual({ base: s.baseBranch, int: s.integration, mode: s.permissionMode, rule: s.branchNamingRule }, { base: '', int: 'pr', mode: 'acceptEdits', rule: '' });
  assert.strictEqual(s.maxParallel, 5, 'アプリ全体の設定は変わらない');
  s.allowedTools = 'WebSearch';
  switchRepoSettings(s, '/a');
  assert.deepStrictEqual({ base: s.baseBranch, int: s.integration, mode: s.permissionMode, rule: s.branchNamingRule, tools: s.allowedTools }, { base: 'develop', int: 'merge', mode: 'bypassPermissions', rule: 'feature/x', tools: '' });
  assert.strictEqual(repoSettingsOf(s, '/b').allowedTools, 'WebSearch');
  assert.ok(hasRepoSettings(s, '/b'));
  assert.ok(!hasRepoSettings(s, '/c'));
  // タブを閉じても（タブにないリポジトリでも）設定は残る
  switchRepoSettings(s, '');
  assert.strictEqual(repoSettingsOf(s, '/a').baseBranch, 'develop');
});

test('setRepoSettings: 今のリポジトリでも、ほかのリポジトリでも変えられる', () => {
  const s = fresh({ repoPath: '/a' });
  switchRepoSettings(s, '/a');
  setRepoSettings(s, '/a', { integration: 'merge' });
  assert.strictEqual(s.integration, 'merge');
  setRepoSettings(s, '/b', { pushAfterMerge: false, maxParallel: 9 });
  assert.strictEqual(s.pushAfterMerge, true);
  assert.strictEqual(repoSettingsOf(s, '/b').pushAfterMerge, false);
  assert.strictEqual(repoSettingsOf(s, '/b').maxParallel, undefined, 'プロジェクトの項目でないものは入れない');
  assert.strictEqual(s.maxParallel, DEFAULT_SETTINGS.maxParallel);
});

test('migrateSettings: プロジェクトごとの設定がなかったころは、今まで使っていたリポジトリに今までの値を入れる（取り込み方も残す）', () => {
  const raw = { ...DEFAULT_SETTINGS, integration: 'merge', permissionMode: 'default', branchNamingRule: 'feat/x', repoPath: '/a', repoTabs: ['/a', '/b'], baseBranch: 'dev', repoBaseBranches: { '/b': 'release' } };
  delete raw.repoSettings;
  const s = { ...DEFAULT_SETTINGS, ...raw };
  migrateSettings(s, raw, [{ repoPath: '/c' }]);
  assert.strictEqual(s.repoBaseBranches, undefined);
  assert.deepStrictEqual(Object.keys(s.repoSettings).sort(), ['/a', '/b', '/c']);
  assert.deepStrictEqual([s.integration, s.baseBranch, s.permissionMode], ['merge', 'dev', 'default']);
  assert.deepStrictEqual([repoSettingsOf(s, '/b').integration, repoSettingsOf(s, '/b').baseBranch, repoSettingsOf(s, '/b').branchNamingRule], ['merge', 'release', 'feat/x']);
  assert.strictEqual(repoSettingsOf(s, '/c').baseBranch, '');
  // 新しく開いたプロジェクトは PR を作成から
  assert.strictEqual(repoSettingsOf(s, '/new').integration, 'pr');
  // 取り込み方を保存していなかった（初期値のまま使っていた）ときは、そのころの初期値（直接マージ）
  const raw2 = { repoPath: '/a' };
  const s2 = { ...DEFAULT_SETTINGS, ...raw2 };
  migrateSettings(s2, raw2, []);
  assert.strictEqual(s2.integration, 'merge');
});

test('Store: 保存して読み直しても、プロジェクトごとの設定が残る', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-kanban-rs-'));
  const file = path.join(tmp, 'board.json');
  const store = new Store(file);
  switchRepoSettings(store.settings, '/a');
  store.settings.integration = 'merge';
  store.settings.baseBranch = 'dev';
  switchRepoSettings(store.settings, '/b');
  store.settings.permissionMode = 'plan';
  store.flush();
  assert.deepStrictEqual(DEFAULT_SETTINGS.repoSettings, {}, '初期値の中身は変えない');
  const again = new Store(file);
  assert.strictEqual(again.settings.repoPath, '/b');
  assert.strictEqual(again.settings.permissionMode, 'plan');
  assert.strictEqual(again.settings.integration, 'pr');
  assert.deepStrictEqual([again.repoSettings('/a').integration, again.repoSettings('/a').baseBranch], ['merge', 'dev']);
  assert.strictEqual(again.repoSettings('/b').permissionMode, 'plan');
});

test('isGitHubUrl: origin が GitHub かどうか', () => {
  assert.ok(isGitHubUrl('git@github.com:me/repo.git'));
  assert.ok(isGitHubUrl('https://github.com/me/repo'));
  assert.ok(isGitHubUrl('ssh://git@github.example.co.jp/me/repo.git'));
  assert.ok(!isGitHubUrl('git@gitlab.com:me/repo.git'));
  assert.ok(!isGitHubUrl('/tmp/remote.git'));
  assert.ok(!isGitHubUrl(''));
});
