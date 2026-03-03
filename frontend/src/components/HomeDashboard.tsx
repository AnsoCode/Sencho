import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Activity, Square, ArrowRight, Plus, Cpu, HardDrive, MemoryStick, Network } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Label } from './ui/label';

interface Stats {
  active: number;
  exited: number;
  total: number;
  inactive: number;
}

interface SystemStats {
  cpu: {
    usage: string;
    cores: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: string;
  };
  disk: {
    fs: string;
    mount: string;
    total: number;
    used: number;
    free: number;
    usagePercent: string;
  } | null;
  network?: {
    rxBytes: number;
    txBytes: number;
    rxSec: number;
    txSec: number;
  };
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function HomeDashboard() {
  const [dockerRunInput, setDockerRunInput] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [convertedYaml, setConvertedYaml] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newStackName, setNewStackName] = useState('');
  const [stats, setStats] = useState<Stats>({ active: 0, exited: 0, total: 0, inactive: 0 });
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);

  // Fetch stats from backend
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await apiFetch('/stats');
        const data = await res.json();
        setStats(data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch system stats from backend
  useEffect(() => {
    const fetchSystemStats = async () => {
      try {
        const res = await apiFetch('/system/stats');
        const data = await res.json();
        setSystemStats(data);
      } catch (error) {
        console.error('Failed to fetch system stats:', error);
      }
    };
    fetchSystemStats();
    const interval = setInterval(fetchSystemStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleConvert = async () => {
    if (!dockerRunInput.trim()) return;
    setIsConverting(true);
    try {
      const response = await apiFetch('/convert', {
        method: 'POST',
        body: JSON.stringify({ dockerRun: dockerRunInput }),
      });
      if (!response.ok) throw new Error('Conversion failed');
      const data = await response.json();
      setConvertedYaml(data.yaml);
    } catch (error) {
      console.error('Conversion error:', error);
      toast.error('Failed to convert docker run command');
    } finally {
      setIsConverting(false);
    }
  };

  const handleCreateStack = async () => {
    if (!newStackName.trim() || !convertedYaml) return;
    // Send stackName directly (no .yml extension - backend creates directory)
    const stackName = newStackName.trim();
    try {
      // Create the stack
      const createResponse = await apiFetch('/stacks', {
        method: 'POST',
        body: JSON.stringify({ stackName }),
      });
      if (!createResponse.ok) throw new Error('Failed to create stack');

      // Save the converted YAML content
      const saveResponse = await apiFetch(`/stacks/${stackName}`, {
        method: 'PUT',
        body: JSON.stringify({ content: convertedYaml }),
      });
      if (!saveResponse.ok) throw new Error('Failed to save stack content');

      setCreateDialogOpen(false);
      setNewStackName('');
      setConvertedYaml('');
      setDockerRunInput('');
      window.location.reload(); // Refresh to show new stack
    } catch (error) {
      console.error('Failed to create stack:', error);
      toast.error('Failed to create stack');
    }
  };

  const handleUseConvertedYaml = () => {
    setCreateDialogOpen(true);
  };

  return (
    <div className="flex-1 p-6 space-y-6">
      {/* Container Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-xl border-muted bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Containers</CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-500">{stats.active}</div>
            <p className="text-xs text-muted-foreground mt-1">Currently running</p>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-muted bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Exited Containers</CardTitle>
            <Square className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">{stats.exited}</div>
            <p className="text-xs text-muted-foreground mt-1">Stopped or crashed</p>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-muted bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Docker Network</CardTitle>
            <Network className="h-4 w-4 text-cyan-500" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-cyan-500 whitespace-nowrap">
              {systemStats?.network
                ? `${formatBytes(systemStats.network.rxSec)}/s ↓`
                : '...'}
            </div>
            <p className="text-xs text-muted-foreground mt-1 whitespace-nowrap">
              {systemStats?.network
                ? `${formatBytes(systemStats.network.txSec)}/s ↑`
                : 'Loading...'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Host System Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-xl border-muted bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Host CPU</CardTitle>
            <Cpu className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-500">
              {systemStats ? `${systemStats.cpu.usage}%` : '...'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {systemStats ? `${systemStats.cpu.cores} cores` : 'Loading...'}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-muted bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Host RAM</CardTitle>
            <MemoryStick className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-500">
              {systemStats ? `${systemStats.memory.usagePercent}%` : '...'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {systemStats
                ? `${formatBytes(systemStats.memory.used)} / ${formatBytes(systemStats.memory.total)}`
                : 'Loading...'}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-muted bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Host Disk</CardTitle>
            <HardDrive className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-500">
              {systemStats?.disk ? `${systemStats.disk.usagePercent}%` : '...'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {systemStats?.disk
                ? `${formatBytes(systemStats.disk.used)} / ${formatBytes(systemStats.disk.total)}`
                : 'Loading...'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Docker Run Converter */}
      <Card className="rounded-xl border-muted bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Convert Docker Run to Compose</CardTitle>
          <p className="text-sm text-muted-foreground">
            Paste your <code className="bg-muted px-1 rounded">docker run</code> command below to convert it to a Docker Compose YAML file.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <textarea
            className="w-full h-32 p-3 rounded-lg border border-muted bg-background text-foreground font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="docker run -d --name my-app -p 8080:80 -e TZ=UTC nginx:latest"
            value={dockerRunInput}
            onChange={(e) => setDockerRunInput(e.target.value)}
          />

          <div className="flex gap-2">
            <Button onClick={handleConvert} disabled={isConverting || !dockerRunInput.trim()}>
              {isConverting ? 'Converting...' : 'Convert'}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>

          {convertedYaml && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-muted/50 font-mono text-sm whitespace-pre-wrap overflow-auto max-h-64">
                {convertedYaml}
              </div>
              <Button onClick={handleUseConvertedYaml}>
                <Plus className="w-4 h-4 mr-2" />
                Create Stack from YAML
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Stack Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Stack</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stack-name">Stack Name</Label>
              <Input
                id="stack-name"
                placeholder="e.g., myapp"
                value={newStackName}
                onChange={(e) => setNewStackName(e.target.value)}
              />
            </div>
            {convertedYaml && (
              <div className="space-y-2">
                <Label>Converted Compose File (Preview)</Label>
                <div className="p-3 rounded-lg bg-muted/50 font-mono text-sm whitespace-pre-wrap overflow-auto max-h-48">
                  {convertedYaml}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateStack} disabled={!newStackName.trim()}>Create Stack</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
