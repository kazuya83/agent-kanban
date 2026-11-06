// タスクスケジューラ本体（src/scheduler.js）と、スケジュールの保存（src/store.js）を確かめる
// 時計とタイマーを差し替え、agents は偽物を渡す（カード作成の本物はサブタスク2の範囲）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Scheduler, TICK_MS } = require('../src/scheduler');
const { Store } = require('../src/store');
const { ISSUE_BATCH, LATE_MS, MAX_RUNS, nextRun } = require('../renderer/schedule-model');

const MIN = 60 * 1000;
const T0 = new Date(2026, 10, 6, 9, 0).getTime(); // 2026-11-06 09:00（ローカル）
const DAILY_9 = { kind: 'daily', hour: 9, minute: 0 };

function tmpStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-scheduler-'));
  const store = new Store(path.join(dir, 'board.json'));
  store.settings.repoPath = '/repo';
  t.after(() => {
    clearTimeout(store.timer);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function fakeAgents(store) {
  let n = 0;
  return {
    shuttingDown: false,
    created: [],
    started: [],
    notified: [],
    createError: null,
    startError: null,
    multi: 1,
    createTask(arg) {
      if (this.createError) throw new Error(this.createError);
      this.created.push(arg);
      const cards = Array.from({ length: this.multi }, () => ({ id: `card${++n}`, status: 'todo', repoPath: arg.repoPath, scheduleId: arg.scheduleId, title: arg.title }));
      store.cards.push(...cards);
      return cards;
    },
    start(id) {
      if (this.startError) throw new Error(this.startError);
      this.started.push(id);
      store.card(id).status = 'running';
    },
    notify(c, kind, title, body) {
      this.notified.push({ cardId: c.id, repoPath: c.repoPath, kind, title, body });
    },
  };
}

function setup(t, opts = {}) {
  const store = tmpStore(t);
  const agents = fakeAgents(store);
  const clock = { now: T0 - MIN };
  const timers = [];
  const missing = new Set();
  const sch = new Scheduler({
    store,
    agents,
    now: () => clock.now,
    exists: (p) => !missing.has(p),
    setTimer: (fn, ms) => {
      const h = { fn, ms, cleared: false };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => {
      h.cleared = true;
    },
  });
  const events = [];
  sch.on('changed', (id) => events.push(id));
  const add = (over = {}) => sch.create({ title: '定期', prompt: '掃除して', rule: DAILY_9, ...over });
  return { ...opts, store, agents, clock, timers, missing, sch, events, add };
}

test('create: 正常に登録して、次回の日時を計算し、changed を出す', (t) => {
  const { store, sch, events, add } = setup(t);
  const s = add({ skill: 'sk', agent: 'relay:p1', model: 'm', readOnly: true, catchUp: true, sourceCardId: 'c1' });
  assert.match(s.id, /^[0-9a-f]{8}$/);
  assert.strictEqual(s.repoPath, '/repo'); // 省くと今のリポジトリ
  assert.strictEqual(s.nextRunAt, T0);
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.lastRunAt, null);
  assert.deepStrictEqual([s.skill, s.agent, s.model, s.readOnly, s.catchUp, s.sourceCardId], ['sk', 'relay:p1', 'm', true, true, 'c1']);
  assert.strictEqual(store.schedule(s.id), s);
  assert.deepStrictEqual(events, [s.id]);
});

test('create: 別のリポジトリを指定できる。schedulesOf はそのリポジトリの分だけ', (t) => {
  const { store, add } = setup(t);
  const a = add();
  const b = add({ repoPath: '/other' });
  assert.deepStrictEqual(store.schedulesOf('/repo').map((s) => s.id), [a.id]);
  assert.deepStrictEqual(store.schedulesOf('/other').map((s) => s.id), [b.id]);
  assert.deepStrictEqual(store.schedulesOf('/none'), []);
});

test('create: 入力の問題はエラーにして、登録しない', (t) => {
  const { store, sch, add, events } = setup(t);
  assert.throws(() => add({ prompt: ' ' }), /指示/);
  assert.throws(() => add({ rule: { kind: 'weekly', weekdays: [], hour: 1, minute: 1 } }), /曜日/);
  assert.throws(() => add({ rule: { kind: 'once', at: T0 - 2 * MIN } }), /過ぎています/);
  assert.throws(() => sch.create(), /指示|種類/);
  store.settings.repoPath = '';
  assert.throws(() => add(), /リポジトリ/);
  assert.strictEqual(store.schedules.length, 0);
  assert.deepStrictEqual(events, []);
});

test('create: 入力で履歴や ID を差し込めない', (t) => {
  const { add } = setup(t);
  const s = add({ id: 'x', nextRunAt: 1, lastRunAt: 5, runs: [{ at: 1, status: 'ok' }], lastStatus: 'ok' });
  assert.notStrictEqual(s.id, 'x');
  assert.strictEqual(s.nextRunAt, T0);
  assert.strictEqual(s.lastRunAt, null);
  assert.deepStrictEqual(s.runs, []);
  assert.strictEqual(s.lastStatus, '');
});

test('create: 止めた状態なら過ぎた日時でも登録でき、次回はない', (t) => {
  const { add } = setup(t);
  const s = add({ rule: { kind: 'once', at: T0 - 2 * MIN }, enabled: false });
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.nextRunAt, null);
});

test('update: 繰り返しを変えると次回を計算し直す。変えなければ次回はそのまま', (t) => {
  const { sch, clock, add } = setup(t);
  const s = add();
  clock.now = T0 - 30 * 1000; // 9:00 の直前
  sch.update(s.id, { title: '新しい名前', rule: { kind: 'daily', hour: 9, minute: 0 } });
  assert.strictEqual(s.title, '新しい名前');
  assert.strictEqual(s.nextRunAt, T0);
  sch.update(s.id, { rule: { kind: 'daily', hour: 10, minute: 0 } });
  assert.strictEqual(s.nextRunAt, T0 + 60 * MIN);
  assert.strictEqual(s.updatedAt, clock.now);
});

test('update: 止めると次回が消え、再開すると今から計算する（止めていた間は見送りにならない）', (t) => {
  const { sch, clock, add } = setup(t);
  const s = add();
  sch.update(s.id, { enabled: false });
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.nextRunAt, null);
  clock.now = T0 + 3 * 24 * 60 * MIN;
  sch.update(s.id, { enabled: true });
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.nextRunAt, nextRun(DAILY_9, clock.now));
  assert.deepStrictEqual(s.runs, []);
});

