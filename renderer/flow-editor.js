// Pipelineのフローチャートを編集する画面（設定のモーダルの上に、もう1つのモーダルとして出す）
// - ノードはドラッグで並べ、下の丸（出口）から別のノードへドラッグすると線をつなぐ
// - ノード・線を押すと、右の欄で中身（エージェント・担当の説明・期待値・ループの上限など）を変えられる
// - 形は FlowModel（flow-model.js）で確かめ、直すところがあるうちは保存できない
(function (root) {
  const FM = root.FlowModel;
  const W = { start: 120, step: 200, if: 170, parallel: 160, join: 160, end: 120 };
  const H = { start: 40, step: 64, if: 56, parallel: 48, join: 48, end: 40 };
  const ADD = [
    ['step', '工程', '1つのエージェントが作業する工程'],
    ['if', '分岐（if）', '直前の工程のエージェントが書いた判定の値で、行き先を分けます'],
    ['parallel', '並列', '枝ごとに別の worktree で、工程を同時に動かします'],
    ['join', '合流', '並列の枝がすべて終わるのを待ち、変更をマージします'],
    ['end', '終了', 'Pipelineを終えてレビュー列へ'],
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function uid(prefix, used) {
    let id;
    do id = `${prefix}${Math.random().toString(36).slice(2, 7)}`;
    while (used.has(id));
    return id;
  }

  // 名前が空の工程で、カスタムエージェントを選んでいれば、その名前を工程の名前にする（変えたら true）
  function fillCustomLabels(flow, customs) {
    let changed = false;
    for (const n of (flow && flow.nodes) || []) {
      if (n.type !== 'step' || !n.custom || String(n.label || '').trim()) continue;
      const ca = (customs || []).find((x) => x && x.id === n.custom);
      if (!ca || !ca.name) continue;
      n.label = String(ca.name).slice(0, 30);
      changed = true;
    }
    return changed;
  }

  /**
   * @param {{ flow: object, agents: [string, string][], enabled: string[], customAgents?: object[], modelSuggest?: Record<string, string[]>, defaultAgent: string, onSave: (flow: object) => Promise<boolean>|boolean }} opts
   *   agents: [[id, 表示名]]（すべてのエージェント）、enabled: 使うエージェント、customAgents: カスタムエージェント（{ id, name, icon, agent, model }）
   */
  function open(opts) {
    const host = document.getElementById('flowModal');
    const box = document.getElementById('flowModalBox');
    // 編集は写しに対して行う（保存するまで設定は変えない）
    const flow = JSON.parse(JSON.stringify(opts.flow || { nodes: [], edges: [] }));
    if (!flow.nodes.some((n) => n.type === 'start')) flow.nodes.unshift({ id: 'start', type: 'start', x: 60, y: 30 });
    let sel = null; // { kind: 'node'|'edge', id }
    let dirty = false;
    const agentName = (a) => (opts.agents.find((x) => x[0] === a) || [a, a])[1];
    const customs = Array.isArray(opts.customAgents) ? opts.customAgents : [];
    const customOf = (id) => customs.find((x) => x.id === id) || null;
    // 工程を動かすエージェント（カスタムエージェントなら、その元の CLI）
    const stepAgent = (n) => (n.custom && customOf(n.custom) ? customOf(n.custom).agent : n.agent);
    const stepOff = (n) => (n.custom && !customOf(n.custom)) || !opts.enabled.includes(stepAgent(n));
    const stepName = (n) => {
      if (n.custom) {
        const ca = customOf(n.custom);
        if (!ca) return 'カスタムエージェントが見つかりません';
        return `${ca.icon ? `${ca.icon} ` : ''}${ca.name}（${agentName(ca.agent)}${ca.model ? ` / ${ca.model}` : ''}）${opts.enabled.includes(ca.agent) ? '' : '（使わない設定）'}`;
      }
      return agentName(n.agent) + (n.model ? ` / ${n.model}` : '') + (opts.enabled.includes(n.agent) ? '' : '（使わない設定）');
    };

    box.innerHTML = `
      <div class="fe-head">
        <h2>Pipelineのフローチャート</h2>
        <div class="fe-tools">${ADD.map(([t, l, tip]) => `<button class="btn small fe-add" data-type="${t}" type="button" title="${esc(tip)}">＋ ${esc(l)}</button>`).join('')}</div>
      </div>
      <p class="muted small fe-help">ノードはドラッグで動かせます。ノードの下の丸（出口）から別のノードへドラッグすると、線をつなげます。前のノードへ戻る線を引くとループになり、戻る上限を決められます。ノードや線を選んで Delete キーで消せます。</p>
      <div class="fe-main">
        <div class="fe-canvas" id="feCanvas"><div class="fe-inner" id="feInner"><svg class="fe-svg" id="feSvg"></svg></div></div>
        <div class="fe-side" id="feSide"></div>
      </div>
      <div class="fe-errors" id="feErrors"></div>
      <div class="modal-actions"><button class="btn ghost" id="feCancel" type="button">キャンセル</button><button class="btn primary" id="feSave" type="button">保存</button></div>`;
    host.classList.remove('hidden');
    const inner = box.querySelector('#feInner');
    const svg = box.querySelector('#feSvg');
    const canvas = box.querySelector('#feCanvas');
    const side = box.querySelector('#feSide');

    const node = (id) => flow.nodes.find((n) => n.id === id);
    const size = (n) => [W[n.type] || 160, H[n.type] || 48];
    const touch = () => {
      dirty = true;
    };

    // ---------- 描く ----------
    function nodeHtml(n) {
      const [w, h] = size(n);
      const steps = FM.orderSteps(flow);
      let title = FM.labelOf(n);
      let sub = '';
      if (n.type === 'step') {
        const i = steps.findIndex((x) => x.id === n.id);
        title = `${i + 1}. ${n.label || '（名前なし）'}`;
        sub = stepName(n);
      } else if (n.type === 'if') sub = n.question ? n.question : '判定の値で分ける';
      else if (n.type === 'parallel') sub = '同時に動かす';
      else if (n.type === 'join') sub = 'すべて待ってマージ';
      const port = n.type === 'end' ? '' : '<span class="fe-port" title="ドラッグして、つなぐ先のノードで離す"></span>';
      return `<div class="fe-node t-${n.type} ${sel && sel.kind === 'node' && sel.id === n.id ? 'sel' : ''} ${n.type === 'step' && stepOff(n) ? 'off' : ''}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${w}px;height:${h}px">
        <span class="fe-kind">${esc(FM.TYPE_LABEL[n.type])}</span>
        <b class="fe-title">${esc(title)}</b>${sub ? `<span class="fe-sub">${esc(sub)}</span>` : ''}${port}</div>`;
    }
    function edgePath(e) {
      const a = node(e.from);
      const b = node(e.to);
      if (!a || !b) return null;
      const [aw, ah] = size(a);
      const [bw] = size(b);
      const sx = a.x + aw / 2;
      const sy = a.y + ah;
      const tx = b.x + bw / 2;
      const ty = b.y;
      const dy = ty - sy;
      let d;
      let mx;
      let my;
      if (dy > 24) {
        d = `M${sx},${sy} C${sx},${sy + dy / 2} ${tx},${ty - dy / 2} ${tx},${ty}`;
        mx = (sx + tx) / 2;
        my = (sy + ty) / 2;
      } else {
        // 上（前）のノードへ戻る線は、右に回り込む
        const off = Math.max(aw, bw) / 2 + 60;
        d = `M${sx},${sy} C${sx + off},${sy + 90} ${tx + off},${ty - 90} ${tx},${ty}`;
        mx = Math.max(sx, tx) + off * 0.75;
        my = (sy + ty) / 2;
      }
      return { d, mx, my };
    }
    function edgeLabel(e, back) {
      const parts = [];
      const from = node(e.from);
      if (from && from.type === 'if') {
        if (e.value) parts.push(e.value);
        if (e.else) parts.push(e.value ? '＋それ以外' : 'それ以外');
        if (!e.value && !e.else) parts.push('期待値なし');
      }
      if (back.has(e.id)) parts.push(`↺ ${e.maxLoops || FM.MAX_LOOPS_DEFAULT}回まで`);
      return parts.join(' ');
    }
    // keepSide: 右の欄は描き直さない（入力中の欄のフォーカスを保つ）
    function draw({ keepSide = false } = {}) {
      const back = FM.backEdges(flow);
      // キャンバスの大きさは、いちばん遠いノードに合わせて広げる
      const maxX = Math.max(900, ...flow.nodes.map((n) => n.x + size(n)[0] + 260));
      const maxY = Math.max(560, ...flow.nodes.map((n) => n.y + size(n)[1] + 160));
      inner.style.width = `${maxX}px`;
      inner.style.height = `${maxY}px`;
      svg.setAttribute('width', maxX);
      svg.setAttribute('height', maxY);
      const paths = flow.edges
        .map((e) => {
          const p = edgePath(e);
          if (!p) return '';
          const on = sel && sel.kind === 'edge' && sel.id === e.id;
          const label = edgeLabel(e, back);
          const cls = `${on ? 'sel' : ''} ${back.has(e.id) ? 'back' : ''}`;
          return `<g class="fe-edge ${cls}" data-id="${esc(e.id)}"><path class="fe-hit" d="${p.d}"/><path class="fe-line" d="${p.d}" marker-end="url(#feArrow${on ? 'Sel' : ''})"/>${label ? `<text x="${p.mx}" y="${p.my}" class="fe-elabel">${esc(label)}</text>` : ''}</g>`;
        })
        .join('');
      svg.innerHTML = `<defs>
          <marker id="feArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="fe-arrow"/></marker>
          <marker id="feArrowSel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="fe-arrow sel"/></marker>
        </defs>${paths}<path id="feTemp" class="fe-temp" d=""/>`;
      inner.querySelectorAll('.fe-node').forEach((x) => x.remove());
      inner.insertAdjacentHTML('beforeend', flow.nodes.map(nodeHtml).join(''));
      if (!keepSide) drawSide(back);
      drawErrors();
    }
    function drawErrors() {
      const errs = FM.validateFlow(FM.cleanFlow(flow) || flow);
      box.querySelector('#feErrors').innerHTML = errs.length
        ? `<b>直すところ（${errs.length}）</b><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
        : '<span class="fe-ok">✓ このフローで Pipeline を動かせます</span>';
      box.querySelector('#feSave').disabled = errs.length > 0;
    }

    // ---------- 右の欄（選んだノード・線の中身） ----------
    function drawSide(back) {
      if (!sel) {
        side.innerHTML = `<div class="muted small">ノードや線を選ぶと、ここで中身を変えられます。</div>
          <div class="fe-legend small">
            <div><b>分岐（if）</b>: 直前の工程のエージェントに、返事の最後へ <code>[[RESULT:値]]</code> を書いてもらい、線ごとの期待値と比べて行き先を選びます。3つ以上に分けられます。</div>
            <div><b>並列 → 合流</b>: 枝ごとに別の worktree で同時に動かし、すべての枝が終わったらマージして先へ進みます。コンフリクトしたら止めて知らせます。</div>
            <div><b>ループ</b>: 前のノードへ戻る線を引くと、戻る上限の回数まで繰り返します。</div>
          </div>`;
        return;
      }
      if (sel.kind === 'node') {
        const n = node(sel.id);
        if (!n) return ((sel = null), drawSide(back));
        const del = n.type === 'start' ? '' : '<button class="btn small danger" id="feDel" type="button">このノードを消す</button>';
        let body = '';
        if (n.type === 'step') {
          const list = opts.agents.filter(([a]) => opts.enabled.includes(a) || (a === n.agent && !n.custom));
          const plain = list.map(([a, l]) => `<option value="${a}" ${a === n.agent && !n.custom ? 'selected' : ''}>${esc(l)}${opts.enabled.includes(a) ? '' : '（使わない設定）'}</option>`).join('');
          const lost = n.custom && !customOf(n.custom) ? `<option value="custom:${esc(n.custom)}" selected>（見つからないカスタムエージェント）</option>` : '';
          const custom = customs.length || lost
            ? `<optgroup label="カスタムエージェント">${customs.map((ca) => `<option value="custom:${esc(ca.id)}" ${ca.id === n.custom ? 'selected' : ''}>${esc(`${ca.icon ? `${ca.icon} ` : ''}${ca.name}（${agentName(ca.agent)}${ca.model ? ` / ${ca.model}` : ''}）`)}${opts.enabled.includes(ca.agent) ? '' : '（使わない設定）'}</option>`).join('')}${lost}</optgroup>`
            : '';
          const ca = n.custom ? customOf(n.custom) : null;
          const sugg = ((opts.modelSuggest || {})[n.agent] || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
          body = `<label class="field"><span>エージェント</span><select id="feAgent">${custom ? `<optgroup label="エージェント">${plain}</optgroup>${custom}` : plain}</select></label>
            ${n.custom
              ? `<small class="muted fe-ca-note">${ca ? `カスタムエージェント「${esc(ca.name)}」のモデル（${esc(ca.model || '設定の既定')}）とプロフィールで動かします。${ca.description ? esc(ca.description) : ''}` : 'このカスタムエージェントは見つかりません。選び直してください。'}</small>`
              : `<label class="field"><span>モデル（空なら設定の既定）</span><input id="feModel" list="feModelList" autocomplete="off" spellcheck="false" maxlength="100" placeholder="例: ${esc(((opts.modelSuggest || {})[n.agent] || [])[0] || '')}" value="${esc(n.model || '')}" /><datalist id="feModelList">${sugg}</datalist></label>`}
            <label class="field"><span>工程の名前</span><input id="feLabel" maxlength="30" placeholder="${ca ? esc(ca.name) : '例: 実装'}" value="${esc(n.label || '')}" /></label>
            <label class="field"><span>担当の説明</span><textarea id="feInst" rows="6" placeholder="例: 前の工程の変更をレビューして直す">${esc(n.instruction || '')}</textarea></label>`;
          const j = FM.judgeOf(flow, n.id);
          if (j) body += `<small class="muted">この工程のあとは分岐「${esc(j.node.label || '')}」です。エージェントに、返事の最後へ判定の値（${j.options.map((o) => `<code>${esc(o.value)}</code>`).join(' / ') || 'まだありません'}）を書いてもらいます。</small>`;
        } else if (n.type === 'if') {
          body = `<label class="field"><span>分岐の名前</span><input id="feLabel" maxlength="30" placeholder="例: レビューの結果" value="${esc(n.label || '')}" /></label>
            <label class="field"><span>判定すること（エージェントに伝えます）</span><textarea id="feQuestion" rows="3" placeholder="例: テストがすべて通り、直すところがないか">${esc(n.question || '')}</textarea></label>
            <small class="muted">行き先ごとに線を引き、線を選んで「期待値」と「条件の説明」を決めます。どの期待値にも合わないときの行き先は、線の「どれにも合わないとき」で決めます（なければ止まって知らせます）。</small>`;
          const outs = FM.outEdges(flow, n.id);
          if (outs.length) {
            body += `<div class="fe-branches">${outs
              .map((e) => `<button class="fe-branch" data-edge="${esc(e.id)}" type="button"><code>${esc(e.value || (e.else ? 'それ以外' : '（期待値なし）'))}</code> → ${esc(FM.labelOf(node(e.to)))}${e.when ? `<span class="muted"> ${esc(e.when)}</span>` : ''}</button>`)
              .join('')}</div>`;
          }
        } else if (n.type === 'parallel' || n.type === 'join') {
          body = `<label class="field"><span>名前</span><input id="feLabel" maxlength="30" value="${esc(n.label || '')}" /></label>
            <small class="muted">${n.type === 'parallel' ? '線を2本以上出し、それぞれ工程につなぎます。枝の最後は同じ合流につないでください。枝ごとに別の worktree（このタスクのブランチから分けたもの）で同時に動かします。' : '並列の枝の最後をここにつなぎます。すべての枝が終わったら、枝の変更を順にマージして先へ進みます。コンフリクトしたら止めて知らせます。'}</small>`;
        } else if (n.type === 'start') body = '<small class="muted">Pipelineはここから始まります。線を1本、最初の工程へつないでください。</small>';
        else body = '<small class="muted">ここに来たら Pipeline を終えて、レビュー列に入れて知らせます。</small>';
        side.innerHTML = `<h4>${esc(FM.TYPE_LABEL[n.type])}</h4>${body}<div class="fe-side-actions">${del}</div>`;
        const bind = (id, key, redraw) => {
          const el = side.querySelector(id);
          if (!el) return;
          el.oninput = el.onchange = () => {
            n[key] = el.value;
            touch();
            if (redraw) redrawKeepSide();
          };
        };
        // エージェント: ふつうのエージェントか、カスタムエージェント（custom:<ID>。元の CLI を agent にも入れておく）
        const agentSel = side.querySelector('#feAgent');
        if (agentSel)
          agentSel.onchange = () => {
            const v = agentSel.value;
            if (v.startsWith('custom:')) {
              const prev = n.custom ? customOf(n.custom) : null;
              n.custom = v.slice(7);
              const ca = customOf(n.custom);
              if (ca) {
                n.agent = ca.agent;
                // 工程の名前が空（または前のカスタムエージェントの名前のまま）なら、カスタムエージェントの名前にする
                const label = String(n.label || '').trim();
                if (!label || (prev && label === prev.name)) n.label = ca.name;
              }
              delete n.model;
            } else {
              delete n.custom;
              n.agent = v;
            }
            touch();
            draw();
          };
        const modelIn = side.querySelector('#feModel');
        if (modelIn)
          modelIn.oninput = () => {
            const m = modelIn.value.trim();
            if (m) n.model = m;
            else delete n.model;
            touch();
            redrawKeepSide();
          };
        bind('#feLabel', 'label', true);
        bind('#feInst', 'instruction');
        bind('#feQuestion', 'question', true);
        side.querySelectorAll('.fe-branch').forEach((b) => (b.onclick = () => select({ kind: 'edge', id: b.dataset.edge })));
      } else {
        const e = flow.edges.find((x) => x.id === sel.id);
        if (!e) return ((sel = null), drawSide(back));
        const from = node(e.from);
        const isBack = back.has(e.id);
        let body = `<div class="small">${esc(FM.labelOf(from))} → ${esc(FM.labelOf(node(e.to)))}</div>`;
        if (from.type === 'if') {
          body += `<label class="field"><span>期待値（エージェントが書く <code>[[RESULT:値]]</code> の値）</span><input id="feValue" maxlength="40" placeholder="例: ok / ng / retry" value="${esc(e.value || '')}" /></label>
            <label class="field"><span>条件の説明（どんなときにこの値を書くか）</span><input id="feWhen" maxlength="300" placeholder="例: 直すところがない" value="${esc(e.when || '')}" /></label>
            <label class="check"><input type="checkbox" id="feElse" ${e.else ? 'checked' : ''} /> どれにも合わないとき（値を書かなかったときも）、この線へ進む</label>`;
        }
        if (isBack) {
          body += `<label class="field"><span>戻る上限（この線を通れる回数。1〜${FM.MAX_LOOPS_LIMIT}回）</span><input id="feLoops" type="number" min="1" max="${FM.MAX_LOOPS_LIMIT}" value="${esc(e.maxLoops || FM.MAX_LOOPS_DEFAULT)}" /></label>
            <small class="muted">前のノードへ戻る線（ループ）です。上限に達したら Pipeline を終えて、レビュー列に入れて知らせます（並列の枝の中なら、そこまでの変更で合流します）。</small>`;
        }
        side.innerHTML = `<h4>線</h4>${body}<div class="fe-side-actions"><button class="btn small danger" id="feDel" type="button">この線を消す</button></div>`;
        const v = side.querySelector('#feValue');
        if (v) v.oninput = () => ((e.value = v.value.replace(/[\][\n]/g, '').trim()), (e.value || delete e.value), touch(), redrawKeepSide());
        const w = side.querySelector('#feWhen');
        if (w) w.oninput = () => ((e.when = w.value), touch());
        const el = side.querySelector('#feElse');
        if (el)
          el.onchange = () => {
            // 「どれにも合わないとき」は分岐ごとに1本だけ
            if (el.checked) for (const o of FM.outEdges(flow, e.from)) delete o.else;
            if (el.checked) e.else = true;
            else delete e.else;
            touch();
            redrawKeepSide();
          };
        const lp = side.querySelector('#feLoops');
        if (lp) lp.oninput = () => ((e.maxLoops = Math.min(FM.MAX_LOOPS_LIMIT, Math.max(1, Math.round(Number(lp.value) || FM.MAX_LOOPS_DEFAULT)))), touch(), redrawKeepSide());
      }
      const d = side.querySelector('#feDel');
      if (d) d.onclick = removeSelected;
    }
    // 入力中の欄を描き直さないよう、キャンバスと「直すところ」だけ描き直す
    function redrawKeepSide() {
      draw({ keepSide: true });
    }
    function select(s) {
      sel = s;
      draw();
    }
    function removeSelected() {
      if (!sel) return;
      if (sel.kind === 'node') {
        const n = node(sel.id);
        if (!n || n.type === 'start') return;
        flow.nodes = flow.nodes.filter((x) => x.id !== n.id);
        flow.edges = flow.edges.filter((e) => e.from !== n.id && e.to !== n.id);
      } else flow.edges = flow.edges.filter((e) => e.id !== sel.id);
      sel = null;
      touch();
      draw();
    }

    // ---------- 足す ----------
    box.querySelectorAll('.fe-add').forEach((b) => {
      b.onclick = () => {
        const type = b.dataset.type;
        const used = new Set(flow.nodes.map((n) => n.id));
        // 今見えているところの左上あたりに置く（重ならないよう少しずらす）
        const k = flow.nodes.length % 6;
        const n = { id: uid(type === 'step' ? 's' : type.slice(0, 2), used), type, x: canvas.scrollLeft + 40 + k * 24, y: canvas.scrollTop + 40 + k * 24 };
        if (type === 'step') Object.assign(n, { agent: opts.enabled.includes(opts.defaultAgent) ? opts.defaultAgent : opts.enabled[0] || 'claude', label: '', instruction: '' });
        if (type === 'if') Object.assign(n, { label: '分岐', question: '' });
        if (type === 'parallel') n.label = '並列';
        if (type === 'join') n.label = '合流';
        flow.nodes.push(n);
        touch();
        select({ kind: 'node', id: n.id });
      };
    });

    // ---------- ドラッグ（ノードを動かす・線をつなぐ） ----------
    let drag = null;
    const pt = (ev) => {
      const r = inner.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    inner.onmousedown = (ev) => {
      if (ev.button !== 0) return;
      const nodeEl = ev.target.closest('.fe-node');
      const edgeEl = ev.target.closest('.fe-edge');
      if (ev.target.closest('.fe-port') && nodeEl) {
        ev.preventDefault();
        drag = { kind: 'link', from: nodeEl.dataset.id };
        return;
      }
      if (nodeEl) {
        ev.preventDefault();
        const n = node(nodeEl.dataset.id);
        const p = pt(ev);
        drag = { kind: 'move', id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
        if (!sel || sel.kind !== 'node' || sel.id !== n.id) select({ kind: 'node', id: n.id });
        return;
      }
      if (edgeEl) return select({ kind: 'edge', id: edgeEl.dataset.id });
      if (sel) select(null);
    };
    const onMove = (ev) => {
      if (!drag) return;
      const p = pt(ev);
      if (drag.kind === 'move') {
        const n = node(drag.id);
        n.x = Math.max(0, Math.round((p.x - drag.dx) / 4) * 4);
        n.y = Math.max(0, Math.round((p.y - drag.dy) / 4) * 4);
        drag.moved = true;
        const el = inner.querySelector(`.fe-node[data-id="${CSS.escape(n.id)}"]`);
        if (el) {
          el.style.left = `${n.x}px`;
          el.style.top = `${n.y}px`;
        }
        // 線だけ描き直す
        const back = FM.backEdges(flow);
        svg.querySelectorAll('.fe-edge').forEach((g) => {
          const e = flow.edges.find((x) => x.id === g.dataset.id);
          const pp = e && edgePath(e);
          if (!pp) return;
          g.querySelectorAll('path').forEach((x) => x.setAttribute('d', pp.d));
          const t = g.querySelector('text');
          if (t) {
            t.setAttribute('x', pp.mx);
            t.setAttribute('y', pp.my);
            t.textContent = edgeLabel(e, back);
          }
        });
      } else if (drag.kind === 'link') {
        const a = node(drag.from);
        const [aw, ah] = size(a);
        const sx = a.x + aw / 2;
        const sy = a.y + ah;
        svg.querySelector('#feTemp').setAttribute('d', `M${sx},${sy} C${sx},${(sy + p.y) / 2} ${p.x},${(sy + p.y) / 2} ${p.x},${p.y}`);
        inner.querySelectorAll('.fe-node.drop').forEach((x) => x.classList.remove('drop'));
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const t = over && over.closest && over.closest('.fe-node');
        if (t && t.dataset.id !== drag.from) t.classList.add('drop');
      }
    };
    const onUp = (ev) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === 'move') {
        if (d.moved) {
          touch();
          draw();
        }
        return;
      }
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const t = over && over.closest && over.closest('.fe-node');
      const tmp = svg.querySelector('#feTemp');
      if (tmp) tmp.setAttribute('d', '');
      inner.querySelectorAll('.fe-node.drop').forEach((x) => x.classList.remove('drop'));
      if (!t) return;
      const from = node(d.from);
      const to = node(t.dataset.id);
      if (!to || to.type === 'start') return;
      if (to.id === from.id && from.type !== 'step') return;
      // 分岐・並列のほかは、出す線は1本（つなぎ直したら前の線と入れ替える）
      if (from.type !== 'if' && from.type !== 'parallel') flow.edges = flow.edges.filter((e) => e.from !== from.id);
      else if (flow.edges.some((e) => e.from === from.id && e.to === to.id && from.type === 'parallel')) return;
      const used = new Set(flow.edges.map((e) => e.id));
      const e = { id: uid('e', used), from: from.id, to: to.id };
      flow.edges.push(e);
      touch();
      // 戻る線・分岐の線は、続けて中身（期待値・上限）を決められるように選んでおく
      const back = FM.backEdges(flow);
      if (back.has(e.id)) e.maxLoops = FM.MAX_LOOPS_DEFAULT;
      select(from.type === 'if' || back.has(e.id) ? { kind: 'edge', id: e.id } : sel);
      if (from.type === 'if') setTimeout(() => side.querySelector('#feValue') && side.querySelector('#feValue').focus(), 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // ---------- キー・閉じる・保存 ----------
    const onKey = (ev) => {
      if (host.classList.contains('hidden')) return;
      const typing = ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && !typing && sel) {
        ev.preventDefault();
        removeSelected();
      } else if (ev.key === 'Escape') {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        cancel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    function close() {
      host.classList.add('hidden');
      box.innerHTML = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey, true);
    }
    function cancel() {
      if (dirty && !confirm('フローチャートの変更を保存せずに閉じますか？')) return;
      close();
    }
    box.querySelector('#feCancel').onclick = cancel;
    box.querySelector('#feSave').onclick = async () => {
      // 名前を入れていないカスタムエージェントの工程は、カスタムエージェントの名前にする
      fillCustomLabels(flow, customs);
      const clean = FM.cleanFlow(flow);
      const errs = FM.validateFlow(clean);
      if (errs.length) return;
      // 使えない文字のモデル名は cleanFlow が落とすので、落ちたものがあれば知らせる
      const typed = flow.nodes.find((n) => n.type === 'step' && n.model && !clean.nodes.some((x) => x.id === n.id && x.model === n.model));
      if (typed) return alert(`工程「${typed.label || ''}」のモデル名に使えない文字が入っています: ${typed.model}`);
      const off = clean.nodes.find((n) => n.type === 'step' && stepOff(n));
      if (off && !confirm(`工程「${off.label}」の ${stepName(off)} は使えません（${off.custom && !customOf(off.custom) ? 'カスタムエージェントが見つかりません' : '使わない設定です'}）。このままだとPipelineを始められません。保存しますか？`)) return;
      const ok = await opts.onSave(clean);
      if (ok !== false) close();
    };
    draw();
  }

  root.FlowEditor = { open, fillCustomLabels };
})(typeof self !== 'undefined' ? self : this);
