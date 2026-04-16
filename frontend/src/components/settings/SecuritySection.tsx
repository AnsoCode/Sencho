import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { PaidGate } from '@/components/PaidGate';
import { TierBadge } from '@/components/TierBadge';
import { ShieldCheck, Plus, Trash2, Pencil } from 'lucide-react';
import type { ScanPolicy, VulnSeverity } from '@/types/security';

const SEVERITY_OPTIONS: Array<{ value: VulnSeverity; label: string }> = [
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];

interface PolicyFormState {
  name: string;
  stack_pattern: string;
  max_severity: VulnSeverity;
  block_on_deploy: boolean;
  enabled: boolean;
}

const EMPTY_FORM: PolicyFormState = {
  name: '',
  stack_pattern: '',
  max_severity: 'CRITICAL',
  block_on_deploy: false,
  enabled: true,
};

export function SecuritySection({ isPaid }: { isPaid: boolean }) {
  const [policies, setPolicies] = useState<ScanPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PolicyFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const fetchPolicies = async () => {
    try {
      const res = await apiFetch('/security/policies', { localOnly: true });
      if (res.ok) {
        const data = await res.json();
        setPolicies(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load scan policies:', err);
      toast.error('Failed to load scan policies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isPaid) fetchPolicies();
    else setLoading(false);
  }, [isPaid]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (policy: ScanPolicy) => {
    setEditingId(policy.id);
    setForm({
      name: policy.name,
      stack_pattern: policy.stack_pattern ?? '',
      max_severity: policy.max_severity,
      block_on_deploy: policy.block_on_deploy === 1,
      enabled: policy.enabled === 1,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Policy name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        stack_pattern: form.stack_pattern.trim() || null,
        max_severity: form.max_severity,
        block_on_deploy: form.block_on_deploy ? 1 : 0,
        enabled: form.enabled ? 1 : 0,
      };
      const url = editingId ? `/security/policies/${editingId}` : '/security/policies';
      const method = editingId ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        localOnly: true,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to save policy');
      }
      toast.success(editingId ? 'Policy updated' : 'Policy created');
      setDialogOpen(false);
      fetchPolicies();
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    try {
      const res = await apiFetch(`/security/policies/${deleteId}`, {
        method: 'DELETE',
        localOnly: true,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to delete policy');
      }
      toast.success('Policy deleted');
      fetchPolicies();
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to delete policy');
    } finally {
      setDeleteId(null);
    }
  };

  if (!isPaid) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium tracking-tight flex items-center gap-2">
            Security <TierBadge />
          </h3>
          <p className="text-sm text-muted-foreground">
            Define vulnerability scan policies that gate or warn on deploys.
          </p>
        </div>
        <PaidGate featureName="Scan Policies">
          <div className="space-y-3">
            <div className="h-16 rounded-lg border bg-card" />
            <div className="h-16 rounded-lg border bg-card" />
          </div>
        </PaidGate>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between pr-8">
        <div>
          <h3 className="text-lg font-medium tracking-tight flex items-center gap-2">
            Security <TierBadge />
          </h3>
          <p className="text-sm text-muted-foreground">
            Policies evaluate every post-deploy scan and alert (or block) when severity exceeds the threshold.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add Policy
        </Button>
      </div>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      )}

      {!loading && policies.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ShieldCheck className="w-10 h-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No scan policies configured.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add one to enforce severity thresholds across your fleet.
          </p>
        </div>
      )}

      {!loading &&
        policies.map((policy) => (
          <div key={policy.id} className="border border-glass-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span className="font-medium text-sm truncate">{policy.name}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  max: {policy.max_severity}
                </Badge>
                {policy.block_on_deploy === 1 && (
                  <Badge variant="destructive" className="text-[10px] shrink-0">
                    block
                  </Badge>
                )}
                {policy.enabled === 0 && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    disabled
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => openEdit(policy)}
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.5} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive/60 hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => setDeleteId(policy.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Scope: {policy.stack_pattern ? (
                <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">{policy.stack_pattern}</code>
              ) : (
                <span className="italic">all stacks</span>
              )}
            </div>
          </div>
        ))}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Policy' : 'New Policy'}</DialogTitle>
            <DialogDescription className="sr-only">
              Configure the severity threshold and scope for this scan policy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="policy-name">Name</Label>
              <Input
                id="policy-name"
                placeholder="Production block on critical"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-pattern">Stack pattern (optional)</Label>
              <Input
                id="policy-pattern"
                placeholder="e.g. prod-* or leave blank for all"
                value={form.stack_pattern}
                onChange={(e) => setForm({ ...form, stack_pattern: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Glob-style pattern matched against stack names. Leave blank to apply to all stacks.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Max severity</Label>
              <Combobox
                options={SEVERITY_OPTIONS}
                value={form.max_severity}
                onValueChange={(v) => setForm({ ...form, max_severity: v as VulnSeverity })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-glass-border px-3 py-2.5">
              <div>
                <Label className="text-sm">Block on deploy</Label>
                <p className="text-xs text-muted-foreground">
                  Emit a critical alert when this policy is violated after a deploy.
                </p>
              </div>
              <Switch
                checked={form.block_on_deploy}
                onCheckedChange={(c) => setForm({ ...form, block_on_deploy: c })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-glass-border px-3 py-2.5">
              <div>
                <Label className="text-sm">Enabled</Label>
                <p className="text-xs text-muted-foreground">Disabled policies are skipped during evaluation.</p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(c) => setForm({ ...form, enabled: c })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scan policy?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the policy immediately. Existing scans are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
