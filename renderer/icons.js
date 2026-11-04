// UI のアイコン（白・黒基調のモノクロ線画アイコン）
// 絵文字は OS ごとにカラーで描かれて見た目がそろわないため、SVG の線画に置き換えている。
// 色は currentColor（まわりの文字色）に合わせるので、ダークテーマでは白、ライトテーマでは黒になる。
// 使い方: icon('chat') → '<svg class="ic">…</svg>' の文字列（innerHTML / テンプレートに埋め込む）
(function (root) {
  // 24x24 の viewBox に描く。線は stroke（currentColor）で、太さは CSS の .ic でそろえる
  const PATHS = {
    // ブランドのロゴ（カンバンの3列）
    logo: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9 3v18M15 3v18"/><path d="M5.5 7h1.5M11 7h2M17 7h1.5M5.5 11h1.5M17 11h1.5" stroke-width="2.4"/>',
    settings:
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.14L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    pipeline: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    flag: '<path d="M4 22V4"/><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M9 13v2M15 13v2"/><path d="M2 13v2M22 13v2"/>',
    note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
    compare: '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0z"/><path d="M19 7l-3 7a3 3 0 0 0 6 0z"/><path d="M8 21h8"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    question: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
    conflict: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7"/><path d="M8.3 7l7.4 4M8.3 17l7.4-4"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    terminal: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3M12 15h5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    play: '<path d="M7 4.5v15a.5.5 0 0 0 .77.42l11.5-7.5a.5.5 0 0 0 0-.84L7.77 4.08A.5.5 0 0 0 7 4.5z" fill="currentColor"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/>',
    branch: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="7" r="2.5"/><path d="M6 7.5v9"/><path d="M18 9.5a6 6 0 0 1-6 6H6"/>',
    pr: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M6 7.5v9"/><path d="M18 16.5V9a3 3 0 0 0-3-3h-4"/><path d="m13 3-3 3 3 3"/>',
    merge: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="13" r="2.5"/><path d="M6 7.5v9"/><path d="M6 7.5a8 8 0 0 0 9.5 5.5"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    // エージェントのブランド寄りのマーク（モノクロ・currentColor。ぱっと見で見分けられる形）
    // Claude / Anthropic: 曲線のアスタリスク（縦＋横の花弁）
    claude:
      '<path fill="currentColor" stroke="none" d="M12 2c.4 4 1.9 6.7 5.5 8.5C13.9 12.3 12.4 15 12 19c-.4-4-1.9-6.7-5.5-8.5C10.1 8.7 11.6 6 12 2z"/><path fill="currentColor" stroke="none" d="M2 12c4-.4 6.7-1.9 8.5-5.5C12.3 10.1 15 11.6 19 12c-4 .4-6.7 1.9-8.5 5.5C10.1 13.9 7.4 12.4 2 12z"/>',
    // Codex / OpenAI: 六角＋内側の輪（結び目の簡略）
    codex:
      '<path fill="currentColor" stroke="none" d="M12 2.2 16.3 4.7 18.8 9v6l-2.5 4.3L12 21.8l-4.3-2.5L5.2 15V9l2.5-4.3z"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    // Gemini: 四芒星＋小さな星
    gemini:
      '<path fill="currentColor" stroke="none" d="M12 2.5 14.2 9.8 21.5 12 14.2 14.2 12 21.5 9.8 14.2 2.5 12 9.8 9.8z"/><path fill="currentColor" stroke="none" d="M18.5 3.5 19.3 5.7 21.5 6.5 19.3 7.3 18.5 9.5 17.7 7.3 15.5 6.5 17.7 5.7z"/>',
    // Cursor: 幾何学的なポインタ
    cursor:
      '<path fill="currentColor" stroke="none" d="M5 3.2 19.5 12.1l-6.2 1.6 2.6 6.8-3.1 1.2-2.7-7.1L5 17.2z"/>',
  };

  // エージェント ID → アイコン名（未知の ID は汎用の bot）
  const AGENT_ICON = { claude: 'claude', codex: 'codex', gemini: 'gemini', cursor: 'cursor' };

  // 通知の種類ごとのアイコン
  const NOTIF = { permission: 'lock', question: 'question', awaiting: 'chat', review: 'eye', failed: 'alert', done: 'checkCircle', skill: 'bulb', conflict: 'conflict' };

  function icon(name, cls) {
    const p = PATHS[name];
    if (!p) return '';
    return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  }

  // エージェントのブランドアイコン（表示用の HTML）。未知なら bot
  function agentIcon(a, cls) {
    return icon(AGENT_ICON[a] || 'bot', cls);
  }

  const api = { icon, agentIcon, ICON_NAMES: Object.keys(PATHS), AGENT_ICON, NOTIF_ICON: NOTIF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
