import { useState } from 'react';
import { useNodes } from '@/context/NodeContext';
import type { Node } from '@/context/NodeContext';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Plus, Trash2, Wifi, WifiOff, Star, Pencil, Server, Monitor, Globe } from 'lucide-react';

interface NodeFormData {
  name: string;
  type: 'local' | 'remote';
  host: string;
  port: number;
  compose_dir: string;
  is_default: boolean;
}

const defaultFormData: NodeFormData = {
  name: '',
  type: 'remote',
  host: '',
  port: 2375,
  compose_dir: '/opt/docker',
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
  const [testResult, setTestResult] = useState<{ nodeId: number; info: any } | null>(null);

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
      toast.success(`Node "${formData.name}" created successfully`);
      setCreateOpen(false);
      setFormData(defaultFormData);
      await refreshNodes();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create node');
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
    } catch (error: any) {
      toast.error(error.message || 'Failed to update node');
    }
  };

  const openEditDialog = (node: Node) => {
    setFormData({
      name: node.name,
      type: node.type,
      host: node.host,
      port: node.port,
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
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete node');
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
    } catch (error: any) {
      toast.error(error.message || 'Connection test failed');
    } finally {
      setTesting(null);
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
        <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v as 'local' | 'remote' })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local (Docker Socket)</SelectItem>
            <SelectItem value="remote">Remote (TCP)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {formData.type === 'remote' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="node-host">Host</Label>
            <Input
              id="node-host"
              placeholder="e.g., 192.168.1.50 or vps.example.com"
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="node-port">Docker API Port</Label>
            <Input
              id="node-port"
              type="number"
              placeholder="2375"
              value={formData.port}
              onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 2375 })}
            />
            <p className="text-xs text-muted-foreground">
              Default: 2375 (unencrypted) or 2376 (TLS)
            </p>
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="node-compose-dir">Compose Directory</Label>
        <Input
          id="node-compose-dir"
          placeholder="/opt/docker"
          value={formData.compose_dir}
          onChange={(e) => setFormData({ ...formData, compose_dir: e.target.value })}
        />
        <div className="text-xs text-muted-foreground space-y-1 mt-1">
          <p>The root directory where compose stack folders live on this node.</p>
          <p className="text-amber-600 dark:text-amber-400 font-medium">
            Note: Strategy B requires valid SSH credentials to read and edit compose.yaml files. TCP alone only grants container lifecycle management.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="w-5 h-5" />
            Nodes
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage Docker daemon connections across local and remote hosts
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Plus className="w-4 h-4" />
              Add Node
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Add Remote Node</DialogTitle>
            </DialogHeader>
            {renderFormFields()}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!formData.name || (formData.type === 'remote' && !formData.host)}>
                Add Node
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Separator />

      {/* Nodes Table */}
      <div className="rounded-md border overflow-x-auto w-full">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Compose Dir</TableHead>
              <TableHead>Status</TableHead>
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
                <TableCell className="text-muted-foreground text-sm font-mono">
                  {node.type === 'local' ? 'docker.sock' : `${node.host}:${node.port}`}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm font-mono">
                  {node.compose_dir}
                </TableCell>
                <TableCell>{getStatusBadge(node.status)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
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
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Wifi className="w-4 h-4 text-green-500" />
            Connection Details — {nodes.find(n => n.id === testResult.nodeId)?.name}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><span className="text-muted-foreground">Docker:</span> v{testResult.info.serverVersion}</div>
            <div><span className="text-muted-foreground">OS:</span> {testResult.info.os}</div>
            <div><span className="text-muted-foreground">Arch:</span> {testResult.info.architecture}</div>
            <div><span className="text-muted-foreground">Containers:</span> {testResult.info.containers} ({testResult.info.containersRunning} running)</div>
            <div><span className="text-muted-foreground">Images:</span> {testResult.info.images}</div>
            <div><span className="text-muted-foreground">CPUs:</span> {testResult.info.cpus}</div>
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit Node</DialogTitle>
          </DialogHeader>
          {renderFormFields()}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setEditingNodeId(null); }}>Cancel</Button>
            <Button onClick={handleEdit} disabled={!formData.name || (formData.type === 'remote' && !formData.host)}>
              Save Changes
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
              Are you sure you want to remove <strong>{deletingNode?.name}</strong>? This will only remove the node from Sencho — it will not affect the remote Docker daemon or any running containers.
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
