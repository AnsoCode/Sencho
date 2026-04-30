import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TierBadge } from '@/components/TierBadge';
import type { BulkAction } from '@/hooks/useBulkStackActions';

interface SidebarBulkBarProps {
  selectedCount: number;
  isPaid: boolean;
  onAction: (action: BulkAction) => void;
  onClear: () => void;
}

export function SidebarBulkBar({ selectedCount, isPaid, onAction, onClear }: SidebarBulkBarProps) {
  return (
    <div className="px-3 py-2 border-b border-glass-border bg-glass-highlight/20">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[10px] text-brand tracking-[0.08em]">{selectedCount} selected</span>
        <button
          type="button"
          onClick={onClear}
          className="text-stat-icon hover:text-foreground transition-colors"
          aria-label="Clear selection"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex gap-1 flex-wrap">
        <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] font-mono" onClick={() => onAction('start')}>Start</Button>
        <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] font-mono" onClick={() => onAction('stop')}>Stop</Button>
        <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] font-mono" onClick={() => onAction('restart')}>Restart</Button>
        {isPaid ? (
          <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] font-mono" onClick={() => onAction('update')}>Update</Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] font-mono gap-1 pointer-events-none opacity-60" disabled>
                    Update
                    <TierBadge tier="paid" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Bulk update requires a Skipper license</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}
