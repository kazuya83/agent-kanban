// ボードの状態を JSON ファイルに保存する
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  repoPath: '',
  baseBranch: '', // 空なら、開始時にチェックアウトしているブランチ
  permissionMode: 'acceptEdits', // default / acceptEdits / plan / bypassPermissions
  allowedTools: '', // カンマ・改行区切り（例: Bash(npm test:*), WebSearch）
  model: '',
  claudePath: 'claude',
  maxParallel: 3,
  defaultSkill: '', // 新しいタスクを作るときに最初から選んでおくスキル
  integration: 'merge', // レビュー後の取り込み方: merge（ローカルで直接マージ） / pr（push してプルリクエストを作る）
  issueStatusSync: true, // Issue から作ったタスクの列に合わせて、GitHub Projects の Status（In progress / In review / Done）を変える
  pushAfterMerge: true, // マージしたあと origin にも push する（マージのダイアログで最後に選んだもの）
};

class Store {
  constructor(file) {
    this.file = file;
    this.data = { settings: { ...DEFAULT_SETTINGS }, cards: [], removedCost: {} };
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
      this.data.cards = Array.isArray(raw.cards) ? raw.cards : [];
      this.data.removedCost = raw.removedCost && typeof raw.removedCost === 'object' ? raw.removedCost : {};
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
}

module.exports = { Store, DEFAULT_SETTINGS };