test('update: 変えられない項目は無視する', (t) => {
  const { sch, add } = setup(t);
  const s = add();
  const { id, nextRunAt } = s;
  sch.update(id, { id: 'x', repoPath: '/evil', runs: [{ at: 1, status: 'ok' }], lastRunAt: 9, nextRunAt: 1 });
  assert.deepStrictEqual([s.id, s.repoPath, s.runs, s.lastRunAt, s.nextRunAt], [id, '/repo', [], null, nextRunAt]);
});

test('update: 入力の問題・知らない ID・過ぎた1回だけの再開はエラーで、元のまま', (t) => {
  const { sch, clock, add } = setup(t);
  const s = add();
  assert.throws(() => sch.update('none', {}), /見つかりません/);
  assert.throws(() => sch.update(s.id, { prompt: '' }), /指示/);
  assert.throws(() => sch.update(s.id, { rule: { kind: 'x' } }), /種類/);
  assert.throws(() => sch.update(s.id, { rule: { kind: 'once', at: T0 - 2 * MIN } }), /過ぎています/);
  assert.strictEqual(s.prompt, '掃除して');
  assert.deepStrictEqual(s.rule, DAILY_9);
  const once = add({ rule: { kind: 'once', at: T0 } });
  sch.update(once.id, { enabled: false });
  clock.now = T0 + MIN;
  assert.throws(() => sch.update(once.id, { enabled: true }), /過ぎています/);
  assert.strictEqual(once.enabled, false);
  // 過ぎていても、ほかの項目は直せる
  sch.update(once.id, { title: '名前だけ' });
  assert.strictEqual(once.title, '名前だけ');
});

test('remove: 消してもカードは残る。知らない ID はエラー', (t) => {
  const { store, sch, add, events } = setup(t);
  const s = add();
  sch.run({ id: s.id });
  sch.remove(s.id);
  assert.strictEqual(store.schedule(s.id), undefined);
  assert.strictEqual(store.cards.length, 1);
  assert.strictEqual(events.at(-1), s.id);
  assert.throws(() => sch.remove(s.id), /見つかりません/);
});

test('tick: 時刻の前は動かない。ちょうどで動く', (t) => {
  const { agents, clock, sch, add } = setup(t);
  add();
  clock.now = T0 - 1;
  sch.tick();
  assert.strictEqual(agents.created.length, 0);
  clock.now = T0;
  sch.tick();
  assert.strictEqual(agents.created.length, 1);
});

