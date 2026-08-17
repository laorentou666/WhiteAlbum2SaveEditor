import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, FolderOpen } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { SaveGrid } from './components/SaveGrid';
import { SaveData, SaveOperationResult } from './types';

const MOCK_OCCUPIED_SAVES: SaveData[] = [
  {
    id: 'save-1',
    slot: 1,
    date: '2010/12/24 23:45',
    thumbnail: 'https://images.unsplash.com/photo-1478265409131-1f65c88f965c?auto=format&fit=crop&q=80&w=800',
    textSnippet: '「为什么会变成这样呢……第一次有了喜欢的人。有了能做一辈子朋友的人。两件快乐事情重合在一起……」',
    route: 'Introductory Chapter',
  },
  {
    id: 'save-2',
    slot: 2,
    date: '2013/02/14 18:20',
    thumbnail: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&q=80&w=800',
    textSnippet: '「冬马，你在哪里……」吉他声在空荡的音乐室里回荡，仿佛她还在这里。',
    route: 'Closing Chapter',
  },
  {
    id: 'save-3',
    slot: 3,
    date: '2013/03/05 02:10',
    thumbnail: 'https://images.unsplash.com/photo-1483982258113-b72862e6cff6?auto=format&fit=crop&q=80&w=800',
    textSnippet: '我必须要做出选择了。这一次，不能再逃避。',
    route: 'CODA - 雪菜线',
  },
  {
    id: 'save-4',
    slot: 4,
    date: '2013/03/06 04:30',
    thumbnail: 'https://images.unsplash.com/photo-1478719059408-592965723cbc?auto=format&fit=crop&q=80&w=800',
    textSnippet: '雪一直在下，仿佛要将所有的罪恶感掩埋。',
    route: 'CODA - 冬马线',
  },
  {
    id: 'save-5',
    slot: 5,
    date: '2013/03/10 12:00',
    thumbnail: 'https://images.unsplash.com/photo-1486899430790-61dbf6f6d98b?auto=format&fit=crop&q=80&w=800',
    textSnippet: '春天的风吹过，一切都好像回到了最初的起点。',
    route: 'CODA - True End',
  },
];

function materializeSlots(occupied: SaveData[]): SaveData[] {
  const bySlot = new Map(occupied.filter((save) => !save.empty).map((save) => [save.slot, save]));
  return Array.from({ length: 100 }, (_, index) => {
    const slot = index + 1;
    return bySlot.get(slot) || {
      id: `empty-slot-${String(slot).padStart(3, '0')}`,
      empty: true,
      slot,
      date: '',
      textSnippet: '',
      route: '',
      format: 'empty',
    };
  });
}

const MOCK_SAVES = materializeSlots(MOCK_OCCUPIED_SAVES);

function apiErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
  return String(error);
}

