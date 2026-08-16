'use strict';

const { ipcMain, dialog, shell } = require('electron');
const { SaveService, discoverSaveDirectories, defaultSaveDirectories, SaveServiceError } = require('../backend/save-service.cjs');

function serializeError(error) {
  if (error instanceof SaveServiceError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  return { code: error?.code || 'INTERNAL_ERROR', message: error?.message || String(error) };
}

function requireDirectory(value) {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new SaveServiceError('INVALID_DIRECTORY', 'Please choose a save directory first.');
    throw error;
  }
  return value;
}

function registerIpcHandlers() {
  const service = new SaveService();
  const withUiSlots = (options) => ({ ...(options || {}), includeEmpty: true });
  const handle = (channel, task) => {
    ipcMain.handle(channel, async (_event, payload = {}) => {
      try {
        return await task(payload);
      } catch (error) {
        const serialized = serializeError(error);
        const ipcError = new Error(serialized.message);
        ipcError.name = serialized.code;
        throw ipcError;
      }
    });
  };

  handle('save:list', ({ directory, options }) => service.list(requireDirectory(directory), withUiSlots(options)));
  handle('save:discover', () => discoverSaveDirectories({ includeEmpty: true }));
  handle('save:default-directory', () => defaultSaveDirectories()[0]);
  handle('save:choose-directory', async ({ current }) => {
    const result = await dialog.showOpenDialog({
      title: '选择白色相簿 2 存档目录',
      defaultPath: typeof current === 'string' ? current : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('save:open-directory', async ({ directory }) => {
    const target = requireDirectory(directory);
    const error = await shell.openPath(target);
    if (error) throw new SaveServiceError('OPEN_DIRECTORY_FAILED', error);
    return true;
  });
  handle('save:reorder', ({ directory, orderedIds, options }) => service.reorder(requireDirectory(directory), orderedIds, withUiSlots(options)));
  handle('save:move', ({ directory, moves, options }) => service.move(requireDirectory(directory), moves, withUiSlots(options)));
  handle('save:copy', ({ directory, ids, options }) => service.copy(requireDirectory(directory), ids, withUiSlots(options)));
  handle('save:delete', ({ directory, ids, options }) => service.delete(requireDirectory(directory), ids, withUiSlots(options)));
}

module.exports = { registerIpcHandlers, serializeError };
