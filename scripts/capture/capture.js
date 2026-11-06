// README 用の画面と、デモ GIF・機能ごとの GIF を言語ごとに撮る（使い方は README.md）
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright-core');
const { buildFixtures, HOST_IP } = require('./fixtures');
const scenesFor = require('./scenes');
const demo = require('./demo');
const { features: gifFeatures, FEATURE_SIZE } = require('./features');

const ROOT = path.join(__dirname, '..', '..');
const LANGS = ['en', 'ja', 'es', 'fr', 'zh'];
const SIZE = { width: 1680, height: 960 };
const VERSION = '0.1.84';
const args = process.argv.slice(2);
const opt = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3).split(',') : null;
};
const langs = opt('lang') || LANGS;
const only = opt('only');
const noGif = args.includes('--no-gif');
const onlyGif = args.includes('--gif-only');
const feats = opt('feature');

// preload.js にあるチャンネルをすべて差し替える（エージェントや外部サービスを動かさないため）
function channels() {
  const src = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  return [...new Set([...src.matchAll(/call\('([a-zA-Z:]+)'/g)].map((m) => m[1]))];
}

function electronBin() {
  const dist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  if (process.platform === 'darwin') return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  return path.join(dist, process.platform === 'win32' ? 'electron.exe' : 'electron');
}

async function setMock(app, patch) {
  await app.evaluate((_e, p) => Object.assign(global.__mock, p), patch);
}

async function launch(lang) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wk-capture-${lang}-`));
  fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify({ settings: { language: lang }, cards: [] }));
  const app = await electron.launch({
    executablePath: electronBin(),
    args: [ROOT, `--user-data-dir=${dir}`, '--force-device-scale-factor=1'],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 60000,
  });
  const page = await app.firstWindow({ timeout: 60000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.api && typeof state !== 'undefined' && state.board);
  const realSettings = await page.evaluate(() => api.getBoard().then((b) => b.settings));

  await app.evaluate(({ ipcMain, BrowserWindow }, list) => {
    global.__mock = {};
    for (const ch of list) {
      ipcMain.removeHandler(ch);
      ipcMain.handle(ch, async (_e, arg) => {
        const wait = global.__mock.__delay && global.__mock.__delay[ch];
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const v = global.__mock[ch];
        const byId = v && typeof v === 'object' && v.__byId;
        return { ok: true, data: (byId ? v[arg] : v) ?? null };
      });
    }
    const w = BrowserWindow.getAllWindows()[0];
    w.showInactive?.();
  }, channels());
  await page.setViewportSize(SIZE);

  const tr = (() => {
    const I18n = require(path.join(ROOT, 'renderer', 'i18n'));
    I18n.setLanguage(lang);
    return I18n.tr;
  })();
  const fx = buildFixtures(lang, tr);
  const base = { settings: { ...realSettings, language: lang, repoPath: fx.paths.SHOP, maxParallel: 8, recentRepoPaths: [fx.paths.SHOP, fx.paths.ADMIN, fx.paths.API, fx.paths.MOBILE] } };

  await setMock(app, {
    'app:info': { version: VERSION, packaged: true },
    'update:status': { currentVersion: VERSION, platform: 'darwin', supported: false, reason: '', state: 'idle', latestVersion: '', error: '', checkedAt: 0, releaseUrl: '', auto: false },
    'env:check': { git: true, claude: true, agents: { claude: true }, platform: 'darwin' },
    'skills:list': fx.skills,
    'sessions:list': fx.sessions,
    'repo:info': fx.repoInfo,
    'repo:github': { slug: { owner: 'acme', repo: 'shop-app' } },
    'gh:status': { installed: true, loggedIn: true, user: 'octocat', hasProjectScope: true },
    'wsl:distros': [],
    'remote:keyStatus': fx.keyStatus,
    'remote:status': fx.remote(),
    'remote:hostInfo': { platform: 'darwin', tailscaleIps: [HOST_IP], lanIps: [], user: 'dev', sshServer: true, sshPort: 22 },
    'card:logs': { __byId: true, ...fx.logs },
    'card:diff': { __byId: true, enter: fx.diff },
    'card:worktree': { __byId: true, enter: fx.worktree },
    'board:get': { ...base, cards: [], repoTabs: [], notifications: [], remoteSession: fx.remote() },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload();
  await page.waitForFunction(() => window.api && typeof state !== 'undefined' && state.board);
  if (errors.length) throw new Error(`画面のエラー: ${errors.join(' / ')}`);

  const ctx = {
    app, page, fx, tr, base, lang,
    async show(board) {
      await setMock(app, { 'board:get': { ...base, repoTabs: fx.tabs(fx.paths.SHOP), notifications: fx.notifications, remoteSession: fx.remote(), ...board, settings: { ...base.settings, ...(board.settings || {}) } } });
      await page.evaluate(async () => {
        state.board = await api.getBoard();
        renderBoard();
        if (state.selected) renderDetailHead();
      });
    },
    async reset() {
      await page.evaluate(() => {
        setView('kanban');
        closeModal();
        $('skillPicker').classList.add('hidden');
        $('notifPanel').classList.add('hidden');
        closeDetail();
        setTab('chat');
        state.logs.clear();
        localStorage.clear();
      });
    },
    async settle(ms = 250) {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForTimeout(ms);
    },
    mock: (p) => setMock(app, p),
    async check(name) {
      assertClean(lang, name, await page.evaluate(screenText));
    },
  };
  return { ctx, dir };
}

const screenText = () => document.body.innerText + [...document.querySelectorAll('input,textarea')].map((e) => e.value).join(' ');
// 設定の言語の一覧は、どの言語でもそれぞれの言葉で出る
const LANGUAGE_NAMES = new Set(['日本語', '简体中文']);
const warned = new Set();
const warnOnce = (msg) => {
  if (!warned.has(msg)) console.warn(msg);
  warned.add(msg);
};

function assertClean(lang, name, text) {
  const bad = ['kazuya', 'Agent Kanban', 'gmail.com', 'Mac-mini'].filter((x) => text.includes(x));
  if (bad.length) warnOnce(`  ! ${lang}/${name}: ${bad.join(', ')}`);
  // 訳されていない日本語が画面に残っていないか
  if (lang !== 'ja') {
    const re = lang === 'zh' ? /[\u3040-\u30ff]/ : /[\u3040-\u30ff\u4e00-\u9fff]/;
    for (const line of text.split('\n')) if (re.test(line) && !LANGUAGE_NAMES.has(line.trim())) warnOnce(`  ! ${lang}/${name}: ${line.trim().slice(0, 100)}`);
  }
}

async function main() {
  for (const lang of langs) {
    const out = path.join(ROOT, 'docs', 'images', lang);
    fs.mkdirSync(out, { recursive: true });
    console.log(`== ${lang}`);
    const { ctx, dir } = await launch(lang);
    try {
      if (!onlyGif && !feats) {
        const scenes = scenesFor(ctx);
        for (const [name, run] of Object.entries(scenes)) {
          if (only && !only.includes(name)) continue;
          await ctx.reset();
          await run();
          await ctx.settle();
          await ctx.check(name);
          await ctx.page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled', caret: 'hide' });
          console.log(`  ${name}`);
        }
      }
      if (!noGif && !only && !feats) await demo(ctx, path.join(out, 'demo.gif'));
      if (!noGif && !only) {
        const list = gifFeatures(ctx);
        await ctx.page.setViewportSize(FEATURE_SIZE);
        for (const [name, run] of Object.entries(list)) {
          if (feats && !feats.includes(name)) continue;
          await ctx.reset();
          await run(path.join(out, `feature-${name}.gif`));
        }
        await ctx.page.setViewportSize(SIZE);
      }
    } finally {
      await ctx.app.close().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
