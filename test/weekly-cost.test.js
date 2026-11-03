const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { Store, weekAround, anchorFromDay, WEEK_MS } = require('../src/store');

const tmpStore = () => new Store(path.join(os.tmpdir(), `wk-${process.pid}-${Math.random()}.json`));

test('weekAround はリセット日時を基準に、今を含む1週間を返す', () => {
  const anchor = new Date(2026, 10, 6, 10, 0).getTime(); // 11/6(金) 10:00
  const now = new Date(2026, 10, 4, 12, 0).getTime(); // 11/4(水)
  const { start, end } = weekAround(anchor, now);
  assert.strictEqual(end, anchor);
  assert.strictEqual(start, anchor - WEEK_MS);
  // ちょうどリセットの瞬間は新しい週
  assert.strictEqual(weekAround(anchor, anchor).start, anchor);
  // 何週も前のリセット日時からでも求まる
  const old = weekAround(anchor - 10 * WEEK_MS, now);
  assert.deepStrictEqual(old, { start, end });
});

test('anchorFromDay は指定の曜日・時刻を作る', () => {
  const now = new Date(2026, 10, 4, 12, 0).getTime(); // 水曜
  const a = new Date(anchorFromDay(1, '09:30', now));
  assert.strictEqual(a.getDay(), 1);
  assert.strictEqual(a.getHours(), 9);
  assert.strictEqual(a.getMinutes(), 30);
});

test('weeklyCost は今週の分だけを足す（設定 > claude の通知 > 月曜0:00）', () => {
  const s = tmpStore();
  const now = new Date(2026, 10, 4, 12, 0).getTime(); // 11/4(水) 12:00
  s.addCost('/r', 1, new Date(2026, 10, 1, 12).getTime()); // 11/1(日)
  s.addCost('/r', 2, new Date(2026, 10, 3, 12).getTime()); // 11/3(火)
  s.addCost('/other', 4, new Date(2026, 10, 3, 12).getTime());
  s.addCost('/r', 8, now);

  // 既定: 月曜 0:00 区切り → 11/2〜11/9
  let w = s.weeklyCost('/r', now);
  assert.strictEqual(w.source, 'default');
  assert.strictEqual(w.start, new Date(2026, 10, 2).getTime());
  assert.strictEqual(w.usd, 10);

  // claude から届いたリセット日時（11/3 火 12:00 ちょうど）
  s.setWeeklyResetAt(new Date(2026, 10, 3, 12).getTime());
  w = s.weeklyCost('/r', now);
  assert.strictEqual(w.source, 'claude');
  assert.strictEqual(w.usd, 10);
  s.setWeeklyResetAt(new Date(2026, 10, 3, 13).getTime());
  assert.strictEqual(s.weeklyCost('/r', now).usd, 8);

  // 設定の曜日が最優先（日曜 0:00 → 11/1〜）
  s.settings.weeklyResetDay = '0';
  s.settings.weeklyResetTime = '00:00';
  w = s.weeklyCost('/r', now);
  assert.strictEqual(w.source, 'settings');
  assert.strictEqual(w.usd, 11);
  assert.strictEqual(w.end - w.start, WEEK_MS);
});
