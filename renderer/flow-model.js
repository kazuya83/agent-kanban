// Pipeline のフローチャート（ノードと線）の形・確かめ方・次の行き先の決め方。
// レンダラ（<script> で読み込む。フローチャートの編集画面）と、アプリ本体（require。Pipeline を動かす）の両方から使う。
//
// ノード: { id, type, x, y, ... }
//   start    開始（1つだけ）。線は1本で、工程へ
//   step     工程: { agent, label, instruction, model?, custom? }。線は1本（custom はカスタムエージェントの ID。あればその CLI・モデル・プロフィールで動かす）
//   if       分岐: { label, question }。直前の工程のエージェントが返事の最後に書いた [[RESULT:値]] を、線ごとの期待値と比べて行き先を選ぶ
//   parallel 並列: { label }。線を2本以上出し、枝ごとに別の worktree で同時に動かす
//   join     合流: { label }。並列の枝がすべて終わるのを待ち、枝の変更をマージして先へ進む。線は1本
//   end      終了（いくつ置いてもよい）。Pipeline を終えてレビュー列へ
// 線: { id, from, to, value?, when?, else?, maxLoops? }
//   value    分岐の期待値（分岐から出る線だけ）
//   when     分岐の条件の説明（エージェントに、どの値を書けばよいかを伝える）
//   else     どの期待値にも合わないときも、この線へ進む（分岐ごとに1本まで）
//   maxLoops 前のノードへ戻る線（ループ）を通れる回数の上限（1〜10。初期値 3）
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlowModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Node では require、画面では先に読み込んだ I18n。まだ無いときは原文のまま（差し込みだけ行う）
  const i18n = typeof module === 'object' && module.exports ? require('./i18n.js') : typeof I18n !== 'undefined' ? I18n : null;
  function tr(key, vars) {
    if (i18n) return i18n.tr(key, vars);
    return vars ? String(key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : key;
  }
  function typeName(type) {
    if (type === 'start') return tr('開始');
    if (type === 'step') return tr('工程');
    if (type === 'if') return tr('分岐');
    if (type === 'parallel') return tr('並列');
    if (type === 'join') return tr('合流');
    if (type === 'end') return tr('終了');
    return type || '';
  }
  const NODE_TYPES = ['start', 'step', 'if', 'parallel', 'join', 'end'];
  const AGENT_IDS = ['claude', 'codex', 'gemini', 'cursor'];
  const MAX_NODES = 40;
  const MAX_STEPS = 16;
  const MAX_EDGES = 80;
  const MAX_LOOPS_DEFAULT = 3;
  const MAX_LOOPS_LIMIT = 10;
  // エージェントへ渡す文が読む種別名。日本語のまま（画面では typeName と tr(TYPE_LABEL[type]) で訳す）。
  // 自分のキーだけを見る。toString や valueOf まで種別名にすると、文字列化したときに例外になる
  const TYPE_LABEL = new Proxy(
    { start: '開始', step: '工程', if: '分岐', parallel: '並列', join: '合流', end: '終了' },
    { get: (t, p, receiver) => (Object.hasOwn(t, p) ? t[p] : Reflect.get(t, p, receiver)) },
  );
  const NODE_W = { start: 120, step: 200, if: 170, parallel: 160, join: 160, end: 120 };

  function trunc(s, n) {
    const t = String(s == null ? '' : s);
    return t.length > n ? t.slice(0, n) : t;
  }
  function clampNum(v, lo, hi, d) {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }
  function cleanId(v) {
    const s = String(v == null ? '' : v).trim();
    return /^[A-Za-z0-9_-]{1,32}$/.test(s) ? s : '';
  }
  // 分岐の期待値は、大文字・小文字と前後の空白を区別しない
  function normValue(v) {
    return String(v == null ? '' : v).trim().toLowerCase();
  }
  function cleanLoops(v) {
    const m = Number(v);
    return Number.isInteger(m) && m >= 1 ? Math.min(m, MAX_LOOPS_LIMIT) : MAX_LOOPS_DEFAULT;
  }

  // ---------- 整える ----------

  /**
   * 保存・読み込みしたフローを整える（知らない種類・壊れた線は落とす。開始は1つだけ）
   * @param {any} raw
   * @param {{ isAgent?: (a: string) => boolean }} [opts]
   * @returns {{ nodes: object[], edges: object[] } | null} 形になっていなければ null
   */
  function cleanFlow(raw, opts) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) return null;
    const isAgent = (opts && opts.isAgent) || ((a) => AGENT_IDS.includes(a));
    const nodes = [];
    const ids = new Set();
    let hasStart = false;
    let steps = 0;
    for (const x of raw.nodes) {
      if (!x || typeof x !== 'object' || !NODE_TYPES.includes(x.type)) continue;
      if (nodes.length >= MAX_NODES) break;
      if (x.type === 'start' && hasStart) continue;
      if (x.type === 'step' && steps >= MAX_STEPS) continue;
      let id = cleanId(x.id);
      if (!id || ids.has(id)) {
        let n = nodes.length + 1;
        while (ids.has(`n${n}`)) n++;
        id = `n${n}`;
      }
      ids.add(id);
      const node = { id, type: x.type, x: clampNum(x.x, 0, 6000, 40), y: clampNum(x.y, 0, 6000, 40) };
      if (x.type === 'start') hasStart = true;
      if (x.type === 'step') {
        steps++;
        node.agent = isAgent(x.agent) ? x.agent : 'claude';
        // 既定の名前は日本語のまま保存する。画面に出すときだけ displayText で訳す
        node.label = trunc(String(x.label || '').trim(), 30) || `工程${steps}`;
        node.instruction = trunc(String(x.instruction || '').trim(), 4000);
        // モデル（空なら設定のエージェントごとの既定）。カスタムエージェントを選んだ工程は、そのエージェント・モデル・プロフィールで動かす
        const model = String(x.model || '').trim();
        if (model && model.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]*$/.test(model)) node.model = model;
        const custom = cleanId(String(x.custom || '').replace(/^custom:/, ''));
        if (custom) node.custom = custom;
      } else if (x.type === 'if') {
        node.label = trunc(String(x.label || '').trim(), 30) || '分岐';
        node.question = trunc(String(x.question || '').trim(), 1000);
      } else if (x.type === 'parallel' || x.type === 'join') {
        node.label = trunc(String(x.label || '').trim(), 30) || TYPE_LABEL[x.type];
      }
      nodes.push(node);
    }
    if (!hasStart) nodes.unshift({ id: ids.has('start') ? `start${nodes.length + 1}` : 'start', type: 'start', x: 40, y: 40 });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = [];
    const eids = new Set();
    for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
      if (!e || typeof e !== 'object' || edges.length >= MAX_EDGES) continue;
      const from = byId.get(cleanId(e.from));
      const to = byId.get(cleanId(e.to));
      if (!from || !to || from.type === 'end' || to.type === 'start') continue;
      let id = cleanId(e.id);
      if (!id || eids.has(id)) {
        let n = edges.length + 1;
        while (eids.has(`e${n}`)) n++;
        id = `e${n}`;
      }
      eids.add(id);
      const edge = { id, from: from.id, to: to.id };
      if (from.type === 'if') {
        const v = trunc(String(e.value == null ? '' : e.value).trim().replace(/[\]\[\n]/g, ''), 40);
        if (v) edge.value = v;
        const w = trunc(String(e.when || '').trim(), 300);
        if (w) edge.when = w;
        if (e.else) edge.else = true;
      }
      if (e.maxLoops !== undefined && e.maxLoops !== null && e.maxLoops !== '') edge.maxLoops = cleanLoops(e.maxLoops);
      edges.push(edge);
    }
    const flow = { nodes, edges };
    // ループの上限は、前のノードへ戻る線だけに持たせる
    const back = backEdges(flow);
    for (const e of edges) {
      if (back.has(e.id)) e.maxLoops = e.maxLoops || MAX_LOOPS_DEFAULT;
      else delete e.maxLoops;
    }
    return flow;
  }

  // ---------- 調べる ----------

  function nodeOf(flow, id) {
    return flow.nodes.find((n) => n.id === id) || null;
  }
  function outEdges(flow, id) {
    return flow.edges.filter((e) => e.from === id);
  }
  function inEdges(flow, id) {
    return flow.edges.filter((e) => e.to === id);
  }
  function startNode(flow) {
    return flow.nodes.find((n) => n.type === 'start') || null;
  }

  // 開始からたどったときに、前のノード（たどっている途中のノード）へ戻る線（ループ）の ID
  function backEdges(flow) {
    const back = new Set();
    const s = startNode(flow);
    if (!s) return back;
    const color = new Map(); // 1 = たどっている途中, 2 = 済み
    const stack = [{ id: s.id, i: 0 }];
    color.set(s.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const outs = outEdges(flow, top.id);
      if (top.i >= outs.length) {
        color.set(top.id, 2);
        stack.pop();
        continue;
      }
      const e = outs[top.i++];
      const c = color.get(e.to);
      if (c === 1) back.add(e.id);
      else if (!c) {
        color.set(e.to, 1);
        stack.push({ id: e.to, i: 0 });
      }
    }
    return back;
  }

  // 開始からたどれるノード
  function reachable(flow) {
    const seen = new Set();
    const s = startNode(flow);
    if (!s) return seen;
    const q = [s.id];
    while (q.length) {
      const id = q.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of outEdges(flow, id)) q.push(e.to);
    }
    return seen;
  }

  // 工程の並び（開始から近い順。番号「工程N」はこの順。たどり着けない工程は最後に）
  function orderSteps(flow) {
    const order = [];
    const seen = reachable(flow);
    for (const id of seen) {
      const n = nodeOf(flow, id);
      if (n && n.type === 'step') order.push(n);
    }
    for (const n of flow.nodes) if (n.type === 'step' && !seen.has(n.id)) order.push(n);
    return order;
  }

  /**
   * 並列のノードの枝と合流を調べる
   * @returns {{ join: string|null, branches: { edge: object, nodes: Set<string> }[], errors: string[] }}
   */
  function parallelInfo(flow, pid) {
    const errors = [];
    const p = nodeOf(flow, pid);
    const name = tr('並列「{label}」', { label: p && String(p.label || '').trim() ? displayText(p.label, p.type) : '' });
    const branches = [];
    let join = null;
    for (const e of outEdges(flow, pid)) {
      const nodes = new Set();
      const joins = new Set();
      const q = [e.to];
      while (q.length) {
        const id = q.shift();
        const n = nodeOf(flow, id);
        if (!n) continue;
        if (n.type === 'join') {
          joins.add(id);
          continue;
        }
        if (nodes.has(id)) continue;
        if (n.type === 'parallel') errors.push(tr('{name}の枝の中に、もう1つの並列は置けません', { name }));
        if (n.type === 'end') errors.push(tr('{name}の枝は、終了ではなく合流につないでください', { name }));
        if (n.type === 'start' || n.type === 'parallel' || n.type === 'end') continue;
        nodes.add(id);
        for (const o of outEdges(flow, id)) q.push(o.to);
      }
      if (joins.size > 1) errors.push(tr('{name}の枝が、別々の合流につながっています', { name }));
      const j = [...joins][0] || null;
      if (!j) errors.push(tr('{name}の枝が、合流につながっていません', { name }));
      else if (join && j !== join) errors.push(tr('{name}の枝は、すべて同じ合流につないでください', { name }));
      if (j && !join) join = j;
      branches.push({ edge: e, nodes });
    }
    // 枝どうしは分かれていること・枝の外から枝の中へ入る線がないこと
    const owner = new Map();
    branches.forEach((b, i) => {
      for (const id of b.nodes) {
        if (owner.has(id) && owner.get(id) !== i) errors.push(tr('{name}の枝どうしが、途中でつながっています（枝は合流までそれぞれ別にしてください）', { name }));
        owner.set(id, i);
      }
    });
    for (const b of branches) {
      for (const id of b.nodes) {
        for (const e of inEdges(flow, id)) {
          if (e.from !== pid && !b.nodes.has(e.from)) errors.push(tr('{name}の枝の外から、枝の中の「{label}」へ線が入っています', { name, label: shownLabel(nodeOf(flow, id)) }));
        }
      }
    }
    return { join, branches, errors: [...new Set(errors)] };
  }

  function labelOf(n) {
    if (!n) return '';
    if (n.type === 'start' || n.type === 'end') return TYPE_LABEL[n.type];
    return n.label || TYPE_LABEL[n.type];
  }

  // 保存されている名前を、画面に出すときだけ訳す。labelOf の戻り値は変えない
  function displayText(raw, type) {
    const s = String(raw == null ? '' : raw).trim();
    if (type && Object.hasOwn(TYPE_LABEL, type) && s === TYPE_LABEL[type]) return tr(s);
    const step = /^工程(\d+)$/.exec(s);
    if (step) return tr('工程{n}', { n: step[1] });
    const judge = /^(.*)の判定$/.exec(s);
    if (judge && judge[1]) return tr('{name}の判定', { name: displayText(judge[1]) });
    return s;
  }
  function shownLabel(n) {
    if (!n) return '';
    return displayText(labelOf(n), n.type);
  }
  // 名前欄に訳を入れると、その文が保存される。既定のままなら欄は空にする
  function isDefaultLabel(n) {
    if (!n || !n.type) return false;
    const raw = String(n.label || '').trim();
    if (!raw) return true;
    if (Object.hasOwn(TYPE_LABEL, n.type) && raw === TYPE_LABEL[n.type]) return true;
    if (/^工程\d+$/.test(raw)) return true;
    if (/^.+の判定$/.test(raw)) return true;
    return false;
  }

  /**
   * フローを確かめる。直さないと Pipeline を始められないところを、日本語の文で返す（なければ空）
   * @param {{ nodes: object[], edges: object[] }} flow
   * @returns {string[]}
   */
  function validateFlow(flow) {
    const errors = [];
    if (!flow || !Array.isArray(flow.nodes)) return [tr('フローがありません')];
    const s = startNode(flow);
    if (!s) return [tr('開始のノードがありません')];
    const steps = flow.nodes.filter((n) => n.type === 'step');
    if (!steps.length) errors.push(tr('工程のノードが1つもありません'));
    const name = (n) => tr('{type}「{label}」', { type: typeName(n.type), label: shownLabel(n) });
    for (const n of flow.nodes) {
      const outs = outEdges(flow, n.id);
      const ins = inEdges(flow, n.id);
      if (n.type === 'start') {
        if (outs.length !== 1) errors.push(tr('開始からは、線を1本だけ出してください'));
        else if (nodeOf(flow, outs[0].to).type !== 'step') errors.push(tr('開始の次は、工程にしてください'));
      } else if (n.type === 'step' || n.type === 'join') {
        if (!outs.length) errors.push(tr('{name}から先の線がありません（最後なら終了につないでください）', { name: name(n) }));
        else if (outs.length > 1) errors.push(tr('{name}からは、線を1本だけ出してください（行き先を分けるときは分岐、同時に動かすときは並列を使います）', { name: name(n) }));
      } else if (n.type === 'if') {
        if (!outs.length) errors.push(tr('{name}から先の線がありません', { name: name(n) }));
        const vals = new Set();
        for (const e of outs) {
          if (!e.value && !e.else) errors.push(tr('{name}から出る線に、期待値がないものがあります（期待値を書くか、「どれにも合わないとき」にしてください）', { name: name(n) }));
          if (e.value) {
            const v = normValue(e.value);
            if (vals.has(v)) errors.push(tr('{name}の期待値「{value}」が重なっています', { name: name(n), value: e.value }));
            vals.add(v);
          }
        }
        if (outs.filter((e) => e.else).length > 1) errors.push(tr('{name}の「どれにも合わないとき」の線は、1本だけにしてください', { name: name(n) }));
        if (!ins.length || ins.some((e) => nodeOf(flow, e.from).type !== 'step')) errors.push(tr('{name}の前は、工程にしてください（その工程のエージェントに、判定の値を書いてもらいます）', { name: name(n) }));
      } else if (n.type === 'parallel') {
        if (outs.length < 2) errors.push(tr('{name}からは、線を2本以上出してください', { name: name(n) }));
        if (outs.some((e) => nodeOf(flow, e.to).type !== 'step')) errors.push(tr('{name}から出る線は、それぞれ工程につないでください', { name: name(n) }));
      }
      if (n.type !== 'start' && !ins.length) errors.push(tr('{name}に入る線がありません', { name: name(n) }));
    }
    const reach = reachable(flow);
    for (const n of flow.nodes) if (!reach.has(n.id) && inEdges(flow, n.id).length) errors.push(tr('{name}は、開始からたどり着けません', { name: name(n) }));
    // 並列と合流の組
    const owned = new Map();
    for (const p of flow.nodes.filter((n) => n.type === 'parallel')) {
      const info = parallelInfo(flow, p.id);
      errors.push(...info.errors);
      if (!info.join) continue;
      if (owned.has(info.join)) errors.push(tr('合流「{label}」に、2つの並列がつながっています', { label: shownLabel(nodeOf(flow, info.join)) }));
      owned.set(info.join, p.id);
      const inside = new Set(info.branches.flatMap((b) => [...b.nodes]));
      for (const e of inEdges(flow, info.join)) if (!inside.has(e.from)) errors.push(tr('合流「{label}」には、並列「{parallel}」の枝だけをつないでください', { label: shownLabel(nodeOf(flow, info.join)), parallel: shownLabel(p) }));
    }
    for (const j of flow.nodes.filter((n) => n.type === 'join')) if (!owned.has(j.id) && inEdges(flow, j.id).length) errors.push(tr('{name}が、どの並列の枝ともつながっていません', { name: name(j) }));
    return [...new Set(errors)];
  }

  // ---------- 動かす ----------

  /**
   * 工程の返事の最後に書いてもらった判定の値（[[RESULT:値]]）。なければ null
   * 前のバージョンの印（[[PASS]] / [[FAIL]]）は pass / fail として読む
   */
  function resultValue(text) {
    const s = String(text || '');
    let last = null;
    const re = /\[\[RESULT:\s*([^\]\n]*?)\s*\]\]/gi;
    let m;
    while ((m = re.exec(s))) last = m[1];
    if (last !== null && normValue(last)) return normValue(last);
    const p = s.lastIndexOf('[[PASS]]');
    const f = s.lastIndexOf('[[FAIL]]');
    if (p < 0 && f < 0) return null;
    return f > p ? 'fail' : 'pass';
  }

  /**
   * ノード fromId（終わった工程・開始・合流）から線をたどり、次に動かすところを決める
   * - 分岐は result（直前の工程の判定の値）で行き先を選び、そのまま先へたどる
   * - ループ（前のノードへ戻る線）は、通った回数を counts に数え、上限に達したら limit を返す
   * @param {{ nodes: object[], edges: object[] }} flow
   * @param {string} fromId
   * @param {{ result?: string|null, counts?: Record<string, number> }} [ctx]
   * @returns {{ kind: 'step'|'parallel'|'join'|'end'|'limit'|'nomatch', node?: object, edge?: object, counts: Record<string, number>, branch?: object }}
   */
  function route(flow, fromId, ctx) {
    const counts = { ...((ctx && ctx.counts) || {}) };
    const result = ctx && ctx.result != null ? normValue(ctx.result) : null;
    const back = backEdges(flow);
    let cur = nodeOf(flow, fromId);
    let branch = null;
    for (let guard = 0; guard < MAX_NODES + 2; guard++) {
      if (!cur) return { kind: 'end', counts };
      let edge;
      if (cur.type === 'if') {
        const outs = outEdges(flow, cur.id);
        edge = (result && outs.find((e) => e.value && normValue(e.value) === result)) || outs.find((e) => e.else);
        if (!edge) return { kind: 'nomatch', node: cur, counts };
        branch = { node: cur, edge };
      } else {
        edge = outEdges(flow, cur.id)[0];
        if (!edge) return { kind: 'end', counts };
      }
      if (back.has(edge.id)) {
        const n = counts[edge.id] || 0;
        if (n >= (edge.maxLoops || MAX_LOOPS_DEFAULT)) return { kind: 'limit', edge, node: cur, counts, branch };
        counts[edge.id] = n + 1;
      }
      const next = nodeOf(flow, edge.to);
      if (!next || next.type === 'end') return { kind: 'end', node: next || undefined, edge, counts, branch };
      if (next.type === 'step' || next.type === 'parallel' || next.type === 'join') return { kind: next.type, node: next, edge, counts, branch };
      cur = next; // 分岐: もう一度たどる
    }
    return { kind: 'end', counts };
  }

  /**
   * 工程 stepId のすぐあとが分岐なら、その分岐と選べる値（エージェントに書いてもらう判定の説明に使う）
   * @returns {{ node: object, options: { edge: object, value: string, when: string }[], elseEdge: object|null } | null}
   */
  function judgeOf(flow, stepId) {
    const e = outEdges(flow, stepId)[0];
    const n = e && nodeOf(flow, e.to);
    if (!n || n.type !== 'if') return null;
    const outs = outEdges(flow, n.id);
    return {
      node: n,
      options: outs.filter((x) => x.value).map((x) => ({ edge: x, value: x.value, when: x.when || '' })),
      elseEdge: outs.find((x) => x.else) || null,
    };
  }

  // ---------- 並べる ----------

  /**
   * ノードを開始から上下に並べ直す（前のノードへ戻る線は数えない。同じ段のノードは横に並べる）
   * @param {{ nodes: object[], edges: object[] }} flow  x, y を書き換える
   * @returns {{ nodes: object[], edges: object[] }} flow
   */
  function autoLayout(flow) {
    const back = backEdges(flow);
    const forward = flow.edges.filter((e) => !back.has(e.id));
    const rank = new Map();
    // 枝の長さが違っても、合流は長い枝のあとに来るように、入る線がすべて済んだノードから段を決める
    const waiting = new Map(flow.nodes.map((n) => [n.id, forward.filter((e) => e.to === n.id).length]));
    const queue = flow.nodes.filter((n) => !waiting.get(n.id)).map((n) => n.id);
    while (queue.length) {
      const id = queue.shift();
      const r = rank.get(id) || 0;
      rank.set(id, r);
      for (const e of forward) {
        if (e.from !== id) continue;
        rank.set(e.to, Math.max(rank.get(e.to) || 0, r + 1));
        waiting.set(e.to, waiting.get(e.to) - 1);
        if (!waiting.get(e.to)) queue.push(e.to);
      }
    }
    const rows = [];
    for (const n of flow.nodes) {
      const r = rank.get(n.id) || 0;
      (rows[r] = rows[r] || []).push(n);
    }
    const GAP_X = 240;
    const GAP_Y = 110;
    const widest = Math.max(1, ...rows.map((row) => (row ? row.length : 0)));
    const center = 40 + (widest * GAP_X) / 2;
    rows.forEach((row, r) => {
      row.forEach((n, i) => {
        n.x = Math.round(center + (i - (row.length - 1) / 2) * GAP_X - (NODE_W[n.type] || 160) / 2);
        n.y = 30 + r * GAP_Y;
      });
    });
    return flow;
  }

  // ---------- 前のバージョンの工程のリストから作る ----------

  /**
   * 工程のリスト（[{ agent, label, instruction, onPass?, onFail?, maxLoops? }]。整えたもの）を、フローにする
   * 判定する工程（onPass / onFail があるもの）は、工程 → 分岐（合格 pass / 差し戻し fail）にする。
   * 前と同じく、印がなければ合格として扱う（合格の線を「どれにも合わないとき」にもする）
   */
  function flowFromSteps(steps) {
    const list = Array.isArray(steps) ? steps : [];
    const X = 80;
    const nodes = [{ id: 'start', type: 'start', x: X + 60, y: 30 }];
    const edges = [];
    let y = 110;
    const sid = (i) => `s${i + 1}`;
    const judges = (st) => st.onPass !== undefined || st.onFail !== undefined;
    list.forEach((st, i) => {
      // 既定の工程名と分岐名は日本語のまま保存する。question と when はエージェントへ渡す判定の指示なので訳さない
      const stepLabel = String(st.label || '').trim() || `工程${i + 1}`;
      nodes.push({ id: sid(i), type: 'step', x: X, y, agent: st.agent || 'claude', label: stepLabel, instruction: st.instruction || '' });
      y += 110;
      if (judges(st)) {
        nodes.push({ id: `if${i + 1}`, type: 'if', x: X + 30, y, label: `${stepLabel}の判定`, question: '作業の結果を判定してください' });
        y += 110;
      }
    });
    nodes.push({ id: 'end', type: 'end', x: X + 60, y });
    const target = (i, to) => {
      if (to === 'end') return 'end';
      const j = to === undefined || to === null ? i + 1 : to;
      return j >= list.length ? 'end' : sid(j);
    };
    let n = 0;
    const edge = (from, to, extra) => edges.push({ id: `e${++n}`, from, to, ...(extra || {}) });
    if (list.length) edge('start', sid(0));
    list.forEach((st, i) => {
      if (!judges(st)) return edge(sid(i), target(i, undefined));
      const ifId = `if${i + 1}`;
      edge(sid(i), ifId);
      const loops = st.maxLoops ? { maxLoops: st.maxLoops } : {};
      edge(ifId, target(i, st.onPass), { value: 'pass', when: '問題がない（合格）', else: true, ...loops });
      edge(ifId, target(i, st.onFail), { value: 'fail', when: '直す必要がある（差し戻し）', ...loops });
    });
    return cleanFlow({ nodes, edges });
  }

  return {
    NODE_TYPES,
    TYPE_LABEL,
    MAX_NODES,
    MAX_STEPS,
    MAX_LOOPS_DEFAULT,
    MAX_LOOPS_LIMIT,
    cleanFlow,
    validateFlow,
    backEdges,
    orderSteps,
    parallelInfo,
    nodeOf,
    outEdges,
    inEdges,
    startNode,
    labelOf,
    displayText,
    shownLabel,
    isDefaultLabel,
    normValue,
    resultValue,
    route,
    judgeOf,
    autoLayout,
    flowFromSteps,
  };
});
