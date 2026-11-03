// レンダラーに安全な API だけを公開する
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, arg) {
  const r = await ipcRenderer.invoke(channel, arg);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

contextBridge.exposeInMainWorld('api', {
  getBoard: () => call('board:get'),
  checkEnv: () => call('env:check'),
  chooseRepo: () => call('repo:choose'),
  repoInfo: () => call('repo:info'),
  updateSettings: (patch) => call('settings:update', patch),
  createCard: (p) => call('card:create', p),
  updateCard: (p) => call('card:update', p),
  createFromIssues: (p) => call('card:createFromIssues', p),
  repoGithub: () => call('repo:github'),
  openExternal: (url) => call('open:external', url),
  ghStatus: () => call('gh:status'),
  ghInstall: () => call('gh:install'),
  ghLogin: () => call('gh:login'),
  ghCancel: () => call('gh:cancel'),
  onGh: (cb) => ipcRenderer.on('gh:event', (_e, d) => cb(d)),
  start: (id) => call('card:start', id),
  stop: (id) => call('card:stop', id),
  send: (id, message, skill) => call('card:send', { id, message, skill }),
  listSkills: () => call('skills:list'),
  btw: (id, text) => call('card:btw', { id, text }),
  setSession: (id, session) => call('card:setSession', { id, session }),
  listSessions: () => call('sessions:list'),
  logs: (id) => call('card:logs', id),
  diff: (id) => call('card:diff', id),
  merge: (id, opts) => call('card:merge', { id, ...(opts || {}) }),
  discard: (id) => call('card:discard', id),
  resolveConflict: (id, mode) => call('conflict:resolve', { id, mode }),
  completeConflict: (id) => call('conflict:complete', id),
  abortConflict: (id) => call('conflict:abort', id),
  dismissConflict: (id) => call('conflict:dismiss', id),
  answerPermission: (id, reqId, decision, message) => call('card:permission', { id, reqId, decision, message }),
  answerQuestion: (id, reqId, answers) => call('card:answer', { id, reqId, answers }),
  open: (id) => call('card:open', id),
  onBoard: (cb) => ipcRenderer.on('board:changed', (_e, d) => cb(d)),
  onLog: (cb) => ipcRenderer.on('card:log', (_e, d) => cb(d)),
  onFocus: (cb) => ipcRenderer.on('card:focus', (_e, id) => cb(id)),
});
