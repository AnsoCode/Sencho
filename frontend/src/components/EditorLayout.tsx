import { useState, useEffect, useRef, useMemo } from 'react';

type Theme = 'light' | 'dark' | 'auto';
import Editor from '@monaco-editor/react';
import TerminalComponent from './Terminal';
import ErrorBoundary from './ErrorBoundary';
import HomeDashboard from './HomeDashboard';
import BashExecModal from './BashExecModal';
import HostConsole from './HostConsole';
import { AdmiralGate } from './AdmiralGate';
import ResourcesView from './ResourcesView';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsHighlight, TabsHighlightItem } from './ui/tabs';
import { springs } from '@/lib/motion';
import { Highlight, HighlightItem } from './animate-ui/primitives/effects/highlight';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Plus, Trash2, Play, Square, Save, Terminal, RotateCw, CloudDownload, Pencil, X, Home, ExternalLink, Bell, MoreVertical, BellRing, Rocket, HardDrive, ScrollText, Activity, Server, Radar, Undo2, RefreshCw, Download, Clock, Menu, FolderSearch, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { UserProfileDropdown } from './UserProfileDropdown';
import { apiFetch, fetchForNode } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { Label } from './ui/label';
import { Command, CommandInput, CommandList, CommandItem } from './ui/command';
import { ScrollArea } from './ui/scroll-area';
import { Skeleton } from './ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';
import { cn } from '@/lib/utils';
import { SettingsModal } from './SettingsModal';
import { StackAlertSheet } from './StackAlertSheet';
import { AppStoreView } from './AppStoreView';
import { LogViewer } from './LogViewer';
import { GlobalObservabilityView } from './GlobalObservabilityView';
import { FleetView } from './FleetView';
import { AuditLogView } from './AuditLogView';
import ScheduledOperationsView from './ScheduledOperationsView';
import AutoUpdatePoliciesView from './AutoUpdatePoliciesView';
import { useNodes } from '@/context/NodeContext';
import type { Node } from '@/context/NodeContext';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';

interface ContainerInfo {
  Id: string;
  Names: string[];
  State: string;
  Status?: string;
  Ports?: { PrivatePort: number, PublicPort: number }[];
}

interface StackStatus {
  [key: string]: 'running' | 'exited' | 'unknown';
}

