// カード（タスク）ごとに worktree を作り、エージェントの CLI（Claude Code / Codex CLI / Gemini CLI / Cursor CLI）を並列に動かす
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const git = require('./git');
const wsl = require('./wsl');
const { resolveCommand, isWin } = require('./env');
const github = require('./github');
const ghCli = require('./gh');
const { withSkill } = require('./skills');
const providers = require('./providers');
const attachments = require('./attachments');
const { findSimilarTasks } = require('./similar');
const os = require('os');
const { agentLabel, agentShort } = providers;
const { isNoGitRepo, cleanRelayFlow, pipelineOf } = require('./store');
const FlowModel = require('../renderer/flow-model');
const Subtasks = require('./subtasks');
const Checkpoints = require('./checkpoints');
const { SCRIPT_KINDS, SCRIPT_SETTINGS, PORT_START, PORT_END, PORT_COUNT, portsFree, cleanScript, appendOutput, startScript } = require('./worktree-scripts');
const I18n = require('../renderer/i18n');
const { tr } = I18n;

// 内部の指示は日本語のまま。ja 以外のときだけ、返事の言語を先頭に足す（ログには出さない。ブランチ名の生成には使わない）
const REPLY_LANG_NAME = { en: 'English', es: 'español', fr: 'français', zh: '简体中文' };
function withReplyLanguage(prompt) {
  const text = String(prompt ?? '');
  if (!text || I18n.getLanguage() === 'ja') return text;
  if (text.startsWith('【返事の言語】')) return text;
  const name = REPLY_LANG_NAME[I18n.getLanguage()] || I18n.getLanguage();
  return `【返事の言語】ユーザーへの返事・質問・報告は${name}で書いてください。\n\n${text}`;
}

const MAX_LOGS = 2000;
const MCP_SERVER_NAME = 'agent_kanban';
const PERMISSION_TOOL = `mcp__${MCP_SERVER_NAME}__approve`;
const INTERRUPTED_MESSAGE = 'アプリの終了で中断されました。「再開」で中断したところから続けられます（追加指示を送っても再開できます）。';
function quitInterruptMessage() {
  return tr('アプリの終了で中断されました。「再開」で中断したところから続けられます（追加指示を送っても再開できます）。');
}
// 保存済みの文は、中断したときの言語のまま残っていることがある
function isQuitInterrupt(s) {
  if (s === INTERRUPTED_MESSAGE) return true;
  const prev = I18n.getLanguage();
  try {
    for (const { code } of I18n.LANGUAGES) {
      I18n.setLanguage(code);
      if (s === tr('アプリの終了で中断されました。「再開」で中断したところから続けられます（追加指示を送っても再開できます）。')) return true;
    }
    return false;
  } finally {
    I18n.setLanguage(prev);
  }
}
// 作業のあとに「スキルにしておくとよいもの」を提案してもらうときの指示
const SKILL_SUGGEST_PROMPT = [
  'ここまでの作業を振り返って、次から同じような作業をもっと速く・確実にできるように、スキル（SKILL.md）として残しておくとよさそうなものを提案してください。',
  '',
  '- 候補は1〜3個にしてください。それぞれ「スキル名」「何をするスキルか」「どんなときに使うか」「SKILL.md に書く手順の概要」を書いてください',
  '- すでにあるスキル（このリポジトリの .claude/skills/ と ~/.claude/skills/）を確かめて、重ならないようにしてください',
  '- 置き場所は、このリポジトリ用（.claude/skills/<名前>/SKILL.md）か、自分用（~/.claude/skills/<名前>/SKILL.md）のどちらがよいかも書いてください',
  '- まだファイルは作らないでください。最後に「どれを追加しますか？」と聞いてください',
].join('\n');
// 似たタスクが前にもあったときに足す指示
const SKILL_SUGGEST_REPEAT_NOTE = [
  '- 「似ている過去のタスク」と見比べて、何度も繰り返している作業（手順・確かめ方・決まりごと）を中心に提案してください',
  '- 見比べた結果、繰り返している作業が無ければ、無理に提案せず「スキルにするほどの繰り返しはありません」と答えてください',
].join('\n');
// スキルの提案を頼む会話の最初の指示。元のタスクの指示・やりとり・結果をまとめて渡す
// カードのやりとり（あなたの指示とエージェントの返事）を、新しいものから size 文字くらいまで抜き出す。
// skipPrompt: 最初の指示（別に渡すとき）は入れない
function talkExcerpt(c, { size: max = 6000, skipPrompt = true } = {}) {
  const talk = (c.logs || [])
    .filter((l) => (l.kind === 'user' && !(skipPrompt && l.text === c.prompt)) || l.kind === 'text')
    // Claude Code の発言のログには agent が付いていない（ほかのエージェントの発言には付いている）
    .map((l) => `${l.kind === 'user' ? '【ユーザー】' : `【${agentShort(l.agent || 'claude')}】`} ${truncate(String(l.text).trim(), 800)}`);
  let picked = [];
  let size = 0;
  for (let i = talk.length - 1; i >= 0 && size < max; i--) {
    picked.unshift(talk[i]);
    size += talk[i].length;
  }
  if (picked.length < talk.length) picked = ['（前のやりとりは省略）', ...picked];
  return picked;
}
function buildSkillSuggestPrompt(c, similar = []) {
  const lines = [`次のタスク「${c.title}」の作業を振り返ってください。`, ''];
  lines.push('## タスクの指示', truncate(c.prompt, 3000), '');
  const picked = talkExcerpt(c);
  if (picked.length) lines.push('## やりとり（抜粋）', ...picked, '');
  const info = [];
  if (c.issue) info.push(`- Issue: #${c.issue.number} ${c.issue.url || ''}`.trim());
  if (c.branch) info.push(`- ブランチ: ${c.branch}`);
  if ((c.mergedInto || []).length) info.push(`- 取り込み先: ${c.mergedInto.join(', ')}（git log で変更を確かめられます）`);
  if (c.prUrl) info.push(`- PR: ${c.prUrl}`);
  if (c.worktreePath && !isChat(c)) info.push(`- 作業フォルダ: ${c.worktreePath}`);
  if (info.length) lines.push('## 結果', ...info, '');
  if (similar.length) {
    lines.push('## 似ている過去のタスク（このタスクと似た作業を、前にもしています）');
    for (const s of similar) {
      const head = [`### ${s.title}`];
      if (s.branch) head.push(`- ブランチ: ${s.branch}`);
      if ((s.mergedInto || []).length) head.push(`- 取り込み先: ${s.mergedInto.join(', ')}`);
      lines.push(...head, truncate(String(s.prompt || '').trim(), 800), '');
    }
  }
  let ask = SKILL_SUGGEST_PROMPT.replace('ここまでの作業を振り返って', similar.length ? 'このタスクと似ている過去のタスクの作業をもとに' : 'このタスクの作業をもとに');
  if (similar.length) ask += `\n${SKILL_SUGGEST_REPEAT_NOTE}`;
  lines.push('---', '', ask);
  return lines.join('\n');
}
// 会話の続きとしてタスクを作るとき、会話そのものを引き継げない（エージェントが違う・Claude Code 以外）なら、
// 会話のやりとりを最初の指示に添えて渡す
function buildChatContext(chat) {
  const picked = talkExcerpt(chat, { size: 8000, skipPrompt: false });
  if (!picked.length) return '';
  // 完了したタスクから修正のタスクを作るときは、元のタスクのやりとり（完了後の会話も含む）を渡す
  const head = isChat(chat)
    ? `## これまでの会話「${chat.title}」（このタスクは、この会話の続きです）`
    : `## 完了したタスク「${chat.title}」のやりとり（このタスクは、完了したこのタスクの修正です）`;
  const info = [];
  if (!isChat(chat) && (chat.mergedInto || []).length) info.push(`- 取り込み先: ${chat.mergedInto.join(', ')}（git log で前の変更を確かめられます）`);
  if (!isChat(chat) && chat.prUrl) info.push(`- PR: ${chat.prUrl}`);
  return [head, '', ...picked, ...(info.length ? ['', ...info] : [])].join('\n');
}

// 完了したタスクについて話すときの注意（ファイルは変えず、修正は別のタスクにしてもらう）
const AFTER_DONE_NOTE = [
  '# 完了したタスクについての会話です',
  '',
  'このタスクはもう完了（マージ済み）です。ここではユーザーの質問に答えたり、調べものや相談に乗ったりしてください。',
  '',
  '- ファイルの変更・コミット・マージはしないでください（計画モードで動いています）',
  '- 修正や追加の作業が必要そうなときは、どう直すかの案を書いたうえで、「修正タスクを作る」ボタンから別のタスクにするようユーザーに伝えてください',
].join('\n');
// 完了したタスクで最初に話すときの指示。worktree はもうないので新しい会話で始め、元のタスクの中身を渡す
// CI の失敗を続けて自動で直す回数の上限（通ったら数え直す）
const CI_FIX_MAX_ATTEMPTS = 3;

function buildCiFixPrompt(c, ch) {
  return [
    `この PR（${c.prUrl}）の CI が失敗しました（コミット ${String(ch.sha).slice(0, 7)}）。`,
    '',
    '失敗したチェック:',
    ...ch.failed.map((x) => `- ${x.name}${x.url ? `: ${x.url}` : ''}`),
    '',
    '原因をログで確かめてから直してください。GitHub Actions のチェックは `gh run view <run id> --log-failed` でログを読めます（run id は URL の /runs/ のあとの数字です）。',
    'テストを消す・スキップする、CI の設定を緩めるといった方法で通すのはやめてください。コードで直せない原因（CI の環境や秘密の値など）なら、変更せずにその理由を書いてください。',
    '直したらテストを実行して確かめてください。コミットと push はアプリが行うので、しなくてかまいません。',
    '最後に、原因とどう直したかを短くまとめてください。',
  ].join('\n');
}

function buildAfterDonePrompt(c, message) {
  const lines = [AFTER_DONE_NOTE, '', `## 完了したタスク「${c.title}」`, '', '### タスクの指示', truncate(c.prompt, 3000), ''];
  const picked = talkExcerpt(c);
  if (picked.length) lines.push('### やりとり（抜粋）', ...picked, '');
  const info = [];
  if (c.issue) info.push(`- Issue: #${c.issue.number} ${c.issue.url || ''}`.trim());
  if (c.branch) info.push(`- ブランチ: ${c.branch}`);
  if ((c.mergedInto || []).length) info.push(`- 取り込み先: ${c.mergedInto.join(', ')}（git log で変更を確かめられます）`);
  if (c.prUrl) info.push(`- PR: ${c.prUrl}`);
  if (info.length) lines.push('### 結果', ...info, '');
  lines.push('---', '', '## ユーザーのメッセージ', '', message);
  return lines.join('\n');
}
function withChatContext(context, prompt) {
  return context ? `${context}\n\n---\n\n${prompt}` : prompt;
}

// 仕様が詰まっていないとエージェントが判断したときに、返事の1行目に付けてもらう印（アプリが見て「仕様の確認」にする。画面には出さない）
const SPEC_MARKER = '[[SPEC_UNCLEAR]]';
// 仕様の確認の質問を、回答フォーム（選択肢・自由入力）にするための JSON を入れてもらうコードブロックの言語名
const SPEC_QUESTIONS_LANG = 'spec-questions';
const SPEC_QUESTIONS_RE = new RegExp('\\n?[ \\t]*```[ \\t]*' + SPEC_QUESTIONS_LANG + '[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*```[ \\t]*', 'g');
// 新しいタスク・Issue から作ったタスクの最初の指示に付ける。内容が足りなければ、開発を始めずに質問してもらう
const SPEC_CHECK_PROMPT = [
  '# 開発を始める前に、タスクの内容が足りているかを確かめてください',
  '',
  'ファイルを変える前に、下の「タスク」（GitHub Issue のときはタイトル・本文・コメント）を読み、必要ならリポジトリのコードも読んで、開発を始められるくらい仕様が詰まっているかを判断してください。',
  '',
  '- 詰まっている（何を作る・直すのか、どうなれば完了かが分かり、残りは妥当な判断で決められる）ときは、そのまま開発を進めてください。細かいことは自分で妥当に決めてかまいません',
  '- 詰まっていない（目的・対象・期待する動きが分からない、やり方が大きく分かれて結果が変わる、など）ときは、ファイルを変えずに次の形で返事をして、そこで止まってください',
  `  1. 1行目に \`${SPEC_MARKER}\` とだけ書く（アプリがこの印で「仕様の確認中」にします。ユーザーには表示されません）`,
  '  2. 「内容が詰まっていないので、開発を開始できません。」と書き、何が足りないかを短く説明する',
  '  3. 決めてほしいことを番号付きの質問にする（1回に5つまで。答えやすいように選択肢やおすすめの案も添える）',
  '  4. 最後は質問（？）で終える',
  `  5. そのあと、返事のいちばん最後に、同じ質問を画面の回答フォーム（選択肢・自由入力）にするための JSON を \`\`\`${SPEC_QUESTIONS_LANG} のコードブロックで付ける（アプリが読み取ってフォームにします。ユーザーには表示されません）`,
  `     形: [{"question": "質問文", "header": "短い見出し（12文字まで）", "multiSelect": false, "options": [{"label": "選択肢", "description": "説明"}]}]`,
  '     選択肢は1問に2〜4つ。おすすめの案があれば先頭にして label の最後に「（おすすめ）」を付ける。自由に書いてもらうだけの質問は options を [] にする（フォームには、どの質問にも自由入力の欄が付きます）',
  '- AskUserQuestion ツールは使わず、文章で質問してください',
  `- ユーザーが答えたら、もう一度判断してください。まだ足りなければ、同じ形（1行目に \`${SPEC_MARKER}\`）で続きの質問をしてください`,
  '- 詰まったら、決まった仕様を「## 決まった仕様」として箇条書きでまとめてから、開発を始めてください（この返事には印を付けないでください）',
].join('\n');
const SPEC_FOLLOW_NOTE = `（仕様の確認の続きです。この答えで開発を始められるなら、決まった仕様をまとめてから開発を始めてください。まだ足りなければ、1行目に \`${SPEC_MARKER}\` を付けて続きの質問をしてください）`;
// ソースを変更しないタスク（SQL を作るだけ、調べものだけなど）の指示に添える説明
const READ_ONLY_NOTE = `## このタスクではソースコードを変更しません

- リポジトリのファイルを作ったり書き換えたり消したりしないでください（ファイルを書き換えるツールは使えないようにしています）。コードを読んだり、ファイルを変えないコマンドで調べたりするのはかまいません
- 作ったもの（SQL・文章・手順など）は、ファイルに保存せず、返事の中にコードブロックで書いてください（そのままコピーして使えるように）
- 終わったら、作ったものを返事の最後にまとめてください。コミット・マージ・PR はしません`;
function withReadOnlyNote(prompt) {
  return `${READ_ONLY_NOTE}\n\n---\n\n${prompt}`;
}
// ソースを変えないタスクで止めるツール（Claude Code の --disallowedTools）
const READ_ONLY_DISALLOWED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

function withSpecCheck(prompt) {
  return `${SPEC_CHECK_PROMPT}\n\n---\n\n## タスク\n\n${prompt}`;
}
// 印は返事の1行目にあるときだけ見る（本文で印に触れただけのときは数えない）
function hasSpecMarker(text) {
  return String(text || '').trimStart().startsWith(SPEC_MARKER);
}
function stripSpecMarker(text) {
  return hasSpecMarker(text) ? String(text).trimStart().slice(SPEC_MARKER.length).replace(/^[ \t]*\n?/, '') : String(text || '');
}
// 返事から質問フォーム用の JSON ブロックを取り出す。text はブロックを除いた本文、questions は読めなければ null
function extractSpecQuestions(text) {
  const src = String(text || '');
  let questions = null;
  const body = src.replace(SPEC_QUESTIONS_RE, (_, json) => {
    if (!questions) questions = parseSpecQuestions(json);
    return '';
  });
  return { text: body.replace(/\s+$/, ''), questions };
}
// JSON のブロックが付いていなかったときの代わり: 本文の番号付きの質問と、その下の箇条書きの選択肢からフォームを作る
//   1. **質問？**
//      - A（おすすめ）: 選択肢の説明
//      - B: …
// 選択肢が2つ以上あるか、質問（？で終わる）のものだけを拾う。読めなければ null
// 「その他」は自由入力なので選択肢にしない（各言語の表記）
function isOtherOption(s) {
  const core = String(s || '')
    .replace(/^[A-Za-z]\s*[:：.)）]\s*/, '') // 「C: その他」「A. Other」の記号だけ外す（Other の先頭は残す）
    .replace(/^[A-Za-z]\s+(?=\S)/, '')
    .replace(/^(?:（|\()([^)）]+)(?:）|\))\s*/, '$1 ')
    .replace(/^[:：.)）]\s*/, '')
    .trim();
  // 日本語・中国語は \b が効かないので、直後が文字でなければ「その他」とする（Otherwise などは残す）
  return /^(?:その他|ほか|其他|[Oo]ther|[Oo]tro|[Aa]utre)(?![\p{L}\p{N}_])/u.test(core);
}
function parseMarkdownQuestions(text) {
  const qs = [];
  let cur = null;
  const plain = (s) => s.replace(/\*\*|__|`/g, '').trim();
  for (const line of String(text || '').split(/\r?\n/)) {
    const num = line.match(/^ {0,3}(\d{1,2})[.)．]\s+(.+)$/);
    if (num) {
      cur = { question: plain(num[2]), options: [] };
      qs.push(cur);
      continue;
    }
    const opt = cur && line.match(/^\s*[-*・]\s+(.+)$/);
    if (opt) {
      let s = plain(opt[1]);
      if (isOtherOption(s)) continue; // 自由入力の欄はフォームに必ずある
      const m = s.match(/^([A-Za-z]|\d{1,2})\s*((?:（|\()(?:おすすめ|推荐|[Rr]ecommended|[Rr]ecomendado|[Rr]ecommandé)(?:）|\)))?\s*[:：.)）]\s*(.+)$/);
      const rec = /(?:おすすめ|推荐|[Rr]ecommended|[Rr]ecomendado|[Rr]ecommandé)/.test(m ? m[2] || '' : '') || /^(?:（|\()(?:おすすめ|推荐|[Rr]ecommended|[Rr]ecomendado|[Rr]ecommandé)(?:）|\))/.test(s);
      if (m) s = m[3];
      s = s.replace(/^(?:（|\()(?:おすすめ|推荐|[Rr]ecommended|[Rr]ecomendado|[Rr]ecommandé)(?:）|\))\s*[:：]?\s*/, '').trim();
      if (!s) continue;
      // 長い選択肢は、最初の文を見出しに、残りを説明にする
      let label = s;
      let description = '';
      const cut = s.search(/[。]/);
      if (s.length > 60 && cut > 0 && cut < s.length - 1) {
        label = s.slice(0, cut);
        description = s.slice(cut + 1).trim();
      }
      if (rec) label += tr('（おすすめ）');
      if (m) label = `${m[1]}: ${label}`; // 「A と同じ」のように記号で指すことがあるので残す
      cur.options.push({ label, description });
      continue;
    }
    // 番号のあとの地の文（字下げなし）が来たら、その質問の選択肢はそこまで
    if (cur && line.trim() && !/^\s/.test(line)) cur = null;
  }
  const picked = qs
    .filter((q) => q.question && (q.options.length >= 2 || /[？?]\s*$/.test(q.question)))
    .map((q) => ({ question: q.question, header: '', multiSelect: false, options: q.options.length >= 2 ? q.options : [] }));
  return parseSpecQuestions(JSON.stringify(picked));
}
function parseSpecQuestions(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (data && !Array.isArray(data) && Array.isArray(data.questions)) data = data.questions;
  if (!Array.isArray(data)) return null;
  const qs = data
    .filter((q) => q && typeof q === 'object' && typeof q.question === 'string' && q.question.trim())
    .slice(0, 5)
    .map((q) => ({
      question: truncate(q.question.trim(), 500),
      header: truncate(String(q.header || '').trim(), 24),
      multiSelect: !!q.multiSelect,
      options: (Array.isArray(q.options) ? q.options : [])
        .map((o) => (typeof o === 'string' ? { label: o } : o))
        .filter((o) => o && typeof o.label === 'string' && o.label.trim())
        .slice(0, 6)
        .map((o) => ({ label: truncate(o.label.trim(), 120), description: truncate(String(o.description || '').trim(), 300) })),
    }));
  return qs.length ? qs : null;
}
// 仕様の確認をしているあいだか（checking: 最初の判断の前 / pending: 足りないと言われて答えを待っている）
function inSpecCheck(c) {
  return !!c && (c.specState === 'checking' || c.specState === 'pending');
}
const RESUME_PROMPT ='前回の作業は、アプリの終了で途中で中断されました。worktree の今の状態（git status / git diff など）を確かめて、中断したところから作業を続けてください。';
const CHAT_RESUME_PROMPT = '前回の返事は、アプリの終了で途中で中断されました。中断したところから続けてください。';
const FOLDER_RESUME_PROMPT = '前回の作業は、アプリの終了で途中で中断されました。フォルダの今の状態を確かめて、中断したところから作業を続けてください。';

// タスクに紐づかない会話（チャット）か。worktree もブランチも作らず、リポジトリのフォルダでそのまま話す
function isChat(c) {
  return !!c && c.kind === 'chat';
}

// git で管理していないフォルダ（動画づくりなど）のタスクか。worktree・ブランチ・コミット・マージは使わず、フォルダの中でそのまま動かす
function isNoGit(c) {
  return !!c && !!c.noGit;
}

// 作業の場所がもうあるか（git なら worktree、git でないフォルダなら一度動かしたことがある）
function hasWorkplace(c) {
  return !!(c && (c.worktreePath || isChat(c) || (isNoGit(c) && c.startedAt)));
}

// Claude 以外で、実行中に送った btw を「終わったあとの追加指示」待ちにしているか
function hasFollowBtw(c) {
  return !!(c && c.btw && c.btw.some((m) => m.state === 'follow'));
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// Claude Code のセッション ID（UUID など）か。claude の --resume にそのまま渡すので、
// 「-」で始まる値（オプションとして解釈される）や記号を含む値は受け付けない
function isSessionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
}
function assertSessionId(id) {
  if (!isSessionId(id)) throw new Error(tr('会話（セッション）の ID が正しくありません'));
  return id;
}

// Windows で .cmd / .bat をシェル（cmd.exe）経由で起動するときの引数のクオート。
// cmd.exe では " の中でも % の展開が効き、\" ではクオートを抜けられてしまうので、そうした文字を含む引数は拒否する
function quoteForCmd(a) {
  const s = String(a);
  if (/["%!\r\n\0]/.test(s)) throw new Error(tr('この値はコマンドの引数に使えません: {truncate}', { truncate: truncate(s, 60) }));
  return /[\s&|<>^()]/.test(s) || !s ? `"${s}"` : s;
}

function slugify(s) {
  const slug = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return slug || 'task';
}

function summarizeInput(input) {
  if (!input || typeof input !== 'object') return '';
  if (Array.isArray(input.questions)) return truncate(input.questions.map((q) => q && q.question).filter(Boolean).join(' / '), 300);
  const v = input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description;
  return truncate(typeof v === 'string' ? v : JSON.stringify(input), 300);
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c && c.type !== 'image').map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  return '';
}

// ツールの結果に入っている画像（スクリーンショットなど）を、表示できる形で取り出す
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // base64 の長さで見る。これより大きい画像は保存しない
const MAX_IMAGES_PER_CARD = 30; // board.json が大きくなりすぎないよう、古い画像から消す
function toolResultImages(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const c of content) {
    if (!c || c.type !== 'image') continue;
    const src = c.source || {};
    const mediaType = String(src.media_type || '').toLowerCase();
    const data = typeof src.data === 'string' ? src.data.replace(/\s+/g, '') : '';
    if (src.type !== 'base64' || !IMAGE_TYPES.has(mediaType) || !data || !/^[A-Za-z0-9+/]+=*$/.test(data)) out.push({ omitted: tr('表示できない形式の画像です') });
    else if (data.length > MAX_IMAGE_BYTES) out.push({ omitted: tr('大きすぎるので保存しませんでした') });
    else out.push({ mediaType, data });
  }
  return out;
}

// カードのログに残す画像を MAX_IMAGES_PER_CARD 枚までにする（古いものは「消しました」に置きかえる）
function pruneImages(logs) {
  let kept = 0;
  for (let i = logs.length - 1; i >= 0; i--) {
    const ims = logs[i].images;
    if (!ims) continue;
    for (let j = ims.length - 1; j >= 0; j--) {
      if (!ims[j].data) continue;
      if (kept < MAX_IMAGES_PER_CARD) kept++;
      else ims[j] = { omitted: tr('古い画像なので消しました') };
    }
  }
}

function notFoundMessage(cmd, agent = 'claude') {
  const name = providers.AGENTS[agent] ? providers.AGENTS[agent].defaultCmd : 'claude';
  return tr('{name} コマンドが見つかりません（{cmd}）。{label} をインストールするか、設定で {name} のパスを指定してください。', { name, cmd, label: agentLabel(agent) });
}

// カードを動かすエージェント（古いカードは Claude Code）
function agentOf(c) {
  return (c && providers.isAgent(c.agent) && c.agent) || 'claude';
}

// タスク・会話を作るときに選んだモデル名を確かめる（空なら設定の既定を使う）。
// Windows ではシェル経由で CLI を動かすので、モデル名に使わない文字は受け付けない
function cleanModel(model) {
  const m = String(model || '').trim();
  if (!m) return '';
  if (m.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]*$/.test(m)) throw new Error(tr('モデル名に使えない文字が入っています: {m}', { m }));
  return m;
}

// カードを動かすモデル（カードで選んでいなければ、設定のエージェントごとの既定）
function modelOf(c, settings) {
  return (c && c.model) || providers.agentModel(settings, agentOf(c));
}

// 指示にスキルを付ける。Claude Code は「/スキル名」で呼べるが、ほかのエージェントには SKILL.md の場所を伝えて手順に従ってもらう
function promptWithSkill(agent, skill, prompt) {
  if (agent === 'claude' || !skill) return withSkill(skill, prompt);
  const name = String(skill).replace(/^\//, '').split(':').pop();
  return `（スキル「${skill}」の手順に従ってください。手順は .claude/skills/${name}/SKILL.md か ~/.claude/skills/${name}/SKILL.md に書かれています）\n\n${prompt}`;
}

// ---------- Pipeline（フローチャートの工程ごとに、別のエージェントへ引き継ぐ） ----------
// c.relay = {
//   flow,      設定のフローチャート（タスクを作ったときのもの）
//   steps,     工程のノード（{ id, agent, label, instruction }。番号「工程N」の順）
//   index,     今の工程（steps の番号）
//   history,   終わった工程の記録（{ index, run, agent, report, result?, branch?, ... }）
//   counts,    ループ（前のノードへ戻る線）を通った回数（線の ID ごと）
//   waiting?,  並列の枝が終わるのを待っている: { node, join, children, merged }
//   branchOf?, 並列の枝のタスク: { parent, node, join, index, label, histStart }
//   atJoin?,   枝のタスクが合流まで来た
// }

// 担当の呼び名（カスタムエージェントなら「名前（CLI）」）
function whoLabel(agent, persona) {
  return persona && persona.name ? `${persona.name}（${agentLabel(agent)}）` : agentLabel(agent);
}
function whoShort(agent, persona) {
  return persona && persona.name ? persona.name : agentShort(agent);
}

// 工程のノードを、カードに持たせる形にする
// カスタムエージェントを選んだ工程は、そのエージェントの CLI・モデル・プロフィールを写す（customAgents にないときは missing を付ける）
function relayStepsOf(flow, customAgents = []) {
  return FlowModel.orderSteps(flow).map((n) => {
    const st = { id: n.id, agent: n.agent, label: n.label, instruction: n.instruction || '' };
    if (n.model) st.model = n.model;
    if (n.custom) {
      const ca = providers.findCustomAgent(customAgents, n.custom);
      if (ca) {
        st.agent = ca.agent;
        if (ca.model) st.model = ca.model;
        else delete st.model;
        st.persona = providers.personaOf(ca);
      } else st.missing = n.custom;
    }
    return st;
  });
}
function relayStepIndex(c, nodeId) {
  return c.relay.steps.findIndex((st) => st.id === nodeId);
}

// 前のバージョンのPipelineのカード（工程のリストと分岐の行き先）を、フローの形にする
function migrateRelayCard(c) {
  const r = c && c.relay;
  if (!r || r.flow || !Array.isArray(r.steps)) return;
  r.flow = FlowModel.flowFromSteps(providers.cleanRelaySteps(r.steps));
  r.steps = r.steps.map((st, i) => ({ id: `s${i + 1}`, agent: st.agent, label: st.label, instruction: st.instruction || '' }));
  r.counts = {};
  if (r.lastVerdict) r.lastResult = r.lastVerdict;
  delete r.lastVerdict;
  delete r.loops;
  for (const h of r.history || []) if (h.verdict && !h.result) h.result = h.verdict;
}

// 工程 i を何回目に実行するか（ループで戻ってきたら 2回目以降）
function relayRunNo(c, i) {
  return (c.relay.history || []).filter((h) => h.index === i && !h.branch).length + 1;
}

function relayHeader(c, i) {
  const st = c.relay.steps[i];
  const n = relayRunNo(c, i);
  const b = c.relay.branchOf;
  return `あなたは、複数のエージェントで作業を引き継ぐ「Pipeline」の、工程 ${i + 1}/${c.relay.steps.length}「${st.label}」${n > 1 ? `（${n}回目）` : ''}の担当です。${b ? `（並列の枝 ${b.index + 1}。ほかの枝は別の worktree で同時に動いていて、すべての枝が終わったらマージします）` : ''}`;
}

// 線の行き先の説明
function relayTargetText(c, edge) {
  const flow = c.relay.flow;
  const n = edge && FlowModel.nodeOf(flow, edge.to);
  if (!n || n.type === 'end') return 'Pipelineを終えてレビューに回します';
  if (n.type === 'step') {
    const j = relayStepIndex(c, n.id);
    const back = FlowModel.backEdges(flow).has(edge.id);
    const st = c.relay.steps[j] || n;
    return `工程${j + 1}「${n.label}」（${whoLabel(st.agent, st.persona)}）${back ? 'に戻ってやり直します' : 'へ進みます'}`;
  }
  if (n.type === 'parallel') {
    const names = FlowModel.outEdges(flow, n.id).map((e) => `「${(FlowModel.nodeOf(flow, e.to) || {}).label || ''}」`).join('・');
    return `並列「${n.label}」で ${names} を同時に進めます`;
  }
  if (n.type === 'join') return `合流「${n.label}」で、ほかの枝が終わるのを待ちます`;
  return `${FlowModel.TYPE_LABEL[n.type]}「${FlowModel.labelOf(n)}」へ進みます`;
}

// ログに出す行き先。エージェントへの指示（relayJudgeNote）は relayTargetText の日本語のまま
function relayTargetLog(c, edge) {
  const flow = c.relay.flow;
  const n = edge && FlowModel.nodeOf(flow, edge.to);
  if (!n || n.type === 'end') return tr('Pipelineを終えてレビューに回します');
  if (n.type === 'step') {
    const j = relayStepIndex(c, n.id);
    const back = FlowModel.backEdges(flow).has(edge.id);
    const st = c.relay.steps[j] || n;
    const who = whoLabel(st.agent, st.persona);
    return back
      ? tr('工程{n}「{label}」（{who}）に戻ってやり直します', { n: j + 1, label: n.label, who })
      : tr('工程{n}「{label}」（{who}）へ進みます', { n: j + 1, label: n.label, who });
  }
  if (n.type === 'parallel') {
    const names = Subtasks.joinQuoted(FlowModel.outEdges(flow, n.id).map((e) => (FlowModel.nodeOf(flow, e.to) || {}).label || ''));
    return tr('並列「{label}」で {names} を同時に進めます', { label: n.label, names });
  }
  if (n.type === 'join') return tr('合流「{label}」で、ほかの枝が終わるのを待ちます', { label: n.label });
  const typeKey = FlowModel.TYPE_LABEL[n.type];
  return tr('{type}「{label}」へ進みます', { type: typeKey ? tr(typeKey) : n.type, label: FlowModel.shownLabel(n) });
}

// すぐあとが分岐の工程に付ける、判定の値の書き方の説明
function relayJudgeNote(c, i) {
  const st = c.relay.steps[i];
  const j = FlowModel.judgeOf(c.relay.flow, st.id);
  if (!j) return '';
  const lines = ['', '## 判定（必ず書いてください）', `この工程のあと、分岐「${j.node.label}」で行き先を分けます。${j.node.question ? `判定すること: ${j.node.question}` : ''}`.trim()];
  lines.push('返事の最後の行に、次のどれか1つだけを、この形のまま書いてください。');
  for (const o of j.options) lines.push(`- \`[[RESULT:${o.value}]]\`${o.when ? `: ${o.when}` : ''} → ${relayTargetText(c, o.edge)}`);
  if (j.elseEdge && !j.elseEdge.value) lines.push(`- どれにも当てはまらないとき（書かなかったときも）→ ${relayTargetText(c, j.elseEdge)}`);
  else if (j.elseEdge) lines.push(`（どれも書かなかったときは \`[[RESULT:${j.elseEdge.value}]]\` と同じに扱います）`);
  lines.push('やり直しや別の工程に回すときは、何をしてほしいかを報告に具体的に書いてください（次の工程に渡します）。');
  return lines.join('\n');
}

