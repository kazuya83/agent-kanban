'use strict';
// タスクどうしが「似た作業」かを、タイトルと指示の文字の並び（2文字ずつ）で比べる。
// 外のサービスやエージェントは使わず、手元だけで軽く判断する（完了のたびに動くため）。
// - Issue から作ったタスクの決まり文句（「GitHub の Issue を解決してください」「## 進め方」など）は、
//   たくさんのタスクに同じ行があるので比べる対象から外す
// - どのタスクにも出てくる文字の並びは軽く、そのタスクにしかない並びは重く数える（IDF）

const DEFAULT_THRESHOLD = 0.3; // これ以上似ていたら「似たタスク」とみなす（0〜1）
const COMMON_LINE_MIN = 3; // この数以上のタスクに同じ行があれば、決まり文句として外す

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#\d+/g, ' ')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function cardLines(c) {
  const lines = [c.title, ...String(c.prompt || '').slice(0, 3000).split('\n')].map(normalize).filter(Boolean);
  return [...new Set(lines)];
}

/**
 * target に似ているタスクを pool から探す
 * @param {object} target 比べるタスク
 * @param {object[]} pool 比べる相手（target を含んでいてもよい）
 * @returns {{card: object, score: number}[]} 似ているものを、似ている順に
 */
function findSimilarTasks(target, pool, { threshold = DEFAULT_THRESHOLD, max = 5 } = {}) {
  const others = pool.filter((c) => c && c.id !== target.id);
  if (!others.length) return [];
  const all = [target, ...others];
  const linesOf = all.map(cardLines);
  const lineFreq = new Map();
  for (const lines of linesOf) for (const l of lines) lineFreq.set(l, (lineFreq.get(l) || 0) + 1);
  const grams = linesOf.map((lines) => {
    const set = new Set();
    for (const l of lines) {
      if (all.length > COMMON_LINE_MIN && lineFreq.get(l) >= COMMON_LINE_MIN) continue;
      for (let i = 0; i < l.length - 1; i++) set.add(l.slice(i, i + 2));
    }
    return set;
  });
  const df = new Map();
  for (const g of grams) for (const x of g) df.set(x, (df.get(x) || 0) + 1);
  const n = all.length;
  const weight = (x) => (Math.log((n + 1) / ((df.get(x) || 0) + 1)) + 1) ** 2;
  const norms = grams.map((g) => Math.sqrt([...g].reduce((s, x) => s + weight(x), 0)));
  const [tg] = grams;
  const out = [];
  for (let i = 1; i < n; i++) {
    if (!norms[0] || !norms[i]) continue;
    let dot = 0;
    for (const x of tg) if (grams[i].has(x)) dot += weight(x);
    const score = dot / (norms[0] * norms[i]);
    if (score >= threshold) out.push({ card: all[i], score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

module.exports = { findSimilarTasks, DEFAULT_THRESHOLD };