export default function App() {
  const [saves, setSaves] = useState<SaveData[]>(MOCK_SAVES);
  const [directory, setDirectory] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const applyResult = useCallback((result: SaveOperationResult) => {
    setSaves(result.saves);
    setError(null);
  }, []);

  const loadDirectory = useCallback(async (target: string) => {
    if (!electronAPI) return;
    setIsLoading(true);
    setError(null);
    try {
      const loaded = await electronAPI.listSaves(target, { includeEmpty: true });
      setDirectory(target);
      setSaves(loaded);
    } catch (loadError) {
      setError(apiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [electronAPI]);

  useEffect(() => {
    if (!electronAPI) return;
    let active = true;
    const discover = async () => {
      try {
        const candidates = await electronAPI.discoverSaveDirectories();
        const first = candidates.find((candidate) => candidate.saves.some((save) => !save.empty)) || candidates[0];
        if (active && first) {
          setDirectory(first.path);
          setSaves(first.saves);
        } else if (active) {
          setSaves([]);
        }
      } catch (discoverError) {
        if (active) setError(apiErrorMessage(discoverError));
      }
    };
    void discover();
    return () => { active = false; };
  }, [electronAPI]);

  const handleChooseDirectory = async () => {
    if (!electronAPI) return;
    try {
      const chosen = await electronAPI.chooseSaveDirectory(directory || undefined);
      if (chosen) await loadDirectory(chosen);
    } catch (chooseError) {
      setError(apiErrorMessage(chooseError));
    }
  };

  const handleDelete = async (ids: string[]) => {
    const realIds = ids.filter((id) => saves.some((save) => save.id === id && !save.empty));
    if (realIds.length === 0) return;
    if (!electronAPI || !directory) {
      setSaves((previous) => materializeSlots(previous.filter((save) => !realIds.includes(save.id))));
      return;
    }
    setIsLoading(true);
    try {
      applyResult(await electronAPI.deleteSaves(directory, realIds, { backup: true }));
    } catch (operationError) {
      setError(apiErrorMessage(operationError));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async (ids: string[]) => {
    const realIds = ids.filter((id) => saves.some((save) => save.id === id && !save.empty));
    if (realIds.length === 0) return;
    if (!electronAPI || !directory) return;
    setIsLoading(true);
    try {
      applyResult(await electronAPI.copySaves(directory, realIds, { backup: true }));
    } catch (operationError) {
      setError(apiErrorMessage(operationError));
    } finally {
      setIsLoading(false);
    }
  };

  const handleMove = async (moves: Array<{ id: string; targetSlot: number }>, options: { overwrite?: boolean } = {}) => {
    const realMoves = moves.filter((move) => saves.some((save) => save.id === move.id && !save.empty));
    if (realMoves.length === 0) return;
    if (!electronAPI || !directory) {
      const byId = new Map(realMoves.map((move) => [move.id, move.targetSlot]));
      const targetSlots = new Set(realMoves.map((move) => move.targetSlot));
      const conflicts = saves.filter((save) => !save.empty && targetSlots.has(save.slot) && !byId.has(save.id));
      if (conflicts.length > 0 && !options.overwrite) {
        setError('目标档位已有存档，未执行移动。');
        return;
      }
      const moved = saves
        .filter((save) => byId.has(save.id))
        .map((save) => ({ ...save, slot: byId.get(save.id)! }));
      const retained = saves.filter((save) => !byId.has(save.id) && (save.empty || !targetSlots.has(save.slot)));
      setSaves(materializeSlots(retained.concat(moved)));
      setError(null);
      return;
    }
    setIsLoading(true);
    try {
      applyResult(await electronAPI.moveSaves(directory, realMoves, { backup: true, overwrite: options.overwrite === true }));
    } catch (operationError) {
      setError(apiErrorMessage(operationError));
    } finally {
      setIsLoading(false);
    }
  };

  const handleMoveToFree = async (ids: string[]) => {
    const occupied = new Set(saves.filter((save) => !save.empty).map((save) => save.slot));
    const moves: Array<{ id: string; targetSlot: number }> = [];
    let nextSlot = 1;
    for (const id of ids) {
      while (occupied.has(nextSlot)) nextSlot += 1;
      if (nextSlot > 100) {
        setError('没有可用的空存档位。');
        return;
      }
      moves.push({ id, targetSlot: nextSlot });
      occupied.add(nextSlot);
      nextSlot += 1;
    }
    await handleMove(moves);
  };

  const handleOpenDirectory = async () => {
    if (!electronAPI || !directory) return handleChooseDirectory();
    try {
      await electronAPI.openSaveDirectory(directory);
    } catch (openError) {
      setError(apiErrorMessage(openError));
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden text-slate-100 font-sans">
      <Sidebar onChooseDirectory={handleChooseDirectory} onOpenDirectory={handleOpenDirectory} />
      <div className="flex-1 flex flex-col bg-slate-900/40 relative">
        <header className="h-16 flex items-center justify-between px-3 sm:px-6 border-b border-white/5 glass-panel border-x-0 border-t-0 z-10">
          <div className="flex items-center space-x-3 text-sm text-slate-400 min-w-0">
            <span><span className="hidden sm:inline">当前存档总数: </span>{saves.filter((save) => !save.empty).length}/100</span>
            {directory && <span className="hidden sm:block truncate max-w-[32vw] text-slate-500" title={directory}>{directory}</span>}
          </div>
          <div className="flex space-x-1 sm:space-x-3 shrink-0">
            <button
              type="button"
              onClick={() => directory && void loadDirectory(directory)}
              disabled={isLoading || !directory}
              className="inline-flex items-center gap-2 p-2 sm:px-3 sm:py-2 text-slate-300 hover:text-white disabled:opacity-50 text-sm font-medium rounded-md transition-colors"
              title="刷新存档列表"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">刷新</span>
            </button>
            <button
              type="button"
              onClick={handleChooseDirectory}
              className="inline-flex items-center gap-2 p-2 sm:px-4 sm:py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md shadow-lg shadow-blue-900/20 transition-colors"
            >
              <FolderOpen size={16} />
              <span className="hidden sm:inline">选择目录</span>
            </button>
          </div>
        </header>
        {error && (
          <div className="mx-3 sm:mx-6 mt-4 px-4 py-3 rounded-md border border-red-400/30 bg-red-950/40 text-sm text-red-200" role="alert">
            {error}
          </div>
        )}
        <SaveGrid
          saves={saves}
          onMove={handleMove}
          onDelete={(ids) => void handleDelete(ids)}
          onCopy={(ids) => void handleCopy(ids)}
          onMoveToFree={(ids) => void handleMoveToFree(ids)}
        />
      </div>
    </div>
  );
}
