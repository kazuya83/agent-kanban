// `git diff` の出力（unified diff）をファイルごとの構造に分け、フォルダのツリーを作る。
// レンダラ（<script> で読み込む）とテスト（require）の両方から使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiffParse = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // git が "..." で囲んで C 風にエスケープしたパスを元に戻す
  function unquote(s) {
    if (!s || s[0] !== '"' || s[s.length - 1] !== '"') return s;
    const body = s.slice(1, -1);
    const bytes = [];
    const map = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 };
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === '\\' && i + 1 < body.length) {
        const n = body[i + 1];
        if (/[0-7]/.test(n)) {
          const oct = body.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
          bytes.push(parseInt(oct, 8));
          i += oct.length;
          continue;
        }
        if (n in map) {
          bytes.push(map[n]);
          i++;
          continue;
        }
      }
      for (const b of new TextEncoder().encode(ch)) bytes.push(b);
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  // "a/foo b/foo" や "/dev/null" から a/ b/ を外す
  function stripPrefix(p) {
    p = unquote(p.replace(/\t.*$/, '').trim());
    if (p === '/dev/null') return null;
    return p.replace(/^[ab]\//, '');
  }

  // "diff --git a/x b/x" からパスを推測する（--- / +++ が無いとき用）
  function pathsFromHeader(rest) {
    const q = rest.match(/^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/);
    if (q && (q[1][0] === '"' || q[2][0] === '"')) return [stripPrefix(q[1]), stripPrefix(q[2])];
    // 空白入りのパス: "a/X b/X" で前半と後半が同じになる位置を探す
    const half = (rest.length - 1) / 2;
    if (Number.isInteger(half) && rest.startsWith('a/') && rest[half] === ' ') {
      const a = rest.slice(2, half);
      const b = rest.slice(half + 3);
      if (a === b) return [a, b];
    }
    const parts = rest.split(' ');
    return [stripPrefix(parts[0] || ''), stripPrefix(parts.slice(1).join(' ') || '')];
  }

  function parseDiff(text) {
    const files = [];
    let f = null;
    let hunk = null;
    let oldNo = 0;
    let newNo = 0;
    const lines = String(text || '').split('\n');
    const finish = () => {
      if (!f) return;
      if (!f.path) f.path = f.newPath || f.oldPath || '(不明)';
      if (!f.status) f.status = f.oldPath == null ? 'A' : f.newPath == null ? 'D' : f.oldPath !== f.newPath ? 'R' : 'M';
      files.push(f);
    };
    for (const line of lines) {
      if (line.startsWith('diff --git ')) {
        finish();
        const [a, b] = pathsFromHeader(line.slice(11));
        f = { oldPath: a, newPath: b, path: '', status: '', binary: false, add: 0, del: 0, hunks: [], meta: [] };
        hunk = null;
        continue;
      }
      if (!f) continue;
      if (line.startsWith('@@')) {
        const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
        oldNo = m ? Number(m[1]) : 0;
        newNo = m ? Number(m[2]) : 0;
        hunk = { header: line, context: m ? m[3].trim() : '', lines: [] };
        f.hunks.push(hunk);
        continue;
      }
      if (hunk) {
        const c = line[0];
        if (c === '+') {
          hunk.lines.push({ type: 'add', text: line.slice(1), newNo: newNo++ });
          f.add++;
        } else if (c === '-') {
          hunk.lines.push({ type: 'del', text: line.slice(1), oldNo: oldNo++ });
          f.del++;
        } else if (c === ' ') {
          hunk.lines.push({ type: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
        } else if (c === '\\') {
          hunk.lines.push({ type: 'meta', text: line.slice(2) });
        }
        continue;
      }
      // ヘッダ部分
      if (line.startsWith('--- ')) f.oldPath = stripPrefix(line.slice(4));
      else if (line.startsWith('+++ ')) f.newPath = stripPrefix(line.slice(4));
      else if (line.startsWith('new file mode')) f.status = 'A';
      else if (line.startsWith('deleted file mode')) f.status = 'D';
      else if (line.startsWith('rename from ')) (f.oldPath = unquote(line.slice(12))), (f.status = 'R');
      else if (line.startsWith('rename to ')) (f.newPath = unquote(line.slice(10))), (f.status = 'R');
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') f.binary = true;
      else if (line.startsWith('old mode') || line.startsWith('new mode')) f.meta.push(line);
    }
    finish();
    for (const x of files) {
      if (x.status === 'A') x.oldPath = null;
      if (x.status === 'D') x.newPath = null;
      x.path = x.newPath || x.oldPath || x.path;
    }
    return files;
  }

  // ファイルの一覧からフォルダのツリーを作る。子が1つだけのフォルダは "src/components" のようにまとめる
  function buildTree(files) {
    const root = { name: '', path: '', dirs: new Map(), files: [] };
    files.forEach((file, index) => {
      const parts = file.path.split('/');
      const name = parts.pop();
      let node = root;
      for (const p of parts) {
        if (!node.dirs.has(p)) node.dirs.set(p, { name: p, path: node.path ? `${node.path}/${p}` : p, dirs: new Map(), files: [] });
        node = node.dirs.get(p);
      }
      node.files.push({ name, index, file });
    });
    const finalize = (node) => {
      let dirs = [...node.dirs.values()].map(finalize);
      dirs = dirs.map((d) => {
        while (d.dirs.length === 1 && d.files.length === 0) {
          const only = d.dirs[0];
          d = { ...only, name: `${d.name}/${only.name}` };
        }
        return d;
      });
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      const fl = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
      return { name: node.name, path: node.path, dirs, files: fl };
    };
    return finalize(root);
  }

  // ツリーの並び順（フォルダが先）でファイルの index を返す
  function treeOrder(tree) {
    const out = [];
    const walk = (n) => {
      n.dirs.forEach(walk);
      n.files.forEach((f) => out.push(f.index));
    };
    walk(tree);
    return out;
  }

  return { parseDiff, buildTree, treeOrder, unquote };
});
