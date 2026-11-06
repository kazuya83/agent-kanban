// 画面（カンバン管理 / タスクスケジューラ）の切り替えと、ハンバーガーメニューの開け閉め
// レンダラ（<script> で読み込む）とテスト（require）の両方から使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AppView = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const VIEWS = ['kanban', 'scheduler'];
  const DEFAULT_VIEW = 'kanban';
  const VIEW_KEY = 'agent-kanban.view';

  const normalizeView = (v) => (VIEWS.includes(v) ? v : DEFAULT_VIEW);

  // 選んだ画面を覚えておく。保存先が使えなくても画面は動かす（次の起動で既定の画面に戻るだけ）
  function loadView(storage) {
    try {
      return normalizeView(storage.getItem(VIEW_KEY));
    } catch {
      return DEFAULT_VIEW;
    }
  }
  function saveView(storage, view) {
    try {
      storage.setItem(VIEW_KEY, normalizeView(view));
    } catch {
      // 覚えられないだけなので、画面の切り替えは止めない
    }
  }

  // タスク詳細に「スケジュール登録」を出すか。
  // 会話・サブタスク・Pipeline の枝は、親や元のタスクの一部として動くので、単独では繰り返さない
  function canSchedule(c) {
    return !!c && c.kind !== 'chat' && !c.subtaskOf && !(c.relay && c.relay.branchOf);
  }

  // ハンバーガーメニュー。button で開け閉めし、項目（data-view）を選ぶか、Esc・外側のクリックで閉じる
  function bindNavMenu({ button, menu, doc, onSelect }) {
    const isOpen = () => !menu.classList.contains('hidden');
    const setOpen = (open) => {
      menu.classList.toggle('hidden', !open);
      button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', () => setOpen(!isOpen()));
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-view]');
      if (!item) return;
      setOpen(false);
      onSelect(item.dataset.view);
    });
    doc.addEventListener('mousedown', (e) => {
      if (isOpen() && !button.contains(e.target) && !menu.contains(e.target)) setOpen(false);
    });
    // 開いているあいだの Esc はメニューを閉じるだけにする（モーダルや詳細パネルまで閉じない）
    doc.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !isOpen()) return;
        e.stopImmediatePropagation();
        setOpen(false);
        button.focus();
      },
      true,
    );
    return { isOpen, setOpen };
  }

  return { VIEWS, DEFAULT_VIEW, VIEW_KEY, normalizeView, loadView, saveView, canSchedule, bindNavMenu };
});