test('tick: カードを作って開始し、結果を記録して次回へ進む', (t) => {
  const { agents, store, clock, sch, add, events } = setup(t);
  const s = add({ skill: 'sk', agent: 'custom:a', model: 'm', readOnly: true });
  events.length = 0;
  clock.now = T0 + 5 * 1000;
  sch.tick();
  assert.deepStrictEqual(agents.created, [{ title: '定期', prompt: '掃除して', skill: 'sk', agent: 'custom:a', model: 'm', readOnly: true, repoPath: '/repo', skipSpecCheck: true, scheduleId: s.id, scheduleTitle: '定期' }]);
  assert.deepStrictEqual(agents.started, ['card1']);
  assert.strictEqual(s.lastRunAt, clock.now);
  assert.strictEqual(s.lastStatus, 'ok');
  assert.strictEqual(s.lastError, '');
  assert.strictEqual(s.lastCardId, 'card1');
  assert.deepStrictEqual(s.runs.map((r) => [r.at, r.status, r.cardId]), [[clock.now, 'ok', 'card1']]);
  assert.strictEqual(s.nextRunAt, T0 + 24 * 60 * MIN);
  assert.deepStrictEqual(events, [s.id]);
  assert.strictEqual(store.card('card1').status, 'running');
  assert.deepStrictEqual(agents.notified, []);
  // 同じ予定で2回動かない
  sch.tick();
  assert.strictEqual(agents.created.length, 1);
});

test('tick: 何もなければ changed を出さない', (t) => {
  const { sch, add, events } = setup(t);
  add();
  events.length = 0;
  sch.tick();
  assert.deepStrictEqual(events, []);
});

test('tick: 止めたスケジュールは動かない', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const s = add();
  sch.update(s.id, { enabled: false });
  clock.now = T0;
  sch.tick();
  assert.strictEqual(agents.created.length, 0);
});

test('tick: 今開いていないリポジトリのスケジュールも動かす', (t) => {
  const { agents, clock, sch, add } = setup(t);
  add({ repoPath: '/other' });
  clock.now = T0;
  sch.tick();
  assert.strictEqual(agents.created[0].repoPath, '/other');
});

test('tick: エージェントを選んでいないときは、空のまま createTask に任せる', (t) => {
  const { agents, clock, sch, add } = setup(t);
  add();
  clock.now = T0;
  sch.tick();
  assert.strictEqual(agents.created[0].agent, '');
});

test('見送り: 遅れがちょうど10分なら実行、それより遅れたら見送って次回へ', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const s = add();
  clock.now = T0 + LATE_MS;
  sch.tick();
  assert.strictEqual(agents.created.length, 1);
  assert.strictEqual(s.lastStatus, 'ok');

  const u = add({ rule: { kind: 'once', at: clock.now + MIN } });
  const due = u.nextRunAt;
  clock.now = due + LATE_MS + 1;
  sch.tick();
  assert.strictEqual(agents.created.length, 1);
  assert.strictEqual(u.lastStatus, 'missed');
  assert.deepStrictEqual(u.runs.map((r) => [r.at, r.status, r.cardId]), [[due, 'missed', '']]);
  assert.strictEqual(u.lastRunAt, null); // カードを作っていないので変えない
});

test('見送り: 何日も止まっていても、見送りは1回で次回は今より後', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const s = add();
  clock.now = T0 + 5 * 24 * 60 * MIN + 30 * MIN;
  sch.tick();
  assert.strictEqual(agents.created.length, 0);
  assert.strictEqual(s.runs.length, 1);
  assert.strictEqual(s.lastStatus, 'missed');
  assert.ok(s.nextRunAt > clock.now);
  assert.deepStrictEqual(agents.notified, []); // 見送りは記録だけ
});

test('追いつき: チェックしたものだけ、何日遅れても1回だけ実行する', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const s = add({ catchUp: true });
  clock.now = T0 + 5 * 24 * 60 * MIN + 30 * MIN;
  sch.tick();
  sch.tick();
  assert.strictEqual(agents.created.length, 1);
  assert.strictEqual(s.lastStatus, 'ok');
  assert.strictEqual(s.lastRunAt, clock.now);
  assert.ok(s.nextRunAt > clock.now);
});

test('重複防止: 前回のカードが Todo・待機中・実行中のままなら見送る', (t) => {
  for (const status of ['todo', 'queued', 'running']) {
    const { agents, store, clock, sch, add } = setup(t);
    const s = add();
    clock.now = T0;
    sch.tick();
    store.card('card1').status = status;
    clock.now = s.nextRunAt;
    sch.tick();
    assert.strictEqual(agents.created.length, 1, status);
    assert.strictEqual(s.lastStatus, 'skipped', status);
    assert.strictEqual(s.lastRunAt, T0, status); // 前回のまま
    assert.strictEqual(s.lastCardId, 'card1', status);
    assert.strictEqual(s.nextRunAt, clock.now + 24 * 60 * MIN, status);
  }
});

test('重複防止: 前回のカードが終わっていれば、また作る', (t) => {
  for (const status of ['review', 'failed', 'done']) {
    const { agents, store, clock, sch, add } = setup(t);
    const s = add();
    clock.now = T0;
    sch.tick();
    store.card('card1').status = status;
    clock.now = s.nextRunAt;
    sch.tick();
    assert.strictEqual(agents.created.length, 2, status);
  }
});

