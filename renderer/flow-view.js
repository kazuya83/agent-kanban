// 進捗タブ: Pipelineのフローチャートを、読み取り専用で描く（どの工程が終わったか・今どこを動かしているか）
// - ノードの位置は、設定のフローチャート（flow-editor.js で並べたもの）をそのまま使う
// - 工程の状態は renderer.js の relayStepState() で決めたものを受け取り、分岐・並列・合流・開始・終了の状態はここで決める
// レンダラ（<script> で読み込む）とテスト（require）の両方から使う。
(function (root, factory) {
  const api = factory(root.FlowModel || (typeof require === 'function' ? require('./flow-model') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlowView = api;
})(typeof self !== 'undefined' ? self : this, function (FM) {
  // 大きさは flow-editor.js と同じ
  const W = { start: 120, step: 200, if: 170, parallel: 160, join: 160, end: 120 };
  const H = { start: 40, step: 64, if: 56, parallel: 48, join: 48, end: 40 };
  const PAD = 24;
  // まだ通っていない（これから・飛ばした）状態
  const IDLE = new Set(['pending', 'skipped']);
  // 終わった状態（それ以外の、まだ通っていないものでない状態は「今ここ」）
  const DONE = 'done';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function cut(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  }
  const size = (n) => [W[n.type] || 160, H[n.type] || 48];

  /**
   * ノードごとの状態
   * @param {object} flow
   * @param {(id: string) => string|null} stepState 工程のノードの状態（工程でなければ null）
   * @param {{ started?: boolean, finished?: boolean }} o started: 1つ目の工程を始めた / finished: Pipelineを終えた
   * @returns {Map<string, string>}
   */
  function nodeStates(flow, stepState, o = {}) {
    const nodes = (flow && flow.nodes) || [];
    const edges = (flow && flow.edges) || [];
    const back = FM ? FM.backEdges(flow) : new Set();
    const st = new Map();
    for (const n of nodes) {
      if (n.type === 'step') st.set(n.id, stepState(n.id) || 'pending');
      else if (n.type === 'start') st.set(n.id, o.started ? DONE : 'pending');
      else if (n.type === 'end') st.set(n.id, o.finished ? DONE : 'pending');
    }
    // 分岐・並列・合流は、その先（戻る線は除く）まで進んでいれば「通った」
    const memo = new Map();
    const reached = (id, seen) => {
      if (st.has(id)) return !IDLE.has(st.get(id));
      if (memo.has(id)) return memo.get(id);
      if (seen.has(id)) return false;
      seen.add(id);
      const r = edges.some((e) => e.from === id && !back.has(e.id) && reached(e.to, seen));
      memo.set(id, r);
      return r;
    };
    for (const n of nodes) if (!st.has(n.id)) st.set(n.id, reached(n.id, new Set()) ? DONE : 'pending');
    return st;
  }

  // 線の状態: done（通った）/ active（今の工程へ向かっている）/ ''（まだ）
  function edgeState(e, states, back, counts) {
    const a = states.get(e.from);
    const b = states.get(e.to);
    if (back.has(e.id)) return counts && counts[e.id] > 0 ? DONE : '';
    if (a !== DONE || !b || IDLE.has(b)) return '';
    return b === DONE ? DONE : 'active';
  }

  function edgePath(a, b) {
    const [aw, ah] = size(a);
    const [bw] = size(b);
    const sx = a.x + aw / 2;
    const sy = a.y + ah;
    const tx = b.x + bw / 2;
    const ty = b.y;
    const dy = ty - sy;
    if (dy > 24) return { d: `M${sx},${sy} C${sx},${sy + dy / 2} ${tx},${ty - dy / 2} ${tx},${ty}`, mx: (sx + tx) / 2, my: (sy + ty) / 2 };
    // 上（前）のノードへ戻る線は、右に回り込む
    const off = Math.max(aw, bw) / 2 + 60;
    return { d: `M${sx},${sy} C${sx + off},${sy + 90} ${tx + off},${ty - 90} ${tx},${ty}`, mx: Math.max(sx, tx) + off * 0.75, my: (sy + ty) / 2 };
  }

  /**
   * フローチャートの SVG
   * @param {object} flow
   * @param {Map<string, string>} states nodeStates() の結果
   * @param {{ marks?: Record<string, string>, labels?: Record<string, string>, stepInfo?: (n: object) => { title?: string, sub?: string, tip?: string }, counts?: Record<string, number>, current?: string|null }} o
   *   marks / labels: 状態ごとの印（✓ など）と名前、stepInfo: 工程のノードに出す名前・エージェント、current: 今の工程のノード
   */
  function html(flow, states, o = {}) {
    const nodes = ((flow && flow.nodes) || []).filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
    if (!nodes.length) return '';
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const back = FM ? FM.backEdges(flow) : new Set();
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    // 戻る線は右に回り込むので、その分も広げる
    const maxX = Math.max(...nodes.map((n) => n.x + size(n)[0])) + ((flow.edges || []).some((e) => back.has(e.id)) ? 150 : 0);
    const maxY = Math.max(...nodes.map((n) => n.y + size(n)[1]));
    const ox = PAD - minX;
    const oy = PAD - minY;
    const vw = Math.ceil(maxX - minX + PAD * 2);
    const vh = Math.ceil(maxY - minY + PAD * 2);
    const marks = o.marks || {};
    const labels = o.labels || {};

    const edgeSvg = (flow.edges || [])
      .map((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return '';
        const p = edgePath({ ...a, x: a.x + ox, y: a.y + oy }, { ...b, x: b.x + ox, y: b.y + oy });
        const es = edgeState(e, states, back, o.counts);
        const parts = [];
        if (a.type === 'if') parts.push(e.value || (e.else ? 'それ以外' : ''));
        if (back.has(e.id)) parts.push(`↺${o.counts && o.counts[e.id] ? ` ${o.counts[e.id]}/` : ' '}${e.maxLoops || (FM && FM.MAX_LOOPS_DEFAULT) || 3}`);
        const label = parts.filter(Boolean).join(' ');
        return `<g class="fv-edge ${es ? `e-${es}` : ''} ${back.has(e.id) ? 'back' : ''}"><path d="${p.d}" marker-end="url(#fvArrow${es === DONE ? 'Done' : es === 'active' ? 'Active' : ''})"/>${label ? `<text x="${p.mx}" y="${p.my}">${esc(cut(label, 18))}</text>` : ''}</g>`;
      })
      .join('');

    const nodeSvg = nodes
      .map((n) => {
        const [w, h] = size(n);
        const x = n.x + ox;
        const y = n.y + oy;
        const s = states.get(n.id) || 'pending';
        const info = n.type === 'step' && o.stepInfo ? o.stepInfo(n) || {} : {};
        const title = info.title || (FM ? FM.labelOf(n) : n.label || n.type);
        const kind = FM ? FM.TYPE_LABEL[n.type] : n.type;
        const round = n.type === 'start' || n.type === 'end' ? h / 2 : n.type === 'if' ? 14 : 8;
        const cur = o.current && o.current === n.id;
        const mark = marks[s] || '';
        const tip = [`${kind}: ${title}`, labels[s] || '', info.tip || ''].filter(Boolean).join('\n');
        let body;
        if (n.type === 'step') {
          body = `<text class="fv-title" x="${x + 30}" y="${y + 25}">${esc(cut(title, 15))}</text>
            <text class="fv-sub" x="${x + 30}" y="${y + 44}">${esc(cut([labels[s], info.sub].filter(Boolean).join(' · '), 22))}</text>
            <circle class="fv-dot" cx="${x + 16}" cy="${y + h / 2}" r="9"/><text class="fv-mark" x="${x + 16}" y="${y + h / 2}">${esc(mark)}</text>`;
        } else {
          body = `<text class="fv-title c" x="${x + w / 2}" y="${y + h / 2}">${esc(cut(n.type === 'start' || n.type === 'end' ? title : `${kind} ${title === kind ? '' : title}`.trim(), 14))}${s === DONE && n.type !== 'start' ? ' ✓' : ''}</text>`;
        }
        return `<g class="fv-node t-${n.type} rs-${s}${cur ? ' cur' : ''}"><title>${esc(tip)}</title><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${round}"/>${body}</g>`;
      })
      .join('');

    return `<svg class="fv" viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}" style="max-width:100%;height:auto" role="img" aria-label="Pipelineのフローチャート">
      <defs>
        <marker id="fvArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="fv-arrow"/></marker>
        <marker id="fvArrowDone" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="fv-arrow done"/></marker>
        <marker id="fvArrowActive" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="fv-arrow active"/></marker>
      </defs>${edgeSvg}${nodeSvg}</svg>`;
  }

  return { nodeStates, edgeState, html, size };
});
