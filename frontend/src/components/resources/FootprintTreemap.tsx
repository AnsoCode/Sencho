import { ShieldCheck } from 'lucide-react';
import { formatBytes, cn } from '@/lib/utils';

export type TreemapFilter = 'managed' | 'unmanaged' | 'reclaimable';

interface FootprintTreemapProps {
  managedBytes: number;
  unmanagedBytes: number;
  reclaimableBytes: number;
  onFilter?: (filter: TreemapFilter) => void;
}

interface TileProps {
  label: string;
  bytes: number;
  share: number;
  tone: 'managed' | 'unmanaged' | 'reclaimable';
  onClick?: () => void;
  className?: string;
}

function Tile({ label, bytes, share, tone, onClick, className }: TileProps) {
  const toneBase = tone === 'managed'
    ? 'bg-success/[0.08] border-success/25 text-success'
    : tone === 'unmanaged'
      ? 'bg-warning/[0.08] border-warning/25 text-warning'
      : 'bg-muted/30 border-dashed border-border text-stat-subtitle';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'group relative flex flex-col justify-between rounded-md border p-3 text-left transition-colors',
        toneBase,
        onClick ? 'hover:bg-muted/20 cursor-pointer' : 'cursor-default',
        className,
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.22em]">{label}</span>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono tabular-nums text-xl leading-none text-stat-value">
          {formatBytes(bytes)}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-stat-subtitle">
          {share.toFixed(0)}% of footprint
        </span>
      </div>
    </button>
  );
}

export function FootprintTreemap({
  managedBytes,
  unmanagedBytes,
  reclaimableBytes,
  onFilter,
}: FootprintTreemapProps) {
  const total = managedBytes + unmanagedBytes + reclaimableBytes;

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-28 text-stat-subtitle text-sm gap-2">
        <ShieldCheck className="w-8 h-8 opacity-40" />
        <span>No disk usage data available.</span>
      </div>
    );
  }

  const share = (n: number) => (n / total) * 100;

  return (
    <div className="grid grid-cols-[2fr_1fr_1fr] grid-rows-2 gap-2 h-[150px]">
      <Tile
        label="Sencho managed"
        bytes={managedBytes}
        share={share(managedBytes)}
        tone="managed"
        onClick={onFilter ? () => onFilter('managed') : undefined}
        className="row-span-2"
      />
      <Tile
        label="External"
        bytes={unmanagedBytes}
        share={share(unmanagedBytes)}
        tone="unmanaged"
        onClick={onFilter ? () => onFilter('unmanaged') : undefined}
        className="col-span-2"
      />
      <Tile
        label="Reclaimable"
        bytes={reclaimableBytes}
        share={share(reclaimableBytes)}
        tone="reclaimable"
        onClick={onFilter ? () => onFilter('reclaimable') : undefined}
        className="col-span-2"
      />
    </div>
  );
}
