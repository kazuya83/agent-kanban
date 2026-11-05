// フローチャート（Pipelineの編集画面・進捗タブ）の拡大・縮小
// - ボタン（－ / 倍率 / ＋ / 全体）と、⌘（Ctrl）を押しながらのスクロール・トラックパッドのピンチで変える
// - ふつうのスクロールは、これまでどおり画面を動かす
// レンダラ（<script> で読み込む）とテスト（require）の両方から使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Zoom = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN = 0.25;
  const MAX = 2.5;
  const STEP = 1.2; // ボタン1回で変わる割合

  const clamp = (z, min = MIN, max = MAX) => {
    const n = Number(z);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
  };
  // ボタンで1段変える（dir: 1 で拡大、-1 で縮小）。100% をまたぐときは 100% で止める
  function step(z, dir) {
    const cur = clamp(z);
    let next = dir > 0 ? cur * STEP : cur / STEP;
    if ((cur < 1 && next > 1) || (cur > 1 && next < 1)) next = 1;
    return clamp(next);
  }
  // ⌘＋スクロール・ピンチ（deltaY が負なら拡大）
  function wheel(z, deltaY, deltaMode = 0) {
    const dy = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
    return clamp(clamp(z) * Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.01));
  }
  // 中身の幅・高さが、見えている枠に収まる倍率（1 より大きくはしない）
  function fit(contentW, contentH, viewW, viewH) {
    if (!(contentW > 0) || !(contentH > 0) || !(viewW > 0) || !(viewH > 0)) return 1;
    return clamp(Math.min(1, viewW / contentW, viewH / contentH));
  }
  // 倍率を z0 から z1 に変えるとき、枠の中の (px, py) の位置にあるものが動かないスクロール位置
  function anchor(scrollLeft, scrollTop, px, py, z0, z1) {
    const k = z1 / z0;
    return { left: Math.max(0, (scrollLeft + px) * k - px), top: Math.max(0, (scrollTop + py) * k - py) };
  }
  const pct = (z) => `${Math.round(clamp(z) * 100)}%`;

  // 操作ボタン。label: 倍率の欄に出す文字（省くと pct(z)）
  function toolbarHtml(z, label) {
    return `<div class="zoom-bar" role="group" aria-label="拡大・縮小">
      <button class="zoom-btn" type="button" data-zoom="out" title="縮小（⌘ / Ctrl ＋ スクロールでも変えられます）" ${clamp(z) <= MIN ? 'disabled' : ''}>－</button>
      <button class="zoom-btn zoom-pct" type="button" data-zoom="reset" title="100% に戻す">${label || pct(z)}</button>
      <button class="zoom-btn" type="button" data-zoom="in" title="拡大（⌘ / Ctrl ＋ スクロールでも変えられます）" ${clamp(z) >= MAX ? 'disabled' : ''}>＋</button>
      <button class="zoom-btn" type="button" data-zoom="fit" title="全体が見える大きさにする">全体</button>
    </div>`;
  }

  /**
   * スクロールする枠に、⌘（Ctrl）＋スクロール・ピンチでの拡大・縮小を付ける
   * @param {HTMLElement} el スクロールする枠
   * @param {{ get: () => number, set: (z: number, at: { x: number, y: number }) => void }} o
   *   at: 枠の中のカーソルの位置（その位置を動かさずに倍率を変える）
   */
  function bindWheel(el, o) {
    el.addEventListener(
      'wheel',
      (ev) => {
        // トラックパッドのピンチは ctrlKey 付きの wheel として届く
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        const r = el.getBoundingClientRect();
        const z0 = o.get();
        const z1 = wheel(z0, ev.deltaY, ev.deltaMode);
        if (z1 !== z0) o.set(z1, { x: ev.clientX - r.left, y: ev.clientY - r.top });
      },
      { passive: false },
    );
  }

  return { MIN, MAX, clamp, step, wheel, fit, anchor, pct, toolbarHtml, bindWheel };
});
