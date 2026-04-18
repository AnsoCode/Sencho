import { useMemo } from 'react';
import { cn } from '@/lib/utils';

export interface TabLandingEntry {
  key: string;
  primary: string;
  secondary: string;
}

interface LandingCardProps {
  label: string;
  subtitle?: string;
  entries: TabLandingEntry[];
  emptyLabel: string;
  onEntryClick?: (entry: TabLandingEntry) => void;
  accent?: 'brand' | 'warning';
}

function LandingCard({ label, subtitle, entries, emptyLabel, onEntryClick, accent = 'brand' }: LandingCardProps) {
  const accentClass = accent === 'warning' ? 'text-warning' : 'text-brand';
  return (
    <div className="flex flex-col rounded-md border border-card-border border-t-card-border-top bg-card shadow-card-bevel">
      <div className="flex items-baseline gap-2 px-3 pt-2.5 pb-1.5">
        <span className={cn('font-mono text-[10px] uppercase tracking-[0.22em]', accentClass)}>
          {label}
        </span>
        {subtitle ? (
          <span className="font-mono text-[10px] text-stat-subtitle">{subtitle}</span>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <div className="px-3 pb-3 text-[11px] font-mono text-stat-subtitle/80">
          {emptyLabel}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/40 px-1 pb-1">
          {entries.map(entry => (
            <li key={entry.key}>
              <button
                type="button"
                onClick={() => onEntryClick?.(entry)}
                disabled={!onEntryClick}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1 text-left transition-colors',
                  onEntryClick ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default',
                )}
              >
                <span className="truncate font-mono text-[11px] text-stat-value">{entry.primary}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-stat-subtitle">
                  {entry.secondary}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TabLandingProps {
  largestLabel?: string;
  largestSubtitle?: string;
  largestEntries: TabLandingEntry[];
  largestEmpty: string;
  recentLabel?: string;
  recentSubtitle?: string;
  recentEntries: TabLandingEntry[];
  recentEmpty: string;
  onLargestClick?: (entry: TabLandingEntry) => void;
  onRecentClick?: (entry: TabLandingEntry) => void;
}

export function TabLanding({
  largestLabel = 'Largest 5',
  largestSubtitle,
  largestEntries,
  largestEmpty,
  recentLabel = 'Recently changed',
  recentSubtitle,
  recentEntries,
  recentEmpty,
  onLargestClick,
  onRecentClick,
}: TabLandingProps) {
  const largestTop = useMemo(() => largestEntries.slice(0, 5), [largestEntries]);
  const recentTop = useMemo(() => recentEntries.slice(0, 5), [recentEntries]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 border-b">
      <LandingCard
        label={largestLabel}
        subtitle={largestSubtitle}
        entries={largestTop}
        emptyLabel={largestEmpty}
        onEntryClick={onLargestClick}
        accent="brand"
      />
      <LandingCard
        label={recentLabel}
        subtitle={recentSubtitle}
        entries={recentTop}
        emptyLabel={recentEmpty}
        onEntryClick={onRecentClick}
        accent="warning"
      />
    </div>
  );
}
