import { cn } from '@/lib/utils';

export interface CategoryEntry {
  name: string;
  count: number;
}

interface CategorySidebarProps {
  categories: CategoryEntry[];
  selected: string;
  onSelect: (name: string) => void;
}

export function CategorySidebar({ categories, selected, onSelect }: CategorySidebarProps) {
  return (
    <aside className="w-[180px] shrink-0 border-r border-border/60 pr-4">
      <div className="sticky top-0 flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-stat-subtitle px-2 py-1.5">
          Categories
        </span>
        <ul className="flex flex-col">
          {categories.map(cat => {
            const isActive = selected === cat.name;
            return (
              <li key={cat.name}>
                <button
                  type="button"
                  onClick={() => onSelect(cat.name)}
                  className={cn(
                    'relative flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition-colors',
                    isActive
                      ? 'text-brand bg-gradient-to-r from-brand/[0.12] to-transparent'
                      : 'text-foreground/80 hover:bg-muted/40',
                  )}
                >
                  {isActive && <span className="absolute inset-y-0 left-0 w-[2px] bg-brand rounded-sm" />}
                  <span className="truncate text-sm">{cat.name}</span>
                  <span className={cn(
                    'shrink-0 font-mono text-[10px] tabular-nums',
                    isActive ? 'text-brand' : 'text-stat-subtitle',
                  )}>
                    {cat.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
