import React, { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SaveCard } from './SaveCard';
import { SaveData } from '../types';

interface SaveGridProps {
  saves: SaveData[];
  onSavesReorder: (newSaves: SaveData[]) => void;
  onMove: (moves: Array<{ id: string; targetSlot: number }>) => void;
  onDelete: (ids: string[]) => void;
  onCopy: (ids: string[]) => void;
  onMoveToFree: (ids: string[]) => void;
}

export function SaveGrid({ saves, onSavesReorder, onMove, onDelete, onCopy, onMoveToFree }: SaveGridProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, target: SaveData | null } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeSave = saves.find((save) => save.id === active.id);
    const overSave = saves.find((save) => save.id === over.id);
    if (!activeSave || activeSave.empty || !overSave) return;
    if (overSave.empty) {
      onMove([{ id: activeSave.id, targetSlot: overSave.slot }]);
      return;
    }

    const occupied = saves.filter((save) => !save.empty);
    const oldIndex = occupied.findIndex((save) => save.id === activeSave.id);
    const newIndex = occupied.findIndex((save) => save.id === overSave.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const occupiedSlots = occupied.map((save) => save.slot).sort((a, b) => a - b);
    const reordered = arrayMove(occupied, oldIndex, newIndex);
    onSavesReorder(reordered.map((save, index) => ({ ...save, slot: occupiedSlots[index] })));
  };

  const handleSelect = (id: string, multi: boolean) => {
    setContextMenu(null);
    setSelectedIds(prev => {
      const newSet = new Set(multi ? prev : []);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, data: SaveData) => {
    e.preventDefault();
    if (data.empty) return;
    if (!selectedIds.has(data.id)) {
      setSelectedIds(new Set([data.id]));
    }
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

  const handleContainerClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.save-card') === null) {
      setSelectedIds(new Set());
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-6 scroll-smooth" onClick={handleContainerClick}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={saves.map(s => s.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 sm:gap-6">
            {saves.map((save) => (
              <SaveCard
                key={save.id}
                data={save}
                isSelected={selectedIds.has(save.id)}
                onSelect={handleSelect}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        </SortableContext>
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
    </div>
  );
}
