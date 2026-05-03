import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';

type Theme = 'light' | 'dark' | 'auto';
import { useImageUpdates } from '@/hooks/useImageUpdates';
import type { NotificationItem } from './dashboard/types';
import BashExecModal from './BashExecModal';
import LazyBoundary from './LazyBoundary';
import { Button } from './ui/button';
import { Plus, Terminal, CloudDownload, Home, HardDrive, ScrollText, Activity, Radar, RefreshCw, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { type Label as StackLabel, type LabelColor } from './label-types';
import { UserProfileDropdown } from './UserProfileDropdown';
import { NotificationPanel } from './NotificationPanel';
import { apiFetch, fetchForNode } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { PolicyBlockDialog, type PolicyBlockPayload } from './stack/PolicyBlockDialog';
import { TopBar } from './TopBar';
import type { SectionId } from './settings/types';
import { ViewRouter } from './EditorLayout/ViewRouter';
import { CreateStackDialog } from './EditorLayout/CreateStackDialog';
import { DeleteStackDialog } from './EditorLayout/DeleteStackDialog';
import { UnsavedChangesDialog } from './EditorLayout/UnsavedChangesDialog';
import { EditorView, type ContainerInfo, type StackAction } from './EditorLayout/EditorView';
import { StackAlertSheet } from './StackAlertSheet';
import { StackAutoHealSheet } from '@/components/StackAutoHealSheet';
import { GitSourcePanel } from './stack/GitSourcePanel';
import { LogViewer } from './LogViewer';
import type { ScheduleTaskPrefill } from './ScheduledOperationsView';

// SecurityHistoryView is the only lazy-loaded view that lives outside
// the ViewRouter switch — it renders as an overlay sheet wired into the
// settings flow, not as a top-level tab. The other tab-level lazy views
// (HostConsole, FleetView, AuditLogView, etc.) live inside ViewRouter.
const SecurityHistoryView = lazy(() =>
    import('./SecurityHistoryView').then(m => ({ default: m.SecurityHistoryView })),
);
import { SENCHO_NAVIGATE_EVENT } from './NodeManager';
import type { SenchoNavigateDetail } from './NodeManager';
import { NodeSwitcher } from './NodeSwitcher';
import {
    GlobalCommandPalette,
    GlobalCommandPaletteProvider,
    GlobalCommandPaletteTrigger,
} from './GlobalCommandPalette';
import { useCrossNodeStackSearch } from '@/hooks/useCrossNodeStackSearch';
import { SENCHO_OPEN_LOGS_EVENT, SENCHO_LABELS_CHANGED } from '@/lib/events';
import type { SenchoOpenLogsDetail } from '@/lib/events';
import { useNodes } from '@/context/NodeContext';
import type { Node } from '@/context/NodeContext';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { useDeployFeedback } from '@/context/DeployFeedbackContext';
import { useTrivyStatus } from '@/hooks/useTrivyStatus';
import { VulnerabilityScanSheet } from './VulnerabilityScanSheet';
import { StackSidebar } from '@/components/sidebar/StackSidebar';
import { usePinnedStacks } from '@/hooks/usePinnedStacks';
import { useSidebarGroupCollapse } from '@/hooks/useSidebarGroupCollapse';
import type { StackRowStatus } from '@/components/sidebar/stack-status-utils';
import type { FilterChip, StackMenuCtx } from '@/components/sidebar/sidebar-types';
import { useBulkStackActions, type BulkAction } from '@/hooks/useBulkStackActions';
import { isInputFocused, isPaletteOpen } from '@/lib/keyboard-guards';
import { useComposeDiffPreviewEnabled } from '@/hooks/use-compose-diff-preview-enabled';
import { ComposeDiffPreviewDialog } from '@/components/ComposeDiffPreviewDialog';

interface StackStatus {
  [key: string]: 'running' | 'exited' | 'unknown';
}

interface StackStatusInfo {
  status: 'running' | 'exited' | 'unknown';
  mainPort?: number;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function EditorLayout() {
  const { isAdmin, can } = useAuth();
  const { isPaid, license } = useLicense();
  const { status: trivy } = useTrivyStatus();
  const { runWithLog } = useDeployFeedback();
  const [stackMisconfigScanning, setStackMisconfigScanning] = useState(false);
  const [stackMisconfigScanId, setStackMisconfigScanId] = useState<number | null>(null);
  const [policyBlock, setPolicyBlock] = useState<{ stackName: string; payload: PolicyBlockPayload } | null>(null);
  const [policyBypassing, setPolicyBypassing] = useState(false);
  const [copiedDigest, setCopiedDigest] = useState<string | null>(null);
  const copiedDigestTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (copiedDigestTimerRef.current !== null) {
        window.clearTimeout(copiedDigestTimerRef.current);
      }
    };
  }, []);
  const { nodes, activeNode, setActiveNode } = useNodes();
  // Stable ref so notification callbacks always read the latest nodes list
  // without needing nodes in their dependency arrays (which would cause loops).
  const nodesRef = useRef<Node[]>([]);
  nodesRef.current = nodes;
  // Tracks cleanup functions for per-remote-node notification WebSocket connections.
  const remoteNotifWsRef = useRef<Map<number, () => void>>(new Map());
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [envContent, setEnvContent] = useState<string>('');
  const [originalEnvContent, setOriginalEnvContent] = useState<string>('');
  const [envExists, setEnvExists] = useState<boolean>(false);
  const [envFiles, setEnvFiles] = useState<string[]>([]);
  const [selectedEnvFile, setSelectedEnvFile] = useState<string>('');
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [containerStats, setContainerStats] = useState<Record<string, {
    cpu: string;
    ram: string;
    net: string;
    lastRx?: number;
    lastTx?: number;
    history: { cpu: number[]; mem: number[]; netIn: number[]; netOut: number[] };
  }>>({});
  // Incoming WebSocket stats are written here first (no re-render), then flushed
  // to React state in one batched update every 1.5 s.
  const pendingStatsRef = useRef<Record<string, {
    cpu: string;
    ram: string;
    net: string;
    lastRx: number;
    lastTx: number;
    cpuNum: number;
    memNum: number;
    netInNum: number;
    netOutNum: number;
  }>>({});
  // Raw rx/tx byte totals used for rate calculation. Never cleared on flush so
  // the delta is always computed against the most recent known value, avoiding
  // the stale-closure bug that occurs when reading containerStats directly.
  const rawBytesRef = useRef<Record<string, { lastRx: number; lastTx: number }>>({});
  const [activeTab, setActiveTab] = useState<'compose' | 'env' | 'files'>('compose');
  const [logsMode, setLogsMode] = useState<'structured' | 'raw'>(() => {
    if (typeof window === 'undefined') return 'structured';
    return (localStorage.getItem('sencho.stackView.logsMode') as 'structured' | 'raw' | null) ?? 'structured';
  });
  useEffect(() => {
    try { localStorage.setItem('sencho.stackView.logsMode', logsMode); } catch { /* ignore */ }
  }, [logsMode]);
  const [gitSourceOpen, setGitSourceOpen] = useState(false);
  const [gitSourcePendingMap, setGitSourcePendingMap] = useState<Record<string, boolean>>({});
  const monacoEditorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);
  const pendingStackLoadRef = useRef<string | null>(null);
  const pendingLogsRef = useRef<{ stackName: string; containerName: string } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [stackToDelete, setStackToDelete] = useState<string | null>(null);
  const [pendingUnsavedLoad, setPendingUnsavedLoad] = useState<string | null>(null);
  const [pendingUnsavedNode, setPendingUnsavedNode] = useState<Node | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [stackActions, setStackActions] = useState<Record<string, StackAction>>({});
  const stackActionsRef = useRef<Record<string, StackAction>>({});
  stackActionsRef.current = stackActions;

  const setStackAction = (stackFile: string, action: StackAction) => {
    setStackActions(prev => ({ ...prev, [stackFile]: action }));
  };
  const clearStackAction = (stackFile: string) => {
    setStackActions(prev => {
      const next = { ...prev };
      delete next[stackFile];
      return next;
    });
  };
  const isStackBusy = (stackFile: string) => stackFile in stackActions;

  const getStackMenuVisibility = (file: string) => {
    const status = stackStatuses[file];
    return {
      showDeploy: status !== 'running',
      showStop: status === 'running',
      showRestart: status === 'running',
      showUpdate: status === 'running',
    };
  };

  const openStackApp = (file: string) => {
    const port = stackPorts[file];
    if (!port) return;
    const host = activeNode?.type === 'remote' && activeNode?.api_url
      ? new URL(activeNode.api_url).hostname
      : window.location.hostname;
    window.open(`http://${host}:${port}`, '_blank');
  };

  const loadingAction = selectedFile ? (stackActions[selectedFile] ?? null) : null;

  const [isScanning, setIsScanning] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [backupInfo, setBackupInfo] = useState<{ exists: boolean; timestamp: number | null }>({ exists: false, timestamp: null });
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('sencho-theme') as Theme | null;
    if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved;
    return 'dark'; // Default to dark mode
  });
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const isDarkMode = theme === 'dark' || (theme === 'auto' && systemDark);
  const [diffPreviewEnabled] = useComposeDiffPreviewEnabled();
  const [activeView, setActiveView] = useState<'dashboard' | 'editor' | 'host-console' | 'resources' | 'templates' | 'global-observability' | 'fleet' | 'audit-log' | 'scheduled-ops' | 'auto-updates' | 'settings'>('dashboard');
  const [settingsSection, setSettingsSection] = useState<SectionId>('appearance');
  const [securityHistoryOpen, setSecurityHistoryOpen] = useState(false);
  const [filterNodeId, setFilterNodeId] = useState<number | null>(null);
  const [schedulePrefill, setSchedulePrefill] = useState<ScheduleTaskPrefill | null>(null);
  const handlePrefillConsumed = useCallback(() => setSchedulePrefill(null), []);
  const [isEditing, setIsEditing] = useState(false);
  const [diffPreview, setDiffPreview] = useState<{
    mode: 'save' | 'save-and-deploy';
    language: 'yaml' | 'ini';
    original: string;
    modified: string;
    fileName: string;
  } | null>(null);
  const [diffPreviewConfirming, setDiffPreviewConfirming] = useState(false);
  const [editingCompose, setEditingCompose] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stackStatuses, setStackStatuses] = useState<StackStatus>({});
  const [stackPorts, setStackPorts] = useState<Record<string, number | undefined>>({});
  const [labels, setLabels] = useState<StackLabel[]>([]);
  const [stackLabelMap, setStackLabelMap] = useState<Record<string, StackLabel[]>>({});

  // Bash exec modal state
  const [bashModalOpen, setBashModalOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<{ id: string; name: string } | null>(null);

  // LogViewer state
  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [logContainer, setLogContainer] = useState<{ id: string; name: string } | null>(null);


  // Image update checker state
  const { stackUpdates, refresh: fetchImageUpdates } = useImageUpdates(activeNode?.id);
  const [autoUpdateSettings, setAutoUpdateSettings] = useState<Record<string, boolean>>({});
  const isAdmiral = license?.variant === 'admiral';

  const handleOpenSettings = useCallback((section?: SectionId) => {
    if (section) setSettingsSection(section);
    setActiveView('settings');
    setFilterNodeId(null);
  }, []);

  // Notifications state
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [tickerConnected, setTickerConnected] = useState(false);
  const [alertSheetOpen, setAlertSheetOpen] = useState(false);
  const [alertSheetStack, setAlertSheetStack] = useState('');
  const [autoHealStackName, setAutoHealStackName] = useState<string | null>(null);

  // Mobile navigation sheet state
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const openAlertSheet = (stackName: string) => {
    setAlertSheetStack(stackName);
    setAlertSheetOpen(true);
  };

  // Navigation items (permission-aware, data-driven)
  const navItems = useMemo(() => {
    const items: Array<{ value: string; label: string; icon: LucideIcon }> = [
      { value: 'dashboard', label: 'Home', icon: Home },
      { value: 'fleet', label: 'Fleet', icon: Radar },
    ];
    items.push(
      { value: 'resources', label: 'Resources', icon: HardDrive },
      { value: 'templates', label: 'App Store', icon: CloudDownload },
      { value: 'global-observability', label: 'Logs', icon: Activity },
    );
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

  // Reset editor state (extracted from Home button onClick)
  const resetEditorState = () => {
    setSelectedFile(null);
    setContent('');
    setOriginalContent('');
    setEnvContent('');
    setOriginalEnvContent('');
    setEnvFiles([]);
    setSelectedEnvFile('');
    setEnvExists(false);
    setContainers([]);
    setIsEditing(false);
  };

  const handleNavigate = (value: string) => {
    if (value === activeView) return;
    if (value === 'dashboard') {
      resetEditorState();
      setActiveView('dashboard');
    } else {
      setActiveView(value as typeof activeView);
      setFilterNodeId(null);
    }
  };

  // Listen for system dark mode changes (for 'auto' theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Apply dark class and persist theme preference
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('sencho-theme', theme);
  }, [isDarkMode, theme]);

  // Listen for cross-component navigation (e.g., NodeManager → Schedules)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SenchoNavigateDetail>).detail;
      if (!detail?.view) return;
      if (detail.view === 'security-history') {
        setSecurityHistoryOpen(true);
        setFilterNodeId(detail.nodeId ?? null);
        return;
      }
      setActiveView(detail.view);
      setFilterNodeId(detail.nodeId ?? null);
    };
    window.addEventListener(SENCHO_NAVIGATE_EVENT, handler);
    return () => window.removeEventListener(SENCHO_NAVIGATE_EVENT, handler);
  }, []);

  // Fan out stack search across other online nodes so the sidebar can surface matches from the whole fleet.
  const { hits: remoteSearchHits, loading: remoteSearchLoading } = useCrossNodeStackSearch({
    query: searchQuery,
    enabled: true,
    excludeNodeId: activeNode?.id,
  });
  const remoteStackResults = useMemo(() => {
    const out: Record<number, Array<{ file: string; status: 'running' | 'exited' | 'unknown' }>> = {};
    for (const hit of remoteSearchHits) {
      (out[hit.nodeId] ??= []).push({ file: hit.file, status: hit.status });
    }
    return out;
  }, [remoteSearchHits]);

  // Force Monaco to re-measure its container after the tab switch DOM settles.
  // Monaco's internal child is position:static with an explicit pixel height that
  // creates a circular CSS dependency (Monaco drives card height → grid height → Monaco).
  // Fix: reset Monaco to 0×0 first (breaks the cycle), then trigger a forced synchronous
  // reflow so the container has its CSS-correct size before Monaco re-measures.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const editor = monacoEditorRef.current;
      if (!editor) return;
      editor.layout({ width: 0, height: 0 }); // collapse → breaks CSS circular dependency
      editor.layout();                          // forced reflow → measures correct container size
    });
    return () => cancelAnimationFrame(id);
  }, [activeTab]);

  const refreshStacks = async (background = false): Promise<string[]> => {
    if (!background) setIsLoading(true);
    try {
      const res = await apiFetch('/stacks');
      if (!res.ok) {
        setFiles([]);
        return [];
      }
      const data = await res.json();
      const fileList: string[] = Array.isArray(data) ? data : [];
      setFiles(fileList);

      // Fetch all stack statuses in a single bulk call (falls back to per-stack queries for older remote nodes)
      const statusRes = await apiFetch('/stacks/statuses');
      let bulkStatuses: Record<string, 'running' | 'exited' | 'unknown'> | null = null;
      const bulkPorts: Record<string, number | undefined> = {};
      if (statusRes.ok) {
        const raw = await statusRes.json();
        bulkStatuses = {};
        // Handle both old format (plain string) and new format ({ status, mainPort })
        for (const [key, val] of Object.entries(raw)) {
          if (typeof val === 'string') {
            bulkStatuses[key] = val as 'running' | 'exited' | 'unknown';
          } else if (val && typeof val === 'object' && 'status' in val) {
            const info = val as StackStatusInfo;
            bulkStatuses[key] = info.status;
            if (info.mainPort) bulkPorts[key] = info.mainPort;
          }
        }
      } else {
        // Fallback: query each stack individually (remote node may not have bulk endpoint)
        const statusResults = await Promise.allSettled(
          fileList.map(async (file) => {
            const containersRes = await apiFetch(`/stacks/${file}/containers`);
            if (!containersRes.ok) return { file, status: 'unknown' as const };
            const containers = await containersRes.json();
            const hasRunning = Array.isArray(containers) && containers.some((c: ContainerInfo) => c.State === 'running');
            return { file, status: hasRunning ? 'running' as const : (Array.isArray(containers) && containers.length > 0 ? 'exited' as const : 'unknown' as const) };
          })
        );
        bulkStatuses = {};
        for (const result of statusResults) {
          if (result.status === 'fulfilled') {
            bulkStatuses[result.value.file] = result.value.status;
          }
        }
      }
      setStackStatuses(prev => {
        const next: StackStatus = {};
        for (const file of fileList) {
          const status = bulkStatuses?.[file] ?? 'unknown';
          next[file] = (file in stackActionsRef.current) ? (prev[file] ?? status) : status;
        }
        return next;
      });
      setStackPorts(prev => {
        const keys = Object.keys(bulkPorts);
        if (keys.length === Object.keys(prev).length && keys.every(k => prev[k] === bulkPorts[k])) return prev;
        return bulkPorts;
      });
      refreshLabels();
      return fileList;
    } catch (error) {
      console.error('Failed to refresh stacks:', error);
      setFiles([]);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const setOptimisticStatus = (stackFile: string, status: 'running' | 'exited') => {
    setStackStatuses(prev => ({ ...prev, [stackFile]: status }));
  };

  // Stable identity required: captured by buildMenuCtx's memoization and passed as a prop; unstable refs cause descendant re-render churn.
  const refreshLabels = useCallback(async () => {
    if (!isPaid) return;
    try {
      const [labelsRes, assignmentsRes] = await Promise.all([
        apiFetch('/labels'),
        apiFetch('/labels/assignments'),
      ]);
      if (labelsRes.ok) setLabels(await labelsRes.json());
      if (assignmentsRes.ok) setStackLabelMap(await assignmentsRes.json());
    } catch {
      // Labels are non-critical; fail silently
    }
  }, [isPaid]);

  useEffect(() => {
    const handler = () => refreshLabels();
    window.addEventListener(SENCHO_LABELS_CHANGED, handler);
    return () => window.removeEventListener(SENCHO_LABELS_CHANGED, handler);
  }, [refreshLabels]);

  /**
   * Populate the per-stack "pending git source update" map. Runs on mount and
   * whenever a git-source change is signalled by the panel. Backend failure
   * leaves the map empty, which is the correct fallback (no badges shown).
   */
  const refreshGitSourcePending = async () => {
    try {
      const res = await apiFetch('/git-sources');
      if (!res.ok) return;
      const sources: Array<{ stack_name: string; pending_commit_sha: string | null }> = await res.json();
      const map: Record<string, boolean> = {};
      for (const s of sources) {
        if (s.pending_commit_sha) map[s.stack_name] = true;
      }
      setGitSourcePendingMap(map);
    } catch {
      // Non-critical; leave prior state.
    }
  };

  const handleScanStacks = async () => {
    if (isScanning) return;
    setIsScanning(true);
    const previousStacks = [...files];
    try {
      const currentStacks = await refreshStacks();
      const added = currentStacks.filter(s => !previousStacks.includes(s));
      const removed = previousStacks.filter(s => !currentStacks.includes(s));

      if (added.length > 0) {
        toast.success(`Found ${added.length} new stack${added.length !== 1 ? 's' : ''}: ${added.join(', ')}`);
      }
      if (removed.length > 0) {
        toast.info(`${removed.length} stack${removed.length !== 1 ? 's' : ''} no longer detected: ${removed.join(', ')}`);
      }
      if (added.length === 0 && removed.length === 0) {
        toast.info('No new stacks found.');
      }
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      const data = err?.data as Record<string, unknown> | undefined;
      toast.error((err?.message as string) || (err?.error as string) || (data?.error as string) || 'Something went wrong.');
    } finally {
      setIsScanning(false);
    }
  };

  // Coalesce a burst of state-invalidate signals (e.g. compose recreating
  // 10 services produces ~30 docker events in <500ms) into one stack refetch
  // and one downstream window event. The 250ms debounce balances "feels
  // instant" against not thrashing the API. The function is held in a ref
  // so the long-lived WS effect never closes over a stale refreshStacks.
  const stateInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshStacksRef = useRef(refreshStacks);
  useEffect(() => { refreshStacksRef.current = refreshStacks; }, [refreshStacks]);
  const scheduleStateInvalidateRefresh = useCallback(() => {
    if (stateInvalidateTimerRef.current) clearTimeout(stateInvalidateTimerRef.current);
    stateInvalidateTimerRef.current = setTimeout(() => {
      stateInvalidateTimerRef.current = null;
      refreshStacksRef.current(true);
    }, 250);
  }, []);

  // Notification WS push - subscribe to local real-time alerts.
  // Initial history load is handled by the [nodes] effect below.
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsBase = `${wsProtocol}//${window.location.host}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;
    let retryCount = 0;
    const MAX_RETRY_DELAY_MS = 30000;

    const connect = () => {
      if (!isMounted) return;
      ws = new WebSocket(`${wsBase}/ws/notifications`);

      ws.onopen = () => {
        if (!isMounted) {
          // Component unmounted while the handshake was in-flight (React StrictMode double-mount)
          ws?.close();
          return;
        }
        setTickerConnected(true);
        retryCount = 0; // Reset backoff on successful connect
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'notification' && msg.payload) {
            const localNode = nodesRef.current.find(n => n.type === 'local');
            const tagged: NotificationItem = {
              ...(msg.payload as Omit<NotificationItem, 'nodeId' | 'nodeName'>),
              nodeId: localNode?.id ?? -1,
              nodeName: localNode?.name ?? 'Local',
            };
            setNotifications(prev => [tagged, ...prev].sort((a, b) => b.timestamp - a.timestamp));
          } else if (msg.type === 'state-invalidate') {
            // Lightweight signal that a container/stack event happened.
            // Re-broadcast on the window bus so other hooks (dashboard data,
            // sidebar, etc.) can refetch on the same trigger without prop
            // drilling. Refresh stack statuses on this layer too.
            window.dispatchEvent(new CustomEvent('sencho:state-invalidate', { detail: msg }));
            if (msg.action === 'auto-update-settings-changed') {
              fetchAutoUpdateSettings();
            } else {
              scheduleStateInvalidateRefresh();
            }
          }
        } catch (e) {
          console.error('[WS notifications] parse error', e);
        }
      };

      ws.onclose = (event) => {
        setTickerConnected(false);
        if (!isMounted) return;
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
        const delay = Math.min(1000 * Math.pow(2, retryCount), MAX_RETRY_DELAY_MS);
        retryCount++;
        console.debug(`[WS notifications] closed (code=${event.code}), reconnecting in ${delay}ms (attempt ${retryCount})`);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = (event) => {
        // onerror always fires before onclose - log it and let onclose handle reconnect
        console.warn('[WS notifications] error event', event);
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      // Only close an already-open connection. If still CONNECTING, let onopen
      // detect isMounted=false and close then - avoids the browser warning
      // "WebSocket is closed before the connection is established".
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch all notifications when the nodes list changes (e.g. remote node added/removed).
  // nodesRef ensures fetchNotifications always reads the latest nodes at call time.
  useEffect(() => {
    fetchNotifications();
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open / close per-remote-node notification WebSocket connections as the nodes list changes.
  // Uses remoteNotifWsRef to avoid tearing down existing connections on unrelated node updates.
  useEffect(() => {
    const remoteNodes = nodes.filter(n => n.type === 'remote');
    const currentIds = new Set(remoteNotifWsRef.current.keys());
    const newIds = new Set(remoteNodes.map(n => n.id));

    // Close connections for nodes that are no longer registered as remote
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        remoteNotifWsRef.current.get(id)?.();
        remoteNotifWsRef.current.delete(id);
      }
    }

    // Open connections for newly-added remote nodes
    for (const rn of remoteNodes) {
      if (remoteNotifWsRef.current.has(rn.id)) continue;

      let ws: WebSocket | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let active = true;
      let retryCount = 0;

      const connect = () => {
        if (!active) return;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/notifications?nodeId=${rn.id}`);

        ws.onopen = () => { if (!active) { ws?.close(); } else { retryCount = 0; } };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.type === 'notification' && msg.payload) {
              // Read node name from ref so it stays fresh even if the node was renamed
              const current = nodesRef.current.find(n => n.id === rn.id);
              setNotifications(prev =>
                [{ ...msg.payload as Omit<NotificationItem, 'nodeId' | 'nodeName'>, nodeId: rn.id, nodeName: current?.name ?? rn.name }, ...prev]
                  .sort((a, b) => b.timestamp - a.timestamp)
              );
            } else if (msg.type === 'state-invalidate') {
              window.dispatchEvent(new CustomEvent('sencho:state-invalidate', { detail: { ...msg, nodeId: rn.id } }));
              scheduleStateInvalidateRefresh();
            }
          } catch (e) {
            console.error(`[WS notifications:${rn.name}] parse error`, e);
          }
        };

        ws.onclose = () => {
          if (!active) return;
          const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
          retryCount++;
          reconnectTimer = setTimeout(connect, delay);
        };

        ws.onerror = (e) => console.warn(`[WS notifications:${rn.name}] error`, e);
      };

      connect();

      remoteNotifWsRef.current.set(rn.id, () => {
        active = false;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      });
    }
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup all remote notification WebSocket connections on unmount
  useEffect(() => {
    return () => {
      for (const cleanup of remoteNotifWsRef.current.values()) cleanup();
      remoteNotifWsRef.current.clear();
    };
  }, []);

  // Re-fetch stacks whenever the active node changes (or becomes available on mount).
  // Also clears any stale editor/container state that belonged to the previous node.
  useEffect(() => {
    if (!activeNode) return;
    const pendingStack = pendingStackLoadRef.current;
    pendingStackLoadRef.current = null;

    setSelectedFile(null);
    setContent('');
    setOriginalContent('');
    setEnvContent('');
    setOriginalEnvContent('');
    setContainers([]);
    setIsEditing(false);

    if (pendingStack) {
      loadFile(pendingStack);
    } else {
      setActiveView('dashboard');
    }

    refreshStacks();
    // Image-update fetching + 5-minute poll are owned by useImageUpdates,
    // which mirrors this effect's activeNode.id dependency.
    fetchAutoUpdateSettings();
    refreshGitSourcePending();
  }, [activeNode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchNotifications = async () => {
    try {
      const currentNodes = nodesRef.current;
      const localNode = currentNodes.find(n => n.type === 'local');
      const remoteNodes = currentNodes.filter(n => n.type === 'remote');

      const [localResult, ...remoteResults] = await Promise.allSettled([
        apiFetch('/notifications', { localOnly: true }),
        ...remoteNodes.map(n => fetchForNode('/notifications', n.id)),
      ]);

      const all: NotificationItem[] = [];

      if (localResult.status === 'fulfilled' && localResult.value.ok) {
        const data = await localResult.value.json() as Omit<NotificationItem, 'nodeId' | 'nodeName'>[];
        data.forEach(n => all.push({ ...n, nodeId: localNode?.id ?? -1, nodeName: localNode?.name ?? 'Local' }));
      }

      for (let i = 0; i < remoteNodes.length; i++) {
        const result = remoteResults[i];
        if (result?.status === 'fulfilled' && result.value.ok) {
          const data = await result.value.json() as Omit<NotificationItem, 'nodeId' | 'nodeName'>[];
          const rn = remoteNodes[i];
          data.forEach(n => all.push({ ...n, nodeId: rn.id, nodeName: rn.name }));
        }
      }

      all.sort((a, b) => b.timestamp - a.timestamp);
      setNotifications(all);
    } catch (e) {
      console.error('[Notifications] fetch error:', e);
    }
  };

  // Safety-net poll: reconciles the list every 60s so events missed during a
  // WebSocket reconnect backoff still appear without a manual refresh. The ref
  // indirection keeps the interval pinned to the latest closure even though
  // fetchNotifications is redefined on every render.
  const fetchNotificationsRef = useRef(fetchNotifications);
  fetchNotificationsRef.current = fetchNotifications;
  useEffect(() => {
    const id = setInterval(() => { fetchNotificationsRef.current(); }, 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchAutoUpdateSettings = async () => {
    try {
      const res = await apiFetch('/stacks/auto-update-settings');
      if (res.ok) {
        const data = await res.json();
        setAutoUpdateSettings(data as Record<string, boolean>);
      } else {
        console.error('[AutoUpdateSettings] fetch returned', res.status);
      }
    } catch (e: unknown) {
      console.error('[AutoUpdateSettings] fetch failed:', e);
    }
  };

  const markAllRead = async () => {
    try {
      const localNode = nodesRef.current.find(n => n.type === 'local');
      const unreadNodeIds = [...new Set(notifications.filter(n => !n.is_read && n.nodeId != null).map(n => n.nodeId as number))];
      await Promise.allSettled(unreadNodeIds.map(nodeId =>
        nodeId === localNode?.id
          ? apiFetch('/notifications/read', { method: 'POST', localOnly: true })
          : fetchForNode('/notifications/read', nodeId, { method: 'POST' })
      ));
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    } catch (e: unknown) {
      const err = e as { message?: string; error?: string };
      toast.error(err?.message || err?.error || 'Failed to mark notifications as read');
    }
  };

  const deleteNotification = async (notif: NotificationItem) => {
    try {
      const localNode = nodesRef.current.find(n => n.type === 'local');
      if (notif.nodeId === localNode?.id) {
        await apiFetch(`/notifications/${notif.id}`, { method: 'DELETE', localOnly: true });
      } else if (notif.nodeId != null) {
        await fetchForNode(`/notifications/${notif.id}`, notif.nodeId, { method: 'DELETE' });
      }
      setNotifications(prev => prev.filter(n => !(n.id === notif.id && n.nodeId === notif.nodeId)));
    } catch (e: unknown) {
      const err = e as { message?: string; error?: string };
      toast.error(err?.message || err?.error || 'Failed to delete notification');
    }
  };

  const clearAllNotifications = async () => {
    try {
      const localNode = nodesRef.current.find(n => n.type === 'local');
      const uniqueNodeIds = [...new Set(notifications.filter(n => n.nodeId != null).map(n => n.nodeId as number))];
      await Promise.allSettled(uniqueNodeIds.map(nodeId =>
        nodeId === localNode?.id
          ? apiFetch('/notifications', { method: 'DELETE', localOnly: true })
          : fetchForNode('/notifications', nodeId, { method: 'DELETE' })
      ));
      setNotifications([]);
    } catch (e: unknown) {
      const err = e as { message?: string; error?: string };
      toast.error(err?.message || err?.error || 'Failed to clear notifications');
    }
  };

  useEffect(() => {
    const wsMap: Record<string, WebSocket> = {};

    (containers || []).forEach(container => {
      if (!container?.Id) return;
      try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const activeNodeId = localStorage.getItem('sencho-active-node') || '';
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws${activeNodeId ? `?nodeId=${activeNodeId}` : ''}`);
        wsMap[container.Id] = ws;
        ws.onopen = () => ws.send(JSON.stringify({
          action: 'streamStats',
          containerId: container.Id,
          nodeId: activeNodeId || undefined
        }));
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // Skip initial empty chunks where stats fields are missing
            if (!data.cpu_stats?.cpu_usage || !data.precpu_stats?.cpu_usage || !data.memory_stats?.usage) return;

            const cpuDelta = data.cpu_stats.cpu_usage.total_usage - data.precpu_stats.cpu_usage.total_usage;
            const systemDelta = (data.cpu_stats.system_cpu_usage || 0) - (data.precpu_stats.system_cpu_usage || 0);
            const onlineCpus = data.cpu_stats.online_cpus || 1;
            const cpuPercent = systemDelta > 0 ? ((cpuDelta / systemDelta) * onlineCpus * 100).toFixed(2) : '0.00';
            const ramUsage = (data.memory_stats.usage / (1024 * 1024)).toFixed(2) + ' MB';

            let currentRx = 0;
            let currentTx = 0;
            if (data.networks) {
              Object.values(data.networks as Record<string, { rx_bytes?: number; tx_bytes?: number }>).forEach((net) => {
                currentRx += net.rx_bytes || 0;
                currentTx += net.tx_bytes || 0;
              });
            }

            // Rate is derived from rawBytesRef which is never cleared on flush,
            // so the delta is always accurate - no stale-closure risk.
            const prevRaw = rawBytesRef.current[container.Id];
            const rxRate = prevRaw ? Math.max(0, currentRx - prevRaw.lastRx) : 0;
            const txRate = prevRaw ? Math.max(0, currentTx - prevRaw.lastTx) : 0;
            rawBytesRef.current[container.Id] = { lastRx: currentRx, lastTx: currentTx };

            const netIO = `${formatBytes(rxRate)}/s ↓ / ${formatBytes(txRate)}/s ↑`;

            // Write into the buffer ref only - zero re-render cost.
            pendingStatsRef.current[container.Id] = {
              cpu: cpuPercent + '%',
              ram: ramUsage,
              net: netIO,
              lastRx: currentRx,
              lastTx: currentTx,
              cpuNum: parseFloat(cpuPercent) || 0,
              memNum: data.memory_stats.usage / (1024 * 1024),
              netInNum: rxRate,
              netOutNum: txRate,
            };
          } catch {
            // Ignore parse errors
          }
        };
      } catch {
        // Ignore WebSocket errors
      }
    });

    // Flush buffered stats into React state once every 1.5 s.
    // Snapshot + clear the buffer BEFORE calling setState so the updater
    // function remains pure (no side-effects inside it).
    const flushInterval = setInterval(() => {
      const pending = pendingStatsRef.current;
      if (Object.keys(pending).length === 0) return;
      pendingStatsRef.current = {};

      setContainerStats(prev => {
        const next = { ...prev };
        const HISTORY_CAP = 60;
        for (const [id, newStats] of Object.entries(pending)) {
          const prior = prev[id]?.history ?? { cpu: [], mem: [], netIn: [], netOut: [] };
          const history = {
            cpu: [...prior.cpu, newStats.cpuNum].slice(-HISTORY_CAP),
            mem: [...prior.mem, newStats.memNum].slice(-HISTORY_CAP),
            netIn: [...prior.netIn, newStats.netInNum].slice(-HISTORY_CAP),
            netOut: [...prior.netOut, newStats.netOutNum].slice(-HISTORY_CAP),
          };
          next[id] = {
            cpu: newStats.cpu,
            ram: newStats.ram,
            net: newStats.net,
            lastRx: newStats.lastRx,
            lastTx: newStats.lastTx,
            history,
          };
        }
        return next;
      });
    }, 1500);

    return () => {
      clearInterval(flushInterval);
      // Discard buffered stats for the old stack so stale entries don't
      // briefly appear when a new stack is selected.
      pendingStatsRef.current = {};
      Object.values(wsMap).forEach(ws => {
        try { ws.close(); } catch { /* ignore */ }
      });
    };
  }, [containers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve a pending container name (from notification click) to a live
  // container id once the target stack's container list loads, then dispatch
  // the logs event. Only consume when the current stack matches the pending
  // target — prevents a canceled unsaved-load from leaking the pending name
  // into an unrelated container refresh. Container ids churn across
  // recreations, so we store the name and resolve here instead of storing an
  // id at dispatch time.
  useEffect(() => {
    const pending = pendingLogsRef.current;
    if (!pending || selectedFile !== pending.stackName || containers.length === 0) return;
    pendingLogsRef.current = null;
    const match = containers.find(c =>
      (c.Names ?? []).some(n => n.replace(/^\//, '') === pending.containerName),
    );
    if (match) {
      window.dispatchEvent(new CustomEvent<SenchoOpenLogsDetail>(SENCHO_OPEN_LOGS_EVENT, {
        detail: { containerId: match.Id, containerName: pending.containerName },
      }));
    }
  }, [containers, selectedFile]);

  const hasUnsavedChanges = () =>
    content !== originalContent || envContent !== originalEnvContent;

  // Global-search result click: switch the active node, clear the query so the
  // sidebar snaps back to the new node's full stack list, then open the stack.
  // setActiveNode writes to localStorage synchronously, so the next apiFetch
  // picks up the new node-id header without waiting for a re-render.
  const loadFileOnNode = async (node: Node, filename: string) => {
    if (!filename) return;
    if (selectedFile && filename !== selectedFile && hasUnsavedChanges()) {
      setPendingUnsavedNode(node);
      setPendingUnsavedLoad(filename);
      return;
    }
    setActiveNode(node);
    setSearchQuery('');
    await loadFile(filename);
  };

  const loadFile = async (filename: string) => {
    if (!filename) return;
    // Guard: if there are unsaved changes and we're switching to a different stack, confirm first
    if (selectedFile && filename !== selectedFile && hasUnsavedChanges()) {
      setPendingUnsavedLoad(filename);
      return;
    }
    setIsFileLoading(true);
    setIsEditing(false); // Reset to view mode when loading a new file
    setEditingCompose(false); // Default back to anatomy on stack switch
    setActiveTab('compose');
    try {
      const res = await apiFetch(`/stacks/${filename}`);
      const text = await res.text();
      setSelectedFile(filename);
      setActiveView('editor');
      setContent(text || '');
      setOriginalContent(text || '');

      // Load env files
      try {
        const envsRes = await apiFetch(`/stacks/${filename}/envs`);
        if (envsRes.ok) {
          const { envFiles } = await envsRes.json();
          if (envFiles && envFiles.length > 0) {
            setEnvFiles(envFiles);
            const firstFile = envFiles[0];
            setSelectedEnvFile(firstFile);
            setEnvExists(true);

            // Load specific env file content
            const envContentRes = await apiFetch(`/stacks/${filename}/env?file=${encodeURIComponent(firstFile)}`);
            if (envContentRes.ok) {
              const envText = await envContentRes.text();
              setEnvContent(envText || '');
              setOriginalEnvContent(envText || '');
            } else {
              setEnvContent('');
              setOriginalEnvContent('');
            }
          } else {
            setEnvFiles([]);
            setSelectedEnvFile('');
            setEnvContent('');
            setOriginalEnvContent('');
            setEnvExists(false);
          }
        } else {
          setEnvFiles([]);
          setSelectedEnvFile('');
          setEnvContent('');
          setOriginalEnvContent('');
          setEnvExists(false);
        }
      } catch {
        setEnvFiles([]);
        setSelectedEnvFile('');
        setEnvContent('');
        setOriginalEnvContent('');
        setEnvExists(false);
      }

      // Load containers
      try {
        const containersRes = await apiFetch(`/stacks/${filename}/containers`);
        const conts = await containersRes.json();
        setContainers(Array.isArray(conts) ? conts : []);
      } catch (error) {
        console.error('Failed to load containers:', error);
        setContainers([]);
      }

      // Load backup info (Skipper+ only)
      if (isPaid) {
        try {
          const backupRes = await apiFetch(`/stacks/${filename}/backup`);
          if (backupRes.ok) setBackupInfo(await backupRes.json());
          else setBackupInfo({ exists: false, timestamp: null });
        } catch {
          setBackupInfo({ exists: false, timestamp: null });
        }
      }
    } catch (error) {
      console.error('Failed to load file:', error);
      setSelectedFile(null);
      setContent('');
      setOriginalContent('');
      setEnvContent('');
      setOriginalEnvContent('');
      setContainers([]);
    } finally {
      setIsFileLoading(false);
    }
  };

  const navigateToNotification = (notif: NotificationItem) => {
    if (!notif.stack_name) return;
    pendingLogsRef.current = notif.container_name
      ? { stackName: notif.stack_name, containerName: notif.container_name }
      : null;
    const targetNode = notif.nodeId !== undefined
      ? nodes.find(n => n.id === notif.nodeId)
      : activeNode;
    if (targetNode && targetNode.id !== activeNode?.id) {
      loadFileOnNode(targetNode, notif.stack_name);
    } else {
      loadFile(notif.stack_name);
    }
  };

  const changeEnvFile = async (file: string) => {
    setSelectedEnvFile(file);
    setIsFileLoading(true);
    try {
      const res = await apiFetch(`/stacks/${selectedFile}/env?file=${encodeURIComponent(file)}`);
      if (!res.ok) {
        // Don't stuff a JSON error body into the editor on a non-OK response.
        setEnvContent('');
        setOriginalEnvContent('');
        toast.error('Could not load env file');
        return;
      }
      const text = await res.text();
      setEnvContent(text || '');
      setOriginalEnvContent(text || '');
    } catch (e) {
      console.error('Failed to switch env file', e);
      setEnvContent('');
      setOriginalEnvContent('');
    } finally {
      setIsFileLoading(false);
    }
  };

  const saveFile = async () => {
    if (activeTab === 'files') return;
    if (!selectedFile) return;
    const currentContent = activeTab === 'compose' ? (content || '') : (envContent || '');
    const endpoint = activeTab === 'compose' ? `/stacks/${selectedFile}` : `/stacks/${selectedFile}/env?file=${encodeURIComponent(selectedEnvFile)}`;
    try {
      const response = await apiFetch(endpoint, {
        method: 'PUT',
        body: JSON.stringify({ content: currentContent }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      // Update original content after save
      if (activeTab === 'compose') {
        setOriginalContent(content);
      } else {
        setOriginalEnvContent(envContent);
      }
      setIsEditing(false);
      toast.success('File saved successfully!');
    } catch (error) {
      console.error('Failed to save file:', error);
      toast.error(`Failed to save file: ${(error as Error).message}`);
    }
  };

  const requestSave = () => {
    const isCompose = activeTab === 'compose';
    const orig = isCompose ? originalContent : originalEnvContent;
    const curr = isCompose ? content : envContent;
    if (diffPreviewEnabled && activeTab !== 'files' && curr !== orig) {
      setDiffPreview({
        mode: 'save',
        language: isCompose ? 'yaml' : 'ini',
        original: orig,
        modified: curr,
        fileName: isCompose ? 'compose.yaml' : (selectedEnvFile || '.env'),
      });
    } else {
      void saveFile();
    }
  };

  const requestSaveAndDeploy = (e: React.MouseEvent) => {
    const isCompose = activeTab === 'compose';
    const orig = isCompose ? originalContent : originalEnvContent;
    const curr = isCompose ? content : envContent;
    if (diffPreviewEnabled && activeTab !== 'files' && curr !== orig) {
      setDiffPreview({
        mode: 'save-and-deploy',
        language: isCompose ? 'yaml' : 'ini',
        original: orig,
        modified: curr,
        fileName: isCompose ? 'compose.yaml' : (selectedEnvFile || '.env'),
      });
    } else {
      void handleSaveAndDeploy(e);
    }
  };

  const rollbackStack = async () => {
    if (!selectedFile || isStackBusy(selectedFile)) return;
    const stackFile = selectedFile;
    setStackAction(stackFile, 'rollback');
    setOptimisticStatus(stackFile, 'running');
    try {
      const res = await apiFetch(`/stacks/${stackFile}/rollback`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Rollback failed');
      }
      toast.success('Stack rolled back successfully.');
      // Reload the editor content
      const contentRes = await apiFetch(`/stacks/${stackFile}`);
      const text = await contentRes.text();
      setContent(text || '');
      setOriginalContent(text || '');
      // Refresh backup info
      const backupRes = await apiFetch(`/stacks/${stackFile}/backup`);
      if (backupRes.ok) setBackupInfo(await backupRes.json());
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Rollback failed';
      toast.error(msg);
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const handleSaveAndDeploy = async (e: React.MouseEvent) => {
    await saveFile();
    await deployStack(e);
  };

  const discardChanges = () => {
    if (activeTab === 'files') return;
    if (activeTab === 'compose') {
      setContent(originalContent);
    } else {
      setEnvContent(originalEnvContent);
    }
    setIsEditing(false);
  };

  const enterEditMode = () => {
    setIsEditing(true);
  };

  const scanStackConfig = async () => {
    if (!selectedFile || stackMisconfigScanning) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setStackMisconfigScanning(true);
    const loadingId = toast.loading(`Scanning ${stackName} configuration...`);
    try {
      const res = await apiFetch('/security/scan/stack', {
        method: 'POST',
        body: JSON.stringify({ stackName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to start scan');
      if (data.status === 'failed') {
        throw new Error(data.error || 'Scan failed');
      }
      toast.success(
        `Config scan complete: ${data.misconfig_count ?? 0} misconfigurations found`,
      );
      setStackMisconfigScanId(data.id as number);
    } catch (error) {
      const err = error as { message?: string; error?: string; data?: { error?: string } };
      toast.error(err?.message || err?.error || err?.data?.error || 'Config scan failed');
    } finally {
      toast.dismiss(loadingId);
      setStackMisconfigScanning(false);
    }
  };

  const runDeploy = async (
    stackName: string,
    stackFile: string,
    ignorePolicy: boolean,
    started?: Promise<void>,
  ): Promise<{ ok: boolean; errorMessage?: string }> => {
    const previousStatus = stackStatuses[stackFile];
    setOptimisticStatus(stackFile, 'running');
    try {
      const path = ignorePolicy
        ? `/stacks/${stackName}/deploy?ignorePolicy=true`
        : `/stacks/${stackName}/deploy`;
      if (started) await started;
      const response = await apiFetch(path, { method: 'POST' });
      if (!response.ok) {
        const rawBody = await response.text();
        if (response.status === 409) {
          let parsed: PolicyBlockPayload | null = null;
          try { parsed = JSON.parse(rawBody) as PolicyBlockPayload; } catch { /* not JSON */ }
          if (parsed && parsed.policy && Array.isArray(parsed.violations)) {
            setPolicyBlock({ stackName, payload: parsed });
            if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
            toast.error(`Deploy blocked by policy "${parsed.policy.name}"`);
            return { ok: false, errorMessage: `Deploy blocked by policy "${parsed.policy.name}"` };
          }
        }
        throw new Error(rawBody || 'Deploy failed');
      }
      setPolicyBlock(null);
      toast.success(ignorePolicy ? 'Stack deployed (policy bypassed).' : 'Stack deployed successfully!');
      if (selectedFile === stackFile) {
        const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
        const conts = await containersRes.json();
        setContainers(Array.isArray(conts) ? conts : []);
      }
      if (isPaid) {
        try {
          const backupRes = await apiFetch(`/stacks/${stackName}/backup`);
          if (backupRes.ok) setBackupInfo(await backupRes.json());
        } catch { /* ignore */ }
      }
      return { ok: true };
    } catch (error) {
      console.error('Failed to deploy:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      const errorMessage = (error as Error).message || 'Failed to deploy stack';
      toast.error(isPaid ? `${errorMessage} - automatically rolled back to previous version.` : errorMessage);
      return { ok: false, errorMessage };
    }
  };

  const deployStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || isStackBusy(selectedFile)) return;
    const stackFile = selectedFile;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setStackAction(stackFile, 'deploy');
    try {
      await runWithLog({ stackName, action: 'deploy' }, (started) =>
        runDeploy(stackName, stackFile, false, started)
      );
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const bypassPolicyAndDeploy = async () => {
    if (!policyBlock) return;
    const stackFile = `${policyBlock.stackName}.yml`;
    const existingFile = selectedFile && selectedFile.startsWith(policyBlock.stackName + '.')
      ? selectedFile
      : stackFile;
    setPolicyBypassing(true);
    setStackAction(existingFile, 'deploy');
    try {
      await runWithLog({ stackName: policyBlock.stackName, action: 'deploy' }, (started) =>
        runDeploy(policyBlock.stackName, existingFile, true, started)
      );
    } finally {
      setPolicyBypassing(false);
      clearStackAction(existingFile);
      refreshStacks(true);
    }
  };

  const stopStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || isStackBusy(selectedFile)) return;
    const stackFile = selectedFile;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setStackAction(stackFile, 'stop');
    const previousStatus = stackStatuses[stackFile];
    setOptimisticStatus(stackFile, 'exited');
    try {
      await runWithLog({ stackName, action: 'stop' }, async (started) => {
        await started;
        const response = await apiFetch(`/stacks/${stackName}/stop`, { method: 'POST' });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || 'Stop failed');
        }
        toast.success('Stack stopped successfully!');
        if (selectedFile === stackFile) {
          const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
          const conts = await containersRes.json();
          setContainers(Array.isArray(conts) ? conts : []);
        }
        return { ok: true };
      });
    } catch (error) {
      console.error('Failed to stop:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      toast.error((error as Error).message || 'Failed to stop stack');
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const restartStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || isStackBusy(selectedFile)) return;
    const stackFile = selectedFile;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setStackAction(stackFile, 'restart');
    const previousStatus = stackStatuses[stackFile];
    setOptimisticStatus(stackFile, 'running');
    try {
      await runWithLog({ stackName, action: 'restart' }, async (started) => {
        await started;
        const response = await apiFetch(`/stacks/${stackName}/restart`, { method: 'POST' });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || 'Restart failed');
        }
        toast.success('Stack restarted successfully!');
        if (selectedFile === stackFile) {
          const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
          const conts = await containersRes.json();
          setContainers(Array.isArray(conts) ? conts : []);
        }
        return { ok: true };
      });
    } catch (error) {
      console.error('Failed to restart:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      toast.error((error as Error).message || 'Failed to restart stack');
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const serviceAction = async (action: 'start' | 'stop' | 'restart', serviceName: string) => {
    if (!selectedFile) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    try {
      const r = await apiFetch(`/stacks/${stackName}/services/${encodeURIComponent(serviceName)}/${action}`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error((await r.text()) || `${action} failed`);
      const label = action === 'restart' ? 'restarted' : action === 'stop' ? 'stopped' : 'started';
      toast.success(`Service "${serviceName}" ${label}`);
      const cr = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await cr.json();
      setContainers(Array.isArray(conts) ? conts : []);
    } catch (e) {
      console.error(`Failed to ${action} service "${serviceName}":`, e);
      toast.error((e as Error).message || `Failed to ${action} service "${serviceName}"`);
    } finally {
      refreshStacks(true);
    }
  };

  const updateStack = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!selectedFile || isStackBusy(selectedFile)) return;
    const stackFile = selectedFile;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setStackAction(stackFile, 'update');
    const previousStatus = stackStatuses[stackFile];
    setOptimisticStatus(stackFile, 'running');
    try {
      await runWithLog({ stackName, action: 'update' }, async (started) => {
        await started;
        const response = await apiFetch(`/stacks/${stackName}/update`, { method: 'POST' });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || 'Update failed');
        }
        toast.success('Stack updated successfully!');
        fetchImageUpdates();
        if (selectedFile === stackFile) {
          const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
          const conts = await containersRes.json();
          setContainers(Array.isArray(conts) ? conts : []);
        }
        return { ok: true };
      });
    } catch (error) {
      console.error('Failed to update:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      toast.error((error as Error).message || 'Failed to update stack');
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const deleteStack = async (pruneVolumes: boolean) => {
    if (!stackToDelete) return;
    // Find matching file entry for per-stack tracking
    const deleteKey = files.find(f => f === stackToDelete || f.replace(/\.(yml|yaml)$/, '') === stackToDelete) ?? stackToDelete;
    if (isStackBusy(deleteKey)) return;
    setStackAction(deleteKey, 'delete');
    try {
      const url = pruneVolumes
        ? `/stacks/${stackToDelete}?pruneVolumes=true`
        : `/stacks/${stackToDelete}`;
      const response = await apiFetch(url, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to delete stack');
      }
      toast.success('Stack deleted successfully!');
      setDeleteDialogOpen(false);
      setStackToDelete(null);
      if (selectedFile === stackToDelete) {
        setSelectedFile(null);
        setContent('');
        setOriginalContent('');
        setEnvContent('');
        setOriginalEnvContent('');
        setEnvExists(false);
        setContainers([]);
        setIsEditing(false);
      }
      await refreshStacks();
    } catch (error) {
      console.error('Failed to delete stack:', error);
      toast.error((error as Error).message || 'Failed to delete stack');
    } finally {
      clearStackAction(deleteKey);
    }
  };

  const cancelPendingUnsavedLoad = () => {
    setPendingUnsavedLoad(null);
    setPendingUnsavedNode(null);
  };

  const discardAndLoadPending = () => {
    const target = pendingUnsavedLoad;
    const targetNode = pendingUnsavedNode;
    setContent(originalContent);
    setEnvContent(originalEnvContent);
    setPendingUnsavedLoad(null);
    setPendingUnsavedNode(null);
    if (target) {
      if (targetNode) loadFileOnNode(targetNode, target);
      else loadFile(target);
    }
  };

  const requestDeleteStack = () => {
    setStackToDelete(selectedFile);
    setDeleteDialogOpen(true);
  };

  // Context-menu-friendly stack actions (accept file name directly)
  const executeStackActionByFile = async (stackFile: string, action: StackAction, endpoint: string) => {
    if (isStackBusy(stackFile)) return;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setStackAction(stackFile, action);

    // Optimistic status update
    if (action === 'stop') {
      setOptimisticStatus(stackFile, 'exited');
    } else if (action === 'deploy' || action === 'restart' || action === 'update') {
      setOptimisticStatus(stackFile, 'running');
    }

    try {
      const response = await apiFetch(`/stacks/${stackName}/${endpoint}`, { method: 'POST' });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `${action} failed`);
      }
      toast.success(`Stack ${action}ed successfully!`);
      if (selectedFile === stackFile) {
        const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
        const conts = await containersRes.json();
        setContainers(Array.isArray(conts) ? conts : []);
      }
      if (action === 'update') fetchImageUpdates();
      if (action === 'deploy' && isPaid) {
        try {
          const backupRes = await apiFetch(`/stacks/${stackName}/backup`);
          if (backupRes.ok) setBackupInfo(await backupRes.json());
        } catch { /* ignore */ }
      }
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
      const msg = (error as Error).message || `Failed to ${action} stack`;
      toast.error(action === 'deploy' && isPaid ? `${msg} - automatically rolled back to previous version.` : msg);
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const checkUpdatesForStack = async () => {
    try {
      const res = await apiFetch('/image-updates/refresh', { method: 'POST' });
      if (res.ok) {
        toast.success('Checking for image updates...');
        // Poll until the background check completes instead of using a fixed timeout
        let elapsed = 0;
        const poll = setInterval(async () => {
          elapsed += 2000;
          try {
            const statusRes = await apiFetch('/image-updates/status');
            if (statusRes.ok) {
              const { checking } = await statusRes.json();
              if (!checking || elapsed >= 60000) {
                clearInterval(poll);
                await fetchImageUpdates();
                if (!checking) toast.success('Image update check complete.');
              }
            }
          } catch {
            clearInterval(poll);
            await fetchImageUpdates();
          }
        }, 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to check for updates');
      }
    } catch {
      toast.error('Failed to check for updates');
    }
  };

  const openBashModal = (containerId: string, containerName: string) => {
    setSelectedContainer({ id: containerId, name: containerName });
    setBashModalOpen(true);
  };

  const closeBashModal = () => {
    setBashModalOpen(false);
    setSelectedContainer(null);
  };

  const openLogViewer = (containerId: string, containerName: string) => {
    setLogContainer({ id: containerId, name: containerName });
    setLogViewerOpen(true);
  };

  const closeLogViewer = () => {
    setLogViewerOpen(false);
    setLogContainer(null);
  };

  // Listen for topology click-to-logs events (ref avoids stale closure)
  const openLogViewerRef = useRef(openLogViewer);
  openLogViewerRef.current = openLogViewer;
  useEffect(() => {
    const handler = (e: Event) => {
      const { containerId, containerName } = (e as CustomEvent<SenchoOpenLogsDetail>).detail;
      openLogViewerRef.current(containerId, containerName);
    };
    window.addEventListener(SENCHO_OPEN_LOGS_EVENT, handler);
    return () => window.removeEventListener(SENCHO_OPEN_LOGS_EVENT, handler);
  }, []);

  // Stack name is now the same as selectedFile (no extension to strip)
  const stackName = selectedFile || '';

  const filteredFiles = useMemo(
    () => files.filter(file => file.toLowerCase().includes(searchQuery.toLowerCase())),
    [files, searchQuery],
  );

  // Get display name for stack (now just returns the name as-is since no extension)
  const getDisplayName = (stackName: string) => {
    return stackName;
  };

  const { pinned, pin, unpin, isPinned, evictedOldest } = usePinnedStacks(activeNode?.id);

  useEffect(() => {
    if (evictedOldest) toast.info('Pinned. Unpinned oldest (max 10).');
  }, [evictedOldest]);

  const [filterChip, setFilterChip] = useState<FilterChip>('all');

  const filterCounts = useMemo(() => ({
    all: filteredFiles.length,
    up: filteredFiles.filter(f => stackStatuses[f] === 'running').length,
    down: filteredFiles.filter(f => stackStatuses[f] === 'exited').length,
    updates: filteredFiles.filter(f => !!stackUpdates[f]).length,
  }), [filteredFiles, stackStatuses, stackUpdates]);

  const chipFilteredFiles = useMemo(() => {
    if (filterChip === 'all') return filteredFiles;
    if (filterChip === 'up') return filteredFiles.filter(f => stackStatuses[f] === 'running');
    if (filterChip === 'down') return filteredFiles.filter(f => stackStatuses[f] === 'exited');
    if (filterChip === 'updates') return filteredFiles.filter(f => !!stackUpdates[f]);
    return filteredFiles;
  }, [filteredFiles, filterChip, stackStatuses, stackUpdates]);

  const [bulkMode, setBulkMode] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const toggleBulkMode = useCallback(() => {
    setBulkMode(prev => {
      if (prev) setSelectedFiles(new Set());
      return !prev;
    });
  }, []);

  const toggleSelect = useCallback((file: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const { runBulk } = useBulkStackActions();

  const handleBulkAction = useCallback((action: BulkAction) => {
    const files = Array.from(selectedFiles);
    runBulk(action, files, {
      onAfter: () => { refreshStacks(true); clearSelection(); },
    });
  }, [selectedFiles, runBulk, clearSelection]);

  const chipFilteredFilesRef = useRef(chipFilteredFiles);
  useEffect(() => { chipFilteredFilesRef.current = chipFilteredFiles; }, [chipFilteredFiles]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInputFocused()) return;
      if (isPaletteOpen()) return;

      if (e.key === 'b' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleBulkMode();
      } else if (e.key === 'Escape' && bulkMode) {
        e.preventDefault();
        setBulkMode(false);
        setSelectedFiles(new Set());
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a' && bulkMode) {
        e.preventDefault();
        setSelectedFiles(new Set(chipFilteredFilesRef.current));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bulkMode, toggleBulkMode]);

  const { isCollapsed, toggle: toggleCollapse } = useSidebarGroupCollapse(activeNode?.id);

  const remoteResults = useMemo(() => {
    return Object.entries(remoteStackResults).flatMap(([nodeIdStr, remoteFiles]) => {
      const node = nodes.find(n => n.id === Number(nodeIdStr));
      if (!node || remoteFiles.length === 0) return [];
      return [{
        nodeId: node.id,
        nodeName: node.name,
        files: remoteFiles.map(({ file, status }) => ({ file, status: status as StackRowStatus })),
      }];
    });
  }, [remoteStackResults, nodes]);

  const buildMenuCtx = useCallback((file: string): StackMenuCtx => {
    const stackName = file.replace(/\.(yml|yaml)$/, '');
    return {
      stackStatus: (stackStatuses[file] ?? 'unknown') as 'running' | 'exited' | 'unknown',
      hasPort: Boolean(stackPorts[file]),
      isBusy: isStackBusy(file),
      isPaid,
      isAdmiral,
      canDelete: can('stack:delete', 'stack', stackName),
      isPinned: isPinned(file),
      labels,
      assignedLabelIds: (stackLabelMap[file] ?? []).map(l => l.id),
      menuVisibility: getStackMenuVisibility(file),
      autoUpdateEnabled: autoUpdateSettings[stackName] ?? true,
      openAlertSheet: () => openAlertSheet(file),
      openAutoHeal: () => setAutoHealStackName(file),
      checkUpdates: () => checkUpdatesForStack(),
      openStackApp: () => openStackApp(file),
      deploy: () => executeStackActionByFile(file, 'deploy', 'deploy'),
      stop: () => executeStackActionByFile(file, 'stop', 'stop'),
      restart: () => executeStackActionByFile(file, 'restart', 'restart'),
      update: () => executeStackActionByFile(file, 'update', 'update'),
      remove: () => { setStackToDelete(stackName); setDeleteDialogOpen(true); },
      pin: () => pin(file),
      unpin: () => unpin(file),
      setAutoUpdateEnabled: async (enabled: boolean) => {
        setAutoUpdateSettings(prev => ({ ...prev, [stackName]: enabled }));
        try {
          const res = await apiFetch(`/stacks/${encodeURIComponent(stackName)}/auto-update`, {
            method: 'PUT',
            body: JSON.stringify({ enabled }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error || 'Failed to update auto-update setting.');
          }
        } catch (err: unknown) {
          setAutoUpdateSettings(prev => ({ ...prev, [stackName]: !enabled }));
          toast.error((err as Error)?.message || 'Failed to update auto-update setting.');
        }
      },
      toggleLabel: async (labelId: number) => {
        const currentIds = (stackLabelMap[file] ?? []).map(l => l.id);
        const assigned = currentIds.includes(labelId);
        const newIds = assigned ? currentIds.filter(id => id !== labelId) : [...currentIds, labelId];
        const loadingId = toast.loading('Updating labels...');
        try {
          const res = await apiFetch(`/stacks/${encodeURIComponent(file)}/labels`, {
            method: 'PUT',
            body: JSON.stringify({ labelIds: newIds }),
          });
          if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error((data as { error?: string })?.error || 'Failed to update labels.'); }
          refreshLabels();
        } catch (err: unknown) {
          toast.error((err as Error)?.message || 'Failed to update labels.');
        } finally {
          toast.dismiss(loadingId);
        }
      },
      createAndAssignLabel: async (name: string, color: LabelColor) => {
        const loadingId = toast.loading('Creating label...');
        try {
          const createRes = await apiFetch('/labels', {
            method: 'POST',
            body: JSON.stringify({ name, color }),
          });
          if (!createRes.ok) {
            const data = await createRes.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error || 'Failed to create label.');
          }
          const created: StackLabel = await createRes.json();
          const currentIds = (stackLabelMap[file] ?? []).map(l => l.id);
          const newIds = [...currentIds, created.id];
          const assignRes = await apiFetch(`/stacks/${encodeURIComponent(file)}/labels`, {
            method: 'PUT',
            body: JSON.stringify({ labelIds: newIds }),
          });
          if (!assignRes.ok) {
            const data = await assignRes.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error || 'Failed to assign label.');
          }
          toast.success(`Label "${created.name}" created.`);
          refreshLabels();
        } catch (err: unknown) {
          toast.error((err as Error)?.message || 'Failed to create label.');
          throw err;
        } finally {
          toast.dismiss(loadingId);
        }
      },
      openLabelManager: () => handleOpenSettings('labels'),
      openScheduleTask: () => {
        const stackName = file.replace(/\.(yml|yaml)$/, '');
        setSchedulePrefill({ stackName, nodeId: activeNode?.id ?? null });
        setActiveView('scheduled-ops');
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stackStatuses, stackPorts, isPaid, isAdmiral, isPinned, labels, stackLabelMap,
    autoUpdateSettings, pin, unpin,
  ]);

  const createStackSlot = can('stack:create') ? (
    <>
      <Button
        variant="outline"
        className="rounded-lg w-full"
        onClick={() => setCreateDialogOpen(true)}
      >
        <Plus className="w-4 h-4 mr-2" />
        Create Stack
      </Button>
      <CreateStackDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onStackCreated={async (stackName) => {
          await refreshStacks();
          await loadFile(stackName);
        }}
        onStacksChanged={async () => { await refreshStacks(); }}
      />
    </>
  ) : null;

  return (
    <GlobalCommandPaletteProvider>
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <GlobalCommandPalette
        navItems={navItems}
        onNavigate={handleNavigate}
        onSelectStack={loadFileOnNode}
      />
      {/* Left Sidebar (Stacks) */}
      <StackSidebar
        isDarkMode={isDarkMode}
        nodeSwitcherSlot={
          <NodeSwitcher
            onManageNodes={() => handleOpenSettings('nodes')}
          />
        }
        createStackSlot={createStackSlot}
        onScan={handleScanStacks}
        isScanning={isScanning}
        canCreate={can('stack:create')}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterChip={filterChip}
        filterCounts={filterCounts}
        onFilterChipChange={setFilterChip}
        list={{
          files: chipFilteredFiles,
          isLoading,
          isPaid,
          selectedFile,
          searchQuery,
          stackLabelMap,
          stackStatuses: stackStatuses as Record<string, StackRowStatus | undefined>,
          stackUpdates,
          gitSourcePendingMap,
          pinnedFiles: pinned,
          isCollapsed,
          toggleCollapse,
          isBusy: isStackBusy,
          getDisplayName,
          onSelectFile: loadFile,
          buildMenuCtx,
          remoteResults,
          remoteLoading: remoteSearchLoading,
          onSelectRemoteFile: (nodeId, file) => {
            const node = nodes.find(n => n.id === nodeId);
            if (node) loadFileOnNode(node, file);
          },
        }}
        notifications={notifications}
        tickerConnected={tickerConnected}
        onOpenActivity={() => setActiveView('global-observability')}
        bulkMode={bulkMode}
        selectedFiles={selectedFiles}
        isPaid={isPaid}
        onToggleBulkMode={toggleBulkMode}
        onToggleSelect={toggleSelect}
        onClearSelection={clearSelection}
        onBulkAction={handleBulkAction}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          activeView={activeView}
          navItems={navItems}
          onNavigate={handleNavigate}
          mobileNavOpen={mobileNavOpen}
          onMobileNavOpenChange={setMobileNavOpen}
          search={<GlobalCommandPaletteTrigger />}
          notifications={
            <NotificationPanel
              notifications={notifications}
              nodes={nodes}
              onMarkAllRead={markAllRead}
              onClearAll={clearAllNotifications}
              onDelete={deleteNotification}
              onNavigate={navigateToNotification}
            />
          }
          userMenu={
            <UserProfileDropdown
              theme={theme}
              setTheme={setTheme}
              onOpenSettings={() => handleOpenSettings('account')}
            />
          }
        />

        {/* Main Workspace */}
        <div key={activeView} className="flex-1 overflow-y-auto p-6 animate-fade-up">
          <ViewRouter
            activeView={activeView}
            selectedFile={selectedFile}
            isLoading={isLoading}
            settingsSection={settingsSection}
            onSettingsSectionChange={setSettingsSection}
            onTemplateDeploySuccess={(stackName) => { refreshStacks(); loadFile(stackName); }}
            onHostConsoleClose={() => setActiveView(selectedFile ? 'editor' : 'dashboard')}
            onFleetNavigateToNode={(nodeId, stackName) => {
              const node = nodes.find(n => n.id === nodeId);
              if (node) {
                if (activeNode?.id === nodeId) {
                  loadFile(stackName);
                } else {
                  pendingStackLoadRef.current = stackName;
                  setActiveNode(node);
                }
              }
            }}
            filterNodeId={filterNodeId}
            onClearScheduledOpsFilter={() => setFilterNodeId(null)}
            schedulePrefill={schedulePrefill}
            onPrefillConsumed={handlePrefillConsumed}
            notifications={notifications}
            onNavigateToStack={(stackFile) => { loadFile(stackFile); }}
            onOpenSettingsSection={(section) => handleOpenSettings(section)}
            onClearNotifications={clearAllNotifications}
            renderEditor={() => (
              <EditorView
                stackName={stackName}
                isDarkMode={isDarkMode}
                containers={containers}
                containerStats={containerStats}
                content={content}
                envContent={envContent}
                envExists={envExists}
                envFiles={envFiles}
                selectedEnvFile={selectedEnvFile}
                isFileLoading={isFileLoading}
                backupInfo={backupInfo}
                gitSourcePendingMap={gitSourcePendingMap}
                notifications={notifications}
                activeTab={activeTab}
                isEditing={isEditing}
                editingCompose={editingCompose}
                logsMode={logsMode}
                copiedDigest={copiedDigest}
                loadingAction={loadingAction}
                stackMisconfigScanning={stackMisconfigScanning}
                can={can}
                isAdmin={isAdmin}
                isPaid={isPaid}
                trivy={trivy}
                activeNode={activeNode}
                monacoEditorRef={monacoEditorRef}
                copiedDigestTimerRef={copiedDigestTimerRef}
                deployStack={deployStack}
                restartStack={restartStack}
                stopStack={stopStack}
                updateStack={updateStack}
                rollbackStack={rollbackStack}
                scanStackConfig={scanStackConfig}
                enterEditMode={enterEditMode}
                requestSave={requestSave}
                requestSaveAndDeploy={requestSaveAndDeploy}
                discardChanges={discardChanges}
                setContent={setContent}
                setEnvContent={setEnvContent}
                changeEnvFile={changeEnvFile}
                openLogViewer={openLogViewer}
                openBashModal={openBashModal}
                serviceAction={serviceAction}
                setActiveTab={setActiveTab}
                setLogsMode={setLogsMode}
                setEditingCompose={setEditingCompose}
                setGitSourceOpen={setGitSourceOpen}
                setCopiedDigest={setCopiedDigest}
                requestDeleteStack={requestDeleteStack}
              />
            )}
          />
        </div>
      </div>

      <DeleteStackDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        stackName={stackToDelete}
        onConfirm={deleteStack}
      />

      <UnsavedChangesDialog
        open={!!pendingUnsavedLoad}
        onCancel={cancelPendingUnsavedLoad}
        onConfirm={discardAndLoadPending}
      />

      {/* Bash Exec Modal */}
      {selectedContainer && (
        <BashExecModal
          isOpen={bashModalOpen}
          onClose={closeBashModal}
          containerId={selectedContainer.id}
          containerName={selectedContainer.name}
        />
      )}

      {/* LogViewer Modal */}
      {logContainer && (
        <LogViewer
          isOpen={logViewerOpen}
          onClose={closeLogViewer}
          containerId={logContainer.id}
          containerName={logContainer.name}
        />
      )}


      {/* Stack Alert Sheet */}
      <StackAlertSheet
        isOpen={alertSheetOpen}
        onClose={() => setAlertSheetOpen(false)}
        stackName={alertSheetStack}
      />

      {/* Pre-deploy policy block */}
      <PolicyBlockDialog
        open={policyBlock !== null}
        payload={policyBlock?.payload ?? null}
        stackName={policyBlock?.stackName ?? ''}
        canBypass={isAdmin}
        bypassing={policyBypassing}
        onClose={() => setPolicyBlock(null)}
        onBypass={bypassPolicyAndDeploy}
      />

      {/* Stack Auto-Heal Sheet */}
      <StackAutoHealSheet
        stackName={autoHealStackName ?? ''}
        open={autoHealStackName !== null}
        onOpenChange={(open) => { if (!open) setAutoHealStackName(null); }}
      />

      {/* Git Source Panel */}
      {stackName && (
        <GitSourcePanel
          open={gitSourceOpen}
          onOpenChange={setGitSourceOpen}
          stackName={stackName}
          canEdit={can('stack:edit', 'stack', stackName)}
          isDarkMode={isDarkMode}
          onSourceChanged={refreshGitSourcePending}
        />
      )}

      {/* Stack config misconfig scan results */}
      <VulnerabilityScanSheet
        scanId={stackMisconfigScanId}
        onClose={() => setStackMisconfigScanId(null)}
      />

      {/* Compose diff preview */}
      <ComposeDiffPreviewDialog
        open={diffPreview !== null}
        onOpenChange={(open) => { if (!open && !diffPreviewConfirming) setDiffPreview(null); }}
        stackName={selectedFile ? selectedFile.replace(/\.(yml|yaml)$/, '') : ''}
        fileName={diffPreview?.fileName ?? ''}
        language={diffPreview?.language ?? 'yaml'}
        original={diffPreview?.original ?? ''}
        modified={diffPreview?.modified ?? ''}
        actionLabel={diffPreview?.mode === 'save-and-deploy' ? 'Save & deploy' : 'Save'}
        confirming={diffPreviewConfirming}
        isDarkMode={isDarkMode}
        onConfirm={async () => {
          const snapshot = diffPreview;
          setDiffPreviewConfirming(true);
          try {
            if (snapshot?.mode === 'save-and-deploy') {
              await saveFile();
              // e.preventDefault/stopPropagation are no-ops here; no browser event is in flight
              await deployStack({ preventDefault() {}, stopPropagation() {} } as unknown as React.MouseEvent);
            } else {
              await saveFile();
            }
          } finally {
            setDiffPreviewConfirming(false);
            setDiffPreview(null);
          }
        }}
      />

      {/* Scan history overlay. Conditionally mounted so the lazy chunk
          only fetches when the user opens the overlay; an always-mounted
          lazy component would fetch on EditorLayout's first render and
          defeat the split. The overlay has no internal state that needs
          to persist across opens. */}
      {securityHistoryOpen ? (
        <LazyBoundary>
          <Suspense fallback={null}>
            <SecurityHistoryView
              open
              onClose={() => setSecurityHistoryOpen(false)}
            />
          </Suspense>
        </LazyBoundary>
      ) : null}
    </div>
    </GlobalCommandPaletteProvider>
  );
}
