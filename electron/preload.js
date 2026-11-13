const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  info: () => ipcRenderer.invoke('info'),
  chooseRoot: () => ipcRenderer.invoke('settings:chooseRoot'),
  listSongs: () => ipcRenderer.invoke('songs:list'),
  createSong: (data) => ipcRenderer.invoke('songs:create', data),
  addDecision: (song, agent, text) => ipcRenderer.invoke('songs:decision', song, agent, text),
  addVersion: (song, v) => ipcRenderer.invoke('songs:version', song, v),
  setProgression: (song, prog) => ipcRenderer.invoke('songs:progression', song, prog),
  exportMidi: (req) => ipcRenderer.invoke('harmony:midi', req),
  checkVoices: (v) => ipcRenderer.invoke('harmony:voices', v),
  bookPage: (book, page) => ipcRenderer.invoke('book:page', book, page),
  openBook: (book) => ipcRenderer.invoke('book:open', book),
  openReader: (book, page) => ipcRenderer.invoke('book:reader', book, page),
  analyze: (filePath) => ipcRenderer.invoke('audio:analyze', filePath),
  pickAudio: () => ipcRenderer.invoke('audio:pick'),
  pathForFile: (f) => webUtils.getPathForFile(f),
  usage: () => ipcRenderer.invoke('usage:list'),
  limits: () => ipcRenderer.invoke('usage:limits'),
  openPath: (p) => ipcRenderer.invoke('open:path', p),
  ask: (req) => ipcRenderer.invoke('agent:ask', req),
  cancel: (id) => ipcRenderer.invoke('agent:cancel', id),
  onAgentEvent: (cb) => {
    const h = (_e, id, ev) => cb(id, ev);
    ipcRenderer.on('agent:event', h);
    return () => ipcRenderer.removeListener('agent:event', h);
  },
});