/**
 * 工程が終わったあと、次にどこへ進むかを決める（FlowModel.route に、返事の判定の値を渡す）
 * @returns {ReturnType<typeof FlowModel.route> & { result: string|null, judge: object|null, missing: boolean }}
 */
function relayPlan(c) {
  const r = c.relay;
  const st = r.steps[r.index];
  const judge = FlowModel.judgeOf(r.flow, st.id);
  const result = judge ? FlowModel.resultValue(c.lastText) : null;
  const plan = FlowModel.route(r.flow, st.id, { result, counts: r.counts });
  return { ...plan, result, judge, missing: !!judge && result === null };
}

// 最初の工程の指示（タスクの指示 + 担当の説明）
function buildRelayFirstPrompt(c, prompt) {
  const r = c.relay;
  const st = r.steps[r.index];
  const next = r.steps.filter((_, j) => j !== r.index).map((x) => `「${x.label}」（${whoLabel(x.agent, x.persona)}）`).join('・');
  return [prompt, '', '---', relayHeader(c, r.index), next ? `このあと、フローに沿って ${next} の工程があります。` : '', st.instruction ? `\n## あなたの担当\n${st.instruction}` : '', relayJudgeNote(c, r.index)]
    .filter((x) => x !== '')
    .join('\n');
}

// 2つ目以降の工程の指示（元の指示・これまでの工程の報告・担当の説明）
function buildRelayStepPrompt(c, i) {
  const st = c.relay.steps[i];
  const persona = providers.personaNote(st.persona);
  const lines = [relayHeader(c, i), '', ...(persona ? [persona, ''] : []), '## タスクの指示', truncate(c.prompt, 6000), ''];
  const att = attachments.attachmentNote(c.attachments, { toAgentPath: wsl.parseWslPath(c.repoPath || '') ? (p) => wsl.toLinux(p) : undefined });
  if (att) lines.push(att, '');
  lines.push('## これまでの工程');
  // ループで長くなりすぎないよう、新しい方から 10 件まで
  const hist = c.relay.history || [];
  if (hist.length > 10) lines.push(`（前の ${hist.length - 10} 件の報告は省きました）`, '');
  for (const h of hist.slice(-10)) {
    const s = c.relay.steps[h.index] || {};
    const v = h.result === 'fail' ? '・差し戻し' : h.result === 'pass' ? '・合格' : h.result ? `・判定 ${h.result}` : '';
    const n = h.run > 1 ? `・${h.run}回目` : '';
    const b = h.branch ? `・並列の枝 ${h.branch}` : '';
    lines.push(`### 工程${h.index + 1}「${s.label || ''}」（${whoLabel(h.agent, h.persona)}${n}${b}${v}）の報告`, truncate(String(h.report || '（報告なし）').trim(), 3000), '');
  }
  lines.push(
    '## 作業の場所',
    isNoGit(c)
      ? 'このフォルダ（git では管理していません）で作業してください。前の工程の変更は、このフォルダにそのまま残っています。'
      : `このフォルダ（git worktree・ブランチ ${c.branch || ''}・ベース ${c.baseBranch || ''}）で作業してください。前の工程の変更はコミット済みです（git log ${c.baseBranch || 'ベース'}..HEAD や git diff ${c.baseBranch || 'ベース'}...HEAD で確かめられます）。`,
    '',
    '## あなたの担当',
    st.instruction || `工程「${st.label}」を進めてください。`,
  );
  const note = relayJudgeNote(c, i);
  if (note) lines.push(note);
  return lines.join('\n');
}

// 競争: 候補を比べてもらう会話の最初の指示
function buildComparePrompt(title, list) {
  const lines = [`同じタスク「${title}」を、複数のエージェントがそれぞれ別のブランチで解きました。どの案がよいか比べてください。`, ''];
  lines.push('## タスクの指示', truncate(list[0].prompt, 4000), '', '## 候補');
  for (const c of list) {
    lines.push(`### ${whoLabel(agentOf(c), c.persona)}（カード ${c.id}）`);
    if (c.branch) lines.push(`- ブランチ: ${c.branch}（ベース ${c.baseBranch}。git diff ${c.baseBranch}...${c.branch} で変更を見られます）`);
    else lines.push('- まだブランチがありません');
    lines.push(`- 状態: ${c.status}${c.error ? `（${truncate(c.error, 200)}）` : ''}`);
    if (c.lastText) lines.push(`- 最後の報告: ${truncate(String(c.lastText).replace(/\s+/g, ' '), 600)}`);
    lines.push('');
  }
  lines.push(
    '---',
    '',
    '- それぞれの変更を git diff で読み、正しさ・分かりやすさ・テスト・変更の小ささの観点で比べてください（必要ならテストを実行してかまいません）',
    '- ファイルは変更しないでください',
    '- 最後に、どの案を採用するのがよいか、そのまま採用してよいか（直したほうがよい点があるか）を短くまとめてください',
  );
  return lines.join('\n');
}

// スキル名を整える（先頭の / は取る。空なら null）
function cleanSkill(s) {
  const v = String(s || '').trim().replace(/^\//, '');
  return v || null;
}

// エージェントの最後の返事が、ユーザーへの質問で終わっているか
function endsWithQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const lines = t.split(/\n+/).filter((l) => l.trim());
  // 「どちらにしますか？」のあとに選択肢の箇条書きが続く形もあるので、箇条書きは飛ばして見る
  let i = lines.length - 1;
  while (i > 0 && /^\s*([-*•・]|\d+[.)．]|[A-Za-z][.)])\s+/.test(lines[i])) i--;
  return /[?？]\s*[)）」』*_`]*\s*$/.test(lines[i] || '');
}

function splitList(s) {
  return String(s || '')
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// 設定の「ブランチの命名規則」（自然言語）から、エージェントにブランチ名を考えてもらうときの指示
function buildBranchNamePrompt(rule, c) {
  const lines = [
    'git のブランチ名を1つだけ考えてください。次の「命名規則」に従ってください。',
    '',
    '## 命名規則',
    String(rule).trim(),
    '',
    '## タスク',
    `- タイトル: ${c.issue ? c.issue.title : c.title}`,
  ];
  if (c.issue) lines.push(`- GitHub Issue 番号: ${c.issue.number}`);
  lines.push(`- タスク ID: ${c.id}`, `- 指示（抜粋）: ${truncate(String(c.prompt || '').replace(/\s+/g, ' '), 400)}`);
  lines.push(
    '',
    '## 出力のルール',
    '- ブランチ名だけを1行で出力してください（説明・引用符・コードブロックは付けない）',
    '- 使える文字は英小文字・数字・「-」「_」「/」「.」だけにしてください。日本語のタイトルは短い英語にしてください',
    '- 命名規則に書かれていないことは、短く分かりやすい名前にしてください',
  );
  return lines.join('\n');
}

// エージェントの返事からブランチ名を取り出して、使えない文字を落とす
function cleanBranchName(text) {
  const line = String(text || '')
    .split('\n')
    .map((l) => l.trim().replace(/^`+|`+$/g, '').replace(/^["'「]+|["'」]+$/g, '').trim())
    .filter((l) => l && !l.startsWith('```'))
    .pop();
  if (!line) return '';
  return line
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._/-]+/g, '')
    .replace(/\/{2,}/g, '/')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/\/[-.]+/g, '/')
    .replace(/^[-./]+|[-./]+$/g, '')
    .replace(/\.lock$/, '')
    .slice(0, 100);
}

// 「あなたの指示」のログに付けるもの（スキル・添付ファイル）
function userLogExtra(skill, atts, parsed) {
  const extra = { ...(skill ? { skill } : {}), ...(attachments.logExtra(atts, parsed) || {}) };
  return Object.keys(extra).length ? extra : undefined;
}

const TEARDOWN_TIMEOUT_MS = 5 * 60 * 1000; // 片付けが止まらなくても、マージや破棄を待たせ続けない

function scriptPassed(run) {
  return run.code === 0 && !run.stopped && !run.timedOut;
}

function scriptFailReason(run) {
  if (run.stopped) return tr('止めました');
  if (run.timedOut) return tr('時間切れ');
  if (run.error) return run.error;
  return run.code === null ? tr('シグナル {signal}', { signal: run.signal || '?' }) : tr('終了コード {code}', { code: run.code });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (child.viaWsl) {
    try {
      child.stdin.end();
    } catch {
      /* もう閉じている */
    }
  }
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  } else {
    child.kill('SIGTERM');
    setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 5000).unref();
  }
}

class AgentManager extends EventEmitter {
  /**
   * @param {import('./store').Store} store
   * @param {{ mcpScript: string, mcpDir: string, nodeBin: string }} opts
   */
  constructor(store, opts) {
    super();
    this.store = store;
    this.opts = opts;
    this.procs = new Map(); // cardId -> child process
    this.scriptRuns = new Map(); // cardId -> 最後に動かしたスクリプト（セットアップ・片付け・実行）
    this.pending = new Map(); // permission request id -> { cardId, toolName, input, resolve }
    this.rewinding = new Set(); // 戻しているカード。そのあいだ send / merge / PR / 移動 / 破棄は受け付けない
    this.permission = null; // { port, token }
    // 指示に添付したファイルの置き場所（作業フォルダの外）
    this.attachRoot = (opts && opts.attachDir) || path.join(os.tmpdir(), 'worktree-kanban-attachments');
    for (const c of this.store.cards) migrateRelayCard(c);
    this.recoverInterrupted();
    // 前回の終了で止まっていたサブタスクの続き（終わっていたサブタスクのマージなど）
    setImmediate(() => {
      for (const c of this.store.cards) if (c.subtasks && c.subtasks.phase === 'run') this.advanceSubtasks(c.id);
    });
  }

  setPermissionEndpoint(port, token) {
    this.permission = { port, token };
  }

  // 前回アプリを終了したとき（落ちたときも含む）に動いていた・待っていたカードを整理し、
  // あとから「再開」できるように中断の情報を残す
  recoverInterrupted() {
    const now = Date.now();
    for (const c of this.store.cards) {
      c.permissions = [];
      c.questions = [];
      if (c.conflict) c.conflict.resolving = false;
      // 完了したタスクについての会話が途中だった: タスクは「完了」のまま（もう一度送れば続きを話せる）
      if (c.afterDone && (c.status === 'queued' || c.status === 'running')) {
        if (c.status === 'running' && c.sessionId) c.afterDoneSession = c.sessionId;
        c.afterDone = false;
        c.status = 'done';
        c.error = tr('前回の返事は、アプリの終了で途中で中断されました。もう一度送ってください');
      }
      if (c.status === 'queued') {
        // まだ claude に渡していない指示なので、そのまま渡し直せばよい
        c.interrupted = { at: now, kind: 'queued', prompt: c.pendingPrompt || this.firstPrompt(c), attachments: (c.pendingPrompt ? c.pendingAttachments : c.attachments) || undefined };
        c.status = hasWorkplace(c) ? 'review' : 'todo';
        c.error = null;
      }
      if (c.status === 'running') {
        // 会話が始まっていれば同じ会話の続きから、始まる前なら同じ指示をもう一度渡す
        const resumePrompt = isChat(c) ? CHAT_RESUME_PROMPT : isNoGit(c) ? FOLDER_RESUME_PROMPT : RESUME_PROMPT;
        c.interrupted = { at: now, kind: 'running', prompt: c.sessionId ? resumePrompt : c.lastPromptSent || this.firstPrompt(c), attachments: c.sessionId ? undefined : (c.lastPromptSent ? c.lastAttachmentsSent : c.attachments) || undefined };
        c.status = 'failed';
        c.error = quitInterruptMessage();
      }
      c.pendingPrompt = null;
      c.pendingAttachments = null;
    }
    this.store.save();
  }

  // 中断されたタスク
  interruptedCards(repoPath) {
    return this.store.cards.filter((c) => c.interrupted && (!repoPath || c.repoPath === repoPath));
  }

  // 中断されたタスクを、中断したところから再開する
  resume(id) {
    const c = this.must(id);
    const it = c.interrupted;
    if (!it) throw new Error(tr('このタスクは中断されていません'));
    if (c.status === 'running' || c.status === 'queued') throw new Error(tr('このタスクはもう動いています'));
    if (it.kind === 'running') this.log(c, 'user', [RESUME_PROMPT, CHAT_RESUME_PROMPT, FOLDER_RESUME_PROMPT].includes(it.prompt) ? tr('（中断したところから再開）') : it.prompt);
    else this.log(c, 'system',tr('中断されていた指示で再開します'));
    this.enqueue(c, it.prompt, it.attachments);
  }

  resumeAll(repoPath) {
    const list = this.interruptedCards(repoPath).filter((c) => c.status !== 'running' && c.status !== 'queued');
    for (const c of list) this.resume(c.id);
    return list.length;
  }

  // 中断の印だけ消す（再開しない）
  dismissInterrupted(id) {
    const c = this.must(id);
    c.interrupted = null;
    if (c.status === 'failed' && isQuitInterrupt(c.error)) c.status = 'review';
    if (isQuitInterrupt(c.error)) c.error = null;
    this.changed(c);
  }

  // 会話の返事を読んだ（開いた）ので「未読」を外す
  markSeen(id) {
    const c = this.must(id);
    if (!c.unread) return;
    c.unread = false;
    this.changed(c);
  }

  // 実行中・待機中のタスクの数（終了するときの確認用）
  activeCount() {
    const running = this.store.cards.filter((c) => c.status === 'running').length;
    const queued = this.store.cards.filter((c) => c.status === 'queued').length;
    return { running, queued };
  }

