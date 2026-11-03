// カード（タスク）ごとに worktree を作り、Claude Code CLI を並列に動かす
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const git = require('./git');
const { resolveCommand, isWin } = require('./env');

const MAX_LOGS = 2000;
const MCP_SERVER_NAME = 'agent_kanban';
const PERMISSION_TOOL = `mcp__${MCP_SERVER_NAME}__approve`;

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
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

function splitList(s) {
  return String(s || '')
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
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

  // 前回アプリを終了したときに動いていたカードを整理する
  recoverInterrupted() {
    for (const c of this.store.cards) {
      c.permissions = [];
      if (c.status === 'queued') c.status = c.worktreePath ? 'review' : 'todo';
      if (c.status === 'running') {
        c.status = 'failed';
        c.error = 'アプリの終了で中断されました。追加指示を送ると続きから再開できます。';
      }
    }
    this.store.save();
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
  }

  log(card, kind, text) {
    const entry = { t: Date.now(), kind, text };
    card.logs = card.logs || [];
    card.logs.push(entry);
    if (card.logs.length > MAX_LOGS) card.logs.splice(0, card.logs.length - MAX_LOGS);
    this.emit('log', card.id, entry);
  }

  // ---------- カード操作 ----------

  createCard({ title, prompt }) {
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
    this.store.cards.push(card);
    this.changed(card);
    return card;
  }

  updateCard(id, { title, prompt }) {
    const c = this.must(id);
    if (c.status !== 'todo') throw new Error('開始前のタスクだけ編集できます');
    if (typeof title === 'string' && title.trim()) c.title = title.trim();
    if (typeof prompt === 'string' && prompt.trim()) c.prompt = prompt.trim();
    this.changed(c);
  }

  start(id) {
    const c = this.must(id);
    if (c.status !== 'todo') throw new Error('このタスクはもう開始しています');
    this.log(c, 'user', c.prompt);
    this.enqueue(c, c.prompt);
  }

  send(id, message) {
    const c = this.must(id);
    if (!['review', 'failed'].includes(c.status)) throw new Error('実行中・待機中は追加指示を送れません');
    if (!message || !message.trim()) throw new Error('追加指示を入力してください');
    this.log(c, 'user', message.trim());
    this.enqueue(c, message.trim());
  }

  enqueue(c, prompt) {
    c.pendingPrompt = prompt;
    c.status = 'queued';
    c.queuedAt = Date.now();
    c.error = null;
    this.changed(c);
    this.pump();
  }

  // 同時実行数の上限まで、待機中のカードを起動する
  pump() {
    const max = Math.max(1, Number(this.store.settings.maxParallel) || 1);
    let running = this.store.cards.filter((c) => c.status === 'running').length;
    const queued = this.store.cards.filter((c) => c.status === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
    for (const c of queued) {
      if (running >= max) break;
      running++;
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
      c.status = c.worktreePath ? 'review' : 'todo';
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
    const base = this.store.settings.baseBranch || (await git.currentBranch(top));
    if (base === 'HEAD') throw new Error('ベースブランチが決まりません（detached HEAD）。設定でベースブランチを指定してください');
    const baseCommit = await git.revParse(top, base);
    const branch = `agent/${slugify(c.title)}-${c.id}`;
    const wt = path.join(path.dirname(top), `${path.basename(top)}.worktrees`, c.id);
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    await git.addWorktree(top, wt, branch, baseCommit);
    Object.assign(c, { worktreePath: wt, branch, baseBranch: base, baseCommit });
    this.log(c, 'system', `worktree を作成しました: ${wt}（ブランチ ${branch} / ベース ${base}）`);
    this.changed(c);
  }

  writeMcpConfig(c) {
    if (!this.permission) return null;
    fs.mkdirSync(this.opts.mcpDir, { recursive: true });
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
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
    return file;
  }

  async launch(c) {
    if (!c.worktreePath || !fs.existsSync(c.worktreePath)) await this.prepareWorktree(c);
    const s = this.store.settings;
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (s.permissionMode) args.push('--permission-mode', s.permissionMode);
    if (s.model) args.push('--model', s.model);
    const allowed = splitList(s.allowedTools);
    if (allowed.length) args.push('--allowedTools', ...allowed);
    const mcpConfig = this.writeMcpConfig(c);
    if (mcpConfig) args.push('--mcp-config', mcpConfig, '--permission-prompt-tool', PERMISSION_TOOL);
    if (c.sessionId) args.push('--resume', c.sessionId);

    const prompt = c.pendingPrompt || '';
    c.pendingPrompt = null;
    const cmd = s.claudePath || 'claude';
    const resolved = resolveCommand(cmd);
    if (!resolved) {
      throw Object.assign(new Error(notFoundMessage(cmd)), { code: 'ENOENT' });
    }
    // Windows の .cmd / .bat はシェル経由でしか起動できない。.exe は直接起動する
    const useShell = isWin && /\.(cmd|bat)$/i.test(resolved);
    const quote = (a) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    const child = spawn(useShell ? quote(resolved) : resolved, useShell ? args.map(quote) : args, {
      cwd: c.worktreePath,
      // 承認待ちの MCP ツール呼び出しがタイムアウトしないようにする
      env: { ...process.env, MCP_TOOL_TIMEOUT: '86400000' },
      shell: useShell,
      windowsHide: true,
    });
    this.procs.set(c.id, child);
    const run = { resultError: null, finished: false };

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
    child.stdin.end(prompt);

    const finish = async (code, spawnError) => {
      if (run.finished) return;
      run.finished = true;
      if (buf.trim()) this.handleLine(c, buf.trim(), run);
      this.procs.delete(c.id);
      this.denyAllPending(c.id, 'エージェントが終了しました');
      if (!this.store.card(c.id)) return; // 破棄された
      // 状態を「レビュー」にする前に、作業内容をブランチにコミットしておく
      if (!spawnError) {
        try {
          if (await git.commitAll(c.worktreePath, `agent: ${c.title}`)) this.log(c, 'system', '変更を worktree のブランチにコミットしました');
        } catch (err) {
          this.log(c, 'error', `コミットに失敗しました: ${err.message}`);
        }
        if (!this.store.card(c.id)) return;
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
      } else {
        c.status = 'failed';
        c.error = run.resultError || `claude が終了コード ${code} で終了しました`;
      }
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
          if (ev.session_id) c.sessionId = ev.session_id;
          this.log(c, 'system', `セッション開始（モデル: ${ev.model || '不明'} / 権限モード: ${ev.permissionMode || '不明'}）`);
          this.changed(c);
        }
        break;
      case 'assistant':
        for (const b of (ev.message && ev.message.content) || []) {
          if (b.type === 'text' && b.text && b.text.trim()) {
            this.log(c, 'text', b.text);
            c.lastMessage = truncate(b.text.trim(), 200);
          } else if (b.type === 'tool_use') {
            this.log(c, 'tool', `${b.name}  ${summarizeInput(b.input)}`);
            c.lastMessage = `🔧 ${b.name} ${truncate(summarizeInput(b.input), 80)}`;
          }
        }
        this.changed(c);
        break;
      case 'user': {
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
        break;
      }
      default:
        break;
    }
  }

  // ---------- 承認（--permission-prompt-tool） ----------

  requestPermission({ cardId, toolName, input, toolUseId }, signal) {
    const c = this.store.card(cardId);
    if (!c) return Promise.resolve({ behavior: 'deny', message: 'タスクが見つかりません' });
    input = input && typeof input === 'object' ? input : {};
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
      signal?.addEventListener('abort', () => {
        if (this.pending.has(id)) this.settle(id, { behavior: 'deny', message: '中断されました' }, null);
      });
    });
  }

  // decision: 'allow' | 'deny' | 'always'
  answerPermission(cardId, reqId, decision, message) {
    const c = this.must(cardId);
    const p = this.pending.get(reqId);
    if (!p || p.cardId !== cardId) throw new Error('この承認リクエストはもう終わっています');
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
      if (label) this.log(c, 'permission', `${label}: ${p.toolName}`);
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
    if (c.worktreePath && fs.existsSync(c.worktreePath)) return git.diff(c.worktreePath, c.baseCommit);
    return c.finalDiff || '';
  }

  async merge(id) {
    const c = this.must(id);
    if (!['review', 'failed'].includes(c.status)) throw new Error('レビュー中のタスクだけマージできます');
    if (!c.worktreePath) throw new Error('worktree がありません');
    const top = c.repoPath;
    await git.commitAll(c.worktreePath, `agent: ${c.title}`);
    const cur = await git.currentBranch(top);
    if (cur !== c.baseBranch) {
      throw new Error(`メインのリポジトリが ${c.baseBranch} ではなく ${cur} になっています。${c.baseBranch} に切り替えてからマージしてください。`);
    }
    if (await git.isDirty(top)) throw new Error('メインのリポジトリに未コミットの変更があります。コミットするか退避してからマージしてください。');
    const finalDiff = await git.diff(c.worktreePath, c.baseCommit);
    const ahead = await git.countCommits(top, `${c.baseBranch}..${c.branch}`);
    if (ahead > 0) await git.merge(top, c.branch, `Merge agent task: ${c.title}`);
    this.log(c, 'system', ahead > 0 ? `${c.baseBranch} にマージしました` : 'マージする変更はありませんでした');
    await git.removeWorktree(top, c.worktreePath);
    await git.deleteBranch(top, c.branch);
    c.finalDiff = truncate(finalDiff, 300000);
    c.worktreePath = null;
    c.status = 'done';
    c.mergedAt = Date.now();
    this.changed(c);
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

module.exports = { AgentManager, PERMISSION_TOOL };
