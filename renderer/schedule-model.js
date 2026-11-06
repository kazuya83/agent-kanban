// タスクスケジューラのスケジュールの形・確かめ方・次回の日時の決め方。
// レンダラ（<script> で読み込む。スケジューラの画面）と、アプリ本体（require。スケジュールを動かす）の両方から使う。
//
// スケジュール: {
//   id, repoPath, title, prompt, skill, agent, model, readOnly,
//   rule,                      繰り返し（下の RULE の形）
//   issues,                    Issue の監視のときの設定（下の ISSUES の形）。通常のスケジュールは null
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
//   { kind: 'interval', minutes }               N分おき（1〜1440）
//   { kind: 'hourly', minute }                  毎時
//   { kind: 'daily', hour, minute }             毎日
//   { kind: 'weekly', weekdays, hour, minute }  毎週（weekdays は 0=日〜6=土 を1つ以上）
//   { kind: 'monthly', day, hour, minute }      毎月（その月にない日は、その月の末日）
// ISSUES（確認のたびに、新しい Issue 1件につきカードを1枚作る）:
//   { labels,                   この全部のラベルが付いた Issue だけ。空なら絞らない
//     author,                   この人が作った Issue だけ（@me は gh のログインユーザー）。空なら絞らない
//     autoStart,                true ならカードを作ってすぐ開始する。false なら Todo に置くだけ
//     after,                    この日時より後に作られた Issue だけを対象にする（監視を始めた日時）
//     seen,                     もうカードにした Issue の番号（新しいものを SEEN_MAX 件まで）
//     lastCheckedAt }           最後に確認できた日時
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScheduleModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const i18n = typeof module === 'object' && module.exports ? require('./i18n.js') : typeof I18n !== 'undefined' ? I18n : null;
  function tr(key, vars) {
    if (i18n) return i18n.tr(key, vars);
    return vars ? String(key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : key;
  }
  function weekdayNames() {
    return [tr('日'), tr('月'), tr('火'), tr('水'), tr('木'), tr('金'), tr('土')];
  }
  const RULE_KINDS = ['once', 'interval', 'hourly', 'daily', 'weekly', 'monthly'];
  const RUN_STATUSES = ['ok', 'skipped', 'missed', 'failed'];
  const MAX_RUNS = 20;
  const LATE_MS = 10 * 60 * 1000; // 予定からこれより遅れたら「見送り」にする（アプリの停止・スリープ）
  const TITLE_MAX = 40; // タイトルを指示の1行目から作るときの長さ（タスクのカードと同じ）
  const MAX_TIME = 8.64e15; // Date で表せる最後の時刻
  const INTERVAL_MIN = 1; // N分おきの範囲。チェックのタイマーが30秒おきなので、これより細かくしても意味がない
  const INTERVAL_MAX = 24 * 60;
  const ISSUE_BATCH = 10; // 1回の確認で作るカードの上限。残りは次回へ回す（Issue が一度に大量に作られても、カードで埋まらないように）
  const SEEN_MAX = 500;

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
    if (kind === 'interval') {
      const minutes = intIn(rule.minutes, INTERVAL_MIN, INTERVAL_MAX);
      return Number.isNaN(minutes) ? null : { kind, minutes };
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
    if (r.kind === 'interval') return base + r.minutes * 60 * 1000;
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
      return tr('1回だけ {date} {time}', {
        date: `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      });
    }
    if (r.kind === 'interval') return tr('{minutes}分おき', { minutes: r.minutes });
    if (r.kind === 'hourly') return tr('毎時 {minute}分', { minute: r.minute });
    const time = `${pad(r.hour)}:${pad(r.minute)}`;
    if (r.kind === 'daily') return tr('毎日 {time}', { time });
    if (r.kind === 'weekly') return tr('毎週 {days} {time}', { days: r.weekdays.map((d) => weekdayNames()[d]).join(tr('・')), time });
    return r.day > 28 ? tr('毎月 {day}日 {time}（ない月は末日）', { day: r.day, time }) : tr('毎月 {day}日 {time}', { day: r.day, time });
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

  /** ラベルの入力（カンマ区切り。ラベル名には空白が入ることがある）を一覧にする */
  function parseLabels(v) {
    const list = Array.isArray(v) ? v : str(v).split(/[,、]/);
    return [...new Set(list.map((x) => str(x).trim()).filter(Boolean))];
  }

  /**
   * Issue の監視の設定を整える
   * @param {number} from 日時が保存されていないときに、監視を始めた日時とする値
   * @returns {object|null} 監視でなければ null
   */
  function cleanIssueWatch(raw, from) {
    if (!raw || typeof raw !== 'object') return null;
    const seen = (Array.isArray(raw.seen) ? raw.seen : []).filter((n) => Number.isInteger(n) && n > 0);
    return {
      labels: parseLabels(raw.labels),
      author: str(raw.author).trim().replace(/^@(?!me$)/, ''),
      autoStart: raw.autoStart === true,
      after: timeOrNull(raw.after) || from,
      seen: [...new Set(seen)].slice(-SEEN_MAX),
      lastCheckedAt: timeOrNull(raw.lastCheckedAt),
    };
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
    const issues = cleanIssueWatch(raw.issues, timeOrNull(raw.createdAt) || now);
    return {
      id: str(raw.id).trim(),
      repoPath,
      title: str(raw.title).trim() || [...prompt.split('\n')[0].trim()].slice(0, TITLE_MAX).join('') || (issues ? tr('Issue の監視') : ''),
      prompt,
      skill: str(raw.skill).trim(),
      agent: str(raw.agent).trim(),
      model: str(raw.model).trim(),
      readOnly: raw.readOnly === true,
      rule,
      issues,
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
    if (!str(i.repoPath).trim()) return tr('先にリポジトリを選んでください');
    if (!i.issues && !str(i.prompt).trim()) return tr('指示を入力してください'); // Issue の監視では、指示は Issue から作る
    const kind = i.rule && i.rule.kind;
    if (cleanRule(i.rule)) return '';
    if (kind === 'once') return tr('実行する日時を入力してください');
    if (kind === 'weekly' && !(Array.isArray(i.rule.weekdays) && i.rule.weekdays.length)) return tr('曜日を1つ以上選んでください');
    if (RULE_KINDS.includes(kind)) return tr('繰り返しの日時の値が正しくありません');
    return tr('繰り返しの種類を選んでください');
  }

  return {
    RULE_KINDS,
    RUN_STATUSES,
    get WEEKDAY_NAMES() {
      return weekdayNames();
    },
    MAX_RUNS,
    LATE_MS,
    INTERVAL_MIN,
    INTERVAL_MAX,
    ISSUE_BATCH,
    SEEN_MAX,
    cleanRule,
    nextRun,
    describeRule,
    cleanRuns,
    parseLabels,
    cleanIssueWatch,
    cleanSchedule,
    cleanSchedules,
    scheduleError,
  };
});
