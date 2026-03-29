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
import { Clock, Plus, Pencil, Trash2, History, RefreshCw, Play } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import cronstrue from 'cronstrue';

interface ScheduledTask {
  id: number;
  name: string;
  target_type: 'stack' | 'fleet' | 'system';
  target_id: string | null;
  node_id: number | null;
  action: 'restart' | 'snapshot' | 'prune';
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
}

interface NodeOption {
  id: number;
  name: string;
}

const ACTION_OPTIONS = [
  { value: 'restart', label: 'Restart Stack', targetType: 'stack' as const },
  { value: 'snapshot', label: 'Fleet Snapshot', targetType: 'fleet' as const },
  { value: 'prune', label: 'System Prune', targetType: 'system' as const },
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

export default function ScheduledOperationsView() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [runsTask, setRunsTask] = useState<ScheduledTask | null>(null);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formAction, setFormAction] = useState('restart');
  const [formTargetId, setFormTargetId] = useState('');
  const [formNodeId, setFormNodeId] = useState('');
  const [formCron, setFormCron] = useState('0 3 * * *');
  const [formEnabled, setFormEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<number | null>(null);

  // Available stacks and nodes for selection
  const [stacks, setStacks] = useState<string[]>([]);
  const [nodes, setNodes] = useState<NodeOption[]>([]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/scheduled-tasks', { localOnly: true });
      if (res.ok) {
        setTasks(await res.json());
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
      if (res.ok) {
        setStacks(await res.json());
      }
    } catch {
      // Non-critical
    }
  }, []);

  const fetchNodes = useCallback(async () => {
    try {
      const res = await apiFetch('/nodes', { localOnly: true });
      if (res.ok) {
        const data = await res.json();
        setNodes(data.map((n: { id: number; name: string }) => ({ id: n.id, name: n.name })));
      }
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchStacks();
    fetchNodes();
  }, [fetchTasks, fetchStacks, fetchNodes]);

  const openCreate = () => {
    setEditingTask(null);
    setFormName('');
    setFormAction('restart');
    setFormTargetId('');
    setFormNodeId('');
    setFormCron('0 3 * * *');
    setFormEnabled(true);
    setDialogOpen(true);
  };

  const openEdit = (task: ScheduledTask) => {
    setEditingTask(task);
    setFormName(task.name);
    setFormAction(task.action);
    setFormTargetId(task.target_id || '');
    setFormNodeId(task.node_id != null ? String(task.node_id) : '');
    setFormCron(task.cron_expression);
    setFormEnabled(task.enabled === 1);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const actionOption = ACTION_OPTIONS.find(a => a.value === formAction);
    if (!actionOption) return;

    const body: Record<string, unknown> = {
      name: formName,
      target_type: actionOption.targetType,
      action: formAction,
      cron_expression: formCron,
      enabled: formEnabled,
    };

    if (actionOption.targetType === 'stack') {
      body.target_id = formTargetId;
      body.node_id = formNodeId ? parseInt(formNodeId, 10) : null;
    }

    setSaving(true);
    try {
      const res = editingTask
        ? await apiFetch(`/scheduled-tasks/${editingTask.id}`, { method: 'PUT', body: JSON.stringify(body), localOnly: true })
        : await apiFetch('/scheduled-tasks', { method: 'POST', body: JSON.stringify(body), localOnly: true });

      if (res.ok) {
        toast.success(editingTask ? 'Task updated' : 'Task created');
        setDialogOpen(false);
        fetchTasks();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Failed to save task');
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Something went wrong.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (task: ScheduledTask) => {
    try {
      const res = await apiFetch(`/scheduled-tasks/${task.id}/toggle`, { method: 'PATCH', localOnly: true });
      if (res.ok) {
        fetchTasks();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Failed to toggle task');
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
        toast.success('Task deleted');
        setDeleteTarget(null);
        fetchTasks();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Failed to delete task');
      }
    } catch {
      toast.error('Something went wrong.');
    }
  };

  const openRuns = async (task: ScheduledTask) => {
    setRunsTask(task);
    setRunsLoading(true);
    try {
      const res = await apiFetch(`/scheduled-tasks/${task.id}/runs?limit=50`, { localOnly: true });
      if (res.ok) {
        setRuns(await res.json());
      }
    } catch {
      // Non-critical
    } finally {
      setRunsLoading(false);
    }
  };

  const handleRunNow = async (task: ScheduledTask) => {
    setRunningTaskId(task.id);
    try {
      const res = await apiFetch(`/scheduled-tasks/${task.id}/run`, { method: 'POST', localOnly: true });
      if (res.ok) {
        toast.success(`Task "${task.name}" executed successfully`);
        fetchTasks();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Failed to run task');
      }
    } catch {
      toast.error('Something went wrong.');
    } finally {
      setRunningTaskId(null);
    }
  };

  const targetType = ACTION_OPTIONS.find(a => a.value === formAction)?.targetType;
  const cronDescription = getCronDescription(formCron);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              <CardTitle>Scheduled Operations</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchTasks} disabled={loading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="w-4 h-4 mr-2" />
                New Schedule
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && tasks.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">Loading...</div>
          ) : tasks.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              No scheduled tasks yet. Create one to automate recurring operations.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">{task.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {ACTION_OPTIONS.find(a => a.value === task.action)?.label || task.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {task.target_type === 'stack' ? task.target_id : task.target_type}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{getCronDescription(task.cron_expression)}</div>
                      <div className="text-xs text-muted-foreground font-mono">{task.cron_expression}</div>
                    </TableCell>
                    <TableCell>
                      {task.last_status === 'success' ? (
                        <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Success</Badge>
                      ) : task.last_status === 'failure' ? (
                        <Badge variant="destructive">Failed</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Never run</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatTimestamp(task.next_run_at)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={task.enabled === 1}
                        onCheckedChange={() => handleToggle(task)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleRunNow(task)} title="Run now" disabled={runningTaskId === task.id}>
                          <Play className={`w-4 h-4 ${runningTaskId === task.id ? 'animate-pulse' : ''}`} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openRuns(task)} title="Execution history">
                          <History className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(task)} title="Edit">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(task)} title="Delete" className="text-destructive hover:text-destructive">
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
            <DialogTitle>{editingTask ? 'Edit Scheduled Task' : 'New Scheduled Task'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="e.g. Nightly stack restart" value={formName} onChange={e => setFormName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Action</Label>
              <Select value={formAction} onValueChange={(val) => { setFormAction(val); setFormTargetId(''); setFormNodeId(''); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {targetType === 'stack' && (
              <>
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
              </>
            )}

            <div className="space-y-2">
              <Label>Cron Expression</Label>
              <Input
                placeholder="0 3 * * *"
                value={formCron}
                onChange={e => setFormCron(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">{cronDescription}</p>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={formEnabled} onCheckedChange={setFormEnabled} id="task-enabled" />
              <Label htmlFor="task-enabled">Enabled</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formName || !formCron || (targetType === 'stack' && (!formTargetId || !formNodeId))}>
              {saving ? 'Saving...' : editingTask ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scheduled Task</AlertDialogTitle>
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
            <SheetTitle>Execution History - {runsTask?.name}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            {runsLoading ? (
              <div className="text-center text-muted-foreground py-8">Loading...</div>
            ) : runs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No executions yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
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
                          {run.status === 'success' ? (
                            <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Success</Badge>
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
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
