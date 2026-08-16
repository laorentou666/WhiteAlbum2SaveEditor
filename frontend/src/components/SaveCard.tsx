import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SaveData } from '../types';
import { cn } from '../lib/utils';
import { Clock, MessageSquare, GripVertical } from 'lucide-react';

interface SaveCardProps {
  data: SaveData;
  isSelected: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onContextMenu: (e: React.MouseEvent, data: SaveData) => void;
}

export function SaveCard({ data, isSelected, onSelect, onContextMenu }: SaveCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: data.id,
    data,
    disabled: { draggable: Boolean(data.empty), droppable: false },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={(e) => { if (!data.empty) onSelect(data.id, e.ctrlKey || e.metaKey); }}
      onContextMenu={(e) => onContextMenu(e, data)}
      className={cn(
        "save-card group relative flex flex-col rounded-xl overflow-hidden select-none transition-all duration-200",
        data.empty ? "cursor-default" : "cursor-pointer",
        "glass-panel hover:border-blue-500/50 hover:shadow-blue-900/20",
        isDragging && "opacity-60 scale-105 shadow-2xl",
        isSelected && "ring-2 ring-blue-500 border-transparent bg-blue-950/40"
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-slate-800">
        {!data.empty && <>
          <div
            className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
            style={data.thumbnail ? { backgroundImage: 'url(' + data.thumbnail + ')' } : undefined}
          />
          {!data.thumbnail && <div className="absolute inset-0 bg-slate-800 flex items-center justify-center text-xs text-slate-500">暂无缩略图</div>}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/20 to-transparent" />
        </>}

        <div className="absolute top-2 left-2 flex items-center space-x-2">
          {!data.empty && <div
              {...attributes}
              {...listeners}
              className="p-1 rounded-md bg-black/40 text-white/50 hover:text-white hover:bg-black/80 cursor-grab active:cursor-grabbing backdrop-blur-sm transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={16} />
          </div>}
          <span className="px-2 py-1 text-xs font-bold text-white bg-black/60 backdrop-blur-sm rounded-md shadow-sm">
            NO.{data.slot.toString().padStart(3, '0')}
          </span>
        </div>

        {!data.empty && <div className="absolute top-2 right-2">
          <span className="px-2 py-1 text-xs font-medium text-blue-100 bg-blue-600/80 backdrop-blur-sm rounded-full shadow-sm">
            {data.route}
          </span>
        </div>}
      </div>

      <div className="p-4 flex flex-col flex-1 space-y-3 min-h-[128px]">
        {!data.empty && <>
          <div className="flex items-center text-xs text-slate-400 space-x-1.5">
            <Clock size={14} />
            <span>{data.date}</span>
          </div>

          <div className="flex items-start space-x-2 flex-1">
            <MessageSquare size={14} className="text-slate-500 mt-0.5 shrink-0" />
            <p className="text-sm text-slate-200 line-clamp-3 leading-relaxed">
              {data.textSnippet}
            </p>
          </div>
        </>}
      </div>

      {isSelected && (
        <div className="absolute inset-0 bg-blue-500/10 pointer-events-none" />
      )}
    </div>
  );
}
