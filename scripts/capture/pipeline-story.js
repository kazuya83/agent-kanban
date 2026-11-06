// Pipeline の物語（文章でフローチャートを組み、タスクを流す）。機能の GIF とデモ GIF で使う
module.exports = function pipelineStory(ctx) {
  const { page, fx, show, settle, mock } = ctx;
  const { cards: c, paths, t, pipeline } = fx;
  const def = { id: 'default', name: pipeline.name, flow: fx.pipelineStart };
  const made = { id: pipeline.id, name: pipeline.name, flow: pipeline.flow };
  const common = { enabledAgents: ['claude', 'codex'], orchestration: 'relay' };
  const before = { ...common, relayFlows: [def], relayFlowId: def.id, relayFlow: def.flow };
  const after = { ...common, relayFlows: [made], relayFlowId: made.id, relayFlow: made.flow };
  const others = { logs: c.logs, paging: c.paging, csv: c.csv, speed: c.speed };
  const cardsWith = (more = {}) => Object.values({ ...others, ...more }).filter(Boolean);

  // 文章で書いて、フローチャートに反映し、保存する
  const draw = async ({ snap, moveTo, typeInto }) => {
    await mock({ 'flow:generate': pipeline.flow, 'settings:update': after, __delay: { 'flow:generate': 700 } });
    await show({ cards: cardsWith(), settings: before });
    await page.evaluate(() => openSettings('orchestration'));
    await page.waitForSelector('[data-pl-edit]');
    await settle(400);
    await snap(0.4);
    await moveTo('[data-pl-edit]', { n: 4 });
    await page.click('[data-pl-edit]');
    await page.waitForSelector('#feAiText');
    await settle();
    await snap(0.5);
    await moveTo('#feAiText', { n: 4 });
    await typeInto('#feAiText', t.plRequest, 1.8);
    await snap(0.3);
    await moveTo('#feAiRun', { n: 4 });
    await page.click('#feAiRun');
    await snap(1.2);
    await page.waitForFunction(() => document.querySelectorAll('.fe-node').length >= 5);
    await settle(300);
    await snap(2.4);
    await moveTo('#feSave', { n: 4 });
    await page.click('#feSave');
    await page.waitForFunction(() => !document.querySelector('#feSave'));
    await settle();
    await mock({ __delay: {} });
  };

  // 作った Pipeline を選んで、タスクを作る
  const createTask = async ({ snap, moveTo, typeInto }) => {
    await show({ cards: cardsWith(), settings: after });
    await page.evaluate(() => setView('kanban'));
    await settle();
    await snap(0.2);
    await moveTo('#newBtn', { n: 4 });
    await page.evaluate(() => newTask());
    await page.waitForSelector('#nPrompt');
    await settle();
    await snap(0.3);
    await typeInto('#nTitle', t.tStock, 0.5);
    await typeInto('#nPrompt', t.pStock, 0.6);
    await page.selectOption('#nAgent', `relay:${made.id}`);
    await settle();
    await moveTo('#nAgent', { n: 3 });
    await snap(0.9);
    await moveTo('#nOk', { n: 3 });
    await snap(0.3);
    await page.evaluate(() => closeModal());
  };

  // 工程ごとのカードの中身。レビューの指摘で実装へ戻り、次のレビューで終わる
  const run = () => {
    const at = Date.now();
    const hist = (index, round, agent, report, more = {}) => ({ index, run: round, agent, report, startedAt: at - 300000 + round * 90000, at: at - 220000 + round * 90000, costUsd: 0.03 * (index + 1), ...more });
    const relay = { flow: made.flow, steps: pipeline.steps, counts: {}, pipeline: { id: made.id, name: made.name }, stepStartedAt: at - 8000 };
    const task = { ...c.csv, id: 'stock', title: t.tStock, issue: undefined, btw: [], branch: 'agent/task-a41f07c2', worktreePath: `${paths.SHOP}.worktrees/a41f07c2`, createdAt: at, startedAt: at - 8000, logs: [] };
    const h1 = hist(0, 1, 'codex', t.plRep1);
    const h2 = hist(1, 1, 'claude', t.plRep2, { result: 'fail' });
    const h3 = hist(0, 2, 'codex', t.plRep3);
    const h4 = hist(1, 2, 'claude', t.plRep4, { result: 'pass' });
    const patch = {
      implement: { agent: 'codex', lastMessage: 'Edit src/api/orders.js', relay: { ...relay, index: 0, history: [] } },
      review: { agent: 'claude', lastMessage: 'Read src/api/orders.js', relay: { ...relay, index: 1, history: [h1] } },
      sentBack: { agent: 'codex', lastMessage: 'Edit src/api/orders.js', relay: { ...relay, index: 0, history: [h1, h2], lastResult: 'fail', counts: { e5: 1 } } },
      reviewAgain: { agent: 'claude', lastMessage: 'Bash npm test', relay: { ...relay, index: 1, history: [h1, h2, h3], counts: { e5: 1 } } },
      finished: { agent: 'claude', status: 'review', lastMessage: t.plRep4, costUsd: 0.18, relay: { ...relay, index: 1, done: true, history: [h1, h2, h3, h4], lastResult: 'pass', counts: { e5: 1 } } },
    };
    return { task, patch };
  };

  return { draw, createTask, run, after, cardsWith };
};
