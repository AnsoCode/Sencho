import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import TerminalComponent from './Terminal';
import ErrorBoundary from './ErrorBoundary';
import HomeDashboard from './HomeDashboard';
import BashExecModal from './BashExecModal';
import HostConsole from './HostConsole';
import MaintenanceModal from './MaintenanceModal';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Plus, Trash2, Play, Square, Save, Terminal, Sun, Moon, RotateCw, CloudDownload, Pencil, X, Home, LogOut, Brush, ExternalLink, Bell, Settings, MoreVertical, BellRing } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Label } from './ui/label';
import { Command, CommandInput, CommandList, CommandItem } from './ui/command';
import { ScrollArea } from './ui/scroll-area';
import { Skeleton } from './ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { NotificationSettingsModal } from './NotificationSettingsModal';
import { StackAlertSheet } from './StackAlertSheet';
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

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function EditorLayout() {
  const { logout } = useAuth();
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [envContent, setEnvContent] = useState<string>('');
  const [originalEnvContent, setOriginalEnvContent] = useState<string>('');
  const [envExists, setEnvExists] = useState<boolean>(false);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [containerStats, setContainerStats] = useState<Record<string, { cpu: string, ram: string, net: string, lastRx?: number, lastTx?: number }>>({});
  const [activeTab, setActiveTab] = useState<'compose' | 'env'>('compose');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newStackName, setNewStackName] = useState('');
  const [stackToDelete, setStackToDelete] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('sencho-theme');
    if (saved !== null) {
      return saved === 'dark';
    }
    return true; // Default to dark mode
  });
  const [activeView, setActiveView] = useState<'dashboard' | 'editor' | 'host-console'>('dashboard');
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stackStatuses, setStackStatuses] = useState<StackStatus>({});

  // Bash exec modal state
  const [bashModalOpen, setBashModalOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<{ id: string; name: string } | null>(null);

  // Maintenance modal state
  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);

  // Notifications & Settings state
  const [notifications, setNotifications] = useState<any[]>([]);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [alertSheetOpen, setAlertSheetOpen] = useState(false);
  const [alertSheetStack, setAlertSheetStack] = useState('');

  const openAlertSheet = (stackName: string) => {
    setAlertSheetStack(stackName);
    setAlertSheetOpen(true);
  };

  // Theme toggle effect
  useEffect(() => {
    const html = document.documentElement;
    if (isDarkMode) {
      html.classList.add('dark');
      localStorage.setItem('sencho-theme', 'dark');
    } else {
      html.classList.remove('dark');
      localStorage.setItem('sencho-theme', 'light');
    }
  }, [isDarkMode]);

  const refreshStacks = async (background = false) => {
    if (!background) setIsLoading(true);
    try {
      const res = await apiFetch('/stacks');
      const stacks = await res.json();
      setFiles(Array.isArray(stacks) ? stacks : []);

      // Fetch status for each stack
      const statuses: StackStatus = {};
      for (const file of stacks) {
        try {
          const containersRes = await apiFetch(`/stacks/${file}/containers`);
          const containers = await containersRes.json();
          const hasRunning = Array.isArray(containers) && containers.some((c: ContainerInfo) => c.State === 'running');
          statuses[file] = hasRunning ? 'running' : (Array.isArray(containers) && containers.length > 0 ? 'exited' : 'unknown');
        } catch {
          statuses[file] = 'unknown';
        }
      }
      setStackStatuses(statuses);
    } catch (error) {
      console.error('Failed to refresh stacks:', error);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshStacks();
    fetchNotifications();
    const notificationInterval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(notificationInterval);
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await apiFetch('/notifications/history');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch (e) { }
  };

  const markAllRead = async () => {
    try {
      await apiFetch('/notifications/read', { method: 'POST' });
      fetchNotifications();
    } catch (e) { }
  };

  useEffect(() => {
    const wsMap: Record<string, WebSocket> = {};
    (containers || []).forEach(container => {
      if (!container?.Id) return;
      try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}`);
        wsMap[container.Id] = ws;
        ws.onopen = () => ws.send(JSON.stringify({ action: 'streamStats', containerId: container.Id }));
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
              Object.values(data.networks).forEach((net: any) => {
                currentRx += net.rx_bytes || 0;
                currentTx += net.tx_bytes || 0;
              });
            }

            setContainerStats(prev => {
              const prevStat = prev[container.Id];
              // Calculate rate if we have a previous value
              const rxRate = prevStat?.lastRx !== undefined ? Math.max(0, currentRx - prevStat.lastRx) : 0;
              const txRate = prevStat?.lastTx !== undefined ? Math.max(0, currentTx - prevStat.lastTx) : 0;

              const netIO = `${formatBytes(rxRate)}/s ↓ / ${formatBytes(txRate)}/s ↑`;

              return {
                ...prev,
                [container.Id]: {
                  cpu: cpuPercent + '%',
                  ram: ramUsage,
                  net: netIO,
                  lastRx: currentRx,
                  lastTx: currentTx
                }
              };
            });
          } catch {
            // Ignore parse errors
          }
        };
      } catch {
        // Ignore WebSocket errors
      }
    });
    return () => {
      Object.values(wsMap).forEach(ws => {
        try {
          ws.close();
        } catch {
          // Ignore close errors
        }
      });
    };
  }, [containers]);

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

      // Load env file
      try {
        const envRes = await apiFetch(`/stacks/${filename}/env`);
        if (envRes.ok) {
          const envText = await envRes.text();
          setEnvContent(envText || '');
          setOriginalEnvContent(envText || '');
          setEnvExists(true);
        } else {
          setEnvContent('');
          setOriginalEnvContent('');
          setEnvExists(false);
        }
      } catch {
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

  const saveFile = async () => {
    if (!selectedFile) return;
    const currentContent = activeTab === 'compose' ? (content || '') : (envContent || '');
    const endpoint = activeTab === 'compose' ? `/stacks/${selectedFile}` : `/stacks/${selectedFile}/env`;
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
    if (!selectedFile || isActionLoading) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setIsActionLoading(true);
    try {
      await apiFetch(`/stacks/${stackName}/up`, {
        method: 'POST',
      });
      // Refresh containers after deploy
      const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      await refreshStacks(true);
    } catch (error) {
      console.error('Failed to deploy:', error);
    } finally {
      setIsActionLoading(false);
    }
  };

  const stopStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || isActionLoading) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setIsActionLoading(true);
    try {
      await apiFetch(`/stacks/${stackName}/stop`, {
        method: 'POST',
      });
      // Refresh containers after stop
      const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      await refreshStacks(true);
    } catch (error) {
      console.error('Failed to stop:', error);
    } finally {
      setIsActionLoading(false);
    }
  };

  const startStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || isActionLoading) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setIsActionLoading(true);
    try {
      await apiFetch(`/stacks/${stackName}/start`, {
        method: 'POST',
      });
      // Refresh containers after start
      const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      await refreshStacks(true);
    } catch (error) {
      console.error('Failed to start:', error);
    } finally {
      setIsActionLoading(false);
    }
  };

  const restartStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || isActionLoading) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setIsActionLoading(true);
    try {
      await apiFetch(`/stacks/${stackName}/restart`, {
        method: 'POST',
      });
      // Refresh containers after restart
      const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      await refreshStacks(true);
    } catch (error) {
      console.error('Failed to restart:', error);
    } finally {
      setIsActionLoading(false);
    }
  };

  const updateStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || isActionLoading) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setIsActionLoading(true);
    try {
      await apiFetch(`/stacks/${stackName}/update`, {
        method: 'POST',
      });
      // Refresh containers after update
      const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      await refreshStacks(true);
    } catch (error) {
      console.error('Failed to update:', error);
    } finally {
      setIsActionLoading(false);
    }
  };

  const deleteStack = async () => {
    if (!stackToDelete) return;
    setIsActionLoading(true);
    try {
      const response = await apiFetch(`/stacks/${stackToDelete}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete stack');
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
      toast.error('Failed to delete stack');
    } finally {
      setIsActionLoading(false);
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
    } catch (error: any) {
      console.error('Failed to create stack:', error);
      toast.error(error.message || 'Failed to create stack');
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

  // Safe container list with fallback
  const safeContainers = containers || [];
  // Safe content strings with fallback
  const safeContent = content || '';
  const safeEnvContent = envContent || '';

  // Stack state booleans for dynamic button rendering
  const isDeployed = safeContainers && safeContainers.length > 0;
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
      <div className="w-64 border-r border-border bg-card flex flex-col">
        {/* Branding Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-border">
          <h1 className="text-2xl font-bold tracking-tight">Sencho</h1>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={logout}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <LogOut className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Logout</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Create Stack Button */}
        <div className="p-4">
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full rounded-lg">
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
        </div>

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
          <h3 className="text-sm font-semibold text-muted-foreground px-4 py-2 mt-2 flex-none">STACKS</h3>
          <ScrollArea className="flex-1 px-2 pb-2">
            <CommandList className="max-h-none overflow-visible">
              {isLoading ? (
                <div className="space-y-2 px-2 mt-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                (filteredFiles || []).map(file => (
                  <CommandItem
                    key={file}
                    value={file}
                    onSelect={() => loadFile(file)}
                    className={`justify-start rounded-lg mb-1 cursor-pointer hover:bg-muted group ${selectedFile === file ? '!bg-accent !text-accent-foreground' : ''}`}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${stackStatuses[file] === 'running' ? 'bg-green-500' :
                          stackStatuses[file] === 'exited' ? 'bg-red-500' : 'bg-gray-400'
                          }`}
                      />
                      <span className="flex-1 truncate">{getDisplayName(file)}</span>

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
                              Create Alert
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CommandItem>
                ))
              )}
            </CommandList>
          </ScrollArea>
        </Command>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header Bar */}
        <div className="h-16 flex items-center justify-end px-6 border-b border-border gap-4">
          {/* Home Button */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => {
              setSelectedFile(null);
              setContent('');
              setOriginalContent('');
              setEnvContent('');
              setOriginalEnvContent('');
              setEnvExists(false);
              setContainers([]);
              setIsEditing(false);
              setActiveView('dashboard');
            }}
            title="Go to Home Dashboard"
          >
            <Home className="w-4 h-4 mr-2" />
            Home
          </Button>
          {/* Console Toggle */}
          <Button
            variant={activeView === 'host-console' ? 'default' : 'outline'}
            size="sm"
            className="rounded-lg"
            onClick={() => setActiveView(activeView === 'host-console' ? (selectedFile ? 'editor' : 'dashboard') : 'host-console')}
          >
            <Terminal className="w-4 h-4 mr-2" />
            Console
          </Button>
          {/* System Janitor (Maintenance) Toggle */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => setMaintenanceModalOpen(true)}
            title="System Maintenance"
          >
            <Brush className="w-4 h-4 mr-2" />
            Janitor
          </Button>

          {/* Settings Modal Toggle */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => setSettingsModalOpen(true)}
            title="Notification Settings"
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>

          {/* Notifications Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-lg relative" title="Notifications">
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
                <h4 className="font-semibold">Notifications</h4>
                {notifications.filter(n => !n.is_read).length > 0 && (
                  <Button variant="ghost" size="sm" onClick={markAllRead} className="h-auto p-0 text-xs">
                    Mark all as read
                  </Button>
                )}
              </div>
              <ScrollArea className="h-80">
                {notifications.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">No notifications</div>
                ) : (
                  <div className="flex flex-col">
                    {notifications.map((notif: any) => (
                      <div key={notif.id} className={`p-4 border-b text-sm ${notif.is_read ? 'opacity-70' : 'bg-muted/50'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={notif.level === 'error' ? 'destructive' : notif.level === 'warning' ? 'secondary' : 'default'} className="text-[10px] uppercase">
                            {notif.level}
                          </Badge>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {new Date(notif.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p className="font-medium">{notif.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </PopoverContent>
          </Popover>

          {/* Theme Toggle */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => setIsDarkMode(!isDarkMode)}
          >
            {isDarkMode ? (
              <>
                <Sun className="w-4 h-4 mr-2" />
                Light
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 mr-2" />
                Dark
              </>
            )}
          </Button>
        </div>

        {/* Main Workspace */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeView === 'host-console' ? (
            <HostConsole stackName={selectedFile} onClose={() => setActiveView(selectedFile ? 'editor' : 'dashboard')} />
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
                        <CardTitle className="text-2xl font-bold">{stackName}</CardTitle>
                        {/* Action Bar */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {!isDeployed && (
                            <Button type="button" size="sm" className="rounded-lg" onClick={deployStack} disabled={isActionLoading}>
                              <Play className="w-4 h-4 mr-2" />
                              {isActionLoading ? 'Working...' : 'Deploy'}
                            </Button>
                          )}
                          {isDeployed && (
                            <>
                              {isRunning ? (
                                <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={stopStack} disabled={isActionLoading}>
                                  <Square className="w-4 h-4 mr-2" />
                                  {isActionLoading ? 'Working...' : 'Stop'}
                                </Button>
                              ) : (
                                <Button type="button" size="sm" className="rounded-lg" onClick={startStack} disabled={isActionLoading}>
                                  <Play className="w-4 h-4 mr-2" />
                                  {isActionLoading ? 'Working...' : 'Start'}
                                </Button>
                              )}
                              <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={restartStack} disabled={isActionLoading}>
                                <RotateCw className="w-4 h-4 mr-2" />
                                Restart
                              </Button>
                              <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={updateStack} disabled={isActionLoading}>
                                <CloudDownload className="w-4 h-4 mr-2" />
                                Update
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="rounded-lg"
                            disabled={isActionLoading}
                            onClick={() => {
                              setStackToDelete(selectedFile);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-2">
                      {/* Containers List */}
                      <div className="mt-4">
                        <h4 className="text-sm font-semibold text-muted-foreground mb-3">CONTAINERS</h4>
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
                                            <h4 className="text-sm font-semibold">Container Status</h4>
                                            <p className="text-sm text-muted-foreground">
                                              {container?.Status || 'No status details available'}
                                            </p>
                                          </div>
                                        </HoverCardContent>
                                      </HoverCard>
                                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        CPU: {containerStats[container?.Id]?.cpu || 'N/A'} | RAM: {containerStats[container?.Id]?.ram || 'N/A'} | NET: {containerStats[container?.Id]?.net || '0 B ↓ / 0 B ↑'}
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
                                              variant="outline"
                                              className="rounded-lg h-8 px-2 mr-1"
                                              onClick={() => window.open(`http://${window.location.hostname}:${mainPort}`, '_blank')}
                                            >
                                              <ExternalLink className="w-3 h-3 mr-1" />
                                              {mainPort}
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
                                            onClick={() => openBashModal(container?.Id, container?.Names?.[0]?.replace('/', '') || 'container')}
                                            disabled={container?.State !== 'running'}
                                          >
                                            <Terminal className="w-4 h-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Open Bash Terminal</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
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
                  <div className="flex-1 rounded-xl overflow-hidden border border-muted bg-black p-3 min-h-[300px]">
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2">Terminal</h3>
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
                    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'compose' | 'env')}>
                      <TabsList className="bg-muted">
                        <TabsTrigger value="compose" className="rounded-lg">compose.yaml</TabsTrigger>
                        <TabsTrigger value="env" disabled={!envExists} className="rounded-lg">.env</TabsTrigger>
                      </TabsList>
                    </Tabs>
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
                          <Button size="sm" variant="default" className="rounded-lg" onClick={saveFile}>
                            <Save className="w-4 h-4 mr-2" />
                            Save
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-h-0">
                    {!isFileLoading && (
                      <Editor
                        height="100%"
                        language={activeTab === 'compose' ? 'yaml' : 'plaintext'}
                        theme={isDarkMode ? 'vs-dark' : 'vs'}
                        value={activeTab === 'compose' ? safeContent : safeEnvContent}
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
                          fontSize: 14,
                          padding: { top: 10 },
                          scrollBeyondLastLine: false,
                          readOnly: !isEditing,
                        }}
                      />
                    )}
                    {isFileLoading && (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        Loading...
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </ErrorBoundary>
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

      <MaintenanceModal
        isOpen={maintenanceModalOpen}
        onClose={() => setMaintenanceModalOpen(false)}
      />

      {/* Notification Settings Modal */}
      <NotificationSettingsModal
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
