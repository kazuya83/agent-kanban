// スケジューラの配線（IPC の引数・画面に渡す一覧・カードのない通知・起動と終了）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createScheduleApi, notificationClickPlan } = require('../src/schedule-wiring');
const { AgentManager } = require('../src/agent');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function fakeScheduler() {
  const calls = [];
  const rec =
    (name, result = { name }) =>
    (...args) => {
      calls.push([name, ...args]);
      return result;
    };
  return { calls, create: rec('create'), update: rec('update'), remove: rec('remove'), run: rec('run', [{ id: 'card1', logs: ['長いログ'] }, { id: 'card2' }]) };
}
const apiFor = (repoPath = '/repo') => {
  const scheduler = fakeScheduler();
  return { scheduler, api: createScheduleApi({ scheduler, store: { settings: { repoPath } } }) };
};

test('create: 今のリポジトリのスケジュールになる（指定されたリポジトリは使わない）', () => {
  const { api, scheduler } = apiFor('/repo');
  assert.deepStrictEqual(api.create({ title: 't', repoPath: '/other' }), { name: 'create' });
  assert.deepStrictEqual(scheduler.calls, [['create', { title: 't', repoPath: '/repo' }]]);
});

test('create: リポジトリを開いていなければ作らない', () => {
  const { api, scheduler } = apiFor('');
  assert.throws(() => api.create({ title: 't' }), /先にリポジトリを開いてください/);
  assert.deepStrictEqual(scheduler.calls, []);
});

test('create: 引数がなくても落ちない（中身の検査はスケジューラが行う）', () => {
  const { api, scheduler } = apiFor('/repo');
  api.create(undefined);
  assert.deepStrictEqual(scheduler.calls, [['create', { repoPath: '/repo' }]]);
});

test('update: id は更新の内容に含めない', () => {
  const { api, scheduler } = apiFor();
  api.update({ id: 's1', enabled: false });
  assert.deepStrictEqual(scheduler.calls, [['update', 's1', { enabled: false }]]);
});

test('delete: { id } でスケジュールを消す', () => {
  const { api, scheduler } = apiFor();
  api.delete({ id: 's1' });
  assert.deepStrictEqual(scheduler.calls, [['remove', 's1']]);
});

test('run: start: true のときだけ開始する。指定がなければカードを作るだけ', () => {
  const { api, scheduler } = apiFor();
  api.run({ id: 's1', start: true });
  api.run({ id: 's2', start: false });
  api.run({ id: 's3' });
  api.run({ id: 's4', start: 'true' });
  assert.deepStrictEqual(scheduler.calls, [
    ['run', { id: 's1', start: true }],
    ['run', { id: 's2', start: false }],
    ['run', { id: 's3', start: false }],
    ['run', { id: 's4', start: false }],
  ]);
});

test('run: card:create と同じく、作ったカードの ID だけを返す', () => {
  assert.strictEqual(apiFor().api.run({ id: 's1', start: true }), 'card1');
});

test('id がない操作はエラーになり、スケジューラを呼ばない', () => {
  const { api, scheduler } = apiFor();
  for (const bad of [undefined, null, {}, { id: '' }, { id: 1 }]) {
    assert.throws(() => api.update(bad), /スケジュールが指定されていません/);
    assert.throws(() => api.delete(bad), /スケジュールが指定されていません/);
    assert.throws(() => api.run(bad), /スケジュールが指定されていません/);
  }
  assert.deepStrictEqual(scheduler.calls, []);
});

test('スケジューラのエラーはそのまま画面まで返す', () => {
  const { api, scheduler } = apiFor();
  scheduler.run = () => {
    throw new Error('スケジュールが見つかりません');
  };
  assert.throws(() => api.run({ id: 'gone', start: true }), /スケジュールが見つかりません/);
});

test('通知を押す: 今のリポジトリのカードなら、そのまま開く', () => {
  const plan = notificationClickPlan({ cardId: 'c1', repoPath: '/a' }, { card: { id: 'c1', repoPath: '/a' }, currentRepo: '/a', viewingHost: false });
  assert.deepStrictEqual(plan, { toLocal: false, openRepo: '', focusId: 'c1' });
});

test('通知を押す: 別のリポジトリのカードなら、そのリポジトリへ移ってから開く', () => {
  const plan = notificationClickPlan({ cardId: 'c1', repoPath: '/b' }, { card: { id: 'c1', repoPath: '/b' }, currentRepo: '/a', viewingHost: false });
  assert.deepStrictEqual(plan, { toLocal: false, openRepo: '/b', focusId: 'c1' });
});

test('通知を押す: ホストのタブを見ているときは、このマシンのタブへ移る', () => {
  const plan = notificationClickPlan({ cardId: 'c1', repoPath: '/a' }, { card: { id: 'c1', repoPath: '/a' }, currentRepo: '/a', viewingHost: true });
  assert.deepStrictEqual(plan, { toLocal: true, openRepo: '', focusId: 'c1' });
});

test('通知を押す: カードのない通知は開くカードがなく、リポジトリへは移る', () => {
  const plan = notificationClickPlan({ cardId: '', repoPath: '/b' }, { card: null, currentRepo: '/a', viewingHost: true });
  assert.deepStrictEqual(plan, { toLocal: true, openRepo: '/b', focusId: '' });
});

test('通知を押す: カードもリポジトリもなければ、何も切り替えない', () => {
  const none = { toLocal: false, openRepo: '', focusId: '' };
  assert.deepStrictEqual(notificationClickPlan({ cardId: '', repoPath: '' }, { card: null, currentRepo: '/a', viewingHost: true }), none);
  assert.deepStrictEqual(notificationClickPlan(null, {}), none);
  assert.deepStrictEqual(notificationClickPlan(undefined), none);
});

