// README の5言語と、インストーラの表示文（英語）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { installCommand } = require('../src/updater');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const README_FILES = ['README.md', 'README.ja.md', 'README.es.md', 'README.fr.md', 'README.zh-CN.md'];
const LANG_LINKS = ['README.md', 'README.ja.md', 'README.es.md', 'README.fr.md', 'README.zh-CN.md'];
const NOTE = ' (Japanese)';

// コードブロックの中の見出しやリンクは、本文の構成に数えない
function stripFences(md) {
  return String(md || '').replace(/```[\s\S]*?```/g, '');
}

function headingLevels(md) {
  return [...stripFences(md).matchAll(/^(#{1,6})[ \t]+\S/gm)].map((m) => m[1].length);
}

function links(md) {
  const body = stripFences(md);
  return [...body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]*)\]\(([^)\s]+)\)/g)].map((m) => ({
    image: m[1] !== undefined,
    text: m[1] !== undefined ? m[1] : m[3],
    target: m[2] || m[4],
    at: m.index,
    raw: m[0],
    body,
  }));
}

// ひらがな・カタカナ・漢字。空や ASCII は含めない
function hasJapanese(s) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(s || ''));
}

// 見出しの段とリンク先が同じなら true。空や、コードブロックにしか見出しがないものは false
function sameShape(a, b) {
  const ha = headingLevels(a);
  const hb = headingLevels(b);
  if (ha.length === 0 || hb.length === 0) return false;
  if (ha.join(',') !== hb.join(',')) return false;
  const la = links(a).map((x) => x.target);
  const lb = links(b).map((x) => x.target);
  if (la.length === 0 || la.length !== lb.length) return false;
  return la.every((t, i) => t === lb[i]);
}

function hasLangLinks(md) {
  const targets = new Set(links(md).map((x) => x.target));
  return LANG_LINKS.every((t) => targets.has(t));
}

// docs/*.md へのリンクの直後に (Japanese) があるか。画像や # 付きの URL は対象外
function docNoteProblems(md, wantNote) {
  const found = links(md).filter((x) => !x.image && /^docs\/[^)\s]+\.md$/.test(x.target));
  return found.filter((x) => x.body.slice(x.at + x.raw.length).startsWith(NOTE) !== wantNote).map((x) => x.target);
}

