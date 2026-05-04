import { cn } from '@/lib/utils';

export function BackupCodeTicket({ codes }: { codes: string[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-card-border bg-background/60 shadow-[inset_0_2px_6px_0_oklch(0_0_0/0.35)]">
      <div className="flex items-center justify-between border-b border-card-border/60 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
        <span>Recovery codes</span>
        <span className="tabular-nums">{codes.length} issued</span>
      </div>
      <ol className="grid grid-cols-1 sm:grid-cols-2">
        {codes.map((c, i) => (
          <li
            key={c}
            className={cn(
              'flex items-center gap-3 px-3 py-2 font-mono text-sm tabular-nums tracking-[0.15em] text-stat-value',
              'border-t border-card-border/40',
              i < 2 && 'sm:border-t-0',
            )}
          >
            <span className="text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{c}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
