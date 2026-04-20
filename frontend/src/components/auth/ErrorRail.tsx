import type { ReactNode } from 'react';

export function ErrorRail({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-destructive/30 bg-destructive/8 pl-4 pr-3 py-2.5">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-destructive/70" aria-hidden />
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">Error</div>
      <div className="text-sm leading-snug text-stat-value">{children}</div>
    </div>
  );
}
