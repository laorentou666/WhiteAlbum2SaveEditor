import { Settings, FolderOpen, Home, ListFilter } from 'lucide-react';
import { cn } from '../lib/utils';

interface SidebarProps {
  onChooseDirectory: () => void;
  onOpenDirectory: () => void;
}

export function Sidebar({ onChooseDirectory, onOpenDirectory }: SidebarProps) {
  const menus = [
    { icon: Home, label: '所有存档', active: true },
    { icon: ListFilter, label: '序章 (IC)' },
    { icon: ListFilter, label: '终章 (CC)' },
    { icon: ListFilter, label: '最终章 (CODA)' },
  ];

  return (
    <div className="w-16 sm:w-64 shrink-0 glass-panel border-l-0 border-y-0 border-r border-white/5 flex flex-col bg-slate-900/80">
      <div className="p-3 sm:p-6 border-b border-white/5">
        <h1 className="text-xs sm:text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400 font-serif tracking-normal sm:tracking-widest">
          <span className="sm:hidden">WA2</span>
          <span className="hidden sm:inline">WHITE ALBUM 2</span>
        </h1>
        <p className="hidden sm:block text-xs text-slate-400 mt-1 tracking-wider">Save Manager</p>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <div className="px-2 sm:px-3 space-y-1">
          {menus.map((menu, index) => (
            <button
              type="button"
              key={index}
              title={menu.label}
              className={cn(
                'w-full flex items-center justify-center sm:justify-start sm:space-x-3 px-2 sm:px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                menu.active ? 'bg-blue-600/20 text-blue-400' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200',
              )}
            >
              <menu.icon size={18} />
              <span className="hidden sm:inline">{menu.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-2 sm:p-4 border-t border-white/5 space-y-2">
        <button
          type="button"
          onClick={onOpenDirectory}
          title="打开存档目录"
          className="w-full flex items-center justify-center sm:justify-start sm:space-x-3 px-2 sm:px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
        >
          <FolderOpen size={18} />
          <span className="hidden sm:inline">打开存档目录</span>
        </button>
        <button
          type="button"
          onClick={onChooseDirectory}
          title="更换存档目录"
          className="w-full flex items-center justify-center sm:justify-start sm:space-x-3 px-2 sm:px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
        >
          <Settings size={18} />
          <span className="hidden sm:inline">更换存档目录</span>
        </button>
      </div>
    </div>
  );
}
