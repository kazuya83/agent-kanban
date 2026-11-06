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
const NOTE = ' (English)';

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

// 冒頭の太字と、承認の行。本文の別の場所に同じ単語があっても、ここだけを見る。コードブロックは捨てる
function claimTexts(md) {
  const body = stripFences(md);
  const bold = (body.match(/\*\*([^*]+)\*\*/) || [])[1] || '';
  const approval = body.split('\n').find((line) => line.includes('--permission-prompt-tool')) || '';
  return { bold, approval, body };
}

function isMeaningSpec(spec) {
  if (!spec) return false;
  return [spec.intro, spec.introBad, spec.approval, spec.approvalBad, spec.update, spec.updateBad].every((r) => r && typeof r.test === 'function');
}

// 3つの事実が欠けている名前。ok に合わない、または bad（取り違え）に合う
function meaningProblems(md, spec) {
  if (!isMeaningSpec(spec)) return ['intro', 'approval', 'update'];
  const { bold, approval, body } = claimTexts(md);
  const problems = [];
  const miss = (text, ok, bad) => !ok.test(text) || bad.test(text);
  if (miss(bold, spec.intro, spec.introBad)) problems.push('intro');
  if (miss(approval, spec.approval, spec.approvalBad)) problems.push('approval');
  if (miss(body, spec.update, spec.updateBad)) problems.push('update');
  return problems;
}

// 日本語の「動かせます」はタスクを実行する意味。移す・自動では許可しない・新しい版のときだけ、は取り違え
const MEANING = {
  'README.md': {
    intro: /run tasks from more than one repository/,
    introBad: /\bmove tasks\b/,
    approval: /does not auto-allow show up on the card/,
    approvalBad: /does not auto-allow only show/,
    update: /Update automatically when a new version is out/,
    updateBad: /Update only when a new version is out/,
  },
  'README.ja.md': {
    intro: /複数のリポジトリのタスクも同時に動かせます/,
    introBad: /複数のリポジトリのタスクも同時に移せます/,
    approval: /自動で許可されない操作だけが、カードに「承認待ち」として出ます/,
    approvalBad: /自動で許可されない操作だけが、カードに出ません/,
    update: /新しい版が出たら自動で更新する/,
    updateBad: /新しい版のときだけ更新する/,
  },
  'README.es.md': {
    intro: /ejecut(?:a|ar)\b[\s\S]*varios repositorios/,
    introBad: /\b(?:mueve|mover|mueven)\b/,
    approval: /no autoriza automáticamente aparecen en la tarjeta/,
    approvalBad: /no autoriza solo/,
    update: /Actualizar automáticamente cuando salga una versión nueva/,
    updateBad: /Actualizar solo cuando salga una versión nueva/,
  },
  'README.fr.md': {
    intro: /faire avancer en même temps des tâches de plusieurs dépôts/,
    introBad: /déplacer|déplace/,
    approval: /n'autorise pas tout seul apparaissent sur la carte/,
    approvalBad: /n'autorise pas seul apparaissent/,
    update: /Mettre à jour automatiquement quand une nouvelle version sort/,
    updateBad: /Mettre à jour seulement quand une nouvelle version/,
  },
  'README.zh-CN.md': {
    intro: /多个仓库的任务也可以同时进行/,
    introBad: /多个仓库的任务也可以同时移动/,
    approval: /不会自动允许的操作，才会在卡片上显示为等待批准/,
    approvalBad: /不会自动允许的操作不会显示/,
    update: /有新版本时自动更新/,
    updateBad: /只在有新版本时更新/,
  },
};

// 見出しの段とリンク先が同じなら true。空や、コードブロックにしか見出しがないものは false
function sameShape(a, b) {
  const ha = headingLevels(a);
  const hb = headingLevels(b);
  if (ha.length === 0 || hb.length === 0) return false;
  if (ha.join(',') !== hb.join(',')) return false;
  // 画像は言語ごとのフォルダ、日本語の文書は .ja.md にあるので、言語の部分は比べない
  const target = (x) => x.target.replace(/^docs\/images\/[a-z]+\//, 'docs/images/').replace(/^(docs\/[^/]+)\.ja\.md$/, '$1.md').replace(/\.ja\.html$/, '.html');
  const la = links(a).map(target);
  const lb = links(b).map(target);
  if (la.length === 0 || la.length !== lb.length) return false;
  return la.every((t, i) => t === lb[i]);
}

function hasLangLinks(md) {
  const targets = new Set(links(md).map((x) => x.target));
  return LANG_LINKS.every((t) => targets.has(t));
}

// docs/*.md へのリンクの直後に (English) があるか。画像や # 付きの URL は対象外
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
  'See [usage](docs/usage.md) (English).',
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
  const bare = sample.replace(' (English)', '');
  assert.deepEqual(docNoteProblems(bare, true), ['docs/usage.md']);
  assert.deepEqual(docNoteProblems(bare, false), []);
  // 画像と、.md で終わらない URL は注記の対象にしない
  assert.deepEqual(docNoteProblems('[x](docs/usage.md#top)\n![a](docs/board.png)\n', true), []);
  assert.deepEqual(docNoteProblems('', true), []);
});

