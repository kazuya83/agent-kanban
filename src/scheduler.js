// タスクスケジューラ: 登録したスケジュールの時刻になったら、カードを作って開始する
// - アプリの起動中だけ、アプリの中のタイマーで動く（遠隔操作のときはホスト側で動く）
// - タブを開いていないリポジトリのスケジュールも動かす
// - カードを作ったあとは通常のタスクと同じ（承認・同時実行数・レビュー）。ただし仕様の確認はしない（人が見ていないところで止まるため）
// - Issue の監視（s.issues）は、時刻になったら GitHub の Issue を読み、新しい Issue 1件につきカードを1枚作る
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const { ISSUE_BATCH, LATE_MS, MAX_RUNS, SEEN_MAX, cleanRule, cleanSchedule, nextRun, parseLabels, scheduleError } = require('../renderer/schedule-model');
const { tr } = require('../renderer/i18n');
const providers = require('./providers');

const TICK_MS = 30 * 1000;
// 登録・編集で変えられる項目（履歴や次回の日時は、ここからは変えられない）
const EDIT_KEYS = ['title', 'prompt', 'skill', 'agent', 'model', 'readOnly', 'rule', 'enabled', 'catchUp'];

// まだ終わっていないカードか（Pipeline の親は、並列の枝やサブタスクを待つあいだ review の列にいる）
function isBusy(c) {
  return ['todo', 'queued', 'running'].includes(c.status) || !!(c.relay && c.relay.waiting) || (!!c.subtasks && c.subtasks.phase === 'run');
}

// 画面から受け取る Issue の監視の設定。after（監視を始めた日時）と seen は、ここからは変えられない
function issueForm(input, prev, now) {
  if (!input) return null;
  const { labels, author, autoStart } = input;
  return { ...(prev || { after: now }), labels: parseLabels(labels), author, autoStart };
}

class Scheduler extends EventEmitter {
  /**
   * @param {object} deps
   * @param {object} deps.store src/store.js の Store
   * @param {object} deps.agents AgentManager（createTask / createFromWatchedIssue / listIssues / start / notify / shuttingDown を使う）
   * @param {() => number} [deps.now] 今の時刻
   * @param {(dir: string) => boolean} [deps.exists] フォルダがあるか
   */
  constructor({ store, agents, now = Date.now, exists = fs.existsSync, setTimer = setInterval, clearTimer = clearInterval }) {
    super();
    this.store = store;
    this.agents = agents;
    this.now = now;
    this.exists = exists;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.polling = new Map(); // Issue を確認している最中のスケジュール（ID → 確認の Promise）
  }

