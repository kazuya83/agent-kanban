// トークンなどの秘密を、OS の安全な保存先（Electron の safeStorage）の鍵で暗号化して userData/secrets.json に保存する。
// - 平文では保存しない。safeStorage が使えなければ、保存せずにエラーにする
// - ファイルは board.json と別にする（board.json の中身は画面と遠隔のクライアントに渡るため）
// - 値を読めるのは get だけ。get はメインプロセスの中で、接続先へ送る直前にだけ呼ぶ。
//   画面・遠隔のクライアント・ログ・エージェントの環境変数には渡さない（渡すのは has の結果だけ）
const fs = require('fs');
const path = require('path');
const { tr } = require('../renderer/i18n');

const VERSION = 1;

class SecretStore {
  /** @param {{ file: string, safeStorage: object }} p safeStorage は Electron のもの（テストでは差し替える） */
  constructor({ file, safeStorage }) {
    this.file = file;
    this.safeStorage = safeStorage;
    this.items = null;
  }

  // 暗号化できるか。Linux で鍵の保管先が無いときの basic_text は、固定の鍵で隠すだけなので使わない
  available() {
    const s = this.safeStorage;
    if (!s || !s.isEncryptionAvailable()) return false;
    return !(typeof s.getSelectedStorageBackend === 'function' && s.getSelectedStorageBackend() === 'basic_text');
  }

  load() {
    if (this.items) return this.items;
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      /* まだ無い・壊れている: 何も保存していないものとして扱う */
    }
    this.items = raw && raw.items && typeof raw.items === 'object' ? { ...raw.items } : {};
    return this.items;
  }

  write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, items: this.items }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  has(name) {
    return Object.prototype.hasOwnProperty.call(this.load(), name);
  }

  set(name, value) {
    const text = String(value == null ? '' : value);
    if (!text) throw new Error(tr('保存する値が空です'));
    if (!this.available()) throw new Error(tr('このマシンでは OS の安全な保存先を使えないので、トークンを保存できません（平文では保存しません）。Linux では GNOME Keyring や KWallet などを使えるようにしてください'));
    this.load()[name] = this.safeStorage.encryptString(text).toString('base64');
    this.write();
  }

  // 値を読む。無ければ ''
  get(name) {
    if (!this.has(name)) return '';
    if (!this.available()) throw new Error(tr('このマシンでは OS の安全な保存先を使えないので、保存したトークンを読めません'));
    try {
      return this.safeStorage.decryptString(Buffer.from(this.items[name], 'base64'));
    } catch {
      throw new Error(tr('保存したトークンを読めませんでした。設定の「連携」で入れ直してください'));
    }
  }

  delete(name) {
    if (!this.has(name)) return false;
    delete this.items[name];
    this.write();
    return true;
  }
}

module.exports = { SecretStore };