test('重複防止: Pipeline の並列やサブタスクを待っている親は、まだ終わっていない', (t) => {
  for (const extra of [{ relay: { waiting: { node: 'par' } } }, { subtasks: { phase: 'run' } }]) {
    const { agents, store, clock, sch, add } = setup(t);
    const s = add();
    clock.now = T0;
    sch.tick();
    Object.assign(store.card('card1'), { status: 'review' }, extra);
    clock.now = s.nextRunAt;
    sch.tick();
    assert.strictEqual(agents.created.length, 1);
    assert.strictEqual(s.lastStatus, 'skipped');
  }
});

test('重複防止: 競争の複数のカードのどれかが残っていても見送る。別のスケジュールのカードは関係ない', (t) => {
  const { agents, store, clock, sch, add } = setup(t);
  agents.multi = 3;
  const s = add();
  const other = add({ rule: { kind: 'daily', hour: 9, minute: 1 } });
  clock.now = T0;
  sch.tick();
  assert.deepStrictEqual(agents.started, ['card1', 'card2', 'card3']);
  store.card('card1').status = 'review';
  store.card('card2').status = 'done';
  clock.now = T0 + MIN;
  sch.tick();
  assert.strictEqual(other.lastStatus, 'ok'); // s のカードが残っていても other は動く
  clock.now = s.nextRunAt;
  sch.tick();
  assert.strictEqual(s.lastStatus, 'skipped');
});

test('失敗: リポジトリがなければ記録して通知し、スケジュールを止める（画面から消せないので通知を繰り返さない）', (t) => {
  const { agents, missing, clock, sch, add } = setup(t);
  const s = add({ repoPath: '/gone' });
  missing.add('/gone');
  clock.now = T0;
  sch.tick();
  assert.strictEqual(agents.created.length, 0);
  assert.strictEqual(s.lastStatus, 'failed');
  assert.match(s.lastError, /リポジトリが見つかりません: \/gone/);
  assert.strictEqual(s.lastRunAt, null);
  assert.strictEqual(s.lastCardId, '');
  assert.deepStrictEqual([s.enabled, s.nextRunAt], [false, null]);
  assert.strictEqual(agents.notified.length, 1);
  assert.deepStrictEqual([agents.notified[0].cardId, agents.notified[0].repoPath, agents.notified[0].kind], ['', '/gone', 'schedule']);
  assert.match(agents.notified[0].title, /定期/);
  assert.match(agents.notified[0].body, /停止しました/);
  // 止めたあとは、時刻が進んでも通知しない
  clock.now = T0 + 48 * 60 * MIN;
  sch.tick();
  assert.strictEqual(agents.notified.length, 1);
  // フォルダが戻れば、再開して次回の予定が入る
  missing.delete('/gone');
  sch.update(s.id, { enabled: true });
  assert.strictEqual(s.enabled, true);
  assert.ok(s.nextRunAt > clock.now);
});

test('失敗: カードを作れないとき（Pipeline が消されたなど）も記録して通知する', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const s = add({ agent: 'relay:gone' });
  agents.createError = '選んだ Pipeline が見つかりません';
  clock.now = T0;
  sch.tick();
  assert.strictEqual(s.lastStatus, 'failed');
  assert.strictEqual(s.lastError, '選んだ Pipeline が見つかりません');
  assert.strictEqual(s.runs[0].cardId, '');
  assert.strictEqual(agents.notified[0].body, '選んだ Pipeline が見つかりません');
  // 直ったら、次回は動いてエラーが消える
  agents.createError = null;
  clock.now = s.nextRunAt;
  sch.tick();
  assert.strictEqual(s.lastStatus, 'ok');
  assert.strictEqual(s.lastError, '');
  assert.strictEqual(s.runs.length, 2);
});

test('失敗: createTask が空を返したら失敗にする', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const s = add();
  agents.createTask = () => [];
  clock.now = T0;
  sch.tick();
  assert.strictEqual(s.lastStatus, 'failed');
  assert.strictEqual(s.lastRunAt, null);
});

test('失敗: カードを作ったあとに開始できなければ、作った日時は残してカードを通知に付ける', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const s = add();
  agents.startError = '開始できない';
  clock.now = T0;
  sch.tick();
  assert.strictEqual(s.lastStatus, 'failed');
  assert.strictEqual(s.lastRunAt, T0);
  assert.strictEqual(s.lastCardId, 'card1');
  assert.strictEqual(s.runs[0].cardId, 'card1');
  assert.match(s.lastError, /開始できない/);
  assert.strictEqual(agents.notified[0].cardId, 'card1');
});

