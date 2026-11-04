#!/usr/bin/env node
// テスト用の偽 wsl.exe。本物と同じ引数（-d <distro> --cd <dir> -- <cmd> ...）を受け取り、
// そのフォルダでコマンドを実行する。-l -q では、本物と同じく UTF-16LE でディストリビューションの一覧を出す
const { spawnSync } = require('child_process');
const a = process.argv.slice(2);
if (a[0] === '-l') {
  process.stdout.write(Buffer.from('Ubuntu\r\ndocker-desktop\r\nDebian\r\n', 'utf16le'));
  process.exit(0);
}
let cwd = '/';
let i = 0;
const seen = [];
let mode = null;
while (i < a.length) {
  if (a[i] === '-d') seen.push(`distro=${a[++i]}`);
  else if (a[i] === '--cd') cwd = a[++i];
  else if (a[i] === '--exec' || a[i] === '-e') {
    mode = 'exec';
    break;
  } else if (a[i] === '--') {
    mode = 'shell';
    break;
  }
  i++;
}
const rest = a.slice(i + 1);
if (process.env.FAKE_WSL_LOG) require('fs').appendFileSync(process.env.FAKE_WSL_LOG, `${JSON.stringify({ seen, cwd, mode, rest })}\n`);
// 本物と同じく: `--` のあとは1つの文字列につなげて、既定のシェルで動かす。--exec はそのまま動かす
const r = mode === 'shell' ? spawnSync('sh', ['-c', rest.join(' ')], { cwd, stdio: 'inherit' }) : spawnSync(rest[0], rest.slice(1), { cwd, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
