import type { LucideIcon } from 'lucide-react';
import type { Label, LabelColor } from '../label-types';

export type MenuGroupId = 'inspect' | 'organize' | 'lifecycle' | 'destructive';

export interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  subItems?: MenuItem[];
}

export interface MenuGroup {
  id: MenuGroupId;
  items: MenuItem[];
}

export type StackLifecycleStatus = 'running' | 'exited' | 'unknown';

export interface StackMenuCtx {
  stackStatus: StackLifecycleStatus;
  hasPort: boolean;
  isBusy: boolean;
  isPaid: boolean;
  // isAdmiral: plumbed now so Admiral-specific menu items can be added in a
  // follow-up PR without changing this interface. No Admiral-only items ship
  // in the current PR; the auto-update toggle is Skipper+, gated on isPaid.
  isAdmiral: boolean;
  canDelete: boolean;
  isPinned: boolean;
  labels: Label[];
  assignedLabelIds: number[];
  menuVisibility: { showDeploy: boolean; showStop: boolean; showRestart: boolean; showUpdate: boolean };
  autoUpdateEnabled: boolean;
  openAlertSheet: () => void;
  openAutoHeal: () => void;
  checkUpdates: () => void;
  openStackApp: () => void;
  deploy: () => void;
  stop: () => void;
  restart: () => void;
  update: () => void;
  remove: () => void;
  pin: () => void;
  unpin: () => void;
  toggleLabel: (labelId: number) => void;
  createAndAssignLabel: (name: string, color: LabelColor) => Promise<void>;
  openLabelManager: () => void;
  setAutoUpdateEnabled: (enabled: boolean) => void;
}

export type StackGroupKind = 'pinned' | 'labeled' | 'unlabeled';
