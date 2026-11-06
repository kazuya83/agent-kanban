// アプリの更新: GitHub Releases の最新版を調べ、install.sh / install.ps1 で入れ替えて起動し直す
//
// 入れ替えは、アプリを終了したあとに裏で動かす小さなスクリプトが行う（起動中のアプリの中身は入れ替えられないため）:
//   1. このアプリのプロセスが終わるのを待つ（終了するときに、実行中のタスクは止めてブランチにコミットする）
//   2. install.sh（Mac / Linux）・install.ps1（Windows）でその版を入れる
//   3. 入れた版を起動する（入れられなかったときは、元のアプリを起動し直す）
// GitHub API は使わない（未ログインだと回数制限で 403 になることがあるため）。install.sh と同じく、
// releases/latest のリダイレクト先（.../releases/tag/v0.1.9）から最新版を調べる
const { EventEmitter } = require('events');
const path = require('path');
const { tr } = require('../renderer/i18n');

const REPO = 'kazuya83/worktree-kanban';
const APP_NAME = 'Worktree Kanban';
const INSTALL_SH = `https://raw.githubusercontent.com/${REPO}/main/install.sh`;
const INSTALL_PS1 = `https://raw.githubusercontent.com/${REPO}/main/install.ps1`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6時間ごとに確かめる

// '0.1.10' と 'v0.1.9' を比べる（a が新しければ正、同じなら 0）
function compareVersions(a, b) {
  const parts = (v) => String(v || '').replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// releases/latest のリダイレクト先の URL から版の番号を取り出す（見つからなければ null）
function versionFromReleaseUrl(url) {
  const m = /\/releases\/tag\/v?(\d+(?:\.\d+)*)\/?$/.exec(String(url || ''));
  return m ? m[1] : null;
}

// その OS・CPU 向けにリリースに載せているファイルの名前（対応していなければ null）
function assetName(platform, arch, version) {
  if (platform === 'darwin') return arch === 'arm64' || arch === 'x64' ? `worktree-kanban-${version}-mac-${arch}.dmg` : null;
  if (platform === 'linux') return arch === 'x64' ? `worktree-kanban-${version}-linux-x86_64.AppImage` : null;
  if (platform === 'win32') return arch === 'x64' ? `worktree-kanban-${version}-win-x64.zip` : null;
  return null;
}

// この環境でアプリから更新できるか。できなければ理由を返す
function unsupportedReason({ packaged, platform, arch, env }) {
  if (!packaged) return tr('開発版（npm start）では更新できません。git pull で最新にしてください');
  if (!assetName(platform, arch, '0')) return tr('この OS・CPU（{platform} {arch}）向けの版はリリースしていません', { platform, arch });
  if (platform === 'linux' && !(env && env.APPIMAGE)) return tr('AppImage で起動したときだけ、アプリから更新できます');
  return null;
}

// bash に渡す文字列を ' で囲む
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// PowerShell に渡す文字列を ' で囲む
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Mac の .app のフォルダ（…/Worktree Kanban.app/Contents/MacOS/Worktree Kanban → …/Worktree Kanban.app）
function macBundlePath(execPath) {
  const i = String(execPath).indexOf('.app/Contents/MacOS/');
  return i >= 0 ? String(execPath).slice(0, i + 4) : '';
}

// アプリを終了したあとに裏で動かす、入れ替えのスクリプト（spawn に渡す command と args）
function installCommand({ platform, pid, version, execPath, env = {} }) {
  const v = String(version).replace(/^v/, '');
  if (!/^\d+(\.\d+)*$/.test(v)) throw new Error(tr('版の番号が正しくありません: {version}', { version }));
  const n = parseInt(pid, 10);
  if (!(n > 0)) throw new Error(tr('プロセス番号が正しくありません'));
  // 入れ替えはアプリ終了後に動くので、スクリプトを作る時点の言語で文を埋め込んでおく
  const starting = tr('v{v} に更新します', { v });
  const done = tr('更新しました');
  const failed = tr('エラー: 更新できませんでした');
  if (platform === 'win32') {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `Wait-Process -Id ${n} -ErrorAction SilentlyContinue`,
      'Start-Sleep -Milliseconds 500',
      `Write-Output (${psq(`==> ${starting}: `)} + (Get-Date))`,
      `$env:AGENT_KANBAN_VERSION = ${psq(v)}`,
      'Remove-Item Env:AGENT_KANBAN_NO_LAUNCH -ErrorAction SilentlyContinue',
      // install.ps1 は入れたあとに起動する。入れられなかったときは元のアプリを起動し直す
      `try { Invoke-RestMethod -Uri ${psq(INSTALL_PS1)} -UseBasicParsing | Invoke-Expression; Write-Output ${psq(`==> ${done}`)} }`,
      `catch { Write-Output (${psq(`${failed}: `)} + $_); Start-Process -FilePath ${psq(execPath)} }`,
    ].join('\n');
    return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script] };
  }
  // Mac / Linux
  let relaunchNew;
  let relaunchOld;
  if (platform === 'darwin') {
    const bundle = macBundlePath(execPath);
    relaunchNew = `if [ -d "/Applications/${APP_NAME}.app" ]; then open "/Applications/${APP_NAME}.app"; else open "$HOME/Applications/${APP_NAME}.app"; fi`;
    relaunchOld = bundle ? `open ${shq(bundle)}` : `open -a ${shq(APP_NAME)}`;
  } else {
    const appImage = env.APPIMAGE || execPath;
    relaunchNew = `nohup "$HOME/.local/bin/worktree-kanban" >/dev/null 2>&1 &`;
    relaunchOld = `nohup ${shq(appImage)} >/dev/null 2>&1 &`;
  }
  const script = [
    `while kill -0 ${n} 2>/dev/null; do sleep 0.5; done`,
    'sleep 0.5',
    `echo ${shq(`==> ${starting}:`)} "$(date)"`,
    'set -o pipefail',
    `if curl -fsSL ${shq(INSTALL_SH)} | AGENT_KANBAN_VERSION=${shq(v)} bash; then`,
    `  echo ${shq(`==> ${done}`)}`,
    `  ${relaunchNew}`,
    'else',
    `  echo ${shq(failed)}`,
    `  ${relaunchOld}`,
    'fi',
  ].join('\n');
  return { command: '/bin/bash', args: ['-c', script] };
}

