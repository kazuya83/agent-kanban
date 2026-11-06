// 差分の行コメント: コメントと差分の行の対応づけと、エージェントに送る文章づくり。
// レンダラ（<script> で読み込む）とテスト（require）の両方から使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiffComments = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function tr(key, vars) {
    const api = typeof module === 'object' && module.exports ? require('./i18n.js') : typeof I18n !== 'undefined' ? I18n : null;
    return api ? api.tr(key, vars) : key;
  }
  const CODE_MAX = 300; // 1行がとても長いファイルでも、指示が長くなりすぎないようにする

  // 差分の1行がどの行かを表す。消した行だけ変更前の行番号で、それ以外は変更後の行番号で指す
  function lineRef(l) {
    return l.type === 'del' ? { side: 'old', line: l.oldNo } : { side: 'new', line: l.newNo };
  }

  function keyOf(path, ref) {
    return `${ref.side}:${ref.line}:${path}`;
  }

  function findLine(file, ref) {
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.type === 'meta') continue;
        const r = lineRef(l);
        if (r.side === ref.side && r.line === ref.line) return l;
      }
    }
    return null;
  }

  // 差分が変わって、もう同じ内容の行が無いコメント（行に出せないので、別に見せる）
  function orphans(files, comments) {
    const byPath = new Map(files.map((f) => [f.path, f]));
    return comments.filter((x) => {
      const f = byPath.get(x.path);
      const l = f && findLine(f, x);
      return !l || l.text !== x.code;
    });
  }

  function quote(code) {
    const s = String(code || '').trim();
    if (!s) return `> ${tr('（空行）')}`;
    return `> ${s.length > CODE_MAX ? `${s.slice(0, CODE_MAX)}…` : s}`;
  }

  // コメントをファイル・行の順に並べて、1通の指示にする
  function buildMessage(comments) {
    const sorted = [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    const parts = sorted.map((x) => {
      const where = `\`${x.path}:${x.line}\`${x.side === 'old' ? ` ${tr('（変更前の行）')}` : ''}`;
      return `### ${where}\n${quote(x.code)}\n\n${x.text.trim()}`;
    });
    return [tr('差分へのコメントです。それぞれの箇所を確かめて対応してください。'), ...parts].join('\n\n');
  }

  return { lineRef, keyOf, findLine, orphans, buildMessage };
});
