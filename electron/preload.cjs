'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('electronAPI', {
  listSaves: (directory, options) => invoke('save:list', { directory, options }),
  discoverSaveDirectories: () => invoke('save:discover'),
  defaultSaveDirectory: () => invoke('save:default-directory'),
  chooseSaveDirectory: (current) => invoke('save:choose-directory', { current }),
  openSaveDirectory: (directory) => invoke('save:open-directory', { directory }),
  reorderSaves: (directory, orderedIds, options) => invoke('save:reorder', { directory, orderedIds, options }),
  moveSaves: (directory, moves, options) => invoke('save:move', { directory, moves, options }),
  copySaves: (directory, ids, options) => invoke('save:copy', { directory, ids, options }),
  deleteSaves: (directory, ids, options) => invoke('save:delete', { directory, ids, options }),
});
