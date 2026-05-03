import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Terminal, CloudDownload, Home, HardDrive, ScrollText,
  Activity, Radar, RefreshCw, Clock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { SENCHO_NAVIGATE_EVENT } from '@/components/NodeManager';
import type { SenchoNavigateDetail } from '@/components/NodeManager';
import type { SectionId } from '@/components/settings/types';
import type { ScheduleTaskPrefill } from '@/components/ScheduledOperationsView';

export type ActiveView =
  | 'dashboard'
  | 'editor'
  | 'host-console'
  | 'resources'
  | 'templates'
  | 'global-observability'
  | 'fleet'
  | 'audit-log'
  | 'scheduled-ops'
  | 'auto-updates'
  | 'settings';

export interface NavItem {
  value: string;
  label: string;
  icon: LucideIcon;
}

interface UseViewNavigationStateOptions {
  onNavigateToDashboard?: () => void;
}

export function useViewNavigationState(options?: UseViewNavigationStateOptions) {
  const { onNavigateToDashboard } = options ?? {};
  const { isAdmin, can } = useAuth();
  const { isPaid, license } = useLicense();

  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [settingsSection, setSettingsSection] = useState<SectionId>('appearance');
  const [securityHistoryOpen, setSecurityHistoryOpen] = useState(false);
  const [filterNodeId, setFilterNodeId] = useState<number | null>(null);
  const [schedulePrefill, setSchedulePrefill] = useState<ScheduleTaskPrefill | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleOpenSettings = useCallback((section?: SectionId) => {
    if (section) setSettingsSection(section);
    setActiveView('settings');
    setFilterNodeId(null);
  }, []);

  const handlePrefillConsumed = useCallback(() => setSchedulePrefill(null), []);

  const handleNavigate = useCallback((value: string) => {
    if (value === activeView) return;
    if (value === 'dashboard') {
      onNavigateToDashboard?.();
      setActiveView('dashboard');
    } else {
      setActiveView(value as ActiveView);
      setFilterNodeId(null);
    }
  }, [activeView, onNavigateToDashboard]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SenchoNavigateDetail & { view: string }>).detail;
      if (!detail?.view) return;
      if (detail.view === 'security-history') {
        setSecurityHistoryOpen(true);
        setFilterNodeId(detail.nodeId ?? null);
        return;
      }
      setActiveView(detail.view as ActiveView);
      setFilterNodeId(detail.nodeId ?? null);
    };
    window.addEventListener(SENCHO_NAVIGATE_EVENT, handler);
    return () => window.removeEventListener(SENCHO_NAVIGATE_EVENT, handler);
  }, []);

  const navItems = useMemo((): NavItem[] => {
    const items: NavItem[] = [
      { value: 'dashboard', label: 'Home', icon: Home },
      { value: 'fleet', label: 'Fleet', icon: Radar },
      { value: 'resources', label: 'Resources', icon: HardDrive },
      { value: 'templates', label: 'App Store', icon: CloudDownload },
      { value: 'global-observability', label: 'Logs', icon: Activity },
    ];
    if (isPaid && isAdmin) {
      items.push({ value: 'auto-updates', label: 'Auto-Update', icon: RefreshCw });
    }
    if (isPaid && license?.variant === 'admiral') {
      if (isAdmin) items.push({ value: 'host-console', label: 'Console', icon: Terminal });
      if (can('system:audit')) items.push({ value: 'audit-log', label: 'Audit', icon: ScrollText });
      if (isAdmin) items.push({ value: 'scheduled-ops', label: 'Schedules', icon: Clock });
    }
    return items;
  }, [isAdmin, isPaid, license?.variant, can]);

  return {
    activeView, setActiveView,
    settingsSection, setSettingsSection,
    securityHistoryOpen, setSecurityHistoryOpen,
    filterNodeId, setFilterNodeId,
    schedulePrefill, setSchedulePrefill,
    mobileNavOpen, setMobileNavOpen,
    handleOpenSettings,
    handlePrefillConsumed,
    handleNavigate,
    navItems,
  } as const;
}
