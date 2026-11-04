const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 画面のスクリプトはモジュールではないので、同じ名前の関数を2つ書くと、あとのほうが黙って前のほうを上書きする
// （以前、リポジトリの追加で「ホスト / このマシン」を選ぶ targetOpts() が、Pipeline の選択肢を作る同じ名前の関数に
//   上書きされ、遠隔操作中にこのマシンのフォルダを開けなかった）
for (const file of ['renderer/renderer.js', 'renderer/icons.js']) {
  test(`${file} に同じ名前のトップレベルの関数がない`, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const seen = new Map();
    const dup = [];
    src.split('\n').forEach((line, i) => {
      const m = line.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/);
      if (!m) return;
      if (seen.has(m[1])) dup.push(`${m[1]}（${seen.get(m[1])}行目と${i + 1}行目）`);
      else seen.set(m[1], i + 1);
    });
    assert.deepStrictEqual(dup, []);
  });
}