test('失敗: 1つが失敗しても、ほかのスケジュールは動く。通知の失敗でも止まらない', (t) => {
  const { agents, missing, clock, sch, add } = setup(t);
  const a = add({ repoPath: '/gone' });
  const b = add();
  missing.add('/gone');
  agents.notify = () => {
    throw new Error('通知できない');
  };
  const orig = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = orig;
  });
  clock.now = T0;
  sch.tick();
  assert.strictEqual(a.lastStatus, 'failed');
  assert.deepStrictEqual([a.enabled, a.nextRunAt], [false, null]); // 通知できなくても止める
  assert.strictEqual(b.lastStatus, 'ok');
});

test('1回だけ: 実行のあとは止まり、次回がない', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const s = add({ rule: { kind: 'once', at: T0 } });
  clock.now = T0;
  sch.tick();
  assert.strictEqual(s.lastStatus, 'ok');
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.nextRunAt, null);
  clock.now = T0 + 24 * 60 * MIN;
  sch.tick();
  assert.strictEqual(agents.created.length, 1);
});

test('1回だけ: 失敗・重複の見送りでも止まる', (t) => {
  const { agents, missing, store, clock, sch, add } = setup(t);
  const failed = add({ repoPath: '/gone', rule: { kind: 'once', at: T0 } });
  missing.add('/gone');
  const skipped = add({ rule: { kind: 'once', at: T0 } });
  store.cards.push({ id: 'old', status: 'running', scheduleId: skipped.id });
  clock.now = T0;
  sch.tick();
  assert.strictEqual(failed.lastStatus, 'failed');
  assert.strictEqual(skipped.lastStatus, 'skipped');
  for (const s of [failed, skipped]) assert.deepStrictEqual([s.enabled, s.nextRunAt], [false, null]);
  assert.strictEqual(agents.created.length, 0);
});

test('1回だけ: 大きく遅れたら見送りになり、チェックしていれば実行して止まる', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const a = add({ rule: { kind: 'once', at: T0 } });
  const b = add({ rule: { kind: 'once', at: T0 }, catchUp: true });
  clock.now = T0 + 60 * MIN;
  sch.tick();
  assert.strictEqual(a.lastStatus, 'missed');
  assert.strictEqual(a.enabled, false);
  assert.strictEqual(b.lastStatus, 'ok');
  assert.strictEqual(b.enabled, false);
  assert.strictEqual(agents.created.length, 1);
});

test('履歴: 新しい順に20件まで', (t) => {
  const { clock, sch, add, store } = setup(t);
  const s = add({ rule: { kind: 'hourly', minute: 0 } });
  for (let i = 0; i < MAX_RUNS + 3; i++) {
    clock.now = s.nextRunAt;
    sch.tick();
    store.cards.forEach((c) => {
      c.status = 'done';
    });
  }
  assert.strictEqual(s.runs.length, MAX_RUNS);
  assert.strictEqual(s.runs[0].at, clock.now);
  assert.ok(s.runs[0].at > s.runs[1].at);
});

test('run: 今すぐ実行は開始まで行い、次回の予定は変えない', (t) => {
  const { agents, sch, clock, add, events } = setup(t);
  const s = add();
  const { nextRunAt } = s;
  events.length = 0;
  const cards = sch.run({ id: s.id, start: true });
  assert.deepStrictEqual(cards.map((c) => c.id), ['card1']);
  assert.deepStrictEqual(agents.started, ['card1']);
  assert.strictEqual(agents.created[0].skipSpecCheck, true);
  assert.strictEqual(s.lastRunAt, clock.now);
  assert.strictEqual(s.lastStatus, 'ok');
  assert.strictEqual(s.nextRunAt, nextRunAt);
  assert.deepStrictEqual(events, [s.id]);
});

test('run: start を省くと開始する。false ならタスクだけ作成して Todo に置く', (t) => {
  const { agents, store, sch, add } = setup(t);
  const s = add();
  sch.run({ id: s.id });
  assert.deepStrictEqual(agents.started, ['card1']);
  sch.run({ id: s.id, start: false });
  assert.deepStrictEqual(agents.started, ['card1']);
  assert.strictEqual(store.card('card2').status, 'todo');
  assert.strictEqual(s.runs[0].message, 'タスクを作りました');
});

test('run: タスクだけ作成して Todo に残っていれば、次の予定は見送る', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const s = add();
  sch.run({ id: s.id, start: false });
  clock.now = T0;
  sch.tick();
  assert.strictEqual(agents.created.length, 1);
  assert.strictEqual(s.lastStatus, 'skipped');
});

