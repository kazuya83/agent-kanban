// スケジュールの形と次回の日時（renderer/schedule-model.js）を確かめる
const test = require('node:test');
const assert = require('node:assert');
const { cleanRule, nextRun, describeRule, cleanRuns, cleanSchedule, cleanSchedules, scheduleError, MAX_RUNS, LATE_MS } = require('../renderer/schedule-model');

// ローカル時刻のミリ秒（month は 1〜12）
const at = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime();

test('定数: 遅れの基準は10分、履歴は20件', () => {
  assert.strictEqual(LATE_MS, 600000);
  assert.strictEqual(MAX_RUNS, 20);
});

test('cleanRule: 種類ごとに使う項目だけを残す', () => {
  assert.deepStrictEqual(cleanRule({ kind: 'hourly', minute: 5, hour: 9, day: 3, weekdays: [1] }), { kind: 'hourly', minute: 5 });
  assert.deepStrictEqual(cleanRule({ kind: 'daily', hour: 9, minute: 0, weekdays: [1] }), { kind: 'daily', hour: 9, minute: 0 });
  assert.deepStrictEqual(cleanRule({ kind: 'monthly', day: 31, hour: 0, minute: 0 }), { kind: 'monthly', day: 31, hour: 0, minute: 0 });
  assert.deepStrictEqual(cleanRule({ kind: 'once', at: 1000, minute: 3 }), { kind: 'once', at: 1000 });
});

test('cleanRule: 画面の入力（数字の文字列）を数値にする', () => {
  assert.deepStrictEqual(cleanRule({ kind: 'daily', hour: '09', minute: '30' }), { kind: 'daily', hour: 9, minute: 30 });
  assert.deepStrictEqual(cleanRule({ kind: 'once', at: '1000' }), { kind: 'once', at: 1000 });
  assert.deepStrictEqual(cleanRule({ kind: 'once', at: '2026-11-07T09:30' }), { kind: 'once', at: at(2026, 11, 7, 9, 30) });
  assert.deepStrictEqual(cleanRule({ kind: 'once', at: new Date(5000) }), { kind: 'once', at: 5000 });
});

test('cleanRule: 曜日は重なりを除いて順に並べる', () => {
  assert.deepStrictEqual(cleanRule({ kind: 'weekly', weekdays: [5, '1', 5, 0], hour: 1, minute: 2 }).weekdays, [0, 1, 5]);
});

test('cleanRule: 境界の値', () => {
  assert.ok(cleanRule({ kind: 'daily', hour: 23, minute: 59 }));
  assert.ok(cleanRule({ kind: 'daily', hour: 0, minute: 0 }));
  assert.ok(cleanRule({ kind: 'monthly', day: 1, hour: 0, minute: 0 }));
  assert.ok(cleanRule({ kind: 'weekly', weekdays: [0, 6], hour: 0, minute: 0 }));
  for (const bad of [
    { kind: 'daily', hour: 24, minute: 0 },
    { kind: 'daily', hour: -1, minute: 0 },
    { kind: 'daily', hour: 0, minute: 60 },
    { kind: 'daily', hour: 1.5, minute: 0 },
    { kind: 'monthly', day: 0, hour: 0, minute: 0 },
    { kind: 'monthly', day: 32, hour: 0, minute: 0 },
    { kind: 'weekly', weekdays: [7], hour: 0, minute: 0 },
    { kind: 'weekly', weekdays: [1, -1], hour: 0, minute: 0 },
  ]) assert.strictEqual(cleanRule(bad), null, JSON.stringify(bad));
});

