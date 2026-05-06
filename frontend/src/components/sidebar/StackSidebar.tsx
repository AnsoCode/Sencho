import { useState, useCallback, type ReactNode } from 'react';
import { Command } from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { NotificationItem } from '@/components/dashboard/types';
import { SidebarActions } from './SidebarActions';
import { SidebarActivityTicker } from './SidebarActivityTicker';
import { SidebarBrand } from './SidebarBrand';
import { SidebarBulkBar } from './SidebarBulkBar';
import { SidebarFilterChips, type FilterCounts } from './SidebarFilterChips';
import { SidebarSearch } from './SidebarSearch';
import { StackList, type StackListProps } from './StackList';
import type { FilterChip } from './sidebar-types';
import type { BulkAction } from '@/hooks/useBulkStackActions';

export interface StackSidebarProps {
  isDarkMode: boolean;
  nodeSwitcherSlot: ReactNode;
  createStackSlot: ReactNode | null;
  onScan: () => void;
  isScanning: boolean;
  canCreate: boolean;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  filterChip: FilterChip;
  filterCounts: FilterCounts;
  onFilterChipChange: (chip: FilterChip) => void;
  list: StackListProps;
  notifications: NotificationItem[];
  tickerConnected: boolean;
  onOpenActivity: () => void;
  bulkMode: boolean;
  selectedFiles: Set<string>;
  isPaid: boolean;
  onToggleBulkMode: () => void;
  onToggleSelect: (file: string) => void;
  onClearSelection: () => void;
  onBulkAction: (action: BulkAction) => void;
}

export function StackSidebar(props: StackSidebarProps) {
  const {
    isDarkMode, nodeSwitcherSlot, createStackSlot, onScan, isScanning, canCreate,
    searchQuery, onSearchChange, filterChip, filterCounts, onFilterChipChange,
    list, notifications, tickerConnected, onOpenActivity,
    bulkMode, selectedFiles, isPaid, onToggleBulkMode, onToggleSelect, onClearSelection, onBulkAction,
  } = props;

  const [filtersVisible, setFiltersVisible] = useState(() => {
    try {
      const v = window.localStorage.getItem('sencho:sidebar:filters-visible');
      return v === null ? true : v !== 'false';
    } catch { return true; }
  });

  const handleToggleFilters = useCallback(() => {
    setFiltersVisible(prev => {
      const next = !prev;
      try { window.localStorage.setItem('sencho:sidebar:filters-visible', String(next)); } catch {}
      return next;
    });
  }, []);

  return (
    <div className="w-64 border-r border-glass-border bg-sidebar backdrop-blur-md flex flex-col">
      <SidebarBrand isDarkMode={isDarkMode} />
      <div className="px-4 pt-2 pb-0">{nodeSwitcherSlot}</div>
      {canCreate && createStackSlot !== null && (
        <SidebarActions
          createStackSlot={createStackSlot}
          onScan={onScan}
          isScanning={isScanning}
          bulkMode={bulkMode}
          onToggleBulkMode={onToggleBulkMode}
        />
      )}
      <Command shouldFilter={false} className="bg-transparent flex-1 flex flex-col overflow-hidden">
        <SidebarSearch value={searchQuery} onValueChange={onSearchChange} />
        <SidebarFilterChips
          active={filterChip}
          counts={filterCounts}
          onChange={onFilterChipChange}
          visible={filtersVisible}
          onToggle={handleToggleFilters}
        />
        {selectedFiles.size > 0 && (
          <SidebarBulkBar
            selectedCount={selectedFiles.size}
            isPaid={isPaid}
            onAction={onBulkAction}
            onClear={onClearSelection}
          />
        )}
        <ScrollArea className="flex-1 px-2 pb-2">
          <div data-stacks-loaded={list.isLoading ? 'false' : 'true'}>
            <StackList {...list} bulkMode={bulkMode} selectedFiles={selectedFiles} onToggleSelect={onToggleSelect} />
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
