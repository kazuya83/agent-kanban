// 約30秒のデモ GIF
const { createRecorder } = require('./recorder');

module.exports = async function demo(ctx, outFile) {
  const { page, fx, show, settle } = ctx;
  const { cards: c, paths } = fx;
  const t = fx.t;
  const { snap, moveTo, typeInto, finish } = await createRecorder(page);
  const board = (cards, more = {}) => show({ cards: Object.values(cards), notifications: fx.notifications.slice(0, 5), ...more });

  const running = { ...c.csv };
  let cards = { logs: c.logs, paging: c.paging, csv: { ...running, btw: [] }, enter: { ...c.enter, status: 'running', startedAt: Date.now() - 30000, lastMessage: 'Edit src/components/LoginForm.jsx', costUsd: 0 }, speed: c.speed };

  // 1. タスクを作る
  await board(cards);
  await settle();
  await snap(1.5);
  await moveTo('#newBtn');
  await page.evaluate(() => newTask());
  await page.waitForSelector('#nPrompt');
  await settle();
  await snap(0.3);
  await moveTo('#nTitle', { n: 3 });
  await typeInto('#nTitle', t.tStock, 0.9);
  await moveTo('#nPrompt', { n: 3 });
  await typeInto('#nPrompt', t.pStock, 1.3);
  await snap(0.3);
  await moveTo('#nOk', { n: 4 });
  await snap(0.3);

  // 2. カードが並列に動く
  await page.evaluate(() => closeModal());
  const stock = { ...c.csv, id: 'stock', title: t.tStock, issue: undefined, branch: 'agent/task-a41f07c2', worktreePath: `${paths.SHOP}.worktrees/a41f07c2`, lastMessage: 'Read src/api/orders.js', startedAt: Date.now() - 2000, createdAt: Date.now() };
  cards = { ...cards, stock };
  await board(cards);
  await settle();
  await snap(1.4);
  cards = { ...cards, limit: c.limit };
  delete cards.logs;
  cards.limit = { ...c.limit, startedAt: Date.now() - 20000 };
  await board(cards);
  await settle();
  await snap(1.4);
  cards = { ...cards, dark: c.dark };
  await board(cards);
  await settle();
  await snap(1.8);

  // 3. 承認する・質問に答える
  await moveTo('.card .perm-actions button');
  await snap(0.5);
  cards = { ...cards, dark: { ...c.dark, permissions: [], lastMessage: 'Bash npm test -- tests/theme.test.js' } };
  await board(cards);
  await settle();
  await snap(1.0);
  await moveTo('[data-qpick]:nth-child(2)');
  await snap(0.5);
  cards = { ...cards, limit: { ...cards.limit, questions: [], lastMessage: 'Edit src/api/orders.js' } };
  await board(cards);
  await settle();
  await snap(1.2);

  // 4. 差分を見てマージする
  cards = { ...cards, enter: c.enter };
  await board(cards);
  await settle();
  await snap(1.2);
  await moveTo('.card:has(.issue-chip):has(.card-cost)');
  await page.evaluate(() => select('enter'));
  await settle(400);
  await snap(0.3);
  await moveTo('[data-tab=diff]', { n: 4 });
  await page.evaluate(async () => {
    setTab('diff');
    renderDetailHead();
    await renderDetailBody();
  });
  await settle(400);
  await snap(2.6);
  await moveTo('[data-act=merge]');
  await page.evaluate(() => openMerge(card('enter')));
  await page.waitForSelector('#mTarget');
  await settle();
  await snap(1.0);
  await moveTo('#mOk', { n: 4 });
  await snap(0.5);
  await page.evaluate(() => {
    closeModal();
    closeDetail();
  });
  cards = { ...cards, enter: { ...c.enter, status: 'done', worktreePath: '', mergedInto: 'main' } };
  await board(cards);
  await settle();
  await snap(1.6);

  // 5. 別の PC から遠隔操作する（ボードはそのままで、上の段が遠隔操作中になる）
  await show({
    cards: Object.values(cards),
    notifications: fx.notifications.slice(0, 5),
    remoteSession: fx.remoteClient,
    repoTabs: fx.tabs(paths.SHOP, { attention: 0, running: 0 }).map((x) => ({ ...x, remote: true, active: x.path === paths.SHOP })),
  });
  await settle();
  await moveTo('#remoteInfo', { n: 6 });
  await page.evaluate(() => {
    const el = $('remoteInfo');
    el.style.boxShadow = '0 0 0 3px rgba(59,130,246,.45)';
  });
  await snap(4.0);

  await finish(outFile);
};