test('cleanRule: 形になっていないものは null（0 に読み替えて動かさない）', () => {
  for (const bad of [
    null,
    undefined,
    'daily',
    {},
    { kind: 'yearly', hour: 1, minute: 1 },
    { kind: 'hourly' },
    { kind: 'hourly', minute: '' },
    { kind: 'hourly', minute: null },
    { kind: 'hourly', minute: true },
    { kind: 'daily', minute: 0 },
    { kind: 'daily', hour: ' ', minute: 0 },
    { kind: 'weekly', hour: 1, minute: 1 },
    { kind: 'weekly', weekdays: [], hour: 1, minute: 1 },
    { kind: 'weekly', weekdays: 'mon', hour: 1, minute: 1 },
    { kind: 'monthly', hour: 1, minute: 1 },
    { kind: 'once' },
    { kind: 'once', at: 0 },
    { kind: 'once', at: -1 },
    { kind: 'once', at: 'いつか' },
    { kind: 'once', at: '' },
    { kind: 'once', at: 1e20 },
    { kind: 'once', at: NaN },
  ]) assert.strictEqual(cleanRule(bad), null, JSON.stringify(bad));
});

test('nextRun: 1回だけ', () => {
  const rule = { kind: 'once', at: at(2026, 11, 7, 9) };
  assert.strictEqual(nextRun(rule, at(2026, 11, 7, 8, 59)), rule.at);
  assert.strictEqual(nextRun(rule, rule.at - 1), rule.at);
  assert.strictEqual(nextRun(rule, rule.at), null); // ちょうどは過ぎた扱い
  assert.strictEqual(nextRun(rule, rule.at + 1), null);
});

test('N分おき: 形・次回・言葉', () => {
  const rule = { kind: 'interval', minutes: 5 };
  assert.deepStrictEqual(cleanRule({ ...rule, hour: 1 }), rule);
  for (const minutes of [0, 1441, 1.5, '', null]) assert.strictEqual(cleanRule({ kind: 'interval', minutes }), null);
  assert.strictEqual(nextRun(rule, 1000), 1000 + 5 * 60 * 1000);
  assert.strictEqual(describeRule(rule), '5分おき');
});

test('Issue の監視の設定を整える', () => {
  assert.strictEqual(cleanSchedule({ id: 'a', repoPath: '/r', prompt: 'x', rule: { kind: 'hourly', minute: 0 } }).issues, null);
  const s = cleanSchedule({ id: 'a', repoPath: '/r', prompt: '', createdAt: 5, rule: { kind: 'hourly', minute: 0 }, issues: { labels: ' a b, c、a b,', author: ' @bob ', autoStart: 'yes', seen: [1, 1, 'x', -2, 3] } });
  assert.deepStrictEqual(s.issues, { labels: ['a b', 'c'], author: 'bob', autoStart: false, after: 5, seen: [1, 3], lastCheckedAt: null });
  assert.strictEqual(s.title, 'Issue の監視');
  assert.strictEqual(cleanSchedule({ id: 'a', repoPath: '/r', rule: { kind: 'hourly', minute: 0 }, issues: { author: '@me' } }).issues.author, '@me');
  assert.strictEqual(scheduleError({ repoPath: '/r', prompt: '', rule: { kind: 'hourly', minute: 0 }, issues: {} }), '');
  assert.strictEqual(scheduleError({ repoPath: '/r', prompt: '', rule: { kind: 'hourly', minute: 0 } }), '指示を入力してください');
});

test('nextRun: 毎時', () => {
  const rule = { kind: 'hourly', minute: 15 };
  assert.strictEqual(nextRun(rule, at(2026, 11, 6, 10, 0)), at(2026, 11, 6, 10, 15));
  assert.strictEqual(nextRun(rule, at(2026, 11, 6, 10, 15)), at(2026, 11, 6, 11, 15)); // ちょうどなら次
  assert.strictEqual(nextRun(rule, at(2026, 11, 6, 10, 14, 59, 999)), at(2026, 11, 6, 10, 15));
  assert.strictEqual(nextRun(rule, at(2026, 12, 31, 23, 30)), at(2027, 1, 1, 0, 15)); // 年をまたぐ
});

test('nextRun: 毎日', () => {
  const rule = { kind: 'daily', hour: 9, minute: 30 };
  assert.strictEqual(nextRun(rule, at(2026, 11, 6, 9, 29)), at(2026, 11, 6, 9, 30));
  assert.strictEqual(nextRun(rule, at(2026, 11, 6, 9, 30)), at(2026, 11, 7, 9, 30));
  assert.strictEqual(nextRun(rule, at(2026, 12, 31, 23, 0)), at(2027, 1, 1, 9, 30));
});