test('日本語の文字判定は空と ASCII を外し、かなと漢字を拾う', () => {
  assert.equal(hasJapanese(''), false);
  assert.equal(hasJapanese('Warning: curl is required'), false);
  assert.equal(hasJapanese('Worktree Kanban'), false);
  assert.equal(hasJapanese('警告'), true);
  assert.equal(hasJapanese('ひらがな'), true);
  assert.equal(hasJapanese('カタカナ'), true);
  assert.equal(hasJapanese('Error: 失敗'), true);
});

test('事実の抜き出しは最初の太字と承認の行だけで、コードブロックは捨てる', () => {
  const md = ['```', '**hidden**', '--permission-prompt-tool hidden', '```', '', '**visible**', 'line --permission-prompt-tool yes'].join('\n');
  const found = claimTexts(md);
  assert.equal(found.bold, 'visible');
  assert.equal(found.approval, 'line --permission-prompt-tool yes');
  assert.equal(found.body.includes('hidden'), false);
  assert.deepEqual(claimTexts(''), { bold: '', approval: '', body: '' });
  assert.deepEqual(claimTexts('no bold\n'), { bold: '', approval: '', body: 'no bold\n' });
  assert.deepEqual(claimTexts(null), { bold: '', approval: '', body: '' });
  assert.deepEqual(claimTexts(undefined), { bold: '', approval: '', body: '' });
  assert.equal(claimTexts('**unclosed').bold, '');
});

const esIntroOk = 'No solo ejecuta tareas dentro de un repositorio: también puede ejecutar a la vez tareas de varios repositorios.';
const esIntroBad = 'No solo mueve tareas dentro de un repositorio: también puede mover a la vez tareas de varios repositorios.';
const esApprovalOk = 'Solo las acciones que el modo de permisos o `--allowedTools` no autoriza automáticamente aparecen en la tarjeta como espera de aprobación';
const esApprovalBad = 'Solo las acciones que el modo de permisos o `--allowedTools` no autoriza solo aparecen en la tarjeta como espera de aprobación';
const esUpdateOk = 'Actualizar automáticamente cuando salga una versión nueva';
const esUpdateBad = 'Actualizar solo cuando salga una versión nueva';

function esClaim(intro, approval, update) {
  return [
    '# Título',
    '',
    `Aplicación. **${intro}**`,
    '',
    `- **La aprobación pasa por \`--permission-prompt-tool\` de Claude Code.** ${approval}`,
    '',
    `Si marcas «${update}», se sustituye.`,
  ].join('\n');
}

test('スペイン語の3つの事実は、実行・自動では許可しない・自動更新だけを通し、取り違えは落とす', () => {
  const es = MEANING['README.es.md'];
  const good = esClaim(esIntroOk, esApprovalOk, esUpdateOk);
  assert.deepEqual(meaningProblems(good, es), []);
  assert.deepEqual(meaningProblems(esClaim(esIntroBad, esApprovalOk, esUpdateOk), es), ['intro']);
  assert.deepEqual(meaningProblems(esClaim(esIntroOk, esApprovalBad, esUpdateOk), es), ['approval']);
  assert.deepEqual(meaningProblems(esClaim(esIntroOk, esApprovalOk, esUpdateBad), es), ['update']);
  assert.deepEqual(meaningProblems(esClaim(esIntroBad, esApprovalBad, esUpdateBad), es), ['intro', 'approval', 'update']);
  // 実行と移動が混ざる、副詞の位置がずれる、承認の文がつながらない
  const mixed = 'No solo ejecuta tareas dentro de un repositorio: también puede mover a la vez tareas de varios repositorios.';
  assert.deepEqual(meaningProblems(esClaim(mixed, esApprovalOk, esUpdateOk), es), ['intro']);
  assert.deepEqual(meaningProblems(esClaim('puede ejecutar una tarea', esApprovalOk, esUpdateOk), es), ['intro']);
  assert.deepEqual(meaningProblems(esClaim(esIntroOk, 'no autoriza automáticamente', esUpdateOk), es), ['approval']);
  assert.deepEqual(meaningProblems(esClaim(esIntroOk, `${esApprovalOk} no autoriza solo`, esUpdateOk), es), ['approval']);
  assert.deepEqual(meaningProblems(esClaim(esIntroOk, esApprovalOk, 'Actualizar automáticamente solo cuando salga una versión nueva'), es), ['update']);
  assert.deepEqual(meaningProblems(`${good}\n${esUpdateBad}`, es), ['update']);
  // 太字と承認の行以外、またはコードブロックの中だけでは事実にならない
  assert.deepEqual(meaningProblems(`${good}\nPuedes mover el archivo.\nEsta nota no autoriza solo el ejemplo.`, es), []);
  assert.deepEqual(meaningProblems(['```', good, '```'].join('\n'), es), ['intro', 'approval', 'update']);
  const noFlag = ['# Título', '', `**${esIntroOk}**`, '', esApprovalOk, '', esUpdateOk].join('\n');
  assert.deepEqual(meaningProblems(noFlag, es), ['approval']);
  for (const md of ['', '   ', null, undefined]) {
    assert.deepEqual(meaningProblems(md, es), ['intro', 'approval', 'update']);
  }
  assert.deepEqual(meaningProblems(good, null), ['intro', 'approval', 'update']);
  assert.deepEqual(meaningProblems(good, {}), ['intro', 'approval', 'update']);
  assert.deepEqual(meaningProblems(good, { intro: /ejecuta/ }), ['intro', 'approval', 'update']);
  assert.equal(isMeaningSpec(es), true);
  assert.equal(isMeaningSpec(null), false);
  assert.equal(isMeaningSpec({ intro: /a/, introBad: /b/ }), false);
});

