import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FolderSearch, Loader2 } from 'lucide-react';

interface SidebarActionsProps {
  createStackSlot: ReactNode;
  onScan: () => void;
  isScanning: boolean;
}

export function SidebarActions({ createStackSlot, onScan, isScanning }: SidebarActionsProps) {
  return (
    <div className="p-4 flex gap-2">
      <div className="flex-1">{createStackSlot}</div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="rounded-lg shrink-0 shadow-btn-glow"
              onClick={onScan}
              disabled={isScanning}
            >
              {isScanning
                ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                : <FolderSearch className="w-4 h-4" strokeWidth={1.5} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Scan stacks folder</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
