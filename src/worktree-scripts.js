// worktree のセットアップ / 片付け / 実行スクリプトを、シェルで動かす
const { spawn, execFile } = require('child_process');
const net = require('net');
const wsl = require('./wsl');
const { isWin } = require('./env');

const SCRIPT_KINDS = ['setup', 'teardown', 'run'];
const SCRIPT_SETTINGS = { setup: 'setupScript', teardown: 'teardownScript', run: 'runScript' };
const MAX_OUTPUT = 200000; // 画面に出す出力は、最後の分だけ持っておく
const KILL_WAIT_MS = 3000;
// タスクごとに分ける開発サーバーのポート。OS の一時ポート（Linux は 32768〜）と重ならないところを使う
const PORT_START = 20000;
const PORT_END = 30000;
const PORT_COUNT = 10; // 1つのタスクで使える数（フロントとAPIなど、複数のサーバーを動かせるように）
const PROBE_HOSTS = ['127.0.0.1', '0.0.0.0', '::1', '::'];
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g; // eslint-disable-line no-control-regex

function cleanScript(s) {
  return String(s === undefined || s === null ? '' : s).replace(/\r\n?/g, '\n').trim();
}

function appendOutput(output, text) {
  const next = output + String(text).replace(ANSI, '');
  return next.length > MAX_OUTPUT ? next.slice(-MAX_OUTPUT) : next;
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    // IPv6 が使えない環境では、そのアドレスで待っているサーバーもいない
    server.once('error', (err) => resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT'));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

// port から PORT_COUNT 個が、すべて空いているか
// macOS では、ほかのアドレスで待っているサーバーとぶつからずに listen できてしまうので、アドレスごとに確かめる
async function portsFree(port, count = PORT_COUNT) {
  for (let p = port; p < port + count; p++) {
    for (const host of PROBE_HOSTS) if (!(await canListen(p, host))) return false;
  }
  return true;
}

// 途中の行が失敗したらそこで止める（セットアップの失敗を見逃さないように）
async function commandFor(cwd, script, env) {
  const base = { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };
  const posix = `set -e\n${script}`;
  const w = wsl.parseWslPath(cwd);
  if (w) {
    const cm = wsl.command(w.distro, w.linux, 'bash', ['-c', posix], { path: await wsl.shellPath(w.distro), env });
    return { file: cm.file, args: cm.args, options: { ...base, env: process.env, detached: !isWin } };
  }
  const options = { ...base, cwd, env: { ...process.env, ...env } };
  if (isWin) {
    // cmd.exe は複数行を受け取れないので、&& でつなぐ
    const line = script.split('\n').map((s) => s.trim()).filter(Boolean).join(' && ');
    return { file: line, args: [], options: { ...options, shell: true } };
  }
  // 別のプロセスグループにして、シェルの子（npm → node など）もまとめて止められるようにする
  return { file: '/bin/sh', args: ['-c', posix], options: { ...options, detached: true } };
}

function killScript(child, signal) {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    /* もう終わっている */
  }
}

/**
 * スクリプトを動かす。done は決して reject しない
 * @param {{ cwd: string, script: string, env?: object, timeoutMs?: number, onOutput?: (text: string) => void }} opts
 * @returns {{ done: Promise<{ code: number|null, signal?: string|null, stopped: boolean, timedOut: boolean, error?: string }>, stop: () => Promise<any> }}
 */
function startScript({ cwd, script, env = {}, timeoutMs = 0, onOutput = () => {} }) {
  let child = null;
  let ended = false;
  let stopped = false;
  let timedOut = false;
  let finish = () => {};
  const kill = () => {
    if (!child || ended) return;
    killScript(child, 'SIGTERM');
    setTimeout(() => {
      if (ended) return;
      killScript(child, 'SIGKILL');
      // グループの外に出たプロセスが出力を握っていても、待ち続けない
      setTimeout(() => finish({ code: null, signal: 'SIGKILL' }), KILL_WAIT_MS).unref();
    }, KILL_WAIT_MS).unref();
  };
  const done = (async () => {
    const cm = await commandFor(cwd, script, env);
    if (stopped) return { code: null, stopped, timedOut };
    return new Promise((resolve) => {
      let timer = null;
      finish = (r) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        resolve({ ...r, stopped, timedOut });
      };
      child = spawn(cm.file, cm.args, cm.options);
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding('utf8');
        stream.on('data', onOutput);
      }
      child.on('error', (err) => finish({ code: null, error: err.message }));
      child.on('close', (code, signal) => finish({ code, signal }));
      if (timeoutMs) {
        timer = setTimeout(() => {
          timedOut = true;
          kill();
        }, timeoutMs);
        timer.unref();
      }
    });
  })().catch((err) => ({ code: null, error: err.message, stopped, timedOut }));
  return {
    done,
    stop() {
      stopped = true;
      kill();
      return done;
    },
  };
}

module.exports = { SCRIPT_KINDS, SCRIPT_SETTINGS, PORT_START, PORT_END, PORT_COUNT, portsFree, cleanScript, appendOutput, commandFor, startScript };
