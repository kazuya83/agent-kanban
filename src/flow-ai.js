// 文章の指示から、Pipeline のフローチャートを作る・直す。
// エージェントに1回聞いて JSON のフローを返してもらい、FlowModel で整えて確かめる。
// 形が正しくなければ、直すところを伝えて1回だけ作り直してもらう（それでも残るところは、編集画面の「直すところ」に出る）
const FlowModel = require('../renderer/flow-model');

const REQUEST_MAX = 2000;

// 位置は渡さない（並べるのはアプリの役目）
function flowForPrompt(flow) {
  return {
    nodes: flow.nodes.map(({ x, y, ...rest }) => rest),
    edges: flow.edges,
  };
}

/**
 * @param {{ request: string, flow: object, enabled: string[], customAgents: object[], defaultAgent: string }} input
 * @returns {string}
 */
function buildFlowPrompt({ request, flow, enabled, customAgents, defaultAgent }) {
  const customs = customAgents.length
    ? customAgents.map((c) => `- ID: ${c.id} / 名前: ${c.name} / CLI: ${c.agent}${c.description ? ` / 説明: ${c.description}` : ''}`).join('\n')
    : '（なし）';
  return `Agent Kanban の Pipeline のフローチャートを、次の指示どおりに作る、または直してください。
ファイルの変更・コマンドの実行はしないでください。リポジトリを調べる必要もありません。
質問はせず、足りないところは妥当に決めて、返事はフロー全体の JSON だけにしてください（説明の文やコードブロックの印は不要です）。

# 指示
${request}

# 今のフロー
${JSON.stringify(flowForPrompt(flow))}

指示が今のフローを直す内容なら、指示に関係ないノード・線は ID も中身も変えずに残してください。
新しく作る内容なら、作り直してかまいません。

# JSON の形
{"nodes": [...], "edges": [...]}

ノードの共通の項目: id（英数字・_・- で32文字まで。重ねない）, type。位置は書かないでください。
- start: 開始。1つだけ。線を1本出し、行き先は工程にする
- step: 工程。agent, label（30文字まで）, instruction（担当の説明。作業の内容を具体的に）。線は1本
  - model は、今のフローにあるものを残すほかは書かない
  - カスタムエージェントを使うときは custom にその ID を、agent にその CLI を書く
- if: 分岐。label, question（判定すること）。直前は必ず工程で、その工程のエージェントが判定の値を書く。その仕組みはアプリが伝えるので、instruction には書かなくてよい
- parallel: 並列。label。線を2本以上出し、それぞれ工程につなぐ。枝は別々に進め、すべて同じ合流につなぐ。枝の中に別の並列・終了は置けない
- join: 合流。label。1つの並列の枝だけを受ける。線は1本
- end: 終了。いくつ置いてもよい。工程・分岐・合流の行き先の最後は終了にする

線の項目: id, from, to
- 分岐から出る線: value（期待値。例 pass / fail）, when（どんなときにこの値を書くか）。どの期待値にも合わないときの行き先の線には else: true を付ける（分岐ごとに1本まで）。value は同じ分岐の中で重ねない
- 前のノードへ戻る線（ループ）: maxLoops（1〜${FlowModel.MAX_LOOPS_LIMIT}。初期値 ${FlowModel.MAX_LOOPS_DEFAULT}）。分岐の線で戻すのがふつう

上限: ノードは ${FlowModel.MAX_NODES} 個まで、工程は ${FlowModel.MAX_STEPS} 個まで。

# 工程で使えるエージェント
${enabled.join(', ')}（指定がなければ ${defaultAgent}。指示に使えないエージェントが出てきたら、使えるものに置き換える）

# カスタムエージェント
${customs}

文章は指示と同じ言葉で書いてください。`;
}

function buildRepairPrompt(reply, errors) {
  return `\n\n# 前回の返事の直すところ
前回の返事は、次の理由で使えませんでした。直したフロー全体の JSON だけを返してください。
${errors.map((e) => `- ${e}`).join('\n')}

前回の返事:
${String(reply).slice(0, 8000)}`;
}

