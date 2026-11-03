// Claude の返事（Markdown）を、ログに出すための HTML にする小さな変換器。
// 元の文字列はすべてエスケープしてから組み立てるので、HTML やスクリプトは混ざらない。
// リンクは http(s) のものだけを <a class="md-link" data-url> にする（クリックでブラウザで開く）。
// レンダラ（<script> で読み込む）とテスト（require）の両方から使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Markdown = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // 行の中の装飾（コード・リンク・太字・斜体・取り消し線）
  function inline(src) {
    const slots = [];
    const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
    let s = String(src).replace(/\u0000/g, '');
    // `code` は中身をそのまま出す
    s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, __, code) => keep(`<code>${esc(code.trim() || code)}</code>`));
    s = esc(s);
    // [text](https://...)
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => keep(`<a class="md-link" data-url="${url}" title="${url}">${text}</a>`));
    // むき出しの URL
    s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<>()（）]+[^\s<>()（）.,;:!?。、])/g, (_, pre, url) => pre + keep(`<a class="md-link" data-url="${url}" title="${url}">${url}</a>`));
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(?=\S)([\s\S]*?\S)__(?![A-Za-z0-9])/g, '<strong>$1</strong>');
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![A-Za-z0-9])/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
  }

  const RE = {
    fence: /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/,
    heading: /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^ {0,3}([-*_])(\s*\1){2,}\s*$/,
    quote: /^ {0,3}> ?(.*)$/,
    item: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/,
    tableSep: /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
  };
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const isTableStart = (line, next) => line.includes('|') && typeof next === 'string' && next.includes('|') && RE.tableSep.test(next);
  const isBlockStart = (line, next) =>
    RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) || RE.quote.test(line) || RE.item.test(line) || isTableStart(line, next);

  function list(lines, i) {
    // 同じ字下げの項目を集める（より深い字下げは入れ子のリストとして扱う）
    const first = lines[i].match(RE.item);
    const indent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const start = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    while (i < lines.length) {
      const m = lines[i].match(RE.item);
      if (m && m[1].length === indent && /\d/.test(m[2]) === ordered) {
        items.push([m[3]]);
        i++;
      } else if (m && m[1].length > indent && items.length) {
        items[items.length - 1].push(lines[i]);
        i++;
      } else if (!m && lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
        items[items.length - 1].push(lines[i]); // 続きの行
        i++;
      } else break;
    }
    const li = items.map((parts) => {
      let text = parts[0];
      let task = '';
      const t = text.match(/^\[([ xX])\]\s+(.*)$/);
      if (t) {
        task = `<input type="checkbox" disabled${t[1] === ' ' ? '' : ' checked'} /> `;
        text = t[2];
      }
      const rest = parts.slice(1);
      const nested = rest.length && RE.item.test(rest[0]) ? blocks(rest.map((l) => l.replace(/^\s+/, (w) => w.slice(Math.min(w.length, indent + 2))))) : rest.length ? `<br>${rest.map((l) => inline(l.trim())).join('<br>')}` : '';
      return `<li>${task}${inline(text)}${nested}</li>`;
    });
    const tag = ordered ? 'ol' : 'ul';
    return [`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${li.join('')}</${tag}>`, i];
  }

  function blocks(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      let m;
      if ((m = line.match(RE.fence))) {
        const mark = m[1];
        const lang = m[2];
        const body = [];
        i++;
        while (i < lines.length && !(lines[i].trim().startsWith(mark[0].repeat(mark.length)) && !lines[i].trim().replace(/[`~]/g, ''))) body.push(lines[i++]);
        i++; // 閉じの ``` を飛ばす（無ければ最後まで）
        out.push(`<pre class="md-code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`);
        continue;
      }
      if ((m = line.match(RE.heading))) {
        const lv = m[1].length;
        out.push(`<h${lv}>${inline(m[2])}</h${lv}>`);
        i++;
        continue;
      }
      if (RE.hr.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }
      if (RE.quote.test(line)) {
        const body = [];
        while (i < lines.length && (m = lines[i].match(RE.quote))) {
          body.push(m[1]);
          i++;
        }
        out.push(`<blockquote>${blocks(body)}</blockquote>`);
        continue;
      }
      if (RE.item.test(line)) {
        const [html, next] = list(lines, i);
        out.push(html);
        i = next;
        continue;
      }
      if (isTableStart(line, lines[i + 1])) {
        const head = cells(line);
        const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
        const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
        out.push(
          `<div class="md-table"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows
            .map((r) => `<tr>${head.map((_, k) => td('td', r[k] ?? '', k)).join('')}</tr>`)
            .join('')}</tbody></table></div>`,
        );
        continue;
      }
      // 段落（空行か、別のブロックが始まるまで）。改行はそのまま改行として出す
      const para = [];
      while (i < lines.length && lines[i].trim() && (!para.length || !isBlockStart(lines[i], lines[i + 1]))) para.push(lines[i++]);
      out.push(`<p>${para.map((l) => inline(l.trim())).join('<br>')}</p>`);
    }
    return out.join('');
  }

  function render(text) {
    return blocks(String(text ?? '').replace(/\r\n?/g, '\n').split('\n'));
  }

  return { render, inline, esc };
});
