import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'auto';
import Editor from '@monaco-editor/react';
import TerminalComponent from './Terminal';
import ErrorBoundary from './ErrorBoundary';
import HomeDashboard from './HomeDashboard';
import type { NotificationItem } from './dashboard/types';
import BashExecModal from './BashExecModal';
import HostConsole from './HostConsole';
import { AdmiralGate } from './AdmiralGate';
import { CapabilityGate } from './CapabilityGate';
import ResourcesView from './ResourcesView';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsHighlight, TabsHighlightItem } from './ui/tabs';
import { springs } from '@/lib/motion';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Plus, Trash2, Play, Square, Save, Terminal, RotateCw, CloudDownload, Pencil, X, Home, MoreVertical, Rocket, HardDrive, ScrollText, Activity, Radar, Undo2, RefreshCw, Clock, Loader2, Check, ChevronDown, GitBranch, FileCode2, ShieldCheck, ArrowUpRight, Copy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { type Label as StackLabel, type LabelColor } from './label-types';
import { UserProfileDropdown } from './UserProfileDropdown';
import { NotificationPanel } from './NotificationPanel';
import { apiFetch, fetchForNode } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui/toast-store';
import { Label } from './ui/label';
import { ScrollArea } from './ui/scroll-area';
import { Checkbox } from './ui/checkbox';
import { GitSourceFields, type ApplyMode } from './stack/GitSourceFields';
import { PolicyBlockDialog, type PolicyBlockPayload } from './stack/PolicyBlockDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TopBar } from './TopBar';
import { cn } from '@/lib/utils';
import { SettingsModal } from './SettingsModal';
import { StackAlertSheet } from './StackAlertSheet';
import { StackAutoHealSheet } from '@/components/StackAutoHealSheet';
import { GitSourcePanel } from './stack/GitSourcePanel';
import { AppStoreView } from './AppStoreView';
import { LogViewer } from './LogViewer';
import StructuredLogViewer from './StructuredLogViewer';
import StackAnatomyPanel from './StackAnatomyPanel';
import { Sparkline } from './ui/sparkline';
import { GlobalObservabilityView } from './GlobalObservabilityView';
import { FleetView } from './FleetView';
import { AuditLogView } from './AuditLogView';
import ScheduledOperationsView from './ScheduledOperationsView';
import AutoUpdateReadinessView from './AutoUpdateReadinessView';
import { SecurityHistoryView } from './SecurityHistoryView';
import { SENCHO_NAVIGATE_EVENT } from './NodeManager';
import type { SenchoNavigateDetail } from './NodeManager';
import { NodeSwitcher } from './NodeSwitcher';
import {
    GlobalCommandPalette,
    GlobalCommandPaletteProvider,
    GlobalCommandPaletteTrigger,
} from './GlobalCommandPalette';
import { useCrossNodeStackSearch } from '@/hooks/useCrossNodeStackSearch';
import { SENCHO_OPEN_LOGS_EVENT } from '@/lib/events';
import type { SenchoOpenLogsDetail } from '@/lib/events';
import { useNodes } from '@/context/NodeContext';
import type { Node } from '@/context/NodeContext';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { useTrivyStatus } from '@/hooks/useTrivyStatus';
import { VulnerabilityScanSheet } from './VulnerabilityScanSheet';
import { StackSidebar } from '@/components/sidebar/StackSidebar';
import { usePinnedStacks } from '@/hooks/usePinnedStacks';
import { useSidebarGroupCollapse } from '@/hooks/useSidebarGroupCollapse';
import type { StackRowStatus } from '@/components/sidebar/StackRow';
import type { StackMenuCtx } from '@/components/sidebar/sidebar-types';

interface ContainerInfo {
  Id: string;
  Names: string[];
  State: string;
  Status?: string;
  Ports?: { PrivatePort: number, PublicPort: number }[];
  healthStatus?: 'healthy' | 'unhealthy' | 'starting' | 'none';
  Image?: string;
  ImageID?: string;
}

interface StackStatus {
  [key: string]: 'running' | 'exited' | 'unknown';
}

interface StackStatusInfo {
  status: 'running' | 'exited' | 'unknown';
  mainPort?: number;
}

type StackAction = 'deploy' | 'stop' | 'restart' | 'update' | 'delete' | 'rollback';

interface BulkActionResult {
  stackName: string;
  success: boolean;
  error?: string;
}


const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Extract the "up X time" portion from a Docker status string like
// "Up 12 days (healthy)" → "up 12 days". Returns null when the container
// is not in an uptime-reporting state (exited, created, restarting, etc.).
const extractUptime = (status: string | undefined): string | null => {
  if (!status) return null;
  const match = status.match(/^\s*Up\s+(.+?)(?:\s*\(.*\))?\s*$/i);
  if (!match) return null;
  return `up ${match[1].trim()}`;
};

const healthcheckLabel = (health?: 'healthy' | 'unhealthy' | 'starting' | 'none'): string | null => {
  if (!health || health === 'none') return null;
  if (health === 'healthy') return 'healthcheck passing';
  if (health === 'unhealthy') return 'healthcheck failing';
  return 'healthcheck starting';
};

type StackPill = { label: string; dotClass: string; className: string; pulse: boolean };

const getStackStatePill = (containers: ContainerInfo[]): StackPill | null => {
  if (!containers || containers.length === 0) return null;
  const running = containers.some(c => c.State === 'running');
  if (!running) {
    return {
      label: 'exited',
      dotClass: 'bg-destructive',
      className: 'border-destructive/40 bg-destructive/10 text-destructive',
      pulse: false,
    };
  }
  const anyUnhealthy = containers.some(c => c.healthStatus === 'unhealthy');
  const anyStarting = containers.some(c => c.healthStatus === 'starting');
  const anyHealthy = containers.some(c => c.healthStatus === 'healthy');
  if (anyUnhealthy) {
    return {
      label: 'running · unhealthy',
      dotClass: 'bg-destructive',
      className: 'border-destructive/40 bg-destructive/10 text-destructive',
      pulse: true,
    };
  }
  if (anyStarting) {
    return {
      label: 'running · starting',
      dotClass: 'bg-warning',
      className: 'border-warning/40 bg-warning/10 text-warning',
      pulse: true,
    };
  }
  if (anyHealthy) {
    return {
      label: 'running · healthy',
      dotClass: 'bg-success',
      className: 'border-success/40 bg-success/10 text-success',
      pulse: true,
    };
  }
  return {
    label: 'running',
    dotClass: 'bg-success',
    className: 'border-success/40 bg-success/10 text-success',
    pulse: true,
  };
};

