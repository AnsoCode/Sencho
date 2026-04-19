import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StackGroupProps {
  id: string;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  variant?: 'default' | 'pinned';
  children: ReactNode;
}

export function StackGroup({ id, label, count, collapsed, onToggle, variant = 'default', children }: StackGroupProps) {
  const labelColor = variant === 'pinned' ? 'text-brand/90' : 'text-stat-subtitle';
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-2 py-1 text-left hover:bg-glass-highlight/30 rounded-md"
        aria-expanded={!collapsed}
        aria-controls={`group-${id}-body`}
      >
        <span className={cn('font-mono text-[9px] tracking-[0.22em] uppercase', labelColor)}>
          {label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] tabular-nums text-stat-icon">{count}</span>
          {collapsed
            ? <ChevronRight className="w-3 h-3 text-stat-icon" strokeWidth={1.5} />
            : <ChevronDown className="w-3 h-3 text-stat-icon" strokeWidth={1.5} />}
        </span>
      </button>
      {!collapsed && (
        <div id={`group-${id}-body`} className="mt-0.5">
          {children}
        </div>
      )}
    </div>
  );
}