test('run: 止めたスケジュール・前回のカードが残っているときも、人が押せば作る', (t) => {
  const { agents, sch, add } = setup(t);
  const s = add();
  sch.update(s.id, { enabled: false });
  sch.run({ id: s.id });
  sch.run({ id: s.id });
  assert.strictEqual(agents.created.length, 2);
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.nextRunAt, null);
});

test('run: 1回だけのスケジュールを先に実行しても、予定は残る', (t) => {
  const { sch, add } = setup(t);
  const s = add({ rule: { kind: 'once', at: T0 } });
  sch.run({ id: s.id });
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.nextRunAt, T0);
});

test('run: 失敗は記録して例外で返す（画面に出すので通知はしない）', (t) => {
  const { agents, missing, sch, add, events } = setup(t);
  const s = add({ repoPath: '/gone' });
  missing.add('/gone');
  events.length = 0;
  assert.throws(() => sch.run({ id: s.id }), /リポジトリが見つかりません/);
  assert.strictEqual(s.lastStatus, 'failed');
  assert.deepStrictEqual(agents.notified, []);
  assert.deepStrictEqual(events, [s.id]);
  assert.throws(() => sch.run({ id: 'none' }), /見つかりません/);
  assert.throws(() => sch.run(), /見つかりません/);
});

test('終了処理中は発火しない', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const s = add();
  agents.shuttingDown = true;
  clock.now = T0;
  sch.tick();
  assert.strictEqual(agents.created.length, 0);
  assert.strictEqual(s.nextRunAt, T0); // 次の起動で判定できるよう、記録しない
  assert.deepStrictEqual(s.runs, []);
  assert.throws(() => sch.run({ id: s.id }), /終了/);
});

test('終了処理が途中で始まったら、残りのスケジュールは動かさない', (t) => {
  const { agents, clock, sch, add } = setup(t);
  const a = add();
  const b = add();
  const start = agents.start.bind(agents);
  agents.start = (id) => {
    start(id);
    agents.shuttingDown = true;
  };
  clock.now = T0;
  sch.tick();
  assert.strictEqual(a.lastStatus, 'ok');
  assert.strictEqual(b.lastStatus, '');
});

test('start / stop: 30秒ごとに tick する。2回呼んでもタイマーは1つで、止めたら動かない', (t) => {
  const { agents, clock, timers, sch, add } = setup(t);
  add();
  assert.strictEqual(TICK_MS, 30000);
  sch.start();
  sch.start();
  assert.strictEqual(timers.length, 1);
  assert.strictEqual(timers[0].ms, 30000);
  clock.now = T0;
  timers[0].fn();
  assert.strictEqual(agents.created.length, 1);
  sch.stop();
  assert.strictEqual(timers[0].cleared, true);
  assert.strictEqual(sch.timer, null);
  sch.stop(); // もう一度止めても問題ない
  sch.start(); // 止めたあとは、また動かせる
  assert.strictEqual(timers.length, 2);
  sch.stop();
});

test('start: 本物のタイマーでもプロセスの終了を止めない', (t) => {
  const store = tmpStore(t);
  const sch = new Scheduler({ store, agents: fakeAgents(store) });
  sch.start();
  assert.strictEqual(sch.timer.hasRef(), false);
  sch.stop();
});

test('Store: schedules を保存して読み直せる', (t) => {
  const { store, sch, add, clock } = setup(t);
  const s = add({ catchUp: true });
  clock.now = T0;
  sch.tick();
  const saved = JSON.parse(JSON.stringify(s));
  store.flush();
  const again = new Store(store.file);
  assert.deepStrictEqual(again.schedules, [saved]);
  assert.deepStrictEqual(again.schedule(s.id), saved);
});

test('Store: schedules がない前の版のファイルでも読める', (t) => {
  const store = tmpStore(t);
  assert.deepStrictEqual(store.schedules, []);
  fs.mkdirSync(path.dirname(store.file), { recursive: true });
  fs.writeFileSync(store.file, JSON.stringify({ settings: { repoPath: '/repo' }, cards: [{ id: 'c' }] }));
  const again = new Store(store.file);
  assert.deepStrictEqual(again.schedules, []);
  assert.strictEqual(again.cards.length, 1);
  assert.strictEqual(again.settings.repoPath, '/repo'); // 設定の読み込みも止まらない
});

test('Store: 壊れた schedules があっても、ほかの読み込みを止めない', (t) => {
  const store = tmpStore(t);
  for (const bad of ['x', 7, { a: 1 }, [null, 1, { id: 'a' }]]) {
    fs.writeFileSync(store.file, JSON.stringify({ settings: { repoPath: '/repo' }, schedules: bad }));
    const again = new Store(store.file);
    assert.deepStrictEqual(again.schedules, [], JSON.stringify(bad));
    assert.strictEqual(again.settings.repoPath, '/repo');
  }
});

