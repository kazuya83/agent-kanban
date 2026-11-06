// 約35秒のデモ GIF: 文章でフローチャートを組み、Codex で実装して Claude でレビューし、差し戻し、要所は人が決める
const { createRecorder } = require('./recorder');
const pipelineStory = require('./pipeline-story');

module.exports = async function demo(ctx, outFile) {
  const { page, fx, show, settle, mock } = ctx;
  const { cards: c } = fx;
  const story = pipelineStory(ctx);
  const rec = await createRecorder(page);
  const { snap, moveTo, finish } = rec;
  await mock({
    'card:diff': { __byId: true, stock: fx.stockDiff },
    'card:worktree': { __byId: true, stock: fx.worktree },
  });

  // 1. 文章でフローチャートを組み、その Pipeline でタスクを作る
  await story.draw(rec);
  await story.createTask(rec);

  // 2. Codex が実装し、Claude がレビューする。工程の進み具合を開いて見る
  const { task, patch } = story.run();
  const board = (more) => show({ cards: story.cardsWith({ stock: { ...task, ...more } }), settings: story.after });
  const stage = async (more, sec) => {
    await board(more);
    await page.evaluate(() => renderDetailBody());
    await settle();
    await snap(sec);
  };
  await board(patch.implement);
  await settle();
  await snap(0.8);
  await moveTo('.card:has(.relay-bar)', { n: 4 });
  await page.evaluate(() => select('stock'));
  await page.evaluate(async () => {
    setTab('progress');
    renderDetailHead();
    await renderDetailBody();
  });
  await settle(400);
  await snap(1.6);

  // 3. レビューの工程で、コマンドの実行を人が承認する
  const permission = { ...c.dark.permissions[0], summary: 'npm test -- tests/orders.test.js', detail: 'npm test -- tests/orders.test.js', input: { command: 'npm test -- tests/orders.test.js' } };
  await stage({ ...patch.review, permissions: [permission], lastMessage: 'Bash npm test -- tests/orders.test.js' }, 1.4);
  await moveTo('.card .perm-actions button');
  await snap(0.6);
  await stage(patch.review, 1.0);

  // 4. レビューの指摘で実装へ差し戻し、次のレビューで終わる
  await stage(patch.sentBack, 2.4);
  await stage(patch.reviewAgain, 1.6);
  await stage(patch.finished, 2.6);

  // 5. 差分を見て、マージするかは人が決める
  await moveTo('[data-tab=diff]', { n: 4 });
  await page.evaluate(async () => {
    setTab('diff');
    renderDetailHead();
    await renderDetailBody();
  });
  await settle(400);
  await snap(2.6);
  await moveTo('[data-act=merge]');
  await page.evaluate(() => openMerge(card('stock')));
  await page.waitForSelector('#mTarget');
  await settle();
  await snap(1.0);
  await moveTo('#mOk', { n: 4 });
  await snap(0.5);
  await page.evaluate(() => {
    closeModal();
    closeDetail();
  });
  await board({ ...patch.finished, status: 'done', worktreePath: '', mergedInto: 'main' });
  await settle();
  await snap(3.0);

  await finish(outFile);
};
