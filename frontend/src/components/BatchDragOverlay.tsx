import { motion } from 'framer-motion';
import { Layers3 } from 'lucide-react';
import { SaveData } from '../types';

interface BatchDragOverlayProps {
  saves: SaveData[];
}

export function BatchDragOverlay({ saves }: BatchDragOverlayProps) {
  const visibleSaves = saves.slice(0, 4);
  const primary = visibleSaves[0];
  if (!primary) return null;

  return (
    <div className="relative w-[min(76vw,18rem)] aspect-[16/10] cursor-grabbing">
      {visibleSaves.map((save, depth) => (
        <motion.div
          key={save.id}
          initial={{ x: depth * 48, y: depth * 18, rotate: depth * 2, opacity: depth === 0 ? 0.9 : 0.45 }}
          animate={{ x: depth * 8, y: depth * 8, rotate: depth * 0.75, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30, mass: 0.7 }}
          className="absolute inset-0 overflow-hidden rounded-lg border border-white/20 bg-slate-900 shadow-2xl"
          style={{ zIndex: visibleSaves.length - depth }}
        >
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={save.thumbnail ? { backgroundImage: `url(${save.thumbnail})` } : undefined}
          />
          {!save.thumbnail && <div className="absolute inset-0 bg-slate-800" />}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/20 to-transparent" />
          {depth === 0 && (
            <>
              <span className="absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-xs font-bold text-white">
                NO.{primary.slot.toString().padStart(3, '0')}
              </span>
              <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                <span className="truncate text-sm font-medium text-white">{primary.route}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-bold text-white shadow-lg">
                  <Layers3 size={14} />
                  {saves.length}
                </span>
              </div>
            </>
          )}
        </motion.div>
      ))}
    </div>
  );
}