test('Store: 起動をまたいで遅れた予定は、読み直したあとの tick で見送りになる', (t) => {
  const { store, add, agents } = setup(t);
  const s = add();
  store.flush();
  const again = new Store(store.file);
  const sch = new Scheduler({ store: again, agents, now: () => T0 + 8 * 60 * MIN, exists: () => true });
  sch.tick();
  assert.strictEqual(again.schedule(s.id).lastStatus, 'missed');
  assert.strictEqual(agents.created.length, 0);
  clearTimeout(again.timer);
});

test('Store: removeSchedule は指定した分だけ消す', (t) => {
  const store = tmpStore(t);
  store.addSchedule({ id: 'a' });
  store.addSchedule({ id: 'b' });
  store.removeSchedule('a');
  assert.deepStrictEqual(store.schedules.map((s) => s.id), ['b']);
  store.removeSchedule('none');
  assert.strictEqual(store.schedules.length, 1);
});

// ---------- Issue の監視 ----------

function watchSetup(t, { issues = {}, ...over } = {}) {
  const ctx = setup(t);
  const { agents, sch, store } = ctx;
  let n = 100;
  agents.remote = [];
  agents.listError = null;
  agents.fetchError = null;
  agents.listed = [];
  agents.listIssues = async (repo, filter) => {
    agents.listed.push({ repo, filter });
    if (agents.listError) throw new Error(agents.listError);
    return agents.remote;
  };
  agents.createFromWatchedIssue = async (repoPath, number, extra, opts) => {
    if (agents.fetchError) throw new Error(agents.fetchError);
    agents.created.push({ repoPath, number, extra, ...opts });
    const card = { id: `card${++n}`, status: 'todo', repoPath, scheduleId: opts.scheduleId, issue: { number }, subtasks: agents.subtasks };
    store.cards.push(card);
    return [card];
  };
  ctx.clock.now = T0;
  const s = sch.create({ title: '監視', prompt: '', rule: { kind: 'interval', minutes: 5 }, issues: { labels: 'agent, bug', author: '@alice', autoStart: false, ...issues }, ...over });
  const issue = (number, afterMs = MIN) => ({ number, title: `i${number}`, url: `u${number}`, createdAt: T0 + afterMs });
  const due = async () => {
    ctx.clock.now = store.schedule(s.id).nextRunAt;
    await sch.tick();
  };
  return { ...ctx, s, issue, due };
}

test('Issue の監視: 登録するとフィルタと開始時刻を覚え、指示は空でもよい', (t) => {
  const { s } = watchSetup(t);
  assert.deepStrictEqual(s.issues, { labels: ['agent', 'bug'], author: 'alice', autoStart: false, after: T0, seen: [], lastCheckedAt: null });
  assert.strictEqual(s.title, '監視');
  assert.strictEqual(s.nextRunAt, T0 + 5 * MIN);
});

test('Issue の監視: 登録の前からある Issue は対象にせず、新しい Issue ごとにカードを作る', async (t) => {
  const { agents, s, issue, due, clock } = watchSetup(t);
  agents.remote = [issue(3, -MIN), issue(8), issue(7)];
  await due();
  assert.deepStrictEqual(agents.created.map((c) => c.number), [7, 8]);
  assert.deepStrictEqual(agents.listed[0], { repo: '/repo', filter: { labels: ['agent', 'bug'], author: 'alice' } });
  assert.deepStrictEqual(agents.started, []);
  assert.deepStrictEqual(s.issues.seen, [7, 8]);
  assert.strictEqual(s.issues.lastCheckedAt, clock.now);
  assert.deepStrictEqual(s.runs.map((r) => r.message), ['#8 のタスクを作りました', '#7 のタスクを作りました']);
  assert.strictEqual(s.nextRunAt, clock.now + 5 * MIN);
  // 2回目は同じ Issue を作らず、履歴も増やさない
  await due();
  assert.strictEqual(agents.created.length, 2);
  assert.strictEqual(s.runs.length, 2);
});

test('Issue の監視: Todo に置くときは仕様を確認し、自動で開始するときは確認を飛ばす', async (t) => {
  const a = watchSetup(t);
  a.agents.remote = [a.issue(1)];
  await a.due();
  assert.strictEqual(a.agents.created[0].skipSpecCheck, false);
  const b = watchSetup(t, { issues: { autoStart: true } });
  b.agents.remote = [b.issue(1)];
  await b.due();
  assert.strictEqual(b.agents.created[0].skipSpecCheck, true);
  assert.deepStrictEqual(b.agents.started, [b.s.lastCardId]);
  assert.strictEqual(b.s.runs[0].message, '#1 のタスクを作って開始しました');
});

