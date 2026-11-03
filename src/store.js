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
  pushAfterMerge: true, // マージしたあと origin にも push する（マージのダイアログで最後に選んだもの）
};

class Store {
  constructor(file) {
    this.file = file;
    this.data = { settings: { ...DEFAULT_SETTINGS }, cards: [] };
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
      this.data.cards = Array.isArray(raw.cards) ? raw.cards : [];
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

  removeCard(id) {
    this.data.cards = this.data.cards.filter((c) => c.id !== id);
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