export default function EditorLayout() {
  const { isAdmin, can } = useAuth();
  const { isPaid, license } = useLicense();
  const { status: trivy } = useTrivyStatus();
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
  const [activeTab, setActiveTab] = useState<'compose' | 'env'>('compose');
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
  const [createMode, setCreateMode] = useState<'empty' | 'git' | 'docker-run'>('empty');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newStackName, setNewStackName] = useState('');
  // "From Docker Run" tab state
  const [dockerRunInput, setDockerRunInput] = useState('');
  const [convertedYaml, setConvertedYaml] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [creatingFromDockerRun, setCreatingFromDockerRun] = useState(false);
  // "From Git" tab state
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [gitComposePath, setGitComposePath] = useState('compose.yaml');
  const [gitSyncEnv, setGitSyncEnv] = useState(false);
  const [gitAuthType, setGitAuthType] = useState<'none' | 'token'>('none');
  const [gitToken, setGitToken] = useState('');
  const [gitApplyMode, setGitApplyMode] = useState<ApplyMode>('review');
  const [gitDeployNow, setGitDeployNow] = useState(false);
  const [creatingFromGit, setCreatingFromGit] = useState(false);
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
  const [activeView, setActiveView] = useState<'dashboard' | 'editor' | 'host-console' | 'resources' | 'templates' | 'global-observability' | 'fleet' | 'audit-log' | 'scheduled-ops' | 'auto-updates'>('dashboard');
  const [securityHistoryOpen, setSecurityHistoryOpen] = useState(false);
  const [filterNodeId, setFilterNodeId] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCompose, setEditingCompose] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stackStatuses, setStackStatuses] = useState<StackStatus>({});
  const [stackPorts, setStackPorts] = useState<Record<string, number | undefined>>({});
  const [labels, setLabels] = useState<StackLabel[]>([]);
  const [stackLabelMap, setStackLabelMap] = useState<Record<string, StackLabel[]>>({});
  // Bulk-action dialog is retained as a safety fallback; the label pill entry
  // point that drove the setters was removed alongside the sidebar rewrite.
  const [bulkActionLabel] = useState<StackLabel | null>(null);
  const [bulkAction] = useState<string>('');
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [bulkActionRunning, setBulkActionRunning] = useState(false);

  // Bash exec modal state
  const [bashModalOpen, setBashModalOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<{ id: string; name: string } | null>(null);

  // LogViewer state
  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [logContainer, setLogContainer] = useState<{ id: string; name: string } | null>(null);


  // Image update checker state
  const [stackUpdates, setStackUpdates] = useState<Record<string, boolean>>({});

  // Notifications & Settings state
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [tickerConnected, setTickerConnected] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<'account' | 'labels' | 'nodes'>('account');
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
    fetchImageUpdates();
    refreshGitSourcePending();

    // Poll for image update results every 5 minutes so background checks are picked up
    const imageUpdateInterval = setInterval(fetchImageUpdates, 5 * 60 * 1000);
    return () => clearInterval(imageUpdateInterval);
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

  const fetchImageUpdates = async () => {
    try {
      const res = await apiFetch('/image-updates');
      if (res.ok) {
        const data = await res.json();
        setStackUpdates(data);
      }
    } catch (e: unknown) {
      console.error('[ImageUpdates] fetch failed:', e);
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

  const runDeploy = async (stackName: string, stackFile: string, ignorePolicy: boolean): Promise<void> => {
    const previousStatus = stackStatuses[stackFile];
    setOptimisticStatus(stackFile, 'running');
    try {
      const path = ignorePolicy
        ? `/stacks/${stackName}/deploy?ignorePolicy=true`
        : `/stacks/${stackName}/deploy`;
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
            return;
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
    } catch (error) {
      console.error('Failed to deploy:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      const msg = (error as Error).message || 'Failed to deploy stack';
      toast.error(isPaid ? `${msg} - automatically rolled back to previous version.` : msg);
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
      await runDeploy(stackName, stackFile, false);
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
      await runDeploy(policyBlock.stackName, existingFile, true);
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
      const response = await apiFetch(`/stacks/${stackName}/stop`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Stop failed');
      }
      toast.success('Stack stopped successfully!');
      // Refresh containers after stop
      if (selectedFile === stackFile) {
        const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
        const conts = await containersRes.json();
        setContainers(Array.isArray(conts) ? conts : []);
      }
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
      const response = await apiFetch(`/stacks/${stackName}/restart`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Restart failed');
      }
      toast.success('Stack restarted successfully!');
      // Refresh containers after restart
      if (selectedFile === stackFile) {
        const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
        const conts = await containersRes.json();
        setContainers(Array.isArray(conts) ? conts : []);
      }
    } catch (error) {
      console.error('Failed to restart:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      toast.error((error as Error).message || 'Failed to restart stack');
    } finally {
      clearStackAction(stackFile);
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
      const response = await apiFetch(`/stacks/${stackName}/update`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Update failed');
      }
      toast.success('Stack updated successfully!');
      fetchImageUpdates();
      // Refresh containers after update
      if (selectedFile === stackFile) {
        const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
        const conts = await containersRes.json();
        setContainers(Array.isArray(conts) ? conts : []);
      }
    } catch (error) {
      console.error('Failed to update:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      toast.error((error as Error).message || 'Failed to update stack');
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const deleteStack = async () => {
    if (!stackToDelete) return;
    // Find matching file entry for per-stack tracking
    const deleteKey = files.find(f => f === stackToDelete || f.replace(/\.(yml|yaml)$/, '') === stackToDelete) ?? stackToDelete;
    if (isStackBusy(deleteKey)) return;
    setStackAction(deleteKey, 'delete');
    try {
      const response = await apiFetch(`/stacks/${stackToDelete}`, {
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

  const handleCreateStack = async () => {
    if (!newStackName.trim()) return;
    // Send stackName directly (no .yml extension - backend creates directory)
    const stackName = newStackName.trim();
    try {
      const response = await apiFetch('/stacks', {
        method: 'POST',
        body: JSON.stringify({ stackName }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          throw new Error('Stack already exists');
        } else if (response.status === 400) {
          throw new Error('Invalid stack name (use alphanumeric characters and hyphens only)');
        }
        throw new Error('Failed to create stack');
      }
      setCreateDialogOpen(false);
      setNewStackName('');
      await refreshStacks();
      // Auto-load the new stack in the editor pane
      await loadFile(stackName);
    } catch (error) {
      console.error('Failed to create stack:', error);
      toast.error((error as Error).message || 'Failed to create stack');
    }
  };

  const resetCreateFromGitForm = () => {
    setNewStackName('');
    setGitRepoUrl('');
    setGitBranch('main');
    setGitComposePath('compose.yaml');
    setGitSyncEnv(false);
    setGitAuthType('none');
    setGitToken('');
    setGitApplyMode('review');
    setGitDeployNow(false);
  };

  const handleCreateStackFromGit = async () => {
    const stackName = newStackName.trim();
    if (!stackName) {
      toast.error('Stack name is required.');
      return;
    }
    if (!gitRepoUrl.trim() || !gitBranch.trim() || !gitComposePath.trim()) {
      toast.error('Repository URL, branch, and compose path are required.');
      return;
    }
    if (!/^https:\/\//i.test(gitRepoUrl.trim())) {
      toast.error('Only HTTPS repository URLs are supported.');
      return;
    }
    setCreatingFromGit(true);
    const loadingId = toast.loading(gitDeployNow ? 'Fetching, creating, and deploying...' : 'Fetching and creating stack...');
    try {
      const autoApply = gitApplyMode !== 'review';
      const autoDeploy = gitApplyMode === 'auto-deploy';
      const body: Record<string, unknown> = {
        stack_name: stackName,
        repo_url: gitRepoUrl.trim(),
        branch: gitBranch.trim(),
        compose_path: gitComposePath.trim(),
        sync_env: gitSyncEnv,
        auth_type: gitAuthType,
        auto_apply_on_webhook: autoApply,
        auto_deploy_on_apply: autoDeploy,
        deploy_now: gitDeployNow,
      };
      if (gitAuthType === 'token' && gitToken !== '') {
        body.token = gitToken;
      }
      const response = await apiFetch('/stacks/from-git', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (response.status === 409) {
          throw new Error(err?.error || 'Stack already exists.');
        }
        throw new Error(err?.error || 'Failed to create stack from Git.');
      }
      const data: {
        deployed?: boolean;
        deployError?: string;
        commitSha?: string;
        warnings?: string[];
      } = await response.json();
      const shortSha = typeof data.commitSha === 'string' ? data.commitSha.slice(0, 7) : '';
      const shaSuffix = shortSha ? ` @ ${shortSha}` : '';
      if (gitDeployNow && data.deployError) {
        toast.warning(`Stack created${shaSuffix}, but deploy failed: ${data.deployError}`);
      } else if (gitDeployNow && data.deployed) {
        toast.success(`Stack created and deployed from Git${shaSuffix}.`);
      } else {
        toast.success(`Stack created from Git${shaSuffix}.`);
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        toast.warning(data.warnings.join(' '));
      }
      setCreateDialogOpen(false);
      resetCreateFromGitForm();
      await refreshStacks();
      await loadFile(stackName);
    } catch (error) {
      console.error('Failed to create stack from Git:', error);
      toast.error((error as Error)?.message || 'Failed to create stack from Git.');
    } finally {
      toast.dismiss(loadingId);
      setCreatingFromGit(false);
    }
  };

  const resetCreateFromDockerRunForm = () => {
    setDockerRunInput('');
    setConvertedYaml(null);
    setIsConverting(false);
    setCreatingFromDockerRun(false);
  };

  const handleConvertDockerRun = async () => {
    const command = dockerRunInput.trim();
    if (!command) {
      toast.error('Paste a docker run command first.');
      return;
    }
    setIsConverting(true);
    try {
      const response = await apiFetch('/convert', {
        method: 'POST',
        body: JSON.stringify({ dockerRun: command }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Could not parse command.');
      }
      if (typeof data?.yaml !== 'string' || data.yaml.length === 0) {
        throw new Error('Converter returned an empty result.');
      }
      setConvertedYaml(data.yaml);
      toast.success('Converted to compose YAML.');
    } catch (error) {
      setConvertedYaml(null);
      const err = error as { message?: string; error?: string; data?: { error?: string } };
      toast.error(
        err?.message ||
          err?.error ||
          err?.data?.error ||
          'Failed to convert docker run command.',
      );
    } finally {
      setIsConverting(false);
    }
  };

  const handleCreateStackFromDockerRun = async () => {
    const stackName = newStackName.trim();
    if (!stackName) {
      toast.error('Stack name is required.');
      return;
    }
    if (!convertedYaml) {
      toast.error('Convert the command before creating the stack.');
      return;
    }
    setCreatingFromDockerRun(true);
    const loadingId = toast.loading('Creating stack from converted YAML...');
    let createdStack = false;
    try {
      const createResponse = await apiFetch('/stacks', {
        method: 'POST',
        body: JSON.stringify({ stackName }),
      });
      if (!createResponse.ok) {
        if (createResponse.status === 409) {
          throw new Error('Stack already exists.');
        }
        if (createResponse.status === 400) {
          throw new Error('Invalid stack name (use alphanumeric characters and hyphens only).');
        }
        throw new Error('Failed to create stack.');
      }
      createdStack = true;

      const saveResponse = await apiFetch(`/stacks/${encodeURIComponent(stackName)}`, {
        method: 'PUT',
        body: JSON.stringify({ content: convertedYaml }),
      });
      if (!saveResponse.ok) {
        // Roll back the empty stack we just created so we don't leave an orphan.
        await apiFetch(`/stacks/${encodeURIComponent(stackName)}`, { method: 'DELETE' }).catch((cleanupError) => {
          console.error('Failed to roll back orphan stack after save failure:', cleanupError);
        });
        createdStack = false;
        throw new Error('Could not save the converted YAML. Please try again.');
      }

      toast.success(`Stack "${stackName}" created from docker run.`);
      setCreateDialogOpen(false);
      resetCreateFromDockerRunForm();
      setNewStackName('');
      await refreshStacks();
      await loadFile(stackName);
    } catch (error) {
      console.error('Failed to create stack from docker run:', error);
      const err = error as { message?: string; error?: string; data?: { error?: string } };
      toast.error(
        err?.message ||
          err?.error ||
          err?.data?.error ||
          'Failed to create stack from docker run.',
      );
      // If we bailed before the createdStack flag got reset, surface that the stack still exists.
      if (createdStack) {
        await refreshStacks().catch(() => undefined);
      }
    } finally {
      toast.dismiss(loadingId);
      setCreatingFromDockerRun(false);
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

  // Safe container list with fallback
  const safeContainers = containers || [];
  // Safe content strings with fallback
  const safeContent = content || '';
  const safeEnvContent = envContent || '';

  // Stack state booleans for dynamic button rendering
  const isRunning = safeContainers?.some(c => c.State === 'running');

  // Stack name is now the same as selectedFile (no extension to strip)
  const stackName = selectedFile || '';

  // Filter files based on search query
  const filteredFiles = files.filter(file =>
    file.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get display name for stack (now just returns the name as-is since no extension)
  const getDisplayName = (stackName: string) => {
    return stackName;
  };

  const { pinned, pin, unpin, isPinned, evictedOldest } = usePinnedStacks(activeNode?.id);

  useEffect(() => {
    if (evictedOldest) toast.info('Pinned. Unpinned oldest (max 10).');
  }, [evictedOldest]);

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
      canDelete: can('stack:delete', 'stack', stackName),
      isPinned: isPinned(file),
      labels,
      assignedLabelIds: (stackLabelMap[file] ?? []).map(l => l.id),
      menuVisibility: getStackMenuVisibility(file),
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
      openLabelManager: () => { setSettingsInitialSection('labels'); setSettingsModalOpen(true); },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stackStatuses, stackPorts, isPaid, isPinned, labels, stackLabelMap,
    pin, unpin,
  ]);

  const createStackSlot = can('stack:create') ? (
    <Dialog open={createDialogOpen} onOpenChange={(o) => {
      setCreateDialogOpen(o);
      if (!o) {
        setCreateMode('empty');
        resetCreateFromGitForm();
        resetCreateFromDockerRunForm();
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-lg w-full">
          <Plus className="w-4 h-4 mr-2" />
          Create Stack
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl w-[95vw] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>Create New Stack</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new stack: empty, cloned from a Git repository, or converted from a docker run command.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-2">
          <Tabs value={createMode} onValueChange={(v) => setCreateMode(v as 'empty' | 'git' | 'docker-run')}>
            <TabsList>
              <TabsHighlight className="rounded-md bg-glass-highlight" transition={springs.snappy}>
                <TabsHighlightItem value="empty">
                  <TabsTrigger value="empty">
                    <Plus className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
                    Empty
                  </TabsTrigger>
                </TabsHighlightItem>
                <TabsHighlightItem value="git">
                  <TabsTrigger value="git">
                    <GitBranch className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
                    From Git
                  </TabsTrigger>
                </TabsHighlightItem>
                <TabsHighlightItem value="docker-run">
                  <TabsTrigger value="docker-run">
                    <FileCode2 className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
                    From Docker Run
                  </TabsTrigger>
                </TabsHighlightItem>
              </TabsHighlight>
            </TabsList>
          </Tabs>
        </div>

        {createMode === 'empty' && (
          <>
            <div className="px-6 py-4 space-y-2">
              <Label htmlFor="create-stack-name">Stack Name</Label>
              <Input
                id="create-stack-name"
                placeholder="Stack name (e.g., myapp)"
                value={newStackName}
                onChange={(e) => setNewStackName(e.target.value)}
              />
            </div>
            <DialogFooter className="px-6 pb-6">
              <Button onClick={handleCreateStack}>Create</Button>
            </DialogFooter>
          </>
        )}
        {createMode === 'git' && (
          <>
            <ScrollArea className="max-h-[70vh]">
              <div className="px-6 py-4 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="create-git-stack-name">Stack Name</Label>
                  <Input
                    id="create-git-stack-name"
                    placeholder="Stack name (e.g., myapp)"
                    value={newStackName}
                    onChange={(e) => setNewStackName(e.target.value)}
                    disabled={creatingFromGit}
                  />
                </div>

                <GitSourceFields
                  variant="create"
                  disabled={creatingFromGit}
                  repoUrl={gitRepoUrl}
                  branch={gitBranch}
                  composePath={gitComposePath}
                  syncEnv={gitSyncEnv}
                  authType={gitAuthType}
                  token={gitToken}
                  hasStoredToken={false}
                  applyMode={gitApplyMode}
                  onRepoUrlChange={setGitRepoUrl}
                  onBranchChange={setGitBranch}
                  onComposePathChange={setGitComposePath}
                  onSyncEnvChange={setGitSyncEnv}
                  onAuthTypeChange={setGitAuthType}
                  onTokenChange={setGitToken}
                  onApplyModeChange={setGitApplyMode}
                />

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="create-git-deploy-now"
                    checked={gitDeployNow}
                    onCheckedChange={(c) => setGitDeployNow(c === true)}
                    disabled={creatingFromGit}
                  />
                  <Label htmlFor="create-git-deploy-now" className="text-xs cursor-pointer">
                    Deploy after create
                  </Label>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="px-6 py-4 border-t border-glass-border">
              <Button onClick={handleCreateStackFromGit} disabled={creatingFromGit}>
                {creatingFromGit ? (
                  <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" strokeWidth={1.5} />Creating</>
                ) : (
                  <><GitBranch className="w-4 h-4 mr-1.5" strokeWidth={1.5} />Create from Git</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
        {createMode === 'docker-run' && (
          <>
            <ScrollArea className="max-h-[70vh]">
              <div className="px-6 py-4 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="create-dr-stack-name">Stack Name</Label>
                  <Input
                    id="create-dr-stack-name"
                    placeholder="Stack name (e.g., myapp)"
                    value={newStackName}
                    onChange={(e) => setNewStackName(e.target.value)}
                    disabled={creatingFromDockerRun}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-dr-command">Paste your docker run command</Label>
                  <textarea
                    id="create-dr-command"
                    spellCheck={false}
                    className="flex w-full rounded-md border border-glass-border bg-input px-3 py-2 text-sm font-mono shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[120px] resize-y"
                    placeholder="docker run -d --name nginx -p 8080:80 nginx:latest"
                    value={dockerRunInput}
                    onChange={(e) => {
                      setDockerRunInput(e.target.value);
                      // The preview only reflects the previous command; clear it when
                      // the input changes so the user can't create a stack from stale YAML.
                      if (convertedYaml !== null) setConvertedYaml(null);
                    }}
                    disabled={creatingFromDockerRun}
                  />
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleConvertDockerRun}
                      disabled={isConverting || creatingFromDockerRun || !dockerRunInput.trim()}
                    >
                      {isConverting ? (
                        <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" strokeWidth={1.5} />Converting</>
                      ) : (
                        <><FileCode2 className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />Convert</>
                      )}
                    </Button>
                  </div>
                </div>
                {convertedYaml !== null && (
                  <div className="space-y-2">
                    <Label>compose.yaml preview</Label>
                    <ScrollArea className="max-h-[240px] rounded-md border border-card-border border-t-card-border-top bg-card shadow-card-bevel">
                      <pre className="px-3 py-2 text-xs font-mono whitespace-pre leading-relaxed">
                        {convertedYaml}
                      </pre>
                    </ScrollArea>
                  </div>
                )}
              </div>
            </ScrollArea>
            <DialogFooter className="px-6 py-4 border-t border-glass-border">
              <Button
                onClick={handleCreateStackFromDockerRun}
                disabled={creatingFromDockerRun || !convertedYaml || !newStackName.trim()}
              >
                {creatingFromDockerRun ? (
                  <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" strokeWidth={1.5} />Creating</>
                ) : (
                  <><Plus className="w-4 h-4 mr-1.5" strokeWidth={1.5} />Create Stack</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
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
            onManageNodes={() => { setSettingsInitialSection('nodes'); setSettingsModalOpen(true); }}
          />
        }
        createStackSlot={createStackSlot}
        onScan={handleScanStacks}
        isScanning={isScanning}
        canCreate={can('stack:create')}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        list={{
          files: filteredFiles ?? [],
          isLoading,
          isPaid,
          selectedFile,
          searchQuery,
          stackLabelMap,
          stackStatuses: stackStatuses as Record<string, StackRowStatus | undefined>,
          stackUpdates,
          gitSourcePendingMap,
          labels,
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
              onOpenSettings={() => setSettingsModalOpen(true)}
            />
          }
        />

        {/* Main Workspace */}
        <div key={activeView} className="flex-1 overflow-y-auto p-6 animate-fade-up">
          {activeView === 'templates' ? (
            <AppStoreView onDeploySuccess={(stackName) => { refreshStacks(); loadFile(stackName); }} />
          ) : activeView === 'resources' ? (
            <ResourcesView />
          ) : activeView === 'host-console' ? (
            <AdmiralGate featureName="Host Console">
              <CapabilityGate capability="host-console" featureName="Host Console">
                <HostConsole stackName={selectedFile} onClose={() => setActiveView(selectedFile ? 'editor' : 'dashboard')} />
              </CapabilityGate>
            </AdmiralGate>
          ) : !isLoading && selectedFile && activeView === 'editor' ? (
            <ErrorBoundary>
              <div className="grid gap-6 grid-cols-1 lg:grid-cols-2 min-h-[600px] h-[calc(100vh-160px)] max-h-[1040px]">
                {/* Left column: identity + health strip + logs, stacked */}
                <div className="flex flex-col gap-6 min-h-0">
                  {/* Command Center Card (identity + health strip) */}
                  <Card className="rounded-xl border-muted bg-card shrink-0">
                    <CardHeader className="p-4 pb-2">
                      <div className="flex flex-col gap-3">
                        {/* Identity block */}
                        <div className="flex flex-col gap-1.5">
                          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-stat-subtitle">
                            {(activeNode?.name || 'local')} <span className="text-muted-foreground/60">›</span> stacks <span className="text-muted-foreground/60">›</span> {stackName}
                          </div>
                          <div className="flex items-center gap-3 flex-wrap">
                            <CardTitle className="font-display italic text-3xl leading-none tracking-tight">{stackName}</CardTitle>
                            {(() => {
                              const pill = getStackStatePill(safeContainers);
                              if (!pill) return null;
                              return (
                                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${pill.className}`}>
                                  <span
                                    aria-hidden="true"
                                    className={`h-1.5 w-1.5 rounded-full ${pill.dotClass} ${pill.pulse ? 'animate-[pulse_2.4s_ease-in-out_infinite]' : ''}`}
                                  />
                                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">{pill.label}</span>
                                </span>
                              );
                            })()}
                          </div>
                          {(() => {
                            const first = safeContainers[0];
                            if (!first?.Image) return null;
                            const digest = first.ImageID ? first.ImageID.replace(/^sha256:/, '').slice(0, 12) : '';
                            return (
                              <div className="flex items-center gap-1.5 font-mono text-[11px] text-stat-subtitle">
                                <span>image <span className="text-muted-foreground/60">·</span> <span className="text-foreground/90">{first.Image}</span></span>
                                {digest && first.ImageID && (
                                  <>
                                    <span className="text-muted-foreground/60">·</span>
                                    <span>digest <span className="text-foreground/90">{digest}</span></span>
                                    <button
                                      type="button"
                                      aria-label={copiedDigest === first.ImageID ? 'Copied' : 'Copy digest'}
                                      onClick={() => {
                                        const id = first.ImageID as string;
                                        void copyToClipboard(id).then(() => {
                                          setCopiedDigest(id);
                                          if (copiedDigestTimerRef.current !== null) {
                                            window.clearTimeout(copiedDigestTimerRef.current);
                                          }
                                          copiedDigestTimerRef.current = window.setTimeout(() => {
                                            setCopiedDigest(prev => (prev === id ? null : prev));
                                            copiedDigestTimerRef.current = null;
                                          }, 1500);
                                        }).catch(() => { /* clipboard unavailable */ });
                                      }}
                                      className="inline-flex h-4 w-4 items-center justify-center rounded text-stat-subtitle hover:text-foreground hover:bg-muted/60 transition-colors"
                                    >
                                      {copiedDigest === first.ImageID ? (
                                        <Check className="h-3 w-3" strokeWidth={2} />
                                      ) : (
                                        <Copy className="h-3 w-3" strokeWidth={1.5} />
                                      )}
                                    </button>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        {/* Action Bar */}
                        {can('stack:deploy', 'stack', stackName) && (
                          <div className="flex items-center gap-2 flex-wrap">
                            {isRunning ? (
                              <Button type="button" size="sm" className="rounded-lg bg-brand text-brand-foreground hover:bg-brand/90" onClick={restartStack} disabled={loadingAction !== null}>
                                <RotateCw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                {loadingAction === 'restart' ? 'Restarting...' : 'Restart'}
                              </Button>
                            ) : (
                              <Button type="button" size="sm" className="rounded-lg bg-brand text-brand-foreground hover:bg-brand/90" onClick={deployStack} disabled={loadingAction !== null}>
                                <Play className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                {loadingAction === 'deploy' ? 'Starting...' : 'Start'}
                              </Button>
                            )}
                            {isRunning && (
                              <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={stopStack} disabled={loadingAction !== null}>
                                <Square className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                {loadingAction === 'stop' ? 'Stopping...' : 'Stop'}
                              </Button>
                            )}
                            <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={updateStack} disabled={loadingAction !== null}>
                              <CloudDownload className="w-4 h-4 mr-2" strokeWidth={1.5} />
                              {loadingAction === 'update' ? 'Updating...' : 'Update'}
                            </Button>
                            {(() => {
                              const canRollback = isPaid && backupInfo.exists;
                              const canScan = trivy.available && isAdmin && isPaid;
                              const hasOverflowExtras = canRollback || canScan;
                              return (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" size="sm" variant="ghost" className="rounded-lg h-8 w-8 p-0" disabled={loadingAction !== null} aria-label="More actions">
                                  <MoreVertical className="w-4 h-4" strokeWidth={1.5} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                {canRollback && (
                                  <DropdownMenuItem onClick={rollbackStack} disabled={loadingAction !== null}>
                                    <Undo2 className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                    <div className="flex flex-col gap-0.5">
                                      <span>{loadingAction === 'rollback' ? 'Rolling back...' : 'Rollback'}</span>
                                      {backupInfo.timestamp && (
                                        <span className="text-[10px] text-stat-subtitle font-mono">{new Date(backupInfo.timestamp).toLocaleString()}</span>
                                      )}
                                    </div>
                                  </DropdownMenuItem>
                                )}
                                {canScan && (
                                  <DropdownMenuItem onClick={scanStackConfig} disabled={loadingAction !== null || stackMisconfigScanning}>
                                    {stackMisconfigScanning ? (
                                      <Loader2 className="w-4 h-4 mr-2 animate-spin" strokeWidth={1.5} />
                                    ) : (
                                      <ShieldCheck className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                    )}
                                    {stackMisconfigScanning ? 'Scanning...' : 'Scan config'}
                                  </DropdownMenuItem>
                                )}
                                {hasOverflowExtras && <DropdownMenuSeparator />}
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                  disabled={loadingAction !== null}
                                  onClick={() => {
                                    setStackToDelete(selectedFile);
                                    setDeleteDialogOpen(true);
                                  }}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                  {loadingAction === 'delete' ? 'Deleting...' : 'Delete'}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-2">
                      {/* Per-container health strip */}
                      <div className="mt-4">
                        <h4 className="text-sm font-medium text-muted-foreground mb-3">CONTAINERS</h4>
                        {safeContainers.length === 0 ? (
                          <div className="text-muted-foreground text-sm">No containers running for this stack.</div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {safeContainers.map(container => {
                              let mainPort: number | undefined;
                              let mainPortPrivate: number | undefined;
                              let mainPortProto: string | undefined;
                              if (container.Ports && container.Ports.length > 0) {
                                const WEB_UI_PORTS = [32400, 8989, 7878, 9696, 5055, 8080, 80, 443, 3000, 9000];
                                const IGNORE_PORTS = [1900, 53, 22];
                                let match = container.Ports.find(p => WEB_UI_PORTS.includes(p.PrivatePort));
                                if (!match) match = container.Ports.find(p => WEB_UI_PORTS.includes(p.PublicPort));
                                if (!match) match = container.Ports.find(p => !IGNORE_PORTS.includes(p.PrivatePort) && !IGNORE_PORTS.includes(p.PublicPort));
                                const chosen = match || container.Ports[0];
                                mainPort = chosen.PublicPort;
                                mainPortPrivate = chosen.PrivatePort;
                                mainPortProto = 'tcp';
                              }

                              const containerName = container?.Names?.[0]?.replace(/^\//, '') || container?.Id?.slice(0, 12) || 'container';
                              const isRunning = container.State === 'running';
                              const health = container.healthStatus;
                              const uptime = isRunning ? extractUptime(container.Status) : null;
                              const hcLabel = healthcheckLabel(health);
                              const stats = containerStats[container?.Id];
                              const history = stats?.history;

                              const badgeClass = health === 'unhealthy' || !isRunning
                                ? 'bg-destructive text-destructive-foreground'
                                : health === 'starting'
                                  ? 'bg-warning text-warning-foreground'
                                  : 'bg-success text-success-foreground';
                              const badgeGlyph = health === 'unhealthy' || !isRunning ? '✗' : health === 'starting' ? '…' : '✓';
                              const sparkStroke = health === 'unhealthy' ? 'var(--destructive)' : health === 'starting' ? 'var(--warning)' : 'var(--chart-1)';

                              return (
                                <div key={container?.Id || Math.random()} className="rounded-lg border border-muted bg-muted/30 px-3 py-2.5">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3 min-w-0 flex-1">
                                      <div className={cn('mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', badgeClass)}>
                                        {badgeGlyph}
                                      </div>
                                      <div className="flex min-w-0 flex-col gap-0.5">
                                        <div className="truncate font-mono text-sm text-foreground">{containerName}</div>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-stat-subtitle">
                                          {uptime ? <span>{uptime}</span> : <span>{(container.State || 'unknown').toLowerCase()}</span>}
                                          {hcLabel ? <><span>·</span><span>{hcLabel}</span></> : null}
                                          {mainPort && mainPortPrivate ? (
                                            <>
                                              <span>·</span>
                                              <span>{mainPort} → {mainPortPrivate}/{mainPortProto}</span>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const host = activeNode?.type === 'remote' && activeNode?.api_url
                                                    ? new URL(activeNode.api_url).hostname
                                                    : window.location.hostname;
                                                  window.open(`http://${host}:${mainPort}`, '_blank');
                                                }}
                                                className="inline-flex items-center gap-1 text-brand hover:underline"
                                              >
                                                open <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
                                              </button>
                                            </>
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 rounded-md"
                                        onClick={() => openLogViewer(container?.Id, containerName)}
                                        disabled={!isRunning}
                                        aria-label="View logs"
                                      >
                                        <ScrollText className="h-3.5 w-3.5" strokeWidth={1.5} />
                                      </Button>
                                      {isAdmin && (
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-7 w-7 rounded-md"
                                          onClick={() => openBashModal(container?.Id, containerName)}
                                          disabled={!isRunning}
                                          aria-label="Open bash shell"
                                        >
                                          <Terminal className="h-3.5 w-3.5" strokeWidth={1.5} />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  {isRunning ? (
                                    <div className="mt-2 grid grid-cols-3 gap-2">
                                      <div className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5">
                                        <div className="flex flex-col">
                                          <span className="font-mono text-[9px] uppercase tracking-wide text-stat-subtitle">cpu</span>
                                          <span className="font-mono text-xs tabular-nums text-foreground">{stats?.cpu ?? '-'}</span>
                                        </div>
                                        <div className="ml-auto h-5 w-16">
                                          <Sparkline points={history?.cpu ?? []} stroke={sparkStroke} fill={sparkStroke} showPeak={false} />
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5">
                                        <div className="flex flex-col">
                                          <span className="font-mono text-[9px] uppercase tracking-wide text-stat-subtitle">mem</span>
                                          <span className="font-mono text-xs tabular-nums text-foreground">{stats?.ram ?? '-'}</span>
                                        </div>
                                        <div className="ml-auto h-5 w-16">
                                          <Sparkline points={history?.mem ?? []} stroke={sparkStroke} fill={sparkStroke} showPeak={false} />
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5">
                                        <div className="flex flex-col">
                                          <span className="font-mono text-[9px] uppercase tracking-wide text-stat-subtitle">net i/o</span>
                                          <span className="font-mono text-xs tabular-nums text-foreground">{stats?.net ?? '-'}</span>
                                        </div>
                                        <div className="ml-auto h-5 w-16">
                                          <Sparkline points={history?.netIn ?? []} stroke={sparkStroke} fill={sparkStroke} showPeak={false} />
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Logs Section (fills remaining left-column height) */}
                  <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-stat-subtitle">Logs</h3>
                      <div className="inline-flex rounded-md border border-muted bg-muted/30 p-0.5">
                        <button
                          type="button"
                          onClick={() => setLogsMode('structured')}
                          className={cn(
                            'rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors',
                            logsMode === 'structured' ? 'bg-brand/15 text-brand' : 'text-stat-subtitle hover:text-foreground',
                          )}
                        >
                          Structured
                        </button>
                        <button
                          type="button"
                          onClick={() => setLogsMode('raw')}
                          className={cn(
                            'rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors',
                            logsMode === 'raw' ? 'bg-brand/15 text-brand' : 'text-stat-subtitle hover:text-foreground',
                          )}
                        >
                          Raw terminal
                        </button>
                      </div>
                    </div>
                    {logsMode === 'structured' ? (
                      <ErrorBoundary>
                        <StructuredLogViewer stackName={stackName} />
                      </ErrorBoundary>
                    ) : (
                      <div className="flex-1 rounded-xl overflow-hidden border border-muted bg-black p-3 shadow-[inset_0_2px_4px_0_oklch(0_0_0/0.4)]">
                        <div className="h-full">
                          <ErrorBoundary>
                            <TerminalComponent stackName={stackName} />
                          </ErrorBoundary>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right column: anatomy panel by default, Monaco editor when editing */}
                {editingCompose ? (
                <Card className="rounded-xl border-muted overflow-hidden flex flex-col h-full min-h-0 bg-card">
                  <div className="p-4 border-b border-muted flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'compose' | 'env')}>
                        <TabsList>
                          <TabsHighlight className="rounded-md bg-glass-highlight" transition={springs.snappy}>
                            <TabsHighlightItem value="compose">
                              <TabsTrigger value="compose">compose.yaml</TabsTrigger>
                            </TabsHighlightItem>
                            <TabsHighlightItem value="env">
                              <TabsTrigger value="env" disabled={!envExists}>.env</TabsTrigger>
                            </TabsHighlightItem>
                          </TabsHighlight>
                        </TabsList>
                      </Tabs>

                      {activeTab === 'env' && envFiles.length > 1 && (
                        <Select value={selectedEnvFile} onValueChange={changeEnvFile} disabled={isEditing || isFileLoading}>
                          <SelectTrigger className="h-9 text-xs bg-muted border-none min-w-[200px]">
                            <SelectValue placeholder="Select environment file" />
                          </SelectTrigger>
                          <SelectContent>
                            {envFiles.map((file) => (
                              <SelectItem key={file} value={file} className="text-xs">
                                {file.split('/').pop()}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {can('stack:edit', 'stack', stackName) && (
                        <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-lg relative"
                          onClick={() => setGitSourceOpen(true)}
                        >
                          <GitBranch className="w-4 h-4 mr-2" strokeWidth={1.5} />
                          Git Source
                          {gitSourcePendingMap[stackName] && (
                            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-brand animate-pulse" />
                          )}
                        </Button>
                        {!isEditing ? (
                          <Button size="sm" variant="default" className="rounded-lg" onClick={enterEditMode}>
                            <Pencil className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                        ) : (
                          <div className="flex items-center">
                            <Button size="sm" variant="default" className="rounded-l-lg rounded-r-none" onClick={handleSaveAndDeploy} disabled={loadingAction === 'deploy'}>
                              <Rocket className="w-4 h-4 mr-2" strokeWidth={1.5} />
                              Save & Deploy
                            </Button>
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="default" className="rounded-r-lg rounded-l-none border-l border-primary-foreground/20 px-1.5" disabled={loadingAction === 'deploy'}>
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={saveFile}>
                                  <Save className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                  Save Only
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={discardChanges} className="text-destructive/80 focus:text-destructive">
                                  <X className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                  Discard Changes
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-lg h-8 w-8 p-0"
                        onClick={() => {
                          if (isEditing) {
                            discardChanges();
                          }
                          setEditingCompose(false);
                        }}
                        aria-label="Close editor"
                      >
                        <X className="w-4 h-4" strokeWidth={1.5} />
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col">
                    {activeTab === 'env' && (
                      <div className="bg-info-muted border-b border-info/20 px-4 py-2 flex items-center gap-2 text-xs text-info">
                        <span>
                          Variables defined here are automatically available for substitution in your compose.yaml (e.g., <code className="bg-background px-1 rounded text-[10px]">${'{}'}VAR</code>). To pass them directly into your container, you must add <code className="bg-background px-1 rounded text-[10px]">env_file: - .env</code> to your service definition.
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-h-0 overflow-hidden">
                      {!isFileLoading && (
                        <Editor
                          height="100%"
                          language={activeTab === 'compose' ? 'yaml' : 'plaintext'}
                          theme={isDarkMode ? 'vs-dark' : 'vs'}
                          value={activeTab === 'compose' ? safeContent : safeEnvContent}
                          onMount={(editor) => { monacoEditorRef.current = editor; }}
                          onChange={(value) => {
                            if (!isEditing) return; // Prevent changes in view mode
                            if (activeTab === 'compose') {
                              setContent(value || '');
                            } else {
                              setEnvContent(value || '');
                            }
                          }}
                          options={{
                            minimap: { enabled: false },
                            fontFamily: "'Geist Mono', monospace",
                            fontSize: 14,
                            padding: { top: 10 },
                            scrollBeyondLastLine: false,
                            readOnly: !isEditing || !can('stack:edit', 'stack', stackName),
                          }}
                        />
                      )}
                      {isFileLoading && (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                          Loading...
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
                ) : (
                <StackAnatomyPanel
                  stackName={stackName}
                  content={content}
                  envContent={envContent}
                  selectedEnvFile={selectedEnvFile}
                  gitSourcePending={Boolean(gitSourcePendingMap[stackName])}
                  onEditCompose={() => setEditingCompose(true)}
                  onOpenGitSource={() => setGitSourceOpen(true)}
                  onApplyUpdate={() => { void updateStack(); }}
                  canEdit={can('stack:edit', 'stack', stackName)}
                />
                )}
              </div>
            </ErrorBoundary>
          ) : activeView === 'global-observability' ? (
            <GlobalObservabilityView />
          ) : activeView === 'fleet' ? (
            <CapabilityGate capability="fleet" featureName="Fleet Management">
              <FleetView onNavigateToNode={(nodeId, stackName) => {
                const node = nodes.find(n => n.id === nodeId);
                if (node) {
                  if (activeNode?.id === nodeId) {
                    loadFile(stackName);
                  } else {
                    pendingStackLoadRef.current = stackName;
                    setActiveNode(node);
                  }
                }
              }} />
            </CapabilityGate>
          ) : activeView === 'audit-log' ? (
            <CapabilityGate capability="audit-log" featureName="Audit Log">
              <AuditLogView />
            </CapabilityGate>
          ) : activeView === 'auto-updates' ? (
            <CapabilityGate capability="auto-updates" featureName="Auto-Update Readiness">
              <AutoUpdateReadinessView />
            </CapabilityGate>
          ) : activeView === 'scheduled-ops' ? (
            <CapabilityGate capability="scheduled-ops" featureName="Scheduled Operations">
              <ScheduledOperationsView filterNodeId={filterNodeId} onClearFilter={() => setFilterNodeId(null)} />
            </CapabilityGate>
          ) : (
            <HomeDashboard
              onNavigateToStack={(stackFile) => { loadFile(stackFile); }}
              notifications={notifications}
              onClearNotifications={clearAllNotifications}
            />
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Stack</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {stackToDelete}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deleteStack}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingUnsavedLoad} onOpenChange={(open) => { if (!open) { setPendingUnsavedLoad(null); setPendingUnsavedNode(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Switching stacks will discard them. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPendingUnsavedLoad(null); setPendingUnsavedNode(null); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const target = pendingUnsavedLoad;
              const targetNode = pendingUnsavedNode;
              // Reset content to original so the guard doesn't re-trigger
              setContent(originalContent);
              setEnvContent(originalEnvContent);
              setPendingUnsavedLoad(null);
              setPendingUnsavedNode(null);
              if (target) {
                if (targetNode) loadFileOnNode(targetNode, target);
                else loadFile(target);
              }
            }}>Discard Changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkActionOpen} onOpenChange={setBulkActionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction.charAt(0).toUpperCase() + bulkAction.slice(1)} all &ldquo;{bulkActionLabel?.name}&rdquo; stacks?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will {bulkAction} all stacks labeled &ldquo;{bulkActionLabel?.name}&rdquo;.
              {stackLabelMap && bulkActionLabel && (
                <span className="block mt-2 font-mono text-xs">
                  Affected: {Object.entries(stackLabelMap)
                    .filter(([, ls]) => ls.some(l => l.id === bulkActionLabel.id))
                    .map(([name]) => name)
                    .join(', ') || 'none'}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkActionRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkActionRunning}
              onClick={async (e) => {
                e.preventDefault();
                if (!bulkActionLabel) return;
                setBulkActionRunning(true);
                try {
                  const res = await apiFetch(`/labels/${bulkActionLabel.id}/action`, {
                    method: 'POST',
                    body: JSON.stringify({ action: bulkAction }),
                  });
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data?.error || `Bulk ${bulkAction} failed.`);
                  }
                  const data = await res.json();
                  const failed = (data.results ?? []).filter((r: BulkActionResult) => !r.success);
                  if (failed.length > 0) {
                    const failedNames = failed.map((r: BulkActionResult) => r.stackName).join(', ');
                    toast.error(`Failed to ${bulkAction}: ${failedNames}`);
                  } else {
                    toast.success(`All stacks ${bulkAction === 'deploy' ? 'deployed' : bulkAction === 'stop' ? 'stopped' : 'restarted'} successfully.`);
                  }
                  setBulkActionOpen(false);
                  refreshStacks(true);
                } catch (err: unknown) {
                  toast.error((err as Error)?.message || 'Something went wrong.');
                } finally {
                  setBulkActionRunning(false);
                }
              }}
            >
              {bulkActionRunning ? 'Running...' : `${bulkAction.charAt(0).toUpperCase() + bulkAction.slice(1)} All`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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


      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => { setSettingsModalOpen(false); setSettingsInitialSection('account'); }}
        initialSection={settingsInitialSection}
        onLabelsChanged={refreshLabels}
      />

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

      {/* Scan history overlay */}
      <SecurityHistoryView
        open={securityHistoryOpen}
        onClose={() => setSecurityHistoryOpen(false)}
      />
    </div>
    </GlobalCommandPaletteProvider>
  );
}
