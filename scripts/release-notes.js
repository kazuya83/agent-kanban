#!/usr/bin/env node
// GitHub Release の説明（Markdown）を、前の版からのコミットでまとめる（release-local.sh / after-merge-build.sh から使う）
//   node scripts/release-notes.js --version 0.1.49 [--target <コミット>] [できたファイル...]
//
// - 前の版 = --version より小さい v から始まるタグのうち、いちばん新しいもの
// - コミットは、件名の前置き（README: / CI: など）と変わったファイルで「アプリの変更」「ドキュメント」「開発・ビルドまわり」に分ける
// - アプリの変更のうち、件名に「修正」「不具合」「されない」などがあるものは「不具合の修正」にする
// - できたファイルを渡すと、OS ごとのダウンロードの表を付ける
const { execFileSync } = require('child_process');
const path = require('path');
const { parse, APP_PATHS } = require('./next-version');

const DOC_PATHS = /^(?!\.claude\/)(.*\/)?(README[^/]*|[^/]*\.md|docs\/.*|screenshots?\/.*)$/i;
// 件名の前置きで決めるもの（ファイルより優先する）
const DOC_PREFIX = /^(README|docs?)\s*[:：]/i;
const DEV_PREFIX = /^(CI|build|release|test|scripts?)\s*[:：]/i;
// package.json だけがアプリの中身として変わったときは、ほかのファイルで決める（npm scripts を足しただけなど）
const PKG_FILES = /^(package\.json|package-lock\.json)$/;
const FIX_WORDS = /(修正|直る|不具合|バグ|されない|されず|できない|出ない|消えない|落ちる|エラー|\bfix(es|ed)?\b|\bbug\b)/i;

const SECTIONS = [
  ['feature', '✨ 新機能・改善'],
  ['fix', '🐛 不具合の修正'],
  ['docs', '📝 ドキュメント'],
  ['dev', '🔧 開発・ビルドまわり'],
];

// ファイル名から OS の説明を付ける（並び順もこの順）
const ASSETS = [
  [/mac-arm64\.dmg$/, 'macOS（Apple シリコン）'],
  [/mac-x64\.dmg$/, 'macOS（Intel）'],
  [/win-setup\.exe$/, 'Windows（インストーラー）'],
  [/win-portable\.exe$/, 'Windows（インストール不要）'],
  [/win-x64\.zip$/, 'Windows（zip）'],
  [/\.AppImage$/, 'Linux（AppImage）'],
];

/** 件名から「agent: 」などの前置きを取る */
function cleanSubject(s) {
  return String(s || '')
    .trim()
    .replace(/^agent:\s*/i, '')
    .trim();
}

/** @param {{ subject: string, files: string[] }} c */
function classify(c) {
  const files = c.files || [];
  if (DOC_PREFIX.test(c.subject)) return 'docs';
  if (DEV_PREFIX.test(c.subject)) return 'dev';
  const app = files.filter((f) => APP_PATHS.test(f));
  const pkgOnly = app.length && app.every((f) => PKG_FILES.test(f)) && files.length > app.length;
  if (app.length && !pkgOnly) {
    return FIX_WORDS.test(c.subject) ? 'fix' : 'feature';
  }
  if (files.length && files.every((f) => DOC_PATHS.test(f) || /\.(png|jpe?g|gif|webp)$/i.test(f))) return 'docs';
  return 'dev';
}

/**
 * @param {{ version: string, prevTag: string|null, repo: string|null,
 *           commits: { subject: string, files: string[] }[], assets?: string[] }} p
 */
function buildNotes({ version, prevTag, repo, commits, assets = [] }) {
  const groups = Object.fromEntries(SECTIONS.map(([k]) => [k, []]));
  const seen = new Set();
  // git log は新しい順なので、古い順に並べ直して読みやすくする
  for (const c of [...commits].reverse()) {
    const subject = cleanSubject(c.subject);
    if (!subject) continue;
    const key = classify({ ...c, subject });
    const text = key === 'fix' ? subject.replace(/^修正[:：]\s*/, '') : subject;
    if (seen.has(text)) continue;
    seen.add(text);
    groups[key].push(text);
  }

  const out = [];
  const total = SECTIONS.reduce((n, [k]) => n + groups[k].length, 0);
  out.push(prevTag ? `${prevTag} からの変更点です。` : 'はじめてのリリースです。');
  out.push('');
  if (!total) {
    out.push('- 細かな調整');
    out.push('');
  }
  for (const [k, title] of SECTIONS) {
    if (!groups[k].length) continue;
    out.push(`## ${title}`, '');
    for (const t of groups[k]) out.push(`- ${t}`);
    out.push('');
  }

  const names = assets.map((a) => path.basename(a));
  const rows = [];
  for (const [re, label] of ASSETS) {
    for (const n of names.filter((x) => re.test(x))) {
      const link = repo ? `[\`${n}\`](https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(n)})` : `\`${n}\``;
      rows.push(`| ${label} | ${link} |`);
    }
  }
  if (rows.length) {
    out.push('## 📦 ダウンロード', '', '| OS | ファイル |', '| --- | --- |', ...rows, '');
  }

  if (repo && prevTag) out.push(`**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...v${version}`);
  return `${out.join('\n').trim()}\n`;
}

/** origin の URL から owner/repo を取り出す */
function repoFromUrl(url) {
  const m = String(url || '').trim().match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/);
  return m ? m[1] : null;
}

/** 前の版のタグを決める（version より小さい中でいちばん新しいもの） */
function previousTag(tags, version) {
  const v = parse(version);
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const older = tags
    .map((t) => [t, parse(t)])
    .filter(([t, p]) => p && /^v/.test(t) && (!v || cmp(p, v) < 0))
    .sort((a, b) => cmp(a[1], b[1]));
  return older.length ? older[older.length - 1][0] : null;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const args = process.argv.slice(2);
  let version = null;
  let target = 'HEAD';
  const assets = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version') version = args[++i];
    else if (args[i] === '--target') target = args[++i];
    else assets.push(args[i]);
  }
  if (!version) {
    process.stderr.write('--version が必要です\n');
    process.exit(2);
  }
  version = version.replace(/^v/, '');

  const tags = git('tag', '-l', 'v*').split('\n').filter(Boolean);
  const prevTag = previousTag(tags, version);
  const range = prevTag ? [`${prevTag}..${target}`] : [target];
  const raw = git('log', '--no-merges', '--name-only', '--format=%x1e%s', ...range);
  const commits = raw
    .split('\x1e')
    .filter((b) => b.trim())
    .map((b) => {
      const [subject, ...files] = b.split('\n');
      return { subject, files: files.map((f) => f.trim()).filter(Boolean) };
    });
  let repo = null;
  try {
    repo = repoFromUrl(git('remote', 'get-url', 'origin'));
  } catch {
    repo = null;
  }
  process.stdout.write(buildNotes({ version, prevTag, repo, commits, assets }));
}

module.exports = { buildNotes, classify, cleanSubject, previousTag, repoFromUrl };
