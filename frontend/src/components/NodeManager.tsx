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
import { Separator } from './ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Plus, Trash2, Wifi, WifiOff, Star, Pencil, Server, Monitor, Globe, Copy, KeyRound, Check } from 'lucide-react';

interface NodeFormData {
  name: string;
  type: 'local' | 'remote';
  api_url: string;
  api_token: string;
  compose_dir: string;
  is_default: boolean;
}

const defaultFormData: NodeFormData = {
  name: '',
  type: 'remote',
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
  const [testResult, setTestResult] = useState<{ nodeId: number; info: { serverVersion?: string; os?: string; architecture?: string; containers?: number; images?: number; cpus?: number } } | null>(null);

  // Node token generation state
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

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
      const { id: newNodeId } = await res.json();
      toast.success(`Node "${formData.name}" created successfully`);
      setCreateOpen(false);
      setFormData(defaultFormData);

      // Auto-test the new node connection immediately
      if (newNodeId && formData.type === 'remote') {
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
      {/* Header */}
      <div className="flex items-center justify-between pr-8">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="w-5 h-5" />
            Nodes
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage connections to local and remote Sencho instances
          </p>
        </div>
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
                disabled={!formData.name || (formData.type === 'remote' && (!formData.api_url || !formData.api_token))}
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
              <TableHead>Endpoint</TableHead>
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
                  {node.type === 'local' ? 'docker.sock' : (node.api_url || '-')}
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
            <Wifi className="w-4 h-4 text-success" />
            Connection Details - {nodes.find(n => n.id === testResult.nodeId)?.name}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><span className="text-muted-foreground">Instance:</span> {testResult.info.serverVersion}</div>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setEditingNodeId(null); }}>Cancel</Button>
            <Button
              onClick={handleEdit}
              disabled={!formData.name || (formData.type === 'remote' && !formData.api_url)}
            >
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
