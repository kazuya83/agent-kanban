// カード（タスク）ごとに worktree を作り、Claude Code CLI を並列に動かす
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const git = require('./git');
const { resolveCommand, isWin } = require('./env');
const github = require('./github');
const ghCli = require('./gh');
const { withSkill } = require('./skills');

const MAX_LOGS = 2000;
const MCP_SERVER_NAME = 'agent_kanban';
const PERMISSION_TOOL = `mcp__${MCP_SERVER_NAME}__approve`;
const INTERRUPTED_MESSAGE = 'アプリの終了で中断されました。「▶ 再開」で中断したところから続けられます（追加指示を送っても再開できます）。';
// 作業のあとに「スキルにしておくとよいもの」を提案してもらうときの指示
const SKILL_SUGGEST_PROMPT = [
  'ここまでの作業を振り返って、次から同じような作業をもっと速く・確実にできるように、Claude Code のスキル（SKILL.md）として残しておくとよさそうなものを提案してください。',
  '',
  '- 候補は1〜3個にしてください。それぞれ「スキル名」「何をするスキルか」「どんなときに使うか」「SKILL.md に書く手順の概要」を書いてください',
  '- すでにあるスキル（このリポジトリの .claude/skills/ と ~/.claude/skills/）を確かめて、重ならないようにしてください',
  '- 置き場所は、このリポジトリ用（.claude/skills/<名前>/SKILL.md）か、自分用（~/.claude/skills/<名前>/SKILL.md）のどちらがよいかも書いてください',
  '- まだファイルは作らないでください。最後に「どれを追加しますか？」と聞いてください',
].join('\n');
// スキルの提案を頼む会話の最初の指示。元のタスクの指示・やりとり・結果をまとめて渡す
function buildSkillSuggestPrompt(c) {
  const lines = [`次のタスク「${c.title}」の作業を振り返ってください。`, ''];
  lines.push('## タスクの指示', truncate(c.prompt, 3000), '');
  const talk = (c.logs || [])
    .filter((l) => (l.kind === 'user' && l.text !== c.prompt) || l.kind === 'text')
    .map((l) => `${l.kind === 'user' ? '【ユーザー】' : '【Claude】'} ${truncate(String(l.text).trim(), 800)}`);
  if (talk.length) {
    let picked = [];
    let size = 0;
    for (let i = talk.length - 1; i >= 0 && size < 6000; i--) {
      picked.unshift(talk[i]);
      size += talk[i].length;
    }
    if (picked.length < talk.length) picked = ['（前のやりとりは省略）', ...picked];
    lines.push('## やりとり（抜粋）', ...picked, '');
  }
  const info = [];
  if (c.issue) info.push(`- Issue: #${c.issue.number} ${c.issue.url || ''}`.trim());
  if (c.branch) info.push(`- ブランチ: ${c.branch}`);
  if ((c.mergedInto || []).length) info.push(`- 取り込み先: ${c.mergedInto.join(', ')}（git log で変更を確かめられます）`);
  if (c.prUrl) info.push(`- PR: ${c.prUrl}`);
  if (c.worktreePath && !isChat(c)) info.push(`- 作業フォルダ: ${c.worktreePath}`);
  if (info.length) lines.push('## 結果', ...info, '');
  lines.push('---', '', SKILL_SUGGEST_PROMPT.replace('ここまでの作業を振り返って', 'このタスクの作業をもとに'));
  return lines.join('\n');
}
const RESUME_PROMPT = '前回の作業は、アプリの終了で途中で中断されました。worktree の今の状態（git status / git diff など）を確かめて、中断したところから作業を続けてください。';
const CHAT_RESUME_PROMPT = '前回の返事は、アプリの終了で途中で中断されました。中断したところから続けてください。';

// タスクに紐づかない会話（チャット）か。worktree もブランチも作らず、リポジトリのフォルダでそのまま話す
function isChat(c) {
  return !!c && c.kind === 'chat';
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
  if (!isSessionId(id)) throw new Error('会話（セッション）の ID が正しくありません');
  return id;
}

