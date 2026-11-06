// タスクスケジューラのスケジュールの形・確かめ方・次回の日時の決め方。
// レンダラ（<script> で読み込む。スケジューラの画面）と、アプリ本体（require。スケジュールを動かす）の両方から使う。
//
// スケジュール: {
//   id, repoPath, title, prompt, skill, agent, model, readOnly,
//   rule,                      繰り返し（下の RULE の形）
//   enabled,                   false なら動かさない（nextRunAt も null）
//   catchUp,                   予定から大きく遅れたときに、起動後に1回だけ実行する
//   createdAt, updatedAt,
//   nextRunAt,                 次回の日時（ミリ秒）。次回がなければ null
//   sourceCardId,              タスクから登録したときの、元のカードの ID
//   lastRunAt,                 最後にカードを作った日時（見送り・失敗では変えない）
//   lastStatus,                'ok' / 'skipped' / 'missed' / 'failed'。まだなければ ''
//   lastError, lastCardId,
//   runs: [{ at, status, cardId, message }]  実行の記録（新しい順に MAX_RUNS 件まで）
// }
// RULE（時刻はこの PC のローカル時刻）:
//   { kind: 'once', at }                        1回だけ（at はミリ秒）
//   { kind: 'hourly', minute }                  毎時
//   { kind: 'daily', hour, minute }             毎日
//   { kind: 'weekly', weekdays, hour, minute }  毎週（weekdays は 0=日〜6=土 を1つ以上）
//   { kind: 'monthly', day, hour, minute }      毎月（その月にない日は、その月の末日）
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScheduleModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const RULE_KINDS = ['once', 'hourly', 'daily', 'weekly', 'monthly'];
  const RUN_STATUSES = ['ok', 'skipped', 'missed', 'failed'];
  const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
  const MAX_RUNS = 20;
  const LATE_MS = 10 * 60 * 1000; // 予定からこれより遅れたら「見送り」にする（アプリの停止・スリープ）
  const TITLE_MAX = 40; // タイトルを指示の1行目から作るときの長さ（タスクのカードと同じ）
  const MAX_TIME = 8.64e15; // Date で表せる最後の時刻

  // 整数にする（空文字・null・true は 0 や 1 にしない）。範囲の外なら NaN
  function intIn(v, min, max) {
    if (typeof v !== 'number' && typeof v !== 'string') return NaN;
    if (typeof v === 'string' && !v.trim()) return NaN;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
  }

  // ミリ秒にする（数値か、datetime-local などの日時の文字列）。日時にならなければ NaN
  function timeOf(v) {
    let n = NaN;
    if (v instanceof Date) n = v.getTime();
    else if (typeof v === 'number') n = v;
    else if (typeof v === 'string') n = /^\d+$/.test(v.trim()) ? Number(v) : Date.parse(v);
    return n > 0 && n <= MAX_TIME ? n : NaN;
  }

  const str = (v) => (typeof v === 'string' ? v : '');
  const timeOrNull = (v) => {
    const n = timeOf(v);
    return Number.isNaN(n) ? null : n;
  };

  /**
   * 繰り返しの設定を整える。使わない項目は落とす
   * @returns {object|null} 形になっていなければ null（時刻をずらして動かさないよう、範囲の外の値は丸めない）
   */
  function cleanRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    const { kind } = rule;
    if (kind === 'once') {
      const at = timeOf(rule.at);
      return Number.isNaN(at) ? null : { kind, at };
    }
    const minute = intIn(rule.minute, 0, 59);
    if (Number.isNaN(minute)) return null;
    if (kind === 'hourly') return { kind, minute };
    const hour = intIn(rule.hour, 0, 23);
    if (Number.isNaN(hour)) return null;
    if (kind === 'daily') return { kind, hour, minute };
    if (kind === 'weekly') {
      const days = (Array.isArray(rule.weekdays) ? rule.weekdays : []).map((d) => intIn(d, 0, 6));
      if (!days.length || days.some(Number.isNaN)) return null;
      return { kind, weekdays: [...new Set(days)].sort((a, b) => a - b), hour, minute };
    }
    if (kind === 'monthly') {
      const day = intIn(rule.day, 1, 31);
      return Number.isNaN(day) ? null : { kind, day, hour, minute };
    }
    return null;
  }

  // その月の日数（month は 0〜11。12 以上は次の年に繰り上がる）
  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  /**
   * after より後で、いちばん早い実行日時（ミリ秒）
   * after が予定の時刻ちょうどのときは、その次を返す（同じ予定で2回動かないように）
   * @returns {number|null} 次回がなければ（1回だけで過ぎている・rule が形になっていない）null
   */
  function nextRun(rule, after = Date.now()) {
    const r = cleanRule(rule);
    const base = Number(after);
    if (!r || !(Math.abs(base) <= MAX_TIME)) return null;
    if (r.kind === 'once') return r.at > base ? r.at : null;
    const d = new Date(base);
    if (r.kind === 'hourly') {
      d.setMinutes(r.minute, 0, 0);
      let t = d.getTime();
      while (t <= base) t += 60 * 60 * 1000; // 時刻を足さずに経過時間で進める（夏時間の切り替えでも1時間おきのまま）
      return t;
    }
    const [y, m, date] = [d.getFullYear(), d.getMonth(), d.getDate()];
    if (r.kind === 'monthly') {
      // 今月の分が過ぎていても、来月の分は必ず後になる
      for (let i = 0; i < 2; i++) {
        const t = new Date(y, m + i, Math.min(r.day, daysInMonth(y, m + i)), r.hour, r.minute).getTime();
        if (t > base) return t;
      }
      return null;
    }
    // 今日の分が過ぎていても、同じ曜日の7日後は必ず後になる
    for (let i = 0; i < 8; i++) {
      const c = new Date(y, m, date + i, r.hour, r.minute);
      if (c.getTime() > base && (r.kind === 'daily' || r.weekdays.includes(c.getDay()))) return c.getTime();
    }
    return null;
  }

  const pad = (n) => String(n).padStart(2, '0');

  /** 繰り返しの設定を、画面に出す言葉にする（形になっていなければ空文字） */
  function describeRule(rule) {
    const r = cleanRule(rule);
    if (!r) return '';
    if (r.kind === 'once') {
      const d = new Date(r.at);
      return `1回だけ ${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    if (r.kind === 'hourly') return `毎時 ${r.minute}分`;
    const time = `${pad(r.hour)}:${pad(r.minute)}`;
    if (r.kind === 'daily') return `毎日 ${time}`;
    if (r.kind === 'weekly') return `毎週 ${r.weekdays.map((d) => WEEKDAY_NAMES[d]).join('・')} ${time}`;
    return `毎月 ${r.day}日 ${time}${r.day > 28 ? '（ない月は末日）' : ''}`;
  }

  function cleanRuns(list) {
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      if (out.length >= MAX_RUNS) break;
      const at = x && timeOrNull(x.at);
      if (!at || !RUN_STATUSES.includes(x.status)) continue;
      out.push({ at, status: x.status, cardId: str(x.cardId), message: str(x.message) });
    }
    return out;
  }

  /**
   * スケジュールを整える。入力の確かめは scheduleError、ここは保存する形にそろえるだけで、例外は出さない
   * nextRunAt がなければ now から計算し、次回がないスケジュールは止める（動くはずのものが黙って動かなくならないように）
   * @returns {object|null} リポジトリか繰り返しがなければ null
   */
  function cleanSchedule(raw, { now = Date.now() } = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const repoPath = str(raw.repoPath).trim();
    const rule = cleanRule(raw.rule);
    if (!repoPath || !rule) return null;
    const prompt = str(raw.prompt).trim();
    const enabled = raw.enabled !== false;
    const nextRunAt = enabled ? timeOrNull(raw.nextRunAt) || nextRun(rule, now) : null;
    return {
      id: str(raw.id).trim(),
      repoPath,
      title: str(raw.title).trim() || [...prompt.split('\n')[0].trim()].slice(0, TITLE_MAX).join(''),
      prompt,
      skill: str(raw.skill).trim(),
      agent: str(raw.agent).trim(),
      model: str(raw.model).trim(),
      readOnly: raw.readOnly === true,
      rule,
      enabled: enabled && nextRunAt !== null,
      catchUp: raw.catchUp === true,
      createdAt: timeOrNull(raw.createdAt) || now,
      updatedAt: timeOrNull(raw.updatedAt) || now,
      nextRunAt,
      sourceCardId: str(raw.sourceCardId),
      lastRunAt: timeOrNull(raw.lastRunAt),
      lastStatus: RUN_STATUSES.includes(raw.lastStatus) ? raw.lastStatus : '',
      lastError: str(raw.lastError),
      lastCardId: str(raw.lastCardId),
      runs: cleanRuns(raw.runs),
    };
  }

  // 保存されていた一覧を整える（壊れたもの・ID のないもの・ID の重なりを捨てる）
  function cleanSchedules(list, opts) {
    const out = [];
    const ids = new Set();
    for (const x of Array.isArray(list) ? list : []) {
      const s = cleanSchedule(x, opts);
      if (!s || !s.id || ids.has(s.id)) continue;
      ids.add(s.id);
      out.push(s);
    }
    return out;
  }

  /** 登録・編集の入力を確かめる。問題があれば、画面に出す文を返す（問題がなければ空文字） */
  function scheduleError(input) {
    const i = input || {};
    if (!str(i.repoPath).trim()) return '先にリポジトリを選んでください';
    if (!str(i.prompt).trim()) return '指示を入力してください';
    const kind = i.rule && i.rule.kind;
    if (cleanRule(i.rule)) return '';
    if (kind === 'once') return '実行する日時を入力してください';
    if (kind === 'weekly' && !(Array.isArray(i.rule.weekdays) && i.rule.weekdays.length)) return '曜日を1つ以上選んでください';
    if (RULE_KINDS.includes(kind)) return '繰り返しの日時の値が正しくありません';
    return '繰り返しの種類を選んでください';
  }

  return {
    RULE_KINDS,
    RUN_STATUSES,
    WEEKDAY_NAMES,
    MAX_RUNS,
    LATE_MS,
    cleanRule,
    nextRun,
    describeRule,
    cleanRuns,
    cleanSchedule,
    cleanSchedules,
    scheduleError,
  };
});
