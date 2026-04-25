import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { BellRing, Trash2 } from 'lucide-react';
import { useStackMenuItems } from '../useStackMenuItems';
import type { StackMenuCtx } from '@/components/sidebar/sidebar-types';

function makeCtx(overrides: Partial<StackMenuCtx> = {}): StackMenuCtx {
  return {
    stackStatus: 'running',
    hasPort: true,
    isBusy: false,
    isPaid: true,
    isAdmiral: false,
    canDelete: true,
    isPinned: false,
    labels: [],
    assignedLabelIds: [],
    menuVisibility: { showDeploy: false, showStop: true, showRestart: true, showUpdate: false },
    autoUpdateEnabled: true,
    openAlertSheet: vi.fn(),
    openAutoHeal: vi.fn(),
    checkUpdates: vi.fn(),
    openStackApp: vi.fn(),
    deploy: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn(),
    toggleLabel: vi.fn(),
    createAndAssignLabel: vi.fn(),
    openLabelManager: vi.fn(),
    setAutoUpdateEnabled: vi.fn(),
    ...overrides,
  };
}

describe('useStackMenuItems', () => {
  it('returns Inspect / Organize / Lifecycle / Destructive groups in order', () => {
    const { result } = renderHook(() => useStackMenuItems('web.yml', makeCtx()));
    expect(result.current.map(g => g.id)).toEqual(['inspect', 'organize', 'lifecycle', 'destructive']);
  });

  it('always includes Alerts in Inspect', () => {
    const { result } = renderHook(() => useStackMenuItems('web.yml', makeCtx()));
    const inspect = result.current.find(g => g.id === 'inspect')!;
    expect(inspect.items.some(i => i.icon === BellRing)).toBe(true);
  });

  it('hides Auto-Heal when !isPaid', () => {
    const { result } = renderHook(() => useStackMenuItems('web.yml', makeCtx({ isPaid: false })));
    const inspect = result.current.find(g => g.id === 'inspect')!;
    expect(inspect.items.find(i => i.id === 'auto-heal')).toBeUndefined();
  });

  it('hides Open App unless running + hasPort', () => {
    const { result } = renderHook(() => useStackMenuItems('web.yml', makeCtx({ stackStatus: 'exited' })));
    const inspect = result.current.find(g => g.id === 'inspect')!;
    expect(inspect.items.find(i => i.id === 'open-app')).toBeUndefined();
  });

  it('toggles Pin / Unpin label based on isPinned', () => {
    const pinned = renderHook(() => useStackMenuItems('web.yml', makeCtx({ isPinned: true })));
    const unpinned = renderHook(() => useStackMenuItems('web.yml', makeCtx({ isPinned: false })));
    const pinnedOrganize = pinned.result.current.find(g => g.id === 'organize')!;
    const unpinnedOrganize = unpinned.result.current.find(g => g.id === 'organize')!;
    expect(pinnedOrganize.items.find(i => i.id === 'pin')!.label).toBe('Unpin');
    expect(unpinnedOrganize.items.find(i => i.id === 'pin')!.label).toBe('Pin to top');
  });

  it('omits Destructive group entirely when !canDelete', () => {
    const { result } = renderHook(() => useStackMenuItems('web.yml', makeCtx({ canDelete: false })));
    expect(result.current.find(g => g.id === 'destructive')).toBeUndefined();
  });

  it('marks Delete item destructive with Trash2 icon', () => {
    const { result } = renderHook(() => useStackMenuItems('web.yml', makeCtx()));
    const destructive = result.current.find(g => g.id === 'destructive')!;
    const del = destructive.items.find(i => i.id === 'delete')!;
    expect(del.destructive).toBe(true);
    expect(del.icon).toBe(Trash2);
  });

  it('lifecycle items follow menuVisibility flags', () => {
    const { result } = renderHook(() => useStackMenuItems('web.yml', makeCtx({
      menuVisibility: { showDeploy: true, showStop: false, showRestart: false, showUpdate: true },
    })));
    const lifecycle = result.current.find(g => g.id === 'lifecycle')!;
    const ids = lifecycle.items.map(i => i.id);
    expect(ids).toEqual(['deploy', 'update']);
  });

  it('shows auto-update toggle in inspect when isPaid', () => {
    const { result } = renderHook(() => useStackMenuItems('web.yml', makeCtx({ isPaid: true, autoUpdateEnabled: true })));
    const inspect = result.current.find(g => g.id === 'inspect')!;
    expect(inspect.items.find(i => i.id === 'auto-update')).toBeDefined();
  });

  it('hides auto-update toggle when !isPaid', () => {
    const { result } = renderHook(() => useStackMenuItems('web.yml', makeCtx({ isPaid: false })));
    const inspect = result.current.find(g => g.id === 'inspect')!;
    expect(inspect.items.find(i => i.id === 'auto-update')).toBeUndefined();
  });

  it('auto-update toggle calls setAutoUpdateEnabled with toggled value', () => {
    const setAutoUpdateEnabled = vi.fn();
    const { result } = renderHook(() =>
      useStackMenuItems('web.yml', makeCtx({ isPaid: true, autoUpdateEnabled: true, setAutoUpdateEnabled }))
    );
    const inspect = result.current.find(g => g.id === 'inspect')!;
    inspect.items.find(i => i.id === 'auto-update')!.onSelect();
    expect(setAutoUpdateEnabled).toHaveBeenCalledWith(false);
  });

  it('disables every lifecycle item when isBusy', () => {
    const { result } = renderHook(() => useStackMenuItems('web.yml', makeCtx({
      isBusy: true,
      menuVisibility: { showDeploy: true, showStop: true, showRestart: true, showUpdate: true },
    })));
    const lifecycle = result.current.find(g => g.id === 'lifecycle')!;
    expect(lifecycle.items.every(i => i.disabled === true)).toBe(true);
  });
});