test('nextRun: 毎週（週またぎ・複数の曜日）', () => {
  // 2026-11-06 は金曜
  const rule = { kind: 'weekly', weekdays: [1, 5], hour: 9, minute: 0 };
  assert.strictEqual(nextRun(rule, at(2026, 11, 6, 8)), at(2026, 11, 6, 9)); // 今日の金曜
  assert.strictEqual(nextRun(rule, at(2026, 11, 6, 9)), at(2026, 11, 9, 9)); // 週をまたいで月曜
  assert.strictEqual(nextRun(rule, at(2026, 11, 9, 9)), at(2026, 11, 13, 9)); // 次の金曜
  // 曜日が1つで、今日の分が過ぎていれば7日後
  assert.strictEqual(nextRun({ kind: 'weekly', weekdays: [5], hour: 9, minute: 0 }, at(2026, 11, 6, 10)), at(2026, 11, 13, 9));
  // 土曜から日曜へ
  assert.strictEqual(nextRun({ kind: 'weekly', weekdays: [0], hour: 0, minute: 0 }, at(2026, 11, 7, 23, 59)), at(2026, 11, 8, 0, 0));
});

test('nextRun: 毎月（月末が足りない月は末日）', () => {
  const rule = { kind: 'monthly', day: 31, hour: 9, minute: 0 };
  assert.strictEqual(nextRun(rule, at(2026, 1, 31, 9)), at(2026, 2, 28, 9)); // うるう年でない2月
  assert.strictEqual(nextRun(rule, at(2028, 1, 31, 9)), at(2028, 2, 29, 9)); // うるう年の2月
  assert.strictEqual(nextRun(rule, at(2026, 4, 1)), at(2026, 4, 30, 9)); // 30日の月
  assert.strictEqual(nextRun(rule, at(2026, 4, 30, 9)), at(2026, 5, 31, 9));
  assert.strictEqual(nextRun(rule, at(2026, 12, 31, 9)), at(2027, 1, 31, 9)); // 年をまたぐ
  assert.strictEqual(nextRun({ kind: 'monthly', day: 1, hour: 0, minute: 0 }, at(2026, 11, 1, 0, 0, 0, 1)), at(2026, 12, 1, 0, 0));
  assert.strictEqual(nextRun({ kind: 'monthly', day: 30, hour: 0, minute: 0 }, at(2026, 1, 31)), at(2026, 2, 28));
});

test('nextRun: 今の時刻を省くと現在から計算する', () => {
  assert.ok(nextRun({ kind: 'hourly', minute: 0 }) > Date.now());
});

test('nextRun: 計算できないものは null（止まらずに返す）', () => {
  assert.strictEqual(nextRun(null, 0), null);
  assert.strictEqual(nextRun({ kind: 'weekly', weekdays: [], hour: 0, minute: 0 }, 0), null);
  for (const after of [NaN, Infinity, 1e20, 'x']) {
    for (const rule of [{ kind: 'hourly', minute: 0 }, { kind: 'daily', hour: 0, minute: 0 }, { kind: 'monthly', day: 1, hour: 0, minute: 0 }, { kind: 'weekly', weekdays: [1], hour: 0, minute: 0 }]) {
      assert.strictEqual(nextRun(rule, after), null);
    }
  }
  // Date で表せる最後の時刻の近くでも、次回が表せなければ null
  assert.strictEqual(nextRun({ kind: 'daily', hour: 0, minute: 0 }, 8.64e15), null);
  assert.strictEqual(nextRun({ kind: 'monthly', day: 1, hour: 0, minute: 0 }, 8.64e15), null);
});

