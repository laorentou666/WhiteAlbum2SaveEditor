import type { SaveData, SaveOperationOptions, SaveOperationResult } from './types';

interface ElectronAPI {
  listSaves(directory: string, options?: { inspectBytes?: number; includeEmpty?: boolean }): Promise<SaveData[]>;
  discoverSaveDirectories(): Promise<Array<{ path: string; saves: SaveData[] }>>;
  defaultSaveDirectory(): Promise<string>;
  chooseSaveDirectory(current?: string): Promise<string | null>;
  openSaveDirectory(directory: string): Promise<boolean>;
  reorderSaves(directory: string, orderedIds: string[], options?: SaveOperationOptions): Promise<SaveOperationResult>;
  moveSaves(directory: string, moves: Array<{ id: string; targetSlot: number }>, options?: SaveOperationOptions): Promise<SaveOperationResult>;
  copySaves(directory: string, ids: string[], options?: SaveOperationOptions & { targetSlots?: number[] }): Promise<SaveOperationResult>;
  deleteSaves(directory: string, ids: string[], options?: SaveOperationOptions): Promise<SaveOperationResult>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
