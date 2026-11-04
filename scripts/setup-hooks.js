#!/usr/bin/env node
// npm install / npm ci のとき（package.json の prepare）に、.githooks を git のフックとして使うように設定する。
// これで main にタスクをマージしたときに .githooks/post-merge → scripts/after-merge-build.sh が動く。
// git のリポジトリの外（npm パッケージとして入れたときなど）や、git がないときは何もしない。失敗しても install は止めない
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

try {
  if (!fs.existsSync(path.join(root, '.githooks'))) process.exit(0);
  if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') process.exit(0);
  let current = '';
  try {
    current = git(['config', '--get', 'core.hooksPath']);
  } catch {
    // まだ設定されていない
  }
  if (current === '.githooks') process.exit(0);
  if (current) {
    console.log(`setup-hooks: core.hooksPath はもう「${current}」になっているので、変えません（.githooks を使うには: git config core.hooksPath .githooks）`);
    process.exit(0);
  }
  git(['config', 'core.hooksPath', '.githooks']);
  console.log('setup-hooks: git config core.hooksPath .githooks を設定しました（マージしたあとの自動ビルドが有効になります）');
} catch {
  // git がない・リポジトリではない などのときは何もしない
}