// Windows で .cmd / .bat をシェル（cmd.exe）経由で起動するときの引数のクオート。
// cmd.exe では " の中でも % の展開が効き、\" ではクオートを抜けられてしまうので、そうした文字を含む引数は拒否する
function quoteForCmd(a) {
  const s = String(a);
  if (/["%!\r\n\0]/.test(s)) throw new Error(`この値はコマンドの引数に使えません: ${truncate(s, 60)}`);
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
  if (Array.isArray(content)) return content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  return '';
}

function notFoundMessage(cmd) {
  return `claude コマンドが見つかりません（${cmd}）。Claude Code をインストールするか、設定で claude のパスを指定してください。`;
}

// スキル名を整える（先頭の / は取る。空なら null）
function cleanSkill(s) {
  const v = String(s || '').trim().replace(/^\//, '');
  return v || null;
}

// Claude の最後の返事が、ユーザーへの質問で終わっているか
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

// 設定の「ブランチの命名規則」（自然言語）から、Claude にブランチ名を考えてもらうときの指示
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

// Claude の返事からブランチ名を取り出して、使えない文字を落とす
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

function killTree(child) {
  if (!child || child.exitCode !== null) return;
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
    this.pending = new Map(); // permission request id -> { cardId, toolName, input, resolve }
    this.permission = null; // { port, token }
    this.recoverInterrupted();
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
      if (c.status === 'queued') {
        // まだ claude に渡していない指示なので、そのまま渡し直せばよい
        c.interrupted = { at: now, kind: 'queued', prompt: c.pendingPrompt || withSkill(c.skill, c.prompt) };
        c.status = c.worktreePath || isChat(c) ? 'review' : 'todo';
        c.error = null;
      }
      if (c.status === 'running') {
        // 会話が始まっていれば同じ会話の続きから、始まる前なら同じ指示をもう一度渡す
        const resumePrompt = isChat(c) ? CHAT_RESUME_PROMPT : RESUME_PROMPT;
        c.interrupted = { at: now, kind: 'running', prompt: c.sessionId ? resumePrompt : c.lastPromptSent || withSkill(c.skill, c.prompt) };
        c.status = 'failed';
        c.error = INTERRUPTED_MESSAGE;
      }
      c.pendingPrompt = null;
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
    if (!it) throw new Error('このタスクは中断されていません');
    if (c.status === 'running' || c.status === 'queued') throw new Error('このタスクはもう動いています');
    if (it.kind === 'running') this.log(c, 'user', it.prompt === RESUME_PROMPT || it.prompt === CHAT_RESUME_PROMPT ? '（中断したところから再開）' : it.prompt);
    else this.log(c, 'system', '中断されていた指示で再開します');
    this.enqueue(c, it.prompt);
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
    if (c.status === 'failed' && c.error === INTERRUPTED_MESSAGE) c.status = 'review';
    if (c.error === INTERRUPTED_MESSAGE) c.error = null;
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
    for (const [id, child] of this.procs) {
      const c = this.store.card(id);
      if (c) this.log(c, 'system', 'アプリを終了するため中断しました。次に起動したときに「再開」できます');
      this.denyAllPending(id, 'アプリを終了します');
      killTree(child);
    }
    const done = Promise.all(runs.map((r) => r.done));
    await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs).unref())]);
    this.store.flush();
  }

  // ---------- 参照 ----------

  publicCards(repoPath) {
    return this.store.cards
      .filter((c) => !repoPath || c.repoPath === repoPath)
      .map(({ logs, finalDiff, ...rest }) => rest);
  }

  must(id) {
    const c = this.store.card(id);
    if (!c) throw new Error('タスクが見つかりません');
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
    if (c.status === 'running' || c.status === 'queued') return 'inProgress';
    if (c.status === 'review' || c.status === 'failed') return 'inReview';
    // PR を作って片付けただけのときは、まだ取り込まれていないので In review のまま（PR のマージを見つけたら Done にする）
    if (c.status === 'done') return (c.mergedInto && c.mergedInto.length) || c.prMergedAt ? 'done' : 'inReview';
    return null;
  }

  // Issue から作ったカードの列が変わったら、Issue が入っている Project の Status を合わせる（裏で順番に動かす）
  queueIssueSync(c) {
    if (!c.issue || this.store.settings.issueStatusSync === false) return;
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
      for (const u of r.updated) this.log(c, 'system', `GitHub Projects「${u.project}」で #${c.issue.number} のステータスを ${u.to} にしました${u.from ? `（前は ${u.from}）` : ''}`);
      for (const s of r.skipped) {
        const msg = `GitHub Projects「${s.project}」のステータスは変えませんでした: ${s.reason}`;
        if (c.issueSync.lastSkip !== msg) this.log(c, 'system', msg);
        c.issueSync.lastSkip = msg;
      }
      if (!r.projects && !c.issueSync.noProject) {
        c.issueSync.noProject = true;
        this.log(c, 'system', `#${c.issue.number} はどの GitHub Projects にも入っていないので、ステータスは変えませんでした`);
      }
    } catch (err) {
      if (!this.store.card(c.id)) return;
      // 同じエラーは何度も出さない
      if (c.issueSync.error !== err.message) this.log(c, 'error', `GitHub Projects のステータスを変えられませんでした: ${err.message}`);
      c.issueSync.error = err.message;
    }
    this.store.save();
    this.emit('changed', c.id);
  }

  // テストで差し替えられるようにメソッドにしておく
  setIssueProjectStatus(repoPath, number, key) {
    const s = this.store.settings;
    return github.setIssueProjectStatus(repoPath, number, key, { gh: this.opts.ghPath, fieldName: s.statusFieldName, mapping: s.statusMapping });
  }

  // 実行中の Projects の更新が終わるまで待つ（テスト・終了時用）
  async flushIssueSync() {
    while (this.issueSyncs && this.issueSyncs.size) await Promise.all([...this.issueSyncs.values()]);
  }

  log(card, kind, text, extra) {
    const entry = { t: Date.now(), kind, text, ...(extra || {}) };
    card.logs = card.logs || [];
    card.logs.push(entry);
    if (card.logs.length > MAX_LOGS) card.logs.splice(0, card.logs.length - MAX_LOGS);
    this.emit('log', card.id, entry);
  }

  // ---------- 通知（右上のベル） ----------

  /**
   * 通知を足す。右上の通知一覧に出し、'notification' イベントでデスクトップ通知にも使う
   * @param {object} c カード
   * @param {string} kind permission / question / awaiting / review / failed / done / skill
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
    if (!n) throw new Error('通知が見つかりません');
    if (!n.action || n.actedAt) throw new Error('この通知はもう対応済みです');
    let result = null;
    if (n.action === 'suggestSkills') result = { cardId: this.suggestSkills(n.cardId).id };
    else throw new Error(`知らない操作です: ${n.action}`);
    n.actedAt = Date.now();
    n.read = true;
    this.store.save();
    this.emit('changed', n.cardId);
    return result;
  }

  // タスクが「完了」に入ったときに呼ぶ。完了の通知と、スキルにしませんか？の通知を出す
  completed(c) {
    const body = (c.mergedInto || []).length ? `${c.mergedInto.join(', ')} に取り込みました` : c.prUrl ? `PR を作って片付けました: ${c.prUrl}` : 'タスクを完了にしました';
    this.notify(c, 'done', `完了: ${c.title}`, body);
    if (this.store.settings.suggestSkillsOnDone === false || !c.sessionId || c.skillSuggestNotified) return;
    c.skillSuggestNotified = true;
    this.notify(
      c,
      'skill',
      `スキルにしませんか？: ${c.title}`,
      'このタスクの作業を振り返って、次から同じような作業を速く・確実にできるスキル（SKILL.md）を Claude に提案してもらえます。',
      { action: 'suggestSkills', actionLabel: '💡 スキルを提案してもらう' },
    );
  }

  // ---------- カード操作 ----------

  createCard({ title, prompt, issue, session, skill }) {
    const s = this.store.settings;
    if (!s.repoPath) throw new Error('先にリポジトリを選んでください');
    if (!prompt || !prompt.trim()) throw new Error('指示を入力してください');
    const card = {
      id: crypto.randomBytes(4).toString('hex'),
      title: (title && title.trim()) || truncate(prompt.trim().split('\n')[0], 40),
      prompt: prompt.trim(),
      status: 'todo',
      repoPath: s.repoPath,
      createdAt: Date.now(),
      permissions: [],
      alwaysAllow: [],
      logs: [],
    };
    if (issue) card.issue = { number: issue.number, title: issue.title, url: issue.url };
    card.sessions = [];
    if (session && session.id) this.applySession(card, session);
    card.skill = cleanSkill(skill);
    this.store.cards.push(card);
    this.changed(card);
    return card;
  }

  /**
   * タスクに紐づかない会話（チャット）を作って、すぐに話し始める。
   * worktree もブランチも作らず、リポジトリのフォルダでそのまま Claude と話す（コミット・マージはしない）
   * @param {{ message: string, title?: string, session?: object, skill?: string }} p
   */
  createChat({ message, title, session, skill }) {
    const s = this.store.settings;
    if (!s.repoPath) throw new Error('先にリポジトリを選んでください');
    const text = String(message || '').trim();
    if (!text) throw new Error('メッセージを入力してください');
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
    };
    if (session && session.id) this.applySession(card, session);
    card.skill = cleanSkill(skill);
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
  async createFromIssues({ numbers, extra, session, skill }) {
    const s = this.store.settings;
    if (!s.repoPath) throw new Error('先にリポジトリを選んでください');
    const list = github.parseIssueNumbers(numbers);
    const cards = [];
    const errors = [];
    for (const n of list) {
      const dup = this.store.cards.find((c) => c.repoPath === s.repoPath && c.issue && c.issue.number === n && c.status !== 'done');
      if (dup) {
        errors.push(`#${n}: もうタスクがあります（「${dup.title}」）`);
        continue;
      }
      try {
        const issue = await this.fetchIssue(s.repoPath, n);
        if (issue.state && issue.state !== 'open') errors.push(`#${n} はクローズ済みですが、タスクを作りました`);
        cards.push(this.createCard({ title: `#${issue.number} ${issue.title}`, prompt: github.buildIssuePrompt(issue, extra), issue, session, skill }));
      } catch (err) {
        errors.push(`#${n}: ${err.message}`);
      }
    }
    if (!cards.length) throw new Error(errors.join('\n'));
    return { cards, errors };
  }

  // テストで差し替えられるようにメソッドにしておく
  fetchIssue(repoPath, n, opts) {
    return github.fetchIssue(repoPath, n, opts);
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
      c.sessions.push({ id, at: Date.now(), origin: 'task', label: truncate(String(c.lastPromptSent || c.prompt).split('\n')[0], 60), from: from ? from.id : undefined });
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
    if (c.status === 'running' || c.status === 'queued') throw new Error('実行中・待機中は会話を切り替えられません');
    this.applySession(c, session);
    const label = !c.sessionId ? '新しい会話' : c.forkNext ? `既存の会話（${(session.title || session.id).slice(0, 40)}）を引き継ぐ` : `このカードの会話 ${c.sessionId.slice(0, 8)}`;
    this.log(c, 'system', `次の実行は「${label}」で始めます`);
    this.changed(c);
  }

  commitMessage(c) {
    return c.issue ? `agent: ${c.title.replace(/^#\d+\s*/, '')} (#${c.issue.number})` : `agent: ${c.title}`;
  }

  updateCard(id, { title, prompt, skill }) {
    const c = this.must(id);
    if (c.status !== 'todo') throw new Error('開始前のタスクだけ編集できます');
    if (skill !== undefined) c.skill = cleanSkill(skill);
    if (typeof title === 'string' && title.trim()) c.title = title.trim();
    if (typeof prompt === 'string' && prompt.trim()) c.prompt = prompt.trim();
    this.changed(c);
  }

  start(id) {
    const c = this.must(id);
    if (c.status !== 'todo') throw new Error('このタスクはもう開始しています');
    this.log(c, 'user', c.prompt, c.skill ? { skill: c.skill } : undefined);
    this.enqueue(c, withSkill(c.skill, c.prompt));
  }

  send(id, message, skill) {
    const c = this.must(id);
    if (!['review', 'failed', 'done'].includes(c.status)) throw new Error('実行中・待機中は追加指示を送れません');
    if (!message || !message.trim()) throw new Error('追加指示を入力してください');
    skill = cleanSkill(skill);
    if (c.status === 'done') this.reopen(c);
    this.log(c, 'user', message.trim(), skill ? { skill } : undefined);
    this.enqueue(c, withSkill(skill, message.trim()));
  }

  /**
   * スキルにしておくとよいものを提案してもらう。
   * 元のタスクのカードは使い回さず（完了したタスクを開き直したり、worktree を作り直したりしない）、
   * 新しい会話のカードを作って、元のタスクの中身を渡して提案してもらう
   * @returns {object} 作った会話のカード
   */
  suggestSkills(id) {
    const src = this.must(id);
    const chat = this.createChat({ message: buildSkillSuggestPrompt(src), title: `💡 スキルの提案: ${src.title}` });
    chat.skillSuggestFrom = src.id;
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
   * 完了（マージ済み）のタスクで、会話を続けられるようにする。
   * worktree は前と同じ場所に作り直す（claude の会話は作業フォルダごとに保存されているので、
   * 同じ場所なら --resume でそのまま続きから話せる）。ベースはマージ先のブランチ
   */
  reopen(c) {
    c.reopenBase = c.lastMergeTarget || c.prBase || c.baseBranch || null;
    c.reopenFrom = c.branch || null;
    c.worktreePath = null;
    c.conflict = null;
    c.conflictResolved = null;
    this.log(c, 'system', `完了したタスクの続きを始めます（${c.reopenBase || 'ベースブランチ'} から worktree を作り直します）`);
  }

  enqueue(c, prompt) {
    if (this.shuttingDown) throw new Error('アプリを終了しています');
    c.interrupted = null;
    c.awaitingReply = false;
    c.lastText = '';
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
      this.changed(c);
      this.launch(c).catch((err) => this.fail(c, err.message));
    }
  }

  fail(c, msg) {
    this.procs.delete(c.id);
    if (!this.store.card(c.id)) return;
    c.status = 'failed';
    c.error = msg;
    this.log(c, 'error', msg);
    this.changed(c);
    this.pump();
  }

  stop(id) {
    const c = this.must(id);
    if (c.status === 'queued') {
      c.status = c.worktreePath || isChat(c) ? 'review' : 'todo';
      this.changed(c);
      return;
    }
    const child = this.procs.get(id);
    if (!child) throw new Error('実行中ではありません');
    c.stopRequested = true;
    this.denyAllPending(id, '停止されました');
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
    if (!top) throw new Error(`${c.repoPath} は git リポジトリではありません`);
    const reopen = c.reopenBase && (await git.branchExists(top, c.reopenBase)) ? c.reopenBase : null;
    const base = reopen || this.store.settings.baseBranch || (await git.currentBranch(top));
    if (base === 'HEAD') throw new Error('ベースブランチが決まりません（detached HEAD）。設定でベースブランチを指定してください');
    const baseCommit = await git.revParse(top, base);
    let branch = c.issue ? `agent/issue-${c.issue.number}-${c.id}` : `agent/${slugify(c.title)}-${c.id}`;
    const rule = String(this.store.settings.branchNamingRule || '').trim();
    if (rule) {
      // 続きのときは前と同じ名前から番号を付けていく
      const prev = c.reopenFrom !== undefined && c.namedBranch ? c.namedBranch : null;
      try {
        const named = prev || (await this.generateBranchName(c, rule, top));
        await git.checkBranchName(top, named);
        branch = named;
        c.namedBranch = named;
      } catch (err) {
        this.log(c, 'error', `命名規則からブランチ名を決められなかったので、いつもの名前にします: ${err.message}`);
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
      c.finalDiff = null;
      delete c.reopenBase;
      delete c.reopenFrom;
    }
    this.log(c, 'system', `worktree を作成しました: ${wt}（ブランチ ${branch} / ベース ${base}）`);
    this.changed(c);
  }

  /**
   * 設定の命名規則（自然言語）に従ったブランチ名を、claude に1回だけ聞いて決める
   * @returns {Promise<string>}
   */
  generateBranchName(c, rule, cwd) {
    const s = this.store.settings;
    const cmd = s.claudePath || 'claude';
    const resolved = resolveCommand(cmd);
    if (!resolved) return Promise.reject(new Error(notFoundMessage(cmd)));
    this.log(c, 'system', '命名規則に従ってブランチ名を考えてもらっています…');
    const args = ['-p', '--output-format', 'text', '--permission-mode', 'default'];
    if (s.model) args.push('--model', s.model);
    const useShell = isWin && /\.(cmd|bat)$/i.test(resolved);
    const quote = (a) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    return new Promise((resolve, reject) => {
      const child = spawn(useShell ? quote(resolved) : resolved, useShell ? args.map(quote) : args, { cwd, shell: useShell, windowsHide: true });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        killTree(child);
        reject(new Error('時間がかかりすぎました'));
      }, 120000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => (out += d));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => (err += d));
      child.stdin.on('error', () => {});
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(truncate(err.trim() || out.trim() || `claude が終了コード ${code} で終わりました`, 300)));
        const name = cleanBranchName(out);
        if (!name) return reject(new Error('ブランチ名が返ってきませんでした'));
        resolve(name);
      });
      child.stdin.end(buildBranchNamePrompt(rule, c));
    });
  }

  writeMcpConfig(c) {
    if (!this.permission) return null;
    // 承認サーバーのトークンを含むので、自分だけが読めるようにする
    fs.mkdirSync(this.opts.mcpDir, { recursive: true, mode: 0o700 });
    if (!isWin) fs.chmodSync(this.opts.mcpDir, 0o700);
    const file = path.join(this.opts.mcpDir, `${c.id}.json`);
    const config = {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'stdio',
          command: this.opts.nodeBin,
          args: [this.opts.mcpScript],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            KANBAN_PORT: String(this.permission.port),
            KANBAN_TOKEN: this.permission.token,
            KANBAN_CARD: c.id,
          },
        },
      },
    };
    fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
    if (!isWin) fs.chmodSync(file, 0o600);
    return file;
  }

  // 会話（チャット）の権限モード。リポジトリのフォルダ（手元の作業中のファイル）でそのまま動くので、
  // ファイルの変更やコマンドは毎回カードで確かめる（「計画だけ」「すべて自動で許可」を選んでいればそれに従う）
  chatPermissionMode(mode) {
    return mode === 'plan' || mode === 'bypassPermissions' ? mode : 'default';
  }

  async launch(c) {
    const chat = isChat(c);
    if (chat) {
      if (!c.repoPath || !fs.existsSync(c.repoPath)) throw new Error(`リポジトリのフォルダが見つかりません: ${c.repoPath}`);
    } else if (!c.worktreePath || !fs.existsSync(c.worktreePath)) await this.prepareWorktree(c);
    const cwd = chat ? c.repoPath : c.worktreePath;
    const s = this.store.settings;
    // stdin を開いたままにして、実行中でもメッセージ（btw）を送れるようにする
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages'];
    const mode = chat ? this.chatPermissionMode(s.permissionMode) : s.permissionMode;
    if (mode) args.push('--permission-mode', mode);
    if (s.model) args.push('--model', s.model);
    const allowed = splitList(s.allowedTools);
    if (allowed.length) args.push('--allowedTools', ...allowed);
    const mcpConfig = this.writeMcpConfig(c);
    if (mcpConfig) args.push('--mcp-config', mcpConfig, '--permission-prompt-tool', PERMISSION_TOOL);
    if (c.sessionId) args.push('--resume', assertSessionId(c.sessionId));
    // 既存の会話を引き継ぐときは、元の会話を変えないようにフォークする（新しい ID になる）
    if (c.sessionId && c.forkNext) args.push('--fork-session');

    const prompt = c.pendingPrompt || '';
    c.pendingPrompt = null;
    c.lastPromptSent = prompt;
    for (const m of c.btw || []) if (m.state === 'queued') m.state = 'delivered';
    const cmd = s.claudePath || 'claude';
    const resolved = resolveCommand(cmd);
    if (!resolved) {
      throw Object.assign(new Error(notFoundMessage(cmd)), { code: 'ENOENT' });
    }
    // Windows の .cmd / .bat はシェル経由でしか起動できない。.exe は直接起動する
    const useShell = isWin && /\.(cmd|bat)$/i.test(resolved);
    const child = spawn(useShell ? quoteForCmd(resolved) : resolved, useShell ? args.map(quoteForCmd) : args, {
      cwd,
      // 承認待ちの MCP ツール呼び出しがタイムアウトしないようにする
      env: { ...process.env, MCP_TOOL_TIMEOUT: '86400000' },
      shell: useShell,
      windowsHide: true,
    });
    this.procs.set(c.id, child);
    // sent: stdin に書いたメッセージ（acked = claude が受け取ったことをリプレイで確認済み）
    const run = { resultError: null, finished: false, child, sent: [], stdinClosed: false, idleTimer: null };
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
    this.writeMessage(run, prompt, null);

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
      this.procs.delete(c.id);
      this.runs.delete(c.id);
      // 受け取られないまま終わった btw は「届かなかった」にする
      for (const m of c.btw || []) if (m.state === 'sent') m.state = 'lost';
      this.denyAllPending(c.id, 'エージェントが終了しました');
      if (!this.store.card(c.id)) return; // 破棄された
      // 状態を「レビュー」にする前に、作業内容をブランチにコミットしておく
      if (!spawnError && !chat) {
        try {
          const canCommit = await this.afterConflictRun(c);
          if (canCommit && (await git.commitAll(c.worktreePath, this.commitMessage(c)))) this.log(c, 'system', '変更を worktree のブランチにコミットしました');
        } catch (err) {
          this.log(c, 'error', `コミットに失敗しました: ${err.message}`);
        }
        if (!this.store.card(c.id)) return;
      }
      if (this.shuttingDown) {
        // アプリの終了で止めた: 「実行中」のまま保存し、次の起動で「中断」として再開できるようにする
        c.stopRequested = false;
        this.changed(c);
        return;
      }
      if (spawnError) {
        c.status = 'failed';
        c.error =
          spawnError.code === 'ENOENT'
            ? notFoundMessage(cmd)
            : spawnError.message;
        this.log(c, 'error', c.error);
      } else if (c.stopRequested) {
        c.status = 'review';
        c.error = null;
        this.log(c, 'system', '停止しました。追加指示を送ると続きから再開できます。');
      } else if (code === 0 && !run.resultError) {
        c.status = 'review';
        c.error = null;
        // 会話は返事が来たらいつでも続きを話せるので、「回答待ち」にはしない
        c.awaitingReply = !chat && endsWithQuestion(c.lastText);
        if (c.awaitingReply) {
          this.log(c, 'question', 'Claude が質問しています。下の欄から答えると、続きから進めます');
          this.emit('awaiting', c);
          this.notify(c, 'awaiting', `回答待ち: ${c.title}`, c.lastText || 'Claude が質問しています');
        } else {
          if (isChat(c)) this.notify(c, 'awaiting', `返事: ${c.title}`, c.lastText || 'Claude が返事をしました');
          else this.notify(c, 'review', `レビュー待ち: ${c.title}`, c.lastText || '作業が終わりました。差分を確かめてください');
        }
      } else {
        c.status = 'failed';
        c.error = run.resultError || `claude が終了コード ${code} で終了しました`;
      }
      if (c.status === 'failed') this.notify(c, 'failed', `失敗: ${c.title}`, c.error);
      c.stopRequested = false;
      c.finishedAt = Date.now();
      this.changed(c);
      this.pump();
    };
    child.on('error', (err) => finish(null, err));
    child.on('close', (code) => finish(code, null));
  }

  handleLine(c, line, run) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      this.log(c, 'stderr', truncate(line, 2000));
      return;
    }
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          if (ev.session_id) this.recordSession(c, ev.session_id);
          this.log(c, 'system', `セッション開始（モデル: ${ev.model || '不明'} / 権限モード: ${ev.permissionMode || '不明'}）`);
          this.changed(c);
        }
        break;
      case 'assistant':
        for (const b of (ev.message && ev.message.content) || []) {
          if (b.type === 'text' && b.text && b.text.trim()) {
            this.log(c, 'text', b.text);
            c.lastText = b.text.trim();
            c.lastMessage = truncate(b.text.trim(), 200);
          } else if (b.type === 'tool_use') {
            this.log(c, 'tool', `${b.name}  ${summarizeInput(b.input)}`);
            c.lastMessage = `🔧 ${b.name} ${truncate(summarizeInput(b.input), 80)}`;
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
          if (b.type === 'tool_result') this.log(c, b.is_error ? 'tool_error' : 'tool_result', truncate(toolResultText(b.content), 1500));
        }
        break;
      }
      case 'result': {
        if (ev.session_id) c.sessionId = ev.session_id;
        const cost = Number(ev.total_cost_usd) || 0;
        c.costUsd = (c.costUsd || 0) + cost;
        const secs = Math.round((Number(ev.duration_ms) || 0) / 1000);
        if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) {
          run.resultError = (typeof ev.result === 'string' && ev.result) || `エラー（${ev.subtype}）`;
          this.log(c, 'error', `エラーで終了しました: ${run.resultError}`);
        } else {
          if (typeof ev.result === 'string' && ev.result.trim()) c.lastMessage = truncate(ev.result.trim(), 200);
          this.log(c, 'result', `完了しました（${secs}秒 / $${cost.toFixed(3)}）`);
        }
        this.changed(c);
        this.afterResult(c, run, !!run.resultError);
        break;
      }
      default:
        break;
    }
  }

  // ---------- 実行中のメッセージ（btw） ----------

  // stream-json の1行として stdin に書く
  writeMessage(run, text, btwId) {
    run.sent.push({ text, btwId, acked: false });
    run.child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
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
        this.log(c, 'system', 'btw のメッセージを Claude が受け取りました');
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
   * 実行中のエージェントにメッセージを送る（btw）。今の作業にそのまま反映される。
   * 待機中なら、開始するときの指示に付け足す
   */
  btw(id, text) {
    const c = this.must(id);
    text = String(text || '').trim();
    if (!text) throw new Error('メッセージを入力してください');
    const entry = { id: crypto.randomBytes(4).toString('hex'), text, at: Date.now(), state: 'sent' };
    const wrapped = `（作業中のユーザーからの追加メッセージ）\n${text}`;
    if (c.status === 'queued') {
      c.pendingPrompt = `${c.pendingPrompt || ''}\n\n${wrapped}`;
      entry.state = 'queued';
    } else {
      const run = this.runs && this.runs.get(id);
      if (c.status !== 'running' || !run || run.finished || run.stdinClosed) {
        throw new Error('btw はエージェントの実行中だけ送れます。終わったあとは下の「追加指示」を使ってください');
      }
      clearTimeout(run.idleTimer);
      this.writeMessage(run, wrapped, entry.id);
    }
    c.btw = [...(c.btw || []), entry];
    this.log(c, 'user', `btw: ${text}`);
    this.changed(c);
    return entry;
  }

  // ---------- 承認（--permission-prompt-tool） ----------

  requestPermission({ cardId, toolName, input, toolUseId }, signal) {
    const c = this.store.card(cardId);
    if (!c) return Promise.resolve({ behavior: 'deny', message: 'タスクが見つかりません' });
    input = input && typeof input === 'object' ? input : {};
    if (toolName === 'AskUserQuestion') return this.askQuestion(c, input, toolUseId, signal);
    if ((c.alwaysAllow || []).includes(toolName)) {
      this.log(c, 'permission', `自動で許可しました: ${toolName}  ${summarizeInput(input)}`);
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    }
    return new Promise((resolve) => {
      const id = crypto.randomBytes(6).toString('hex');
      const req = { id, toolName, toolUseId, summary: summarizeInput(input), detail: truncate(JSON.stringify(input, null, 2), 4000), at: Date.now() };
      this.pending.set(id, { cardId, toolName, input, resolve });
      c.permissions = c.permissions || [];
      c.permissions.push(req);
      this.log(c, 'permission', `承認待ち: ${toolName}  ${req.summary}`);
      this.changed(c);
      this.emit('permission', c, req);
      this.notify(c, 'permission', `承認待ち: ${c.title}`, `${toolName}  ${req.summary}`);
      signal?.addEventListener('abort', () => {
        if (this.pending.has(id)) this.settle(id, { behavior: 'deny', message: '中断されました' }, null);
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
      this.log(c, 'question', `質問: ${questions.map((q) => q.question).join(' / ')}`);
      this.changed(c);
      this.emit('question', c, questions);
      this.notify(c, 'question', `質問: ${c.title}`, questions.map((q) => q.question).join(' / '));
      signal?.addEventListener('abort', () => {
        if (this.pending.has(id)) this.settle(id, { behavior: 'deny', message: '中断されました' }, null);
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
    if (!p || p.cardId !== cardId || p.kind !== 'question') throw new Error('この質問はもう終わっています');
    if (!answers) {
      this.settle(reqId, { behavior: 'deny', message: 'ユーザーは質問に答えずに、そのまま進めるよう求めています。妥当だと思う方法で続けてください。' }, '答えずに続ける');
      return;
    }
    const clean = {};
    for (const q of p.questions) {
      const a = String(answers[q.question] ?? '').trim();
      if (!a) throw new Error(`「${q.header || q.question}」に答えてください`);
      clean[q.question] = a;
    }
    const c = this.store.card(cardId);
    this.log(c, 'user', Object.entries(clean).map(([q, a]) => `${q} → ${a}`).join('\n'), { answer: true });
    this.settle(reqId, { behavior: 'allow', updatedInput: { ...p.input, answers: clean } }, '回答しました');
  }

  // decision: 'allow' | 'deny' | 'always'
  answerPermission(cardId, reqId, decision, message) {
    const c = this.must(cardId);
    const p = this.pending.get(reqId);
    if (!p || p.cardId !== cardId || p.kind === 'question') throw new Error('この承認リクエストはもう終わっています');
    if (decision === 'always') {
      c.alwaysAllow = c.alwaysAllow || [];
      if (!c.alwaysAllow.includes(p.toolName)) c.alwaysAllow.push(p.toolName);
      // 同じツールで待っている他のリクエストもまとめて許可
      for (const [id, other] of this.pending) {
        if (other.cardId === cardId && other.toolName === p.toolName) this.settle(id, { behavior: 'allow', updatedInput: other.input }, '許可（常に許可）');
      }
      return;
    }
    if (decision === 'allow') this.settle(reqId, { behavior: 'allow', updatedInput: p.input }, '許可');
    else this.settle(reqId, { behavior: 'deny', message: (message && message.trim()) || 'ユーザーが拒否しました' }, '拒否');
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
    if (isChat(c)) return '';
    if (c.worktreePath && fs.existsSync(c.worktreePath)) return git.diff(c.worktreePath, c.baseCommit);
    return c.finalDiff || '';
  }

  // worktree の作業状況（タブ「worktree」用）
  async worktree(id) {
    const c = this.must(id);
    if (isChat(c)) return { exists: false, status: null, worktrees: [] };
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
    if (isChat(c)) throw new Error('会話はマージできません（タスクにすると、worktree で作業してマージできます）');
    if (!['review', 'failed'].includes(c.status)) throw new Error('レビュー中のタスクだけマージできます');
    if (!c.worktreePath) throw new Error('worktree がありません');
    if (this.merging?.has(id)) throw new Error('マージ中です');
    const top = c.repoPath;
    const target = String(opts.target || c.baseBranch || '').trim();
    if (!target) throw new Error('マージ先のブランチを指定してください');
    if (target === c.branch) throw new Error('タスク自身のブランチにはマージできません');
    git.assertSafeRef(target, 'マージ先のブランチ名');

    if (await git.mergeInProgress(c.worktreePath)) throw new Error('コンフリクトの解消が終わっていません。「解消した」を押すか、取り込みを中止してください');

    this.merging = this.merging || new Set();
    this.merging.add(id);
    try {
      await git.commitAll(c.worktreePath, this.commitMessage(c));
      if (opts.createNew) {
        await git.checkBranchName(top, target);
        if (await git.branchExists(top, target)) throw new Error(`ブランチ ${target} はもうあります。一覧から選んでください`);
        await git.createBranch(top, target, c.baseBranch);
        this.log(c, 'system', `ブランチ ${target} を ${c.baseBranch} から作成しました`);
      } else if (!(await git.branchExists(top, target))) {
        throw new Error(`ブランチ ${target} が見つかりません`);
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
            const at = git.checkedOutAtFromError(err);
            if (!at) throw err;
            temp = null;
            dir = at;
          }
        }
        if (!temp) {
          const op = await git.operationInProgress(dir);
          if (op) throw new Error(`${target} をチェックアウトしている ${dir} で ${op} が途中です。終わらせるか中止してから、もう一度マージしてください。`);
          if (await git.isDirty(dir)) throw new Error(`${target} をチェックアウトしている ${dir} に未コミットの変更があります。コミットするか退避してからマージしてください。`);
        }
        try {
          await git.merge(dir, c.branch, (c.issue ? `Merge agent task: ${c.title.replace(/^#\d+\s*/, '')} (#${c.issue.number})` : `Merge agent task: ${c.title}`), target);
        } catch (err) {
          if (!err.conflictFiles) throw err;
          // コンフリクト: マージは中止済み。カードに出して、解消の方法を選んでもらう
          c.conflict = { target, files: err.conflictFiles, push: !!opts.push, keep: !!opts.keep, at: Date.now() };
          c.conflictResolved = null;
          this.log(c, 'error', `${target} とコンフリクトしています: ${err.conflictFiles.join(', ')}`);
          this.changed(c);
          return { conflict: c.conflict };
        } finally {
          if (temp) await git.removeWorktree(top, temp);
        }
        this.log(c, 'system', `${target} にマージしました`);
      } else {
        this.log(c, 'system', `${target} にはもう取り込まれているので、マージする変更はありませんでした`);
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
          throw new Error(`ローカルの ${target} へのマージは済みましたが、origin への push に失敗しました。ターミナルで git push origin ${target} を試してください。\n${err.message}`);
        }
        this.log(c, 'system', `origin/${target} に push しました`);
        c.pushedTo = [...new Set([...(c.pushedTo || []), target])];
      }

      if (opts.keep) {
        this.changed(c);
        return { merged: true };
      }
      await git.removeWorktree(top, c.worktreePath);
      await git.deleteBranch(top, c.branch);
      c.finalDiff = truncate(finalDiff, 300000);
      c.worktreePath = null;
      c.status = 'done';
      c.mergedAt = Date.now();
      this.completed(c);
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
    if (c.lastMessage) lines.push(c.lastMessage, '');
    lines.push('---', 'Claude Agent Kanban のタスクから作成しました。');
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
    if (isChat(c)) throw new Error('会話からは PR を作れません（タスクにすると、worktree で作業して PR を作れます）');
    if (!['review', 'failed'].includes(c.status)) throw new Error('レビュー中のタスクだけ PR を作れます');
    if (!c.worktreePath) throw new Error('worktree がありません');
    if (this.merging?.has(id)) throw new Error('処理中です');
    const top = c.repoPath;
    const base = String(opts.base || c.prBase || c.baseBranch || '').trim();
    if (!base) throw new Error('PR のマージ先のブランチを指定してください');
    if (base === c.branch) throw new Error('タスク自身のブランチには PR を作れません');
    git.assertSafeRef(base, 'PR のマージ先のブランチ名');
    if (!(await git.hasRemote(top, 'origin'))) throw new Error('このリポジトリに origin がありません。GitHub のリポジトリを origin に設定してください');
    if (await git.mergeInProgress(c.worktreePath)) throw new Error('コンフリクトの解消が終わっていません。「解消した」を押すか、取り込みを中止してください');

    this.merging = this.merging || new Set();
    this.merging.add(id);
    try {
      await git.commitAll(c.worktreePath, this.commitMessage(c));
      if ((await git.countCommits(top, `${base}..${c.branch}`)) === 0 && (await git.branchExists(top, base))) {
        throw new Error(`${base} との差分がないので PR を作れません`);
      }
      await git.push(c.worktreePath, 'origin', c.branch, true);
      this.log(c, 'system', `ブランチ ${c.branch} を origin に push しました`);
      const def = this.prDefaults(c);
      const pr = await ghCli.createPullRequest({
        cwd: c.worktreePath,
        head: c.branch,
        base,
        title: String(opts.title || '').trim() || def.title,
        body: opts.body != null && String(opts.body).trim() ? String(opts.body) : def.body,
        gh: this.opts.ghPath,
      });
      this.log(c, 'system', pr.created ? `PR を作成しました: ${pr.url}` : `開いている PR を更新しました: ${pr.url}`);
      c.prUrl = pr.url;
      c.prBase = base;
      c.prState = 'OPEN';
      c.prMergedAt = null;
      c.prCheckError = null;
      // push したので、コンフリクトしているかは GitHub でもう一度確かめる
      c.prMergeable = null;
      if (c.conflictResolved && c.conflictResolved.pr) c.conflictResolved = null;
      if (c.conflict && c.conflict.pr) c.conflict = null;

      const finalDiff = await git.diff(c.worktreePath, c.baseCommit);
      if (opts.keep === false) {
        // ブランチは origin に残っているので、ローカルの worktree とブランチは片付ける
        await git.removeWorktree(top, c.worktreePath);
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
          if (c.prCheckError !== err.message) this.log(c, 'error', `PR の状態を確かめられませんでした: ${err.message}`);
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
        if (pr.state === 'CLOSED') this.log(c, 'system', `PR はマージされずに閉じられました: ${url}`);
        c.prState = pr.state;
        changed = true;
      }
      if (this.updatePrConflict(c, pr)) changed = true;
      if (changed) this.changed(c);
      return false;
    }

    const base = pr.baseRefName || c.prBase;
    c.prState = 'MERGED';
    c.prMergedAt = Date.parse(pr.mergedAt) || Date.now();
    if (base) {
      c.mergedInto = [...new Set([...(c.mergedInto || []), base])];
      c.lastMergeTarget = base;
    }
    this.log(c, 'system', `PR がマージされました${base ? `（${base}）` : ''}: ${url}`);

    if (c.status !== 'done' && c.worktreePath) {
      if (this.merging?.has(c.id)) {
        this.changed(c);
        return false;
      }
      const keep = await this.unmergedWork(c, pr.headRefOid);
      if (!this.store.card(c.id) || !['review', 'failed'].includes(c.status)) return false;
      if (keep) {
        this.log(c, 'system', `worktree に PR に入っていない変更（${keep}）があるので、タスクはレビュー中のまま残します。不要なら「破棄」、続きは追加指示か PR の作成で進められます`);
        this.changed(c);
        return false;
      }
      const top = c.repoPath;
      const finalDiff = await git.diff(c.worktreePath, c.baseCommit).catch(() => '');
      await git.removeWorktree(top, c.worktreePath);
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
    else this.notify(c, 'done', `PR がマージされました: ${c.title}`, url);
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
        this.log(c, 'error', `PR が ${base} とコンフリクトしています。「Claude に解消してもらう」か「自分で解消する」で直して、PR を更新してください: ${c.prUrl}`);
        this.notify(c, 'conflict', `PR がコンフリクトしています: ${c.title}`, c.prUrl);
      } else if (!c.worktreePath) {
        this.log(c, 'error', `PR が ${base || 'マージ先'} とコンフリクトしています（worktree を片付けたので、GitHub 上で解消してください）: ${c.prUrl}`);
      }
      changed = true;
    } else if (now !== 'CONFLICTING' && c.conflict && c.conflict.pr && !active) {
      // もうコンフリクトしていない（PR が閉じられた・ほかで解消された）
      c.conflict = null;
      changed = true;
    }
    return changed;
  }

  raisePrConflict(c, base) {
    c.conflict = { target: base, files: [], pr: true, push: true, keep: true, at: Date.now() };
    c.conflictResolved = null;
  }

  // 閉じたコンフリクトの案内を、もう一度出す（PR がコンフリクトしているあいだだけ）
  reopenPrConflict(id) {
    const c = this.must(id);
    if (!c.prUrl || c.prState !== 'OPEN' || c.prMergeable !== 'CONFLICTING') throw new Error('PR はコンフリクトしていません');
    if (!c.worktreePath) throw new Error('worktree がないので、アプリの中では解消できません。GitHub 上で解消してください');
    if (!['review', 'failed'].includes(c.status)) throw new Error('実行中は解消を始められません');
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
      if (await git.mergeInProgress(wt)) return 'コンフリクトの解消中';
      if (await git.isDirty(wt, { untracked: true })) return '未コミットの変更';
      if (!headRefOid) return 'PR の最後のコミットが分からない';
      const ahead = await git.countCommits(c.repoPath, `${headRefOid}..${c.branch}`);
      return ahead > 0 ? `PR にないコミット ${ahead} 件` : null;
    } catch {
      // PR の最後のコミットが手元にないなど。消してよいか分からないので残す
      return 'PR と手元のブランチを比べられない';
    }
  }

  // origin の target を取ってきて、ローカルの target を早送りでそろえる。origin に target があれば true
  async syncWithOrigin(c, top, target) {
    const remote = 'origin';
    if (!(await git.hasRemote(top, remote))) throw new Error('このリポジトリには origin がありません。push せずにマージするか、origin を設定してください');
    let has;
    try {
      has = await git.fetchBranch(top, remote, target);
    } catch (err) {
      throw new Error(`origin の最新を取ってこられませんでした（ネットワークや GitHub のログインを確認してください）。\n${err.message}`);
    }
    if (!has) return false;
    const behind = await git.countCommits(top, `${target}..${remote}/${target}`);
    const localAhead = await git.countCommits(top, `${remote}/${target}..${target}`);
    if (behind > 0 && localAhead > 0) {
      throw new Error(`ローカルの ${target} と origin/${target} が別々に進んでいます。先にターミナルで ${target} を origin/${target} とそろえてから（git pull など）、もう一度マージしてください`);
    }
    if (behind > 0) {
      const dir = await git.worktreeForBranch(top, target);
      if (dir && (await git.isDirty(dir))) throw new Error(`${target} をチェックアウトしている ${dir} に未コミットの変更があるため、origin の最新を取り込めません`);
      await git.fastForward(top, target, `${remote}/${target}`, dir);
      this.log(c, 'system', `origin/${target} の新しいコミット ${behind} 件をローカルの ${target} に取り込みました`);
    }
    return true;
  }

  // ---------- コンフリクトの解消 ----------

  /**
   * マージ先のブランチをタスクの worktree に取り込み、コンフリクトを解消する
   * @param {'agent'|'manual'} mode  agent: Claude に解消してもらう / manual: 自分でエディタで直す
   */
  async resolveConflict(id, mode) {
    const c = this.must(id);
    if (isChat(c)) throw new Error('会話にはコンフリクトはありません');
    if (!c.conflict) throw new Error('コンフリクトはありません');
    if (!['review', 'failed'].includes(c.status)) throw new Error('実行中は解消を始められません');
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
          throw new Error(`origin の最新を取ってこられませんでした（ネットワークや GitHub のログインを確認してください）。\n${err.message}`);
        }
        if (!has) throw new Error(`origin に ${target} が見つかりません`);
        ref = `origin/${target}`;
      } else if (c.conflict.push) await this.syncWithOrigin(c, c.repoPath, target);
      files = await git.startMerge(wt, ref);
      this.log(c, 'system', `${ref} をタスクのブランチに取り込み始めました`);
      if (!files.length) {
        await git.finishMerge(wt);
        this.markResolved(c, 'コンフリクトなしで取り込めました');
        return { resolved: true };
      }
    }
    c.conflict = { ...c.conflict, files, manual: mode === 'manual', resolving: mode === 'agent', unresolved: undefined };
    if (mode === 'manual') {
      this.log(c, 'system', `自分で解消するモード: ${wt} の ${files.join(', ')} を直してから「解消した」を押してください`);
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
    if (!c.conflict) throw new Error('コンフリクトはありません');
    const wt = c.worktreePath;
    if (!(await git.mergeInProgress(wt))) {
      const marked = await git.filesWithMarkers(wt, c.conflict.files);
      if (marked.length) throw new Error(`まだコンフリクトの印（<<<<<<< など）が残っています: ${marked.join(', ')}`);
      this.markResolved(c, 'コンフリクトを解消しました');
      return;
    }
    // git add 済みでも、印が残っていればまだ
    const marked = await git.filesWithMarkers(wt, c.conflict.files);
    if (marked.length) throw new Error(`まだコンフリクトの印（<<<<<<< など）が残っています: ${marked.join(', ')}`);
    await git.finishMerge(wt);
    this.markResolved(c, 'コンフリクトを解消して、取り込みを完了しました');
  }

  async abortConflict(id) {
    const c = this.must(id);
    if (c.worktreePath && (await git.mergeInProgress(c.worktreePath))) await git.abortMerge(c.worktreePath);
    if (c.conflict) c.conflict = { ...c.conflict, manual: false, resolving: false, unresolved: undefined };
    this.log(c, 'system', '取り込みを中止しました');
    this.changed(c);
  }

  dismissConflict(id) {
    const c = this.must(id);
    c.conflict = null;
    c.conflictResolved = null;
    this.changed(c);
  }

  markResolved(c, msg) {
    const pr = !!c.conflict.pr;
    c.conflictResolved = { target: c.conflict.target, push: c.conflict.push, keep: c.conflict.keep, ...(pr ? { pr: true } : {}) };
    c.conflict = null;
    this.log(c, 'system', pr ? `${msg}。PR を更新（push）すると、GitHub 上のコンフリクトも解消されます` : `${msg}。もう一度マージすると、コンフリクトなしでマージできます`);
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
      this.log(c, 'error', `コンフリクトがまだ残っています: ${left.join(', ')}。もう一度 Claude に頼むか、自分で直してください`);
      return false;
    }
    if (inProgress) await git.finishMerge(wt);
    this.markResolved(c, 'Claude がコンフリクトを解消しました');
    return true;
  }

  async discard(id) {
    const c = this.must(id);
    const child = this.procs.get(id);
    this.store.removeCard(id);
    this.denyAllPending(id, '破棄されました');
    if (child) {
      killTree(child);
      await new Promise((r) => (child.exitCode !== null ? r() : child.once('close', r)));
    }
    if (c.worktreePath) await git.removeWorktree(c.repoPath, c.worktreePath);
    if (c.branch && c.status !== 'done') await git.deleteBranch(c.repoPath, c.branch);
    fs.rmSync(path.join(this.opts.mcpDir, `${id}.json`), { force: true });
    this.changed(null);
  }
}

module.exports = { AgentManager, PERMISSION_TOOL, endsWithQuestion, SKILL_SUGGEST_PROMPT, buildSkillSuggestPrompt, isChat, isSessionId, quoteForCmd, cleanBranchName, buildBranchNamePrompt };
