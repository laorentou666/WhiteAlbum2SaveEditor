import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  CollisionDetection,
  DndContext,
  DragCancelEvent,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { AlertTriangle, X } from 'lucide-react';
import { BatchDragOverlay } from './BatchDragOverlay';
import { SaveCard, SaveCardDropState } from './SaveCard';
import { SaveData } from '../types';

interface SaveMove {
  id: string;
  targetSlot: number;
}

interface MoveOptions {
  overwrite?: boolean;
}

interface SaveGridProps {
  saves: SaveData[];
  onMove: (moves: SaveMove[], options?: MoveOptions) => void | Promise<void>;
  onDelete: (ids: string[]) => void;
  onCopy: (ids: string[]) => void;
  onMoveToFree: (ids: string[]) => void;
}

interface ActiveDrag {
  activeId: string;
  ids: string[];
}

interface PendingMove {
  moves: SaveMove[];
  conflicts: SaveData[];
}

function sortSavesBySlot(items: SaveData[]) {
  return [...items].sort((a, b) => a.slot - b.slot);
}

const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

export function SaveGrid({ saves, onMove, onDelete, onCopy, onMoveToFree }: SaveGridProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, target: SaveData | null } | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const savesById = useMemo(() => new Map(saves.map((save) => [save.id, save])), [saves]);

  const draggedSaves = useMemo(() => {
    if (!activeDrag) return [];
    const items = activeDrag.ids
      .map((id) => savesById.get(id))
      .filter((save): save is SaveData => Boolean(save && !save.empty));
    const active = items.find((save) => save.id === activeDrag.activeId);
    return active ? [active, ...items.filter((save) => save.id !== active.id)] : items;
  }, [activeDrag, savesById]);

  const targetStates = useMemo(() => {
    const states = new Map<number, SaveCardDropState>();
    if (!activeDrag || overSlot === null) return states;
    const sourceIds = new Set(activeDrag.ids);
    for (let index = 0; index < activeDrag.ids.length; index += 1) {
      const slot = overSlot + index;
      const target = saves.find((save) => save.slot === slot);
      if (!target) continue;
      states.set(slot, !target.empty && !sourceIds.has(target.id) ? 'conflict' : 'available');
    }
    return states;
  }, [activeDrag, overSlot, saves]);

  const clearDrag = () => {
    activeDragRef.current = null;
    setActiveDrag(null);
    setOverSlot(null);
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const activeSave = savesById.get(String(active.id));
    if (!activeSave || activeSave.empty) return;

    const selected = selectedIds.has(activeSave.id)
      ? sortSavesBySlot(saves.filter((save) => !save.empty && selectedIds.has(save.id)))
      : [activeSave];
    const drag = { activeId: activeSave.id, ids: selected.map((save) => save.id) };
    activeDragRef.current = drag;
    setActiveDrag(drag);
    setOverSlot(activeSave.slot);
    setDropError(null);
    setContextMenu(null);
    if (!selectedIds.has(activeSave.id)) setSelectedIds(new Set([activeSave.id]));
  };

  const handleDragOver = ({ over }: DragOverEvent) => {
    const target = over ? savesById.get(String(over.id)) : undefined;
    setOverSlot(target?.slot ?? null);
  };

  const handleDragCancel = (_event: DragCancelEvent) => clearDrag();

  const handleDragEnd = ({ over }: DragEndEvent) => {
    const drag = activeDragRef.current;
    const target = over ? savesById.get(String(over.id)) : undefined;
    clearDrag();
    if (!drag || !target) return;

    const orderedSources = sortSavesBySlot(
      drag.ids.map((id) => savesById.get(id)).filter((save): save is SaveData => Boolean(save && !save.empty)),
    );
    const lastTargetSlot = target.slot + orderedSources.length - 1;
    if (lastTargetSlot > 100) {
      setDropError(`需要 ${orderedSources.length} 个连续档位，请将起点放在 NO.${String(101 - orderedSources.length).padStart(3, '0')} 或更前。`);
      return;
    }

    const moves = orderedSources.map((save, index) => ({ id: save.id, targetSlot: target.slot + index }));
    if (moves.every((move) => savesById.get(move.id)?.slot === move.targetSlot)) return;

    const sourceIds = new Set(drag.ids);
    const conflicts = moves
      .map((move) => saves.find((save) => save.slot === move.targetSlot))
      .filter((save): save is SaveData => Boolean(save && !save.empty && !sourceIds.has(save.id)));

    if (conflicts.length > 0) {
      setPendingMove({ moves, conflicts });
      return;
    }

    setSelectedIds(new Set());
    void onMove(moves, { overwrite: false });
  };

  const handleSelect = (id: string, multi: boolean) => {
    setContextMenu(null);
    setSelectedIds(prev => {
      const newSet = new Set(multi ? prev : []);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, data: SaveData) => {
    e.preventDefault();
    if (data.empty) return;
    if (!selectedIds.has(data.id)) setSelectedIds(new Set([data.id]));
    const x = Math.min(e.pageX, window.innerWidth - 200);
    const y = Math.min(e.pageY, window.innerHeight - 150);
    setContextMenu({ x, y, target: data });
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    setSelectedIds((previous) => {
      const valid = new Set(saves.filter((save) => !save.empty).map((save) => save.id));
      return new Set(Array.from(previous).filter((id) => valid.has(id)));
    });
  }, [saves]);

  useEffect(() => {
    if (!pendingMove) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingMove(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingMove]);

  const handleContainerClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.save-card') === null) setSelectedIds(new Set());
  };

  const confirmOverwrite = () => {
    if (!pendingMove) return;
    const moves = pendingMove.moves;
    setPendingMove(null);
    setSelectedIds(new Set());
    void onMove(moves, { overwrite: true });
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-6 scroll-smooth" onClick={handleContainerClick}>
      {dropError && (
        <div className="sticky top-0 z-30 mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-400/30 bg-amber-950/95 px-4 py-3 text-sm text-amber-100 shadow-xl" role="alert">
          <span>{dropError}</span>
          <button type="button" className="shrink-0 rounded-md p-1 text-amber-200 hover:bg-white/10 hover:text-white" onClick={() => setDropError(null)} title="关闭提示">
            <X size={16} />
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetectionStrategy}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={saves.map(s => s.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 sm:gap-6">
            {saves.map((save) => (
              <SaveCard
                key={save.id}
                data={save}
                isSelected={selectedIds.has(save.id)}
                isInDragGroup={Boolean(activeDrag?.ids.includes(save.id))}
                dropState={targetStates.get(save.slot)}
                onSelect={handleSelect}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay adjustScale={false} dropAnimation={{ duration: 220, easing: 'ease-out' }}>
          {draggedSaves.length > 0 ? <BatchDragOverlay saves={draggedSaves} /> : null}
        </DragOverlay>
      </DndContext>

      {contextMenu && (
        <div
          className="fixed z-50 w-48 py-1 bg-slate-800/95 backdrop-blur-md border border-slate-700 shadow-2xl rounded-lg overflow-hidden text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2.5 text-slate-200 hover:bg-blue-600 hover:text-white transition-colors"
            onClick={() => {
              onMoveToFree(Array.from(selectedIds));
              setContextMenu(null);
            }}
          >
            移动至空位 / 覆盖 ({selectedIds.size})
          </button>
          <button
            className="w-full text-left px-4 py-2.5 text-slate-200 hover:bg-blue-600 hover:text-white transition-colors"
            onClick={() => {
              onCopy(Array.from(selectedIds));
              setContextMenu(null);
            }}
          >
            复制存档 ({selectedIds.size})
          </button>
          <div className="h-px bg-slate-700 my-1" />
          <button
            className="w-full text-left px-4 py-2.5 text-red-400 hover:bg-red-600 hover:text-white transition-colors"
            onClick={() => {
              onDelete(Array.from(selectedIds));
              setContextMenu(null);
              setSelectedIds(new Set());
            }}
          >
            删除选中 ({selectedIds.size})
          </button>
        </div>
      )}

      {pendingMove && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingMove(null);
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-amber-400/30 bg-slate-900 p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="overwrite-title">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-amber-400/10 p-2 text-amber-300">
                <AlertTriangle size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="overwrite-title" className="text-base font-semibold text-white">覆盖现有存档？</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  将移动 {pendingMove.moves.length} 个存档，其中 {pendingMove.conflicts.length} 个目标档位已有存档：
                  <span className="ml-1 font-medium text-amber-200">
                    {pendingMove.conflicts.map((save) => `NO.${String(save.slot).padStart(3, '0')}`).join('、')}
                  </span>
                  。原文件会先创建备份，然后被覆盖。
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white" onClick={() => setPendingMove(null)} autoFocus>
                <X size={16} />
                取消
              </button>
              <button type="button" className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400" onClick={confirmOverwrite}>
                <AlertTriangle size={16} />
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