test('通知を押す: カードが消されていても、通知のリポジトリへ移るだけで落ちない', () => {
  const plan = notificationClickPlan({ cardId: 'gone', repoPath: '/b' }, { card: undefined, currentRepo: '/a' });
  assert.deepStrictEqual(plan, { toLocal: false, openRepo: '/b', focusId: '' });
});

test('notify: カードのない通知を作れる（cardId は空、リポジトリとタイトルは残る）', () => {
  const added = [];
  let emitted = null;
  const self = {
    store: { addNotification: (n) => added.push(n), save() {} },
    emit: (name, n) => (emitted = [name, n]),
  };
  const n = AgentManager.prototype.notify.call(self, { id: '', repoPath: '/repo', title: '毎朝' }, 'schedule', '失敗: 毎朝', 'リポジトリが見つかりません');
  assert.strictEqual(n.cardId, '');
  assert.strictEqual(n.repoPath, '/repo');
  assert.strictEqual(n.kind, 'schedule');
  assert.deepStrictEqual(added, [n]);
  assert.deepStrictEqual(emitted, ['notification', n]);
});

test('画面: カードのない通知は、一覧に出しても押しても詳細を開かない', () => {
  const src = read('renderer/renderer.js');
  assert.match(src, /const alive = !!card\(n\.cardId\)/);
  assert.match(src, /data-card="\$\{alive \? esc\(n\.cardId\) : ''\}"/);
  assert.match(src, /if \(item && item\.dataset\.card\)/);
  assert.match(src, /api\.onFocus\(\(id\) => card\(id\) && select\(id\)\)/);
});

test('main.js: スケジューラの起動・画面の更新・ハンドラがつながっている', () => {
  const src = read('main.js');
  assert.match(src, /scheduler\.on\('changed', notifyBoard\)/);
  assert.match(src, /createWindow\(\);\s*scheduler\.start\(\);/);
  for (const [ch, m] of [['create', 'create'], ['update', 'update'], ['delete', 'delete'], ['run', 'run']]) {
    assert.ok(src.includes(`handle('schedules:${ch}', (p) => scheduleApi.${m}(p))`), ch);
  }
  // ハンドラより先にスケジューラを作っている
  assert.ok(src.indexOf('scheduler = new Scheduler(') < src.indexOf('createScheduleApi({ scheduler, store })'));
  // 画面と遠隔へ渡すボードの両方に載る
  assert.match(src.slice(src.indexOf('function boardState()'), src.indexOf('function viewBoard()')), /schedules: store\.schedulesOf\(store\.settings\.repoPath\)/);
});

test('main.js: 終了処理でタイマーが止まり、終了をキャンセルしたら動かし直す', () => {
  const src = read('main.js');
  const quit = src.slice(src.indexOf("app.on('before-quit'"));
  // 確認ダイアログやエージェントの停止より先に止める
  assert.ok(quit.indexOf('scheduler?.stop()') > 0);
  assert.ok(quit.indexOf('scheduler?.stop()') < quit.indexOf('agents.activeCount()'));
  assert.ok(quit.indexOf('scheduler?.stop()') < quit.indexOf('await agents.shutdown()'));
  assert.match(quit, /quitState = 'idle';\s*scheduler\?\.start\(\);/);
  // 更新のための終了でも止める
  const install = src.slice(src.indexOf('function installUpdate()'), src.indexOf('function maybeAutoUpdate()'));
  assert.match(install, /scheduler\?\.stop\(\)/);
});

test('main.js: 通知のクリックはカードがあるときだけ card:focus を送り、消えたフォルダは開かない', () => {
  const src = read('main.js');
  const click = src.slice(src.indexOf("dn.on('click'"), src.indexOf('dn.show()'));
  assert.match(click, /if \(plan\.focusId\) send\('card:focus', plan\.focusId\)/);
  assert.match(click, /fs\.existsSync\(plan\.openRepo\)/);
  // カードが画面に届いてから開く
  assert.ok(click.indexOf("send('board:changed'") < click.indexOf("send('card:focus'"));
});

test('preload: 4つの操作を公開し、スケジューラ画面の呼び方のままハンドラへ渡す', () => {
  const src = read('preload.js');
  for (const name of ['createSchedule', 'updateSchedule', 'deleteSchedule', 'runSchedule']) assert.ok(src.includes(`${name}:`), name);
  // preload を読み込んで実際に呼ぶ（electron は差し替える）
  const invoked = [];
  let api = null;
  const Module = require('node:module');
  const load = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (_n, a) => (api = a) },
        ipcRenderer: { invoke: async (ch, arg) => (invoked.push([ch, arg]), { ok: true, data: null }), on() {} },
      };
    }
    return load.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve('../preload.js')];
    require('../preload.js');
  } finally {
    Module._load = load;
  }
  api.createSchedule({ title: 't' });
  api.updateSchedule({ id: 's1', enabled: false });
  api.deleteSchedule('s1');
  api.runSchedule({ id: 's1', start: true });
  api.runSchedule({ id: 's1', start: false });
  assert.deepStrictEqual(invoked, [
    ['schedules:create', { title: 't' }],
    ['schedules:update', { id: 's1', enabled: false }],
    ['schedules:delete', { id: 's1' }],
    ['schedules:run', { id: 's1', start: true }],
    ['schedules:run', { id: 's1', start: false }],
  ]);
});
