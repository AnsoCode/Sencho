import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import TerminalComponent from './Terminal';
import ErrorBoundary from './ErrorBoundary';
import HomeDashboard from './HomeDashboard';
import BashExecModal from './BashExecModal';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger } from './ui/dialog';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Plus, Trash2, Play, Square, Save, RefreshCw, Terminal, Sun, Moon, RotateCw, CloudDownload, Pencil, X, Search, Home, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';

interface ContainerInfo {
  Id: string;
  Names: string[];
  State: string;
}

interface StackStatus {
  [key: string]: 'running' | 'exited' | 'unknown';
}

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
  const [containerStats, setContainerStats] = useState<Record<string, {cpu: string, ram: string}>>({});
  const [activeTab, setActiveTab] = useState<'compose' | 'env'>('compose');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newStackName, setNewStackName] = useState('');
  const [stackToDelete, setStackToDelete] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showConsole, setShowConsole] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stackStatuses, setStackStatuses] = useState<StackStatus>({});
  
  // Bash exec modal state
  const [bashModalOpen, setBashModalOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<{ id: string; name: string } | null>(null);

  // Theme toggle effect
  useEffect(() => {
    const html = document.documentElement;
    if (isDarkMode) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [isDarkMode]);

  const refreshStacks = async () => {
    setIsLoading(true);
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
  }, []);

  useEffect(() => {
    const wsMap: Record<string, WebSocket> = {};
    (containers || []).forEach(container => {
      if (!container?.Id) return;
      try {
        const ws = new WebSocket('ws://localhost:3000');
        wsMap[container.Id] = ws;
        ws.onopen = () => ws.send(JSON.stringify({ action: 'streamStats', containerId: container.Id }));
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.cpu_stats && data.precpu_stats && data.memory_stats) {
              const cpuDelta = data.cpu_stats.cpu_usage.total_usage - data.precpu_stats.cpu_usage.total_usage;
              const systemDelta = data.cpu_stats.system_cpu_usage - data.precpu_stats.system_cpu_usage;
              const cpuPercent = systemDelta > 0 ? ((cpuDelta / systemDelta) * data.cpu_stats.online_cpus * 100).toFixed(2) : '0.00';
              const ramUsage = (data.memory_stats.usage / (1024 * 1024)).toFixed(2) + ' MB';
              setContainerStats(prev => ({ ...prev, [container.Id]: { cpu: cpuPercent + '%', ram: ramUsage } }));
            }
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
      alert('File saved successfully!');
    } catch (error) {
      console.error('Failed to save file:', error);
      alert(`Failed to save file: ${(error as Error).message}`);
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

  const deployStack = async () => {
    if (!selectedFile) return;
    try {
      await apiFetch(`/stacks/${selectedFile}/up`, {
        method: 'POST',
      });
      // Refresh containers after deploy
      const containersRes = await apiFetch(`/stacks/${selectedFile}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      refreshStacks();
    } catch (error) {
      console.error('Failed to deploy:', error);
    }
  };

  const stopStack = async () => {
    if (!selectedFile) return;
    try {
      await apiFetch(`/stacks/${selectedFile}/down`, {
        method: 'POST',
      });
      // Refresh containers after stop
      const containersRes = await apiFetch(`/stacks/${selectedFile}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      refreshStacks();
    } catch (error) {
      console.error('Failed to stop:', error);
    }
  };

  const restartStack = async () => {
    if (!selectedFile) return;
    try {
      await apiFetch(`/stacks/${selectedFile}/down`, {
        method: 'POST',
      });
      await apiFetch(`/stacks/${selectedFile}/up`, {
        method: 'POST',
      });
      // Refresh containers after restart
      const containersRes = await apiFetch(`/stacks/${selectedFile}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      refreshStacks();
    } catch (error) {
      console.error('Failed to restart:', error);
    }
  };

  const updateStack = async () => {
    if (!selectedFile) return;
    try {
      await apiFetch(`/stacks/${selectedFile}/update`, {
        method: 'POST',
      });
      // Refresh containers after update
      const containersRes = await apiFetch(`/stacks/${selectedFile}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      refreshStacks();
    } catch (error) {
      console.error('Failed to update:', error);
    }
  };

  const deleteStack = async () => {
    if (!stackToDelete) return;
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
      alert('Failed to delete stack');
    }
  };

  const startContainer = async (id: string) => {
    if (!id || !selectedFile) return;
    try {
      await apiFetch(`/containers/${id}/start`, { method: 'POST' });
      const containersRes = await apiFetch(`/stacks/${selectedFile}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      refreshStacks();
    } catch (error) {
      console.error('Failed to start container:', error);
    }
  };

  const stopContainer = async (id: string) => {
    if (!id || !selectedFile) return;
    try {
      await apiFetch(`/containers/${id}/stop`, { method: 'POST' });
      const containersRes = await apiFetch(`/stacks/${selectedFile}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      refreshStacks();
    } catch (error) {
      console.error('Failed to stop container:', error);
    }
  };

  const restartContainer = async (id: string) => {
    if (!id || !selectedFile) return;
    try {
      await apiFetch(`/containers/${id}/restart`, { method: 'POST' });
      const containersRes = await apiFetch(`/stacks/${selectedFile}/containers`);
      const conts = await containersRes.json();
      setContainers(Array.isArray(conts) ? conts : []);
      refreshStacks();
    } catch (error) {
      console.error('Failed to restart container:', error);
    }
  };

  const handleCreateStack = async () => {
    if (!newStackName.trim()) return;
    const filename = newStackName.endsWith('.yml') ? newStackName : newStackName + '.yml';
    try {
      const response = await apiFetch('/stacks', {
        method: 'POST',
        body: JSON.stringify({ filename }),
      });
      if (!response.ok) throw new Error('Failed to create stack');
      setCreateDialogOpen(false);
      setNewStackName('');
      await refreshStacks();
    } catch (error) {
      console.error('Failed to create stack:', error);
      alert('Failed to create stack');
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

  // Get stack name without extension
  const stackName = selectedFile ? selectedFile.replace('.yml', '').replace('.yaml', '') : '';

  // Filter files based on search query
  const filteredFiles = files.filter(file => {
    const nameWithoutExt = file.replace('.yml', '').replace('.yaml', '').toLowerCase();
    return nameWithoutExt.includes(searchQuery.toLowerCase());
  });

  // Get display name for stack (without extension)
  const getDisplayName = (filename: string) => {
    return filename.replace('.yml', '').replace('.yaml', '');
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Left Sidebar (Stacks) */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        {/* Branding Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-border">
          <h1 className="text-2xl font-bold tracking-tight">Sencho</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            title="Logout"
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-5 h-5" />
          </Button>
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
              <div className="py-4">
                <Input
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

        {/* Search Input */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search stacks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 rounded-lg"
            />
          </div>
        </div>

        {/* Stack List */}
        <div className="flex flex-col gap-1 px-2 flex-1 overflow-y-auto">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2 px-2">STACKS</h3>
          {isLoading ? (
            <div className="text-muted-foreground px-2 py-4">Loading...</div>
          ) : (
            (filteredFiles || []).map(file => (
              <Button
                key={file}
                variant="ghost"
                className={`justify-start rounded-lg ${selectedFile === file ? 'bg-accent text-accent-foreground' : ''}`}
                onClick={() => loadFile(file)}
              >
                <span className="flex items-center gap-2">
                  <span 
                    className={`w-2 h-2 rounded-full ${
                      stackStatuses[file] === 'running' ? 'bg-green-500' : 
                      stackStatuses[file] === 'exited' ? 'bg-red-500' : 'bg-gray-400'
                    }`} 
                  />
                  {getDisplayName(file)}
                </span>
              </Button>
            ))
          )}
        </div>
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
            }}
            title="Go to Home Dashboard"
          >
            <Home className="w-4 h-4 mr-2" />
             Home
          </Button>
          {/* Console Toggle */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => setShowConsole(!showConsole)}
          >
            <Terminal className="w-4 h-4 mr-2" />
            Console
          </Button>
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
          {!isLoading && selectedFile ? (
            <ErrorBoundary>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column (Command Center & Terminal) */}
                <div className="flex flex-col gap-6">
                  {/* Command Center Card */}
                  <Card className="rounded-xl border-muted bg-card">
                    <CardHeader className="p-4 pb-2">
                      <div className="flex flex-col gap-3">
                        {/* Stack Name */}
                        <CardTitle className="text-2xl font-bold">{stackName}</CardTitle>
                        {/* Action Bar */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button size="sm" className="rounded-lg" onClick={deployStack}>
                            <Play className="w-4 h-4 mr-2" />
                            Deploy
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-lg" onClick={restartStack}>
                            <RotateCw className="w-4 h-4 mr-2" />
                            Restart
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-lg" onClick={updateStack}>
                            <CloudDownload className="w-4 h-4 mr-2" />
                            Update
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-lg" onClick={stopStack}>
                            <Square className="w-4 h-4 mr-2" />
                            Stop
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="rounded-lg"
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
                            {safeContainers.map(container => (
                              <div key={container?.Id || Math.random()} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium text-sm">{container?.Names?.[0]?.replace('/', '') || 'Unknown'}</span>
                                  <div className="flex items-center gap-2">
                                    <Badge variant={container?.State === 'running' ? 'default' : 'destructive'} className="text-xs">
                                      {container?.State || 'unknown'}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      CPU: {containerStats[container?.Id]?.cpu || 'N/A'} | RAM: {containerStats[container?.Id]?.ram || 'N/A'}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex gap-1">
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    className="rounded-lg h-8 w-8 p-0" 
                                    onClick={() => startContainer(container?.Id)}
                                    title="Start"
                                  >
                                    <Play className="w-3 h-3" />
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    className="rounded-lg h-8 w-8 p-0" 
                                    onClick={() => stopContainer(container?.Id)}
                                    title="Stop"
                                  >
                                    <Square className="w-3 h-3" />
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    className="rounded-lg h-8 w-8 p-0" 
                                    onClick={() => restartContainer(container?.Id)}
                                    title="Restart"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="rounded-lg h-8 px-2" 
                                    onClick={() => openBashModal(container?.Id, container?.Names?.[0]?.replace('/', '') || 'container')}
                                    disabled={container?.State !== 'running'}
                                    title="Open Bash"
                                  >
                                    <Terminal className="w-3 h-3 mr-1" />
                                    Bash
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Terminal Section */}
                  {showConsole && (
                    <div className="rounded-xl overflow-hidden border border-muted bg-black p-3 h-[400px]">
                      <h3 className="text-sm font-semibold text-muted-foreground mb-2">Terminal</h3>
                      <div className="h-[calc(100%-24px)]">
                        <ErrorBoundary>
                          <TerminalComponent />
                        </ErrorBoundary>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Column (The Editor) */}
                <Card className="rounded-xl border-muted overflow-hidden flex flex-col h-[700px] bg-card">
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
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Stack</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {stackToDelete}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteStack}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bash Exec Modal */}
      {selectedContainer && (
        <BashExecModal
          isOpen={bashModalOpen}
          onClose={closeBashModal}
          containerId={selectedContainer.id}
          containerName={selectedContainer.name}
        />
      )}
    </div>
  );
}
