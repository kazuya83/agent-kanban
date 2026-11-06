// 画面（カンバン管理 / タスクスケジューラ / 設定）の切り替えと、ハンバーガーメニューの開け閉め、設定画面の左の一覧
// レンダラ（<script> で読み込む）とテスト（require）の両方から使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AppView = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const tr = (typeof module === 'object' && module.exports ? require('./i18n.js') : I18n).tr;
  const VIEWS = ['kanban', 'scheduler', 'settings'];
  const DEFAULT_VIEW = 'kanban';
  const VIEW_KEY = 'agent-kanban.view';
  // 設定画面は起動時に復元しない（次の起動は、その前のカンバンかスケジューラに戻る）
  const NOT_RESTORED_VIEW = 'settings';

  const normalizeView = (v) => (VIEWS.includes(v) ? v : DEFAULT_VIEW);

  // 選んだ画面を覚えておく。保存先が使えなくても画面は動かす（次の起動で既定の画面に戻るだけ）
  function loadView(storage) {
    try {
      const view = normalizeView(storage.getItem(VIEW_KEY));
      return view === NOT_RESTORED_VIEW ? DEFAULT_VIEW : view;
    } catch {
      return DEFAULT_VIEW;
    }
  }
  function saveView(storage, view) {
    if (view === NOT_RESTORED_VIEW) return;
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

  // 設定画面の左の一覧。id は節の要素 settings-<id> と対応する
  const SETTINGS_NAV = [
    {
      heading: null,
      items: [
        { id: 'general', label: tr('全般'), icon: 'settings' },
        { id: 'update', label: tr('アプリの更新'), icon: 'download' },
      ],
    },
    {
      heading: tr('このプロジェクト'),
      items: [
        { id: 'branch', label: tr('ブランチと取り込み'), icon: 'branch' },
        { id: 'issue', label: tr('Issue 連携'), icon: 'zap' },
        { id: 'permission', label: tr('権限'), icon: 'lock' },
        { id: 'task', label: tr('タスクの既定'), icon: 'note' },
      ],
    },
    {
      heading: tr('エージェント'),
      items: [
        { id: 'agents', label: tr('使うエージェント'), icon: 'bot' },
        { id: 'custom', label: tr('カスタムエージェント'), icon: 'wrench' },
        { id: 'orchestration', label: tr('オーケストレーション'), icon: 'pipeline' },
      ],
    },
  ];
  // 節の先頭がスクロール位置のこの距離まで近づいたら、その節を現在地にする
  const SECTION_TOP_MARGIN = 24;

  function settingsNavHtml(iconFn) {
    return SETTINGS_NAV.map(({ heading, items }) => {
      const head = heading ? `<div class="settings-nav-heading">${heading}</div>` : '';
      const links = items.map(({ id, label, icon }) => `<a class="settings-nav-item" href="#settings-${id}" data-section="${id}">${iconFn(icon)}<span>${label}</span></a>`);
      return head + links.join('');
    }).join('');
  }

  // tops は [{ id, top }] を上から順に並べたもの。どの節にも届いていなければ先頭を現在地にする
  function activeSection(tops, scrollTop) {
    const reached = tops.filter((t) => t.top <= scrollTop + SECTION_TOP_MARGIN);
    const current = reached[reached.length - 1] || tops[0];
    return current ? current.id : null;
  }

  // 設定画面の左の一覧。項目を押すと節までスクロールし、スクロールに合わせて現在地を動かす。
  // section(id) はその節の要素を返す関数（節がなければ null）
  function bindSettingsNav({ nav, scroller, section }) {
    const items = () => [...nav.querySelectorAll('[data-section]')];
    const sync = () => {
      const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
      const tops = items().flatMap((a) => {
        const el = section(a.dataset.section);
        return el ? [{ id: a.dataset.section, top: el.getBoundingClientRect().top - base }] : [];
      });
      const current = activeSection(tops, scroller.scrollTop);
      for (const a of items()) {
        const on = a.dataset.section === current;
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    };
    const scrollTo = (id) => {
      const el = section(id);
      if (!el) return;
      el.scrollIntoView();
      sync();
    };
    nav.addEventListener('click', (e) => {
      const item = e.target.closest('[data-section]');
      if (!item) return;
      e.preventDefault(); // 既定の動きのままだと location の # が変わるので、スクロールだけする
      scrollTo(item.dataset.section);
    });
    scroller.addEventListener('scroll', sync);
    sync();
    return { scrollTo, sync };
  }

  return { VIEWS, DEFAULT_VIEW, VIEW_KEY, SETTINGS_NAV, normalizeView, loadView, saveView, canSchedule, bindNavMenu, settingsNavHtml, activeSection, bindSettingsNav };
});
