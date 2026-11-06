// 画面の言葉の切り替え。原文（日本語）をキーにする。レンダラ（<script>）とアプリ本体（require）の両方から使う
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, 'locales');
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) if (f.endsWith('.js')) require(path.join(dir, f));
  } else {
    root.I18n = api;
    root.tr = api.tr;
    if (root.api && root.api.language) api.setLanguage(root.api.language);
    if (root.document) root.document.documentElement.lang = api.getLanguage();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LANGUAGES = [
    { code: 'en', label: 'English', locale: 'en-US' },
    { code: 'ja', label: '日本語', locale: 'ja-JP' },
    { code: 'es', label: 'Español', locale: 'es-ES' },
    { code: 'fr', label: 'Français', locale: 'fr-FR' },
    { code: 'zh', label: '简体中文', locale: 'zh-CN' },
  ];
  const DEFAULT_LANGUAGE = 'en'; // 初めて入れたとき
  const LEGACY_LANGUAGE = 'ja'; // language を持たない既存の board.json
  const table = Object.create(null);
  let current = 'ja'; // setLanguage するまでは原文のまま（テストはこの状態で動く）
  const isLanguage = (c) => LANGUAGES.some((x) => x.code === c);
  const setLanguage = (c) => { if (isLanguage(c)) current = c; return current; };
  const getLanguage = () => current;
  const locale = () => LANGUAGES.find((x) => x.code === current).locale;
  const add = (entries) => Object.assign(table, entries);
  const has = (key, lang) => !!(table[key] && table[key][lang]);
  function tr(key, vars) {
    const s = (current !== 'ja' && table[key] && table[key][current]) || key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
  }
  // 固定の HTML（index.html）の文字と title などを、原文から訳へ置き換える
  function localizeDom(doc) {
    const walk = doc.createTreeWalker(doc.body, 4);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const s = n.nodeValue.trim();
      if (s && tr(s) !== s) n.nodeValue = n.nodeValue.replace(s, tr(s));
    }
    doc.querySelectorAll('[title],[aria-label],[placeholder]').forEach((el) => {
      for (const a of ['title', 'aria-label', 'placeholder']) if (el.hasAttribute(a)) el.setAttribute(a, tr(el.getAttribute(a)));
    });
  }
  return { LANGUAGES, DEFAULT_LANGUAGE, LEGACY_LANGUAGE, isLanguage, setLanguage, getLanguage, locale, add, has, tr, localizeDom };
});