// 更新スクリプトが、インストーラの表示文ではなく終了コードで成否を見ているか
function trustsExitStatus(script, platform) {
  if (!script || !String(script).trim()) return false;
  if (/grep|Select-String|インストールしました|Installed:/.test(script)) return false;
  if (platform === 'win32') {
    return /Invoke-RestMethod[\s\S]*install\.ps1[\s\S]*Invoke-Expression/.test(script) && /catch\s*\{/.test(script);
  }
  return /if curl -fsSL [\s\S]*install\.sh[\s\S]*\|[\s\S]*bash; then/.test(script) && /\nelse\n/.test(script);
}

const sample = [
  '[English](README.md)',
  '',
  '# Title',
  '',
  'See [usage](docs/usage.md) (Japanese).',
  '',
  '![board](docs/board.png)',
  '',
  '```',
  '# not a heading',
  '[hidden](docs/secret.md)',
  '```',
  '',
  '## Next',
].join('\n');

test('見出しはコードブロックの外だけを数える', () => {
  assert.deepEqual(headingLevels(sample), [1, 2]);
  assert.deepEqual(headingLevels('```\n# hidden\n```\n'), []);
  assert.deepEqual(headingLevels('#NoSpace\n# \n'), []);
  assert.deepEqual(headingLevels(''), []);
});

test('リンク先は画像も含め、コードブロックの中は無視する', () => {
  const found = links(sample);
  assert.deepEqual(found.map((x) => x.target), ['README.md', 'docs/usage.md', 'docs/board.png']);
  assert.deepEqual(found.map((x) => x.image), [false, false, true]);
  assert.equal(links('```\n[hidden](docs/secret.md)\n```').length, 0);
  assert.equal(links('').length, 0);
});

test('構成が同じなら一致し、見出しやリンク先がずれると一致しない', () => {
  assert.equal(sameShape(sample, sample), true);
  assert.equal(sameShape(sample, `${sample}\n### Extra`), false);
  assert.equal(sameShape(sample, sample.replace('docs/usage.md', 'docs/other.md')), false);
  assert.equal(sameShape(sample, sample.replace('docs/board.png', 'docs/board.png#top')), false);
  assert.equal(sameShape('', sample), false);
  assert.equal(sameShape('```\n# only inside\n```', sample), false);
  assert.equal(sameShape('# Title\n', '# Title\n'), false);
});

test('言語リンクが揃っているかを判定する', () => {
  const line = LANG_LINKS.map((f) => `[${f}](${f})`).join(' · ');
  assert.equal(hasLangLinks(`${line}\n\n# Title\n`), true);
  assert.equal(hasLangLinks(line.replace('[README.fr.md](README.fr.md)', 'Français')), false);
  assert.equal(hasLangLinks(''), false);
  assert.equal(hasLangLinks('```\n[README.md](README.md)\n```'), false);
});

test('docs へのリンク注記は、付けたいときと付けないときを区別する', () => {
  assert.deepEqual(docNoteProblems(sample, true), []);
  assert.deepEqual(docNoteProblems(sample, false), ['docs/usage.md']);
  const bare = sample.replace(' (Japanese)', '');
  assert.deepEqual(docNoteProblems(bare, true), ['docs/usage.md']);
  assert.deepEqual(docNoteProblems(bare, false), []);
  // 画像と、.md で終わらない URL は注記の対象にしない
  assert.deepEqual(docNoteProblems('[x](docs/usage.md#top)\n![a](docs/board.png)\n', true), []);
  assert.deepEqual(docNoteProblems('', true), []);
});

test('日本語の文字判定は空と ASCII を外し、かなと漢字を拾う', () => {
  assert.equal(hasJapanese(''), false);
  assert.equal(hasJapanese('Warning: curl is required'), false);
  assert.equal(hasJapanese('Agent Kanban'), false);
  assert.equal(hasJapanese('警告'), true);
  assert.equal(hasJapanese('ひらがな'), true);
  assert.equal(hasJapanese('カタカナ'), true);
  assert.equal(hasJapanese('Error: 失敗'), true);
});

test('更新スクリプトは終了コードを見て、表示文は見ない', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const env = platform === 'linux' ? { APPIMAGE: '/a.AppImage' } : {};
    const { args } = installCommand({ platform, pid: 7, version: '0.1.9', execPath: '/Applications/Agent Kanban.app/Contents/MacOS/Agent Kanban', env });
    const script = args[args.length - 1];
    assert.equal(trustsExitStatus(script, platform), true, platform);
  }
  const good = "if curl -fsSL 'https://example/install.sh' | AGENT_KANBAN_VERSION='0.1.9' bash; then\n  echo ok\nelse\n  echo ng\nfi\n";
  assert.equal(trustsExitStatus(good, 'darwin'), true);
  assert.equal(trustsExitStatus(`${good}grep Installed:`, 'darwin'), false);
  assert.equal(trustsExitStatus("try { Invoke-RestMethod 'https://example/install.ps1' | Invoke-Expression } catch { }", 'win32'), true);
  assert.equal(trustsExitStatus("try { Invoke-RestMethod 'https://example/install.ps1' | Invoke-Expression }", 'win32'), false);
  assert.equal(trustsExitStatus('', 'darwin'), false);
  assert.equal(trustsExitStatus('   ', 'win32'), false);
  assert.equal(trustsExitStatus('if true; then\nelse\nfi', 'darwin'), false);
});

test('5つの README は見出しとリンク先が一致し、言語リンクがある', () => {
  const texts = README_FILES.map(read);
  for (const file of README_FILES) assert.equal(hasLangLinks(read(file)), true, file);
  for (let i = 1; i < texts.length; i++) {
    assert.equal(sameShape(texts[0], texts[i]), true, README_FILES[i]);
  }
  assert.deepEqual(headingLevels(texts[0]), [1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2]);
});

