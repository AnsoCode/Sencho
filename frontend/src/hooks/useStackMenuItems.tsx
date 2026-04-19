import { useMemo } from 'react';
import {
  Activity,
  ArrowUpRight,
  BellRing,
  Download,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Tag,
  Trash2,
} from 'lucide-react';
import type { MenuGroup, MenuItem, StackMenuCtx } from '@/components/sidebar/sidebar-types';

export function useStackMenuItems(file: string, ctx: StackMenuCtx): MenuGroup[] {
  const { showDeploy, showStop, showRestart, showUpdate } = ctx.menuVisibility;
  return useMemo(() => {
    const groups: MenuGroup[] = [];

    const inspect: MenuItem[] = [
      { id: 'alerts', label: 'Alerts', icon: BellRing, shortcut: 'A', onSelect: ctx.openAlertSheet },
    ];
    if (ctx.isPaid) {
      inspect.push({ id: 'auto-heal', label: 'Auto-Heal', icon: Activity, shortcut: 'H', onSelect: ctx.openAutoHeal });
    }
    inspect.push({ id: 'check-updates', label: 'Check updates', icon: RefreshCw, shortcut: 'U', onSelect: ctx.checkUpdates });
    if (ctx.stackStatus === 'running' && ctx.hasPort) {
      inspect.push({ id: 'open-app', label: 'Open App', icon: ArrowUpRight, shortcut: '↗', onSelect: ctx.openStackApp });
    }
    groups.push({ id: 'inspect', items: inspect });

    const organize: MenuItem[] = [];
    if (ctx.isPaid) {
      organize.push({
        id: 'labels',
        label: 'Labels',
        icon: Tag,
        shortcut: 'L ›',
        onSelect: () => {},
        subItems: ctx.labels.map(l => ({
          id: `label:${l.id}`,
          label: l.name,
          icon: Tag,
          onSelect: () => ctx.toggleLabel(l.id),
        })),
      });
    }
    organize.push(
      ctx.isPinned
        ? { id: 'pin', label: 'Unpin', icon: PinOff, shortcut: 'P', onSelect: ctx.unpin }
        : { id: 'pin', label: 'Pin to top', icon: Pin, shortcut: 'P', onSelect: ctx.pin }
    );
    groups.push({ id: 'organize', items: organize });

    const lifecycle: MenuItem[] = [];
    if (showDeploy) lifecycle.push({ id: 'deploy', label: 'Deploy', icon: Play, shortcut: '⌘↵', onSelect: ctx.deploy, disabled: ctx.isBusy });
    if (showStop) lifecycle.push({ id: 'stop', label: 'Stop', icon: Square, shortcut: '⌘.', onSelect: ctx.stop, disabled: ctx.isBusy });
    if (showRestart) lifecycle.push({ id: 'restart', label: 'Restart', icon: RotateCw, shortcut: '⌘R', onSelect: ctx.restart, disabled: ctx.isBusy });
    if (showUpdate) lifecycle.push({ id: 'update', label: 'Update', icon: Download, shortcut: '⌘↑', onSelect: ctx.update, disabled: ctx.isBusy });
    if (lifecycle.length > 0) groups.push({ id: 'lifecycle', items: lifecycle });

    if (ctx.canDelete) {
      groups.push({
        id: 'destructive',
        items: [{ id: 'delete', label: 'Delete', icon: Trash2, shortcut: '⌘⌫', destructive: true, onSelect: ctx.remove }],
      });
    }

    return groups;
  }, [
    file,
    ctx.stackStatus,
    ctx.hasPort,
    ctx.isBusy,
    ctx.isPaid,
    ctx.canDelete,
    ctx.isPinned,
    ctx.labels,
    showDeploy,
    showStop,
    showRestart,
    showUpdate,
    ctx.openAlertSheet,
    ctx.openAutoHeal,
    ctx.checkUpdates,
    ctx.openStackApp,
    ctx.deploy,
    ctx.stop,
    ctx.restart,
    ctx.update,
    ctx.remove,
    ctx.pin,
    ctx.unpin,
    ctx.toggleLabel,
  ]);
}
