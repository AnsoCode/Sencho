import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNodes } from '@/context/NodeContext';
import type { Node, NodeMode } from '@/context/NodeContext';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Combobox } from './ui/combobox';
import { Plus, Trash2, Wifi, WifiOff, Star, Pencil, Monitor, Globe, Copy, KeyRound, Check, AlertTriangle, Calendar, RefreshCw, Terminal } from 'lucide-react';
import { formatTimeUntil, formatTimeAgo } from '@/lib/relativeTime';

interface NodeSchedulingSummary {
  active_tasks: number;
  auto_update_enabled: boolean;
  next_run_at: number | null;
  stacks_with_updates: number;
}

export const SENCHO_NAVIGATE_EVENT = 'sencho-navigate';
export interface SenchoNavigateDetail {
  view: 'scheduled-ops' | 'auto-updates' | 'security-history';
  nodeId?: number;
}

interface NodeFormData {
  name: string;
  type: 'local' | 'remote';
  mode: NodeMode;
  api_url: string;
  api_token: string;
  compose_dir: string;
  is_default: boolean;
}

interface PilotEnrollment {
  token: string;
  expiresAt: number;
  dockerRun: string;
}

const defaultFormData: NodeFormData = {
  name: '',
  type: 'remote',
  mode: 'pilot_agent',
  api_url: '',
  api_token: '',
  compose_dir: '/app/compose',
  is_default: false,
};