test('英語・西・仏の README は本文が翻訳され、docs には (Japanese) が付く', () => {
  for (const file of ['README.md', 'README.es.md', 'README.fr.md']) {
    const body = read(file).replace(/^\[[^\n]*\n+/, '');
    assert.equal(hasJapanese(body), false, file);
    assert.deepEqual(docNoteProblems(read(file), true), [], file);
  }
  const ja = read('README.ja.md');
  assert.equal(hasJapanese(ja), true);
  assert.deepEqual(docNoteProblems(ja, false), []);
  assert.ok(docNoteProblems(ja, true).length > 0);
  const zh = read('README.zh-CN.md').replace(/^\[[^\n]*\n+/, '');
  assert.equal(hasJapanese(zh), true);
  assert.deepEqual(docNoteProblems(read('README.zh-CN.md'), true), []);
});

test('画像の alt は空でなく、言語ごとに別の文になっている', () => {
  const alts = README_FILES.map((file) => links(read(file)).filter((x) => x.image).map((x) => x.text));
  assert.ok(alts[0].length >= 10);
  for (const list of alts) {
    assert.equal(list.length, alts[0].length);
    for (const alt of list) assert.ok(alt.trim(), 'empty alt');
  }
  for (let i = 0; i < alts[0].length; i++) {
    const set = new Set(alts.map((list) => list[i]));
    assert.equal(set.size, README_FILES.length, alts[0][i]);
  }
  assert.equal(hasJapanese(alts[1].join('\n')), true);
  assert.equal(hasJapanese(alts[0].join('\n')), false);
  assert.equal(hasJapanese(''), false);
});

test('package.json の description は英語', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(typeof pkg.description, 'string');
  assert.ok(pkg.description.length > 20);
  assert.equal(hasJapanese(pkg.description), false);
  assert.match(pkg.description, /worktree/);
  assert.match(pkg.description, /kanban/i);
  assert.equal(hasJapanese('AI コーディングエージェントのデスクトップアプリ'), true);
});

test('install.sh は bash の文法として正しく、表示文は英語', () => {
  const r = spawnSync('bash', ['-n', path.join(root, 'install.sh')]);
  assert.equal(r.status, 0, String(r.stderr));
  const sh = read('install.sh');
  assert.equal(hasJapanese(sh), false);
  assert.match(sh, /Warning:/);
  assert.match(sh, /Error:/);
  assert.match(sh, /curl is required/);
  assert.match(sh, /Installed:/);
  assert.match(sh, /die\(\) \{[^}]*exit 1/);
  assert.match(sh, /set -euo pipefail/);
  assert.match(sh, /--uninstall/);
});

test('install.ps1 の表示文は英語で、失敗は Stop のまま上がる', () => {
  const ps1 = read('install.ps1');
  assert.equal(hasJapanese(ps1), false);
  assert.match(ps1, /Warning:/);
  assert.match(ps1, /Installed:/);
  assert.match(ps1, /Downloading:/);
  assert.match(ps1, /\$ErrorActionPreference = 'Stop'/);
  assert.match(ps1, /AGENT_KANBAN_UNINSTALL/);
  assert.match(ps1, /AGENT_KANBAN_NO_LAUNCH/);
  assert.doesNotMatch(ps1, /警告|エラー|インストールしました/);
});

test('updater はインストーラの表示文を参照していない', () => {
  const updater = read('src/updater.js');
  for (const phrase of ['curl is required', 'Board data', 'Installed:', 'Warning:', 'Downloading:', 'インストールしました', '警告:']) {
    assert.equal(updater.includes(phrase), false, phrase);
  }
  // 入れ替えスクリプト自身の文言は残ってよい。インストーラの出力を照合してはいない
  assert.match(updater, /エラー: 更新できませんでした/);
  assert.match(updater, /if curl -fsSL/);
  assert.match(updater, /catch \{/);
});

const pwshProbe = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']);
const pwshSkip = pwshProbe.error || pwshProbe.status !== 0 ? 'pwsh がない' : false;

test('pwsh があれば install.ps1 の構文を解析できる', { skip: pwshSkip }, () => {
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', '$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path "install.ps1"), [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { Write-Error $_.ToString() }; exit 1 }'], { cwd: root });
  assert.equal(r.status, 0, String(r.stderr || r.stdout));
});
