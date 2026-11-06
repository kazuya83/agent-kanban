// 機能ごとの短い GIF（README の節に載せる）。ファイル名は docs/images/<言語>/feature-<name>.gif
const path = require('path');
const { createRecorder } = require('./recorder');

// 文字が読めるように、デモより画面を狭くして撮る
const FEATURE_SIZE = { width: 1360, height: 840 };
const GIF_WIDTH = 960;

function features(ctx) {
  const { page, fx, show, settle, mock } = ctx;
  const { cards: c, adminCards, paths, t, pipeline } = fx;
  const now = () => Date.now();
  const list = (over = {}) => Object.values({ ...c, ...over }).filter(Boolean);
  const onlyCards = (cards) => Object.values(cards).filter(Boolean);
  const open = (id) => page.evaluate((x) => select(x), id);
  const tab = (name) => page.evaluate(async (n) => {
    setTab(n);
    renderDetailHead();
    await renderDetailBody();
  }, name);
  const redetail = () => page.evaluate(() => renderDetailBody());
  const record = async (outFile, body) => {
    const rec = await createRecorder(page, { x: 1000, y: 620 }, () => ctx.check(path.basename(outFile)));
    await body(rec);
    await rec.finish(outFile, { width: GIF_WIDTH });
  };

  return {
    // 文章で Pipeline を組み、それを選んでタスクを動かす
    pipeline: (outFile) => record(outFile, async ({ snap, moveTo, typeInto }) => {
      const def = { id: 'default', name: pipeline.name, flow: fx.pipelineStart };
      const made = { id: pipeline.id, name: pipeline.name, flow: pipeline.flow };
      const settings = { enabledAgents: ['claude', 'codex'], orchestration: 'relay' };
      const before = { ...settings, relayFlows: [def], relayFlowId: def.id, relayFlow: def.flow };
      const after = { ...settings, relayFlows: [made], relayFlowId: made.id, relayFlow: made.flow };
      await mock({ 'flow:generate': pipeline.flow, 'settings:update': after, __delay: { 'flow:generate': 700 } });
      const base = { logs: c.logs, paging: c.paging, csv: c.csv, speed: c.speed };
      await show({ cards: onlyCards(base), settings: before });

      // 1. 文章で書いて、フローチャートに反映する
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

      // 2. その Pipeline を選んで、タスクを作る
      await show({ cards: onlyCards(base), settings: after });
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

      // 3. 工程が進む（レビューの指摘で実装へ戻り、次のレビューで終わる）
      const at = now();
      const hist = (index, run, agent, report, more = {}) => ({ index, run, agent, report, startedAt: at - 300000 + run * 90000, at: at - 220000 + run * 90000, costUsd: 0.03 * (index + 1), ...more });
      const relay = { flow: made.flow, steps: pipeline.steps, counts: {}, pipeline: { id: made.id, name: made.name }, stepStartedAt: at - 8000 };
      const task = { ...c.csv, id: 'stock', title: t.tStock, issue: undefined, btw: [], branch: 'agent/task-a41f07c2', worktreePath: `${paths.SHOP}.worktrees/a41f07c2`, createdAt: at, startedAt: at - 8000, logs: [] };
      const stage = async (patch, sec) => {
        await show({ cards: onlyCards({ ...base, stock: { ...task, ...patch } }), settings: after });
        await redetail();
        await settle();
        await snap(sec);
      };
      const h1 = hist(0, 1, 'codex', t.plRep1);
      const h2 = hist(1, 1, 'claude', t.plRep2, { result: 'fail' });
      const h3 = hist(0, 2, 'codex', t.plRep3);
      const h4 = hist(1, 2, 'claude', t.plRep4, { result: 'pass' });
      await show({ cards: onlyCards({ ...base, stock: { ...task, agent: 'codex', lastMessage: 'Edit src/api/orders.js', relay: { ...relay, index: 0, history: [] } } }), settings: after });
      await settle();
      await snap(0.5);
      await moveTo('.card:has(.relay-bar)', { n: 4 });
      await open('stock');
      await tab('progress');
      await settle(400);
      await snap(1.4);
      await stage({ agent: 'claude', lastMessage: 'Read src/api/orders.js', relay: { ...relay, index: 1, history: [h1] } }, 1.4);
      await stage({ agent: 'codex', lastMessage: 'Edit src/api/orders.js', relay: { ...relay, index: 0, history: [h1, h2], lastResult: 'fail', counts: { e5: 1 } } }, 1.4);
      await stage({ agent: 'claude', lastMessage: 'Bash npm test', relay: { ...relay, index: 1, history: [h1, h2, h3], counts: { e5: 1 } } }, 1.4);
      await stage({ agent: 'claude', status: 'review', lastMessage: t.plRep4, costUsd: 0.18, relay: { ...relay, index: 1, done: true, history: [h1, h2, h3, h4], lastResult: 'pass', counts: { e5: 1 } } }, 3.0);
      await mock({ __delay: {} });
    }),

    // 大きなタスクをサブタスクに分けて、並列に進める
    subtasks: (outFile) => record(outFile, async ({ snap, moveTo }) => {
      const items = [
        { key: 'api', title: t.subApi, prompt: t.subApi, after: [] },
        { key: 'ui', title: t.subUi, prompt: t.subUi, after: [] },
        { key: 'test', title: t.subTest, prompt: t.subTest, after: ['api', 'ui'] },
      ];
      const parent = { ...c.readme, id: 'coupon', title: t.subParent, awaitingReply: false, sessionId: 's-coupon', branch: 'agent/task-c0a7e1d2', worktreePath: `${paths.SHOP}.worktrees/c0a7e1d2`, lastMessage: t.subNote };
      const kid = (key, id, title) => ({ ...c.csv, id, title, issue: undefined, btw: [], status: 'running', branch: `agent/task-${id}`, lastMessage: 'Edit src/api/coupons.js', subtaskOf: { parent: 'coupon', key } });
      const others = { logs: c.logs, paging: c.paging, speed: c.speed };
      const stage = async (states, more, kids, sec) => {
        const subtasks = { merge: 'auto', phase: 'run', items: items.map((x, i) => ({ ...x, cardId: `sub${i}`, state: states[i], costUsd: states[i] === 'merged' ? 0.04 : 0 })), ...more.subtasks };
        await show({ cards: onlyCards({ ...others, coupon: { ...parent, subtaskProposal: undefined, ...more.card, subtasks }, ...kids }) });
        await page.evaluate(async () => {
          renderDetailHead();
          await renderDetailBody();
        });
        await settle();
        await snap(sec);
      };
      await mock({ 'card:logs': { __byId: true, ...fx.logs, coupon: [{ kind: 'user', text: t.subParent, t: now() - 60000 }, { kind: 'text', text: t.subNote, t: now() - 30000 }] } });
      await show({ cards: onlyCards({ ...others, coupon: { ...parent, subtaskProposal: { items, at: now() } } }) });
      await settle();
      await snap(0.8);
      await moveTo('.card:has(.card-msg)', { n: 4 });
      await open('coupon');
      await settle(400);
      await moveTo('[data-sact=accept]');
      await snap(1.6);
      const k0 = kid('api', 'sub0', t.subApi);
      const k1 = { ...kid('ui', 'sub1', t.subUi), lastMessage: 'Edit src/components/Cart.jsx' };
      const k2 = { ...kid('test', 'sub2', t.subTest), lastMessage: 'Write tests/e2e/checkout.test.js' };
      await page.evaluate(() => setTab('subtasks'));
      await stage(['running', 'running', 'pending'], { card: { status: 'running' } }, { k0, k1 }, 2.0);
      await stage(['merged', 'running', 'pending'], { card: { status: 'running' } }, { k1 }, 1.8);
      await stage(['merged', 'merged', 'running'], { card: { status: 'running' } }, { k2 }, 1.8);
      await stage(['merged', 'merged', 'merged'], { card: { status: 'review', lastMessage: t.plRep4 }, subtasks: { phase: 'done' } }, {}, 3.0);
    }),

    // 複数のリポジトリをタブで切り替える（ほかのタブのタスクは止まらない）
    repos: (outFile) => record(outFile, async ({ snap, moveTo }) => {
      const shop = (tabs) => show({ cards: list(), repoTabs: tabs, notifications: fx.notifications.slice(0, 2) });
      const admin = (tabs) => show({ cards: adminCards, settings: { repoPath: paths.ADMIN }, repoTabs: tabs, notifications: fx.notifications.slice(0, 2) });
      await shop(fx.tabs(paths.SHOP));
      await settle();
      await snap(1.6);
      await moveTo('.repo-tab:nth-of-type(2)');
      await snap(0.4);
      await admin(fx.tabs(paths.ADMIN));
      await settle();
      await snap(2.2);
      const busier = fx.tabs(paths.ADMIN).map((x) => (x.path === paths.SHOP ? { ...x, attention: 4 } : x));
      await admin(busier);
      await settle();
      await moveTo('.repo-tab:nth-of-type(1)');
      await snap(1.6);
      await shop(fx.tabs(paths.SHOP));
      await settle();
      await snap(2.4);
    }),

    // 実行するコマンドを確かめて、承認する
    approval: (outFile) => record(outFile, async ({ snap, moveTo }) => {
      await show({ cards: list() });
      await settle();
      await snap(1.2);
      await moveTo('.card:has(.perm-actions)');
      await open('dark');
      await tab('log');
      await page.evaluate(() => { $('detailBody').scrollTop = 1e6; });
      await settle(400);
      await snap(2.4);
      await moveTo('.perm-actions button');
      await snap(0.6);
      await show({ cards: list({ dark: { ...c.dark, permissions: [], lastMessage: 'Bash npm test -- tests/theme.test.js' } }) });
      await settle();
      await snap(2.8);
    }),

    // エージェントの質問に、カードの上で答える
    question: (outFile) => record(outFile, async ({ snap, moveTo }) => {
      await show({ cards: list() });
      await settle();
      await snap(1.2);
      await moveTo('.card:has([data-qpick])');
      await open('limit');
      await settle(400);
      await page.evaluate(() => { $('detailBody').scrollTop = 1e6; });
      await snap(1.8);
      await moveTo('.qform .q-opt:nth-of-type(2)');
      await page.evaluate(() => document.querySelectorAll('.qform .q-opt input[type=radio]')[1]?.click());
      await settle();
      await snap(1.0);
      await moveTo('.qform [data-qact=submit]');
      await snap(0.5);
      await show({ cards: list({ limit: { ...c.limit, questions: [], lastMessage: 'Edit src/api/orders.js' } }) });
      await settle();
      await snap(2.6);
    }),

    // Issue の番号から、まとめてタスクを作る
    issue: (outFile) => record(outFile, async ({ snap, moveTo, typeInto }) => {
      const others = { paging: c.paging, speed: c.speed, enter: c.enter };
      await show({ cards: onlyCards(others) });
      await settle();
      await snap(1.0);
      await moveTo('#newBtn');
      await page.evaluate(() => newTask());
      await page.waitForSelector('#nPrompt');
      await settle();
      await moveTo('[data-task-mode=issue]', { n: 4 });
      await page.evaluate(() => document.querySelector('[data-task-mode=issue]').click());
      await page.waitForSelector('#nNumbers');
      await page.waitForFunction(() => $('ghPanel') && $('ghPanel').textContent.length > 0);
      await settle();
      await snap(0.6);
      await typeInto('#nNumbers', '21, 22, 24', 1.0);
      await snap(0.6);
      await moveTo('#nOk');
      await snap(0.4);
      await page.evaluate(() => closeModal());
      const fromIssue = (n, id, title, msg) => ({ ...c.csv, id, title: `#${n} ${title}`, issue: { number: n, url: `https://github.com/acme/shop-app/issues/${n}` }, btw: [], branch: `agent/issue-${n}-${id}`, worktreePath: `${paths.SHOP}.worktrees/${id}`, lastMessage: msg, startedAt: now() - 3000, createdAt: now() });
      await show({ cards: onlyCards({ ...others,
        a: fromIssue(21, 'e8a1c3f0', t.tDark, 'Read src/styles/theme.css'),
        b: fromIssue(22, '5b7d20ae', t.tLimit, 'Read src/api/orders.js'),
        d: fromIssue(24, 'c94e6f13', t.tLogs, 'Grep console.log'),
      }) });
      await settle();
      await snap(3.0);
    }),

    // 差分を確かめてマージする
    merge: (outFile) => record(outFile, async ({ snap, moveTo }) => {
      await show({ cards: list() });
      await settle();
      await snap(1.0);
      await moveTo('.card:has(.issue-chip):has(.card-cost)');
      await open('enter');
      await settle(400);
      await snap(0.4);
      await moveTo('[data-tab=diff]', { n: 4 });
      await tab('diff');
      await settle(400);
      await snap(2.8);
      await moveTo('[data-act=merge]');
      await page.evaluate(() => openMerge(card('enter')));
      await page.waitForSelector('#mTarget');
      await settle();
      await snap(1.2);
      await moveTo('#mOk', { n: 4 });
      await snap(0.5);
      await page.evaluate(() => {
        closeModal();
        closeDetail();
      });
      await show({ cards: list({ enter: { ...c.enter, status: 'done', worktreePath: '', mergedInto: 'main' } }) });
      await settle();
      await snap(2.6);
    }),

    // 別の PC からつないで、ホストのボードを操作する
    remote: (outFile) => record(outFile, async ({ snap, moveTo, typeInto }) => {
      await show({ cards: [], repoTabs: [], notifications: [], settings: { repoPath: '' } });
      await page.evaluate(() => openRemoteSettings());
      await page.waitForSelector('#rcBox [data-rc-role]');
      await page.evaluate(() => document.querySelector('[data-rc-role=client]').click());
      await page.waitForSelector('#rPairCode');
      await settle();
      await snap(1.0);
      await moveTo('#rPairCode');
      await typeInto('#rPairCode', '482913', 0.8);
      await moveTo('#rConnect', { n: 4 });
      await snap(0.5);
      await page.evaluate(() => closeModal());
      const remoteBoard = (over) => show({
        cards: list(over),
        remoteSession: fx.remoteClient,
        repoTabs: fx.tabs(paths.SHOP, { attention: 0, running: 0 }).map((x) => ({ ...x, remote: true, active: x.path === paths.SHOP })),
      });
      await remoteBoard({});
      await settle();
      await snap(1.2);
      await moveTo('#remoteInfo');
      await snap(1.6);
      await moveTo('.card .perm-actions button');
      await snap(0.5);
      await remoteBoard({ dark: { ...c.dark, permissions: [], lastMessage: 'Bash npm test -- tests/theme.test.js' } });
      await settle();
      await snap(2.4);
    }),

    // タスクを作らずに相談して、続きをタスクにする
    chat: (outFile) => record(outFile, async ({ snap, moveTo, typeInto }) => {
      const others = { logs: c.logs, paging: c.paging, csv: c.csv, speed: c.speed };
      await show({ cards: onlyCards(others) });
      await settle();
      await snap(0.8);
      await moveTo('#chatBtn');
      await page.evaluate(() => openChats());
      await page.waitForSelector('#cMsg');
      await settle();
      await snap(0.3);
      await typeInto('#cMsg', t.pPay, 0.8);
      await moveTo('#cOk', { n: 4 });
      await snap(0.4);
      await page.evaluate(() => closeModal());
      await show({ cards: onlyCards({ ...others, pay: c.pay }) });
      await open('pay');
      await settle(400);
      await page.evaluate(() => { $('detailBody').scrollTop = 0; });
      await snap(3.2);
      await moveTo('[data-act=toTask]');
      await snap(0.5);
      await page.evaluate(() => newTask({ fromChat: card('pay') }));
      await page.waitForSelector('#nPrompt');
      await settle();
      await page.fill('#nPrompt', t.payEnd.replace(/`/g, ''));
      await snap(2.6);
    }),

    // 通知から、対応が必要なカードへ移る
    notifications: (outFile) => record(outFile, async ({ snap, moveTo }) => {
      await show({ cards: list() });
      await settle();
      await snap(1.0);
      await moveTo('#notifBtn');
      await page.evaluate(() => $('notifBtn').click());
      await page.waitForSelector('.notif-item');
      await settle();
      await snap(2.2);
      await moveTo('.notif-item[data-card=limit]');
      await snap(0.5);
      await page.click('.notif-item[data-card=limit]');
      await settle(400);
      await snap(2.8);
    }),

    // コンフリクトをエージェントに解消してもらう
    conflict: (outFile) => record(outFile, async ({ snap, moveTo }) => {
      const stage = async (patch, sec) => {
        await show({ cards: list({ enter: { ...c.enter, lastMessage: '', ...patch } }) });
        await page.evaluate(async () => {
          renderDetailHead();
          await renderDetailBody();
        });
        await settle();
        await snap(sec);
      };
      const conflict = { target: 'main', files: ['src/components/LoginForm.jsx'] };
      await show({ cards: list({ enter: { ...c.enter, lastMessage: '', conflict } }) });
      await open('enter');
      await settle(400);
      await snap(1.8);
      await moveTo('[data-cact=agent]');
      await snap(0.6);
      await stage({ status: 'running', startedAt: now() - 2000, conflict: { ...conflict, resolving: true } }, 2.4);
      await stage({ conflictResolved: { target: 'main', push: false } }, 1.2);
      await moveTo('[data-cact=remerge]');
      await snap(2.2);
    }),

    // スキルと過去の会話を選んでタスクを作る
    skills: (outFile) => record(outFile, async ({ snap, moveTo, typeInto }) => {
      await show({ cards: list({ logs: null, enter: null }) });
      await settle();
      await snap(0.6);
      await moveTo('#newBtn', { n: 4 });
      await page.evaluate(() => newTask());
      await page.waitForSelector('#nPrompt');
      await settle();
      await page.fill('#nTitle', t.tStock);
      await typeInto('#nPrompt', t.pStock, 0.7);
      await moveTo('#nSkill button', { n: 4 });
      await page.click('#nSkill button');
      await page.waitForSelector('.skill-card');
      await settle();
      await snap(1.6);
      await moveTo('.skill-card[data-skill=test-writer]');
      await snap(0.4);
      await page.click('.skill-card[data-skill=test-writer]');
      await settle();
      await snap(0.5);
      await page.selectOption('#nSession', 's-stock');
      await moveTo('#nSession', { n: 4 });
      await snap(1.4);
      await moveTo('#nOk', { n: 3 });
      await snap(0.3);
      await page.evaluate(() => closeModal());
      await show({ cards: list({ logs: null, enter: null, stock: { ...c.csv, id: 'stock', title: t.tStock, issue: undefined, btw: [], skill: 'test-writer', branch: 'agent/task-a41f07c2', lastMessage: 'Read src/api/orders.js', startedAt: now() - 2000, createdAt: now() } }) });
      await settle();
      await snap(2.4);
    }),

    // 毎朝の依存関係チェックを登録して、今すぐ動かす
    scheduler: (outFile) => record(outFile, async ({ snap, moveTo, typeInto }) => {
      const others = { logs: c.logs, paging: c.paging, speed: c.speed };
      const at = now();
      const day = 86400000;
      const next = (hour) => {
        const d = new Date(at + day);
        d.setHours(hour, 0, 0, 0);
        return d.getTime();
      };
      const common = { repoPath: paths.SHOP, skill: null, agent: 'claude', model: '', enabled: true, catchUp: false, createdAt: at - 30 * day, updatedAt: at - day };
      const weekly = { ...common, id: 'weekly', title: t.scWeekly, prompt: t.scWeeklyDo, readOnly: true, rule: { kind: 'weekly', hour: 17, minute: 0, weekdays: [5] }, nextRunAt: next(17) + 3 * day, lastRunAt: at - 4 * day, lastStatus: 'ok', runs: [] };
      const check = { ...common, id: 'deps', title: t.scTitle, prompt: t.scPrompt, readOnly: true, createdAt: at, updatedAt: at, rule: { kind: 'daily', hour: 9, minute: 0 }, nextRunAt: next(9), lastRunAt: null, lastStatus: '', runs: [] };
      const stage = (schedules, cards) => show({ cards: onlyCards({ ...others, ...cards }), schedules });

      // 1. 画面を切り替えて、スケジュールを登録する
      await stage([weekly], {});
      await settle();
      await snap(0.4);
      await moveTo('#navBtn', { n: 4 });
      await page.click('#navBtn');
      await settle(150);
      await snap(0.4);
      await moveTo('#navMenu [data-view=scheduler]', { n: 3 });
      await page.click('#navMenu [data-view=scheduler]');
      await page.waitForSelector('[data-sched-act=new]');
      await settle();
      await snap(0.8);
      await moveTo('[data-sched-act=new]');
      await page.click('[data-sched-act=new]');
      await page.waitForSelector('#schedPrompt');
      await page.selectOption('#schedAgent', 'claude');
      await settle();
      await snap(0.3);
      await typeInto('#schedTitle', t.scTitle, 0.6);
      await typeInto('#schedPrompt', t.scPrompt, 1.2);
      await moveTo('#schedKind', { n: 4 });
      await snap(0.9);
      await moveTo('#schedReadOnly', { n: 3 });
      await page.check('#schedReadOnly');
      await snap(0.7);
      await moveTo('#schedOk', { n: 3 });
      await snap(0.3);
      await page.click('#schedOk');
      await page.waitForFunction(() => $('modal').classList.contains('hidden')); // 閉じても中身は残るので、ダイアログで見る

      // 2. 一覧に出る。詳細から今すぐ動かす（ふつうは毎朝 9:00 に動く）
      await stage([check, weekly], {});
      await settle();
      await snap(1.4);
      await moveTo('[data-sched-id=deps]', { n: 4 });
      await page.click('[data-sched-id=deps]');
      await page.waitForSelector('[data-sched-do=run]');
      await settle();
      await snap(1.8);
      await moveTo('[data-sched-do=run]', { n: 4 });
      await snap(0.4);
      await page.click('[data-sched-do=run]');
      await settle();

      // 3. カンバンにカードができて、結果を報告する
      const task = { ...c.csv, id: 'deps-run', title: t.scTitle, issue: undefined, btw: [], skill: undefined, readOnly: true, scheduleId: 'deps', scheduleTitle: t.scTitle, branch: '', worktreePath: '', createdAt: at, startedAt: at - 3000, lastMessage: 'Bash npm audit' };
      const ran = { ...check, lastRunAt: at, lastStatus: 'ok', runs: [{ at, status: 'ok', cardId: 'deps-run', message: ctx.tr('タスクを作って開始しました') }] };
      await page.evaluate(() => {
        closeModal();
        setView('kanban');
      });
      await stage([ran, weekly], { run: task });
      await settle();
      await snap(2.0);
      await stage([ran, weekly], { run: { ...task, status: 'review', lastMessage: t.scReport, costUsd: 0.02 } });
      await settle();
      await snap(3.0);
    }),
  };
}

module.exports = { features, FEATURE_SIZE };