export function NodeManager() {
  const { nodes, refreshNodes } = useNodes();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState<NodeFormData>(defaultFormData);
  const [editingNodeId, setEditingNodeId] = useState<number | null>(null);
  const [deletingNode, setDeletingNode] = useState<Node | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ nodeId: number; info: { serverVersion?: string; senchoVersion?: string; os?: string; architecture?: string; containers?: number; images?: number; cpus?: number } } | null>(null);

  // Node token generation state
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Pilot enrollment state (shown after creating a pilot-agent node)
  const [activeEnrollment, setActiveEnrollment] = useState<{ nodeId: number; nodeName: string; enrollment: PilotEnrollment } | null>(null);
  const [enrollmentCopied, setEnrollmentCopied] = useState(false);

  // Per-node scheduling summary
  const [nodeSummary, setNodeSummary] = useState<Record<number, NodeSchedulingSummary>>({});

  const fetchSchedulingSummary = useCallback(async () => {
    try {
      const res = await apiFetch('/nodes/scheduling-summary', { localOnly: true });
      if (res.ok) setNodeSummary(await res.json());
    } catch {
      // Non-fatal — summary is supplementary info
    }
  }, []);

  const nodeIdKey = useMemo(() => nodes.map(n => n.id).join(','), [nodes]);

  useEffect(() => {
    fetchSchedulingSummary();
  }, [nodeIdKey, fetchSchedulingSummary]);

  const handleCreate = async () => {
    try {
      const res = await apiFetch('/nodes', {
        method: 'POST',
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create node');
      }
      const body = await res.json();
      const newNodeId: number | undefined = body.id;
      const enrollment: PilotEnrollment | undefined = body.enrollment;
      toast.success(`Node "${formData.name}" created successfully`);

      const isPilot = formData.type === 'remote' && formData.mode === 'pilot_agent';
      if (isPilot && newNodeId && enrollment) {
        // Keep the dialog open so the admin can copy the docker run command.
        setActiveEnrollment({ nodeId: newNodeId, nodeName: formData.name, enrollment });
      } else {
        setCreateOpen(false);
        setFormData(defaultFormData);
      }

      // Auto-test the new node connection immediately (proxy mode only;
      // pilot agents flip online asynchronously once the container connects).
      if (newNodeId && formData.type === 'remote' && formData.mode === 'proxy') {
        setTesting(newNodeId);
        try {
          const testRes = await apiFetch(`/nodes/${newNodeId}/test`, { method: 'POST' });
          const testData = await testRes.json();
          if (testData.success) {
            toast.success(`Connected to "${formData.name}" successfully`);
            setTestResult({ nodeId: newNodeId, info: testData.info });
          } else {
            toast.warning(`Node saved, but connection test failed: ${testData.error}`);
          }
        } catch {
          // Non-fatal
        } finally {
          setTesting(null);
        }
      }

      await refreshNodes();
    } catch (error) {
      toast.error((error as Error).message || 'Failed to create node');
    }
  };

  const regenerateEnrollment = async (node: Node) => {
    try {
      const res = await apiFetch(`/nodes/${node.id}/pilot/enroll`, { method: 'POST', localOnly: true });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to regenerate enrollment');
      }
      const { enrollment } = (await res.json()) as { enrollment: PilotEnrollment };
      setActiveEnrollment({ nodeId: node.id, nodeName: node.name, enrollment });
      toast.success('New enrollment token generated');
    } catch (error) {
      toast.error((error as Error).message || 'Failed to regenerate enrollment');
    }
  };

  const copyEnrollment = async () => {
    if (!activeEnrollment) return;
    const text = activeEnrollment.enrollment.dockerRun;
    try {
      await navigator.clipboard.writeText(text);
      setEnrollmentCopied(true);
      toast.success('Command copied to clipboard');
      setTimeout(() => setEnrollmentCopied(false), 2000);
    } catch {
      toast.error('Could not copy automatically - please select and copy the command manually.');
    }
  };

  const handleEdit = async () => {
    if (!editingNodeId) return;
    try {
      const res = await apiFetch(`/nodes/${editingNodeId}`, {
        method: 'PUT',
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update node');
      }
      toast.success(`Node "${formData.name}" updated`);
      setEditOpen(false);
      setEditingNodeId(null);
      setFormData(defaultFormData);
      await refreshNodes();
    } catch (error) {
      toast.error((error as Error).message || 'Failed to update node');
    }
  };

  const openEditDialog = (node: Node) => {
    setFormData({
      name: node.name,
      type: node.type,
      mode: (node.mode === 'pilot_agent' ? 'pilot_agent' : 'proxy'),
      api_url: node.api_url || '',
      api_token: node.api_token || '',
      compose_dir: node.compose_dir,
      is_default: node.is_default,
    });
    setEditingNodeId(node.id);
    setEditOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingNode) return;
    try {
      const res = await apiFetch(`/nodes/${deletingNode.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete node');
      }
      toast.success(`Node "${deletingNode.name}" deleted`);
      setDeleteOpen(false);
      setDeletingNode(null);
      await refreshNodes();
    } catch (error) {
      toast.error((error as Error).message || 'Failed to delete node');
    }
  };

  const testConnection = async (node: Node) => {
    setTesting(node.id);
    setTestResult(null);
    try {
      const res = await apiFetch(`/nodes/${node.id}/test`, { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        toast.success(`Connected to "${node.name}" successfully`);
        setTestResult({ nodeId: node.id, info: result.info });
      } else {
        toast.error(`Failed to connect: ${result.error}`);
      }
      await refreshNodes();
    } catch (error) {
      toast.error((error as Error).message || 'Connection test failed');
    } finally {
      setTesting(null);
    }
  };

  const generateNodeToken = async () => {
    setGeneratingToken(true);
    setGeneratedToken(null);
    try {
      const res = await apiFetch('/auth/generate-node-token', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to generate token');
      const { token } = await res.json();
      setGeneratedToken(token);
      toast.success('Node token generated');
    } catch (error) {
      toast.error((error as Error).message || 'Failed to generate token');
    } finally {
      setGeneratingToken(false);
    }
  };

  const copyToken = async () => {
    if (!generatedToken) return;
    try {
      // Clipboard API requires a secure context (HTTPS or localhost)
      await navigator.clipboard.writeText(generatedToken);
      setTokenCopied(true);
      toast.success('Token copied to clipboard');
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      // Fallback for HTTP / non-localhost deployments where Clipboard API is unavailable
      try {
        const ta = document.createElement('textarea');
        ta.value = generatedToken;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setTokenCopied(true);
        toast.success('Token copied to clipboard');
        setTimeout(() => setTokenCopied(false), 2000);
      } catch {
        toast.error('Could not copy automatically - please select and copy the token manually.');
      }
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'online':
        return <Badge variant="default" className="bg-green-600 text-white gap-1"><Wifi className="w-3 h-3" /> Online</Badge>;
      case 'offline':
        return <Badge variant="destructive" className="gap-1"><WifiOff className="w-3 h-3" /> Offline</Badge>;
      default:
        return <Badge variant="secondary" className="gap-1">Unknown</Badge>;
    }
  };

  const getNodeIcon = (type: string) => {
    return type === 'local'
      ? <Monitor className="w-4 h-4 text-muted-foreground" />
      : <Globe className="w-4 h-4 text-muted-foreground" />;
  };

  const renderFormFields = () => (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="node-name">Name</Label>
        <Input
          id="node-name"
          placeholder="e.g., Production VPS"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="node-type">Type</Label>
        <Select
          value={formData.type}
          onValueChange={(val) => setFormData({ ...formData, type: val as 'local' | 'remote', api_url: '', api_token: '' })}
        >
          <SelectTrigger id="node-type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4" />
                Local - Docker socket on this machine
              </div>
            </SelectItem>
            <SelectItem value="remote">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Remote - another Sencho instance
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {formData.type === 'remote' && (
        <div className="space-y-2">
          <Label htmlFor="node-mode">Mode</Label>
          <Combobox
            id="node-mode"
            value={formData.mode}
            onValueChange={(val) => setFormData({ ...formData, mode: val as NodeMode, api_url: '', api_token: '' })}
            options={[
              { value: 'pilot_agent', label: 'Pilot Agent - outbound tunnel from remote host' },
              { value: 'proxy', label: 'Distributed API Proxy - primary dials the remote' },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Pilot Agent requires only outbound HTTPS from the remote host. Distributed API Proxy requires the remote host to expose an inbound port.
          </p>
        </div>
      )}

      {formData.type === 'remote' && formData.mode === 'proxy' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="node-api-url">Sencho API URL</Label>
            <Input
              id="node-api-url"
              placeholder="http://192.168.1.50:3000"
              value={formData.api_url}
              onChange={(e) => setFormData({ ...formData, api_url: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              The base URL of the Sencho instance running on the remote machine.
            </p>
            {formData.api_url.startsWith('http://') && (
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 mt-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" strokeWidth={1.5} />
                  <p className="text-xs text-warning">
                    This URL uses plain HTTP. If this node is reachable over the public internet, use HTTPS
                    or a VPN to prevent token interception. HTTP is fine for private networks (LAN, VPN, VPC).
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="node-api-token">API Token</Label>
            <Input
              id="node-api-token"
              type="password"
              placeholder="Paste token from remote Sencho → Settings → Nodes → Generate Token"
              value={formData.api_token}
              onChange={(e) => setFormData({ ...formData, api_token: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Generate this token on the <strong>remote</strong> Sencho instance using the "Generate Node Token" button in its Settings → Nodes panel.
            </p>
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="node-compose-dir">Compose Directory</Label>
        <Input
          id="node-compose-dir"
          placeholder="/app/compose"
          value={formData.compose_dir}
          onChange={(e) => setFormData({ ...formData, compose_dir: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          The root directory where compose stack folders live on this node.
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex justify-end">
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            // Reset form to defaults every time the dialog opens
            if (open) setFormData(defaultFormData);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1 shrink-0">
              <Plus className="w-4 h-4" />
              Add Node
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader className="pr-8">
              <DialogTitle>Add {formData.type === 'local' ? 'Local' : 'Remote'} Node</DialogTitle>
            </DialogHeader>
            {renderFormFields()}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                onClick={handleCreate}
                disabled={
                  !formData.name ||
                  (formData.type === 'remote' && formData.mode === 'proxy' && (!formData.api_url || !formData.api_token))
                }
              >
                Add Node
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Separator />

      {/* Generate Node Token - for use on THIS instance as a remote target */}
      <div className="rounded-md border p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-500" />
              Generate Node Token
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Create a long-lived token that allows another Sencho instance to use <strong>this</strong> instance as a remote node. Copy it and paste it into the other Sencho instance's "Add Node" form.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={generateNodeToken}
            disabled={generatingToken}
            className="shrink-0"
          >
            {generatingToken ? 'Generating...' : 'Generate Token'}
          </Button>
        </div>

        {generatedToken && (
          <div className="flex items-center gap-2 rounded-md bg-muted p-2">
            <code className="flex-1 text-xs font-mono truncate text-muted-foreground">{generatedToken}</code>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={copyToken}>
              {tokenCopied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
        )}
      </div>

      {/* Nodes Table */}
      <div className="rounded-md border overflow-x-auto w-full">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Schedules</TableHead>
              <TableHead>Updates</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => (
              <TableRow key={node.id}>
                <TableCell>
                  {node.is_default && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                        </TooltipTrigger>
                        <TooltipContent>Default Node</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {getNodeIcon(node.type)}
                    {node.name}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{node.type === 'local' ? 'Local' : 'Remote'}</Badge>
                </TableCell>
                <TableCell>
                  {node.type === 'local' ? (
                    <span className="text-muted-foreground text-sm">-</span>
                  ) : node.mode === 'pilot_agent' ? (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Terminal className="w-3 h-3" strokeWidth={1.5} />
                      Pilot Agent
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Globe className="w-3 h-3" strokeWidth={1.5} />
                      Proxy
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm font-mono">
                  {node.type === 'local'
                    ? 'docker.sock'
                    : node.mode === 'pilot_agent'
                      ? (node.pilot_last_seen
                        ? `tunnel (seen ${formatTimeAgo(node.pilot_last_seen)})`
                        : 'tunnel (waiting)')
                      : (node.api_url || '-')}
                </TableCell>
                <TableCell>{getStatusBadge(node.status)}</TableCell>
                <TableCell>
                  {(() => {
                    const summary = nodeSummary[node.id];
                    if (!summary || summary.active_tasks === 0) {
                      return <span className="text-muted-foreground text-sm">—</span>;
                    }
                    return (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm tabular-nums tracking-tight">
                          {summary.active_tasks}
                        </span>
                        {summary.next_run_at && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <span className="text-xs text-muted-foreground">
                                  next {formatTimeUntil(summary.next_run_at)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {new Date(summary.next_run_at).toLocaleString()}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  {(() => {
                    const summary = nodeSummary[node.id];
                    return (
                      <div className="flex items-center gap-1.5">
                        {summary?.auto_update_enabled ? (
                          <Badge variant="outline" className="text-info border-info/30 gap-1 text-xs">
                            <RefreshCw className="w-3 h-3" strokeWidth={1.5} />
                            Auto
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">Off</span>
                        )}
                        {(summary?.stacks_with_updates ?? 0) > 0 && (
                          <span className="flex items-center gap-1">
                            <span className="relative inline-flex w-2 h-2 shrink-0">
                              <span className="absolute inset-0 rounded-full bg-update opacity-75 animate-ping" />
                              <span className="relative w-2 h-2 rounded-full bg-update" />
                            </span>
                            <span className="font-mono text-xs tabular-nums tracking-tight text-update">
                              {summary!.stacks_with_updates}
                            </span>
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              window.dispatchEvent(new CustomEvent<SenchoNavigateDetail>(SENCHO_NAVIGATE_EVENT, {
                                detail: { view: 'scheduled-ops', nodeId: node.id },
                              }));
                            }}
                          >
                            <Calendar className="w-4 h-4" strokeWidth={1.5} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>View Schedules</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => testConnection(node)}
                            disabled={testing === node.id}
                          >
                            <Wifi className={`w-4 h-4 ${testing === node.id ? 'animate-pulse' : ''}`} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Test Connection</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEditDialog(node)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit Node</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    {!node.is_default && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => { setDeletingNode(node); setDeleteOpen(true); }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete Node</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Connection Test Result */}
      {testResult && (
        <div className="rounded-md border p-4 bg-muted/30 space-y-2">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Wifi className="w-4 h-4 text-success" />
            Connection Details - {nodes.find(n => n.id === testResult.nodeId)?.name}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><span className="text-muted-foreground">Instance:</span> {testResult.info.serverVersion}</div>
            {testResult.info.senchoVersion && (
              <div><span className="text-muted-foreground">Sencho:</span> <span className="font-mono tabular-nums">v{testResult.info.senchoVersion}</span></div>
            )}
            <div><span className="text-muted-foreground">OS:</span> {testResult.info.os}</div>
            <div><span className="text-muted-foreground">Arch:</span> {testResult.info.architecture}</div>
            <div><span className="text-muted-foreground">Containers:</span> {testResult.info.containers}</div>
            <div><span className="text-muted-foreground">Images:</span> {testResult.info.images}</div>
            <div><span className="text-muted-foreground">CPUs:</span> {testResult.info.cpus}</div>
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="pr-8">
            <DialogTitle>Edit Node</DialogTitle>
          </DialogHeader>
          {renderFormFields()}
          {formData.type === 'remote' && formData.mode === 'pilot_agent' && editingNodeId !== null && (
            <div className="rounded-md border border-card-border bg-card/50 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Re-enroll the agent if the container was lost or the enrollment token expired. The previous tunnel is disconnected automatically.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const node = nodes.find((n) => n.id === editingNodeId);
                  if (node) regenerateEnrollment(node);
                }}
                className="gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.5} />
                Regenerate enrollment token
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setEditingNodeId(null); }}>Cancel</Button>
            <Button
              onClick={handleEdit}
              disabled={
                !formData.name ||
                (formData.type === 'remote' && formData.mode === 'proxy' && !formData.api_url)
              }
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pilot enrollment dialog (create + regenerate flows both open this) */}
      <Dialog
        open={activeEnrollment !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActiveEnrollment(null);
            setEnrollmentCopied(false);
            setCreateOpen(false);
            setFormData(defaultFormData);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader className="pr-8">
            <DialogTitle>Enroll the pilot agent</DialogTitle>
          </DialogHeader>
          {activeEnrollment && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Run this command on <strong>{activeEnrollment.nodeName}</strong> to start the pilot agent. The token below is valid for 15 minutes and can only be used once.
              </p>
              <div className="rounded-md border border-card-border bg-muted/50 p-3">
                <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/90">{activeEnrollment.enrollment.dockerRun}</pre>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Expires <span className="font-mono tabular-nums">{formatTimeUntil(activeEnrollment.enrollment.expiresAt)}</span> from now.
                </p>
                <Button size="sm" variant="outline" className="gap-1" onClick={copyEnrollment}>
                  {enrollmentCopied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  {enrollmentCopied ? 'Copied' : 'Copy command'}
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                setActiveEnrollment(null);
                setEnrollmentCopied(false);
                setCreateOpen(false);
                setEditOpen(false);
                setFormData(defaultFormData);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Node</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{deletingNode?.name}</strong>? This will only remove the node from Sencho - it will not affect the remote instance or any running containers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