interface Notification {
  id: number;
  level: 'info' | 'warning' | 'error';
  message: string;
  timestamp: number;
  is_read: number; // 0 | 1 (SQLite boolean)
  nodeId: number;
  nodeName: string;
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
  const { isPro, license } = useLicense();
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
  const [containerStats, setContainerStats] = useState<Record<string, { cpu: string, ram: string, net: string, lastRx?: number, lastTx?: number }>>({});
  // Incoming WebSocket stats are written here first (no re-render), then flushed
  // to React state in one batched update every 1.5 s.
  const pendingStatsRef = useRef<Record<string, { cpu: string; ram: string; net: string; lastRx: number; lastTx: number }>>({});
  // Raw rx/tx byte totals used for rate calculation. Never cleared on flush so
  // the delta is always computed against the most recent known value, avoiding
  // the stale-closure bug that occurs when reading containerStats directly.
  const rawBytesRef = useRef<Record<string, { lastRx: number; lastTx: number }>>({});
  const [activeTab, setActiveTab] = useState<'compose' | 'env'>('compose');
  const monacoEditorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);
  const pendingStackLoadRef = useRef<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newStackName, setNewStackName] = useState('');
  const [stackToDelete, setStackToDelete] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
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
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stackStatuses, setStackStatuses] = useState<StackStatus>({});

  // Bash exec modal state
  const [bashModalOpen, setBashModalOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<{ id: string; name: string } | null>(null);

  // LogViewer state
  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [logContainer, setLogContainer] = useState<{ id: string; name: string } | null>(null);


  // Image update checker state
  const [stackUpdates, setStackUpdates] = useState<Record<string, boolean>>({});

  // Notifications & Settings state
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [alertSheetOpen, setAlertSheetOpen] = useState(false);
  const [alertSheetStack, setAlertSheetStack] = useState('');

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
    if (isPro && isAdmin) {
      items.push({ value: 'auto-updates', label: 'Auto-Update', icon: RefreshCw });
    }
    if (isPro && license?.variant === 'team') {
      if (isAdmin) items.push({ value: 'host-console', label: 'Console', icon: Terminal });
      if (can('system:audit')) items.push({ value: 'audit-log', label: 'Audit', icon: ScrollText });
      if (isAdmin) items.push({ value: 'scheduled-ops', label: 'Schedules', icon: Clock });
    }
    return items;
  }, [isAdmin, isPro, license?.variant, can]);

  // Only highlight a tab if activeView matches a nav item
  const navTabValue = navItems.some(i => i.value === activeView) ? activeView : undefined;

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

  // Navigation handler with toggle support
  const handleNavigate = (value: string) => {
    if (value === activeView) {
      // Toggle off: return to editor if a file is open, else dashboard
      setActiveView(selectedFile ? 'editor' : 'dashboard');
    } else if (value === 'dashboard') {
      resetEditorState();
      setActiveView('dashboard');
    } else {
      setActiveView(value as typeof activeView);
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

      // Fetch status for all stacks in parallel
      const statusResults = await Promise.allSettled(
        fileList.map(async (file) => {
          const containersRes = await apiFetch(`/stacks/${file}/containers`);
          const containers = await containersRes.json();
          const hasRunning = Array.isArray(containers) && containers.some((c: ContainerInfo) => c.State === 'running');
          return { file, status: hasRunning ? 'running' as const : (Array.isArray(containers) && containers.length > 0 ? 'exited' as const : 'unknown' as const) };
        })
      );
      const statuses: StackStatus = {};
      for (const result of statusResults) {
        if (result.status === 'fulfilled') {
          statuses[result.value.file] = result.value.status;
        }
      }
      setStackStatuses(statuses);
      return fileList;
    } catch (error) {
      console.error('Failed to refresh stacks:', error);
      setFiles([]);
      return [];
    } finally {
      setIsLoading(false);
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
        retryCount = 0; // Reset backoff on successful connect
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'notification' && msg.payload) {
            const localNode = nodesRef.current.find(n => n.type === 'local');
            const tagged: Notification = {
              ...(msg.payload as Omit<Notification, 'nodeId' | 'nodeName'>),
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
                [{ ...msg.payload as Omit<Notification, 'nodeId' | 'nodeName'>, nodeId: rn.id, nodeName: current?.name ?? rn.name }, ...prev]
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

      const all: Notification[] = [];

      if (localResult.status === 'fulfilled' && localResult.value.ok) {
        const data = await localResult.value.json() as Omit<Notification, 'nodeId' | 'nodeName'>[];
        data.forEach(n => all.push({ ...n, nodeId: localNode?.id ?? -1, nodeName: localNode?.name ?? 'Local' }));
      }

      for (let i = 0; i < remoteNodes.length; i++) {
        const result = remoteResults[i];
        if (result?.status === 'fulfilled' && result.value.ok) {
          const data = await result.value.json() as Omit<Notification, 'nodeId' | 'nodeName'>[];
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
      const unreadNodeIds = [...new Set(notifications.filter(n => !n.is_read).map(n => n.nodeId))];
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

  const deleteNotification = async (notif: Notification) => {
    try {
      const localNode = nodesRef.current.find(n => n.type === 'local');
      if (notif.nodeId === localNode?.id) {
        await apiFetch(`/notifications/${notif.id}`, { method: 'DELETE', localOnly: true });
      } else {
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
      const uniqueNodeIds = [...new Set(notifications.map(n => n.nodeId))];
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
        let hasChanges = false;
        const next = { ...prev };
        for (const [id, newStats] of Object.entries(pending)) {
          const old = prev[id];
          if (!old || old.cpu !== newStats.cpu || old.ram !== newStats.ram || old.net !== newStats.net) {
            next[id] = newStats;
            hasChanges = true;
          }
        }
        return hasChanges ? next : prev;
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

  const loadFile = async (filename: string) => {
    if (!filename) return;
    setIsFileLoading(true);
    setIsEditing(false); // Reset to view mode when loading a new file
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

      // Load backup info (Pro only)
      if (isPro) {
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

  const changeEnvFile = async (file: string) => {
    setSelectedEnvFile(file);
    setIsFileLoading(true);
    try {
      const res = await apiFetch(`/stacks/${selectedFile}/env?file=${encodeURIComponent(file)}`);
      const text = await res.text();
      setEnvContent(text || '');
      setOriginalEnvContent(text || '');
    } catch (e) {
      console.error('Failed to switch env file', e);
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
    if (!selectedFile || loadingAction !== null) return;
    setLoadingAction('rollback');
    try {
      const res = await apiFetch(`/stacks/${selectedFile}/rollback`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Rollback failed');
      }
      toast.success('Stack rolled back successfully.');
      // Reload the editor content
      const contentRes = await apiFetch(`/stacks/${selectedFile}`);
      const text = await contentRes.text();
      setContent(text || '');
      setOriginalContent(text || '');
      // Refresh backup info
      const backupRes = await apiFetch(`/stacks/${selectedFile}/backup`);
      if (backupRes.ok) setBackupInfo(await backupRes.json());
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Rollback failed';
      toast.error(msg);
    } finally {
      setLoadingAction(null);
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

  const deployStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || loadingAction !== null) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setLoadingAction('deploy');
    try {
      const response = await apiFetch(`/stacks/${stackName}/deploy`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Deploy failed');
      }
      toast.success("Stack deployed successfully!");
      // Refresh containers after deploy
      const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      await refreshStacks(true);
      // Refresh backup info
      if (isPro) {
        try {
          const backupRes = await apiFetch(`/stacks/${stackName}/backup`);
          if (backupRes.ok) setBackupInfo(await backupRes.json());
        } catch { /* ignore */ }
      }
    } catch (error) {
      console.error('Failed to deploy:', error);
      const msg = (error as Error).message || 'Failed to deploy stack';
      toast.error(isPro ? `${msg} - automatically rolled back to previous version.` : msg);
    } finally {
      setLoadingAction(null);
    }
  };

  const stopStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || loadingAction !== null) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setLoadingAction('stop');
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
      const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      await refreshStacks(true);
    } catch (error) {
      console.error('Failed to stop:', error);
      toast.error((error as Error).message || 'Failed to stop stack');
    } finally {
      setLoadingAction(null);
    }
  };

  const restartStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || loadingAction !== null) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setLoadingAction('restart');
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
      const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      await refreshStacks(true);
    } catch (error) {
      console.error('Failed to restart:', error);
      toast.error((error as Error).message || 'Failed to restart stack');
    } finally {
      setLoadingAction(null);
    }
  };

  const updateStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || loadingAction !== null) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setLoadingAction('update');
    try {
      const response = await apiFetch(`/stacks/${stackName}/update`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Update failed');
      }
      toast.success('Stack updated successfully!');
      // Refresh containers after update
      const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      await refreshStacks(true);
    } catch (error) {
      console.error('Failed to update:', error);
      toast.error((error as Error).message || 'Failed to update stack');
    } finally {
      setLoadingAction(null);
    }
  };

  const deleteStack = async () => {
    if (!stackToDelete) return;
    setLoadingAction('delete');
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
      setLoadingAction(null);
    }
  };

  // Context-menu-friendly stack actions (accept file name directly)
  const executeStackActionByFile = async (stackFile: string, action: string, endpoint: string) => {
    if (loadingAction !== null) return;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setLoadingAction(action);
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
      await refreshStacks(true);
      if (action === 'update') fetchImageUpdates();
      if (action === 'deploy' && isPro) {
        try {
          const backupRes = await apiFetch(`/stacks/${stackName}/backup`);
          if (backupRes.ok) setBackupInfo(await backupRes.json());
        } catch { /* ignore */ }
      }
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
      const msg = (error as Error).message || `Failed to ${action} stack`;
      toast.error(action === 'deploy' && isPro ? `${msg} - automatically rolled back to previous version.` : msg);
    } finally {
      setLoadingAction(null);
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
  const filteredFiles = files.filter(file => {
    return file.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Get display name for stack (now just returns the name as-is since no extension)
  const getDisplayName = (stackName: string) => {
    return stackName;
  };

  const getContainerBadge = (container: ContainerInfo) => {
    const status = (container.Status || '').toLowerCase();
    const state = (container.State || '').toLowerCase();

    if (status.includes('(unhealthy)') || state === 'exited' || state === 'dead') {
      return { variant: 'destructive' as const, text: container.State };
    }
    if (status.includes('(starting)')) {
      return { variant: 'secondary' as const, text: container.State };
    }
    return { variant: 'default' as const, text: container.State };
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Left Sidebar (Stacks) */}
      <div className="w-64 border-r border-glass-border bg-sidebar backdrop-blur-md flex flex-col">
        {/* Branding Header */}
        <div className="h-14 flex items-center justify-center px-4 border-b border-border">
          <div className="flex items-center gap-2">
            <img src={isDarkMode ? '/sencho-logo-dark.png' : '/sencho-logo-light.png'} alt="Sencho Logo" className="w-10 h-10" />
            <h1 className="text-2xl font-medium tracking-tight">Sencho</h1>
          </div>
        </div>

        {/* Node Switcher */}
        {nodes.length > 1 && (
          <div className="px-4 pt-2 pb-0">
            <Select
              value={activeNode?.id?.toString() || ''}
              onValueChange={(val) => {
                const node = nodes.find(n => n.id === parseInt(val));
                if (node) setActiveNode(node);
              }}
            >
              <SelectTrigger className="w-full h-9 text-sm">
                <div className="flex items-center gap-2">
                  <Server className="w-3.5 h-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Select node" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {nodes.map(node => (
                  <SelectItem key={node.id} value={node.id.toString()}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${node.status === 'online' ? 'bg-success' :
                        node.status === 'offline' ? 'bg-red-500' : 'bg-gray-400'
                        }`} />
                      {node.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Create Stack & Scan Buttons */}
        {can('stack:create') && <div className="p-4 flex gap-2">
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="flex-1 rounded-lg">
                <Plus className="w-4 h-4 mr-2" />
                Create Stack
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Stack</DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-2">
                <Label htmlFor="create-stack-name">Stack Name</Label>
                <Input
                  id="create-stack-name"
                  placeholder="Stack name (e.g., myapp)"
                  value={newStackName}
                  onChange={(e) => setNewStackName(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button onClick={handleCreateStack}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-lg shrink-0"
                  onClick={handleScanStacks}
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
        </div>}

        {/* Search Input & Stack List */}
        <Command className="bg-transparent flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-2 border-b border-border flex-none">
            <CommandInput
              placeholder="Search stacks..."
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="h-9"
            />
          </div>
          <h3 className="text-[10px] font-medium tracking-[0.08em] uppercase text-stat-icon px-4 py-2 mt-2 flex-none">STACKS</h3>
          <ScrollArea className="flex-1 px-2 pb-2">
            <div data-stacks-loaded={isLoading ? "false" : "true"}>
              <CommandList className="max-h-none overflow-visible">
                {isLoading ? (
                  <div className="space-y-2 px-2 mt-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : (
                  (filteredFiles || []).map(file => (
                    <ContextMenu key={file}>
                      <ContextMenuTrigger asChild>
                        <div>
                          <CommandItem
                            value={file}
                            onSelect={() => loadFile(file)}
                            className={`justify-start rounded-lg mb-1 cursor-pointer hover:bg-glass-highlight group ${selectedFile === file ? '!bg-glass-highlight !text-foreground border border-glass-border' : ''}`}
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span
                                className={`font-mono text-[10px] shrink-0 w-[18px] ${stackStatuses[file] === 'running' ? 'text-success' :
                                  stackStatuses[file] === 'exited' ? 'text-destructive' : 'text-stat-icon'
                                  }`}
                              >
                                {stackStatuses[file] === 'running' ? 'UP' : stackStatuses[file] === 'exited' ? 'DN' : '--'}
                              </span>
                              <span className="flex-1 truncate font-mono text-[13px]">{getDisplayName(file)}</span>

                              {stackUpdates[file] && (
                                <span
                                  className="w-2 h-2 rounded-full bg-info animate-pulse shrink-0"
                                  title="Update available"
                                />
                              )}

                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-6 w-6">
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => openAlertSheet(file)}>
                                      <BellRing className="h-4 w-4 mr-2" />
                                      Alerts
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => checkUpdatesForStack()}>
                                      <RefreshCw className="h-4 w-4 mr-2" />
                                      Check for updates
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => executeStackActionByFile(file, 'deploy', 'deploy')}>
                                      <Play className="h-4 w-4 mr-2" />
                                      Deploy
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => executeStackActionByFile(file, 'stop', 'stop')}>
                                      <Square className="h-4 w-4 mr-2" />
                                      Stop
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => executeStackActionByFile(file, 'restart', 'restart')}>
                                      <RotateCw className="h-4 w-4 mr-2" />
                                      Restart
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => executeStackActionByFile(file, 'update', 'update')}>
                                      <Download className="h-4 w-4 mr-2" />
                                      Update
                                    </DropdownMenuItem>
                                    {can('stack:delete', 'stack', file.replace(/\.(yml|yaml)$/, '')) && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-destructive focus:text-destructive"
                                          onClick={() => {
                                            setStackToDelete(file.replace(/\.(yml|yaml)$/, ''));
                                            setDeleteDialogOpen(true);
                                          }}
                                        >
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          Delete
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </CommandItem>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => openAlertSheet(file)}>
                          <BellRing className="h-4 w-4 mr-2" />
                          Alerts
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => checkUpdatesForStack()}>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Check for updates
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => executeStackActionByFile(file, 'deploy', 'deploy')}>
                          <Play className="h-4 w-4 mr-2" />
                          Deploy
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => executeStackActionByFile(file, 'stop', 'stop')}>
                          <Square className="h-4 w-4 mr-2" />
                          Stop
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => executeStackActionByFile(file, 'restart', 'restart')}>
                          <RotateCw className="h-4 w-4 mr-2" />
                          Restart
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => executeStackActionByFile(file, 'update', 'update')}>
                          <Download className="h-4 w-4 mr-2" />
                          Update
                        </ContextMenuItem>
                        {can('stack:delete', 'stack', file.replace(/\.(yml|yaml)$/, '')) && (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => {
                                setStackToDelete(file.replace(/\.(yml|yaml)$/, ''));
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </ContextMenuItem>
                          </>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  ))
                )}
              </CommandList>
            </div>
          </ScrollArea>
        </Command>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header Bar — Three-zone layout: Node Pill | Navigation | Utilities */}
        <div className="h-14 flex items-center px-4 border-b border-border gap-3">
          {/* LEFT ZONE: Node Context Pill */}
          <div className="flex-shrink-0">
            {activeNode?.type === 'remote' ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-info-muted border border-info/20 text-info text-sm font-medium">
                <span className="w-2 h-2 rounded-full bg-info animate-pulse shrink-0" />
                {activeNode.name}
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-border text-muted-foreground text-sm">
                <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                {activeNode?.name ?? 'Local'}
              </div>
            )}
          </div>

          {/* CENTER ZONE: Navigation Group (hidden on mobile) */}
          <div className="flex-1 hidden md:flex justify-center">
            <Highlight
              className="inset-0 rounded-md bg-accent"
              value={navTabValue}
              controlledItems
              mode="children"
              click={false}
              transition={springs.snappy}
            >
              <div className="inline-flex items-center rounded-lg p-1 gap-0.5">
                {navItems.map(({ value, label, icon: Icon }) => (
                  <HighlightItem key={value} value={value}>
                    <button
                      onClick={() => handleNavigate(value)}
                      className={cn(
                        'relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                        activeView === value
                          ? 'text-foreground after:absolute after:bottom-0 after:left-1/4 after:right-1/4 after:h-[2px] after:rounded-full after:bg-brand after:blur-[2px]'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="hidden xl:inline">{label}</span>
                    </button>
                  </HighlightItem>
                ))}
              </div>
            </Highlight>
          </div>

          {/* Spacer for mobile (when center nav is hidden) */}
          <div className="flex-1 md:hidden" />

          {/* RIGHT ZONE: Utilities */}
          <div className="flex-shrink-0 flex items-center gap-2">
            {/* Notifications Popover */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg relative" title="Notifications">
                  <Bell className="w-4 h-4" />
                  {notifications.filter(n => !n.is_read).length > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end">
                <div className="flex items-center justify-between p-4 border-b">
                  <h4 className="font-medium">Notifications</h4>
                  <div className="flex gap-2">
                    {notifications.filter(n => !n.is_read).length > 0 && (
                      <Button variant="ghost" size="sm" onClick={markAllRead} className="h-auto p-0 text-xs">
                        Mark all as read
                      </Button>
                    )}
                    {notifications.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={clearAllNotifications} className="h-auto p-0 text-xs text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-3 h-3 mr-1" />
                        Clear all
                      </Button>
                    )}
                  </div>
                </div>
                <ScrollArea className="h-80">
                  {notifications.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">No notifications</div>
                  ) : (
                    <div className="flex flex-col">
                      {notifications.map((notif) => (
                        <div key={`${notif.nodeId}-${notif.id}`} className={`p-4 border-b text-sm ${notif.is_read ? 'opacity-70' : 'bg-muted/50'} relative group`}>
                          <div className="flex items-center gap-2 mb-1 pr-6">
                            <Badge variant={notif.level === 'error' ? 'destructive' : notif.level === 'warning' ? 'secondary' : 'default'} className="text-[10px] uppercase">
                              {notif.level}
                            </Badge>
                            {nodesRef.current.find(n => n.id === notif.nodeId)?.type === 'remote' && (
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {notif.nodeName}
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground ml-auto">
                              {new Date(notif.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="font-medium pr-6">{notif.message}</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNotification(notif);
                            }}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>

            {/* User Profile Dropdown */}
            <UserProfileDropdown
              theme={theme}
              setTheme={setTheme}
              onOpenSettings={() => setSettingsModalOpen(true)}
            />

            {/* Mobile Navigation Trigger */}
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg md:hidden">
                  <Menu className="w-4 h-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-64 p-0">
                <div className="p-4 border-b">
                  <p className="text-sm font-medium">Navigation</p>
                </div>
                <nav className="flex flex-col p-2 gap-1">
                  {navItems.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => { handleNavigate(value); setMobileNavOpen(false); }}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                        activeView === value
                          ? 'bg-glass-highlight font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-glass-highlight hover:text-foreground'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Main Workspace */}
        <div key={activeView} className="flex-1 overflow-y-auto p-6 animate-fade-up">
          {activeView === 'templates' ? (
            <AppStoreView onDeploySuccess={(stackName) => { refreshStacks(); loadFile(stackName); }} />
          ) : activeView === 'resources' ? (
            <ResourcesView />
          ) : activeView === 'host-console' ? (
            <AdmiralGate featureName="Host Console">
              <HostConsole stackName={selectedFile} onClose={() => setActiveView(selectedFile ? 'editor' : 'dashboard')} />
            </AdmiralGate>
          ) : !isLoading && selectedFile && activeView === 'editor' ? (
            <ErrorBoundary>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                {/* Left Column (Command Center & Terminal) */}
                <div className="flex flex-col h-full gap-6">
                  {/* Command Center Card */}
                  <Card className="rounded-xl border-muted bg-card">
                    <CardHeader className="p-4 pb-2">
                      <div className="flex flex-col gap-3">
                        {/* Stack Name */}
                        <CardTitle className="text-2xl font-medium">{stackName}</CardTitle>
                        {/* Action Bar */}
                        {can('stack:deploy', 'stack', stackName) && (
                          <div className="flex items-center gap-2 flex-wrap">
                            {isRunning ? (
                              <>
                                <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={stopStack} disabled={loadingAction !== null}>
                                  <Square className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                  {loadingAction === 'stop' ? 'Stopping...' : 'Stop'}
                                </Button>
                                <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={restartStack} disabled={loadingAction !== null}>
                                  <RotateCw className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                  {loadingAction === 'restart' ? 'Restarting...' : 'Restart'}
                                </Button>
                              </>
                            ) : (
                              <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={deployStack} disabled={loadingAction !== null}>
                                <Play className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                {loadingAction === 'deploy' || loadingAction === 'start' ? 'Starting...' : 'Start'}
                              </Button>
                            )}
                            <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={updateStack} disabled={loadingAction !== null}>
                              <CloudDownload className="w-4 h-4 mr-2" strokeWidth={1.5} />
                              {loadingAction === 'update' ? 'Updating...' : 'Update'}
                            </Button>
                            {isPro && backupInfo.exists && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={rollbackStack} disabled={loadingAction !== null}>
                                      <Undo2 className="w-4 h-4 mr-2" strokeWidth={1.5} />
                                      {loadingAction === 'rollback' ? 'Rolling back...' : 'Rollback'}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {backupInfo.timestamp
                                      ? `Roll back to backup from ${new Date(backupInfo.timestamp).toLocaleString()}`
                                      : 'Roll back to previous deployment'}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="rounded-lg text-destructive/60 hover:bg-destructive hover:text-destructive-foreground"
                              disabled={loadingAction !== null}
                              onClick={() => {
                                setStackToDelete(selectedFile);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" strokeWidth={1.5} />
                              {loadingAction === 'delete' ? 'Deleting...' : 'Delete'}
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-2">
                      {/* Containers List */}
                      <div className="mt-4">
                        <h4 className="text-sm font-medium text-muted-foreground mb-3">CONTAINERS</h4>
                        {safeContainers.length === 0 ? (
                          <div className="text-muted-foreground text-sm">No containers running for this stack.</div>
                        ) : (
                          <div className="flex flex-col gap-3">
                            {safeContainers.map(container => {
                              let mainPort: number | undefined;
                              if (container.Ports && container.Ports.length > 0) {
                                const WEB_UI_PORTS = [32400, 8989, 7878, 9696, 5055, 8080, 80, 443, 3000, 9000];
                                const IGNORE_PORTS = [1900, 53, 22];

                                // 1. Match typical Web UI Private ports
                                let match = container.Ports.find(p => WEB_UI_PORTS.includes(p.PrivatePort));
                                // 2. Match typical Web UI Public ports
                                if (!match) match = container.Ports.find(p => WEB_UI_PORTS.includes(p.PublicPort));
                                // 3. Fallback to any port not in ignore list
                                if (!match) match = container.Ports.find(p => !IGNORE_PORTS.includes(p.PrivatePort) && !IGNORE_PORTS.includes(p.PublicPort));

                                mainPort = (match || container.Ports[0]).PublicPort;
                              }

                              return (
                                <div key={container?.Id || Math.random()} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                      <HoverCard>
                                        <HoverCardTrigger asChild>
                                          <div className="cursor-help inline-flex">
                                            <Badge variant={getContainerBadge(container).variant} className="text-xs">
                                              {getContainerBadge(container).text || 'unknown'}
                                            </Badge>
                                          </div>
                                        </HoverCardTrigger>
                                        <HoverCardContent className="flex w-50 flex-col gap-0.5">
                                          <div className="space-y-1">
                                            <h4 className="text-sm font-medium">Container Status</h4>
                                            <p className="text-sm text-muted-foreground">
                                              {container?.Status || 'No status details available'}
                                            </p>
                                          </div>
                                        </HoverCardContent>
                                      </HoverCard>
                                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        CPU: {container.State === 'running' ? (containerStats[container?.Id]?.cpu || 'N/A') : '0.00%'} | RAM: {container.State === 'running' ? (containerStats[container?.Id]?.ram || 'N/A') : '0.00 MB'} | NET: {container.State === 'running' ? (containerStats[container?.Id]?.net || '0 B ↓ / 0 B ↑') : '0 B/s ↓ / 0 B/s ↑'}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex gap-1">
                                    {mainPort && (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              className="rounded-lg h-8 w-8"
                                              onClick={() => {
                                                const host = activeNode?.type === 'remote' && activeNode?.api_url
                                                  ? new URL(activeNode.api_url).hostname
                                                  : window.location.hostname;
                                                window.open(`http://${host}:${mainPort}`, '_blank');
                                              }}
                                            >
                                              <ExternalLink className="w-4 h-4" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Open App ({mainPort})</TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="rounded-lg h-8 w-8"
                                            onClick={() => openLogViewer(container?.Id, container?.Names?.[0]?.replace('/', '') || 'container')}
                                            disabled={container?.State !== 'running'}
                                          >
                                            <ScrollText className="w-4 h-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>View Live Logs</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    {isAdmin && (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              className="rounded-lg h-8 w-8"
                                              onClick={() => openBashModal(container?.Id, container?.Names?.[0]?.replace('/', '') || 'container')}
                                              disabled={container?.State !== 'running'}
                                            >
                                              <Terminal className="w-4 h-4" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Open Bash Terminal</TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Terminal Section */}
                  <div className="flex-1 rounded-xl overflow-hidden border border-muted bg-black p-3 min-h-[300px] shadow-[inset_0_2px_4px_0_oklch(0_0_0/0.4)]">
                    <h3 className="text-sm font-medium text-stat-subtitle mb-2">Terminal</h3>
                    <div className="h-[calc(100%-24px)]">
                      <ErrorBoundary>
                        <TerminalComponent stackName={stackName} />
                      </ErrorBoundary>
                    </div>
                  </div>
                </div>

                {/* Right Column (The Editor) */}
                <Card className="rounded-xl border-muted overflow-hidden flex flex-col h-full min-h-[600px] bg-card">
                  <div className="p-4 border-b border-muted flex items-center justify-between">
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
                    {can('stack:edit', 'stack', stackName) && (
                      <div className="flex gap-2">
                        {!isEditing ? (
                          <Button size="sm" variant="default" className="rounded-lg" onClick={enterEditMode}>
                            <Pencil className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" className="rounded-lg" onClick={discardChanges}>
                              <X className="w-4 h-4 mr-2" />
                              Discard
                            </Button>
                            <Button size="sm" variant="outline" className="rounded-lg" onClick={saveFile}>
                              <Save className="w-4 h-4 mr-2" />
                              Save Only
                            </Button>
                            <Button size="sm" variant="default" className="rounded-lg" onClick={handleSaveAndDeploy} disabled={loadingAction === 'deploy'}>
                              <Rocket className="w-4 h-4 mr-2" />
                              Save & Deploy
                            </Button>
                          </>
                        )}
                      </div>
                    )}
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
              </div>
            </ErrorBoundary>
          ) : activeView === 'global-observability' ? (
            <GlobalObservabilityView />
          ) : activeView === 'fleet' ? (
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
          ) : activeView === 'audit-log' ? (
            <AuditLogView />
          ) : activeView === 'auto-updates' ? (
            <AutoUpdatePoliciesView />
          ) : activeView === 'scheduled-ops' ? (
            <ScheduledOperationsView />
          ) : (
            <HomeDashboard />
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
        onClose={() => setSettingsModalOpen(false)}
      />

      {/* Stack Alert Sheet */}
      <StackAlertSheet
        isOpen={alertSheetOpen}
        onClose={() => setAlertSheetOpen(false)}
        stackName={alertSheetStack}
      />
    </div>
  );
}
