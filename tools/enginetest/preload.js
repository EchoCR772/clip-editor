const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ET', {
  config: () => ipcRenderer.invoke('et-config'),
  size: p => ipcRenderer.invoke('et-size', p),
  read: (p, a, b) => ipcRenderer.invoke('et-read', p, a, b),
  openOut: name => ipcRenderer.invoke('et-open-out', name),
  write: (pos, data) => ipcRenderer.invoke('et-write', pos, data),
  closeOut: () => ipcRenderer.invoke('et-close-out'),
  save: (name, data) => ipcRenderer.invoke('et-save', name, data),
  ffmpeg: (src, start, len, codec, av1) => ipcRenderer.invoke('et-ffmpeg', src, start, len, codec, av1),
  done: r => ipcRenderer.invoke('et-done', r),
});
