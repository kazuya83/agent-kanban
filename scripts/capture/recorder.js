// GIF の録画。1コマずつスクリーンショットを撮り、コマごとの長さを決めて ffmpeg でつなぐ
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const CURSOR_SVG = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 12-7 1 4 7-3 2-4-7-5 5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

async function createRecorder(page, start = { x: 1200, y: 700 }, onFrame = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-gif-'));
  const frames = [];
  let cur = start;

  const snap = async (sec) => {
    const file = path.join(dir, `f${String(frames.length).padStart(4, '0')}.png`);
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
    frames.push({ file, sec });
    if (onFrame) await onFrame();
  };
  const jump = (x, y) => page.evaluate(([a, b]) => { document.getElementById('demoCursor').style.transform = `translate(${a}px,${b}px)`; }, [x, y]);

  // 操作の場所が分かるように、マウスの矢印を画面に重ねる
  await page.evaluate((svg) => {
    const el = document.createElement('div');
    el.id = 'demoCursor';
    el.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:99999;pointer-events:none;transition:none';
    el.innerHTML = svg;
    document.body.appendChild(el);
  }, CURSOR_SVG);
  await jump(cur.x, cur.y);

  const moveTo = async (sel, { n = 5 } = {}) => {
    const target = page.locator(sel).first();
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
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
  const finish = async (outFile, { fps = 10, width = 960 } = {}) => {
    const total = frames.reduce((s, f) => s + f.sec, 0);
    const list = path.join(dir, 'list.txt');
    fs.writeFileSync(list, `${frames.map((f) => `file '${f.file}'\nduration ${f.sec.toFixed(3)}`).join('\n')}\nfile '${frames[frames.length - 1].file}'\n`);
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-filter_complex', filter, '-loop', '0', outFile]);
    fs.rmSync(dir, { recursive: true, force: true });
    await page.evaluate(() => document.getElementById('demoCursor')?.remove());
    console.log(`  ${path.basename(outFile)} ${total.toFixed(1)}s ${(fs.statSync(outFile).size / 1048576).toFixed(1)}MB`);
  };
  return { snap, jump, moveTo, typeInto, finish };
}

module.exports = { createRecorder };
