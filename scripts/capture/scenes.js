// 1枚ずつの画面の作り方。ファイル名（docs/images/<言語>/<name>.png）ごとに1つ
module.exports = function scenesFor(ctx) {
  const { page, fx, show, settle } = ctx;
  const { cards: c, adminCards, paths } = fx;
  const list = (over = {}) => Object.values({ ...c, ...over });
  const board = (over) => show({ cards: list(over) });
  const open = (id) => page.evaluate((x) => select(x), id);
  const tab = (name) => page.evaluate(async (n) => {
    setTab(n);
    renderDetailHead();
    await renderDetailBody();
  }, name);
  const conflictCard = { ...c.enter, lastMessage: '', conflict: { target: 'main', files: ['src/components/LoginForm.jsx'] } };
  const rcBoard = (over) => show({
    cards: list(over),
    remoteSession: fx.remoteClient,
    repoTabs: fx.tabs(paths.SHOP, { attention: 0, running: 0 }).map((x) => ({ ...x, remote: true, active: x.path === paths.SHOP })),
  });
  const fillNewTask = async () => {
    await page.evaluate(() => newTask());
    await page.waitForSelector('#nPrompt');
    await settle();
    await page.fill('#nTitle', fx.t.tStock);
    await page.fill('#nPrompt', fx.t.pStock);
  };

  return {
    board: () => board(),
    'repo-tabs': () => show({
      cards: adminCards,
      settings: { repoPath: paths.ADMIN },
      repoTabs: fx.tabs(paths.ADMIN),
      notifications: fx.notifications.slice(0, 2),
    }),
    'repo-switch': async () => {
      await board({ enter: conflictCard });
      await page.evaluate(() => chooseRepo({ tab: 'replace' }));
      await page.waitForSelector('.repo-choices');
    },
    'detail-permission': async () => {
      await board();
      await open('dark');
      await tab('log');
      await page.evaluate(() => { $('detailBody').scrollTop = 1e6; });
    },
    'issue-dialog': async () => {
      await board();
      await page.evaluate(() => newTask());
      await page.waitForSelector('#nPrompt');
      await page.evaluate(() => document.querySelector('[data-task-mode=issue]').click());
      await page.waitForSelector('#nNumbers');
      await page.fill('#nNumbers', '21, 22, 24');
      await page.waitForFunction(() => $('ghPanel') && $('ghPanel').textContent.length > 0);
    },
    question: async () => {
      await board();
      await open('limit');
      await settle();
      await page.evaluate(() => {
        const r = document.querySelectorAll('.qform .q-opt input[type=radio]')[1];
        if (r) r.click();
        $('detailBody').scrollTop = 1e6;
      });
    },
    awaiting: async () => {
      await board();
      await open('readme');
    },
    worktree: async () => {
      await board();
      await open('enter');
      await tab('worktree');
    },
    diff: async () => {
      await board();
      await open('enter');
      await tab('diff');
    },
    'merge-dialog': async () => {
      await board();
      await open('enter');
      await tab('diff');
      await page.evaluate(() => openMerge(card('enter')));
      await page.waitForSelector('#mTarget');
    },
    chat: async () => {
      await board();
      await open('pay');
      await settle();
      await page.evaluate(() => { $('detailBody').scrollTop = 0; });
    },
    notifications: async () => {
      await board();
      await page.evaluate(() => $('notifBtn').click());
      await page.waitForSelector('.notif-item');
    },
    conflict: async () => {
      await board({ enter: conflictCard });
      await open('enter');
      await settle();
    },
    'new-task': async () => {
      await show({ cards: list(), settings: { defaultSkill: 'test-writer' } });
      await fillNewTask();
      await page.selectOption('#nSession', 's-stock');
    },
    'skill-picker': async () => {
      await board();
      await fillNewTask();
      await page.evaluate(() => openSkillPicker(null, () => {}));
      await page.waitForSelector('.skill-card');
      await settle();
    },
    btw: async () => {
      await board();
      await open('csv');
      await tab('btw');
      await page.evaluate(() => $('btwInput') && $('btwInput').focus());
    },
    'rc-settings': async () => {
      await show({ cards: [], repoTabs: [], notifications: [], settings: { repoPath: '' } });
      await page.evaluate(() => openRemoteSettings());
      await page.waitForSelector('#rcBox [data-rc-role]');
      await page.evaluate(() => document.querySelector('[data-rc-role=client]').click());
      await page.waitForSelector('#rPubKey');
      await page.evaluate(() => { $('modalBox').scrollTop = 0; });
    },
    'rc-client': () => rcBoard({ enter: conflictCard }),
  };
};
