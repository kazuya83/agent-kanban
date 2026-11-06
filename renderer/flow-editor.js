// Pipelineのフローチャートを編集する画面（設定のモーダルの上に、もう1つのモーダルとして出す）
// - ノードはドラッグで並べ、下の丸（出口）から別のノードへドラッグすると線をつなぐ
// - ノードも線もないところをドラッグすると、キャンバスをスクロールする
// - ノード・線を押すと、右の欄で中身（エージェント・担当の説明・期待値・ループの上限など）を変えられる
// - 形は FlowModel（flow-model.js）で確かめ、直すところがあるうちは保存できない
(function (root) {
  const i18n = typeof module === 'object' && module.exports ? require('./i18n.js') : root.I18n;
  function tr(key, vars) {
    if (i18n) return i18n.tr(key, vars);
    return vars ? String(key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : key;
  }
  const FM = root.FlowModel;
  const Z = root.Zoom;
  // 拡大・縮小の倍率（開き直しても、前の倍率で開く）
  let lastZoom = 1;
  const W = { start: 120, step: 200, if: 170, parallel: 160, join: 160, end: 120 };
  const H = { start: 40, step: 64, if: 56, parallel: 48, join: 48, end: 40 };
  const AI_REQUEST_MAX = 2000;
  const ADD = ['step', 'if', 'parallel', 'join', 'end'];
  function addButton(type) {
    let label = type;
    let tip = '';
    if (type === 'step') {
      label = tr('工程');
      tip = tr('1つのエージェントが作業する工程');
    } else if (type === 'if') {
      label = tr('分岐（if）');
      tip = tr('直前の工程のエージェントが書いた判定の値で、行き先を分けます');
    } else if (type === 'parallel') {
      label = tr('並列');
      tip = tr('枝ごとに別の worktree で、工程を同時に動かします');
    } else if (type === 'join') {
      label = tr('合流');
      tip = tr('並列の枝がすべて終わるのを待ち、変更をマージします');
    } else if (type === 'end') {
      label = tr('終了');
      tip = tr('Pipelineを終えてレビュー列へ');
    }
    return `<button class="btn small fe-add" data-type="${type}" type="button" title="${esc(tip)}">＋ ${esc(label)}</button>`;
  }

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
   * @param {{ flow: object, agents: [string, string][], enabled: string[], customAgents?: object[], modelSuggest?: Record<string, string[]>, defaultAgent: string, generate?: (request: string, flow: object, agent: string) => Promise<object>, onSave: (flow: object) => Promise<boolean>|boolean }} opts
   *   agents: [[id, 表示名]]（すべてのエージェント）、enabled: 使うエージェント、customAgents: カスタムエージェント（{ id, name, icon, agent, model }）
   *   generate: 文章の指示からフローを作る（返ったフローは画面に反映するだけで、保存はしない）
   */
  function open(opts) {
    const host = document.getElementById('flowModal');
    const box = document.getElementById('flowModalBox');
    // 編集は写しに対して行う（保存するまで設定は変えない）
    const flow = JSON.parse(JSON.stringify(opts.flow || { nodes: [], edges: [] }));
    if (!flow.nodes.some((n) => n.type === 'start')) flow.nodes.unshift({ id: 'start', type: 'start', x: 60, y: 30 });
    let sel = null; // { kind: 'node'|'edge', id }
    let dirty = false;
    let closed = false;
    const agentName = (a) => (opts.agents.find((x) => x[0] === a) || [a, a])[1];
    // 新しい工程と、文章からフローを作るときに使うエージェント
    const baseAgent = opts.enabled.includes(opts.defaultAgent) ? opts.defaultAgent : opts.enabled[0] || 'claude';
    const customs = Array.isArray(opts.customAgents) ? opts.customAgents : [];
    const customOf = (id) => customs.find((x) => x.id === id) || null;
    // 工程を動かすエージェント（カスタムエージェントなら、その元の CLI）
    const stepAgent = (n) => (n.custom && customOf(n.custom) ? customOf(n.custom).agent : n.agent);
    const stepOff = (n) => (n.custom && !customOf(n.custom)) || !opts.enabled.includes(stepAgent(n));
    const stepName = (n) => {
      if (n.custom) {
        const ca = customOf(n.custom);
        if (!ca) return tr('カスタムエージェントが見つかりません');
        return tr('{icon}{name}（{agent}{model}）{off}', {
          icon: ca.icon ? `${ca.icon} ` : '',
          name: ca.name,
          agent: agentName(ca.agent),
          model: ca.model ? ` / ${ca.model}` : '',
          off: opts.enabled.includes(ca.agent) ? '' : tr('（使わない設定）'),
        });
      }
      return agentName(n.agent) + (n.model ? ` / ${n.model}` : '') + (opts.enabled.includes(n.agent) ? '' : tr('（使わない設定）'));
    };

    box.innerHTML = `
      <div class="fe-head">
        <h2>${tr('Pipelineのフローチャート')}</h2>
        <div class="fe-tools">${ADD.map(addButton).join('')}</div>
      </div>
      <p class="muted small fe-help">${tr('ノードはドラッグで動かせます。何もないところをドラッグすると、スクロールできます。右上のボタンか、⌘（Ctrl）を押しながらのスクロール・ピンチで拡大・縮小できます。ノードの下の丸（出口）から別のノードへドラッグすると、線をつなげます。前のノードへ戻る線を引くとループになり、戻る上限を決められます。ノードや線を選んで Delete キーで消せます。')}</p>
      ${opts.generate
        ? `<div class="fe-ai">
        <textarea id="feAiText" rows="2" maxlength="${AI_REQUEST_MAX}" placeholder="${esc(tr('作りたいフローや直したいところを文章で書けます（{agent} が組み立てます）。例: Codex で実装して Claude でレビューし、直すところがあれば実装に戻す（3回まで）', { agent: agentName(baseAgent) }))}"></textarea>
        <div class="fe-ai-acts"><button class="btn small primary" id="feAiRun" type="button" title="${esc(tr('⌘（Ctrl）＋Enter でも送れます'))}">${tr('AIで反映')}</button><button class="btn small ghost" id="feAiUndo" type="button" hidden>${tr('元に戻す')}</button></div>
      </div>
      <div class="fe-ai-msg small" id="feAiMsg" hidden></div>`
        : ''}
      <div class="fe-main">
        <div class="fe-canvas-wrap"><div class="fe-canvas" id="feCanvas"><div class="fe-sizer" id="feSizer"><div class="fe-inner" id="feInner"><svg class="fe-svg" id="feSvg"></svg></div></div></div><div class="zoom-host" id="feZoom"></div></div>
        <div class="fe-side" id="feSide"></div>
      </div>
      <div class="fe-errors" id="feErrors"></div>
      <div class="modal-actions"><button class="btn ghost" id="feCancel" type="button">${tr('キャンセル')}</button><button class="btn primary" id="feSave" type="button">${tr('保存')}</button></div>`;
    host.classList.remove('hidden');
    const inner = box.querySelector('#feInner');
    const svg = box.querySelector('#feSvg');
    const canvas = box.querySelector('#feCanvas');
    const side = box.querySelector('#feSide');
    const sizer = box.querySelector('#feSizer');
    const zoomHost = box.querySelector('#feZoom');
    let zoom = Z.clamp(lastZoom);
    let area = [900, 560]; // 中身の大きさ（倍率をかける前）

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
        title = tr('{n}. {label}', { n: i + 1, label: n.label || tr('（名前なし）') });
        sub = stepName(n);
      } else if (n.type === 'if') sub = n.question ? n.question : tr('判定の値で分ける');
      else if (n.type === 'parallel') sub = tr('同時に動かす');
      else if (n.type === 'join') sub = tr('すべて待ってマージ');
      const port = n.type === 'end' ? '' : `<span class="fe-port" title="${esc(tr('ドラッグして、つなぐ先のノードで離す'))}"></span>`;
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
        mx = Math.max(sx, tx) + off;
        my = (sy + ty) / 2;
      }
      return { d, mx, my };
    }
    function edgeLabel(e, back) {
      const parts = [];
      const from = node(e.from);
      if (from && from.type === 'if') {
        if (e.value) parts.push(e.value);
        if (e.else) parts.push(e.value ? tr('＋それ以外') : tr('それ以外'));
        if (!e.value && !e.else) parts.push(tr('期待値なし'));
      }
      if (back.has(e.id)) parts.push(tr('↺ {n}回まで', { n: e.maxLoops || FM.MAX_LOOPS_DEFAULT }));
      return parts.join(' ');
    }
    // keepSide: 右の欄は描き直さない（入力中の欄のフォーカスを保つ）
    function draw({ keepSide = false } = {}) {
      const back = FM.backEdges(flow);
      // キャンバスの大きさは、いちばん遠いノードに合わせて広げる
      const maxX = Math.max(900, ...flow.nodes.map((n) => n.x + size(n)[0] + 260));
      const maxY = Math.max(560, ...flow.nodes.map((n) => n.y + size(n)[1] + 160));
      area = [maxX, maxY];
      applyZoom();
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
    // ---------- 拡大・縮小 ----------
    // 中身は倍率をかける前の大きさで描き、transform で縮める。スクロールの範囲は fe-sizer の大きさで決める
    function applyZoom() {
      // 縮めたときも、見えている枠いっぱいを中身にする（空いたところを押して選ぶのをやめられるように）
      const w = Math.max(area[0], Math.floor(canvas.clientWidth / zoom));
      const h = Math.max(area[1], Math.floor(canvas.clientHeight / zoom));
      inner.style.width = `${w}px`;
      inner.style.height = `${h}px`;
      inner.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
      sizer.style.width = `${Math.round(w * zoom)}px`;
      sizer.style.height = `${Math.round(h * zoom)}px`;
      zoomHost.innerHTML = Z.toolbarHtml(zoom);
    }
    // at: 枠の中で動かさない位置（省くと枠のまん中）
    function setZoom(z, at) {
      const z1 = Z.clamp(z);
      if (z1 === zoom) return;
      const p = at || { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
      const s = Z.anchor(canvas.scrollLeft, canvas.scrollTop, p.x, p.y, zoom, z1);
      zoom = lastZoom = z1;
      applyZoom();
      canvas.scrollLeft = s.left;
      canvas.scrollTop = s.top;
    }
    // すべてのノードが見える大きさにする
    function fitZoom() {
      const w = Math.max(...flow.nodes.map((n) => n.x + size(n)[0])) + 80;
      const h = Math.max(...flow.nodes.map((n) => n.y + size(n)[1])) + 40;
      zoom = lastZoom = Z.fit(w, h, canvas.clientWidth, canvas.clientHeight);
      applyZoom();
      canvas.scrollLeft = 0;
      canvas.scrollTop = 0;
    }
    zoomHost.onclick = (ev) => {
      const b = ev.target.closest('[data-zoom]');
      if (!b) return;
      const k = b.dataset.zoom;
      if (k === 'fit') fitZoom();
      else setZoom(k === 'reset' ? 1 : Z.step(zoom, k === 'in' ? 1 : -1));
    };
    Z.bindWheel(canvas, { get: () => zoom, set: setZoom });
    function drawErrors() {
      const errs = FM.validateFlow(FM.cleanFlow(flow) || flow);
      box.querySelector('#feErrors').innerHTML = errs.length
        ? `<b>${tr('直すところ（{n}）', { n: errs.length })}</b><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
        : `<span class="fe-ok">${tr('✓ このフローで Pipeline を動かせます')}</span>`;
      box.querySelector('#feSave').disabled = errs.length > 0;
    }

    // ---------- 右の欄（選んだノード・線の中身） ----------
    function drawSide(back) {
      if (!sel) {
        side.innerHTML = `<div class="muted small">${tr('ノードや線を選ぶと、ここで中身を変えられます。')}</div>
          <div class="fe-legend small">
            <div>${tr('<b>分岐（if）</b>: 直前の工程のエージェントに、返事の最後へ <code>[[RESULT:値]]</code> を書いてもらい、線ごとの期待値と比べて行き先を選びます。3つ以上に分けられます。')}</div>
            <div>${tr('<b>並列 → 合流</b>: 枝ごとに別の worktree で同時に動かし、すべての枝が終わったらマージして先へ進みます。コンフリクトしたら止めて知らせます。')}</div>
            <div>${tr('<b>ループ</b>: 前のノードへ戻る線を引くと、戻る上限の回数まで繰り返します。')}</div>
          </div>`;
        return;
      }
      if (sel.kind === 'node') {
        const n = node(sel.id);
        if (!n) return ((sel = null), drawSide(back));
        const del = n.type === 'start' ? '' : `<button class="btn small danger" id="feDel" type="button">${tr('このノードを消す')}</button>`;
        let body = '';
        if (n.type === 'step') {
          const list = opts.agents.filter(([a]) => opts.enabled.includes(a) || (a === n.agent && !n.custom));
          const offTag = esc(tr('（使わない設定）'));
          const plain = list.map(([a, l]) => `<option value="${a}" ${a === n.agent && !n.custom ? 'selected' : ''}>${esc(l)}${opts.enabled.includes(a) ? '' : offTag}</option>`).join('');
          const lost = n.custom && !customOf(n.custom) ? `<option value="custom:${esc(n.custom)}" selected>${tr('（見つからないカスタムエージェント）')}</option>` : '';
          const custom = customs.length || lost
            ? `<optgroup label="${esc(tr('カスタムエージェント'))}">${customs.map((ca) => `<option value="custom:${esc(ca.id)}" ${ca.id === n.custom ? 'selected' : ''}>${esc(`${ca.icon ? `${ca.icon} ` : ''}${ca.name}（${agentName(ca.agent)}${ca.model ? ` / ${ca.model}` : ''}）`)}${opts.enabled.includes(ca.agent) ? '' : offTag}</option>`).join('')}${lost}</optgroup>`
            : '';
          const ca = n.custom ? customOf(n.custom) : null;
          const sugg = ((opts.modelSuggest || {})[n.agent] || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
          body = `<label class="field"><span>${tr('エージェント')}</span><select id="feAgent">${custom ? `<optgroup label="${esc(tr('エージェント'))}">${plain}</optgroup>${custom}` : plain}</select></label>
            ${n.custom
              ? `<small class="muted fe-ca-note">${ca ? tr('カスタムエージェント「{name}」のモデル（{model}）とプロフィールで動かします。{desc}', { name: esc(ca.name), model: esc(ca.model || tr('設定の既定')), desc: ca.description ? esc(ca.description) : '' }) : tr('このカスタムエージェントは見つかりません。選び直してください。')}</small>`
              : `<label class="field"><span>${tr('モデル（空なら設定の既定）')}</span><input id="feModel" list="feModelList" autocomplete="off" spellcheck="false" maxlength="100" placeholder="${esc(tr('例: {model}', { model: ((opts.modelSuggest || {})[n.agent] || [])[0] || '' }))}" value="${esc(n.model || '')}" /><datalist id="feModelList">${sugg}</datalist></label>`}
            <label class="field"><span>${tr('工程の名前')}</span><input id="feLabel" maxlength="30" placeholder="${ca ? esc(ca.name) : esc(tr('例: 実装'))}" value="${esc(n.label || '')}" /></label>
            <label class="field"><span>${tr('担当の説明')}</span><textarea id="feInst" rows="6" placeholder="${esc(tr('例: 前の工程の変更をレビューして直す'))}">${esc(n.instruction || '')}</textarea></label>`;
          const j = FM.judgeOf(flow, n.id);
          if (j) body += `<small class="muted">${tr('この工程のあとは分岐「{label}」です。エージェントに、返事の最後へ判定の値（{values}）を書いてもらいます。', { label: esc(j.node.label || ''), values: j.options.map((o) => `<code>${esc(o.value)}</code>`).join(' / ') || tr('まだありません') })}</small>`;
        } else if (n.type === 'if') {
          body = `<label class="field"><span>${tr('分岐の名前')}</span><input id="feLabel" maxlength="30" placeholder="${esc(tr('例: レビューの結果'))}" value="${esc(n.label || '')}" /></label>
            <label class="field"><span>${tr('判定すること（エージェントに伝えます）')}</span><textarea id="feQuestion" rows="3" placeholder="${esc(tr('例: テストがすべて通り、直すところがないか'))}">${esc(n.question || '')}</textarea></label>
            <small class="muted">${tr('行き先ごとに線を引き、線を選んで「期待値」と「条件の説明」を決めます。どの期待値にも合わないときの行き先は、線の「どれにも合わないとき」で決めます（なければ止まって知らせます）。')}</small>`;
          const outs = FM.outEdges(flow, n.id);
          if (outs.length) {
            body += `<div class="fe-branches">${outs
              .map((e) => `<button class="fe-branch" data-edge="${esc(e.id)}" type="button"><code>${esc(e.value || (e.else ? tr('それ以外') : tr('（期待値なし）')))}</code> → ${esc(FM.labelOf(node(e.to)))}${e.when ? `<span class="muted"> ${esc(e.when)}</span>` : ''}</button>`)
              .join('')}</div>`;
          }
        } else if (n.type === 'parallel' || n.type === 'join') {
          body = `<label class="field"><span>${tr('名前')}</span><input id="feLabel" maxlength="30" value="${esc(n.label || '')}" /></label>
            <small class="muted">${n.type === 'parallel' ? tr('線を2本以上出し、それぞれ工程につなぎます。枝の最後は同じ合流につないでください。枝ごとに別の worktree（このタスクのブランチから分けたもの）で同時に動かします。') : tr('並列の枝の最後をここにつなぎます。すべての枝が終わったら、枝の変更を順にマージして先へ進みます。コンフリクトしたら止めて知らせます。')}</small>`;
        } else if (n.type === 'start') body = `<small class="muted">${tr('Pipelineはここから始まります。線を1本、最初の工程へつないでください。')}</small>`;
        else body = `<small class="muted">${tr('ここに来たら Pipeline を終えて、レビュー列に入れて知らせます。')}</small>`;
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
          body += `<label class="field"><span>${tr('期待値（エージェントが書く <code>[[RESULT:値]]</code> の値）')}</span><input id="feValue" maxlength="40" placeholder="${esc(tr('例: ok / ng / retry'))}" value="${esc(e.value || '')}" /></label>
            <label class="field"><span>${tr('条件の説明（どんなときにこの値を書くか）')}</span><input id="feWhen" maxlength="300" placeholder="${esc(tr('例: 直すところがない'))}" value="${esc(e.when || '')}" /></label>
            <label class="check"><input type="checkbox" id="feElse" ${e.else ? 'checked' : ''} /> ${tr('どれにも合わないとき（値を書かなかったときも）、この線へ進む')}</label>`;
        }
        if (isBack) {
          body += `<label class="field"><span>${tr('戻る上限（この線を通れる回数。1〜{max}回）', { max: FM.MAX_LOOPS_LIMIT })}</span><input id="feLoops" type="number" min="1" max="${FM.MAX_LOOPS_LIMIT}" value="${esc(e.maxLoops || FM.MAX_LOOPS_DEFAULT)}" /></label>
            <small class="muted">${tr('前のノードへ戻る線（ループ）です。上限に達したら Pipeline を終えて、レビュー列に入れて知らせます（並列の枝の中なら、そこまでの変更で合流します）。')}</small>`;
        }
        side.innerHTML = `<h4>${tr('線')}</h4>${body}<div class="fe-side-actions"><button class="btn small danger" id="feDel" type="button">${tr('この線を消す')}</button></div>`;
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
        if (type === 'step') Object.assign(n, { agent: baseAgent, label: '', instruction: '' });
        if (type === 'if') Object.assign(n, { label: tr('分岐'), question: '' });
        if (type === 'parallel') n.label = tr('並列');
        if (type === 'join') n.label = tr('合流');
        flow.nodes.push(n);
        touch();
        select({ kind: 'node', id: n.id });
      };
    });

    // ---------- 文章で作る・直す ----------
    // 返ったフローは画面に反映するだけ（「保存」を押すまで設定は変えない）。反映の直前の形には「元に戻す」で戻せる
    if (opts.generate) {
      const aiText = box.querySelector('#feAiText');
      const aiRun = box.querySelector('#feAiRun');
      const aiUndo = box.querySelector('#feAiUndo');
      const aiMsg = box.querySelector('#feAiMsg');
      const say = (text, kind) => {
        aiMsg.hidden = !text;
        aiMsg.textContent = text || '';
        aiMsg.classList.toggle('err', kind === 'err');
      };
      const setFlow = (next) => {
        flow.nodes = next.nodes;
        flow.edges = next.edges;
        sel = null;
        draw();
        fitZoom();
      };
      let before = null;
      const runAi = async () => {
        const request = aiText.value.trim();
        if (aiRun.disabled) return;
        if (!request) return say(tr('作りたいフローや直したいところを書いてください'), 'err');
        aiRun.disabled = true;
        aiUndo.hidden = true;
        say(tr('{agent} がフローを組み立てています…', { agent: agentName(baseAgent) }));
        try {
          const next = await opts.generate(request, FM.cleanFlow(flow) || flow, baseAgent);
          if (closed) return;
          before = JSON.parse(JSON.stringify({ nodes: flow.nodes, edges: flow.edges, dirty }));
          touch();
          setFlow(next);
          aiText.value = '';
          aiUndo.hidden = false;
          say(tr('反映しました。中身を確かめて「保存」を押してください（まだ保存していません）'));
        } catch (err) {
          if (!closed) say((err && err.message) || String(err), 'err');
        } finally {
          aiRun.disabled = false;
        }
      };
      aiRun.onclick = runAi;
      aiText.onkeydown = (ev) => {
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && !ev.isComposing) {
          ev.preventDefault();
          runAi();
        }
      };
      aiUndo.onclick = () => {
        if (!before) return;
        dirty = before.dirty;
        setFlow(before);
        before = null;
        aiUndo.hidden = true;
        say('');
      };
    }

    // ---------- ドラッグ（ノードを動かす・線をつなぐ・スクロールする） ----------
    let drag = null;
    const PAN_SLOP = 4; // これより小さい動きは、スクロールではなくクリックとして扱う
    const pt = (ev) => {
      const r = inner.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / zoom, y: (ev.clientY - r.top) / zoom };
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
      // 何もないところ: ドラッグならスクロール、動かさずに離したら選択を外す（onUp）
      drag = { kind: 'pan', x: ev.clientX, y: ev.clientY, left: canvas.scrollLeft, top: canvas.scrollTop, moved: false };
    };
    const onMove = (ev) => {
      if (!drag) return;
      if (drag.kind === 'pan') {
        const dx = ev.clientX - drag.x;
        const dy = ev.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) < PAN_SLOP && Math.abs(dy) < PAN_SLOP) return;
        drag.moved = true;
        inner.classList.add('panning');
        canvas.scrollLeft = drag.left - dx;
        canvas.scrollTop = drag.top - dy;
        return;
      }
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
      if (d.kind === 'pan') {
        inner.classList.remove('panning');
        if (!d.moved && sel) select(null);
        return;
      }
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
    // 窓の大きさが変わったら、枠いっぱいの中身の大きさを合わせ直す
    const onResize = () => applyZoom();
    window.addEventListener('resize', onResize);

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
      closed = true;
      host.classList.add('hidden');
      box.innerHTML = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey, true);
    }
    function cancel() {
      if (dirty && !confirm(tr('フローチャートの変更を保存せずに閉じますか？'))) return;
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
      if (typed) return alert(tr('工程「{label}」のモデル名に使えない文字が入っています: {model}', { label: typed.label || '', model: typed.model }));
      const off = clean.nodes.find((n) => n.type === 'step' && stepOff(n));
      if (off && !confirm(tr('工程「{label}」の {who} は使えません（{why}）。このままだとPipelineを始められません。保存しますか？', { label: off.label, who: stepName(off), why: off.custom && !customOf(off.custom) ? tr('カスタムエージェントが見つかりません') : tr('使わない設定です') }))) return;
      const ok = await opts.onSave(clean);
      if (ok !== false) close();
    };
    draw();
  }

  root.FlowEditor = { open, fillCustomLabels };
})(typeof self !== 'undefined' ? self : this);