test('nextRun: 夏時間の切り替えをまたいでも、同じ予定で2回動かない', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    // 2026-03-08 02:30 は存在しない時刻。前へ戻らず、その後の時刻になる
    const spring = { kind: 'daily', hour: 2, minute: 30 };
    const n = nextRun(spring, new Date(2026, 2, 8, 1, 0).getTime());
    assert.ok(n > new Date(2026, 2, 8, 1, 59).getTime());
    assert.ok(nextRun(spring, n) > n);
    // 2026-11-01 の 01:30 は2回ある。1回動かしたら、次は翌日
    const fall = { kind: 'daily', hour: 1, minute: 30 };
    const first = nextRun(fall, new Date(2026, 10, 1, 0, 0).getTime());
    assert.strictEqual(new Date(nextRun(fall, first)).getDate(), 2);
    // 毎時は経過時間で1時間おき
    const hourly = { kind: 'hourly', minute: 30 };
    assert.strictEqual(nextRun(hourly, first) - first, 60 * 60 * 1000);
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

test('describeRule: 種類ごとの言葉', () => {
  assert.strictEqual(describeRule({ kind: 'once', at: at(2026, 11, 7, 9, 5) }), '1回だけ 2026/11/07 09:05');
  assert.strictEqual(describeRule({ kind: 'hourly', minute: 5 }), '毎時 5分');
  assert.strictEqual(describeRule({ kind: 'daily', hour: 9, minute: 5 }), '毎日 09:05');
  assert.strictEqual(describeRule({ kind: 'weekly', weekdays: [3, 1], hour: 18, minute: 0 }), '毎週 月・水 18:00');
  assert.strictEqual(describeRule({ kind: 'monthly', day: 15, hour: 9, minute: 0 }), '毎月 15日 09:00');
  assert.strictEqual(describeRule({ kind: 'monthly', day: 28, hour: 9, minute: 0 }), '毎月 28日 09:00');
  assert.strictEqual(describeRule({ kind: 'monthly', day: 29, hour: 9, minute: 0 }), '毎月 29日 09:00（ない月は末日）');
  assert.strictEqual(describeRule(null), '');
  assert.strictEqual(describeRule({ kind: 'yearly' }), '');
});

test('cleanRuns: 壊れた記録を捨てて、新しい順に上限まで残す', () => {
  const many = Array.from({ length: MAX_RUNS + 5 }, (_, i) => ({ at: 100 - i, status: 'ok', cardId: `c${i}`, message: 'm' }));
  const out = cleanRuns(many);
  assert.strictEqual(out.length, MAX_RUNS);
  assert.strictEqual(out[0].cardId, 'c0');
  assert.deepStrictEqual(cleanRuns([null, 1, { at: 1, status: 'unknown' }, { status: 'ok' }, { at: 2, status: 'failed' }]), [{ at: 2, status: 'failed', cardId: '', message: '' }]);
  assert.deepStrictEqual(cleanRuns('x'), []);
});

test('cleanSchedule: 足りない項目を初期値でそろえる', () => {
  const now = at(2026, 11, 6, 8);
  const s = cleanSchedule({ id: ' a ', repoPath: ' /r ', prompt: ' 掃除 \n詳しく', rule: { kind: 'daily', hour: 9, minute: 0 } }, { now });
  assert.deepStrictEqual(s, {
    id: 'a',
    repoPath: '/r',
    title: '掃除',
    prompt: '掃除 \n詳しく',
    skill: '',
    agent: '',
    model: '',
    readOnly: false,
    rule: { kind: 'daily', hour: 9, minute: 0 },
    issues: null,
    enabled: true,
    catchUp: false,
    createdAt: now,
    updatedAt: now,
    nextRunAt: at(2026, 11, 6, 9),
    sourceCardId: '',
    lastRunAt: null,
    lastStatus: '',
    lastError: '',
    lastCardId: '',
    runs: [],
  });
});

test('cleanSchedule: タイトルは指示の1行目から作り、40文字で切る', () => {
  const s = cleanSchedule({ repoPath: '/r', prompt: 'あ'.repeat(50), rule: { kind: 'hourly', minute: 0 } });
  assert.strictEqual(s.title, 'あ'.repeat(40));
  assert.strictEqual(cleanSchedule({ repoPath: '/r', title: ' 名前 ', prompt: 'x', rule: { kind: 'hourly', minute: 0 } }).title, '名前');
});

test('cleanSchedule: リポジトリか繰り返しがなければ null', () => {
  assert.strictEqual(cleanSchedule(null), null);
  assert.strictEqual(cleanSchedule('x'), null);
  assert.strictEqual(cleanSchedule({ repoPath: '/r' }), null);
  assert.strictEqual(cleanSchedule({ repoPath: ' ', rule: { kind: 'hourly', minute: 0 } }), null);
  assert.strictEqual(cleanSchedule({ repoPath: 7, rule: { kind: 'hourly', minute: 0 } }), null);
});

test('cleanSchedule: 保存してある次回の日時は過ぎていても残す（起動時の遅れの判定に使う）', () => {
  const s = cleanSchedule({ repoPath: '/r', prompt: 'x', rule: { kind: 'once', at: 1000 }, nextRunAt: 1000 }, { now: 5000 });
  assert.strictEqual(s.nextRunAt, 1000);
  assert.strictEqual(s.enabled, true);
});

test('cleanSchedule: 止めたものに次回はなく、次回がないものは止まる', () => {
  const rule = { kind: 'daily', hour: 9, minute: 0 };
  assert.strictEqual(cleanSchedule({ repoPath: '/r', rule, enabled: false, nextRunAt: 5 }).nextRunAt, null);
  const past = cleanSchedule({ repoPath: '/r', rule: { kind: 'once', at: 1000 } }, { now: 5000 });
  assert.strictEqual(past.enabled, false);
  assert.strictEqual(past.nextRunAt, null);
  // 壊れた nextRunAt は計算し直す
  const now = at(2026, 11, 6, 8);
  assert.strictEqual(cleanSchedule({ repoPath: '/r', rule, nextRunAt: 'x' }, { now }).nextRunAt, at(2026, 11, 6, 9));
});

test('cleanSchedule: 知らない状態や項目を捨てる', () => {
  const s = cleanSchedule({ repoPath: '/r', rule: { kind: 'hourly', minute: 0 }, lastStatus: 'nope', readOnly: 'true', catchUp: 1, lastRunAt: 'x', extra: 1 });
  assert.strictEqual(s.lastStatus, '');
  assert.strictEqual(s.readOnly, false);
  assert.strictEqual(s.catchUp, false);
  assert.strictEqual(s.lastRunAt, null);
  assert.ok(!('extra' in s));
});

test('cleanSchedules: 壊れたもの・ID のないもの・ID の重なりを捨てる', () => {
  const rule = { kind: 'hourly', minute: 0 };
  const list = cleanSchedules([null, { id: 'a', repoPath: '/r', rule }, { id: 'a', repoPath: '/x', rule }, { repoPath: '/r', rule }, { id: 'b', repoPath: '/r', rule: { kind: 'x' } }]);
  assert.deepStrictEqual(list.map((s) => [s.id, s.repoPath]), [['a', '/r']]);
  assert.deepStrictEqual(cleanSchedules(undefined), []);
  assert.deepStrictEqual(cleanSchedules({}), []);
});

test('scheduleError: 入力の問題を言葉で返す', () => {
  const ok = { repoPath: '/r', prompt: 'x', rule: { kind: 'hourly', minute: 0 } };
  assert.strictEqual(scheduleError(ok), '');
  assert.match(scheduleError(null), /リポジトリ/);
  assert.match(scheduleError({ ...ok, repoPath: '' }), /リポジトリ/);
  assert.match(scheduleError({ ...ok, prompt: '  ' }), /指示/);
  assert.match(scheduleError({ ...ok, prompt: 5 }), /指示/);
  assert.match(scheduleError({ ...ok, rule: null }), /種類/);
  assert.match(scheduleError({ ...ok, rule: { kind: 'yearly' } }), /種類/);
  assert.match(scheduleError({ ...ok, rule: { kind: 'once' } }), /日時/);
  assert.match(scheduleError({ ...ok, rule: { kind: 'weekly', weekdays: [], hour: 1, minute: 1 } }), /曜日/);
  assert.match(scheduleError({ ...ok, rule: { kind: 'daily', hour: 25, minute: 1 } }), /正しくありません/);
});
