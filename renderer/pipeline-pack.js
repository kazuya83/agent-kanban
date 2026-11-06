// Pipeline（とカスタムエージェント）のエクスポート・インポートの中身を作る・読む。
// レンダラ（<script> で読み込む。設定の画面）とテスト（require）の両方から使う。ファイルを選ぶ・書くのはアプリ本体（file:save / file:open）。
//
// Pipeline のファイル（.json）:          { format: 'agent-kanban-pipeline', version: 1, name, flow }
// カスタムエージェントのファイル（.json）: { format: 'agent-kanban-custom-agent', version: 1, customAgent: { id, name, icon, color, description, instruction, agent, model } }
// まとめたファイル（.zip）:              manifest.json と、pipelines/*.json・custom-agents/*.json（上の形のファイル）
//
// 工程のカスタムエージェントは ID（node.custom）で指す。取り込むときは、取り込み先の同じ中身のカスタムエージェントを使い、
// ないときは新しく足して、工程の ID を付け替える
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PipelinePack = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const i18n = typeof module === 'object' && module.exports ? require('./i18n.js') : typeof I18n !== 'undefined' ? I18n : null;
  const flowModel = typeof module === 'object' && module.exports ? require('./flow-model') : typeof globalThis !== 'undefined' ? globalThis.FlowModel : null;
  function tr(key, vars) {
    if (i18n) return i18n.tr(key, vars);
    return vars ? String(key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : key;
  }
  const PIPELINE_FORMAT = 'agent-kanban-pipeline';
  const CUSTOM_FORMAT = 'agent-kanban-custom-agent';
  const BUNDLE_FORMAT = 'agent-kanban-bundle';
  const VERSION = 1;
  const MAX_ENTRIES = 200;
  const MAX_TOTAL = 20 * 1024 * 1024; // 取り込む zip の中身の合計の上限
  const MAX_PIPELINES = 30;
  // Pipeline の名前の長さの上限（src/store.js の PIPELINE_NAME_MAX と同じ）
  const PIPELINE_NAME_MAX = 15;
  const MAX_CUSTOM_AGENTS = 30;
  const CA_FIELDS = ['name', 'icon', 'color', 'description', 'instruction', 'agent', 'model'];

  const enc = (s) => new TextEncoder().encode(s);
  const dec = (b) => new TextDecoder('utf-8').decode(b);

  // ---------- base64 ----------
  function toBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromBase64(s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(s || ''), 'base64'));
    const bin = atob(String(s || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------- zip（書くときは無圧縮。読むときは無圧縮と deflate） ----------
  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }
  // files: [{ name, data: Uint8Array | string }]
  function makeZip(files, now = new Date()) {
    const { time, date } = dosTime(now);
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const f of files) {
      const name = enc(f.name);
      const data = typeof f.data === 'string' ? enc(f.data) : f.data;
      const crc = crc32(data);
      const lh = new Uint8Array(30 + name.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); // ファイル名は UTF-8
      lv.setUint16(8, 0, true); // 無圧縮
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      locals.push(lh, data);
      centrals.push(ch);
      offset += lh.length + data.length;
    }
    const cdSize = centrals.reduce((n, x) => n + x.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + cdSize + end.length);
    let p = 0;
    for (const x of [...locals, ...centrals, end]) {
      out.set(x, p);
      p += x.length;
    }
    return out;
  }
  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error(tr('圧縮された zip を読めません'));
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function isZip(bytes) {
    return bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }
  // @returns {Promise<{ name: string, data: Uint8Array }[]>}（フォルダは除く）
  async function readZip(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
      if (v.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error(tr('zip ファイルとして読めません'));
    const count = v.getUint16(eocd + 10, true);
    if (count > MAX_ENTRIES) throw new Error(tr('zip の中のファイルが多すぎます（{max} まで）', { max: MAX_ENTRIES }));
    let p = v.getUint32(eocd + 16, true);
    const out = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new Error(tr('zip ファイルが壊れています'));
      const method = v.getUint16(p + 10, true);
      const csize = v.getUint32(p + 20, true);
      const usize = v.getUint32(p + 24, true);
      const nlen = v.getUint16(p + 28, true);
      const xlen = v.getUint16(p + 30, true);
      const clen = v.getUint16(p + 32, true);
      const lo = v.getUint32(p + 42, true);
      const name = dec(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      total += usize;
      if (total > MAX_TOTAL) throw new Error(tr('zip の中身が大きすぎます'));
      if (lo + 30 > bytes.length || v.getUint32(lo, true) !== 0x04034b50) throw new Error(tr('zip ファイルが壊れています'));
      const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
      const raw = bytes.subarray(start, start + csize);
      let data;
      if (method === 0) data = raw;
      else if (method === 8) data = await inflateRaw(raw);
      else throw new Error(tr('この zip の圧縮方式（{method}）には対応していません', { method }));
      out.push({ name, data });
    }
    return out;
  }

  // ---------- ファイルの中身 ----------
  function safeFileName(name, fallback = 'pipeline') {
    const s = String(name || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    return s || fallback;
  }
  function pickCustomAgent(ca) {
    const out = { id: String(ca.id || '') };
    for (const k of CA_FIELDS) out[k] = ca[k] == null ? '' : String(ca[k]);
    return out;
  }
  function pipelineFile(p) {
    return { format: PIPELINE_FORMAT, version: VERSION, name: String(p.name || 'Pipeline'), flow: p.flow };
  }
  function customAgentFile(ca) {
    return { format: CUSTOM_FORMAT, version: VERSION, customAgent: pickCustomAgent(ca) };
  }
  // Pipeline を1つだけのファイル（.json）にする
  function exportPipelineJson(p) {
    return JSON.stringify(pipelineFile(p), null, 2);
  }
  // そのフローの工程が使っているカスタムエージェントの ID
  function usedCustomIds(flow) {
    const out = [];
    for (const n of (flow && flow.nodes) || []) if (n && n.type === 'step' && n.custom && !out.includes(n.custom)) out.push(n.custom);
    return out;
  }
  // Pipeline（いくつでも）とカスタムエージェントを、まとめて zip にする
  function exportBundleZip({ pipelines = [], customAgents = [] }, now = new Date()) {
    const files = [];
    const names = new Set();
    const unique = (dir, base) => {
      let n = `${dir}/${base}.json`;
      for (let i = 2; names.has(n); i++) n = `${dir}/${base} (${i}).json`;
      names.add(n);
      return n;
    };
    // zip の中のファイル名は英数字だけにする（日本語の名前は、展開するツールによって文字化けする。名前は JSON の中にある）
    const ascii = (name, i, fb) => {
      const slug = String(name || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 40);
      return `${String(i + 1).padStart(2, '0')}-${slug || fb}`;
    };
    const manifest = { format: BUNDLE_FORMAT, version: VERSION, exportedAt: now.toISOString(), pipelines: [], customAgents: [] };
    for (const [i, p] of pipelines.entries()) {
      const n = unique('pipelines', ascii(p.name, i, 'pipeline'));
      manifest.pipelines.push({ file: n, name: String(p.name || '') });
      files.push({ name: n, data: exportPipelineJson(p) });
    }
    for (const [i, ca] of customAgents.entries()) {
      const n = unique('custom-agents', ascii(ca.name, i, 'custom-agent'));
      manifest.customAgents.push({ file: n, name: String(ca.name || '') });
      files.push({ name: n, data: JSON.stringify(customAgentFile(ca), null, 2) });
    }
    return makeZip([{ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) }, ...files], now);
  }

  // JSON 1つを読み分ける（Pipeline・カスタムエージェント・フローだけ）
  function classify(obj, fileName, out) {
    if (!obj || typeof obj !== 'object') return false;
    const base = String(fileName || '').split('/').pop().replace(/\.json$/i, '').replace(/\.pipeline$/i, '');
    const isFlow = (f) => f && typeof f === 'object' && Array.isArray(f.nodes) && Array.isArray(f.edges);
    if (obj.format === PIPELINE_FORMAT && isFlow(obj.flow)) {
      out.pipelines.push({ name: String(obj.name || base || 'Pipeline'), flow: obj.flow });
      return true;
    }
    if (obj.format === CUSTOM_FORMAT && obj.customAgent && typeof obj.customAgent === 'object') {
      out.customAgents.push(pickCustomAgent(obj.customAgent));
      return true;
    }
    if (isFlow(obj)) {
      out.pipelines.push({ name: base || 'Pipeline', flow: obj });
      return true;
    }
    return false;
  }
  // 選んだファイル（.json か .zip）を読む
  // @returns {Promise<{ pipelines: { name, flow }[], customAgents: object[], skipped: string[] }>}
  async function parseImport(fileName, bytes) {
    const out = { pipelines: [], customAgents: [], skipped: [] };
    const parseJson = (name, data) => {
      let obj;
      try {
        obj = JSON.parse(dec(data).replace(/^﻿/, ''));
      } catch {
        return false;
      }
      return classify(obj, name, out);
    };
    if (isZip(bytes)) {
      for (const e of await readZip(bytes)) {
        const base = e.name.split('/').pop();
        if (e.name.startsWith('__MACOSX/') || base.startsWith('.') || !/\.json$/i.test(base) || base === 'manifest.json') continue;
        if (!parseJson(e.name, e.data)) out.skipped.push(e.name);
      }
    } else if (!parseJson(fileName, bytes)) {
      throw new Error(tr('Pipeline のファイル（.json）か、Pipeline とカスタムエージェントをまとめた zip を選んでください'));
    }
    if (!out.pipelines.length && !out.customAgents.length) throw new Error(tr('取り込める Pipeline・カスタムエージェントが入っていません'));
    return out;
  }

  // ---------- 取り込み（今の一覧に足す） ----------
  function sameAgent(a, b) {
    return CA_FIELDS.every((k) => String(a[k] || '') === String(b[k] || ''));
  }
  function uniqueName(name, taken, max) {
    const base = [...String(name || '').trim()].slice(0, max).join('').trim() || 'Pipeline';
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const sfx = ` (${i})`;
      const n = [...base].slice(0, max - sfx.length).join('').trim() + sfx;
      if (!taken.has(n)) return n;
    }
  }
  function randomId(prefix, taken) {
    let id;
    do id = `${prefix}${Math.random().toString(16).slice(2, 10)}`;
    while (taken.has(id));
    return id;
  }
  /**
   * 読んだ中身を、今の Pipeline・カスタムエージェントの一覧に足す（今の一覧は変えずに、新しい一覧を返す）
   * - カスタムエージェント: 同じ中身のものがあればそれを使う。なければ足す（名前が重なれば「名前 (2)」）
   * - Pipeline: いつも新しく足す（名前が重なれば「名前 (2)」）。工程のカスタムエージェントの ID は付け替える
   * @returns {{ relayFlows, customAgents, addedPipelines: string[], addedAgents: string[], reusedAgents: string[], missing: string[] }}
   */
  function mergeImport(current, imported) {
    const flows = JSON.parse(JSON.stringify((current && current.relayFlows) || []));
    const cas = JSON.parse(JSON.stringify((current && current.customAgents) || []));
    const res = { addedPipelines: [], addedAgents: [], reusedAgents: [], missing: [] };
    const idMap = new Map();
    const caIds = new Set(cas.map((x) => x.id));
    const caNames = new Set(cas.map((x) => x.name));
    for (const raw of imported.customAgents || []) {
      const ca = pickCustomAgent(raw);
      if (!ca.name.trim()) continue;
      const same = cas.find((x) => x.id === ca.id && sameAgent(x, ca)) || cas.find((x) => sameAgent(x, ca));
      if (same) {
        if (ca.id) idMap.set(ca.id, same.id);
        if (!res.reusedAgents.includes(same.name)) res.reusedAgents.push(same.name);
        continue;
      }
      if (cas.length >= MAX_CUSTOM_AGENTS) throw new Error(tr('カスタムエージェントは {max} 個までです。いらないものを消してから取り込んでください', { max: MAX_CUSTOM_AGENTS }));
      const id = /^[A-Za-z0-9_-]{1,32}$/.test(ca.id) && !caIds.has(ca.id) ? ca.id : randomId('ca', caIds);
      const name = uniqueName(ca.name, caNames, 30);
      caIds.add(id);
      caNames.add(name);
      if (ca.id) idMap.set(ca.id, id);
      cas.push({ ...ca, id, name });
      res.addedAgents.push(name);
    }
    const flowIds = new Set(flows.map((x) => x.id));
    const flowNames = new Set(flows.map((x) => x.name));
    for (const p of imported.pipelines || []) {
      if (flows.length >= MAX_PIPELINES) throw new Error(tr('Pipeline は {max} 個までです。いらないものを消してから取り込んでください', { max: MAX_PIPELINES }));
      const flow = JSON.parse(JSON.stringify(p.flow));
      for (const n of flow.nodes || []) {
        if (!n || n.type !== 'step' || !n.custom) continue;
        if (idMap.has(n.custom)) n.custom = idMap.get(n.custom);
        if (!cas.some((x) => x.id === n.custom)) res.missing.push(tr('{pipeline}「{step}」', { pipeline: p.name, step: n.label && flowModel ? flowModel.displayText(n.label, 'step') : n.label || tr('工程') }));
      }
      const id = randomId('p', flowIds);
      const name = uniqueName(p.name, flowNames, PIPELINE_NAME_MAX);
      flowIds.add(id);
      flowNames.add(name);
      flows.push({ id, name, flow });
      res.addedPipelines.push(name);
    }
    return { relayFlows: flows, customAgents: cas, ...res };
  }

  return {
    PIPELINE_NAME_MAX,
    PIPELINE_FORMAT,
    CUSTOM_FORMAT,
    BUNDLE_FORMAT,
    VERSION,
    crc32,
    makeZip,
    readZip,
    isZip,
    toBase64,
    fromBase64,
    safeFileName,
    usedCustomIds,
    pipelineFile,
    customAgentFile,
    exportPipelineJson,
    exportBundleZip,
    parseImport,
    mergeImport,
    uniqueName,
  };
});