test('Issue の監視: 前のカードが動いていても、新しい Issue のカードは作る', async (t) => {
  const { agents, issue, due } = watchSetup(t, { issues: { autoStart: true } });
  agents.remote = [issue(1)];
  await due();
  agents.remote = [issue(1), issue(2)];
  await due();
  assert.deepStrictEqual(agents.created.map((c) => c.number), [1, 2]);
});

test('Issue の監視: 1回に作るカードには上限があり、残りは古い順に次回作る', async (t) => {
  const { agents, issue, due } = watchSetup(t);
  agents.remote = Array.from({ length: ISSUE_BATCH + 3 }, (_, i) => issue(i + 1));
  await due();
  assert.strictEqual(agents.created.length, ISSUE_BATCH);
  await due();
  assert.deepStrictEqual(agents.created.slice(ISSUE_BATCH).map((c) => c.number), [11, 12, 13]);
});

test('Issue の監視: すでにカードのある Issue は作らない。サブタスクにしたサブIssue も別のカードにしない', async (t) => {
  const { agents, store, s, issue, due } = watchSetup(t);
  store.cards.push({ id: 'hand', status: 'done', repoPath: '/repo', issue: { number: 1 } });
  agents.subtasks = { items: [{ issue: { number: 3 } }] };
  agents.remote = [issue(1), issue(2), issue(3)];
  await due();
  assert.deepStrictEqual(agents.created.map((c) => c.number), [2]);
  assert.deepStrictEqual(s.issues.seen, [1, 2, 3]);
});

test('Issue の監視: アプリを閉じていて大きく遅れても見送らない', async (t) => {
  const { agents, clock, sch, s, issue } = watchSetup(t);
  agents.remote = [issue(1)];
  clock.now = s.nextRunAt + LATE_MS + MIN;
  await sch.tick();
  assert.strictEqual(agents.created.length, 1);
});

test('Issue の監視: 読めないときは失敗を記録し、続く失敗は通知を繰り返さず、直れば表示を消す', async (t) => {
  const { agents, s, issue, due } = watchSetup(t);
  agents.listError = 'rate limit';
  await due();
  await due();
  assert.strictEqual(s.lastStatus, 'failed');
  assert.strictEqual(s.lastError, 'Issue を読めませんでした: rate limit');
  assert.strictEqual(agents.notified.length, 1);
  assert.strictEqual(s.enabled, true);
  agents.listError = null;
  await due();
  assert.strictEqual(s.lastStatus, 'ok');
  assert.strictEqual(s.lastError, '');
  // 1件のカードが作れないときは覚えず、次回もう一度試す
  agents.fetchError = 'boom';
  agents.remote = [issue(1)];
  await due();
  assert.strictEqual(s.lastError, '#1: boom');
  assert.deepStrictEqual(s.issues.seen, []);
  agents.fetchError = null;
  await due();
  assert.deepStrictEqual(s.issues.seen, [1]);
});

test('Issue の監視: リポジトリが消えたら止める', async (t) => {
  const { agents, missing, s, due } = watchSetup(t);
  missing.add('/repo');
  await due();
  assert.strictEqual(s.enabled, false);
  assert.strictEqual(s.nextRunAt, null);
  assert.match(agents.notified[0].body, /スケジュールを停止しました/);
});

test('Issue の監視: 確認が重なっても同じ Issue のカードは1枚。読んでいるあいだに消されたら作らない', async (t) => {
  const { agents, sch, s, issue } = watchSetup(t);
  agents.remote = [issue(1)];
  const [a, b] = await Promise.all([sch.runIssues(s.id), sch.runIssues(s.id)]);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(agents.created.length, 1);
  agents.remote = [issue(2)];
  const p = sch.runIssues(s.id);
  sch.remove(s.id);
  await p;
  assert.strictEqual(agents.created.length, 1);
});

test('Issue の監視: 編集しても開始時刻と覚えた番号は残り、外からは変えられない', async (t) => {
  const { agents, sch, s, issue, due, store } = watchSetup(t);
  agents.remote = [issue(1)];
  await due();
  sch.update(s.id, { issues: { labels: 'x', author: '', autoStart: true, after: 1, seen: [] } });
  const now = store.schedule(s.id).issues;
  assert.deepStrictEqual([now.labels, now.autoStart, now.after, now.seen], [['x'], true, T0, [1]]);
  sch.update(s.id, { enabled: false });
  assert.deepStrictEqual(store.schedule(s.id).issues.seen, [1]);
  assert.throws(() => sch.update(s.id, { issues: null }), /指示を入力してください/);
});

test('Issue の監視: 保存して読み直しても設定が残る', async (t) => {
  const { store, s } = watchSetup(t);
  store.flush();
  const again = new Store(store.file);
  assert.deepStrictEqual(again.schedule(s.id).issues, s.issues);
  clearTimeout(again.timer);
});
