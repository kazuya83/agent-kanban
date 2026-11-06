// 指示に添付したファイル（画像・PDF・テキストなど）
//
// 画面ではファイルを base64 で読み、card:create / chat:create / card:send の引数で渡す（遠隔操作でもそのままホストに届く）。
// ホストでは、作業フォルダ（worktree・リポジトリ）の外にあるアプリのフォルダ（userData/attachments/<カードID>/）に保存し、
//  - 指示の最後に、保存したファイルのパスを書き足す（どのエージェントも、ここから読める）
//  - Claude Code には、画像をそのまま（stream-json の image ブロックで）渡す
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { tr } = require('../renderer/i18n');

const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 遠隔操作の1行の上限（32MB）に base64 で収まるように
// Claude に画像としてそのまま渡せる形式と大きさ（API の上限は base64 で 5MB。余裕をみる）
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_INLINE_IMAGE_BYTES = 3.5 * 1024 * 1024;
// ログに画像として残す大きさ（agent.js の MAX_IMAGE_BYTES と同じく base64 の長さで 4MB まで）
const MAX_LOG_IMAGE_B64 = 4 * 1024 * 1024;

const EXT_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

// ファイル名を、フォルダの外に出たり OS で使えなかったりしない形にする
function safeName(name, i) {
  let n = String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(-120);
  if (!n) n = `attachment-${i + 1}`;
  return n;
}

function mediaTypeOf(name, mediaType) {
  const t = String(mediaType || '').toLowerCase().trim();
  if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t)) return t;
  const ext = path.extname(String(name || '')).slice(1).toLowerCase();
  return EXT_TYPES[ext] || 'application/octet-stream';
}

function fmtSize(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

/**
 * 画面から届いた添付を確かめる（保存はしない）
 * @param {Array<{ name: string, mediaType?: string, data: string }>} list data は base64
 * @returns {Array<{ name: string, mediaType: string, buf: Buffer }>}
 */
function parseAttachments(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error(tr('添付ファイルの形が正しくありません'));
  if (list.length > MAX_FILES) throw new Error(tr('添付できるファイルは {MAX_FILES} 個までです', { MAX_FILES }));
  let total = 0;
  const used = new Set();
  return list.map((a, i) => {
    const data = a && typeof a.data === 'string' ? a.data.replace(/^data:[^,]*,/, '') : '';
    if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw new Error(tr('添付ファイル「{v}」を読み取れませんでした', { v: (a && a.name) || i + 1 }));
    const buf = Buffer.from(data, 'base64');
    let name = safeName(a.name, i);
    if (buf.length > MAX_FILE_BYTES) throw new Error(tr('添付ファイル「{name}」が大きすぎます（1つ {fmtSize} まで）', { name, fmtSize: fmtSize(MAX_FILE_BYTES) }));
    total += buf.length;
    if (total > MAX_TOTAL_BYTES) throw new Error(tr('添付ファイルが大きすぎます（合わせて {fmtSize} まで）', { fmtSize: fmtSize(MAX_TOTAL_BYTES) }));
    // 同じ名前があれば番号を付ける
    if (used.has(name.toLowerCase())) {
      const ext = path.extname(name);
      const base = name.slice(0, name.length - ext.length);
      let k = 2;
      while (used.has(`${base} (${k})${ext}`.toLowerCase())) k++;
      name = `${base} (${k})${ext}`;
    }
    used.add(name.toLowerCase());
    return { name, mediaType: mediaTypeOf(name, a.mediaType), buf };
  });
}

/**
 * 添付を root/<cardId>/<ひとまとまりの ID>/ に保存する
 * @returns {Array<{ name: string, mediaType: string, size: number, path: string }>}
 */
function saveAttachments(root, cardId, parsed) {
  if (!parsed || !parsed.length) return [];
  const dir = path.join(root, String(cardId), crypto.randomBytes(3).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return parsed.map((a) => {
    const file = path.join(dir, a.name);
    fs.writeFileSync(file, a.buf);
    return { name: a.name, mediaType: a.mediaType, size: a.buf.length, path: file };
  });
}

function cardDir(root, cardId) {
  return path.join(root, String(cardId));
}

function removeCardAttachments(root, cardId) {
  if (!root || !cardId) return;
  try {
    fs.rmSync(cardDir(root, cardId), { recursive: true, force: true });
  } catch {
    /* 消せなくても続ける */
  }
}

function isInlineImage(a) {
  return !!a && INLINE_IMAGE_TYPES.has(a.mediaType) && a.size <= MAX_INLINE_IMAGE_BYTES;
}

/**
 * 指示の最後に書き足す、添付ファイルの一覧
 * @param {object[]} atts saveAttachments の返り値
 * @param {{ toAgentPath?: (p: string) => string, inlineImages?: boolean }} o
 *   toAgentPath: エージェントから見えるパスに直す（WSL なら /mnt/c/...）
 *   inlineImages: 画像をメッセージにも添付しているか（Claude Code）
 */
function attachmentNote(atts, { toAgentPath = (p) => p, inlineImages = false } = {}) {
  if (!atts || !atts.length) return '';
  const lines = ['## 添付ファイル', 'ユーザーがこの指示にファイルを添付しました。必要に応じて、次の場所から読んでください（作業フォルダの外にあります。リポジトリに入れたいときはコピーしてください）。'];
  for (const a of atts) {
    const inline = inlineImages && isInlineImage(a) ? '・このメッセージにも画像として添付しています' : '';
    lines.push(`- ${a.name}（${a.mediaType}・${fmtSize(a.size)}${inline}）: ${toAgentPath(a.path)}`);
  }
  return lines.join('\n');
}

function withAttachmentNote(text, atts, o) {
  const note = attachmentNote(atts, o);
  return note ? `${text}\n\n${note}` : text;
}

/**
 * Claude Code にそのまま渡す画像（stream-json の content ブロック）。読めないファイルは飛ばす（パスは指示に書いてある）
 */
function imageBlocks(atts) {
  const out = [];
  for (const a of atts || []) {
    if (!isInlineImage(a)) continue;
    try {
      out.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: fs.readFileSync(a.path).toString('base64') } });
    } catch {
      /* 消されていたら、パスだけで渡す */
    }
  }
  return out;
}

/**
 * ログ（あなたの指示）に残す形。画像は小さければ中身も入れて、画面で表示できるようにする
 * @param {object[]} atts saveAttachments の返り値
 * @param {Array<{ buf: Buffer }>} [parsed] 保存前の中身（あれば読み直さない）
 */
function logExtra(atts, parsed) {
  if (!atts || !atts.length) return null;
  const files = atts.map((a) => ({ name: a.name, mediaType: a.mediaType, size: a.size }));
  const images = [];
  atts.forEach((a, i) => {
    if (!INLINE_IMAGE_TYPES.has(a.mediaType)) return;
    let data = '';
    try {
      data = ((parsed && parsed[i] && parsed[i].buf) || fs.readFileSync(a.path)).toString('base64');
    } catch {
      /* */
    }
    if (data && data.length <= MAX_LOG_IMAGE_B64) images.push({ mediaType: a.mediaType, data });
    else images.push({ omitted: tr('大きすぎるので表示しません') });
  });
  return images.length ? { attachments: files, images } : { attachments: files };
}

module.exports = {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_INLINE_IMAGE_BYTES,
  parseAttachments,
  saveAttachments,
  removeCardAttachments,
  cardDir,
  isInlineImage,
  attachmentNote,
  withAttachmentNote,
  imageBlocks,
  logExtra,
};
