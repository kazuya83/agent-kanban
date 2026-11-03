// レンダラーに安全な API だけを公開する
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, arg) {
  const r = await ipcRenderer.invoke(channel, arg);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

contextBridge.exposeInMainWorld('api', {
  getBoard: () => call('board:get'),
  chooseRepo: () => call('repo:choose'),
  repoInfo: () => call('repo:info'),
  updateSettings: (patch) => call('settings:update', patch),
  createCard: (p) => call('card:create', p),
  updateCard: (p) => call('card:update', p),
  start: (id) => call('card:start', id),
  stop: (id) => call('card:stop', id),
  send: (id, message) => call('card:send', { id, message }),
  logs: (id) => call('card:logs', id),
  diff: (id) => call('card:diff', id),
  merge: (id) => call('card:merge', id),
  discard: (id) => call('card:discard', id),
  answerPermission: (id, reqId, decision, message) => call('card:permission', { id, reqId, decision, message }),
  open: (id) => call('card:open', id),
  onBoard: (cb) => ipcRenderer.on('board:changed', (_e, d) => cb(d)),
  onLog: (cb) => ipcRenderer.on('card:log', (_e, d) => cb(d)),
  onFocus: (cb) => ipcRenderer.on('card:focus', (_e, id) => cb(id)),
});
