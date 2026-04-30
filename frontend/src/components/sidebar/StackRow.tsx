import type { ReactNode } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import { Cursor, CursorContainer, CursorFollow, CursorProvider } from '@/components/animate-ui/primitives/animate/cursor';
import { LabelDot } from '@/components/LabelPill';
import type { Label } from '@/components/label-types';
import { cn } from '@/lib/utils';
import { sidebarRowActive, sidebarRowBase, sidebarRowCheckboxSlot } from './sidebar-styles';
import { statusText, statusColor } from './stack-status-utils';
import type { StackRowStatus } from './stack-status-utils';

interface StackRowProps {
  file: string;
  displayName: string;
  status: StackRowStatus;
  isBusy: boolean;
  isActive: boolean;
  isPaid: boolean;
  labels: Label[];
  hasUpdate: boolean;
  hasGitPending: boolean;
  onSelect: (file: string) => void;
  kebabSlot: ReactNode;
}

function RowTooltip({ trigger, label }: { trigger: ReactNode; label: string }) {
  return (
    <CursorProvider>
      <CursorContainer className="inline-flex items-center shrink-0">{trigger}</CursorContainer>
      <Cursor><div className="h-2 w-2 rounded-full bg-brand" /></Cursor>
      <CursorFollow side="bottom" sideOffset={4} align="center" transition={{ stiffness: 400, damping: 40, bounce: 0 }}>
        <div className="rounded-md border border-card-border bg-popover/95 backdrop-blur-[10px] backdrop-saturate-[1.15] px-2.5 py-1.5 shadow-md">
          <span className="font-mono text-xs tabular-nums text-stat-value">{label}</span>
        </div>
      </CursorFollow>
    </CursorProvider>
  );
}

const MAX_VISIBLE_LABELS = 3;

export function StackRow(props: StackRowProps) {
  const { file, displayName, status, isBusy, isActive, isPaid, labels, hasUpdate, hasGitPending, onSelect, kebabSlot } = props;

  const visibleLabels = isPaid ? labels.slice(0, MAX_VISIBLE_LABELS) : [];
  const overflowCount = isPaid ? Math.max(0, labels.length - MAX_VISIBLE_LABELS) : 0;

  return (
    <div
      data-testid="stack-row"
      role="button"
      tabIndex={0}
      className={cn(sidebarRowBase, isActive && sidebarRowActive)}
      onClick={() => onSelect(file)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(file); } }}
    >
      {/* Reserved checkbox slot — revealed in bulk mode (PR2) */}
      <span className={sidebarRowCheckboxSlot} aria-hidden="true" />

      {/* Status pill */}
      <span className={cn('font-mono text-[10px] shrink-0 w-[22px] flex items-center', statusColor(status, isBusy))}>
        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} /> : statusText(status)}
      </span>

      {/* Stack name */}
      <span className="flex-1 truncate font-mono text-[13px] min-w-0">{displayName}</span>

      {/* Trailing: label dots (max 3 + overflow count) */}
      {visibleLabels.length > 0 && (
        <span className="flex items-center gap-0.5 shrink-0">
          {visibleLabels.map(l => <LabelDot key={l.id} color={l.color} />)}
          {overflowCount > 0 && (
            <span className="font-mono text-[8px] text-stat-icon leading-none">+{overflowCount}</span>
          )}
        </span>
      )}

      {/* Fixed trailing icon slot: update dot takes priority over git pending */}
      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
        {hasUpdate ? (
          <RowTooltip
            trigger={(
              <span className="relative inline-flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-update opacity-75 animate-ping" />
                <span className="relative w-2 h-2 rounded-full bg-update" />
              </span>
            )}
            label="Update available"
          />
        ) : hasGitPending ? (
          <RowTooltip
            trigger={<GitBranch className="w-3 h-3 text-brand" strokeWidth={1.5} />}
            label="Git source update pending"
          />
        ) : null}
      </span>

      {/* Kebab — always rightmost */}
      <div
        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {kebabSlot}
      </div>
    </div>
  );
}
