// ボードの状態を JSON ファイルに保存する
const fs = require('fs');
const path = require('path');
const { DEFAULT_RELAY_STEPS, DEFAULT_COMPETE_AGENTS, DEFAULT_ENABLED_AGENTS, isAgent, cleanEnabledAgents, cleanOrchestration } = require('./providers');

const DEFAULT_SETTINGS = {
  repoPath: '',
  lastRepoParent: '', // クローン・新規作成で最後に使った置き場所（親フォルダ）
  baseBranch: '', // 空なら、開始時にチェックアウトしているブランチ
  permissionMode: 'acceptEdits', // default / acceptEdits / plan / bypassPermissions
  allowedTools: '', // カンマ・改行区切り（例: Bash(npm test:*), WebSearch）
  model: '',
  claudePath: 'claude',
  maxParallel: 3,
  defaultSkill: '', // 新しいタスクを作るときに最初から選んでおくスキル
  integration: 'merge', // レビュー後の取り込み方: merge（ローカルで直接マージ） / pr（push してプルリクエストを作る）
  issueStatusSync: true, // Issue から作ったタスクの列に合わせて、GitHub Projects の Status（In progress / In review / Done）を変える
  statusFieldName: '', // Projects で変える項目（単一選択）の名前。空なら「Status」
  statusMapping: { inProgress: '', inReview: '', done: '' }, // 列ごとに使う選択肢の名前（カンマ区切りで複数可）。空なら名前から自動で探す
  pushAfterMerge: true, // マージしたあと origin にも push する（マージのダイアログで最後に選んだもの）
  suggestSkillsOnDone: true, // タスクが完了したら「スキルにしませんか？」と通知する
  specCheck: true, // 新しいタスクの内容が詰まっていなければ、開発を始める前にエージェントと対話して仕様を詰める
  branchNamingRule: '', // ブランチの命名規則（自然言語）。空なら agent/issue-12-xxxx のようないつもの名前
  weeklyResetDay: '', // Claude の週間上限がリセットされる曜日（'0'=日〜'6'=土）。空なら claude が知らせてくる日時を使う
  weeklyResetTime: '00:00', // 週間上限がリセットされる時刻（HH:MM・ローカル時刻）。weeklyResetDay を決めたときに使う
  // ---- エージェント ----
  enabledAgents: DEFAULT_ENABLED_AGENTS, // 使うエージェント（チェックを付けたものだけ、コマンド・モデルを設定してタスクや会話で選べる）
  defaultAgent: 'claude', // 新しいタスク・会話で最初から選んでおくエージェント（claude / codex / gemini / cursor。Pipeline・競争はタスクを作るときに選ぶ）
  codexPath: 'codex',
  codexModel: '',
  geminiPath: 'gemini',
  geminiModel: '',
  cursorPath: 'cursor-agent',
  cursorModel: '',
  // ---- オーケストレーション ----
  orchestration: 'relay', // Pipelineと競争は排他。使うのはどちらか1つ（'relay' / 'compete'）
  relaySteps: DEFAULT_RELAY_STEPS, // Pipeline: 同じ worktree で、工程ごとに別のエージェントへ順番に引き継ぐ
  competeAgents: DEFAULT_COMPETE_AGENTS, // 競争: 同じタスクを、これらのエージェントで並列に解かせる
  // ---- 遠隔操作（SSH トンネル前提。アプリ同士） ----
  remoteHostEnabled: false, // このマシンをホスト（作業側）として 127.0.0.1 で待ち受ける
  remotePort: 17831, // ホストの待ち受けポート（クライアントは SSH -L でここにトンネルする）
  remotePairTokens: [], // ペアリング済みクライアントのトークン（ホスト側）
  remoteClientHost: '127.0.0.1', // 接続先（トンネル後は通常 127.0.0.1）
  remoteClientPort: 17831,
  remoteClientToken: '', // ペアリング後に保存するトークン（クライアント側）
  claudeRemoteControl: false, // Claude カード起動時に公式 Remote Control（--remote-control）も付ける
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const COST_LOG_KEEP_MS = 8 * WEEK_MS; // これより古い金額の記録は捨てる

// リセット日時の1つ（anchor）から、now を含む1週間 [start, end) を求める
function weekAround(anchorMs, now) {
  const k = Math.floor((now - anchorMs) / WEEK_MS) + 1;
  const end = anchorMs + k * WEEK_MS;
  return { start: end - WEEK_MS, end };
}

// 曜日と時刻（ローカル）から、直近のリセット日時を1つ作る
function anchorFromDay(day, time, now) {
  const [h, m] = String(time || '00:00').split(':').map((v) => parseInt(v, 10) || 0);
  const d = new Date(now);
  d.setHours(Math.min(23, Math.max(0, h)), Math.min(59, Math.max(0, m)), 0, 0);
  d.setDate(d.getDate() + ((Number(day) - d.getDay() + 7) % 7));
  return d.getTime();
}

const MAX_NOTIFICATIONS = 200;

// 前のバージョンの設定を今の形に直す
function migrateSettings(settings, raw, cards) {
  if (!Array.isArray(raw.enabledAgents)) {
    // 「使うエージェント」がなかったころの設定: 今まで使っていたエージェントにチェックを付けておく
    const used = new Set(['claude']);
    const d = raw.defaultAgent;
    if (isAgent(d)) used.add(d);
    if (d === 'relay') for (const st of settings.relaySteps || []) used.add(st && st.agent);
    if (d === 'compete') for (const a of settings.competeAgents || []) used.add(a);
    for (const c of cards) if (c && c.agent) used.add(c.agent);
    settings.enabledAgents = cleanEnabledAgents([...used]);
  } else settings.enabledAgents = cleanEnabledAgents(raw.enabledAgents);
  // Pipelineと競争は排他（どちらか1つ、またはなし）。知らない値ならPipeline
  settings.orchestration = cleanOrchestration(settings.orchestration);
  // 「最初から選んでおくエージェント」にはPipeline・競争を選べなくなったので、1つのエージェントにする
  if (!isAgent(settings.defaultAgent) || !settings.enabledAgents.includes(settings.defaultAgent)) settings.defaultAgent = settings.enabledAgents[0];
}

class Store {
  constructor(file) {
    this.file = file;
    this.data = { settings: { ...DEFAULT_SETTINGS }, cards: [], removedCost: {}, costLog: [], weeklyResetAt: 0, notifications: [] };
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
      this.data.settings.statusMapping = { ...DEFAULT_SETTINGS.statusMapping, ...(this.data.settings.statusMapping || {}) };
      this.data.cards = Array.isArray(raw.cards) ? raw.cards : [];
      this.data.removedCost = raw.removedCost && typeof raw.removedCost === 'object' ? raw.removedCost : {};
      this.data.notifications = Array.isArray(raw.notifications) ? raw.notifications : [];
      this.data.costLog = Array.isArray(raw.costLog) ? raw.costLog : [];
      this.data.weeklyResetAt = Number(raw.weeklyResetAt) || 0;
      migrateSettings(this.data.settings, raw.settings || {}, this.data.cards);
    } catch {
      /* 初回起動 */
    }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  get settings() {
    return this.data.settings;
  }

  get cards() {
    return this.data.cards;
  }

  get notifications() {
    return this.data.notifications;
  }

  // 通知を足す（新しいものが先頭）。古いものから捨てる
  addNotification(n) {
    this.data.notifications.unshift(n);
    if (this.data.notifications.length > MAX_NOTIFICATIONS) this.data.notifications.length = MAX_NOTIFICATIONS;
    return n;
  }

  card(id) {
    return this.data.cards.find((c) => c.id === id);
  }

  // 削除したタスクで使った金額も合計に残すため、リポジトリごとに足し込んでおく
  removeCard(id) {
    const c = this.card(id);
    if (c && c.costUsd) {
      const key = c.repoPath || '';
      this.data.removedCost[key] = (Number(this.data.removedCost[key]) || 0) + c.costUsd;
    }
    this.data.cards = this.data.cards.filter((c) => c.id !== id);
  }

  // そのリポジトリで使った金額の合計（USD）。削除したタスクの分も含む
  totalCost(repoPath) {
    const live = this.data.cards
      .filter((c) => !repoPath || c.repoPath === repoPath)
      .reduce((sum, c) => sum + (Number(c.costUsd) || 0), 0);
    const removed = repoPath
      ? Number(this.data.removedCost[repoPath]) || 0
      : Object.values(this.data.removedCost).reduce((sum, v) => sum + (Number(v) || 0), 0);
    return live + removed;
  }

  // 使った金額を日時つきで残す（週ごとの合計に使う）
  addCost(repoPath, usd, at = Date.now()) {
    const v = Number(usd) || 0;
    if (v <= 0) return;
    this.data.costLog.push({ at, repo: repoPath || '', usd: v });
    const limit = at - COST_LOG_KEEP_MS;
    if (this.data.costLog[0] && this.data.costLog[0].at < limit) this.data.costLog = this.data.costLog.filter((e) => e.at >= limit);
  }

  // claude が知らせてきた週間上限のリセット日時（ミリ秒）を覚えておく
  setWeeklyResetAt(ms) {
    const v = Number(ms) || 0;
    if (v > 0 && v !== this.data.weeklyResetAt) {
      this.data.weeklyResetAt = v;
      return true;
    }
    return false;
  }

  // 今の週（週間上限のリセットからリセットまで）の期間と、その間に使った金額
  // source: 'settings'（設定の曜日・時刻）/ 'claude'（claude が知らせてきた日時）/ 'default'（どちらもないので月曜 0:00）
  weeklyCost(repoPath, now = Date.now()) {
    const s = this.data.settings;
    let anchor;
    let source;
    if (s.weeklyResetDay !== '' && s.weeklyResetDay != null && /^[0-6]$/.test(String(s.weeklyResetDay))) {
      anchor = anchorFromDay(s.weeklyResetDay, s.weeklyResetTime, now);
      source = 'settings';
    } else if (this.data.weeklyResetAt) {
      anchor = this.data.weeklyResetAt;
      source = 'claude';
    } else {
      anchor = anchorFromDay(1, '00:00', now);
      source = 'default';
    }
    const { start, end } = weekAround(anchor, now);
    const usd = this.data.costLog
      .filter((e) => (!repoPath || e.repo === repoPath) && e.at >= start && e.at < end)
      .reduce((sum, e) => sum + (Number(e.usd) || 0), 0);
    return { usd, start, end, source };
  }
}

module.exports = { migrateSettings, Store, DEFAULT_SETTINGS, MAX_NOTIFICATIONS, weekAround, anchorFromDay, WEEK_MS };
