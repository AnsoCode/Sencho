import { useState, useEffect, useCallback } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RefreshCw, Plus, Pencil, Trash2, History, Play, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { ProGate } from '@/components/ProGate';
import { TierBadge } from '@/components/TierBadge';
import cronstrue from 'cronstrue';

interface ScheduledTask {
  id: number;
  name: string;
  target_type: 'stack' | 'fleet' | 'system';
  target_id: string | null;
  node_id: number | null;
  action: 'restart' | 'snapshot' | 'prune' | 'update';
  cron_expression: string;
  enabled: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  next_run_at: number | null;
  last_status: string | null;
  last_error: string | null;
}

interface TaskRun {
  id: number;
  task_id: number;
  started_at: number;
  completed_at: number | null;
  status: 'running' | 'success' | 'failure';
  output: string | null;
  error: string | null;
  triggered_by: 'scheduler' | 'manual';
}

interface NodeOption {
  id: number;
  name: string;
}

const CRON_PRESETS = [
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
  { label: 'Daily at 3 AM', value: '0 3 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Weekly (Sunday 3 AM)', value: '0 3 * * 0' },
  { label: 'Custom', value: 'custom' },
];

function getCronDescription(expression: string): string {
  try {
    return cronstrue.toString(expression);
  } catch {
    return 'Invalid expression';
  }
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function AutoUpdatePoliciesContent() {
  const [policies, setPolicies] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<ScheduledTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [runsTask, setRunsTask] = useState<ScheduledTask | null>(null);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formTargetId, setFormTargetId] = useState('');
  const [formNodeId, setFormNodeId] = useState('');
  const [formCron, setFormCron] = useState('0 3 * * *');
  const [formCronPreset, setFormCronPreset] = useState('0 3 * * *');
  const [formEnabled, setFormEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningPolicyId, setRunningPolicyId] = useState<number | null>(null);
  const [runsPage, setRunsPage] = useState(1);
  const [runsTotal, setRunsTotal] = useState(0);
  const runsLimit = 20;

  // Available stacks and nodes
  const [stacks, setStacks] = useState<string[]>([]);
  const [nodes, setNodes] = useState<NodeOption[]>([]);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/scheduled-tasks', { localOnly: true });
      if (res.ok) {
        const all: ScheduledTask[] = await res.json();
        setPolicies(all.filter(t => t.action === 'update'));
      }
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStacks = useCallback(async () => {
    try {
      const res = await apiFetch('/stacks');
      if (res.ok) setStacks(await res.json());
    } catch { /* Non-critical */ }
  }, []);

  const fetchNodes = useCallback(async () => {
    try {
      const res = await apiFetch('/nodes', { localOnly: true });
      if (res.ok) {
        const data = await res.json();
        setNodes(data.map((n: { id: number; name: string }) => ({ id: n.id, name: n.name })));
      }
    } catch { /* Non-critical */ }
  }, []);

  useEffect(() => {
    fetchPolicies();
    fetchStacks();
    fetchNodes();
  }, [fetchPolicies, fetchStacks, fetchNodes]);

  const openCreate = () => {
    setEditingPolicy(null);
    setFormName('');
    setFormTargetId('');
    setFormNodeId('');
    setFormCron('0 3 * * *');
    setFormCronPreset('0 3 * * *');
    setFormEnabled(true);
    setDialogOpen(true);
  };

  const openEdit = (policy: ScheduledTask) => {
    setEditingPolicy(policy);
    setFormName(policy.name);
    setFormTargetId(policy.target_id || '');
    setFormNodeId(policy.node_id != null ? String(policy.node_id) : '');
    setFormCron(policy.cron_expression);
    const matchingPreset = CRON_PRESETS.find(p => p.value === policy.cron_expression);
    setFormCronPreset(matchingPreset ? matchingPreset.value : 'custom');
    setFormEnabled(policy.enabled === 1);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const body: Record<string, unknown> = {
      name: formName,
      target_type: 'stack',
      action: 'update',
      target_id: formTargetId,
      node_id: formNodeId ? parseInt(formNodeId, 10) : null,
      cron_expression: formCron,
      enabled: formEnabled,
    };

    setSaving(true);
    try {
      const res = editingPolicy
        ? await apiFetch(`/scheduled-tasks/${editingPolicy.id}`, { method: 'PUT', body: JSON.stringify(body), localOnly: true })
        : await apiFetch('/scheduled-tasks', { method: 'POST', body: JSON.stringify(body), localOnly: true });

      if (res.ok) {
        toast.success(editingPolicy ? 'Policy updated' : 'Policy created');
        setDialogOpen(false);
        fetchPolicies();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Failed to save policy');
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Something went wrong.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (policy: ScheduledTask) => {
    try {
      const res = await apiFetch(`/scheduled-tasks/${policy.id}/toggle`, { method: 'PATCH', localOnly: true });
      if (res.ok) {
        fetchPolicies();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Failed to toggle policy');
      }
    } catch {
      toast.error('Something went wrong.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await apiFetch(`/scheduled-tasks/${deleteTarget.id}`, { method: 'DELETE', localOnly: true });
      if (res.ok) {
        toast.success('Policy deleted');
        setDeleteTarget(null);
        fetchPolicies();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Failed to delete policy');
      }
    } catch {
      toast.error('Something went wrong.');
    }
  };

  const openRuns = async (task: ScheduledTask, page = 1) => {
    setRunsTask(task);
    setRunsPage(page);
    setRunsLoading(true);
    const offset = (page - 1) * runsLimit;
    try {
      const res = await apiFetch(`/scheduled-tasks/${task.id}/runs?limit=${runsLimit}&offset=${offset}`, { localOnly: true });
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs);
        setRunsTotal(data.total);
      }
    } catch { /* Non-critical */ }
    finally { setRunsLoading(false); }
  };

  const handleRunNow = async (policy: ScheduledTask) => {
    setRunningPolicyId(policy.id);
    try {
      const res = await apiFetch(`/scheduled-tasks/${policy.id}/run`, { method: 'POST', localOnly: true });
      if (res.ok) {
        toast.success(`Checking for updates on "${policy.target_id}"...`);
        fetchPolicies();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Failed to run policy');
      }
    } catch {
      toast.error('Something went wrong.');
    } finally {
      setRunningPolicyId(null);
    }
  };

  const cronDescription = getCronDescription(formCron);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5" strokeWidth={1.5} />
              <CardTitle>Auto-Update Policies</CardTitle>
              <TierBadge tier="pro" variant="personal" status="active" />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchPolicies} disabled={loading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                Refresh
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="w-4 h-4 mr-2" />
                New Policy
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Automatically check for new images and update your stacks on a schedule.
          </p>
        </CardHeader>
        <CardContent>
          {loading && policies.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">Loading...</div>
          ) : policies.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              No auto-update policies yet. Create one to keep your stacks up to date automatically.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Stack</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell className="font-medium">{policy.name}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{policy.target_id}</TableCell>
                    <TableCell>
                      <div className="text-sm">{getCronDescription(policy.cron_expression)}</div>
                      <div className="text-xs text-muted-foreground font-mono">{policy.cron_expression}</div>
                    </TableCell>
                    <TableCell>
                      {policy.last_status === 'success' ? (
                        <Badge className="bg-success-muted text-success border-success/20">Success</Badge>
                      ) : policy.last_status === 'failure' ? (
                        <Badge variant="destructive">Failed</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Never run</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatTimestamp(policy.last_run_at)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatTimestamp(policy.next_run_at)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={policy.enabled === 1}
                        onCheckedChange={() => handleToggle(policy)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleRunNow(policy)} title="Run now" disabled={runningPolicyId === policy.id}>
                          <Play className={`w-4 h-4 ${runningPolicyId === policy.id ? 'animate-pulse' : ''}`} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openRuns(policy)} title="Execution history">
                          <History className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(policy)} title="Edit">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(policy)} title="Delete" className="text-destructive/60 hover:bg-destructive hover:text-destructive-foreground">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingPolicy ? 'Edit Auto-Update Policy' : 'New Auto-Update Policy'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="e.g. Update media stack nightly" value={formName} onChange={e => setFormName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Stack</Label>
              <Select value={formTargetId} onValueChange={setFormTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stack..." />
                </SelectTrigger>
                <SelectContent>
                  {stacks.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Node</Label>
              <Select value={formNodeId} onValueChange={setFormNodeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select node..." />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map(n => (
                    <SelectItem key={n.id} value={String(n.id)}>{n.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Check Frequency</Label>
              <Select value={formCronPreset} onValueChange={(val) => {
                setFormCronPreset(val);
                if (val !== 'custom') setFormCron(val);
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formCronPreset === 'custom' && (
                <Input
                  placeholder="0 3 * * *"
                  value={formCron}
                  onChange={e => setFormCron(e.target.value)}
                  className="font-mono"
                />
              )}
              <p className="text-xs text-muted-foreground">{cronDescription}</p>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={formEnabled} onCheckedChange={setFormEnabled} id="policy-enabled" />
              <Label htmlFor="policy-enabled">Enabled</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formName || !formCron || !formTargetId || !formNodeId}>
              {saving ? 'Saving...' : editingPolicy ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Auto-Update Policy</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This will also remove all execution history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Run History Sheet */}
      <Sheet open={!!runsTask} onOpenChange={(open) => { if (!open) setRunsTask(null); }}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>Update History - {runsTask?.name}</SheetTitle>
              {runsTask && runs.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(`/api/scheduled-tasks/${runsTask.id}/runs/export`, '_blank')}
                  title="Export as CSV"
                >
                  <Download className="w-4 h-4" strokeWidth={1.5} />
                </Button>
              )}
            </div>
          </SheetHeader>
          <div className="mt-4">
            {runsLoading ? (
              <div className="text-center text-muted-foreground py-8">Loading...</div>
            ) : runs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No executions yet.</div>
            ) : (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const duration = run.completed_at && run.started_at
                      ? `${((run.completed_at - run.started_at) / 1000).toFixed(1)}s`
                      : '-';
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {new Date(run.started_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {run.triggered_by === 'manual' ? 'Manual' : 'Scheduled'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {run.status === 'success' ? (
                            <Badge className="bg-success-muted text-success border-success/20">Success</Badge>
                          ) : run.status === 'failure' ? (
                            <Badge variant="destructive">Failed</Badge>
                          ) : (
                            <Badge variant="outline">Running</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{duration}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={run.output || run.error || ''}>
                          {run.error || run.output || '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {Math.ceil(runsTotal / runsLimit) > 1 && runsTask && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {runsPage} of {Math.ceil(runsTotal / runsLimit)}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => openRuns(runsTask, runsPage - 1)} disabled={runsPage <= 1}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openRuns(runsTask, runsPage + 1)} disabled={runsPage >= Math.ceil(runsTotal / runsLimit)}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function AutoUpdatePoliciesView() {
  return (
    <ProGate featureName="Auto-Update Policies">
      <AutoUpdatePoliciesContent />
    </ProGate>
  );
}