/**
 * 返事の文章から、フローの JSON を取り出す（コードブロックや前後の文があってもよい）
 * @param {string} text
 * @returns {object|null}
 */
function parseFlowReply(text) {
  const s = String(text || '');
  const fenced = [...s.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  const whole = first >= 0 && last > first ? [s.slice(first, last + 1)] : [];
  for (const body of [...fenced, ...whole]) {
    try {
      const v = JSON.parse(body);
      if (v && typeof v === 'object' && Array.isArray(v.nodes)) return v;
    } catch {
      /* 次の候補を見る */
    }
  }
  return null;
}

function shapeKey(flow) {
  const nodes = flow.nodes.map((n) => n.id).sort();
  const edges = flow.edges.map((e) => `${e.from}>${e.to}`).sort();
  return JSON.stringify([nodes, edges]);
}

/**
 * 返ってきたフローを、編集画面に出せる形に整える
 * - 使えないエージェント・カスタムエージェントは、使えるものにする（今のフローにあったものは、そのまま残す）
 * - ノードと線が今のままなら配置も今のまま、変わっていれば並べ直す
 * @returns {{ nodes: object[], edges: object[] } | null}
 */
function finishFlow(raw, { flow, enabled, customAgents, defaultAgent }) {
  const clean = FlowModel.cleanFlow(raw);
  if (!clean) return null;
  const prev = new Map(flow.nodes.map((n) => [n.id, n]));
  const agentsInFlow = new Set(flow.nodes.map((n) => n.agent));
  const customsInFlow = new Set(flow.nodes.map((n) => n.custom));
  const fallback = enabled.includes(defaultAgent) ? defaultAgent : enabled[0] || defaultAgent;
  for (const n of clean.nodes) {
    if (n.type !== 'step') continue;
    const ca = customAgents.find((c) => c.id === n.custom);
    if (ca) n.agent = ca.agent;
    else if (n.custom && !customsInFlow.has(n.custom)) delete n.custom;
    if (!n.custom && !enabled.includes(n.agent) && !agentsInFlow.has(n.agent)) n.agent = fallback;
  }
  if (shapeKey(clean) !== shapeKey(flow)) return FlowModel.autoLayout(clean);
  for (const n of clean.nodes) {
    const p = prev.get(n.id);
    if (p) Object.assign(n, { x: p.x, y: p.y });
  }
  return clean;
}

/**
 * @param {(prompt: string) => Promise<string>} ask  エージェントに1回聞く
 * @param {{ request: string, flow?: object, enabled?: string[], customAgents?: object[], defaultAgent: string }} input
 * @returns {Promise<{ nodes: object[], edges: object[] }>} 保存はしない
 */
async function generateFlow(ask, input) {
  const request = String(input.request || '').trim().slice(0, REQUEST_MAX);
  if (!request) throw new Error('作りたいフローや直したいところを書いてください');
  const ctx = {
    flow: FlowModel.cleanFlow(input.flow) || { nodes: [], edges: [] },
    enabled: Array.isArray(input.enabled) ? input.enabled : [],
    customAgents: Array.isArray(input.customAgents) ? input.customAgents : [],
    defaultAgent: input.defaultAgent,
  };
  const prompt = buildFlowPrompt({ ...ctx, request });
  let reply = await ask(prompt);
  let next = finishFlow(parseFlowReply(reply), ctx);
  const errors = next ? FlowModel.validateFlow(next) : ['JSON のフローになっていません'];
  if (errors.length) {
    reply = await ask(prompt + buildRepairPrompt(reply, errors));
    next = finishFlow(parseFlowReply(reply), ctx) || next;
  }
  if (!next) throw new Error(`フローの形で返ってきませんでした: ${String(reply).trim().slice(0, 200)}`);
  return next;
}

module.exports = { buildFlowPrompt, parseFlowReply, finishFlow, generateFlow };