test('更新スクリプトは終了コードを見て、表示文は見ない', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const env = platform === 'linux' ? { APPIMAGE: '/a.AppImage' } : {};
    const { args } = installCommand({ platform, pid: 7, version: '0.1.9', execPath: '/Applications/Worktree Kanban.app/Contents/MacOS/Worktree Kanban', env });
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
  assert.deepEqual(headingLevels(texts[0]), [1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2]);
});

test('冒頭の太字・承認・自動更新は、5言語で同じ事実を言う', () => {
  for (const file of README_FILES) {
    assert.deepEqual(meaningProblems(read(file), MEANING[file]), [], file);
  }
  assert.equal(MEANING['README.es.md'].introBad.test('puede mover a la vez tareas'), true);
  assert.equal(MEANING['README.md'].intro.test('run tasks from more than one repository'), true);
  assert.deepEqual(meaningProblems(read('README.md'), undefined), ['intro', 'approval', 'update']);
});

test('英語・西・仏の README は本文が翻訳され、docs の言語の案内が合っている', () => {
  for (const file of ['README.md', 'README.es.md', 'README.fr.md']) {
    const body = read(file).replace(/^.*\[English\]\(README\.md\).*$/m, '');
    assert.equal(hasJapanese(body), false, file);
    assert.doesNotMatch(body, /\(Japanese\)/, file);
  }
  assert.deepEqual(docNoteProblems(read('README.md'), false), []);
  for (const file of ['README.es.md', 'README.fr.md']) assert.deepEqual(docNoteProblems(read(file), true), [], file);
  const ja = read('README.ja.md');
  assert.equal(hasJapanese(ja), true);
  assert.deepEqual(docNoteProblems(ja, false), []);
  assert.ok(docNoteProblems(ja, true).length > 0);
  const jaDocs = links(ja).filter((x) => !x.image && /^docs\/[^)\s]+\.md$/.test(x.target));
  assert.ok(jaDocs.length > 0);
  for (const x of jaDocs) assert.match(x.target, /\.ja\.md$/);
  const zh = read('README.zh-CN.md').replace(/^.*\[English\]\(README\.md\).*$/m, '');
  assert.equal(hasJapanese(zh), true);
  assert.deepEqual(docNoteProblems(read('README.zh-CN.md'), true), []);
});

for (const name of ['agents', 'development', 'install', 'remote', 'settings', 'usage']) {
  test(`docs/${name}: 英語と日本語が対で、見出しの段が同じで、たがいにリンクしている`, () => {
    const en = read(`docs/${name}.md`);
    const ja = read(`docs/${name}.ja.md`);
    const langs = `[English](${name}.md) · [日本語](${name}.ja.md)`;
    assert.equal(en.split('\n')[0], langs);
    assert.equal(ja.split('\n')[0], langs);
    assert.ok(headingLevels(en).length > 0);
    assert.deepEqual(headingLevels(en), headingLevels(ja));
    // 言語リンクと、日本語の例を見せるコードの部分を除くと、英語版に日本語は残らない
    assert.equal(hasJapanese(en.split('\n').slice(1).join('\n').replace(/`[^`\n]*`/g, '')), false);
    assert.equal(hasJapanese(ja.split('\n').slice(1).join('\n')), true);
    assert.ok(en.endsWith('[← Back to README](../README.md)\n'));
    assert.ok(ja.endsWith('[← README に戻る](../README.ja.md)\n'));
    // 日本語版から文書へのリンクは、日本語版へ向ける
    assert.doesNotMatch(ja.split('\n').slice(1).join('\n'), /\]\((?:agents|development|install|remote|settings|usage)\.md[#)]/);
  });
}

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
