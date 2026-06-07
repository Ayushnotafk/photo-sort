const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  readFolder: (p) => ipcRenderer.invoke('read-folder', p),
  readImage: (p) => ipcRenderer.invoke('read-image', p),
  copyScript: (s) => ipcRenderer.invoke('copy-script', s),
  saveScript: (s) => ipcRenderer.invoke('save-script', s),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
});
