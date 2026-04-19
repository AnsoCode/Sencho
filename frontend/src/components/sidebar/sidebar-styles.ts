import { cn } from '@/lib/utils';

export const sidebarRowBase = cn(
  'relative flex items-center gap-2 w-full px-2 py-1.5 rounded-md mb-0.5',
  'font-mono text-[13px] text-muted-foreground',
  'hover:bg-glass-highlight hover:text-foreground',
  'transition-colors group cursor-pointer',
);

export const sidebarRowActive = cn(
  'bg-accent/[0.07] text-stat-value',
  'after:content-[""] after:absolute after:left-[-12px] after:top-1 after:bottom-1',
  'after:w-[3px] after:rounded-sm after:bg-brand',
  'after:shadow-[0_0_6px_var(--brand)]',
);

export const sidebarGroupHeader = cn(
  'flex items-center justify-between w-full px-2 pt-3 pb-1',
  'text-[9px] leading-3 tracking-[0.22em] uppercase text-stat-subtitle',
  'cursor-pointer select-none',
);