  start() {
    if (this.timer) return;
    this.timer = this.setTimer(() => this.tick(), TICK_MS);
    if (this.timer && this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }

  must(id) {
    const s = this.store.schedule(id);
    if (!s) throw new Error(tr('スケジュールが見つかりません（消されたかもしれません）'));
    return s;
  }

  // 保存して、画面に知らせる
  changed(id) {
    this.store.save();
    this.emit('changed', id);
  }

  /** スケジュールを登録する。repoPath を省くと今のリポジトリ */
  create(input = {}) {
    const now = this.now();
    const form = { repoPath: input.repoPath || this.store.settings.repoPath, sourceCardId: input.sourceCardId };
    for (const k of EDIT_KEYS) form[k] = input[k];
    form.issues = issueForm(input.issues, null, now);
    const err = scheduleError(form);
    if (err) throw new Error(err);
    if (form.enabled !== false && nextRun(form.rule, now) === null) throw new Error(tr('実行する日時が過ぎています。これからの日時を入力してください'));
    const s = cleanSchedule({ ...form, id: crypto.randomBytes(4).toString('hex'), createdAt: now, updatedAt: now, nextRunAt: null }, { now });
    this.store.addSchedule(s);
    this.changed(s.id);
    return s;
  }

  /** スケジュールを変える。繰り返しを変えた・再開したときだけ、次回の日時を今から計算し直す */
  update(id, patch = {}) {
    const s = this.must(id);
    const now = this.now();
    const next = { ...s };
    for (const k of EDIT_KEYS) if (patch[k] !== undefined) next[k] = patch[k];
    if (patch.issues !== undefined) next.issues = issueForm(patch.issues, s.issues, now);
    const err = scheduleError(next);
    if (err) throw new Error(err);
    const sameRule = JSON.stringify(cleanRule(next.rule)) === JSON.stringify(s.rule);
    if (next.enabled === false) next.nextRunAt = null;
    else if (!(sameRule && s.enabled)) {
      next.nextRunAt = nextRun(next.rule, now);
      if (next.nextRunAt === null) throw new Error(tr('実行する日時が過ぎています。これからの日時に変えてください'));
    }
    Object.assign(s, cleanSchedule({ ...next, updatedAt: now }, { now }));
    this.changed(s.id);
    return s;
  }

  /** スケジュールを消す（作ったカードは残す） */
  remove(id) {
    this.must(id);
    this.store.removeSchedule(id);
    this.changed(id);
  }

  /**
   * 今すぐカードを作る（「今すぐ実行」「タスクだけ作成」）。次回の予定はそのまま
   * 人が押したので、前回のカードが残っていても作る。失敗は記録して、例外で画面に返す
   * @param {{ id: string, start?: boolean }} arg start が false なら作るだけ（Todo に置く）
   * @returns {object[]} 作ったカード
   */
  run({ id, start = true } = {}) {
    const s = this.must(id);
    if (this.agents.shuttingDown) throw new Error(tr('アプリを終了しています'));
    const res = this.fire(s, start);
    this.changed(s.id);
    if (res.error) throw new Error(res.error);
    return res.cards;
  }

  /**
   * Issue の監視を今すぐ確認する（「今すぐ確認」）。次回の予定はそのまま
   * @returns {Promise<string[]>} 作ったカードの ID
   */
  async runIssues(id) {
    const s = this.must(id);
    if (this.agents.shuttingDown) throw new Error(tr('アプリを終了しています'));
    const res = await this.checkIssues(s);
    this.changed(s.id);
    if (res.error) throw new Error(res.error);
    return res.cards.map((c) => c.id);
  }

  /**
   * 時刻になったスケジュールを動かす（タイマーから呼ぶ）
   * @returns {Promise} Issue の確認がすべて終わったら解決する（タイマーは待たない）
   */
  tick() {
    const now = this.now();
    const checks = [];
    for (const s of [...this.store.schedules]) {
      if (this.agents.shuttingDown) return;
      if (!s.enabled || s.nextRunAt === null || s.nextRunAt > now) continue;
      try {
        // 確認は時間がかかるので待たずに進む。読み終わる前に次の tick が来ないよう、次回の日時は先に進める
        if (s.issues) checks.push(this.checkDue(s));
        else this.runDue(s, now);
      } catch (e) {
        // 1つのスケジュールの問題で、ほかを止めない
        console.error(`スケジュール ${s.id} の実行に失敗しました`, e);
      }
      this.advance(s, now);
      this.changed(s.id);
    }
    return Promise.all(checks);
  }

  // 時刻になった Issue の監視を確認する。アプリを閉じていたあいだの Issue も拾いたいので、遅れていても見送らない。
  // 何度も確認するものなので、続けて失敗しているあいだは通知を繰り返さない
  async checkDue(s) {
    if (this.polling.has(s.id)) return;
    const failing = s.lastStatus === 'failed';
    try {
      const { error } = await this.checkIssues(s);
      if (!this.alive(s)) return;
      if (error) {
        const gone = !this.exists(s.repoPath);
        if (gone) {
          s.enabled = false;
          s.nextRunAt = null;
        }
        if (gone) this.alert(s, tr('{error}\nスケジュールを停止しました', { error }));
        else if (!failing) this.alert(s, error);
      }
      this.changed(s.id);
    } catch (e) {
      console.error(`スケジュール ${s.id} の確認に失敗しました`, e);
    }
  }

  // 消されたスケジュールや、終了中のアプリでは、続けない
  alive(s) {
    return !this.agents.shuttingDown && this.store.schedule(s.id) === s;
  }

  // 同じスケジュールの確認を重ねない（時刻の確認と「今すぐ確認」が重なると、同じ Issue のカードが2枚できる）
  checkIssues(s) {
    if (!this.polling.has(s.id)) {
      this.polling.set(s.id, this.readIssues(s).finally(() => this.polling.delete(s.id)));
    }
    return this.polling.get(s.id);
  }

  // Issue を読んで、新しいものをカードにする。{ cards, error } を返す（例外は出さない）
  async readIssues(s) {
    const failed = (error) => {
      this.record(s, { at: this.now(), status: 'failed', message: error });
      return { cards: [], error };
    };
    if (!this.exists(s.repoPath)) return failed(tr('リポジトリが見つかりません: {path}', { path: s.repoPath }));
    let list;
    try {
      list = await this.agents.listIssues(s.repoPath, { labels: s.issues.labels, author: s.issues.author });
    } catch (e) {
      return failed(tr('Issue を読めませんでした: {message}', { message: e.message }));
    }
    if (!this.alive(s) || !s.issues) return { cards: [], error: '' };
    s.issues.lastCheckedAt = this.now();
    const fresh = list
      .filter((x) => x.createdAt > s.issues.after && !s.issues.seen.includes(x.number))
      .sort((a, b) => a.number - b.number); // 古い順に。上限を超えた分は次回に回る
    const cards = [];
    const errors = [];
    for (const issue of fresh.slice(0, ISSUE_BATCH)) {
      if (!this.alive(s) || !s.issues) break;
      if (s.issues.seen.includes(issue.number)) continue; // 親の Issue のサブタスクになった
      const res = await this.fireIssue(s, issue);
      cards.push(...res.cards);
      if (res.error) errors.push(res.error);
    }
    if (!errors.length && s.lastStatus === 'failed') {
      s.lastStatus = 'ok'; // 確認が通ったら、前回の失敗の表示を消す。新しい Issue がないときは履歴には残さない
      s.lastError = '';
    }
    return { cards, error: errors.join('\n') };
  }

  // 番号を覚える（同じ Issue のカードを、もう作らない）
  markSeen(s, ...numbers) {
    if (s.issues) s.issues.seen = [...new Set([...s.issues.seen, ...numbers])].slice(-SEEN_MAX);
  }

  // Issue 1件をカードにして結果を記録する。{ cards, error } を返す（例外は出さない）
  async fireIssue(s, issue) {
    const at = this.now();
    const { number } = issue;
    // 手で作ったカードがあるときや、カードを消したあとの Issue は作らない
    if (this.store.cards.some((c) => c.repoPath === s.repoPath && c.issue && c.issue.number === number)) {
      this.markSeen(s, number);
      return { cards: [], error: '' };
    }
    const start = s.issues.autoStart;
    let cards;
    try {
      cards = await this.agents.createFromWatchedIssue(s.repoPath, number, s.prompt, {
        ...this.agentOf(s),
        skill: s.skill,
        readOnly: s.readOnly,
        skipSpecCheck: start, // Todo に置くなら、人が開始するので、ふつうのタスクと同じく仕様を確認する
        scheduleId: s.id,
        scheduleTitle: s.title,
      });
      if (!cards || !cards.length) throw new Error(tr('タスクを作れませんでした'));
    } catch (e) {
      const error = `#${number}: ${e.message}`;
      this.record(s, { at, status: 'failed', message: error });
      return { cards: [], error }; // 覚えないので、次回もう一度試す
    }
    // サブタスクになったサブIssue は、別のカードにしない
    const subs = cards.flatMap((c) => ((c.subtasks && c.subtasks.items) || []).map((x) => x.issue && x.issue.number));
    this.markSeen(s, number, ...subs.filter(Boolean));
    const cardId = cards[0].id;
    s.lastRunAt = at;
    s.lastCardId = cardId;
    try {
      if (start) for (const c of cards) this.agents.start(c.id);
    } catch (e) {
      const error = tr('タスクは作りましたが、開始できませんでした: {message}', { message: e.message });
      this.record(s, { at, status: 'failed', cardId, message: error });
      return { cards, error };
    }
    this.record(s, { at, status: 'ok', cardId, message: start ? tr('#{number} のタスクを作って開始しました', { number }) : tr('#{number} のタスクを作りました', { number }) });
    return { cards, error: '' };
  }

  // 使うエージェント。登録したあとで使わない設定にしたものなら、今使えるエージェント（最初から選んでおくもの）で動かす
  agentOf(s) {
    const off = providers.isAgent(s.agent) && !providers.isEnabled(this.store.settings, s.agent);
    return off ? { agent: undefined, model: undefined } : { agent: s.agent, model: s.model };
  }

  // 時刻になったスケジュールを、状況に応じて実行するか見送る
  runDue(s, now) {
    const due = s.nextRunAt;
    if (now - due > LATE_MS && !s.catchUp) {
      this.record(s, { at: due, status: 'missed', message: tr('予定の時刻にアプリが動いていなかったため、見送りました') });
      return;
    }
    if (this.store.cards.some((c) => c.scheduleId === s.id && isBusy(c))) {
      this.record(s, { at: now, status: 'skipped', message: tr('前回のタスクが終わっていないため、見送りました') });
      return;
    }
    const res = this.fire(s, true);
    if (!res.error) return;
    // リポジトリが消えたスケジュールは、そのリポジトリを開けないので画面から止めることも消すこともできない。
    // 失敗の通知が続かないよう、ここで止める（フォルダが戻れば、開いて「再開」できる）
    const gone = !this.exists(s.repoPath);
    if (gone) s.enabled = false;
    this.alert(s, gone ? tr('{error}\nスケジュールを停止しました', { error: res.error }) : res.error);
  }

  // 次回へ進む（遅れた分を積み上げないよう、今の時刻から計算する）。次回がなければ止める
  advance(s, now) {
    s.nextRunAt = s.enabled ? nextRun(s.rule, now) : null;
    if (s.nextRunAt === null) s.enabled = false;
  }

  // カードを作って結果を記録する。{ cards, error } を返す（例外は出さない）
  fire(s, start) {
    const at = this.now();
    if (!this.exists(s.repoPath)) {
      const error = tr('リポジトリが見つかりません: {path}', { path: s.repoPath });
      this.record(s, { at, status: 'failed', message: error });
      return { cards: [], error };
    }
    let cards;
    try {
      cards = this.agents.createTask({
        title: s.title,
        prompt: s.prompt,
        skill: s.skill,
        ...this.agentOf(s),
        readOnly: s.readOnly,
        repoPath: s.repoPath,
        skipSpecCheck: true,
        scheduleId: s.id,
        scheduleTitle: s.title,
      });
      if (!cards || !cards.length) throw new Error(tr('タスクを作れませんでした'));
    } catch (e) {
      this.record(s, { at, status: 'failed', message: e.message });
      return { cards: [], error: e.message };
    }
    const cardId = cards[0].id;
    s.lastRunAt = at; // カードを作ったときだけ変える
    s.lastCardId = cardId;
    try {
      if (start) for (const c of cards) this.agents.start(c.id);
    } catch (e) {
      const error = tr('タスクは作りましたが、開始できませんでした: {message}', { message: e.message });
      this.record(s, { at, status: 'failed', cardId, message: error });
      return { cards, error };
    }
    this.record(s, { at, status: 'ok', cardId, message: start ? tr('タスクを作って開始しました') : tr('タスクを作りました') });
    return { cards, error: '' };
  }

  // 実行の記録を残す（新しい順。MAX_RUNS 件まで）
  record(s, { at, status, cardId = '', message }) {
    s.lastStatus = status;
    s.lastError = status === 'failed' ? message : '';
    s.runs = [{ at, status, cardId, message }, ...s.runs].slice(0, MAX_RUNS);
    s.updatedAt = this.now();
  }

  // 直前に記録した失敗を通知する（カードを作れなかったときは cardId が空）
  alert(s, message) {
    try {
      this.agents.notify({ id: s.runs[0].cardId, title: s.title, repoPath: s.repoPath }, 'schedule', tr('スケジュールの実行に失敗: {title}', { title: s.title }), message);
    } catch (e) {
      console.error('スケジュールの失敗を通知できませんでした', e);
    }
  }
}

module.exports = { Scheduler, TICK_MS };
