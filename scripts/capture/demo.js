// 約30秒のデモ GIF。1コマずつスクリーンショットを撮り、コマごとの長さを決めて ffmpeg でつなぐ
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const FPS = 10;
const WIDTH = 960;

module.exports = async function demo(ctx, outFile) {
  const { page, fx, show, settle } = ctx;
  const { cards: c, paths } = fx;
  const t = fx.t;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-demo-'));
  const frames = [];
  const snap = async (sec) => {
    const file = path.join(dir, `f${String(frames.length).padStart(4, '0')}.png`);
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
    frames.push({ file, sec });
  };

  // 操作の場所が分かるように、マウスの矢印を画面に重ねる
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'demoCursor';
    el.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:99999;pointer-events:none;transition:none';
    el.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 12-7 1 4 7-3 2-4-7-5 5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(el);
  });
  let cur = { x: 1200, y: 700 };
  const jump = (x, y) => page.evaluate(([a, b]) => { document.getElementById('demoCursor').style.transform = `translate(${a}px,${b}px)`; }, [x, y]);
  const moveTo = async (sel, { n = 5 } = {}) => {
    const box = await page.locator(sel).first().boundingBox();
    if (!box) throw new Error(`見つかりません: ${sel}`);
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (let i = 1; i <= n; i++) {
      const k = 1 - (1 - i / n) ** 2;
      await jump(cur.x + (to.x - cur.x) * k, cur.y + (to.y - cur.y) * k);
      await snap(0.1);
    }
    cur = to;
  };
  const typeInto = async (sel, text, sec = 1.3) => {
    const steps = 10;
    const chars = [...text];
    for (let i = 1; i <= steps; i++) {
      await page.fill(sel, chars.slice(0, Math.ceil((chars.length * i) / steps)).join(''));
      await snap(sec / steps);
    }
  };
  const board = (cards, more = {}) => show({ cards: Object.values(cards), notifications: fx.notifications.slice(0, 5), ...more });

  const running = { ...c.csv };
  let cards = { logs: c.logs, paging: c.paging, csv: { ...running, btw: [] }, enter: { ...c.enter, status: 'running', startedAt: Date.now() - 30000, lastMessage: 'Edit src/components/LoginForm.jsx', costUsd: 0 }, speed: c.speed };
  await jump(cur.x, cur.y);

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

  const total = frames.reduce((s, f) => s + f.sec, 0);
  const list = path.join(dir, 'list.txt');
  fs.writeFileSync(list, `${frames.map((f) => `file '${f.file}'\nduration ${f.sec.toFixed(3)}`).join('\n')}\nfile '${frames[frames.length - 1].file}'\n`);
  const filter = `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-filter_complex', filter, '-loop', '0', outFile]);
  fs.rmSync(dir, { recursive: true, force: true });
  await page.evaluate(() => document.getElementById('demoCursor')?.remove());
  console.log(`  demo.gif ${total.toFixed(1)}s ${(fs.statSync(outFile).size / 1048576).toFixed(1)}MB`);
};