// 更新の状態を持ち、最新版を調べる。入れ替えは install() でスクリプトを起動するだけ（終了は呼んだ側が行う）
class Updater extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.currentVersion 今のアプリの版
   * @param {boolean} o.packaged パッケージしたアプリか（開発版では更新しない）
   * @param {string} [o.platform] process.platform
   * @param {string} [o.arch] process.arch
   * @param {object} [o.env] process.env
   * @param {Function} [o.fetch] fetch（テストで差し替える）
   * @param {Function} [o.spawn] child_process.spawn（テストで差し替える）
   * @param {string} [o.logFile] 入れ替えのスクリプトの出力を書くファイル
   */
  constructor(o) {
    super();
    this.currentVersion = o.currentVersion;
    this.platform = o.platform || process.platform;
    this.arch = o.arch || process.arch;
    this.env = o.env || process.env;
    this.fetch = o.fetch || ((...a) => fetch(...a));
    this.spawn = o.spawn || require('child_process').spawn;
    this.logFile = o.logFile || '';
    this.reason = unsupportedReason({ packaged: o.packaged, platform: this.platform, arch: this.arch, env: this.env });
    // state: idle（まだ調べていない） / checking / latest（最新） / available（新しい版がある） / preparing（新しい版の、この OS 向けのファイルがまだない） / installing / error
    this.state = 'idle';
    this.latestVersion = '';
    this.error = '';
    this.checkedAt = 0;
    this.checking = null;
    this.timer = null;
  }

  status() {
    return {
      currentVersion: this.currentVersion,
      platform: this.platform,
      supported: !this.reason,
      reason: this.reason || '',
      state: this.state,
      latestVersion: this.latestVersion,
      error: this.error,
      checkedAt: this.checkedAt,
      releaseUrl: this.latestVersion ? `https://github.com/${REPO}/releases/tag/v${this.latestVersion}` : `https://github.com/${REPO}/releases`,
    };
  }

  set(patch) {
    Object.assign(this, patch);
    this.emit('changed', this.status());
  }

  // 最新版を調べる（同時に何回呼んでも、調べるのは1回）
  check() {
    if (this.state === 'installing') return Promise.resolve(this.status());
    if (this.checking) return this.checking;
    this.set({ state: 'checking', error: '' });
    this.checking = (async () => {
      try {
        const res = await this.fetch(`https://github.com/${REPO}/releases/latest`, { method: 'HEAD', redirect: 'follow' });
        const latest = versionFromReleaseUrl(res.url);
        if (!latest) throw new Error(tr('最新のリリースが見つかりませんでした（{status}）', { status: res.status }));
        let state = compareVersions(latest, this.currentVersion) > 0 ? 'available' : 'latest';
        // Mac の dmg は公開のあとに追加されるので、この OS 向けのファイルがそろっているかも確かめる
        const name = state === 'available' && assetName(this.platform, this.arch, latest);
        if (name) {
          const a = await this.fetch(`https://github.com/${REPO}/releases/download/v${latest}/${name}`, { method: 'HEAD', redirect: 'follow' });
          if (!a.ok) state = 'preparing';
        }
        this.set({ state, latestVersion: latest, checkedAt: Date.now() });
      } catch (err) {
        this.set({ state: 'error', error: tr('新しい版を確かめられませんでした: {message}', { message: (err && err.message) || err }), checkedAt: Date.now() });
      } finally {
        this.checking = null;
      }
      return this.status();
    })();
    return this.checking;
  }

  // 起動のすぐあとと、そのあと一定の間隔で確かめる
  startAutoCheck({ firstDelayMs = 10000, intervalMs = CHECK_INTERVAL_MS } = {}) {
    if (this.reason || this.timer) return;
    const first = setTimeout(() => this.check(), firstDelayMs);
    this.timer = setInterval(() => this.check(), intervalMs);
    first.unref?.();
    this.timer.unref?.();
  }

  stopAutoCheck() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // 入れ替えのスクリプトを裏で起動する。このあと呼んだ側がアプリを終了すると、スクリプトが入れ替えて起動し直す
  install({ pid = process.pid, execPath = process.execPath } = {}) {
    if (this.reason) throw new Error(this.reason);
    if (this.state !== 'available') throw new Error(this.state === 'preparing' ? tr('v{version} のこの OS 向けのファイルはまだ準備中です。しばらくしてからもう一度試してください', { version: this.latestVersion }) : tr('新しい版はありません'));
    const { command, args } = installCommand({ platform: this.platform, pid, version: this.latestVersion, execPath, env: this.env });
    let out = 'ignore';
    if (this.logFile) {
      const fs = require('fs');
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      out = fs.openSync(this.logFile, 'w');
    }
    const env = { ...this.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = this.spawn(command, args, { detached: true, stdio: ['ignore', out, out], windowsHide: true, env });
    child.unref?.();
    if (typeof out === 'number') require('fs').closeSync(out);
    this.set({ state: 'installing', error: '' });
    return this.status();
  }
}

module.exports = { Updater, compareVersions, versionFromReleaseUrl, assetName, unsupportedReason, installCommand, macBundlePath, CHECK_INTERVAL_MS };
