import type { ReactNode } from 'react';
import { Command } from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { NotificationItem } from '@/components/dashboard/types';
import { SidebarActions } from './SidebarActions';
import { SidebarActivityTicker } from './SidebarActivityTicker';
import { SidebarBrand } from './SidebarBrand';
import { SidebarSearch } from './SidebarSearch';
import { StackList, type StackListProps } from './StackList';

export interface StackSidebarProps {
  isDarkMode: boolean;
  nodeSwitcherSlot: ReactNode;
  createStackSlot: ReactNode | null;
  onScan: () => void;
  isScanning: boolean;
  canCreate: boolean;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  list: StackListProps;
  notifications: NotificationItem[];
  tickerConnected: boolean;
  onOpenActivity: () => void;
}

export function StackSidebar(props: StackSidebarProps) {
  const {
    isDarkMode, nodeSwitcherSlot, createStackSlot, onScan, isScanning, canCreate,
    searchQuery, onSearchChange, list, notifications, tickerConnected, onOpenActivity,
  } = props;

  return (
    <div className="w-64 border-r border-glass-border bg-sidebar backdrop-blur-md flex flex-col">
      <SidebarBrand isDarkMode={isDarkMode} />
      <div className="px-4 pt-2 pb-0">{nodeSwitcherSlot}</div>
      {canCreate && createStackSlot !== null && (
        <SidebarActions createStackSlot={createStackSlot} onScan={onScan} isScanning={isScanning} />
      )}
      <Command shouldFilter={false} className="bg-transparent flex-1 flex flex-col overflow-hidden">
        <SidebarSearch value={searchQuery} onValueChange={onSearchChange} />
        <ScrollArea className="flex-1 px-2 pb-2">
          <div data-stacks-loaded={list.isLoading ? 'false' : 'true'}>
            <StackList {...list} />
          </div>
        </ScrollArea>
      </Command>
      <SidebarActivityTicker
        notifications={notifications}
        connected={tickerConnected}
        onNavigate={onOpenActivity}
      />
    </div>
  );
}