  /**
   * アプリを終了する前に呼ぶ。実行中の claude を止め、作業内容をブランチにコミットするまで待つ。
   * カードの状態は「実行中」「待機中」のまま保存するので、次の起動で recoverInterrupted が「中断」にする
   * @param {number} timeoutMs
   */
  async shutdown(timeoutMs = 10000) {
    this.shuttingDown = true;
    this.unwatchPullRequests();
    const runs = [...(this.runs || new Map()).values()];
    // スクリプトは別のプロセスグループで動くので、止めないとアプリの終了後も残る
    const scripts = [...this.scriptRuns.values()].filter((r) => r.running).map((r) => r.handle.stop());
    for (const [id, child] of this.procs) {
      const c = this.store.card(id);
      if (c) this.log(c, 'system',tr('アプリを終了するため中断しました。次に起動したときに「再開」できます'));
      this.denyAllPending(id, tr('アプリを終了します'));
      killTree(child);
    }
    const done = Promise.all([...runs.map((r) => r.done), ...scripts]);
    await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs).unref())]);
    this.store.flush();
  }

  // ---------- 参照 ----------

  publicCards(repoPath) {
    return this.store.cards
      .filter((c) => !repoPath || c.repoPath === repoPath)
      .map((c) => {
        // checkpoints と、戻すときに一時的に持つ元の指示は渡さない（指示文が入っている）。画面は rewind だけを見る
        const { logs, finalDiff, checkpoints, rewindPrompt, rewindHandoff, ...rest } = c;
        return { ...rest, rewind: Checkpoints.publicView(c, this.rewindContext(c)) };
      });
  }

  // 画面と rewind が同じ理由を使う
  rewindContext(c) {
    return {
      rewinding: this.rewinding.has(c.id),
      worktreeMissing: !!(c.worktreePath && !fs.existsSync(c.worktreePath)),
      parentMerged: this.branchParentMerged(c),
    };
  }

  // 並列の枝で、親がもうこの枝をマージした（または枝のカードが親から外れた）
  branchParentMerged(c) {
    const b = c && c.relay && c.relay.branchOf;
    if (!b) return false;
    const p = this.store.card(b.parent);
    if (!p || p.status === 'done' || (p.mergedInto && p.mergedInto.length) || p.mergedAt) return true;
    const w = p.relay && p.relay.waiting;
    if (!w || !(w.children || []).includes(c.id)) return true;
    return (w.merged || []).includes(c.id);
  }

  assertNotRewinding(c) {
    if (this.rewinding.has(c.id)) throw new Error(tr('戻しているところです'));
  }

  must(id) {
    const c = this.store.card(id);
    if (!c) throw new Error(tr('タスクが見つかりません'));
    return c;
  }

  logs(id) {
    return this.must(id).logs || [];
  }

  changed(card) {
    this.store.save();
    this.emit('changed', card ? card.id : null);
    if (card) this.queueIssueSync(card);
  }

  // ---------- GitHub Projects のステータス ----------

  // カードの状態に合う Projects のステータス（変えないときは null）
  issueStatusKey(c) {
    // 完了したタスクについて話しているだけのときは、Issue のステータスを変えない
    if (c.afterDone) return null;
    if (c.status === 'running' || c.status === 'queued') return 'inProgress';
    // サブタスクを動かしているあいだは、まだ作業中
    if (c.subtasks && c.subtasks.phase === 'run') return 'inProgress';
    // 仕様の確認中は、まだ開発を始めていないのでレビューにはしない（In progress のまま）
    if (c.status === 'review' && c.specState === 'pending') return null;
    if (c.status === 'review' || c.status === 'failed') return 'inReview';
    // PR を作って片付けただけのときは、まだ取り込まれていないので In review のまま（PR のマージを見つけたら Done にする）
    if (c.status === 'done') return (c.mergedInto && c.mergedInto.length) || c.prMergedAt || c.manualDone ? 'done' : 'inReview';
    return null;
  }

  // Issue から作ったカードの列が変わったら、Issue が入っている Project の Status を合わせる（裏で順番に動かす）
  queueIssueSync(c) {
    if (!c.issue || this.store.repoSettings(c.repoPath).issueStatusSync === false) return;
    const key = this.issueStatusKey(c);
    if (!key) return;
    c.issueSync = c.issueSync || {};
    if (c.issueSync.wanted === key) return;
    c.issueSync.wanted = key;
    this.issueSyncs = this.issueSyncs || new Map();
    const prev = this.issueSyncs.get(c.id) || Promise.resolve();
    const next = prev.then(() => this.runIssueSync(c, key));
    this.issueSyncs.set(c.id, next);
    next.then(() => {
      if (this.issueSyncs.get(c.id) === next) this.issueSyncs.delete(c.id);
    });
  }

  async runIssueSync(c, key) {
    if (!this.store.card(c.id) || !c.issueSync || c.issueSync.wanted !== key) return; // 破棄された・もっと新しい状態がある
    try {
      const r = await this.setIssueProjectStatus(c.repoPath, c.issue.number, key);
      if (!this.store.card(c.id)) return;
      c.issueSync.synced = key;
      c.issueSync.error = null;
      for (const u of r.updated) this.log(c, 'system', u.from ? tr('GitHub Projects「{project}」で #{number} のステータスを {to} にしました（前は {from}）', { project: u.project, number: c.issue.number, to: u.to, from: u.from }) : tr('GitHub Projects「{project}」で #{number} のステータスを {to} にしました', { project: u.project, number: c.issue.number, to: u.to }));
      for (const s of r.skipped) {
        const msg = tr('GitHub Projects「{project}」のステータスは変えませんでした: {reason}', { project: s.project, reason: s.reason });
        if (c.issueSync.lastSkip !== msg) this.log(c, 'system', msg);
        c.issueSync.lastSkip = msg;
      }
      if (!r.projects && !c.issueSync.noProject) {
        c.issueSync.noProject = true;
        this.log(c, 'system',tr('#{number} はどの GitHub Projects にも入っていないので、ステータスは変えませんでした', { number: c.issue.number }));
      }
    } catch (err) {
      if (!this.store.card(c.id)) return;
      // 同じエラーは何度も出さない
      if (c.issueSync.error !== err.message) this.log(c, 'error',tr('GitHub Projects のステータスを変えられませんでした: {message}', { message: err.message }));
      c.issueSync.error = err.message;
    }
    this.store.save();
    this.emit('changed', c.id);
  }

  // テストで差し替えられるようにメソッドにしておく
  setIssueProjectStatus(repoPath, number, key) {
    const s = this.store.repoSettings(repoPath);
    return github.setIssueProjectStatus(repoPath, number, key, { gh: this.opts.ghPath, fieldName: s.statusFieldName, mapping: s.statusMapping });
  }

  // 実行中の Projects の更新が終わるまで待つ（テスト・終了時用）
  async flushIssueSync() {
    while (this.issueSyncs && this.issueSyncs.size) await Promise.all([...this.issueSyncs.values()]);
  }

  // エージェントの TODO リスト（進捗タブに出す）。いちばん新しいものだけを残す
  setTodos(card, items) {
    if (!Array.isArray(items)) return;
    card.todos = { items: items.slice(0, 50), at: Date.now(), agent: agentOf(card) };
  }

  log(card, kind, text, extra) {
    const entry = { t: Date.now(), kind, text, ...(extra || {}) };
    card.logs = card.logs || [];
    card.logs.push(entry);
    if (card.logs.length > MAX_LOGS) card.logs.splice(0, card.logs.length - MAX_LOGS);
    if (entry.images && entry.images.some((im) => im.data)) pruneImages(card.logs);
    this.emit('log', card.id, entry);
  }

  // ---------- 通知（右上のベル） ----------

  /**
   * 通知を足す。右上の通知一覧に出し、'notification' イベントでデスクトップ通知にも使う
   * @param {object} c カード
   * @param {string} kind permission / question / awaiting / review / failed / done / skill / schedule
   */
  notify(c, kind, title, body, extra) {
    const n = {
      id: crypto.randomBytes(5).toString('hex'),
      t: Date.now(),
      repoPath: c.repoPath || '',
      cardId: c.id,
      cardTitle: c.title,
      kind,
      title,
      body: truncate(String(body || '').trim(), 600),
      read: false,
      ...(extra || {}),
    };
    this.store.addNotification(n);
    this.store.save();
    this.emit('notification', n, c);
    return n;
  }

  listNotifications(repoPath) {
    return this.store.notifications.filter((n) => !repoPath || n.repoPath === repoPath);
  }

  // 既読にする（ids を省くと、そのリポジトリの通知をすべて）
  readNotifications(repoPath, ids) {
    const set = Array.isArray(ids) ? new Set(ids) : null;
    for (const n of this.listNotifications(repoPath)) if (!set || set.has(n.id)) n.read = true;
    this.store.save();
    this.emit('changed', null);
  }

  // 通知を消す（ids を省くと、そのリポジトリの通知をすべて）
  clearNotifications(repoPath, ids) {
    const set = Array.isArray(ids) ? new Set(ids) : null;
    this.store.data.notifications = this.store.notifications.filter((n) => (repoPath && n.repoPath !== repoPath) || (set && !set.has(n.id)));
    this.store.save();
    this.emit('changed', null);
  }

  // 通知のボタン（「スキルを提案してもらう」など）を押したとき
  actNotification(id) {
    const n = this.store.notifications.find((x) => x.id === id);
    if (!n) throw new Error(tr('通知が見つかりません'));
    if (!n.action || n.actedAt) throw new Error(tr('この通知はもう対応済みです'));
    let result = null;
    if (n.action === 'suggestSkills') result = { cardId: this.suggestSkills(n.cardId).id };
    else throw new Error(tr('知らない操作です: {action}', { action: n.action }));
    n.actedAt = Date.now();
    n.read = true;
    this.store.save();
    this.emit('changed', n.cardId);
    return result;
  }

  // タスクが「完了」に入ったときに呼ぶ。完了の通知を出す。
  // 前に完了したタスクに似た作業があれば（同じような作業が続いていれば）、スキルにしませんか？の通知も出す
  completed(c) {
    const body = (c.mergedInto || []).length ? tr('{targets} に取り込みました', { targets: c.mergedInto.join(', ') }) : c.prUrl ? tr('PR を作って片付けました: {url}', { url: c.prUrl }) : tr('タスクを完了にしました');
    this.notify(c, 'done', tr('完了: {title}', { title: c.title }), body);
    if (this.store.settings.suggestSkillsOnDone === false || !c.sessionId || c.skillSuggestNotified) return;
    const similar = this.similarDoneTasks(c);
    if (!similar.length) return;
    c.skillSuggestNotified = true;
    c.skillSuggestSimilar = similar.map((x) => x.id);
    const shown = similar.slice(0, 3).map((x) => `「${x.title}」`).join(I18n.getLanguage() === 'ja' || I18n.getLanguage() === 'zh' ? '、' : ', ');
    const names = similar.length > 3 ? tr('{shown} ほか {n} 件', { shown, n: similar.length - 3 }) : shown;
    this.notify(
      c,
      'skill',
      tr('似たタスクが続いています。スキルにしませんか？: {title}', { title: c.title }),
      tr('前に完了した {names} と似た作業でした。繰り返している作業を、次から速く・確実にできるスキル（SKILL.md）にするよう {agentShort} に提案してもらえます。', { names, agentShort: agentShort(this.helperAgent(c)) }),
      { action: 'suggestSkills', actionLabel: tr('スキルを提案してもらう') },
    );
  }

  /**
   * c と似た作業の、前に完了したタスクを探す（同じリポジトリのタスクだけ。会話のカードは除く）
   * - すでにスキルの提案に使ったタスク、c の修正として作ったタスク（またはその元）、同じ競争のタスクは数えない
   * @returns {object[]} 似ている順のカード
   */
  similarDoneTasks(c) {
    const pool = this.store.cards.filter((x) => x.id !== c.id && x.status === 'done' && x.repoPath === c.repoPath && !isChat(x));
    const related = (x) =>
      x.skillSuggestedAt ||
      x.fromChat === c.id ||
      c.fromChat === x.id ||
      (c.compete && x.compete && c.compete.group === x.compete.group);
    // 比べ方（決まり文句・よく出る文字の重み）は全体から決め、提案の対象にできるものだけを残す
    return findSimilarTasks(c, pool)
      .map((r) => r.card)
      .filter((x) => !related(x));
  }

  // ---------- カード操作 ----------

  /**
   * タスクを作る。エージェントの選び方（mode）で作るカードが変わる
   * - claude / codex / gemini / cursor: そのエージェントで1枚
   * - relay: 設定のPipelineの工程で1枚（同じ worktree で、工程ごとに別のエージェントへ順番に引き継ぐ）
   * - compete: 設定の競争のエージェントの数だけ（同じタスクを、それぞれ別の worktree で並列に解く）
   * @returns {object[]} 作ったカード
   */
  // readOnly: ソースを変更しないタスク（worktree を作らずリポジトリのフォルダで動かし、ファイルを書き換えるツールは止める）
  // repoPath: カードを作るリポジトリ（省くと今開いているリポジトリ）。Pipeline・カスタムエージェント・プロジェクトごとの設定は、そのリポジトリのものを使う
  // skipSpecCheck: 仕様の確認をしない（誰も見ていないスケジュール実行で、確認のまま止まらないように）
  // scheduleId / scheduleTitle: このタスクを作ったスケジュール
  createTask({ title, prompt, issue, session, skill, agent, model, fromChat, attachments: files, readOnly, repoPath, skipSpecCheck, scheduleId, scheduleTitle }) {
    const s = this.store.settings;
    const repo = this.targetRepo(repoPath);
    const extra = { repoPath: repo, skipSpecCheck, scheduleId, scheduleTitle };
    // 添付は先に確かめておく（カードごとに保存する）
    const parsed = attachments.parseAttachments(files);
    let mode = agent || providers.defaultAgentOf(s);
    // Pipeline は「relay」（既定の Pipeline）か「relay:<ID>」（そのプロジェクトの Pipeline の1つ）
    let pipelineId = '';
    if (typeof mode === 'string' && mode.startsWith('relay:')) {
      pipelineId = mode.slice('relay:'.length);
      mode = 'relay';
    }
    // カスタムエージェント: その CLI・モデル・プロフィールで動かす
    const custom = providers.isCustomRef(mode) ? this.customAgent(mode, repo) : null;
    if (custom) mode = custom.agent;
    // Pipeline・競争は工程・カードごとにエージェントが違うので、モデルは工程・設定のものを使う
    const m = mode === 'relay' || mode === 'compete' ? '' : custom ? custom.model : cleanModel(model);
    // 会話の続き、または完了したタスクの修正として作る
    const chat = fromChat ? this.store.card(fromChat) : null;
    const from = isChat(chat) || (chat && chat.status === 'done') ? chat : null;
    // Pipelineと競争は排他。設定で選んでいない方（「なし」ならどちらも）は使えない
    if ((mode === 'relay' || mode === 'compete') && providers.cleanOrchestration(s.orchestration) !== mode) {
      const name = (m) => (m === 'relay' ? 'Pipeline' : tr('競争'));
      const why = providers.cleanOrchestration(s.orchestration) === 'none' ? tr('オーケストレーションを使わない設定') : tr('Pipelineと競争はどちらか1つだけ使えます');
      throw new Error(tr('{name}は使わない設定になっています（{why}）。「設定」の「オーケストレーション」で{name2}を選んでください', { name: name(mode), why, name2: name(mode) }));
    }
    if (readOnly && mode === 'compete') throw new Error(tr('ソースを変更しないタスクでは、競争は使えません。ほかのエージェントを選んでください'));
    if (mode === 'compete') return this.createCompetition({ title, prompt, issue, session, skill, fromChat: from, parsed, ...extra });
    if (mode === 'relay') {
      // Pipelineのフローチャートは、プロジェクトごとの設定（複数あれば、選んだもの。選んでいなければ既定の Pipeline）
      const pipe = pipelineOf(this.store.repoSettings(repo), pipelineId);
      if (!pipe) throw new Error(tr('選んだ Pipeline が見つかりません（消されたかもしれません）。選び直してください'));
      const flow = cleanRelayFlow(pipe.flow);
      const errs = FlowModel.validateFlow(flow);
      if (errs.length) throw new Error(tr('Pipeline「{name}」のフローチャートを直してください（設定の「フローチャートを編集」）: {v}', { name: pipe.name, v: errs[0] }));
      const steps = relayStepsOf(flow, this.customAgents(repo));
      const lost = steps.find((st) => st.missing);
      if (lost) throw new Error(tr('Pipelineの工程「{label}」のカスタムエージェントが見つかりません（消されたかもしれません）。「設定」のフローチャートで、工程のエージェントを選び直してください', { label: lost.label }));
      const off = steps.find((st) => !providers.isEnabled(s, st.agent));
      if (off) throw new Error(tr('Pipelineの工程「{label}」の {whoLabel} は使わない設定になっています。「設定」で工程のエージェントを変えるか、使うエージェントにチェックを付けてください', { label: off.label, whoLabel: whoLabel(off.agent, off.persona) }));
      if (isNoGitRepo(s, repo) && flow.nodes.some((n) => n.type === 'parallel')) throw new Error(tr('git で管理していないフォルダでは、並列のあるPipelineは使えません（枝ごとに別の作業場所を作れないため）。フローチャートから並列を外してください'));
      if (readOnly && flow.nodes.some((n) => n.type === 'parallel')) throw new Error(tr('ソースを変更しないタスクでは、並列のあるPipelineは使えません。フローチャートから並列を外すか、ほかのエージェントを選んでください'));
      const first = FlowModel.route(flow, FlowModel.startNode(flow).id, {});
      const index = relayStepIndex({ relay: { steps } }, first.node.id);
      const st = steps[index];
      const c = this.createCard({ title, prompt, issue, session, skill, agent: st.agent, relay: { flow, steps, index, history: [], counts: {}, pipeline: { id: pipe.id, name: pipe.name } }, fromChat: from, parsed, readOnly, ...extra });
      if (st.model) c.model = st.model;
      if (st.persona) c.persona = st.persona;
      return [c];
    }
    return [this.createCard({ title, prompt, issue, session, skill, agent: mode, model: m, persona: providers.personaOf(custom), fromChat: from, parsed, readOnly, ...extra })];
  }

  // 競争: 同じタスクを、設定のエージェントそれぞれのカードにする（使わない設定のエージェントは外す）
  createCompetition({ title, prompt, issue, session, skill, fromChat, parsed, repoPath, skipSpecCheck, scheduleId, scheduleTitle }) {
    const s = this.store.settings;
    const repo = this.targetRepo(repoPath);
    if (isNoGitRepo(s, repo)) throw new Error(tr('git で管理していないフォルダでは、競争は使えません（候補ごとに別の作業場所を作れないため）。ほかのエージェントを選んでください'));
    const list = this.competeEntries(repo);
    if (list.length < 2) throw new Error(tr('競争させるエージェントを、設定で2つ以上選んでください（使うエージェントにチェックを付けたものと、カスタムエージェントから選べます）'));
    const group = crypto.randomBytes(4).toString('hex');
    const base = (title && title.trim()) || truncate(String(prompt || '').trim().split('\n')[0], 40);
    return list.map((x, index) =>
      this.createCard({ title: `${base} [${whoShort(x.agent, x.persona)}]`, prompt, issue, session, skill, agent: x.agent, model: x.model, persona: x.persona, compete: { group, index, total: list.length, title: base }, fromChat, parsed, repoPath: repo, skipSpecCheck, scheduleId, scheduleTitle: scheduleTitle || base }),
    );
  }

  // 競争させる顔ぶれ: 設定のふつうのエージェント（使う設定のもの）と、このプロジェクトのカスタムエージェント（元の CLI が使う設定のもの）
  competeEntries(repoPath) {
    const s = this.store.settings;
    const plain = providers.cleanCompeteAgents(s.competeAgents).filter((a) => providers.isEnabled(s, a)).map((a) => ({ agent: a, model: '', persona: null }));
    const cas = this.customAgents(repoPath);
    const custom = this.store.repoSettings(repoPath).competeCustomAgents
      .map((id) => providers.findCustomAgent(cas, id))
      .filter((ca) => ca && providers.isEnabled(s, ca.agent))
      .map((ca) => ({ agent: ca.agent, model: ca.model, persona: providers.personaOf(ca) }));
    return [...plain, ...custom];
  }

  // カードを作るリポジトリ。指定がなければ今開いているリポジトリ
  // （指定されたフォルダがなければエラー。設定が初期値に戻って、見当違いの動きをしないように）
  targetRepo(repoPath) {
    const dir = String(repoPath || '').trim();
    if (!dir) return this.store.settings.repoPath;
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(tr('リポジトリのフォルダが見つかりません: {dir}', { dir }));
    return dir;
  }

  // プロジェクトのカスタムエージェント（省くと今のプロジェクト）
  customAgents(repoPath = this.store.settings.repoPath) {
    return providers.cleanCustomAgents(this.store.repoSettings(repoPath).customAgents);
  }

  // 「custom:<ID>」のカスタムエージェント（なければ・元の CLI が使わない設定ならエラー）
  customAgent(ref, repoPath) {
    const ca = providers.findCustomAgent(this.customAgents(repoPath), ref);
    if (!ca) throw new Error(tr('カスタムエージェントが見つかりません（消されたかもしれません）。選び直してください'));
    if (!providers.isEnabled(this.store.settings, ca.agent)) throw new Error(tr('カスタムエージェント「{name}」の {agentLabel} は使わない設定になっています。「設定」の「使うエージェント」でチェックを付けてください', { name: ca.name, agentLabel: agentLabel(ca.agent) }));
    return ca;
  }

  // 使うエージェントか（設定でチェックを付けていなければエラー）
  assertEnabled(agent) {
    if (!providers.isAgent(agent)) throw new Error(tr('知らないエージェントです: {agent}', { agent }));
    if (!providers.isEnabled(this.store.settings, agent)) throw new Error(tr('{agentLabel} は使わない設定になっています。「設定」の「使うエージェント」でチェックを付けてください', { agentLabel: agentLabel(agent) }));
  }

  // アプリが頼む作業（比較・スキルの提案など）を任せるエージェント。元のカードのエージェントが使えるならそれ、なければ最初から選んでおくエージェント
  helperAgent(src) {
    const s = this.store.settings;
    const a = src && !src.relay ? agentOf(src) : null;
    return a && providers.isEnabled(s, a) ? a : providers.defaultAgentOf(s);
  }

  createCard({ title, prompt, issue, session, skill, agent, model, persona, relay, compete, fromChat, parsed, readOnly, repoPath, skipSpecCheck, scheduleId, scheduleTitle }) {
    const s = this.store.settings;
    const repo = this.targetRepo(repoPath);
    if (!repo) throw new Error(tr('先にリポジトリを選んでください'));
    if (!prompt || !prompt.trim()) throw new Error(tr('指示を入力してください'));
    if (agent) this.assertEnabled(agent);
    const noGit = isNoGitRepo(s, repo);
    if (readOnly && compete) throw new Error(tr('ソースを変更しないタスクでは、競争は使えません。ほかのエージェントを選んでください'));
    if (noGit && compete) throw new Error(tr('git で管理していないフォルダでは、競争は使えません（候補ごとに別の作業場所を作れないため）。ほかのエージェントを選んでください'));
    const card = {
      id: crypto.randomBytes(4).toString('hex'),
      title: (title && title.trim()) || truncate(prompt.trim().split('\n')[0], 40),
      prompt: prompt.trim(),
      status: 'todo',
      repoPath: repo,
      createdAt: Date.now(),
      permissions: [],
      alwaysAllow: [],
      logs: [],
    };
    if (scheduleId) {
      card.scheduleId = scheduleId;
      card.scheduleTitle = String(scheduleTitle || '').trim() || card.title;
    }
    if (noGit) card.noGit = true;
    // ソースを変更しないタスク: git なしのフォルダと同じく、worktree・ブランチ・コミット・マージを使わず、
    // リポジトリのフォルダでそのまま動かす。終わったら確かめて「完了にする」で完了にする
    if (readOnly) {
      card.noGit = true;
      card.readOnly = true;
    }
    if (issue) card.issue = { number: issue.number, title: issue.title, url: issue.url };
    card.agent = agent || providers.defaultAgentOf(s);
    if (model && !relay) card.model = cleanModel(model);
    if (persona && !relay) card.persona = persona;
    if (relay) card.relay = relay;
    if (compete) card.compete = compete;
    card.sessions = [];
    // 会話の続きとして作るとき: Claude Code どうしなら会話そのものを引き継ぎ（フォーク）、
    // それ以外（エージェントが違う・Claude Code 以外）は会話のやりとりを最初の指示に添えて渡す
    // 完了したタスクからは、会話そのものは引き継がない（作業フォルダが違う）。やりとりを指示に添えて渡す
    const fromSession = fromChat && session && session.id && session.id === fromChat.sessionId;
    if (fromChat && !(fromSession && isChat(fromChat) && card.agent === 'claude' && agentOf(fromChat) === 'claude')) {
      card.chatContext = buildChatContext(fromChat);
      card.fromChat = fromChat.id;
      if (fromSession) session = null;
    }
    // 既存の会話（Claude Code の会話）を引き継げるのは Claude Code だけ
    if (session && session.id && card.agent === 'claude') this.applySession(card, session);
    card.skill = cleanSkill(skill);
    // 内容が詰まっていなければ、開発を始める前にエージェントと対話して仕様を詰める
    if (!skipSpecCheck && this.store.repoSettings(repo).specCheck !== false) card.specState = 'checking';
    this.saveCardAttachments(card, parsed);
    this.store.cards.push(card);
    this.changed(card);
    return card;
  }

  // 最初の指示（スキル・Pipelineの担当の説明を付けたもの）
  firstPrompt(c) {
    // 仕様の確認中は、開発を始める前に内容が足りているかを判断してもらう指示を付ける
    let body = this.withAttachments(c, withChatContext(c.chatContext, c.prompt), c.attachments);
    // サブタスクが決まっていれば順番を決めてもらい、決まっていなければ、分けたほうがよいときに提案してもらう
    if (c.subtasks && c.subtasks.phase === 'plan') body = Subtasks.withPlanNote(c.subtasks.items, body);
    // 提案は、開発を始める前の相談（仕様の確認）の一部として頼む
    else if (inSpecCheck(c) && this.canHaveSubtasks(c) && !c.subtasks) body = Subtasks.withProposeNote(body);
    if (c.readOnly) body = withReadOnlyNote(body);
    const p = promptWithSkill(agentOf(c), c.skill, providers.withPersona(c.persona, inSpecCheck(c) ? withSpecCheck(body) : body));
    return c.relay && !isChat(c) ? buildRelayFirstPrompt(c, p) : p;
  }

  // ---------- オーケストレーション ----------

  // 工程が終わったとき: フローの線をたどって、次に動かすところ（分岐・ループの行き先）を決める
  // （Pipelineを終えたあとの追加指示では、もう次の工程へは進まない）
  // @returns {{ to?: number|null, parallel?: object, join?: boolean, stop?: string, limitMsg?: string }|null} Pipelineでなければ null
  relayNextStep(c) {
    if (!c.relay || isChat(c) || c.relay.done || c.relay.waiting) return null;
    const r = c.relay;
    const st = r.steps[r.index];
    const plan = relayPlan(c);
    r.lastResult = plan.result;
    if (plan.judge) {
      const where = plan.branch ? ` → ${relayTargetLog(c, plan.branch.edge)}` : '';
      if (plan.missing) this.log(c, 'system',tr('Pipeline: 工程「{label}」の返事に判定の値（[[RESULT:値]]）がなかったので、分岐「{label2}」の「どれにも合わないとき」の線へ進みます{where}', { label: st.label, label2: plan.judge.node.label, where }));
      else this.log(c, 'system', plan.branch && plan.branch.edge.value && FlowModel.normValue(plan.branch.edge.value) === plan.result ? tr('Pipeline: 工程「{label}」の判定は「{result}」でした{where}', { label: st.label, result: plan.result, where }) : plan.branch ? tr('Pipeline: 工程「{label}」の判定は「{result}」でした（どの期待値にも合わないので「どれにも合わないとき」の線へ）{where}', { label: st.label, result: plan.result, where }) : tr('Pipeline: 工程「{label}」の判定は「{result}」でした', { label: st.label, result: plan.result }));
    }
    if (plan.kind === 'nomatch') {
      const vals = plan.judge ? plan.judge.options.map((o) => o.value).join(' / ') : '';
      const msg = tr('分岐「{label}」で、判定の値「{result}」に合う線がないので止まりました（期待値: {vals}）。追加指示で判定の値を書き直してもらうか、フローチャートに「どれにも合わないとき」の線を足してください', { label: plan.node.label, result: plan.result || tr('（なし）'), vals: vals || tr('なし') });
      this.log(c, 'error', tr('Pipeline: {msg}', { msg }));
      return { stop: msg };
    }
    r.counts = plan.counts;
    if (plan.kind === 'step') return { to: relayStepIndex(c, plan.node.id) };
    if (plan.kind === 'parallel') return { parallel: plan.node };
    if (plan.kind === 'join') return { join: true };
    if (plan.kind === 'limit') {
      const back = FlowModel.nodeOf(r.flow, plan.edge.to);
      // 並列の枝の中のループが上限に達したら、その時点の変更で合流する（Pipelineは止めない）
      if (r.branchOf) {
        r.limitReached = true;
        this.log(c, 'error',tr('Pipeline: 「{v}」へ戻れる上限（{maxLoops}回）に達したので、この枝はここまでの変更で合流します', { v: FlowModel.labelOf(back), maxLoops: plan.edge.maxLoops }));
        return { join: true, limitMsg: tr('並列の枝「{label}」がループの上限に達したので、ここまでの変更で合流します', { label: r.branchOf.label }) };
      }
      r.done = true;
      r.limitReached = true;
      const limitMsg = tr('「{label}」へ戻れる上限（{max}回）に達したので、Pipelineを終えてレビューに回しました。差分と最後の報告を確かめてください', { label: FlowModel.labelOf(back), max: plan.edge.maxLoops });
      this.log(c, 'error', tr('Pipeline: {msg}', { msg: limitMsg }));
      return { to: null, limitMsg };
    }
    r.done = true;
    return { to: null };
  }

  // 終わった工程を、ワークフローの記録に残す
  recordRelayStep(c) {
    const r = c.relay;
    const from = r.index;
    const cost = Math.max(0, (c.costUsd || 0) - (r.stepCostStart || 0));
    const entry = { index: from, run: relayRunNo(c, from), agent: agentOf(c), sessionId: c.sessionId || null, report: truncate(c.lastText || c.lastMessage || '', 4000), startedAt: r.stepStartedAt || null, at: Date.now(), costUsd: cost };
    if (r.lastResult) entry.result = r.lastResult;
    if (c.persona) entry.persona = { name: c.persona.name, icon: c.persona.icon, color: c.persona.color };
    r.history = [...(r.history || []), entry];
    r.lastResult = null;
  }

  // Pipelineの次の工程（to。省略したら次の番号）へ進める（同じ worktree のまま、次のエージェントで新しい会話を始める）
  // record: false なら、今の工程の記録は残さない（合流のあとなど、このカードで工程を動かしていないとき）
  advanceRelay(c, to, { record = true } = {}) {
    const r = c.relay;
    if (record) this.recordRelayStep(c);
    r.index = to === undefined ? r.index + 1 : to;
    // ワークフロー表示のため、工程ごとの開始時刻と、開始したときの金額を残す
    r.stepStartedAt = null;
    r.stepCostStart = c.costUsd || 0;
    const st = r.steps[r.index];
    c.agent = st.agent;
    if (st.model) c.model = st.model;
    else delete c.model;
    if (st.persona) c.persona = st.persona;
    else delete c.persona;
    c.sessionId = null;
    c.forkNext = false;
    delete c.todos; // TODO リストは工程（エージェント）ごと
    const n = relayRunNo(c, r.index);
    this.log(c, 'system', n > 1 ? tr('Pipeline: 工程 {i}/{total}「{label}」（{n}回目）を {who} に引き継ぎます', { i: r.index + 1, total: r.steps.length, label: st.label, n, who: whoLabel(st.agent, st.persona) }) : tr('Pipeline: 工程 {i}/{total}「{label}」を {who} に引き継ぎます', { i: r.index + 1, total: r.steps.length, label: st.label, who: whoLabel(st.agent, st.persona) }));
    this.enqueue(c, c.readOnly ? withReadOnlyNote(buildRelayStepPrompt(c, r.index)) : buildRelayStepPrompt(c, r.index));
  }

  /**
   * 並列: 枝ごとに、今のブランチから分けた worktree の「枝のタスク」を作って同時に動かす。
   * このカードは、すべての枝が合流まで来るのを待つ（tryJoin でマージして先へ進む）
   */
  forkParallel(c, node, { record = true } = {}) {
    const r = c.relay;
    if (record) this.recordRelayStep(c);
    const info = FlowModel.parallelInfo(r.flow, node.id);
    r.waiting = { node: node.id, join: info.join, children: [], merged: [], at: Date.now() };
    r.stepStartedAt = null;
    const kids = info.branches.map((b, k) => this.createBranchCard(c, node, info.join, k, relayStepIndex(c, b.edge.to)));
    r.waiting.children = kids.map((k) => k.id);
    const join = FlowModel.nodeOf(r.flow, info.join);
    this.log(c, 'system', tr('Pipeline: 並列「{label}」で、{n} 本の枝（{names}）を別々の worktree で同時に動かします。すべての枝が終わったら、合流「{join}」でこのブランチにマージします', { label: node.label, n: kids.length, names: Subtasks.joinQuoted(kids.map((k) => k.relay.branchOf.label)), join: FlowModel.labelOf(join) }));
    this.changed(c);
    for (const k of kids) {
      this.log(k, 'system',tr('Pipeline: 「{title}」の並列「{label}」の枝 {v} です。ブランチ {branch} から分けた worktree で動かします', { title: c.title, label: node.label, v: k.relay.branchOf.index + 1, branch: c.branch }));
      this.enqueue(k, buildRelayStepPrompt(k, k.relay.index));
    }
  }

  // 並列の枝のタスク（ボードに出す。質問・失敗のときは、このカードから答える・直す）
  createBranchCard(parent, node, join, k, index) {
    const st = parent.relay.steps[index];
    const card = {
      id: crypto.randomBytes(4).toString('hex'),
      title: tr('{title} [枝{n}: {label}]', { title: parent.title, n: k + 1, label: st.label }),
      prompt: parent.prompt,
      status: 'todo',
      repoPath: parent.repoPath,
      createdAt: Date.now(),
      permissions: [],
      alwaysAllow: [],
      logs: [],
      sessions: [],
      agent: st.agent,
      ...(st.model ? { model: st.model } : {}),
      ...(st.persona ? { persona: st.persona } : {}),
      skill: parent.skill || null,
      flowBase: parent.branch,
      relay: {
        flow: parent.relay.flow,
        steps: parent.relay.steps,
        index,
        history: [...(parent.relay.history || [])],
        counts: {},
        stepCostStart: 0,
        branchOf: { parent: parent.id, node: node.id, join, index: k, label: st.label, histStart: (parent.relay.history || []).length },
      },
    };
    if (parent.attachments) card.attachments = parent.attachments;
    this.store.cards.push(card);
    this.changed(card);
    return card;
  }

  // 並列の枝のタスクの、待っている親のカード
  relayParentOf(c) {
    const b = c && c.relay && c.relay.branchOf;
    const p = b && this.store.card(b.parent);
    return p && p.relay && p.relay.waiting && p.relay.waiting.children.includes(c.id) ? p : null;
  }

  /**
   * 合流: 並列の枝がすべて合流まで来たら、枝のブランチを順にこのカードの worktree にマージして、合流の先へ進む。
   * コンフリクトしたら止めて知らせる（解消すると、残りの枝のマージと先の工程へ進む）
   */
  async tryJoin(id) {
    const p = this.store.card(id);
    if (!p || !p.relay || !p.relay.waiting || this.shuttingDown) return;
    if (p.status === 'running' || p.status === 'queued' || p.conflict) return;
    this.joining = this.joining || new Set();
    if (this.joining.has(id)) return;
    const r = p.relay;
    const w = r.waiting;
    const kids = w.children.map((cid) => this.store.card(cid));
    if (kids.some((k) => !k)) {
      p.status = 'failed';
      p.error = tr('並列の枝のタスクが削除されたので、合流できません。このタスクを削除して、もう一度Pipelineで作り直してください');
      this.log(p, 'error', p.error);
      this.changed(p);
      return;
    }
    if (!kids.every((k) => k.relay.atJoin && k.status === 'review')) return;
    this.joining.add(id);
    try {
      const join = FlowModel.nodeOf(r.flow, w.join);
      for (const k of kids) {
        if (w.merged.includes(k.id)) continue;
        const label = k.relay.branchOf.label;
        try {
          await git.merge(p.worktreePath, k.branch, `Merge parallel branch: ${label} (${k.branch})`, p.branch);
        } catch (err) {
          if (!err.conflictFiles) throw err;
          // 解消の画面（エージェントに頼む・自分で直す）は、マージ先と同じものを使う。解消したら markResolved から続ける
          p.conflict = { target: k.branch, files: err.conflictFiles, join: k.id, at: Date.now() };
          p.conflictResolved = null;
          p.status = 'failed';
          p.error = tr('合流「{join}」で、並列の枝「{label}」のマージがコンフリクトしました（{files}）。解消すると、残りの枝のマージと次の工程へ進みます', { join: FlowModel.labelOf(join), label, files: err.conflictFiles.join(', ') });
          this.log(p, 'error', p.error);
          this.notify(p, 'conflict', tr('合流でコンフリクト: {title}', { title: p.title }), p.error);
          return;
        }
        w.merged.push(k.id);
        this.log(p, 'system',tr('Pipeline: 並列の枝「{label}」の変更をマージしました（{branch}）', { label, branch: k.branch }));
      }
      // すべてマージできた: 枝の記録を引き取って、枝のタスクを片付ける
      for (const k of kids) {
        const from = k.relay.branchOf.histStart || 0;
        for (const h of (k.relay.history || []).slice(from)) r.history.push({ ...h, branch: k.relay.branchOf.label });
      }
      r.waiting = null;
      r.lastResult = null;
      p.error = null;
      this.log(p, 'system',tr('Pipeline: 合流「{v}」で、{length} 本の枝をすべてマージしました', { v: FlowModel.labelOf(join), length: kids.length }));
      for (const k of kids) await this.discard(k.id).catch((err) => this.log(p, 'error',tr('枝のタスク「{title}」を片付けられませんでした: {message}', { title: k.title, message: err.message })));
      const plan = FlowModel.route(r.flow, w.join, { counts: r.counts });
      r.counts = plan.counts;
      if (plan.kind === 'step') return this.advanceRelay(p, relayStepIndex(p, plan.node.id), { record: false });
      if (plan.kind === 'parallel') return this.forkParallel(p, plan.node, { record: false });
      r.done = true;
      p.status = 'review';
      if (plan.kind === 'limit') {
        r.limitReached = true;
        const msg = tr('「{label}」へ戻れる上限（{max}回）に達したので、Pipelineを終えてレビューに回しました', { label: FlowModel.labelOf(FlowModel.nodeOf(r.flow, plan.edge.to)), max: plan.edge.maxLoops });
        this.log(p, 'error', tr('Pipeline: {msg}', { msg }));
        this.notify(p, 'review', tr('ループの上限: {title}', { title: p.title }), msg);
      } else this.notify(p, 'review', tr('レビュー待ち: {title}', { title: p.title }), tr('並列の枝をすべてマージして、Pipelineが終わりました。差分を確かめてください'));
    } catch (err) {
      p.status = 'failed';
      p.error = tr('合流に失敗しました: {message}', { message: err.message });
      this.log(p, 'error', p.error);
      this.notify(p, 'failed', tr('失敗: {title}', { title: p.title }), p.error);
    } finally {
      this.joining.delete(id);
      if (this.store.card(id)) this.changed(p);
      this.pump();
    }
  }

  // ---------- サブタスク ----------
  // 親のタスクのブランチから分けた worktree でサブタスクを動かし、終わったものから親のブランチにマージする（src/subtasks.js）

  // サブタスクに分けられるタスクか（git のふつうのタスク。Pipeline・競争・会話・サブタスク自身は分けない）
  canHaveSubtasks(c) {
    return !!c && !isChat(c) && !isNoGit(c) && !c.relay && !c.compete && !c.subtaskOf && !c.afterDone;
  }

  // サブタスクのカードの、親のカード
  subtaskParentOf(c) {
    const b = c && c.subtaskOf;
    const p = b && this.store.card(b.parent);
    return p && p.subtasks && p.subtasks.items.some((x) => x.cardId === c.id) ? p : null;
  }

  defaultSubtaskMerge(c) {
    return Subtasks.cleanMergeMode(this.store.repoSettings(c.repoPath).subtaskMerge);
  }

  // 実行が終わったとき: 返事のサブタスクの印を見る
  // @returns {'started'|'proposed'|null} started: 順番が決まって動かし始める / proposed: 分けて進めることの提案
  takeSubtaskPlan(c) {
    const plan = c.lastSubtaskPlan;
    c.lastSubtaskPlan = null;
    c.lastSubtasksMarked = false;
    if (!this.canHaveSubtasks(c) || c.specState === 'pending') return null;
    const st = c.subtasks;
    if (st && st.phase === 'plan') {
      if (!plan && c.awaitingReply) return null; // 質問で止まった: 答えてもらってから
      st.items = Subtasks.applyPlan(st.items, plan);
      st.phase = 'run';
      st.note = truncate(c.lastText || '', 4000);
      if (!plan) this.log(c, 'system',tr('サブタスクの順番が返ってこなかったので、並んでいる順に1つずつ（直列で）進めます'));
      this.log(c, 'system',tr('サブタスク {length} 個を動かし始めます（{v}）。それぞれ、このブランチ {branch} から分けた worktree で動かし、終わったものからこのブランチにマージします', { length: st.items.length, v: Subtasks.describeOrder(st.items), branch: c.branch }));
      return 'started';
    }
    if (!st && plan && plan.length >= 2) {
      c.subtaskProposal = { items: plan, at: Date.now() };
      return 'proposed';
    }
    return null;
  }

  /**
   * 開始前のタスクのサブタスクを決める（手動で足す・直す・消す）。順番（直列・並列）は、開始したときにエージェントが決める
   * @param {{ items: object[], merge?: 'auto'|'review' }} p  items が空ならサブタスクをやめる
   */
  setSubtasks(id, { items, merge } = {}) {
    const c = this.must(id);
    if (c.status !== 'todo') throw new Error(tr('開始前のタスクだけ、サブタスクを編集できます'));
    if (!this.canHaveSubtasks(c)) throw new Error(tr('このタスクはサブタスクに分けられません（Pipeline・競争・git で管理していないフォルダのタスクと、サブタスク自身は分けられません）'));
    const list = Subtasks.cleanItems(items);
    if (!list.length) {
      if (c.subtasks) this.log(c, 'system',tr('サブタスクをやめて、このタスクのまま進めます'));
      delete c.subtasks;
    } else {
      c.subtasks = { items: list.map((x) => ({ ...x, state: 'pending' })), merge: Subtasks.cleanMergeMode(merge || (c.subtasks && c.subtasks.merge) || this.defaultSubtaskMerge(c)), phase: 'plan' };
      this.log(c, 'system', c.subtasks.merge === 'review' ? tr('サブタスクを {n} 個にしました（終わったら確かめてからマージ）。開始すると、順番を {who} が決めてから動かします', { n: list.length, who: agentShort(agentOf(c)) }) : tr('サブタスクを {n} 個にしました（終わったら自動でマージ）。開始すると、順番を {who} が決めてから動かします', { n: list.length, who: agentShort(agentOf(c)) }));
    }
    this.changed(c);
  }

  /**
   * サブタスクの提案に「サブタスクでやる」と答える
   * @param {{ items?: object[], merge?: 'auto'|'review', createIssues?: boolean }} p
   *   items: 直した一覧（省けば提案のまま） / createIssues: GitHub にもサブIssue を作って、親の Issue にぶら下げる
   */
  async acceptSubtasks(id, { items, merge, createIssues } = {}) {
    const c = this.must(id);
    if (!c.subtaskProposal) throw new Error(tr('サブタスクの提案はありません'));
    if (!['review', 'failed'].includes(c.status)) throw new Error(tr('実行中は選べません'));
    if (!c.worktreePath) throw new Error(tr('worktree がありません'));
    this.accepting = this.accepting || new Set();
    if (this.accepting.has(id)) throw new Error(tr('サブタスクを作っています'));
    const list = Subtasks.cleanItems(items || c.subtaskProposal.items);
    if (!list.length) throw new Error(tr('サブタスクを1つ以上入れてください'));
    if (createIssues && !c.issue) throw new Error(tr('GitHub Issue から作ったタスクだけ、サブIssue を作れます'));
    this.accepting.add(id);
    try {
      if (createIssues) {
        for (const x of list) {
          if (x.issue) continue;
          const made = await this.createSubIssue(c.repoPath, c.issue.number, { title: x.title, body: `${x.prompt}\n\n---\n${tr('Worktree Kanban のサブタスクとして作成しました（親: #{number}）。', { number: c.issue.number })}` });
          x.issue = { number: made.number, title: made.title, url: made.url };
          // 途中で失敗しても、作ったサブIssue は覚えておく（もう一度押したときに二重に作らない）
          c.subtaskProposal.items = list;
          this.log(c, 'system',tr('サブIssue #{number}「{title}」を作って、#{number2} にぶら下げました', { number: made.number, title: x.title, number2: c.issue.number }));
        }
      }
      if (!this.store.card(id) || !c.subtaskProposal) return;
      c.subtasks = { items: list.map((x) => ({ ...x, state: 'pending' })), merge: Subtasks.cleanMergeMode(merge || this.defaultSubtaskMerge(c)), phase: 'run', note: truncate(c.lastText || '', 4000) };
      c.subtaskProposal = null;
      c.awaitingReply = false;
      this.log(c, 'user', c.subtasks.merge === 'review' ? tr('サブタスクに分けて進めます（{n} 個・終わったら確かめてからマージ）', { n: list.length }) : tr('サブタスクに分けて進めます（{n} 個・終わったら自動でマージ）', { n: list.length }));
      this.log(c, 'system',tr('サブタスク {length} 個を動かし始めます（{v}）。それぞれ、このブランチ {branch} から分けた worktree で動かし、終わったものからこのブランチにマージします', { length: list.length, v: Subtasks.describeOrder(c.subtasks.items), branch: c.branch }));
      this.changed(c);
    } catch (err) {
      this.changed(c);
      throw err;
    } finally {
      this.accepting.delete(id);
    }
    await this.advanceSubtasks(id);
  }

  // サブタスクの提案に「分けずに進める」と答える
  declineSubtasks(id) {
    const c = this.must(id);
    if (!c.subtaskProposal) throw new Error(tr('サブタスクの提案はありません'));
    c.subtaskProposal = null;
    this.send(id, tr('サブタスクに分けずに、このタスクのまま開発を進めてください（もうサブタスクの提案はしないでください）。'));
  }

  // サブタスクを親のブランチに取り込める状態か（manual: ユーザーが確かめて取り込むときは、失敗で終わったものも取り込める）
  subtaskReady(k, { manual = false } = {}) {
    if (!k || !k.worktreePath || !k.branch) return false;
    if (!(k.status === 'review' || (manual && k.status === 'failed'))) return false;
    return !k.awaitingReply && !inSpecCheck(k) && !k.conflict && !k.interrupted && !(k.questions || []).length && !(k.permissions || []).length;
  }

  // 確かめたサブタスクを、親のタスクのブランチに取り込む（「確かめてからマージ」のとき）
  async approveSubtask(id) {
    const k = this.must(id);
    const p = this.subtaskParentOf(k);
    if (!p) throw new Error(tr('このタスクはサブタスクではありません'));
    if (!this.subtaskReady(k, { manual: true })) throw new Error(tr('このサブタスクは、まだ取り込める状態ではありません（作業中・質問への回答待ち・コンフリクトなど）'));
    const item = p.subtasks.items.find((x) => x.cardId === k.id);
    if (!(p.subtasks.merge === 'review' || (item && item.manual))) throw new Error(tr('このサブタスクは、終わったら自動で親のブランチにマージします'));
    k.subtaskOf.approved = true;
    this.log(k, 'system',tr('親のタスク「{title}」のブランチに取り込みます', { title: p.title }));
    this.changed(k);
    await this.advanceSubtasks(p.id);
  }

  // サブタスクを始める: 親のブランチから分けた worktree のカードを作って動かす（ボードには出さず、親のカードにまとめて出す）
  startSubtask(p, item) {
    const card = {
      id: crypto.randomBytes(4).toString('hex'),
      title: `${p.title} › ${item.title}`,
      prompt: Subtasks.buildChildPrompt(p, item),
      status: 'todo',
      repoPath: p.repoPath,
      createdAt: Date.now(),
      permissions: [],
      alwaysAllow: [],
      logs: [],
      sessions: [],
      agent: agentOf(p),
      ...(p.model ? { model: p.model } : {}),
      ...(p.persona ? { persona: p.persona } : {}),
      skill: null,
      flowBase: p.branch,
      subtaskOf: { parent: p.id, key: item.key },
    };
    this.store.cards.push(card);
    item.cardId = card.id;
    item.state = 'running';
    this.log(p, 'system',tr('サブタスク「{title}」を始めます', { title: item.title }));
    const check = p.subtasks.merge === 'review' || item.manual;
    this.log(card, 'system', check ? tr('「{title}」のサブタスクです。ブランチ {branch} から分けた worktree で動かし、終わったら、確かめてから（「取り込む」を押してから）親のブランチにマージします', { title: p.title, branch: p.branch }) : tr('「{title}」のサブタスクです。ブランチ {branch} から分けた worktree で動かし、終わったら親のブランチにマージします', { title: p.title, branch: p.branch }));
    this.changed(card);
    this.start(card.id);
  }

  // マージできたサブタスクを片付ける（報告は親のカードに残す）
  // 個別に開始したサブタスクは、マージしてもレビューの列に残す（完了へはドラッグで動かす。マージは状態を変えるきっかけにしない）
  async settleSubtaskMerge(p, item, k) {
    item.state = item.manual ? 'review' : 'merged';
    item.merged = true;
    item.mergedAt = Date.now();
    if (!k) return;
    item.branch = k.branch;
    item.report = truncate(k.lastText || k.lastMessage || '', 4000);
    item.costUsd = k.costUsd || 0;
    item.agent = agentOf(k);
    await this.discard(k.id).catch((err) => this.log(p, 'error',tr('サブタスクのカード「{title}」を片付けられませんでした: {message}', { title: k.title, message: err.message })));
  }

  /**
   * サブタスクを先へ進める（終わったものを親のブランチにマージし、始められるものを始め、すべて終わったら親に仕上げを頼む）。
   * 同じ親では1つずつ動かす（動いている間に呼ばれたら、終わってからもう一度動かす）
   */
  async advanceSubtasks(id) {
    const p = this.store.card(id);
    if (!p || !p.subtasks || p.subtasks.phase !== 'run' || this.shuttingDown) return;
    this.subAdvancing = this.subAdvancing || new Map();
    if (this.subAdvancing.has(id)) {
      this.subAdvancing.set(id, true);
      return;
    }
    this.subAdvancing.set(id, false);
    try {
      await this.advanceSubtasksOnce(p);
    } catch (err) {
      if (this.store.card(id)) {
        p.error = tr('サブタスクを進められませんでした: {message}', { message: err.message });
        this.log(p, 'error', p.error);
        this.notify(p, 'failed', tr('失敗: {title}', { title: p.title }), p.error);
      }
    } finally {
      const again = this.subAdvancing.get(id);
      this.subAdvancing.delete(id);
      if (this.store.card(id)) this.changed(p);
      if (again) setImmediate(() => this.advanceSubtasks(id));
      this.pump();
    }
  }

  async advanceSubtasksOnce(p) {
    const st = p.subtasks;
    if (p.status === 'running' || p.status === 'queued' || p.conflict) return;
    if (!p.worktreePath) throw new Error(tr('親のタスクの worktree がありません'));
    // 終わったサブタスクを、親のブランチに1つずつマージする
    for (const item of st.items) {
      if (item.state !== 'running') continue;
      const k = item.cardId && this.store.card(item.cardId);
      if (!k) {
        item.state = 'skipped';
        this.log(p, 'system',tr('サブタスク「{title}」のカードが見つからないので、マージせずに先へ進みます', { title: item.title }));
        continue;
      }
      const approved = !!k.subtaskOf.approved;
      if ((st.merge === 'review' || item.manual) && !approved) continue;
      if (!this.subtaskReady(k, { manual: approved })) continue;
      if (await git.mergeInProgress(p.worktreePath)) return;
      await git.commitAll(p.worktreePath, this.commitMessage(p));
      try {
        await git.merge(p.worktreePath, k.branch, `Merge subtask: ${item.title} (${k.branch})`, p.branch);
      } catch (err) {
        if (!err.conflictFiles) throw err;
        // ほかのサブタスクの変更とぶつかった: 親のエージェントに解消してもらう（解消したら markResolved から続ける）
        p.conflict = { target: k.branch, files: err.conflictFiles, subtask: k.id, at: Date.now() };
        p.conflictResolved = null;
        this.log(p, 'error',tr('サブタスク「{title}」のマージが、ほかのサブタスクの変更とコンフリクトしました（{v}）。{agentShort} に解消してもらいます', { title: item.title, v: err.conflictFiles.join(', '), agentShort: agentShort(agentOf(p)) }));
        this.changed(p);
        await this.resolveConflict(p.id, 'agent');
        return;
      }
      this.log(p, 'system',tr('サブタスク「{title}」の変更を、このブランチにマージしました（{branch}）', { title: item.title, branch: k.branch }));
      await this.settleSubtaskMerge(p, item, k);
      if (!this.store.card(p.id)) return;
    }
    // 自動で進めるときは、先に終わっている必要があるサブタスクがすべてマージされたものを始める
    if (st.auto !== false) for (const item of Subtasks.startable(st)) this.startSubtask(p, item);
    this.finishSubtasksIfSettled(p);
  }

  // すべてのサブタスクが完了の列に入ったら（マージではなく状態で決める）、親のエージェントに仕上げを頼んでからレビューに回す
  finishSubtasksIfSettled(p) {
    const st = p.subtasks;
    if (!st || st.phase !== 'run' || !Subtasks.allSettled(st)) return;
    if (p.status === 'running' || p.status === 'queued' || p.conflict) return;
    st.phase = 'done';
    p.error = null;
    if (!st.items.some((x) => x.state === 'merged')) {
      this.log(p, 'system',tr('サブタスクがすべて完了になりました（親のブランチにマージしたものはないので、仕上げはしません）'));
      this.changed(p);
      return;
    }
    const prompt = Subtasks.buildFinishPrompt(p, { withTask: !p.sessionId });
    this.log(p, 'system',tr('サブタスクがすべて完了になりました。全体の仕上げ（テスト・つなぎの直し）をしてから、レビューに回します'));
    this.log(p, 'user', prompt);
    this.enqueue(p, prompt);
  }

  /**
   * サブタスクを1つだけ開始する（ほかのサブタスクは動かさない。終わったらレビューで止まり、「取り込む」で親のブランチにマージする）。
   * 親がまだ開始前なら、親のブランチ（worktree）だけを作り、親のエージェントは動かさない
   */
  async startSubtaskOnly(id, key) {
    const p = this.must(id);
    const st = p.subtasks;
    if (!st) throw new Error(tr('このタスクにはサブタスクがありません'));
    const item = st.items.find((x) => x.key === key);
    if (!item) throw new Error(tr('サブタスクが見つかりません'));
    if (item.state !== 'pending') throw new Error(tr('まだ始めていないサブタスクだけ開始できます'));
    if (p.status === 'running' || p.status === 'queued') throw new Error(st.phase === 'plan' ? tr('サブタスクの順番を決めています。終わってから開始してください') : tr('親のタスクが動いているあいだは開始できません。終わってから開始してください'));
    if (p.conflict) throw new Error(tr('コンフリクトを解消してから開始してください'));
    if (p.status === 'done') throw new Error(tr('完了したタスクのサブタスクは開始できません。レビューの列に戻してから開始してください'));
    this.subStarting = this.subStarting || new Set();
    if (this.subStarting.has(id)) throw new Error(tr('サブタスクを開始しています'));
    this.subStarting.add(id);
    try {
      if (p.status === 'todo') {
        // 親はまだ開始前: 親のブランチだけ作って、親のエージェントは動かさない（順番は決めずに、手で進める）
        this.log(p, 'user', p.prompt, userLogExtra(p.skill, p.attachments, p.attachmentsParsed));
        delete p.attachmentsParsed;
        if (p.worktreePath && fs.existsSync(p.worktreePath)) await this.ensureSetup(p); // 前回セットアップが失敗した
        else await this.prepareWorktree(p);
        if (!this.store.card(id)) return;
        p.status = 'review';
        p.startedAt = Date.now();
        p.specState = null;
        st.auto = false;
        this.log(p, 'system',tr('サブタスク「{title}」だけを開始します。ほかのサブタスクは、サブタスクタブから1つずつ開始するか「残りを自動で進める」で動かします', { title: item.title }));
      }
      if (st.phase !== 'run') st.phase = 'run';
      if (item.state !== 'pending') return;
      item.manual = true;
      this.startSubtask(p, item);
    } finally {
      this.subStarting.delete(id);
      if (this.store.card(id)) this.changed(p);
    }
  }

  /**
   * サブタスクの名前とやることを変える（サブタスクの詳細のモーダルから）。まだ始めていないサブタスクだけ変えられる
   * （開始すると、ここで変えた名前とやることでサブタスクのカードを作る）
   */
  editSubtask(id, key, { title, prompt } = {}) {
    const p = this.must(id);
    const st = p.subtasks;
    if (!st) throw new Error(tr('このタスクにはサブタスクがありません'));
    const item = st.items.find((x) => x.key === key);
    if (!item) throw new Error(tr('サブタスクが見つかりません'));
    if (item.state !== 'pending') throw new Error(tr('まだ始めていないサブタスクだけ変えられます'));
    const t = truncate(String(title ?? '').trim(), 120);
    const body = truncate(String(prompt ?? '').trim(), 20000);
    if (!t) throw new Error(tr('名前を入れてください'));
    if (!body) throw new Error(tr('やることを入れてください'));
    if (t === item.title && body === item.prompt) return item;
    const before = item.title;
    item.title = t;
    item.prompt = body;
    this.log(p, 'user', before === t ? tr('サブタスク「{title}」の内容を変えました', { title: t }) : tr('サブタスク「{before}」を「{title}」に変えました', { before, title: t }));
    this.changed(p);
    return item;
  }

  // サブタスクだけ開始していたタスクで、残りのサブタスクを自動で（順番どおりに）進める
  async autoRunSubtasks(id) {
    const p = this.must(id);
    const st = p.subtasks;
    if (!st || st.phase !== 'run') throw new Error(tr('サブタスクを進めているタスクではありません'));
    st.auto = true;
    this.log(p, 'user',tr('残りのサブタスクを自動で進めます'));
    this.changed(p);
    await this.advanceSubtasks(id);
  }

  /**
   * サブタスクの状態を変える（サブタスクタブのドラッグ&ドロップ）。マージとは切り離して、状態だけを変える
   * @param {'todo'|'running'|'review'|'done'} to  todo: 未着手 / running: 作業中（開始する） / review: レビュー / done: 完了
   */
  async moveSubtask(id, key, to) {
    const p = this.must(id);
    const st = p.subtasks;
    if (!st) throw new Error(tr('このタスクにはサブタスクがありません'));
    const item = st.items.find((x) => x.key === key);
    if (!item) throw new Error(tr('サブタスクが見つかりません'));
    if (to === 'running') {
      if (item.state === 'pending') return this.startSubtaskOnly(id, key);
      throw new Error(tr('作業中へは、まだ始めていないサブタスクだけ動かせます。直してほしいときは、サブタスクを開いて追加の指示を送ってください'));
    }
    if (p.status === 'todo') throw new Error(tr('親のタスクを開始する前は、サブタスクの開始だけできます（作業中の列へドラッグ）'));
    if (p.status === 'running' || p.status === 'queued') throw new Error(tr('親のタスクが動いているあいだは、サブタスクの状態を変えられません'));
    const k = item.cardId && item.state === 'running' ? this.store.card(item.cardId) : null;
    if (k && (k.status === 'running' || k.status === 'queued' || k.status === 'todo')) throw new Error(tr('作業中のサブタスクは動かせません。止めてから動かしてください'));
    if (k && p.conflict && p.conflict.subtask === k.id) throw new Error(tr('このサブタスクのマージでのコンフリクトを解消してから動かしてください'));
    if (to === 'done') {
      if (Subtasks.SETTLED.includes(item.state)) return;
      if (item.state === 'pending') {
        item.state = 'done';
        this.log(p, 'user',tr('サブタスク「{title}」を、始めずに完了にしました', { title: item.title }));
      } else if (item.state === 'review') {
        item.state = 'merged';
        this.log(p, 'user',tr('サブタスク「{title}」を完了にしました', { title: item.title }));
      } else {
        // まだ取り込んでいないサブタスク: 取り込まずに完了にする（サブタスクのカードと worktree は片付ける）
        item.state = 'done';
        if (k) {
          item.branch = k.branch;
          item.report = truncate(k.lastText || k.lastMessage || '', 4000);
          item.costUsd = k.costUsd || 0;
          item.agent = agentOf(k);
        }
        this.log(p, 'user',tr('サブタスク「{title}」を、親のブランチに取り込まずに完了にしました', { title: item.title }));
        if (k) await this.discard(k.id).catch((err) => this.log(p, 'error',tr('サブタスクのカード「{title}」を片付けられませんでした: {message}', { title: k.title, message: err.message })));
        if (!this.store.card(id)) return;
      }
    } else if (to === 'todo') {
      if (item.state === 'pending') return;
      if (k) throw new Error(tr('取り込んでいないサブタスクは、未着手に戻せません。完了にするか、サブタスクを開いて破棄してください'));
      item.state = 'pending';
      delete item.cardId;
      delete item.manual;
      this.log(p, 'user', item.merged ? tr('サブタスク「{title}」を未着手に戻しました（前にマージした変更は、親のブランチに残っています）', { title: item.title }) : tr('サブタスク「{title}」を未着手に戻しました', { title: item.title }));
      if (st.phase === 'done') st.phase = 'run';
    } else if (to === 'review') {
      if (item.state === 'merged' && item.merged) {
        item.state = 'review';
        this.log(p, 'user',tr('サブタスク「{title}」をレビューに戻しました', { title: item.title }));
        if (st.phase === 'done') st.phase = 'run';
      } else if (item.state !== 'review' && !(k && (k.status === 'review' || k.status === 'failed'))) {
        throw new Error(tr('レビューへは、取り込んだサブタスクだけ戻せます'));
      }
    } else throw new Error(tr('知らない列です'));
    this.changed(p);
    this.finishSubtasksIfSettled(p);
    if (this.store.card(id)) this.changed(p);
  }

  /**
   * ボードのカードを、ドラッグ&ドロップで別の列へ動かす（マージや PR とは切り離して、状態だけを変える）
   * @param {'todo'|'running'|'review'|'done'} to
   */
  moveCard(id, to) {
    const c = this.must(id);
    this.assertNotRewinding(c);
    if (isChat(c)) throw new Error(tr('会話は列を動かせません'));
    if (this.subtaskParentOf(c)) throw new Error(tr('サブタスクの状態は、親のタスクの「サブタスク」タブで変えてください'));
    if (c.afterDone) throw new Error(tr('完了したタスクについて話しているあいだは動かせません'));
    const from = c.status;
    const shown = c.subtasks && c.subtasks.phase === 'run' && (from === 'review' || from === 'failed') ? 'running' : from;
    if (shown === to || (to === 'review' && from === 'failed')) return;
    if (to === 'running') {
      if (from === 'todo') return this.start(id);
      throw new Error(tr('開始したタスクを動かすときは、追加の指示を送ってください'));
    }
    if (to === 'todo') throw new Error(tr('開始したタスクは Todo に戻せません'));
    if (from === 'running' || from === 'queued') throw new Error(tr('実行中のタスクは動かせません。止めてから動かしてください'));
    if (to === 'done') {
      if (from === 'todo') throw new Error(tr('開始していないタスクは完了にできません'));
      if (isNoGit(c)) return this.complete(id);
      if (c.subtasks && c.subtasks.phase === 'run') throw new Error(tr('サブタスクが残っています。サブタスクタブでサブタスクをすべて完了にしてから動かしてください'));
      if (c.conflict) throw new Error(tr('コンフリクトを解消するか、取り込みを中止してから完了にしてください'));
      if (c.relay && c.relay.waiting) throw new Error(tr('Pipelineの並列の枝が終わるのを待っています'));
      c.status = 'done';
      c.manualDone = true;
      c.error = null;
      c.interrupted = null;
      c.awaitingReply = false;
      c.subtaskProposal = null;
      c.completedAt = Date.now();
      this.log(c, 'user', c.worktreePath ? tr('完了にしました（マージはしていません。worktree とブランチ {branch} は残しています。続けるときは「レビュー」の列へ戻します）', { branch: c.branch }) : tr('完了にしました'));
      this.completed(c);
      this.changed(c);
      return;
    }
    if (to === 'review') {
      if (from !== 'done') throw new Error(tr('レビューへは、完了したタスクだけ戻せます'));
      if (!isNoGit(c) && !(c.worktreePath && fs.existsSync(c.worktreePath))) throw new Error(tr('マージや PR で作業場所（worktree）を片付けたので、レビューに戻せません。続きは「修正タスクを作る」から進めてください'));
      c.status = 'review';
      c.manualDone = false;
      c.completedAt = null;
      this.log(c, 'user',tr('レビューに戻しました'));
      this.changed(c);
      return;
    }
    throw new Error(tr('知らない列です'));
  }

  // 競争の同じグループのカード（自分も含む）
  competitors(id) {
    const c = this.must(id);
    if (!c.compete) return [c];
    return this.store.cards.filter((x) => x.compete && x.compete.group === c.compete.group).sort((a, b) => a.compete.index - b.compete.index);
  }

  // 競争の結果がそろったら（全員が動き終わったら）一度だけ知らせる
  checkCompetitionDone(c) {
    if (!c.compete) return;
    const list = this.competitors(c.id);
    if (list.some((x) => x.status === 'todo' || x.status === 'queued' || x.status === 'running')) return;
    if (list.some((x) => x.compete.notified)) return;
    for (const x of list) x.compete.notified = true;
    const summary = list.map((x) => `${whoShort(agentOf(x), x.persona)}: ${x.status === 'failed' ? tr('エラー') : tr('できた')}`).join(' / ');
    this.notify(c, 'review', tr('競争の結果がそろいました: {v}', { v: c.compete.title || c.title }), tr('{summary}。差分を比べて、採用する案を選んでください', { summary }));
  }

  /**
   * 競争で、この案を採用する。ほかの候補は worktree とブランチごと破棄する
   * （採用した案は、これまでどおりマージ・PR の作成で取り込む）
   */
  async adoptCompetitor(id) {
    const c = this.must(id);
    if (!c.compete) throw new Error(tr('このタスクは競争のタスクではありません'));
    // 動いている候補も止めて破棄する（discard が止めるのを待つ）。もう取り込んだ（完了の）候補は削除できないので残す
    const others = this.competitors(id).filter((x) => x.id !== id && !this.isUndeletable(x));
    for (const x of others) await this.discard(x.id);
    c.compete = { ...c.compete, adopted: true, total: 1 };
    this.log(c, 'system',tr('この案（{whoLabel}）を採用しました。ほかの {length} 件の候補は破棄しました', { whoLabel: whoLabel(agentOf(c), c.persona), length: others.length }));
    this.changed(c);
    return others.length;
  }

  // 競争の候補を、エージェント（最初から選んでおくエージェント）に比べてもらう会話を作る
  compareCompetitors(id) {
    const list = this.competitors(id);
    if (list.length < 2) throw new Error(tr('比べる候補がありません'));
    const title = list[0].compete.title || list[0].title;
    const chat = this.createChat({ message: buildComparePrompt(title, list), title: tr('比較: {title}', { title }), agent: providers.defaultAgentOf(this.store.settings) });
    for (const x of list) x.compete.compareChat = chat.id;
    this.changed(chat);
    return chat;
  }

  /**
   * タスクに紐づかない会話（チャット）を作って、すぐに話し始める。
   * worktree もブランチも作らず、リポジトリのフォルダでそのままエージェントと話す（コミット・マージはしない）
   * @param {{ message: string, title?: string, session?: object, skill?: string, agent?: string }} p
   */
  createChat({ message, title, session, skill, agent, model, attachments: files }) {
    const s = this.store.settings;
    if (!s.repoPath) throw new Error(tr('先にリポジトリを選んでください'));
    const text = String(message || '').trim();
    if (!text) throw new Error(tr('メッセージを入力してください'));
    const parsed = attachments.parseAttachments(files);
    const custom = providers.isCustomRef(agent) ? this.customAgent(agent) : null;
    const a = custom ? custom.agent : agent || providers.defaultAgentOf(s);
    this.assertEnabled(a);
    const m = custom ? custom.model : cleanModel(model);
    const card = {
      id: crypto.randomBytes(4).toString('hex'),
      kind: 'chat',
      title: (title && title.trim()) || truncate(text.split('\n')[0], 40),
      prompt: text,
      status: 'todo',
      repoPath: s.repoPath,
      createdAt: Date.now(),
      permissions: [],
      alwaysAllow: [],
      logs: [],
      sessions: [],
      agent: a,
    };
    if (m) card.model = m;
    if (custom) card.persona = providers.personaOf(custom);
    // 既存の会話（Claude Code の会話）を引き継げるのは Claude Code だけ
    if (session && session.id && a === 'claude') this.applySession(card, session);
    card.skill = cleanSkill(skill);
    this.saveCardAttachments(card, parsed);
    this.store.cards.push(card);
    this.changed(card);
    this.start(card.id);
    return card;
  }

  /**
   * GitHub Issue の番号からカードを作る
   * @param {{ numbers: string, extra?: string }} p  numbers は「12」「12, 15」「#12 #15」など
   * @returns {Promise<{ cards: object[], errors: string[] }>}
   */
  async createFromIssues({ numbers, extra, session, skill, agent, model }) {
    const s = this.store.settings;
    if (!s.repoPath) throw new Error(tr('先にリポジトリを選んでください'));
    const list = github.parseIssueNumbers(numbers);
    const cards = [];
    const errors = [];
    for (const n of list) {
      const dup = this.store.cards.find((c) => c.repoPath === s.repoPath && c.issue && c.issue.number === n && c.status !== 'done');
      if (dup) {
        errors.push(tr('#{n}: もうタスクがあります（「{title}」）', { n, title: dup.title }));
        continue;
      }
      try {
        const issue = await this.fetchIssue(s.repoPath, n);
        if (issue.state && issue.state !== 'open') errors.push(tr('#{n} はクローズ済みですが、タスクを作りました', { n }));
        cards.push(...(await this.cardsFromIssue(issue, extra, { session, skill, agent, model })));
      } catch (err) {
        errors.push(`#${n}: ${err.message}`);
      }
    }
    if (!cards.length) throw new Error(errors.join('\n'));
    return { cards, errors };
  }

  // 読み込んだ Issue から、カードを作る（サブIssue があればサブタスクにする）。opts は createTask に渡す
  async cardsFromIssue(issue, extra, opts) {
    const made = this.createTask({ ...opts, title: `#${issue.number} ${issue.title}`, prompt: github.buildIssuePrompt(issue, extra), issue });
    if (made.length === 1 && this.canHaveSubtasks(made[0])) await this.addSubIssuesAsSubtasks(made[0], issue);
    return made;
  }

  // スケジュールの Issue の監視から呼ぶ。開いていないリポジトリにも作れる
  async createFromWatchedIssue(repoPath, number, extra, opts) {
    return this.cardsFromIssue(await this.fetchIssue(repoPath, number), extra, { ...opts, repoPath });
  }

  // テストで差し替えられるようにメソッドにしておく
  fetchIssue(repoPath, n, opts) {
    return github.fetchIssue(repoPath, n, opts);
  }

  listIssues(repoPath, filter) {
    return github.listIssues(repoPath, filter);
  }

  fetchSubIssues(repoPath, n) {
    return github.fetchSubIssues(repoPath, n);
  }

  createSubIssue(repoPath, parentNumber, issue) {
    return github.createSubIssue(repoPath, parentNumber, issue);
  }

  // Issue にサブIssue がぶら下がっていれば、開いているものをサブタスクにする（読めなければ、サブタスクなしのまま）
  async addSubIssuesAsSubtasks(c, issue) {
    let subs;
    try {
      subs = (await this.fetchSubIssues(c.repoPath, issue.number)).filter((x) => x.state !== 'closed');
    } catch (err) {
      this.log(c, 'system',tr('#{number} のサブIssue を読めなかったので、サブタスクなしで作りました（{v}）', { number: issue.number, v: err.message.split('\n')[0] }));
      this.changed(c);
      return;
    }
    if (!subs.length) return;
    const items = [];
    for (const x of subs.slice(0, Subtasks.MAX_SUBTASKS)) {
      let full = x;
      try {
        full = { ...x, ...(await this.fetchIssue(c.repoPath, x.number)) };
      } catch {
        /* 本文だけで作る */
      }
      items.push({ key: `issue-${x.number}`, title: `#${x.number} ${full.title}`, prompt: github.buildIssuePrompt(full), issue: { number: x.number, title: full.title, url: full.url || x.url } });
    }
    c.subtasks = { items: Subtasks.cleanItems(items).map((x) => ({ ...x, state: 'pending' })), merge: this.defaultSubtaskMerge(c), phase: 'plan' };
    this.log(c, 'system', tr('#{number} のサブIssue {n} 件（{list}）を、サブタスクにしました。開始すると、順番を決めてからサブタスクごとに動かします', { number: issue.number, n: c.subtasks.items.length, list: c.subtasks.items.map((x) => `#${x.issue.number}`).join(', ') }));
    this.changed(c);
  }

  // ---------- 会話（セッション） ----------

  // 起動時に claude から届いたセッション ID を、このカードの会話として記録する
  recordSession(c, id) {
    c.sessionId = id;
    c.forkNext = false;
    c.sessions = c.sessions || [];
    if (!c.sessions.some((x) => x.id === id)) {
      const from = c.sessions.find((x) => x.origin === 'imported' && !x.forkedTo);
      if (from) from.forkedTo = id;
      // Pipelineでは工程ごとにエージェントが変わるので、どのエージェントの会話かを残す
      const shown = Checkpoints.visiblePrompt(c.lastPromptSent || c.prompt);
      c.sessions.push({ id, at: Date.now(), origin: 'task', agent: agentOf(c), label: truncate(shown.split('\n').find((l) => l.trim()) || '', 60), from: from ? from.id : undefined });
    }
  }

  applySession(c, session) {
    if (!session || session.mode === 'new' || !session.id) {
      c.sessionId = null;
      c.forkNext = false;
      return;
    }
    assertSessionId(session.id);
    c.sessions = c.sessions || [];
    const own = c.sessions.find((x) => x.id === session.id && x.origin === 'task');
    // ほかのエージェントの会話は続けられない（Claude Code 以外は、このカードの会話だけ選べる）
    if (own ? (own.agent || 'claude') !== agentOf(c) : agentOf(c) !== 'claude') {
      throw new Error(tr('{agentLabel} では、この会話を続けられません', { agentLabel: agentLabel(agentOf(c)) }));
    }
    c.sessionId = session.id;
    c.forkNext = !own; // ほかの会話はフォーク、このカードの会話はそのまま続ける
    if (!own && !c.sessions.some((x) => x.id === session.id)) {
      c.sessions.push({ id: session.id, at: Date.now(), origin: 'imported', label: truncate(session.title || '', 60) });
    }
  }

  /**
   * 次に動かすときの会話を選ぶ
   * @param {{ mode: 'new' | 'resume', id?: string, title?: string }} session
   */
  setSession(id, session) {
    const c = this.must(id);
    if (c.status === 'running' || c.status === 'queued') throw new Error(tr('実行中・待機中は会話を切り替えられません'));
    this.applySession(c, session);
    const label = !c.sessionId ? tr('新しい会話') : c.forkNext ? tr('既存の会話（{name}）を引き継ぐ', { name: (session.title || session.id).slice(0, 40) }) : tr('このカードの会話 {id}', { id: c.sessionId.slice(0, 8) });
    this.log(c, 'system',tr('次の実行は「{label}」で始めます', { label }));
    this.changed(c);
  }

  // ---------- 会話（Claude Code のセッション）を消す ----------

  // カードが覚えている会話の ID（次に続ける会話・完了後の会話・これまでの会話）
  cardSessionIds(c) {
    return new Set([c.sessionId, c.afterDoneSession, ...(c.sessions || []).map((x) => x.id)].filter(Boolean));
  }

  /**
   * 会話ごとに、どのカードが使っているか
   * @returns {Map<string, Array<{ id: string, title: string, busy: boolean }>>}
   */
  sessionUsage() {
    const out = new Map();
    for (const c of this.store.cards) {
      const busy = c.status === 'running' || c.status === 'queued';
      for (const id of this.cardSessionIds(c)) {
        if (!out.has(id)) out.set(id, []);
        out.get(id).push({ id: c.id, title: c.title, busy });
      }
    }
    return out;
  }

  // Claude Code の設定フォルダ（WSL のリポジトリなら WSL の中の ~/.claude）。分からなければ既定の場所
  async claudeConfigDir(repoPath) {
    if (!this.opts.claudeConfigFor) return undefined;
    try {
      return (await this.opts.claudeConfigFor(repoPath)) || undefined;
    } catch {
      return undefined;
    }
  }

  // 消した会話をカードから外す（次に動かすときに、消した会話の続きにしようとしないように）
  forgetSessions(ids, except) {
    const gone = new Set(ids);
    for (const c of this.store.cards) {
      let touched = false;
      if (c.sessionId && gone.has(c.sessionId)) {
        c.sessionId = null;
        c.forkNext = false;
        touched = true;
      }
      if (c.afterDoneSession && gone.has(c.afterDoneSession)) {
        c.afterDoneSession = null;
        touched = true;
      }
      if ((c.sessions || []).some((x) => gone.has(x.id))) {
        c.sessions = c.sessions.filter((x) => !gone.has(x.id));
        touched = true;
      }
      if (touched && c !== except) this.changed(c);
    }
  }

  /**
   * タスクに関係なく、会話を選んで消す。実行中・待機中のカードが使っている会話は消さない
   * @param {string[]} ids
   * @returns {Promise<{ removed: string[], skipped: string[] }>}
   */
  async deleteSessions(ids, repoPath = this.store.settings.repoPath) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).filter(isSessionId))];
    if (!list.length) throw new Error(tr('消す会話を選んでください'));
    const usage = this.sessionUsage();
    const skipped = list.filter((id) => (usage.get(id) || []).some((u) => u.busy));
    const target = list.filter((id) => !skipped.includes(id));
    const removed = target.length ? require('./sessions').deleteSessions(target, { configDir: await this.claudeConfigDir(repoPath) }) : [];
    // ファイルが見つからなかった会話も、カードからは外しておく（もう続けられないので）
    this.forgetSessions(target);
    this.store.save();
    return { removed, skipped };
  }

  /**
   * マージして完了したタスクの、作業中の会話を消す（設定でオフにできる）。
   * 引き継いだ元の会話（ターミナルの会話など）と、完了後に話した会話は残す。Claude Code の会話だけが対象
   */
  async deleteTaskSessions(c) {
    if (this.store.settings.deleteSessionsOnMerge === false || isChat(c)) return;
    const keep = new Set([c.afterDoneSession].filter(Boolean));
    // ほかのカードが使っている会話（このタスクから作った修正タスクが引き継いだものなど）も残す
    for (const o of this.store.cards) if (o !== c) for (const id of this.cardSessionIds(o)) keep.add(id);
    const ids = (c.sessions || []).filter((x) => x.origin === 'task' && (x.agent || 'claude') === 'claude' && isSessionId(x.id) && !keep.has(x.id)).map((x) => x.id);
    if (!ids.length) return;
    try {
      const removed = require('./sessions').deleteSessions(ids, { configDir: await this.claudeConfigDir(c.repoPath) });
      this.forgetSessions(ids, c);
      if (removed.length) this.log(c, 'system',tr('マージしたので、このタスクの会話（{length} 件）を消しました', { length: removed.length }));
    } catch (err) {
      this.log(c, 'error',tr('会話を消せませんでした: {message}', { message: err.message }));
    }
  }

  commitMessage(c) {
    return c.issue ? `agent: ${c.title.replace(/^#\d+\s*/, '')} (#${c.issue.number})` : `agent: ${c.title}`;
  }

  updateCard(id, { title, prompt, skill }) {
    const c = this.must(id);
    if (c.status !== 'todo') throw new Error(tr('開始前のタスクだけ編集できます'));
    if (skill !== undefined) c.skill = cleanSkill(skill);
    if (typeof title === 'string' && title.trim()) c.title = title.trim();
    if (typeof prompt === 'string' && prompt.trim()) c.prompt = prompt.trim();
    this.changed(c);
  }

  start(id) {
    const c = this.must(id);
    if (c.status !== 'todo') throw new Error(tr('このタスクはもう開始しています'));
    this.log(c, 'user', c.prompt, userLogExtra(c.skill, c.attachments, c.attachmentsParsed));
    delete c.attachmentsParsed;
    if (inSpecCheck(c) && this.store.repoSettings(c.repoPath).specCheck === false) c.specState = null; // 作ったあとで設定を切った
    this.enqueue(c, this.firstPrompt(c), c.attachments);
  }

  send(id, message, skill, files) {
    const c = this.must(id);
    this.assertNotRewinding(c);
    if (!['review', 'failed', 'done'].includes(c.status)) throw new Error(tr('実行中・待機中は追加指示を送れません'));
    if (!message || !message.trim()) throw new Error(tr('追加指示を入力してください'));
    if (c.relay && c.relay.waiting) throw new Error(c.conflict ? tr('合流でのコンフリクトを、上の「コンフリクト」の欄から解消してください') : tr('Pipelineの並列の枝が終わるのを待っています。直したいときは、枝のタスクに追加指示を送ってください'));
    if (c.subtasks && c.subtasks.phase === 'run') throw new Error(c.conflict ? tr('サブタスクのマージでのコンフリクトを、上の「コンフリクト」の欄から解消してください') : tr('サブタスクが終わるのを待っています。直したいときは、サブタスクに追加指示を送ってください'));
    if (c.subtaskProposal) c.subtaskProposal = null; // 提案に文章で答えた: 提案は閉じて、エージェントに任せる
    skill = cleanSkill(skill);
    const parsed = attachments.parseAttachments(files);
    const atts = attachments.saveAttachments(this.attachRoot, c.id, parsed);
    if (c.status === 'done' && !isChat(c)) return this.sendAfterDone(c, message.trim(), skill, atts, parsed);
    this.log(c, 'user', message.trim(), userLogExtra(skill, atts, parsed));
    // 仕様の確認中の答えには、続けて判断してもらうための一言を添える
    const body = this.withAttachments(c, inSpecCheck(c) ? `${message.trim()}\n\n${SPEC_FOLLOW_NOTE}` : message.trim(), atts);
    this.enqueue(c, promptWithSkill(agentOf(c), skill, body), atts);
  }

  // 添付を、このカードの置き場所に保存してカードに記録する（最初の指示の添付）
  saveCardAttachments(card, parsed) {
    if (!parsed || !parsed.length) return;
    card.attachments = attachments.saveAttachments(this.attachRoot, card.id, parsed);
    // 最初のログに画像を出すときに読み直さないよう、start まで中身を持っておく（保存はしない）
    Object.defineProperty(card, 'attachmentsParsed', { value: parsed, enumerable: false, configurable: true, writable: true });
  }

  // 指示に、添付ファイルのパスを書き足す（エージェントから見えるパスで）
  withAttachments(c, text, atts) {
    if (!atts || !atts.length) return text;
    const w = wsl.parseWslPath(c.repoPath || '');
    return attachments.withAttachmentNote(text, atts, { toAgentPath: w ? (p) => wsl.toLinux(p) : undefined, inlineImages: agentOf(c) === 'claude' });
  }

  /**
   * スキルにしておくとよいものを提案してもらう。
   * 元のタスクのカードは使い回さず（完了したタスクを開き直したり、worktree を作り直したりしない）、
   * 新しい会話のカードを作って、元のタスクの中身を渡して提案してもらう
   * @returns {object} 作った会話のカード
   */
  suggestSkills(id) {
    const src = this.must(id);
    const similar = (src.skillSuggestSimilar || []).map((x) => this.store.card(x)).filter(Boolean);
    const chat = this.createChat({ message: buildSkillSuggestPrompt(src, similar), title: tr('スキルの提案: {title}', { title: src.title }), agent: this.helperAgent(src) });
    chat.skillSuggestFrom = src.id;
    // 提案に使ったタスクは、あとで似たタスクが完了しても、もう一度は数えない（同じ提案を何度も出さない）
    const now = Date.now();
    for (const x of [src, ...similar]) x.skillSuggestedAt = now;
    for (const n of this.store.notifications) {
      if (n.cardId === id && n.action === 'suggestSkills' && !n.actedAt) {
        n.actedAt = Date.now();
        n.read = true;
      }
    }
    this.changed(chat);
    return chat;
  }

  /**
   * 完了（マージ済み）のタスクについて話す。タスクは開き直さない（レビューに戻さず、マージもできない）。
   * worktree は作り直さずにリポジトリのフォルダで、計画モード（ファイルを変えない）で動かす。
   * 最初は新しい会話で始めて元のタスクの中身を渡し、2回目からはその会話の続きにする。
   * 修正が必要なときは「修正タスクを作る」で別のタスクにしてもらう
   */
  sendAfterDone(c, message, skill, atts, parsed) {
    const first = !c.afterDoneSession;
    if (first) this.log(c, 'system',tr('完了したタスクについて話します（ファイルは変えません。修正が必要なときは「修正タスクを作る」から別のタスクにしてください）'));
    this.log(c, 'user', message, userLogExtra(skill, atts, parsed));
    // 前の作業の会話は worktree のフォルダに保存されているので使わない。完了後の会話はその会話だけを続ける
    c.sessionId = c.afterDoneSession || null;
    c.forkNext = false;
    c.afterDone = true;
    this.enqueue(c, promptWithSkill(agentOf(c), skill, this.withAttachments(c, first ? buildAfterDonePrompt(c, message) : message, atts)), atts);
  }

  // atts: この指示に添付したファイル（Claude Code には画像をそのまま渡す。パスは prompt に書いてある）
  enqueue(c, prompt, atts) {
    if (this.shuttingDown) throw new Error(tr('アプリを終了しています'));
    c.pendingAttachments = atts && atts.length ? atts : null;
    c.interrupted = null;
    c.awaitingReply = false;
    c.lastText = '';
    c.lastSpecUnclear = false;
    c.specQuestions = null;
    c.lastSubtaskPlan = null;
    c.lastSubtasksMarked = false;
    c.pendingPrompt = prompt;
    c.status = 'queued';
    c.queuedAt = Date.now();
    c.error = null;
    this.changed(c);
    this.pump();
  }

  // 同時実行数の上限まで、待機中のカードを起動する
  pump() {
    if (this.shuttingDown) return; // 終了中は新しく起動しない（待機中のまま保存し、次の起動で再開できるようにする）
    const max = Math.max(1, Number(this.store.settings.maxParallel) || 1);
    // 会話（チャット）は軽いので、同時実行数に数えずすぐに動かす（タスクが詰まっていても返事が来るように）
    let running = this.store.cards.filter((c) => c.status === 'running' && !isChat(c)).length;
    const queued = this.store.cards.filter((c) => c.status === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
    for (const c of queued) {
      if (!isChat(c)) {
        if (running >= max) continue;
        running++;
      }
      c.status = 'running';
      c.startedAt = Date.now();
      // Pipeline: 今の工程を最初に始めた時刻（追加指示で続けたときは変えない）
      if (c.relay && !isChat(c) && !c.relay.stepStartedAt) c.relay.stepStartedAt = c.startedAt;
      this.changed(c);
      this.launch(c).catch((err) => this.fail(c, err.message));
    }
  }

  fail(c, msg) {
    this.procs.delete(c.id);
    if (!this.store.card(c.id)) return;
    // 完了したタスクについての会話は、失敗しても「完了」のまま（レビューやエラーの列に戻さない）
    const afterDone = !!c.afterDone;
    c.afterDone = false;
    c.status = afterDone ? 'done' : 'failed';
    c.error = msg;
    if (isChat(c)) c.unread = true;
    this.log(c, 'error', msg);
    this.dropFollowBtw(c);
    this.changed(c);
    this.pump();
  }

  stop(id) {
    const c = this.must(id);
    if (c.status === 'queued') {
      if (c.afterDone) {
        c.afterDone = false;
        c.status = 'done';
      } else c.status = hasWorkplace(c) ? 'review' : 'todo';
      this.changed(c);
      return;
    }
    const child = this.procs.get(id);
    if (!child) {
      // エージェントの開始前にセットアップスクリプトが動いているところ
      const run = this.scriptRuns.get(id);
      if (run?.running && run.auto) {
        run.handle.stop();
        return;
      }
      throw new Error(tr('実行中ではありません'));
    }
    c.stopRequested = true;
    this.denyAllPending(id, tr('停止されました'));
    killTree(child);
  }

  stopAll() {
    for (const [id, child] of this.procs) {
      const c = this.store.card(id);
      if (c) c.stopRequested = true;
      killTree(child);
    }
  }

  // ---------- worktree と claude の起動 ----------

  async prepareWorktree(c) {
    const top = await git.toplevel(c.repoPath);
    if (!top) throw new Error(tr('{repoPath} は git リポジトリではありません', { repoPath: c.repoPath }));
    const reopen = c.reopenBase && (await git.branchExists(top, c.reopenBase)) ? c.reopenBase : null;
    // Pipelineの並列の枝は、親のカードのブランチから分ける
    if (c.flowBase && !(await git.branchExists(top, c.flowBase))) throw new Error(tr('並列の枝を分ける元のブランチ {flowBase} が見つかりません', { flowBase: c.flowBase }));
    const base = c.flowBase || reopen || this.store.repoSettings(c.repoPath).baseBranch || (await git.currentBranch(top));
    if (base === 'HEAD') throw new Error(tr('ベースブランチが決まりません（detached HEAD）。設定でベースブランチを指定してください'));
    const baseCommit = await git.revParse(top, base);
    let branch = c.issue ? `agent/issue-${c.issue.number}-${c.id}` : `agent/${slugify(c.title)}-${c.id}`;
    const rule = c.flowBase ? '' : String(this.store.repoSettings(c.repoPath).branchNamingRule || '').trim(); // 並列の枝は、あとでマージして消すのでいつもの名前
    if (rule) {
      // 続きのときは前と同じ名前から番号を付けていく
      const prev = c.reopenFrom !== undefined && c.namedBranch ? c.namedBranch : null;
      try {
        const named = prev || (await this.generateBranchName(c, rule, top));
        await git.checkBranchName(top, named);
        branch = named;
        c.namedBranch = named;
      } catch (err) {
        this.log(c, 'error',tr('命名規則からブランチ名を決められなかったので、いつもの名前にします: {message}', { message: err.message }));
      }
    }
    if (c.namedBranch && branch === c.namedBranch && c.reopenFrom === undefined) {
      // 命名規則の名前がもう使われていたら、番号を付けてぶつからないようにする
      const stem = branch;
      for (let n = 2; await git.branchExists(top, branch); n++) branch = `${stem}-${n}`;
    }
    if (c.reopenFrom !== undefined) {
      // 続きのときは、前のブランチ（origin に PR として残っていることもある）とぶつからない名前にする
      const stem = branch;
      for (let n = 2; (c.prUrl && n === 2) || (await git.branchExists(top, branch)); n++) branch = `${stem}-${n}`;
    }
    const wt = path.join(path.dirname(top), `${path.basename(top)}.worktrees`, c.id);
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    if (fs.existsSync(wt)) await git.removeWorktree(top, wt);
    await git.addWorktree(top, wt, branch, baseCommit);
    Object.assign(c, { worktreePath: wt, branch, baseBranch: base, baseCommit });
    if (c.reopenFrom !== undefined) {
      // 前の PR はもう片付いたものとして、次は新しい PR を作る
      c.prUrl = null;
      c.prState = null;
      c.prMergedAt = null;
      c.prCheckError = null;
      c.prMergeable = null;
      c.prChecks = null;
      c.ciFix = null;
      c.finalDiff = null;
      delete c.reopenBase;
      delete c.reopenFrom;
    }
    this.log(c, 'system',tr('worktree を作成しました: {wt}（ブランチ {branch} / ベース {base}）', { wt, branch, base }));
    await this.ensureDevPort(c);
    c.setupPending = !!this.scriptOf(c, 'setup');
    this.changed(c);
    await this.ensureSetup(c);
  }

  // ---------- worktree のスクリプト（セットアップ・片付け・実行） ----------

  scriptOf(c, kind) {
    return cleanScript(this.store.repoSettings(c.repoPath)[SCRIPT_SETTINGS[kind]]);
  }

  scriptEnv(c) {
    const p = (dir) => (wsl.isWslPath(dir) ? wsl.toLinux(dir) : dir);
    return {
      WORKTREE_KANBAN_ROOT: p(c.repoPath),
      WORKTREE_KANBAN_WORKTREE: p(c.worktreePath),
      WORKTREE_KANBAN_BRANCH: c.branch || '',
      WORKTREE_KANBAN_BASE_BRANCH: c.baseBranch || '',
      WORKTREE_KANBAN_TASK_ID: c.id,
      ...this.portEnv(c),
    };
  }

  // ---------- タスクごとのポート（worktree はファイルしか分けないので、開発サーバーがぶつからないように分ける） ----------

  portEnv(c) {
    if (!c.devPort) return {};
    return { WORKTREE_KANBAN_PORT: String(c.devPort), PORT: String(c.devPort) };
  }

  // 空いているポートの組をタスクに割り当てる。一度決めたら、worktree を消すまで変えない
  async ensureDevPort(c) {
    const taken = (port) => this.store.cards.some((o) => o.devPort === port);
    for (let port = PORT_START; port + PORT_COUNT <= PORT_END && !c.devPort; port += PORT_COUNT) {
      if (taken(port) || !(await portsFree(port))) continue;
      // 確かめているあいだに、同じ番号を別のタスクが取っていることがある
      if (!c.devPort && !taken(port)) c.devPort = port;
    }
    if (!c.devPort) this.log(c, 'error', tr('開発サーバーのポートに空きがないので、PORT を渡さずに動かします'));
  }

  // 1つのタスクで同時に動かすスクリプトは1つだけ（出力の表示も1つ）
  execScript(c, kind, script, { auto = false, timeoutMs = 0 } = {}) {
    const run = { kind, auto, running: true, output: '', startedAt: Date.now(), endedAt: null, code: null, signal: null, stopped: false, timedOut: false, error: null };
    run.handle = startScript({ cwd: c.worktreePath, script, env: this.scriptEnv(c), timeoutMs, onOutput: (text) => (run.output = appendOutput(run.output, text)) });
    this.scriptRuns.set(c.id, run);
    return run.handle.done.then((r) => {
      Object.assign(run, r, { running: false, endedAt: Date.now() });
      return run;
    });
  }

  async stopRunningScript(id) {
    const run = this.scriptRuns.get(id);
    if (run?.running) await run.handle.stop();
  }

  // セットアップが済んでいなければ動かす。失敗したら throw して、エージェントを始めない（タスクはエラーになる）
  async ensureSetup(c) {
    if (!c.setupPending) return;
    const script = this.scriptOf(c, 'setup');
    if (!script) {
      delete c.setupPending;
      return;
    }
    await this.stopRunningScript(c.id);
    await this.ensureDevPort(c);
    this.log(c, 'system', tr('セットアップスクリプトを実行します'));
    this.changed(c);
    const run = await this.execScript(c, 'setup', script, { auto: true });
    if (!scriptPassed(run)) throw new Error(tr('セットアップスクリプトが失敗したので、エージェントは開始していません（{reason}）。\n{output}', { reason: scriptFailReason(run), output: run.output.slice(-2000).trim() }));
    delete c.setupPending;
    this.log(c, 'system', tr('セットアップスクリプトが終わりました'));
    this.changed(c);
  }

  // 片付けスクリプトを動かしてから worktree を消す。片付けが失敗しても worktree は消す
  async removeWorktreeOf(c, top) {
    await this.stopRunningScript(c.id);
    const script = this.scriptOf(c, 'teardown');
    if (script && fs.existsSync(c.worktreePath)) {
      this.log(c, 'system', tr('片付けスクリプトを実行します'));
      const run = await this.execScript(c, 'teardown', script, { auto: true, timeoutMs: this.opts.teardownTimeoutMs || TEARDOWN_TIMEOUT_MS });
      if (scriptPassed(run)) this.log(c, 'system', tr('片付けスクリプトが終わりました'));
      else this.log(c, 'error', tr('片付けスクリプトが失敗しましたが、worktree は消します（{reason}）。\n{output}', { reason: scriptFailReason(run), output: run.output.slice(-2000).trim() }));
    }
    await git.removeWorktree(top, c.worktreePath);
    this.scriptRuns.delete(c.id);
    delete c.devPort; // 次のタスクが使えるように返す
  }

  scriptState(id) {
    const c = this.must(id);
    const scripts = Object.fromEntries(SCRIPT_KINDS.map((k) => [k, !!this.scriptOf(c, k)]));
    const r = this.scriptRuns.get(id);
    const run = r ? { kind: r.kind, auto: r.auto, running: r.running, output: r.output, startedAt: r.startedAt, endedAt: r.endedAt, code: r.code, stopped: r.stopped, timedOut: r.timedOut, error: r.error } : null;
    return { scripts, run, port: c.devPort || null, portCount: PORT_COUNT };
  }

  // 画面のボタンから動かす。終わるのは待たない（出力と結果は scriptState で見る）
  async startScriptNow(id, kind) {
    const c = this.must(id);
    if (!SCRIPT_KINDS.includes(kind)) throw new Error(tr('スクリプトの種類が正しくありません'));
    if (isChat(c) || isNoGit(c) || !c.worktreePath || !fs.existsSync(c.worktreePath)) throw new Error(tr('worktree がありません'));
    const script = this.scriptOf(c, kind);
    if (!script) throw new Error(tr('スクリプトが設定されていません'));
    await this.ensureDevPort(c); // この機能より前に作った worktree には、まだ割り当てがない
    if (this.merging?.has(id)) throw new Error(tr('処理中です'));
    if (this.scriptRuns.get(id)?.running) throw new Error(tr('ほかのスクリプトが動いています'));
    this.execScript(c, kind, script).then((run) => {
      if (kind !== 'setup' || !scriptPassed(run) || !this.store.card(id)) return;
      // 手で直してセットアップが通ったら、再開したときにもう一度は動かさない
      delete c.setupPending;
      this.changed(c);
    });
    return this.scriptState(id);
  }

  async stopScriptNow(id) {
    await this.stopRunningScript(this.must(id).id);
    return this.scriptState(id);
  }

  /**
   * 設定の命名規則（自然言語）に従ったブランチ名を、カードのエージェントに1回だけ聞いて決める
   * @returns {Promise<string>}
   */
  async generateBranchName(c, rule, cwd) {
    this.log(c, 'system',tr('命名規則に従ってブランチ名を {agentShort} に考えてもらっています…', { agentShort: agentShort(agentOf(c)) }));
    const out = await this.askOnce(agentOf(c), cwd, buildBranchNamePrompt(rule, c), c.model);
    const name = cleanBranchName(out);
    if (!name) throw new Error(tr('ブランチ名が返ってきませんでした'));
    return name;
  }

  /**
   * エージェントに1回だけ質問して、返事の文章を返す（ファイルは変えさせない）
   * @param {string} agent
   * @param {string} cwd
   * @param {string} prompt
   * @param {string} [model]  使うモデル（なければ設定の既定）
   * @param {number} [timeoutMs]  待つ時間の上限
   * @returns {Promise<string>}
   */
  async askOnce(agent, cwd, prompt, model, timeoutMs = 120000) {
    const s = this.store.settings;
    let args;
    let parser = null;
    if (agent === 'claude') {
      args = ['-p', '--output-format', 'text', '--permission-mode', 'default'];
      const m = model || s.model;
      if (m) args.push('--model', m);
    } else {
      args = providers.buildArgs(agent, { mode: 'plan', model: model || providers.agentModel(s, agent), prompt });
      parser = providers.createParser(agent, { summarize: summarizeInput });
    }
    const child = await this.spawnAgent(agent, cwd, args);
    return new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      let buf = '';
      const texts = [];
      let resultError = null;
      const take = (actions) => {
        for (const a of actions) {
          if (a.type === 'text') texts.push(String(a.text));
          else if (a.type === 'result' && a.error) resultError = a.error;
        }
      };
      const line = (l) => {
        if (!l.trim()) return;
        try {
          take(parser.onEvent(JSON.parse(l)));
        } catch {
          /* JSON でない行は読み飛ばす */
        }
      };
      const timer = setTimeout(() => {
        killTree(child);
        reject(new Error(tr('時間がかかりすぎました')));
      }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => {
        if (!parser) return void (out += d);
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          line(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => (err += d));
      child.stdin.on('error', () => {});
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e.code === 'ENOENT' ? new Error(notFoundMessage(child.agentCmd, agent)) : e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (parser) {
          line(buf);
          take(parser.flush());
          out = texts.join('\n');
        }
        if (code !== 0 || resultError) return reject(new Error(truncate(resultError || err.trim() || out.trim() || tr('{cmd} が終了コード {code} で終わりました', { cmd: child.agentCmd, code }), 300)));
        resolve(out);
      });
      // 指示を引数で渡した CLI（Cursor）には、stdin は空のまま閉じる
      child.stdin.end(agent !== 'claude' && providers.promptViaArg(agent) ? '' : prompt);
    });
  }

  writeMcpConfig(c, wslDistro) {
    if (!this.permission) return null;
    // 承認サーバーのトークンを含むので、自分だけが読めるようにする
    fs.mkdirSync(this.opts.mcpDir, { recursive: true, mode: 0o700 });
    if (!isWin) fs.chmodSync(this.opts.mcpDir, 0o700);
    const file = path.join(this.opts.mcpDir, `${c.id}.json`);
    const config = {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'stdio',
          // WSL の中の claude からは、Windows 側のアプリ（/mnt/c/...exe）を呼ぶ。
          // Windows のプログラムには WSLENV に書いた環境変数だけが渡るので、ここに並べる
          command: wslDistro ? wsl.toLinux(this.opts.nodeBin) : this.opts.nodeBin,
          // 2つ目はこの設定ファイル。WSL から Windows のアプリを呼ぶと env（WSLENV）が届かないことがあるので、
          // そのときはここからポート・トークンを読む（トークンはコマンドラインに出さない）。
          // WSL でも Windows のアプリが読むので、Windows のパスのまま渡す
          args: [this.opts.mcpScript, file],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            KANBAN_PORT: String(this.permission.port),
            KANBAN_TOKEN: this.permission.token,
            KANBAN_CARD: c.id,
            KANBAN_LANGUAGE: I18n.getLanguage(),
            ...(wslDistro ? { WSLENV: 'ELECTRON_RUN_AS_NODE/u:KANBAN_PORT/u:KANBAN_TOKEN/u:KANBAN_CARD/u:KANBAN_LANGUAGE/u' } : {}),
          },
        },
      },
    };
    fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
    if (!isWin) fs.chmodSync(file, 0o600);
    return file;
  }

  /**
   * claude を起動する。WSL のフォルダなら、WSL の中の claude を動かす
   * @param {string} cwd
   * @param {string[]} args
   * @param {Record<string,string>} extraEnv
   */
  spawnClaude(cwd, args, extraEnv = {}) {
    return this.spawnAgent('claude', cwd, args, extraEnv);
  }

  // エージェントの CLI を起動する（Claude Code / Codex / Gemini / Cursor）。child.agentCmd に起動したコマンドの名前を入れる
  async spawnAgent(agent, cwd, args, extraEnv = {}) {
    const s = this.store.settings;
    const w = wsl.parseWslPath(cwd);
    if (w) {
      // Windows のパス（MCP の設定ファイルなど）は、WSL の中から見えるパス（/mnt/c/...）にして渡す
      const mapped = args.map((a) => (/^[A-Za-z]:[\\/]/.test(a) || wsl.isWslPath(a) ? wsl.toLinux(a) : a));
      // 設定のパスは Windows 側のものなので、WSL の中では Claude 以外はコマンド名で探す
      const cmd = agent === 'claude' ? s.wslClaudePath || 'claude' : providers.AGENTS[agent].defaultCmd;
      const cm = wsl.command(w.distro, w.linux, cmd, mapped, { path: await wsl.shellPath(w.distro), env: extraEnv });
      const child = spawn(cm.file, cm.args, { env: process.env, windowsHide: true });
      child.viaWsl = w.distro;
      child.agentCmd = cmd;
      return child;
    }
    const cmd = providers.agentCommand(s, agent);
    const resolved = resolveCommand(cmd);
    if (!resolved) throw Object.assign(new Error(notFoundMessage(cmd, agent)), { code: 'ENOENT' });
    // Windows の .cmd / .bat はシェル経由でしか起動できない。.exe は直接起動する
    const useShell = isWin && /\.(cmd|bat)$/i.test(resolved);
    const child = spawn(useShell ? quoteForCmd(resolved) : resolved, useShell ? args.map(quoteForCmd) : args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      shell: useShell,
      windowsHide: true,
    });
    child.agentCmd = cmd;
    return child;
  }

  // 会話（チャット）の権限モード。リポジトリのフォルダ（手元の作業中のファイル）でそのまま動くので、
  // ファイルの変更やコマンドは毎回カードで確かめる（「計画だけ」「すべて自動で許可」を選んでいればそれに従う）
  chatPermissionMode(mode) {
    return mode === 'plan' || mode === 'bypassPermissions' ? mode : 'default';
  }

  // ソースを変更しないタスクの権限モード。リポジトリのフォルダ（手元の作業中のファイル）で動くので、
  // Claude Code はファイルを書き換えるツールを止めたうえで、コマンドは毎回カードで確かめる（「計画だけ」ならそれに従う）。
  // Codex / Gemini / Cursor はツールを個別に止められないので、読み取りだけの「計画」モードで動かす
  readOnlyPermissionMode(agent, mode) {
    if (agent !== 'claude') return 'plan';
    return mode === 'plan' ? 'plan' : 'default';
  }

  // エージェントを起動する直前の状態を1件記録する。戻すときの時点になる
  async recordCheckpoint(c, recorded) {
    // recorded があるときは、引き継ぎ文を付けた送信文ではなく、戻した時点の指示を記録する
    const prompt = recorded ? recorded.prompt : (c.pendingPrompt || '');
    const handoffRun = !!(recorded && recorded.handoff);
    if (prompt === RESUME_PROMPT || prompt === CHAT_RESUME_PROMPT || prompt === FOLDER_RESUME_PROMPT) return;
    if (!Checkpoints.shouldRecord(c)) return;
    let commit = null;
    if (!isChat(c) && !isNoGit(c) && c.worktreePath) {
      // 手で直した未コミットの変更を、戻す先のコミットに含める。
      // マージや rebase の途中ではコミットしない（git add -A が未マージのファイルを解消済みにして、マーカーのままマージコミットになる）。HEAD だけ記録する
      const op = await git.operationInProgress(c.worktreePath);
      if (!op && (await git.isDirty(c.worktreePath, { untracked: true }))) await git.commitAll(c.worktreePath, this.commitMessage(c));
      commit = await git.revParse(c.worktreePath, 'HEAD');
    }
    const session = await this.checkpointSession(c);
    const prev = c.checkpoints || [];
    const cp = Checkpoints.create({
      seq: prev.reduce((m, x) => Math.max(m, Number(x.seq) || 0), 0) + 1,
      prompt,
      attachments: c.pendingAttachments,
      label: Checkpoints.labelFor(c, prompt),
      commit,
      session,
      forkNext: !!c.forkNext,
      handoff: handoffRun,
      agent: agentOf(c),
      model: c.model || null,
      persona: c.persona,
      specState: c.specState,
      relay: Checkpoints.relaySnapshot(c.relay),
      stepStart: Checkpoints.stepStart(c),
    });
    c.checkpoints = Checkpoints.trim([...prev, cp]);
  }

  async checkpointSession(c) {
    if (!c.sessionId || !isSessionId(c.sessionId)) return null;
    if (agentOf(c) !== 'claude') return { id: c.sessionId };
    const sessions = require('./sessions');
    const size = sessions.sessionSize(c.sessionId, { configDir: await this.claudeConfigDir(c.repoPath) });
    return typeof size === 'number' ? { id: c.sessionId, size } : { id: c.sessionId };
  }

  // このカード以外が、その会話を使っているか（切り詰めると相手の続きが壊れる）
  sessionUsedByOther(c, id) {
    if (!id) return false;
    for (const o of this.store.cards) {
      if (!o || o.id === c.id) continue;
      if (this.cardSessionIds(o).has(id)) return true;
    }
    return false;
  }

  /**
   * チェックポイントの時点へ戻し、そのときの指示でもう一度動かす。
   * ファイルの戻しに失敗したときは、カードを変えずにエラーにする
   */
  async rewind(id, checkpointId) {
    const c = this.must(id);
    if (this.rewinding.has(id)) throw new Error(tr('戻しているところです'));
    const reason = Checkpoints.blockReason(c, this.rewindContext(c));
    if (reason) throw new Error(reason);
    const list = c.checkpoints || [];
    const idx = list.findIndex((x) => x && x.id === checkpointId);
    if (idx < 0) throw new Error(tr('戻す時点が見つかりません'));
    const cp = list[idx];
    this.rewinding.add(id);
    let applied = false;
    try {
      await this.restoreFiles(c, cp);
      let plan;
      try {
        plan = await this.planConversation(c, cp);
      } catch {
        // ファイルは戻し済み。会話の準備に失敗しても、カードを古い状態のまま残さない
        plan = { sessionId: null, forkNext: false, handoff: true };
      }
      let prompt = cp.prompt || '';
      if (plan.handoff) {
        const text = Checkpoints.handoffText(c.logs, { before: cp.at, omitLatestUser: true });
        if (text) prompt = `${text}${prompt}`;
      }
      this.applyRewind(c, cp, idx, plan);
      applied = true;
      // 次のチェックポイントには、引き継ぎ文を除いた元の指示を残す
      c.rewindPrompt = cp.prompt || '';
      c.rewindHandoff = !!plan.handoff;
      this.enqueue(c, prompt, cp.attachments || undefined);
    } finally {
      this.rewinding.delete(id);
    }
    // 戻しているあいだの印を外した状態を、画面に渡す
    if (applied) this.changed(c);
  }

  // ファイルを戻す。失敗したら例外（カードはまだ変えない）
  async restoreFiles(c, cp) {
    if (!cp.commit) throw new Error(tr('戻す時点のコミットがありません'));
    const wt = c.worktreePath;
    if (!(await git.commitExists(wt, cp.commit))) throw new Error(tr('戻す時点のコミットが見つかりません'));
    const branch = await git.currentBranch(wt);
    if (branch !== c.branch) throw new Error(tr('worktree のブランチがタスクのブランチと違うので戻せません'));
    const op = await git.operationInProgress(wt);
    if (op) throw new Error(tr('git の操作（{op}）が途中なので戻せません', { op }));
    await git.resetHardClean(wt, cp.commit);
  }

  // 会話の戻し方。ファイルを切り詰めるのは、条件がすべて揃った Claude の会話だけ
  async planConversation(c, cp) {
    const sess = cp.session;
    // 会話が無いときは、新しく始める。直前の実行が引き継ぎ文で始まっていたときだけ、ログから作り直す
    if (!sess || !sess.id) return { sessionId: null, forkNext: false, handoff: !!cp.handoff };
    if (cp.forkNext) return { sessionId: sess.id, forkNext: true, handoff: false };
    if ((cp.agent || 'claude') === 'claude' && typeof sess.size === 'number' && !this.sessionUsedByOther(c, sess.id)) {
      const sessions = require('./sessions');
      const ok = sessions.truncateSession(sess.id, sess.size, { configDir: await this.claudeConfigDir(c.repoPath) });
      if (ok) return { sessionId: sess.id, forkNext: false, handoff: false };
    }
    return { sessionId: null, forkNext: false, handoff: true };
  }

  applyRewind(c, cp, idx, plan) {
    c.agent = cp.agent || agentOf(c);
    if (cp.model) c.model = cp.model;
    else delete c.model;
    if (cp.persona) c.persona = { ...cp.persona };
    else delete c.persona;
    if (cp.specState) c.specState = cp.specState;
    else delete c.specState;
    delete c.todos;
    delete c.subtaskProposal;
    delete c.btw;
    delete c.lastMessage;
    c.sessionId = plan.sessionId;
    c.forkNext = !!plan.forkNext;
    c.stopRequested = false;
    if (c.relay && cp.relay) Checkpoints.applyRelay(c.relay, cp.relay);
    c.logs = (c.logs || []).filter((l) => typeof l.t === 'number' && l.t < cp.at);
    c.checkpoints = (c.checkpoints || []).slice(0, idx);
    c.logsVersion = (c.logsVersion || 0) + 1;
    // 実際に使った金額は戻さない
    this.log(c, 'system', tr('「{label}」の時点に戻しました。続きを自動で始めます', { label: cp.label || String(cp.seq || '') }));
  }

  async launch(c) {
    // 起動が worktree 作成で失敗しても、戻す用の指示を次の実行へ持ち越さない
    const recorded = c && Object.prototype.hasOwnProperty.call(c, 'rewindPrompt')
      ? { prompt: c.rewindPrompt || '', handoff: !!c.rewindHandoff }
      : null;
    if (c) {
      delete c.rewindPrompt;
      delete c.rewindHandoff;
    }
    const chat = isChat(c);
    // 完了したタスクについての会話: worktree は作らずリポジトリのフォルダで、ファイルを変えない計画モードで動かす
    const afterDone = !chat && !!c.afterDone;
    // git で管理していないフォルダは、worktree を作らずにそのフォルダでそのまま動かす
    const inFolder = chat || afterDone || isNoGit(c);
    if (inFolder) {
      if (!c.repoPath || !fs.existsSync(c.repoPath)) throw new Error(isNoGit(c) ? tr('フォルダが見つかりません: {path}', { path: c.repoPath }) : tr('リポジトリのフォルダが見つかりません: {path}', { path: c.repoPath }));
    } else if (!c.worktreePath || !fs.existsSync(c.worktreePath)) await this.prepareWorktree(c);
    else {
      await this.ensureDevPort(c); // この機能より前に作った worktree には、まだ割り当てがない
      await this.ensureSetup(c); // 前回セットアップが失敗したタスクをやり直すとき
    }
    const cwd = inFolder ? c.repoPath : c.worktreePath;
    // 起動直前の状態を記録する。pendingPrompt を消す前、会話の引き継ぎを変える前
    await this.recordCheckpoint(c, recorded);
    const s = this.store.settings;
    const rs = this.store.repoSettings(c.repoPath); // 権限モード・許可しておくツールは、そのタスクのプロジェクトの設定
    const agent = agentOf(c);
    const label = agentLabel(agent);
    const mode = afterDone ? 'plan' : chat ? this.chatPermissionMode(rs.permissionMode) : c.readOnly ? this.readOnlyPermissionMode(agentOf(c), rs.permissionMode) : rs.permissionMode;
    const prompt = c.pendingPrompt || '';
    // 言語の指示はエージェントにだけ渡し、ログ（lastPromptSent）には残さない
    const spoken = withReplyLanguage(prompt);
    let args;
    if (agent === 'claude') {
      // stdin を開いたままにして、実行中でもメッセージ（btw）を送れるようにする
      args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages'];
      if (mode) args.push('--permission-mode', mode);
      const model = modelOf(c, s);
      if (model) args.push('--model', model);
      const allowed = splitList(rs.allowedTools);
      if (allowed.length) args.push('--allowedTools', ...allowed);
      // ソースを変更しないタスクは、ファイルを書き換えるツールを止める
      if (c.readOnly && !afterDone) args.push('--disallowedTools', ...READ_ONLY_DISALLOWED_TOOLS);
      const mcpConfig = this.writeMcpConfig(c, wsl.parseWslPath(cwd)?.distro);
      if (mcpConfig) args.push('--mcp-config', mcpConfig, '--permission-prompt-tool', PERMISSION_TOOL);
      if (c.sessionId) args.push('--resume', assertSessionId(c.sessionId));
      // 既存の会話を引き継ぐときは、元の会話を変えないようにフォークする（新しい ID になる）
      if (c.sessionId && c.forkNext) args.push('--fork-session');
      // 添付ファイルの置き場所（作業フォルダの外）も読めるようにする
      const attachDir = this.attachDirOf(c);
      if (attachDir) args.push('--add-dir', attachDir);
    } else {
      // Codex / Gemini / Cursor は、ほかの CLI の会話は引き継げないので新しい会話で始める
      if (c.forkNext) {
        c.sessionId = null;
        c.forkNext = false;
      }
      const attachDir = this.attachDirOf(c);
      args = providers.buildArgs(agent, { mode, model: modelOf(c, s), sessionId: c.sessionId ? assertSessionId(c.sessionId) : null, prompt: spoken, includeDirs: attachDir ? [attachDir] : [] });
    }

    const sentAtts = c.pendingAttachments || null;
    c.pendingPrompt = null;
    c.pendingAttachments = null;
    c.lastPromptSent = prompt;
    c.lastAttachmentsSent = sentAtts;
    for (const m of c.btw || []) if (m.state === 'queued') m.state = 'delivered';
    if (agent !== 'claude') this.log(c, 'system', c.sessionId ? tr('{label} で動かします（会話 {id} の続き）', { label, id: c.sessionId.slice(0, 8) }) : tr('{label} で動かします', { label }));
    // 承認待ちの MCP ツール呼び出しがタイムアウトしないようにする
    const child = await this.spawnAgent(agent, cwd, args, { MCP_TOOL_TIMEOUT: '86400000', ...this.portEnv(c) });
    const cmd = child.agentCmd;
    this.procs.set(c.id, child);
    // sent: stdin に書いたメッセージ（acked = claude が受け取ったことをリプレイで確認済み）
    const run = { agent, resultError: null, finished: false, child, sent: [], stdinClosed: false, idleTimer: null };
    if (agent !== 'claude') run.parser = providers.createParser(agent, { summarize: summarizeInput });
    run.done = new Promise((r) => (run.markDone = r));
    this.runs = this.runs || new Map();
    this.runs.set(c.id, run);

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.handleLine(c, line, run);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      const t = d.trim();
      if (t) this.log(c, 'stderr', truncate(t, 2000));
    });
    child.stdin.on('error', () => {});
    if (agent === 'claude') this.writeMessage(run, spoken, null, attachments.imageBlocks(sentAtts));
    else {
      // Codex / Gemini は指示を stdin で1回だけ受け取る（Cursor は引数で受け取ったので空で閉じる）。実行中の btw は終了後の追加指示にする
      run.stdinClosed = true;
      child.stdin.end(providers.promptViaArg(agent) ? '' : spoken);
    }

    const finish = async (code, spawnError) => {
      if (run.finished) return;
      run.finished = true;
      try {
        await finishRun(code, spawnError);
      } finally {
        run.markDone();
      }
    };
    const finishRun = async (code, spawnError) => {
      clearTimeout(run.idleTimer);
      if (buf.trim()) this.handleLine(c, buf.trim(), run);
      if (run.parser) for (const a of run.parser.flush()) this.applyAction(c, a, run);
      this.procs.delete(c.id);
      this.runs.delete(c.id);
      // 受け取られないまま終わった btw は「届かなかった」にする（終了後の追加指示待ち follow は残す）
      for (const m of c.btw || []) if (m.state === 'sent') m.state = 'lost';
      this.denyAllPending(c.id, tr('エージェントが終了しました'));
      if (!this.store.card(c.id)) return; // 破棄された
      if (afterDone) return this.finishAfterDone(c, code, spawnError, run, cmd);
      // 状態を「レビュー」にする前に、作業内容をブランチにコミットしておく
      if (!spawnError && !chat && !isNoGit(c)) {
        try {
          const canCommit = await this.afterConflictRun(c);
          if (canCommit && (await git.commitAll(c.worktreePath, this.commitMessage(c)))) this.log(c, 'system',tr('変更を worktree のブランチにコミットしました'));
        } catch (err) {
          this.log(c, 'error',tr('コミットに失敗しました: {message}', { message: err.message }));
        }
        if (!this.store.card(c.id)) return;
      }
      if (this.shuttingDown) {
        // アプリの終了で止めた: 「実行中」のまま保存し、次の起動で「中断」として再開できるようにする
        c.stopRequested = false;
        this.changed(c);
        return;
      }
      let relayNext = false;
      let relayTo;
      if (spawnError) {
        c.status = 'failed';
        c.error =
          spawnError.code === 'ENOENT'
            ? notFoundMessage(cmd, agent)
            : spawnError.message;
        this.log(c, 'error', c.error);
      } else if (c.stopRequested) {
        c.status = 'review';
        c.error = null;
        this.log(c, 'system',tr('停止しました。追加指示を送ると続きから再開できます。'));
      } else if (code === 0 && !run.resultError) {
        c.status = 'review';
        c.error = null;
        // 仕様の確認: 返事に印があれば「仕様の確認」のまま答えを待つ。なければ仕様は詰まったとみなす
        if (inSpecCheck(c)) {
          if (!c.lastSpecUnclear && c.specState === 'pending') this.log(c, 'system',tr('仕様が詰まったので、開発を進めました'));
          c.specState = c.lastSpecUnclear ? 'pending' : 'settled';
        }
        if (c.specState !== 'pending') c.specQuestions = null;
        // 会話は返事が来たらいつでも続きを話せるので、「回答待ち」にはしない
        c.awaitingReply = !chat && (c.specState === 'pending' || endsWithQuestion(c.lastText));
        // サブタスク: 順番が決まったら動かし始める / 分けたほうがよいという提案ならユーザーに聞く
        const subPlan = this.takeSubtaskPlan(c);
        if (subPlan === 'started') c.awaitingReply = false;
        if (subPlan === 'proposed') c.awaitingReply = true;
        // Pipelineの途中なら、レビューに回さずに次の工程へ引き継ぐ（質問で止まったとき・仕様の確認中は、答えてもらってから）
        // btw で追加指示待ちがあるときは、今の工程の続きを優先する
        const plan = c.awaitingReply || hasFollowBtw(c) ? null : this.relayNextStep(c);
        relayNext = !!plan && (typeof plan.to === 'number' || !!plan.parallel);
        if (relayNext) relayTo = plan;
        if (relayNext) {
          /* 通知はPipelineが終わってから */
        } else if (plan && plan.join) {
          // 並列の枝が合流まで来た: 親のカードがほかの枝を待ってマージする（通知は親のPipelineが終わってから）
          this.recordRelayStep(c); // 枝の最後の工程の報告を、親が引き取って次の工程に渡す
          c.relay.atJoin = true;
          c.relay.done = true;
          this.log(c, 'system',tr('Pipeline: この枝の工程が終わりました。合流で、ほかの枝が終わるのを待ってマージします'));
          if (plan.limitMsg) this.notify(c, 'review', tr('ループの上限: {title}', { title: c.title }), plan.limitMsg);
        } else if (plan && plan.stop) {
          this.notify(c, 'review', tr('分岐の行き先がありません: {title}', { title: c.title }), plan.stop);
        } else if (c.relay && c.relay.waiting) {
          /* 合流のコンフリクトを解消した: 残りの枝のマージと次の工程へ（tryJoin） */
        } else if (subPlan === 'proposed') {
          this.log(c, 'question',tr('{agentShort} が、サブタスクに分けて進めることを提案しています。上の「サブタスクの提案」で、サブタスクでやるか、分けずに進めるかを選んでください', { agentShort: agentShort(agent) }));
          this.emit('awaiting', c);
          this.notify(c, 'awaiting', tr('サブタスクの提案: {title}', { title: c.title }), c.lastText || tr('サブタスクに分けて進めることを提案しています'));
        } else if (c.subtasks && c.subtasks.phase === 'run') {
          /* サブタスクを動かしている（始めた・マージのコンフリクトを解消した）: advanceSubtasks で続ける */
          if (c.conflict && !c.conflict.resolving) this.notify(c, 'conflict', tr('サブタスクのマージでコンフリクト: {title}', { title: c.title }), tr('{target} のマージでコンフリクトが残っています。もう一度エージェントに頼むか、自分で直してください', { target: c.conflict.target }));
        } else if (c.specState === 'pending') {
          this.log(c, 'question',tr('内容が詰まっていないので、開発を開始できません。{agentShort} の質問に下の欄から答えて、仕様を詰めてください（詰まったら、そのまま開発を始めます）', { agentShort: agentShort(agent) }));
          this.emit('awaiting', c);
          this.notify(c, 'awaiting', tr('仕様の確認: {title}', { title: c.title }), tr('内容が詰まっていないので、開発を開始できません。\n{v}', { v: c.lastText || '' }).trim());
        } else if (c.awaitingReply) {
          this.log(c, 'question',tr('{agentShort} が質問しています。下の欄から答えると、続きから進めます', { agentShort: agentShort(agent) }));
          this.emit('awaiting', c);
          this.notify(c, 'awaiting', tr('回答待ち: {title}', { title: c.title }), c.lastText || tr('{who} が質問しています', { who: agentShort(agent) }));
        } else if (c.subtaskOf) {
          // サブタスク: 自動でマージするときは知らせない（親が仕上げてから知らせる）
          const sp = this.subtaskParentOf(c);
          if (sp && sp.subtasks.merge === 'review') this.notify(c, 'review', tr('サブタスクの確認: {title}', { title: c.title }), tr('差分を確かめて、「親のタスクに取り込む」を押してください。{v}', { v: c.lastText || '' }).trim());
        } else {
          if (isChat(c)) this.notify(c, 'awaiting', tr('返事: {title}', { title: c.title }), c.lastText || tr('{who} が返事をしました', { who: agentShort(agent) }));
          else if (plan && plan.limitMsg) this.notify(c, 'review', tr('ループの上限: {title}', { title: c.title }), plan.limitMsg);
          else this.notify(c, 'review', tr('レビュー待ち: {title}', { title: c.title }), c.lastText || (isNoGit(c) ? tr('作業が終わりました。フォルダの中身を確かめてください') : tr('作業が終わりました。差分を確かめてください')));
        }
      } else {
        c.status = 'failed';
        c.error =
          run.resultError ||
          run.lastError ||
          (child.viaWsl && code === 127
            ? tr('{distro}（WSL）の中に {cmd} が見つかりません。{distro} のターミナルで {label} をインストールしてログインしてください', { distro: child.viaWsl, cmd, label })
            : tr('{cmd} が終了コード {code} で終了しました', { cmd, code }));
      }
      if (c.status === 'failed') this.notify(c, 'failed', tr('失敗: {title}', { title: c.title }), c.error);
      // 停止・失敗したときは、予約した btw を勝手に送らない（停止したのにまた動き出さないように）
      const keepFollow = !c.stopRequested && c.status !== 'failed';
      if (!keepFollow && c.ciFix?.running) c.ciFix.running = false;
      // 会話の返事（またはエラー）が来たら、開いて読むまで「未読」にする（自分で止めたときは除く）
      if (isChat(c) && !c.stopRequested) c.unread = true;
      c.stopRequested = false;
      c.finishedAt = Date.now();
      this.changed(c);
      // Claude 以外で予約した btw は、終わったあとに追加指示として送る
      if (keepFollow ? this.flushFollowBtw(c) : this.dropFollowBtw(c)) return;
      if (c.ciFix?.running) {
        c.ciFix.running = false;
        if (!c.awaitingReply) this.pushCiFix(c);
      }
      if (relayNext) return relayTo.parallel ? this.forkParallel(c, relayTo.parallel) : this.advanceRelay(c, relayTo.to);
      if (c.relay && c.relay.waiting) this.tryJoin(c.id);
      const relayParent = this.relayParentOf(c);
      if (relayParent) {
        if (c.relay.atJoin) this.tryJoin(relayParent.id);
        else if (c.status === 'failed' || c.awaitingReply) this.log(relayParent, 'system', c.status === 'failed' ? tr('Pipeline: 並列の枝「{label}」が止まっています（失敗）。枝のタスクで直すか答えると、続きから進みます', { label: c.relay.branchOf.label }) : tr('Pipeline: 並列の枝「{label}」が止まっています（回答待ち）。枝のタスクで直すか答えると、続きから進みます', { label: c.relay.branchOf.label }));
      }
      this.checkCompetitionDone(c);
      if (c.subtaskOf) {
        const sp = this.subtaskParentOf(c);
        if (sp && (c.status === 'failed' || c.awaitingReply)) this.log(sp, 'system', c.status === 'failed' ? tr('サブタスク「{title}」が止まっています（失敗）。サブタスクを開いて、直すか答えると続きから進みます', { title: c.title }) : tr('サブタスク「{title}」が止まっています（回答待ち）。サブタスクを開いて、直すか答えると続きから進みます', { title: c.title }));
        this.advanceSubtasks(c.subtaskOf.parent);
      }
      if (c.subtasks && c.subtasks.phase === 'run') this.advanceSubtasks(c.id);
      this.pump();
    };
    child.on('error', (err) => finish(null, err));
    child.on('close', (code) => finish(code, null));
  }

  // 完了したタスクについての会話が終わった: 「完了」に戻す（レビューには回さないので、マージ・PR のボタンは出ない）
  finishAfterDone(c, code, spawnError, run, cmd) {
    if (c.sessionId) c.afterDoneSession = c.sessionId;
    c.afterDone = false;
    if (this.shuttingDown) {
      // 終了で止めた: 次の起動で「完了」に戻す（recoverInterrupted）
      c.afterDone = true;
      c.stopRequested = false;
      this.changed(c);
      return;
    }
    c.status = 'done';
    c.awaitingReply = false;
    c.error = null;
    if (spawnError) {
      c.error = spawnError.code === 'ENOENT' ? notFoundMessage(cmd, run.agent) : spawnError.message;
    } else if (c.stopRequested) {
      this.log(c, 'system',tr('停止しました。'));
    } else if (code === 0 && !run.resultError) {
      this.notify(c, 'awaiting', tr('返事: {title}', { title: c.title }), c.lastText || tr('{who} が返事をしました', { who: agentShort(run.agent) }));
    } else {
      c.error = run.resultError || run.lastError || tr('{cmd} が終了コード {code} で終了しました', { cmd, code });
    }
    if (c.error) {
      this.log(c, 'error', c.error);
      this.notify(c, 'failed', tr('失敗: {title}', { title: c.title }), c.error);
    }
    const keepFollow = !c.stopRequested && !c.error;
    c.stopRequested = false;
    c.finishedAt = Date.now();
    this.changed(c);
    if (keepFollow ? this.flushFollowBtw(c) : this.dropFollowBtw(c)) return;
    this.pump();
  }

  handleLine(c, line, run) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      this.log(c, 'stderr', truncate(line, 2000));
      return;
    }
    if (run.parser) {
      for (const a of run.parser.onEvent(ev || {})) this.applyAction(c, a, run);
      return;
    }
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          if (ev.session_id) this.recordSession(c, ev.session_id);
          this.log(c, 'system', tr('セッション開始（モデル: {model} / 権限モード: {mode}）', { model: ev.model || tr('不明'), mode: ev.permissionMode || tr('不明') }));
          this.changed(c);
        }
        break;
      case 'assistant':
        for (const b of (ev.message && ev.message.content) || []) {
          if (b.type === 'text' && b.text && b.text.trim()) {
            // 仕様の確認の印は覚えておいて、画面には出さない
            const text = this.takeSpecQuestions(c, b.text);
            if (!text.trim()) continue;
            this.log(c, 'text', text, { agent: 'claude' });
            c.lastText = text.trim();
            c.lastMessage = truncate(text.trim(), 200);
          } else if (b.type === 'tool_use') {
            this.log(c, 'tool', `${b.name}  ${summarizeInput(b.input)}`, { agent: 'claude' });
            c.lastMessage = `${b.name} ${truncate(summarizeInput(b.input), 80)}`;
            const todos = providers.todosFromTool(b.name, b.input);
            if (todos) this.setTodos(c, todos);
          }
        }
        this.changed(c);
        break;
      case 'user': {
        if (ev.isReplay) {
          this.onReplay(c, run, ev);
          break;
        }
        const content = ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
        for (const b of content) {
          if (b.type !== 'tool_result') continue;
          const images = toolResultImages(b.content);
          this.log(c, b.is_error ? 'tool_error' : 'tool_result', truncate(toolResultText(b.content), 1500), images.length ? { images } : undefined);
        }
        break;
      }
      case 'result': {
        if (ev.session_id) c.sessionId = ev.session_id;
        const cost = Number(ev.total_cost_usd) || 0;
        c.costUsd = (c.costUsd || 0) + cost;
        this.store.addCost(c.repoPath, cost);
        const secs = Math.round((Number(ev.duration_ms) || 0) / 1000);
        if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) {
          run.resultError = (typeof ev.result === 'string' && ev.result) || tr('エラー（{subtype}）', { subtype: ev.subtype });
          this.log(c, 'error', tr('エラーで終了しました: {resultError}', { resultError: run.resultError }));
        } else {
          // 仕様の確認の印・質問フォーム用のブロックは、カードの一言には出さない
          const said = typeof ev.result === 'string' ? Subtasks.stripSubtasks(extractSpecQuestions(stripSpecMarker(ev.result)).text).trim() : '';
          if (said) c.lastMessage = truncate(said, 200);
          this.log(c, 'result', tr('完了しました（{secs}秒 / ${amount}）', { secs, amount: cost.toFixed(3) }));
        }
        this.changed(c);
        this.afterResult(c, run, !!run.resultError);
        break;
      }
      case 'rate_limit_event': {
        // 週間上限（seven_day 系）のリセット日時を覚えて、上部の週の合計金額の区切りに使う
        const info = ev.rate_limit_info || {};
        const resetsAt = Number(info.resetsAt) || 0;
        if (resetsAt && /^seven_day/.test(String(info.rateLimitType || ''))) {
          if (this.store.setWeeklyResetAt(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt)) this.store.save();
        }
        break;
      }
      default:
        break;
    }
  }

  // Codex / Gemini / Cursor の出力（providers.js で共通の形に直したもの）を、ログとカードに反映する
  applyAction(c, a, run) {
    const who = { agent: run.agent };
    switch (a.type) {
      case 'session':
        if (!isSessionId(a.id)) break;
        this.recordSession(c, a.id);
        this.log(c, 'system', a.model ? tr('セッション開始（{agent} / モデル: {model}）', { agent: agentLabel(run.agent), model: a.model }) : tr('セッション開始（{agent}）', { agent: agentLabel(run.agent) }));
        this.changed(c);
        break;
      case 'text': {
        // 仕様の確認の印は覚えておいて、画面には出さない（Claude のときと同じ）
        const text = this.takeSpecQuestions(c, a.text);
        if (!text.trim()) break;
        this.log(c, 'text', text, who);
        c.lastText = text.trim();
        c.lastMessage = truncate(c.lastText, 200);
        this.changed(c);
        break;
      }
      case 'tool':
        this.log(c, 'tool', `${a.name}  ${a.summary || ''}`.trim(), who);
        c.lastMessage = `${a.name} ${truncate(a.summary || '', 80)}`;
        this.changed(c);
        break;
      case 'tool_result':
        this.log(c, a.error ? 'tool_error' : 'tool_result', truncate(a.text, 1500));
        break;
      case 'todos':
        this.setTodos(c, a.items);
        this.changed(c);
        break;
      case 'log_error':
        run.lastError = truncate(a.text, 500);
        this.log(c, 'stderr', truncate(a.text, 2000));
        break;
      case 'result':
        if (a.error) {
          run.resultError = truncate(a.error, 1000);
          this.log(c, 'error',tr('エラーで終了しました: {resultError}', { resultError: run.resultError }));
        } else this.log(c, 'result',tr('完了しました（{agentLabel}）', { agentLabel: agentLabel(run.agent) }));
        this.changed(c);
        break;
      default:
        break;
    }
  }

  // ---------- 実行中のメッセージ（btw） ----------

  // stream-json の1行として stdin に書く
  // images: 一緒に渡す画像（content ブロック）
  writeMessage(run, text, btwId, images) {
    run.sent.push({ text, btwId, acked: false });
    const content = images && images.length ? [...images, { type: 'text', text }] : text;
    run.child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
  }

  // このカードの添付ファイルの置き場所（添付がなければ null）
  attachDirOf(c) {
    const dir = attachments.cardDir(this.attachRoot, c.id);
    return fs.existsSync(dir) ? dir : null;
  }

  // claude がメッセージを受け取ると、--replay-user-messages で同じ内容が返ってくる
  onReplay(c, run, ev) {
    const content = ev.message && ev.message.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('') : '';
    const m = run.sent.find((x) => !x.acked && x.text === text) || run.sent.find((x) => !x.acked);
    if (!m) return;
    m.acked = true;
    if (m.btwId) {
      const b = (c.btw || []).find((x) => x.id === m.btwId);
      if (b) {
        b.state = 'delivered';
        b.deliveredAt = Date.now();
        this.log(c, 'system',tr('btw のメッセージを Claude Code が受け取りました'));
        this.changed(c);
      }
    }
  }

  // 1ターン終わったとき: まだ受け取られていない btw がなければ stdin を閉じて終わらせる。
  // あれば、claude がそれを次のターンとして処理するのを待つ
  afterResult(c, run, isError) {
    clearTimeout(run.idleTimer);
    const waiting = run.sent.some((x) => !x.acked);
    if (!waiting || isError) return this.closeInput(run);
    // 念のため、しばらく何も起きなければ閉じる
    run.idleTimer = setTimeout(() => this.closeInput(run), 15000);
  }

  closeInput(run) {
    if (run.stdinClosed) return;
    run.stdinClosed = true;
    clearTimeout(run.idleTimer);
    try {
      run.child.stdin.end();
    } catch {
      /* もう閉じている */
    }
  }

  /**
   * 停止・失敗で終わったときは、予約した btw を送らずに「届かなかった」にする
   * @returns {false} 何も enqueue しない
   */
  dropFollowBtw(c) {
    const pending = (c.btw || []).filter((m) => m.state === 'follow');
    if (!pending.length) return false;
    for (const m of pending) m.state = 'lost';
    this.log(c, 'system',tr('停止・失敗したので、btw で予約したメッセージは送りませんでした。続けるときは「追加指示」で送ってください'));
    this.changed(c);
    return false;
  }

  /**
   * 実行中に予約した btw（Claude 以外）を、追加指示として送る。
   * @returns {boolean} 送ったら true（enqueue 済みなので呼び出し側は pump しない）
   */
  flushFollowBtw(c) {
    const pending = (c.btw || []).filter((m) => m.state === 'follow');
    if (!pending.length) return false;
    const text = pending.map((m) => m.text).join('\n\n').trim();
    for (const m of pending) m.state = 'delivered';
    if (!text) {
      this.changed(c);
      return false;
    }
    this.log(c, 'system',tr('btw で予約したメッセージを追加指示として送ります'));
    // user ログは btw 時に済んでいる。send() と同じ続き方で enqueue する
    if (c.status === 'done' && !isChat(c)) {
      const first = !c.afterDoneSession;
      if (first) this.log(c, 'system',tr('完了したタスクについて話します（ファイルは変えません。修正が必要なときは「修正タスクを作る」から別のタスクにしてください）'));
      c.sessionId = c.afterDoneSession || null;
      c.forkNext = false;
      c.afterDone = true;
      this.enqueue(c, promptWithSkill(agentOf(c), null, first ? buildAfterDonePrompt(c, text) : text));
      return true;
    }
    if (!['review', 'failed', 'done'].includes(c.status)) {
      this.changed(c);
      return false;
    }
    const body = inSpecCheck(c) ? `${text}\n\n${SPEC_FOLLOW_NOTE}` : text;
    this.enqueue(c, promptWithSkill(agentOf(c), null, body));
    return true;
  }

  /**
   * 実行中のエージェントにメッセージを送る（btw）。Claude は今の作業にそのまま反映する。
   * 待機中なら、開始するときの指示に付け足す。
   * Claude 以外の実行中は、終わったあとに追加指示として送る予約にする
   */
  btw(id, text) {
    const c = this.must(id);
    text = String(text || '').trim();
    if (!text) throw new Error(tr('メッセージを入力してください'));
    const entry = { id: crypto.randomBytes(4).toString('hex'), text, at: Date.now(), state: 'sent' };
    const wrapped = `（作業中のユーザーからの追加メッセージ）\n${text}`;
    if (c.status === 'queued') {
      c.pendingPrompt = `${c.pendingPrompt || ''}\n\n${wrapped}`;
      entry.state = 'queued';
    } else if (c.status === 'running' && agentOf(c) !== 'claude') {
      // Codex / Gemini / Cursor は実行中の stdin 追加に対応していないので、終了後の追加指示にする
      entry.state = 'follow';
    } else {
      const run = this.runs && this.runs.get(id);
      if (c.status !== 'running' || !run || run.finished || run.stdinClosed) {
        throw new Error(tr('btw はエージェントの実行中だけ送れます。終わったあとは下の「追加指示」を使ってください'));
      }
      clearTimeout(run.idleTimer);
      this.writeMessage(run, wrapped, entry.id);
    }
    c.btw = [...(c.btw || []), entry];
    this.log(c, 'user', `btw: ${text}`);
    this.changed(c);
    return entry;
  }

  // 返事の文章から仕様の確認の印と、質問フォーム用の JSON ブロックを取り出してカードに覚えておく（どちらも画面に出さない）
  takeSpecQuestions(c, raw) {
    // サブタスクの印と ```subtasks のブロックも、ここで取り出す（画面には出さない）
    const sub = Subtasks.extractSubtasks(raw);
    if (sub.items && (sub.marked || c.lastSubtasksMarked)) c.lastSubtaskPlan = sub.items;
    if (sub.marked) c.lastSubtasksMarked = true;
    raw = sub.text;
    const marked = hasSpecMarker(raw);
    const { text, questions } = extractSpecQuestions(marked ? stripSpecMarker(raw) : String(raw || ''));
    // 印付きの返事のすぐあとに、ブロックだけが別のメッセージで来たときは、同じ質問のフォームとして扱う（仕様が詰まったとは見なさない）
    if (!marked && !text.trim() && questions && c.lastSpecUnclear) {
      c.specQuestions = questions;
      return text;
    }
    c.lastSpecUnclear = marked;
    // JSON のブロックを付け忘れたときは、本文の番号付きの質問からフォームを作る（あとからブロックだけ届けば、そちらで上書きする）
    if (marked) c.specQuestions = questions || parseMarkdownQuestions(text);
    return text;
  }

  // ---------- 承認（--permission-prompt-tool） ----------

  requestPermission({ cardId, toolName, input, toolUseId }, signal) {
    const c = this.store.card(cardId);
    if (!c) return Promise.resolve({ behavior: 'deny', message: tr('タスクが見つかりません') });
    input = input && typeof input === 'object' ? input : {};
    if (toolName === 'AskUserQuestion') return this.askQuestion(c, input, toolUseId, signal);
    if ((c.alwaysAllow || []).includes(toolName)) {
      this.log(c, 'permission',tr('自動で許可しました: {toolName}  {summarizeInput}', { toolName, summarizeInput: summarizeInput(input) }));
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    }
    return new Promise((resolve) => {
      const id = crypto.randomBytes(6).toString('hex');
      const req = { id, toolName, toolUseId, summary: summarizeInput(input), detail: truncate(JSON.stringify(input, null, 2), 4000), at: Date.now() };
      this.pending.set(id, { cardId, toolName, input, resolve });
      c.permissions = c.permissions || [];
      c.permissions.push(req);
      this.log(c, 'permission',tr('承認待ち: {toolName}  {summary}', { toolName, summary: req.summary }));
      this.changed(c);
      this.emit('permission', c, req);
      this.notify(c, 'permission', tr('承認待ち: {title}', { title: c.title }), `${toolName}  ${req.summary}`);
      signal?.addEventListener('abort', () => {
        if (this.pending.has(id)) this.settle(id, { behavior: 'deny', message: tr('中断されました') }, null);
      });
    });
  }

  // ---------- エージェントからの質問（AskUserQuestion） ----------

  // 選択肢の質問を、カードの回答フォームとして出す。ユーザーが答えるまで待つ
  askQuestion(c, input, toolUseId, signal) {
    const questions = (Array.isArray(input.questions) ? input.questions : [])
      .map((q) => ({
        question: String(q.question || ''),
        header: String(q.header || ''),
        multiSelect: !!q.multiSelect,
        options: (Array.isArray(q.options) ? q.options : []).map((o) => ({ label: String(o.label || ''), description: String(o.description || '') })),
      }))
      .filter((q) => q.question);
    if (!questions.length) return Promise.resolve({ behavior: 'allow', updatedInput: input });
    return new Promise((resolve) => {
      const id = crypto.randomBytes(6).toString('hex');
      this.pending.set(id, { cardId: c.id, toolName: 'AskUserQuestion', input, resolve, kind: 'question', questions });
      c.questions = [...(c.questions || []), { id, toolUseId, questions, at: Date.now() }];
      this.log(c, 'question',tr('質問: {v}', { v: questions.map((q) => q.question).join(' / ') }));
      this.changed(c);
      this.emit('question', c, questions);
      this.notify(c, 'question', tr('質問: {title}', { title: c.title }), questions.map((q) => q.question).join(' / '));
      signal?.addEventListener('abort', () => {
        if (this.pending.has(id)) this.settle(id, { behavior: 'deny', message: tr('中断されました') }, null);
      });
    });
  }

  /**
   * 質問に答える
   * @param {Record<string, string>|null} answers  質問文 → 回答（複数選択は「, 」でつなぐ）。null なら答えずに続けさせる
   */
  answerQuestion(cardId, reqId, answers) {
    this.must(cardId);
    const p = this.pending.get(reqId);
    if (!p || p.cardId !== cardId || p.kind !== 'question') throw new Error(tr('この質問はもう終わっています'));
    if (!answers) {
      this.settle(reqId, { behavior: 'deny', message: tr('ユーザーは質問に答えずに、そのまま進めるよう求めています。妥当だと思う方法で続けてください。') }, tr('答えずに続ける'));
      return;
    }
    const clean = {};
    for (const q of p.questions) {
      const a = String(answers[q.question] ?? '').trim();
      if (!a) throw new Error(tr('「{v}」に答えてください', { v: q.header || q.question }));
      clean[q.question] = a;
    }
    const c = this.store.card(cardId);
    this.log(c, 'user', Object.entries(clean).map(([q, a]) => `${q} → ${a}`).join('\n'), { answer: true });
    this.settle(reqId, { behavior: 'allow', updatedInput: { ...p.input, answers: clean } }, tr('回答しました'));
  }

  // decision: 'allow' | 'deny' | 'always'
  answerPermission(cardId, reqId, decision, message) {
    const c = this.must(cardId);
    const p = this.pending.get(reqId);
    if (!p || p.cardId !== cardId || p.kind === 'question') throw new Error(tr('この承認リクエストはもう終わっています'));
    if (decision === 'always') {
      c.alwaysAllow = c.alwaysAllow || [];
      if (!c.alwaysAllow.includes(p.toolName)) c.alwaysAllow.push(p.toolName);
      // 同じツールで待っている他のリクエストもまとめて許可
      for (const [id, other] of this.pending) {
        if (other.cardId === cardId && other.toolName === p.toolName) this.settle(id, { behavior: 'allow', updatedInput: other.input }, tr('許可（常に許可）'));
      }
      return;
    }
    if (decision === 'allow') this.settle(reqId, { behavior: 'allow', updatedInput: p.input }, tr('許可'));
    else this.settle(reqId, { behavior: 'deny', message: (message && message.trim()) || tr('ユーザーが拒否しました') }, tr('拒否'));
  }

  settle(reqId, result, label) {
    const p = this.pending.get(reqId);
    if (!p) return;
    this.pending.delete(reqId);
    const c = this.store.card(p.cardId);
    if (c) {
      c.permissions = (c.permissions || []).filter((r) => r.id !== reqId);
      c.questions = (c.questions || []).filter((r) => r.id !== reqId);
      if (label) this.log(c, p.kind === 'question' ? 'question' : 'permission', p.kind === 'question' ? label : `${label}: ${p.toolName}`);
      this.changed(c);
    }
    p.resolve(result);
  }

  denyAllPending(cardId, message) {
    for (const [id, p] of this.pending) {
      if (p.cardId === cardId) this.settle(id, { behavior: 'deny', message }, null);
    }
  }

  // ---------- 差分・マージ・破棄 ----------

  async diff(id) {
    const c = this.must(id);
    if (isChat(c) || isNoGit(c)) return '';
    if (c.worktreePath && fs.existsSync(c.worktreePath)) return git.diff(c.worktreePath, c.baseCommit);
    return c.finalDiff || '';
  }

  // worktree の作業状況（タブ「worktree」用）
  async worktree(id) {
    const c = this.must(id);
    if (isChat(c) || isNoGit(c)) return { exists: false, status: null, worktrees: [] };
    const repo = c.repoPath || this.store.settings.repoPath;
    const others = repo && fs.existsSync(repo) ? await git.listWorktrees(repo).catch(() => []) : [];
    const exists = !!(c.worktreePath && fs.existsSync(c.worktreePath));
    const status = exists ? await git.worktreeStatus(c.worktreePath, c.baseCommit, c.baseBranch) : null;
    return { exists, status, worktrees: others };
  }

  /**
   * 指定したブランチにマージする
   * @param {string} id
   * @param {{ target?: string, createNew?: boolean, keep?: boolean }} opts
   *   target: マージ先（省略時はベースブランチ）
   *   createNew: target を新しく作る（ベースブランチから分岐）
   *   keep: マージ後も worktree とブランチを残してタスクを続ける
   *   push: マージしたあと origin に push する（origin/<target> にも反映）
   */
  async merge(id, opts = {}) {
    const c = this.must(id);
    this.assertNotRewinding(c);
    if (isChat(c)) throw new Error(tr('会話はマージできません（タスクにすると、worktree で作業してマージできます）'));
    if (isNoGit(c)) throw new Error(tr('git で管理していないフォルダのタスクはマージできません。「完了にする」で完了にしてください'));
    this.assertNotInRelayJoin(c);
    if (!['review', 'failed'].includes(c.status)) throw new Error(tr('レビュー中のタスクだけマージできます'));
    if (!c.worktreePath) throw new Error(tr('worktree がありません'));
    if (this.merging?.has(id)) throw new Error(tr('マージ中です'));
    const top = c.repoPath;
    const target = String(opts.target || c.baseBranch || '').trim();
    if (!target) throw new Error(tr('マージ先のブランチを指定してください'));
    if (target === c.branch) throw new Error(tr('タスク自身のブランチにはマージできません'));
    git.assertSafeRef(target, tr('マージ先のブランチ名'));

    if (await git.mergeInProgress(c.worktreePath)) throw new Error(tr('コンフリクトの解消が終わっていません。「解消した」を押すか、取り込みを中止してください'));

    this.merging = this.merging || new Set();
    this.merging.add(id);
    try {
      await git.commitAll(c.worktreePath, this.commitMessage(c));
      if (opts.createNew) {
        await git.checkBranchName(top, target);
        if (await git.branchExists(top, target)) throw new Error(tr('ブランチ {target} はもうあります。一覧から選んでください', { target }));
        await git.createBranch(top, target, c.baseBranch);
        this.log(c, 'system',tr('ブランチ {target} を {baseBranch} から作成しました', { target, baseBranch: c.baseBranch }));
      } else if (!(await git.branchExists(top, target))) {
        throw new Error(tr('ブランチ {target} が見つかりません', { target }));
      }

      // origin にも反映するときは、先に origin の最新を取ってきてローカルをそろえる
      const remote = 'origin';
      const remoteHas = opts.push ? await this.syncWithOrigin(c, top, target) : false;

      const finalDiff = await git.diff(c.worktreePath, c.baseCommit);
      const ahead = await git.countCommits(top, `${target}..${c.branch}`);
      if (ahead > 0) {
        // target をチェックアウトしている場所でマージする。どこにもなければ一時的な worktree を使い、
        // 自分の作業中のフォルダには触らない
        let dir = await git.worktreeForBranch(top, target);
        let temp = null;
        if (!dir) {
          temp = path.join(path.dirname(c.worktreePath), `_merge-${c.id}-${Date.now()}`);
          try {
            await git.addWorktreeForBranch(top, temp, target);
            dir = temp;
          } catch (err) {
            // 「main は <フォルダ> で使われています」と断られたら、そのフォルダでマージする
            const at = git.checkedOutAtFromError(err, top);
            if (!at) throw err;
            temp = null;
            dir = at;
          }
        }
        if (!temp) {
          const op = await git.operationInProgress(dir);
          if (op) throw new Error(tr('{target} をチェックアウトしている {dir} で {op} が途中です。終わらせるか中止してから、もう一度マージしてください。', { target, dir, op }));
          if (await git.isDirty(dir)) throw new Error(tr('{target} をチェックアウトしている {dir} に未コミットの変更があります。コミットするか退避してからマージしてください。', { target, dir }));
        }
        try {
          await git.merge(dir, c.branch, (c.issue ? `Merge agent task: ${c.title.replace(/^#\d+\s*/, '')} (#${c.issue.number})` : `Merge agent task: ${c.title}`), target);
        } catch (err) {
          if (!err.conflictFiles) throw err;
          // コンフリクト: マージは中止済み。カードに出して、解消の方法を選んでもらう
          c.conflict = { target, files: err.conflictFiles, push: !!opts.push, keep: !!opts.keep, at: Date.now() };
          c.conflictResolved = null;
          this.log(c, 'error',tr('{target} とコンフリクトしています: {v}', { target, v: err.conflictFiles.join(', ') }));
          this.changed(c);
          return { conflict: c.conflict };
        } finally {
          if (temp) await git.removeWorktree(top, temp);
        }
        this.log(c, 'system',tr('{target} にマージしました', { target }));
      } else {
        this.log(c, 'system',tr('{target} にはもう取り込まれているので、マージする変更はありませんでした', { target }));
      }
      c.mergedInto = [...new Set([...(c.mergedInto || []), target])];
      c.lastMergeTarget = target;
      c.conflict = null;
      c.conflictResolved = null;

      if (opts.push) {
        try {
          await git.push(top, remote, target, !remoteHas);
        } catch (err) {
          this.changed(c);
          throw new Error(tr('ローカルの {target} へのマージは済みましたが、origin への push に失敗しました。ターミナルで git push origin {target2} を試してください。\n{message}', { target, target2: target, message: err.message }));
        }
        this.log(c, 'system',tr('origin/{target} に push しました', { target }));
        c.pushedTo = [...new Set([...(c.pushedTo || []), target])];
      }

      if (opts.keep) {
        this.changed(c);
        return { merged: true };
      }
      await this.removeWorktreeOf(c, top);
      await git.deleteBranch(top, c.branch);
      c.finalDiff = truncate(finalDiff, 300000);
      c.worktreePath = null;
      c.status = 'done';
      c.mergedAt = Date.now();
      this.completed(c);
      await this.deleteTaskSessions(c);
      this.changed(c);
      return { merged: true };
    } finally {
      this.merging.delete(id);
    }
  }

  // PR の既定のタイトルと本文
  prDefaults(c) {
    const title = c.issue ? c.title.replace(/^#\d+\s*/, '') : c.title;
    const lines = [];
    if (c.issue) lines.push(`Closes #${c.issue.number}`, '');
    // サブIssue も、このタスクのブランチで閉じる
    const subIssues = c.subtasks ? c.subtasks.items.filter((x) => x.issue && x.state === 'merged').map((x) => `Closes #${x.issue.number}`) : [];
    if (subIssues.length) lines.push(...subIssues, '');
    if (c.lastMessage) lines.push(c.lastMessage, '');
    lines.push('---', tr('Worktree Kanban のタスクから作成しました。'));
    return { title, body: lines.join('\n') };
  }

  /**
   * ブランチを origin に push して、プルリクエストを作る（すでに開いている PR があれば push だけして更新する）
   * @param {string} id
   * @param {{ base?: string, title?: string, body?: string, keep?: boolean }} opts
   *   base: PR のマージ先（省略時はベースブランチ）
   *   keep: PR を作ったあとも worktree とブランチを残してタスクを続ける（既定は続ける）
   * @returns {Promise<{ url: string, created: boolean }>}
   */
  async createPullRequest(id, opts = {}) {
    const c = this.must(id);
    this.assertNotRewinding(c);
    if (isChat(c)) throw new Error(tr('会話からは PR を作れません（タスクにすると、worktree で作業して PR を作れます）'));
    if (isNoGit(c)) throw new Error(tr('git で管理していないフォルダのタスクからは PR を作れません。「完了にする」で完了にしてください'));
    this.assertNotInRelayJoin(c);
    if (!['review', 'failed'].includes(c.status)) throw new Error(tr('レビュー中のタスクだけ PR を作れます'));
    if (!c.worktreePath) throw new Error(tr('worktree がありません'));
    if (this.merging?.has(id)) throw new Error(tr('処理中です'));
    const top = c.repoPath;
    const base = String(opts.base || c.prBase || c.baseBranch || '').trim();
    if (!base) throw new Error(tr('PR のマージ先のブランチを指定してください'));
    if (base === c.branch) throw new Error(tr('タスク自身のブランチには PR を作れません'));
    git.assertSafeRef(base, tr('PR のマージ先のブランチ名'));
    if (!(await git.hasRemote(top, 'origin'))) throw new Error(tr('このリポジトリに origin がありません。GitHub のリポジトリを origin に設定してください'));
    if (await git.mergeInProgress(c.worktreePath)) throw new Error(tr('コンフリクトの解消が終わっていません。「解消した」を押すか、取り込みを中止してください'));

    this.merging = this.merging || new Set();
    this.merging.add(id);
    try {
      await git.commitAll(c.worktreePath, this.commitMessage(c));
      if ((await git.countCommits(top, `${base}..${c.branch}`)) === 0 && (await git.branchExists(top, base))) {
        throw new Error(tr('{base} との差分がないので PR を作れません', { base }));
      }
      await git.push(c.worktreePath, 'origin', c.branch, true);
      this.log(c, 'system',tr('ブランチ {branch} を origin に push しました', { branch: c.branch }));
      const def = this.prDefaults(c);
      const slug = await github.repoSlug(top).catch(() => null);
      const pr = await ghCli.createPullRequest({
        cwd: c.worktreePath,
        repo: slug ? `${slug.owner}/${slug.repo}` : undefined,
        head: c.branch,
        base,
        title: String(opts.title || '').trim() || def.title,
        body: opts.body != null && String(opts.body).trim() ? String(opts.body) : def.body,
        gh: this.opts.ghPath,
      });
      this.log(c, 'system', pr.created ? tr('PR を作成しました: {url}', { url: pr.url }) : tr('開いている PR を更新しました: {url}', { url: pr.url }));
      c.prUrl = pr.url;
      c.prBase = base;
      c.prState = 'OPEN';
      c.prMergedAt = null;
      c.prCheckError = null;
      // push したので、コンフリクトしているかと CI の結果は GitHub でもう一度確かめる
      c.prMergeable = null;
      c.prChecks = null;
      if (c.conflictResolved && c.conflictResolved.pr) c.conflictResolved = null;
      if (c.conflict && c.conflict.pr) c.conflict = null;

      const finalDiff = await git.diff(c.worktreePath, c.baseCommit);
      if (opts.keep === false) {
        // ブランチは origin に残っているので、ローカルの worktree とブランチは片付ける
        await this.removeWorktreeOf(c, top);
        await git.deleteBranch(top, c.branch);
        c.finalDiff = truncate(finalDiff, 300000);
        c.worktreePath = null;
        c.status = 'done';
        c.mergedAt = Date.now();
        this.completed(c);
      }
      this.changed(c);
      return { url: pr.url, created: pr.created };
    } finally {
      this.merging.delete(id);
    }
  }

  // ---------- 作った PR のマージを見張る ----------

  // テストで差し替えられるようにメソッドにしておく
  pullRequestState(c) {
    return ghCli.pullRequestState({ url: c.prUrl, cwd: c.worktreePath || c.repoPath, gh: this.opts.ghPath });
  }

  // 一定の間隔で、作った PR がマージされたかを確かめる
  watchPullRequests(intervalMs = 60000) {
    this.unwatchPullRequests();
    this.checkPullRequests().catch(() => {});
    this.prTimer = setInterval(() => this.checkPullRequests().catch(() => {}), intervalMs);
    this.prTimer.unref?.();
  }

  unwatchPullRequests() {
    if (this.prTimer) clearInterval(this.prTimer);
    this.prTimer = null;
  }

  /**
   * PR を作ったタスクについて、GitHub で PR の状態を確かめる。マージされていれば完了にする
   * （worktree に PR に入っていない変更が残っているときは、消さずにレビュー中のまま残す）
   * @returns {Promise<number>} 完了にしたタスクの数
   */
  async checkPullRequests() {
    if (this.checkingPrs) return this.checkingPrs;
    const run = (async () => {
      let n = 0;
      const list = this.store.cards.filter((c) => c.prUrl && !c.prMergedAt && ['review', 'failed', 'done'].includes(c.status));
      for (const c of list) {
        if (this.shuttingDown) break;
        try {
          if (await this.checkPullRequest(c)) n++;
        } catch (err) {
          if (!this.store.card(c.id)) continue;
          if (c.prCheckError !== err.message) this.log(c, 'error',tr('PR の状態を確かめられませんでした: {message}', { message: err.message }));
          c.prCheckError = err.message;
          this.store.save();
        }
      }
      return n;
    })();
    this.checkingPrs = run;
    try {
      return await run;
    } finally {
      this.checkingPrs = null;
    }
  }

  async checkPullRequest(c) {
    const url = c.prUrl;
    const pr = await this.pullRequestState(c);
    // 確かめているあいだに、消された・別の PR に変わった・動き出したときは何もしない
    if (!this.store.card(c.id) || c.prUrl !== url || c.prMergedAt || !['review', 'failed', 'done'].includes(c.status)) return false;
    c.prCheckError = null;
    if (pr.state !== 'MERGED') {
      let changed = false;
      if (c.prState !== pr.state) {
        if (pr.state === 'CLOSED') this.log(c, 'system',tr('PR はマージされずに閉じられました: {url}', { url }));
        c.prState = pr.state;
        changed = true;
      }
      if (this.updatePrConflict(c, pr)) changed = true;
      if (this.updatePrChecks(c, pr)) changed = true;
      if (changed) this.changed(c);
      await this.handleCiFailure(c);
      return false;
    }

    const base = pr.baseRefName || c.prBase;
    c.prState = 'MERGED';
    c.prMergedAt = Date.parse(pr.mergedAt) || Date.now();
    if (base) {
      c.mergedInto = [...new Set([...(c.mergedInto || []), base])];
      c.lastMergeTarget = base;
    }
    this.log(c, 'system', base ? tr('PR がマージされました（{base}）: {url}', { base, url }) : tr('PR がマージされました: {url}', { url }));

    if (c.status !== 'done' && c.worktreePath) {
      if (this.merging?.has(c.id)) {
        this.changed(c);
        return false;
      }
      const keep = await this.unmergedWork(c, pr.headRefOid);
      if (!this.store.card(c.id) || !['review', 'failed'].includes(c.status)) return false;
      if (keep) {
        this.log(c, 'system',tr('worktree に PR に入っていない変更（{keep}）があるので、タスクはレビュー中のまま残します。不要なら「破棄」、続きは追加指示か PR の作成で進められます', { keep }));
        this.changed(c);
        return false;
      }
      const top = c.repoPath;
      const finalDiff = await git.diff(c.worktreePath, c.baseCommit).catch(() => '');
      // 片付けスクリプトのあいだに、次の見回りが同じタスクを片付けないようにする
      this.merging = this.merging || new Set();
      this.merging.add(c.id);
      try {
        await this.removeWorktreeOf(c, top);
      } finally {
        this.merging.delete(c.id);
      }
      if (!this.store.card(c.id)) return false;
      await git.deleteBranch(top, c.branch);
      c.finalDiff = truncate(finalDiff, 300000);
      c.worktreePath = null;
    }
    const wasDone = c.status === 'done';
    c.status = 'done';
    c.error = null;
    c.interrupted = null;
    c.mergedAt = c.prMergedAt;
    if (!wasDone) this.completed(c);
    else this.notify(c, 'done', tr('PR がマージされました: {title}', { title: c.title }), url);
    await this.deleteTaskSessions(c);
    this.changed(c);
    return true;
  }

  /**
   * 開いている PR がマージ先とコンフリクトしていたら、カードに出して解消の導線を作る。
   * コンフリクトがなくなったら（GitHub 上で解消された・マージ先が戻ったなど）、まだ手をつけていなければ消す。
   * @returns {boolean} カードを変えたら true
   */
  updatePrConflict(c, pr) {
    const before = c.prMergeable || null;
    const now = pr.state === 'OPEN' ? pr.mergeable || null : null;
    // GitHub が計算中（UNKNOWN）のときは、前の状態のままにしておく
    if (now === 'UNKNOWN') return false;
    let changed = before !== now;
    c.prMergeable = now;
    const base = pr.baseRefName || c.prBase;
    const active = c.conflict && (c.conflict.manual || c.conflict.resolving);
    if (now === 'CONFLICTING' && before !== 'CONFLICTING') {
      // 新しくコンフリクトした。worktree があればアプリの中で解消できる
      if (c.worktreePath && ['review', 'failed'].includes(c.status) && base && !(c.conflict && !c.conflict.pr)) {
        if (!active) this.raisePrConflict(c, base);
        this.log(c, 'error',tr('PR が {base} とコンフリクトしています。「エージェントに解消してもらう」か「自分で解消する」で直して、PR を更新してください: {prUrl}', { base, prUrl: c.prUrl }));
        this.notify(c, 'conflict', tr('PR がコンフリクトしています: {title}', { title: c.title }), c.prUrl);
      } else if (!c.worktreePath) {
        this.log(c, 'error',tr('PR が {v} とコンフリクトしています（worktree を片付けたので、GitHub 上で解消してください）: {prUrl}', { v: base || tr('マージ先'), prUrl: c.prUrl }));
      }
      changed = true;
    } else if (now !== 'CONFLICTING' && c.conflict && c.conflict.pr && !active) {
      // もうコンフリクトしていない（PR が閉じられた・ほかで解消された）
      c.conflict = null;
      changed = true;
    }
    return changed;
  }

  /**
   * PR の CI の結果をカードに載せる。通ったら、自動修正の回数を数え直す
   * @returns {boolean} カードを変えたら true
   */
  updatePrChecks(c, pr) {
    const now = pr.state === 'OPEN' ? pr.checks || null : null;
    if (JSON.stringify(c.prChecks || null) === JSON.stringify(now)) return false;
    c.prChecks = now;
    if (now && now.state === 'SUCCESS' && c.ciFix) {
      if (c.ciFix.attempts > 0) {
        this.log(c, 'system', tr('CI が通りました: {url}', { url: c.prUrl }));
        this.notify(c, 'review', tr('CI が通りました: {title}', { title: c.title }), c.prUrl);
      }
      c.ciFix = null;
    }
    return true;
  }

  // CI の失敗を、コミットごとに1回だけ扱う。チェックがすべて終わってから、自動で直すか知らせるかを決める
  async handleCiFailure(c) {
    const ch = c.prChecks;
    if (!ch || ch.state !== 'FAILURE' || ch.pending > 0 || !ch.sha) return;
    if (c.ciFix && c.ciFix.sha === ch.sha) return;
    const blocked = await this.ciAutoFixBlock(c, ch);
    if (!this.store.card(c.id) || c.prChecks !== ch || (c.ciFix && c.ciFix.sha === ch.sha)) return;
    const names = ch.failed.map((x) => x.name).join(', ');
    c.ciFix = { sha: ch.sha, attempts: c.ciFix?.attempts || 0, running: false };
    if (!blocked) {
      this.log(c, 'error', tr('CI が失敗したので、自動で直します（{n}/{max} 回目）: {names}', { n: c.ciFix.attempts + 1, max: CI_FIX_MAX_ATTEMPTS, names }));
      this.startCiFix(c);
      return;
    }
    this.log(c, 'error', blocked === 'limit'
      ? tr('CI の自動修正を {max} 回試しましたが、まだ失敗しています（{names}）: {url}', { max: CI_FIX_MAX_ATTEMPTS, names, url: c.prUrl })
      : tr('CI が失敗しました（{names}）: {url}', { names, url: c.prUrl }));
    this.notify(c, 'failed', tr('CI が失敗しました: {title}', { title: c.title }), names);
    this.changed(c);
  }

  // 自動で直してはいけないときは、その理由（'limit' / 'off' / 'busy'）を返す
  async ciAutoFixBlock(c, ch) {
    if (this.store.repoSettings(c.repoPath).ciAutoFix === false) return 'off';
    if ((c.ciFix?.attempts || 0) >= CI_FIX_MAX_ATTEMPTS) return 'limit';
    if (!c.worktreePath || c.status !== 'review' || c.awaitingReply || c.conflict || c.prMergeable === 'CONFLICTING') return 'busy';
    if (this.merging?.has(c.id) || c.relay?.waiting || c.subtasks?.phase === 'run') return 'busy';
    try {
      // 手元に PR に入っていない作業があるときは、勝手に混ぜて push しない
      if ((await git.revParse(c.worktreePath, 'HEAD')) !== ch.sha || (await git.isDirty(c.worktreePath))) return 'busy';
    } catch {
      return 'busy';
    }
    return null;
  }

  startCiFix(c) {
    const ch = c.prChecks;
    c.ciFix = { sha: ch.sha, attempts: (c.ciFix?.attempts || 0) + 1, running: true };
    const prompt = buildCiFixPrompt(c, ch);
    this.log(c, 'user', prompt);
    this.enqueue(c, prompt);
  }

  // 「直してもらう」ボタン。自動修正を切っているとき・上限に達したときも、ここからは頼める
  fixCi(id) {
    const c = this.must(id);
    if (!c.prUrl || c.prState !== 'OPEN' || c.prChecks?.state !== 'FAILURE') throw new Error(tr('CI は失敗していません'));
    if (!c.worktreePath) throw new Error(tr('worktree がないので、アプリの中では直せません。GitHub 上で直してください'));
    if (!['review', 'failed'].includes(c.status)) throw new Error(tr('実行中は直し始められません'));
    if (c.conflict) throw new Error(tr('コンフリクトを解消してから直してください'));
    if (this.merging?.has(id)) throw new Error(tr('処理中です'));
    this.assertNotInRelayJoin(c);
    this.startCiFix(c);
  }

  // CI を直す実行が終わったら、PR のブランチに push して、もう一度 CI を動かす
  async pushCiFix(c) {
    if (!c.worktreePath || !c.prUrl || this.merging?.has(c.id)) return;
    this.merging = this.merging || new Set();
    this.merging.add(c.id);
    try {
      if ((await git.revParse(c.worktreePath, 'HEAD')) === c.ciFix?.sha) {
        this.log(c, 'error', tr('CI を直す変更はありませんでした。内容を確かめてください: {url}', { url: c.prUrl }));
        this.notify(c, 'failed', tr('CI を自動で直せませんでした: {title}', { title: c.title }), c.lastText || c.prUrl);
        return;
      }
      await git.push(c.worktreePath, 'origin', c.branch, true);
      this.log(c, 'system', tr('CI の修正を push しました。結果を確かめます: {url}', { url: c.prUrl }));
      c.prChecks = null;
      c.prMergeable = null;
      this.changed(c);
    } catch (err) {
      this.log(c, 'error', tr('CI の修正を push できませんでした: {message}', { message: err.message }));
      this.notify(c, 'failed', tr('CI の修正を push できませんでした: {title}', { title: c.title }), err.message);
    } finally {
      this.merging.delete(c.id);
    }
  }

  raisePrConflict(c, base) {
    c.conflict = { target: base, files: [], pr: true, push: true, keep: true, at: Date.now() };
    c.conflictResolved = null;
  }

  // 閉じたコンフリクトの案内を、もう一度出す（PR がコンフリクトしているあいだだけ）
  reopenPrConflict(id) {
    const c = this.must(id);
    if (!c.prUrl || c.prState !== 'OPEN' || c.prMergeable !== 'CONFLICTING') throw new Error(tr('PR はコンフリクトしていません'));
    if (!c.worktreePath) throw new Error(tr('worktree がないので、アプリの中では解消できません。GitHub 上で解消してください'));
    if (!['review', 'failed'].includes(c.status)) throw new Error(tr('実行中は解消を始められません'));
    if (c.conflict) return c.conflict;
    this.raisePrConflict(c, c.prBase || c.baseBranch);
    this.changed(c);
    return c.conflict;
  }

  // worktree に、マージされた PR に入っていない作業が残っていれば、その説明を返す（なければ null）
  async unmergedWork(c, headRefOid) {
    const wt = c.worktreePath;
    if (!fs.existsSync(wt)) return null;
    try {
      if (await git.mergeInProgress(wt)) return tr('コンフリクトの解消中');
      if (await git.isDirty(wt, { untracked: true })) return tr('未コミットの変更');
      if (!headRefOid) return tr('PR の最後のコミットが分からない');
      const ahead = await git.countCommits(c.repoPath, `${headRefOid}..${c.branch}`);
      return ahead > 0 ? tr('PR にないコミット {n} 件', { n: ahead }) : null;
    } catch {
      // PR の最後のコミットが手元にないなど。消してよいか分からないので残す
      return tr('PR と手元のブランチを比べられない');
    }
  }

  // origin の target を取ってきて、ローカルの target を早送りでそろえる。origin に target があれば true
  async syncWithOrigin(c, top, target) {
    const remote = 'origin';
    if (!(await git.hasRemote(top, remote))) throw new Error(tr('このリポジトリには origin がありません。push せずにマージするか、origin を設定してください'));
    let has;
    try {
      has = await git.fetchBranch(top, remote, target);
    } catch (err) {
      throw new Error(tr('origin の最新を取ってこられませんでした（ネットワークや GitHub のログインを確認してください）。\n{message}', { message: err.message }));
    }
    if (!has) return false;
    const behind = await git.countCommits(top, `${target}..${remote}/${target}`);
    const localAhead = await git.countCommits(top, `${remote}/${target}..${target}`);
    if (behind > 0 && localAhead > 0) {
      throw new Error(tr('ローカルの {target} と origin/{target2} が別々に進んでいます。先にターミナルで {target3} を origin/{target4} とそろえてから（git pull など）、もう一度マージしてください', { target, target2: target, target3: target, target4: target }));
    }
    if (behind > 0) {
      const dir = await git.worktreeForBranch(top, target);
      if (dir && (await git.isDirty(dir))) throw new Error(tr('{target} をチェックアウトしている {dir} に未コミットの変更があるため、origin の最新を取り込めません', { target, dir }));
      await git.fastForward(top, target, `${remote}/${target}`, dir);
      this.log(c, 'system',tr('origin/{target} の新しいコミット {behind} 件をローカルの {target2} に取り込みました', { target, behind, target2: target }));
    }
    return true;
  }

  // ---------- コンフリクトの解消 ----------

  /**
   * マージ先のブランチをタスクの worktree に取り込み、コンフリクトを解消する
   * @param {'agent'|'manual'} mode  agent: エージェントに解消してもらう / manual: 自分でエディタで直す
   */
  async resolveConflict(id, mode) {
    const c = this.must(id);
    if (isChat(c)) throw new Error(tr('会話にはコンフリクトはありません'));
    if (!c.conflict) throw new Error(tr('コンフリクトはありません'));
    if (!['review', 'failed'].includes(c.status)) throw new Error(tr('実行中は解消を始められません'));
    const wt = c.worktreePath;
    const target = c.conflict.target;
    let files;
    if (await git.mergeInProgress(wt)) {
      files = await git.conflictFiles(wt);
    } else {
      await git.commitAll(wt, this.commitMessage(c));
      let ref = target;
      if (c.conflict.pr) {
        // PR のコンフリクトは、GitHub 上のマージ先（origin/<base>）と起きているので、それを取り込む
        let has;
        try {
          has = await git.fetchBranch(c.repoPath, 'origin', target);
        } catch (err) {
          throw new Error(tr('origin の最新を取ってこられませんでした（ネットワークや GitHub のログインを確認してください）。\n{message}', { message: err.message }));
        }
        if (!has) throw new Error(tr('origin に {target} が見つかりません', { target }));
        ref = `origin/${target}`;
      } else if (c.conflict.push) await this.syncWithOrigin(c, c.repoPath, target);
      files = await git.startMerge(wt, ref);
      this.log(c, 'system',tr('{ref} をタスクのブランチに取り込み始めました', { ref }));
      if (!files.length) {
        await git.finishMerge(wt);
        this.markResolved(c, tr('コンフリクトなしで取り込めました'));
        return { resolved: true };
      }
    }
    c.conflict = { ...c.conflict, files, manual: mode === 'manual', resolving: mode === 'agent', unresolved: undefined };
    if (mode === 'manual') {
      this.log(c, 'system',tr('自分で解消するモード: {wt} の {v} を直してから「解消した」を押してください', { wt, v: files.join(', ') }));
      this.changed(c);
      return { manual: true, path: wt };
    }
    const prompt = [
      `ブランチ \`${c.conflict.pr ? `origin/${target}` : target}\` をこのブランチに取り込もうとしたところ、コンフリクトが起きました（git merge は途中の状態です）。`,
      '',
      'コンフリクトしているファイル:',
      ...files.map((f) => `- ${f}`),
      '',
      'それぞれのファイルの <<<<<<< / ======= / >>>>>>> を、両方の変更の意図を保つように解消してください。',
      `解消したら \`git add\` してから \`git commit --no-edit\` でマージを完了してください。テストがあれば実行して確かめてください。`,
      '最後に、どう解消したかを短くまとめてください。',
    ].join('\n');
    this.log(c, 'user', prompt);
    this.enqueue(c, prompt);
    return { agent: true };
  }

  // 自分で直したあと「解消した」
  async completeConflict(id) {
    const c = this.must(id);
    if (!c.conflict) throw new Error(tr('コンフリクトはありません'));
    const wt = c.worktreePath;
    if (!(await git.mergeInProgress(wt))) {
      const marked = await git.filesWithMarkers(wt, c.conflict.files);
      if (marked.length) throw new Error(tr('まだコンフリクトの印（<<<<<<< など）が残っています: {v}', { v: marked.join(', ') }));
      this.markResolved(c, tr('コンフリクトを解消しました'));
      return;
    }
    // git add 済みでも、印が残っていればまだ
    const marked = await git.filesWithMarkers(wt, c.conflict.files);
    if (marked.length) throw new Error(tr('まだコンフリクトの印（<<<<<<< など）が残っています: {v}', { v: marked.join(', ') }));
    await git.finishMerge(wt);
    this.markResolved(c, tr('コンフリクトを解消して、取り込みを完了しました'));
  }

  async abortConflict(id) {
    const c = this.must(id);
    if (c.worktreePath && (await git.mergeInProgress(c.worktreePath))) await git.abortMerge(c.worktreePath);
    if (c.conflict) c.conflict = { ...c.conflict, manual: false, resolving: false, unresolved: undefined };
    this.log(c, 'system',tr('取り込みを中止しました'));
    this.changed(c);
  }

  dismissConflict(id) {
    const c = this.must(id);
    c.conflict = null;
    c.conflictResolved = null;
    this.changed(c);
  }

  markResolved(c, msg) {
    // サブタスクのマージでのコンフリクト: そのサブタスクはマージできたので、残りのサブタスクへ進む
    if (c.conflict.subtask && c.subtasks) {
      const kid = this.store.card(c.conflict.subtask);
      const item = c.subtasks.items.find((x) => x.cardId === c.conflict.subtask);
      c.conflict = null;
      c.conflictResolved = null;
      c.error = null;
      this.log(c, 'system',tr('{msg}。サブタスクの続きへ進みます', { msg }));
      if (item) this.settleSubtaskMerge(c, item, kid);
      this.changed(c);
      setImmediate(() => this.advanceSubtasks(c.id));
      return;
    }
    // Pipelineの合流でのコンフリクト: その枝はマージできたので、残りの枝のマージと次の工程へ進む
    if (c.conflict.join && c.relay && c.relay.waiting) {
      const w = c.relay.waiting;
      if (!w.merged.includes(c.conflict.join)) w.merged.push(c.conflict.join);
      c.conflict = null;
      c.conflictResolved = null;
      c.error = null;
      this.log(c, 'system',tr('{msg}。合流の続き（残りの枝のマージと次の工程）へ進みます', { msg }));
      this.changed(c);
      setImmediate(() => this.tryJoin(c.id)); // エージェントが解消したときは、動き終わってから（tryJoin は動いている間は何もしない）
      return;
    }
    const pr = !!c.conflict.pr;
    c.conflictResolved = { target: c.conflict.target, push: c.conflict.push, keep: c.conflict.keep, ...(pr ? { pr: true } : {}) };
    c.conflict = null;
    this.log(c, 'system', pr ? tr('{msg}。PR を更新（push）すると、GitHub 上のコンフリクトも解消されます', { msg }) : tr('{msg}。もう一度マージすると、コンフリクトなしでマージできます', { msg }));
    this.changed(c);
  }

  // エージェントの作業が終わったとき: コンフリクトの解消中なら、ちゃんと解消できたかを確かめる
  async afterConflictRun(c) {
    const wt = c.worktreePath;
    if (!c.conflict || !c.conflict.resolving) {
      // 取り込みの途中（自分で解消中）なら、印の残ったファイルをコミットしない
      return !(await git.mergeInProgress(wt));
    }
    const inProgress = await git.mergeInProgress(wt);
    const marked = await git.filesWithMarkers(wt, c.conflict.files);
    const unmerged = inProgress ? await git.conflictFiles(wt) : [];
    const left = [...new Set([...marked, ...unmerged])];
    if (left.length) {
      c.conflict = { ...c.conflict, resolving: false, manual: inProgress, unresolved: left };
      this.log(c, 'error',tr('コンフリクトがまだ残っています: {v}。もう一度 {agentShort} に頼むか、自分で直してください', { v: left.join(', '), agentShort: agentShort(agentOf(c)) }));
      return false;
    }
    if (inProgress) await git.finishMerge(wt);
    this.markResolved(c, tr('{who} がコンフリクトを解消しました', { who: agentShort(agentOf(c)) }));
    return true;
  }

  /**
   * git で管理していないフォルダのタスクを「完了」にする（マージや PR の代わり。フォルダの中身はそのまま）
   */
  complete(id) {
    const c = this.must(id);
    if (!isNoGit(c)) throw new Error(tr('git のリポジトリのタスクは、マージか PR の作成で完了にしてください'));
    if (!['review', 'failed'].includes(c.status)) throw new Error(tr('レビュー中のタスクだけ完了にできます'));
    c.status = 'done';
    c.error = null;
    c.interrupted = null;
    c.awaitingReply = false;
    c.completedAt = Date.now();
    this.log(c, 'system',tr('タスクを完了にしました'));
    this.completed(c);
    this.changed(c);
    this.checkCompetitionDone(c);
  }

  // 完了したタスク（完了後の会話の途中も含む）は削除できない。会話（chat）は対象外
  isUndeletable(c) {
    return !!c && !isChat(c) && (c.status === 'done' || !!c.afterDone);
  }

  // Pipelineの並列の途中（枝を待っている・枝のタスク）は、マージ・PR の作成ができない
  assertNotInRelayJoin(c) {
    if (c.subtaskOf && this.subtaskParentOf(c)) throw new Error(tr('サブタスクは、親のタスクのブランチに取り込みます。「親のタスクに取り込む」を使うか、自動でマージされるのを待ってください'));
    if (c.subtasks && (c.subtasks.phase === 'run' || (c.subtasks.phase === 'plan' && c.status !== 'todo'))) throw new Error(tr('サブタスクがすべて終わって、親のタスクの仕上げが済んでから取り込んでください'));
    if (c.relay && c.relay.waiting) throw new Error(tr('Pipelineの並列の枝が終わるのを待っています。合流してPipelineが終わってから取り込んでください'));
    if (this.relayParentOf(c)) throw new Error(tr('Pipelineの並列の枝のタスクは、合流で元のタスクにマージします。元のタスクから取り込んでください'));
  }

  async discard(id) {
    const c = this.must(id);
    this.assertNotRewinding(c);
    if (this.isUndeletable(c)) throw new Error(tr('完了したタスクは削除できません'));
    // 並列の枝を待っているカードを消すときは、枝のタスクも消す。枝のタスクを消したら、親は合流できなくなる
    const kids = c.relay && c.relay.waiting ? [...c.relay.waiting.children] : [];
    // サブタスクのある親を消すときは、サブタスクも消す
    if (c.subtasks) for (const x of c.subtasks.items) if (x.cardId && x.state === 'running') kids.push(x.cardId);
    const parent = this.relayParentOf(c);
    const subParent = this.subtaskParentOf(c);
    const child = this.procs.get(id);
    this.store.removeCard(id);
    this.denyAllPending(id, tr('破棄されました'));
    if (child) {
      killTree(child);
      await new Promise((r) => (child.exitCode !== null ? r() : child.once('close', r)));
    }
    if (c.worktreePath) await this.removeWorktreeOf(c, c.repoPath);
    else await this.stopRunningScript(id);
    this.scriptRuns.delete(id);
    if (c.branch && c.status !== 'done' && !c.afterDone) await git.deleteBranch(c.repoPath, c.branch);
    fs.rmSync(path.join(this.opts.mcpDir, `${id}.json`), { force: true });
    attachments.removeCardAttachments(this.attachRoot, id);
    this.changed(null);
    for (const k of kids) if (this.store.card(k)) await this.discard(k);
    if (parent) this.tryJoin(parent.id);
    if (subParent) {
      // サブタスクを破棄した（マージして片付けたときは、もう merged になっている）
      const item = subParent.subtasks.items.find((x) => x.cardId === id);
      if (item && item.state === 'running') {
        item.state = 'skipped';
        this.log(subParent, 'system',tr('サブタスク「{title}」が破棄されたので、マージせずに先へ進みます', { title: item.title }));
        this.changed(subParent);
      }
      this.advanceSubtasks(subParent.id);
    }
  }
}

module.exports = { READ_ONLY_DISALLOWED_TOOLS, withReadOnlyNote, relayStepsOf, whoLabel, AgentManager, isNoGit, toolResultText, toolResultImages, agentOf, promptWithSkill, buildRelayStepPrompt, buildComparePrompt, PERMISSION_TOOL, endsWithQuestion, SPEC_MARKER, withSpecCheck, stripSpecMarker, extractSpecQuestions, parseMarkdownQuestions, isOtherOption, withReplyLanguage, isQuitInterrupt, SKILL_SUGGEST_PROMPT, SKILL_SUGGEST_REPEAT_NOTE, buildSkillSuggestPrompt, isChat, isSessionId, quoteForCmd, cleanBranchName, buildBranchNamePrompt, cleanModel, modelOf };
