import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Loader2, Trash2, RefreshCw, Save, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { cn } from '@/lib/utils';
import { GitSourceDiffDialog, type PullResult } from './GitSourceDiffDialog';

export interface GitSource {
  id: number;
  stack_name: string;
  repo_url: string;
  branch: string;
  compose_path: string;
  sync_env: boolean;
  env_path: string | null;
  auth_type: 'none' | 'token';
  has_token: boolean;
  auto_apply_on_webhook: boolean;
  auto_deploy_on_apply: boolean;
  last_applied_commit_sha: string | null;
  pending_commit_sha: string | null;
  pending_fetched_at: number | null;
  created_at: number;
  updated_at: number;
}

type ApplyMode = 'review' | 'auto-write' | 'auto-deploy';

interface GitSourcePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stackName: string;
  canEdit: boolean;
  isDarkMode: boolean;
  /** Called after any change that may affect the sidebar pending-badge. */
  onSourceChanged?: () => void;
}

function deriveApplyMode(source: GitSource | null, pendingMode: ApplyMode | null): ApplyMode {
  if (pendingMode) return pendingMode;
  if (!source) return 'review';
  if (!source.auto_apply_on_webhook) return 'review';
  return source.auto_deploy_on_apply ? 'auto-deploy' : 'auto-write';
}

export function GitSourcePanel({
  open,
  onOpenChange,
  stackName,
  canEdit,
  isDarkMode,
  onSourceChanged,
}: GitSourcePanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [applying, setApplying] = useState(false);
  const [source, setSource] = useState<GitSource | null>(null);

  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [composePath, setComposePath] = useState('compose.yaml');
  const [syncEnv, setSyncEnv] = useState(false);
  const [authType, setAuthType] = useState<'none' | 'token'>('none');
  const [token, setToken] = useState('');
  const [applyModeOverride, setApplyModeOverride] = useState<ApplyMode | null>(null);

  const [pull, setPull] = useState<PullResult | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  const applyMode = deriveApplyMode(source, applyModeOverride);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/stacks/${encodeURIComponent(stackName)}/git-source`);
      if (res.ok) {
        const data: GitSource = await res.json();
        setSource(data);
        setRepoUrl(data.repo_url);
        setBranch(data.branch);
        setComposePath(data.compose_path);
        setSyncEnv(data.sync_env);
        setAuthType(data.auth_type);
        setToken('');
        setApplyModeOverride(null);
      } else if (res.status === 404) {
        setSource(null);
        setRepoUrl('');
        setBranch('main');
        setComposePath('compose.yaml');
        setSyncEnv(false);
        setAuthType('none');
        setToken('');
        setApplyModeOverride(null);
      } else if (res.status === 403) {
        setSource(null);
        toast.error('You do not have permission to view this stack\'s Git source.');
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || 'Failed to load Git source.');
      }
    } catch (e) {
      toast.error((e as Error)?.message || 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [stackName]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const save = async () => {
    if (!repoUrl.trim() || !branch.trim() || !composePath.trim()) {
      toast.error('Repository URL, branch, and compose path are required.');
      return;
    }
    if (!/^https:\/\//i.test(repoUrl.trim())) {
      toast.error('Only HTTPS repository URLs are supported.');
      return;
    }
    setSaving(true);
    const loadingId = toast.loading('Verifying repository access...');
    try {
      const autoApply = applyMode !== 'review';
      const autoDeploy = applyMode === 'auto-deploy';
      const body: Record<string, unknown> = {
        repo_url: repoUrl.trim(),
        branch: branch.trim(),
        compose_path: composePath.trim(),
        sync_env: syncEnv,
        auth_type: authType,
        auto_apply_on_webhook: autoApply,
        auto_deploy_on_apply: autoDeploy,
      };
      if (authType === 'token' && token !== '') {
        body.token = token;
      }
      const res = await apiFetch(`/stacks/${encodeURIComponent(stackName)}/git-source`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data: GitSource = await res.json();
        setSource(data);
        setToken('');
        setApplyModeOverride(null);
        toast.success('Git source saved.');
        onSourceChanged?.();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || 'Failed to save Git source.');
      }
    } catch (e) {
      toast.error((e as Error)?.message || 'Network error.');
    } finally {
      toast.dismiss(loadingId);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!source) return;
    setRemoveConfirmOpen(false);
    setDeleting(true);
    try {
      const res = await apiFetch(`/stacks/${encodeURIComponent(stackName)}/git-source`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('Git source removed.');
        setSource(null);
        onSourceChanged?.();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || 'Failed to remove Git source.');
      }
    } catch (e) {
      toast.error((e as Error)?.message || 'Network error.');
    } finally {
      setDeleting(false);
    }
  };

  const pullNow = async () => {
    if (!source) return;
    setPulling(true);
    const loadingId = toast.loading('Fetching from Git...');
    try {
      const res = await apiFetch(`/stacks/${encodeURIComponent(stackName)}/git-source/pull`, {
        method: 'POST',
      });
      if (res.ok) {
        const data: PullResult = await res.json();
        setPull(data);
        setDiffOpen(true);
        onSourceChanged?.();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || 'Pull failed.');
      }
    } catch (e) {
      toast.error((e as Error)?.message || 'Network error.');
    } finally {
      toast.dismiss(loadingId);
      setPulling(false);
    }
  };

  const applyPull = async (commitSha: string, deploy: boolean) => {
    setApplying(true);
    const loadingId = toast.loading(deploy ? 'Applying and deploying...' : 'Applying changes...');
    try {
      const res = await apiFetch(`/stacks/${encodeURIComponent(stackName)}/git-source/apply`, {
        method: 'POST',
        body: JSON.stringify({ commitSha, deploy }),
      });
      if (res.ok) {
        const data: { applied: boolean; deployed: boolean; deployError?: string } = await res.json();
        if (data.deployError) {
          toast.warning(`Applied, but deploy failed: ${data.deployError}`);
        } else {
          toast.success(data.deployed ? 'Applied and deployed.' : 'Applied successfully.');
        }
        setDiffOpen(false);
        setPull(null);
        await load();
        onSourceChanged?.();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || 'Apply failed.');
      }
    } catch (e) {
      toast.error((e as Error)?.message || 'Network error.');
    } finally {
      toast.dismiss(loadingId);
      setApplying(false);
    }
  };

  const dismissPending = async () => {
    try {
      const res = await apiFetch(`/stacks/${encodeURIComponent(stackName)}/git-source/dismiss-pending`, {
        method: 'POST',
      });
      if (res.ok) {
        setDiffOpen(false);
        setPull(null);
        await load();
        onSourceChanged?.();
        toast.success('Pending update dismissed.');
      }
    } catch (e) {
      toast.error((e as Error)?.message || 'Network error.');
    }
  };

  const radioOption = (mode: ApplyMode, title: string, description: string) => (
    <button
      type="button"
      key={mode}
      onClick={() => canEdit && setApplyModeOverride(mode)}
      disabled={!canEdit}
      className={cn(
        'w-full text-left rounded-md border px-3 py-2 transition-colors',
        applyMode === mode
          ? 'border-brand/60 bg-brand/5'
          : 'border-glass-border hover:border-card-border-hover',
        !canEdit && 'cursor-not-allowed opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        <div className={cn(
          'w-3.5 h-3.5 rounded-full border mt-0.5 shrink-0 transition-colors',
          applyMode === mode ? 'border-brand bg-brand' : 'border-stat-subtitle',
        )} />
        <div>
          <p className="text-xs font-medium">{title}</p>
          <p className="text-[11px] text-stat-subtitle mt-0.5">{description}</p>
        </div>
      </div>
    </button>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl w-[95vw] p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-glass-border">
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="w-4 h-4" strokeWidth={1.5} />
              Git Source
              <span className="font-mono tabular-nums text-xs text-stat-subtitle">{stackName}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Link this stack to a Git repository so compose updates can be pulled on demand or via webhook.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh]">
            <div className="px-6 py-5 space-y-5">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : (
                <>
                  {source?.pending_commit_sha && (
                    <div className="flex items-start gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-xs shadow-card-bevel">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-brand" strokeWidth={1.5} />
                      <div className="flex-1">
                        <p className="font-medium">Pending update</p>
                        <p className="text-stat-subtitle mt-0.5">
                          Commit <span className="font-mono tabular-nums">{source.pending_commit_sha.slice(0, 7)}</span> is ready to review.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => pullNow()}
                        disabled={pulling}
                      >
                        Review
                      </Button>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="git-source-repo">Repository URL</Label>
                    <Input
                      id="git-source-repo"
                      placeholder="https://github.com/org/repo.git"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      disabled={!canEdit || saving}
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="git-source-branch">Branch</Label>
                      <Input
                        id="git-source-branch"
                        placeholder="main"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        disabled={!canEdit || saving}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="git-source-path">Compose file path</Label>
                      <Input
                        id="git-source-path"
                        placeholder="compose.yaml"
                        value={composePath}
                        onChange={(e) => setComposePath(e.target.value)}
                        disabled={!canEdit || saving}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="git-source-sync-env"
                      checked={syncEnv}
                      onCheckedChange={(c) => setSyncEnv(c === true)}
                      disabled={!canEdit || saving}
                    />
                    <Label htmlFor="git-source-sync-env" className="text-xs cursor-pointer">
                      Also sync sibling <span className="font-mono">.env</span> file
                    </Label>
                  </div>

                  <div className="space-y-2">
                    <Label>Authentication</Label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => canEdit && setAuthType('none')}
                        disabled={!canEdit || saving}
                        className={cn(
                          'flex-1 rounded-md border px-3 py-1.5 text-xs transition-colors',
                          authType === 'none'
                            ? 'border-brand/60 bg-brand/5'
                            : 'border-glass-border hover:border-card-border-hover',
                        )}
                      >
                        Public (no auth)
                      </button>
                      <button
                        type="button"
                        onClick={() => canEdit && setAuthType('token')}
                        disabled={!canEdit || saving}
                        className={cn(
                          'flex-1 rounded-md border px-3 py-1.5 text-xs transition-colors',
                          authType === 'token'
                            ? 'border-brand/60 bg-brand/5'
                            : 'border-glass-border hover:border-card-border-hover',
                        )}
                      >
                        Personal Access Token
                      </button>
                    </div>
                    {authType === 'token' && (
                      <div className="space-y-1.5">
                        <Input
                          type="password"
                          placeholder={source?.has_token ? '••••••••  (leave blank to keep current)' : 'ghp_xxx... or glpat-xxx...'}
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          disabled={!canEdit || saving}
                          className="font-mono text-xs"
                          autoComplete="off"
                        />
                        <p className="text-[11px] text-stat-subtitle">
                          Token is encrypted at rest and never returned from the API.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Apply behavior</Label>
                    <div className="space-y-1.5">
                      {radioOption('review', 'Review only', 'Webhook fetches and flags a pending diff. You apply manually.')}
                      {radioOption('auto-write', 'Auto-write files', 'Webhook writes to disk. You deploy manually.')}
                      {radioOption('auto-deploy', 'Auto-deploy', 'Webhook writes and deploys in one step.')}
                    </div>
                  </div>

                  {source && (
                    <div className="rounded-md border border-glass-border bg-muted/30 px-3 py-2 text-[11px] text-stat-subtitle space-y-0.5 shadow-card-bevel">
                      <div className="flex justify-between gap-2">
                        <span>Last applied commit</span>
                        <span className="font-mono tabular-nums">
                          {source.last_applied_commit_sha ? source.last_applied_commit_sha.slice(0, 7) : 'never'}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>Updated</span>
                        <span className="font-mono tabular-nums">
                          {new Date(source.updated_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>

          <div className="px-6 py-4 border-t border-glass-border flex items-center justify-between gap-2">
            <div>
              {source && canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoveConfirmOpen(true)}
                  disabled={deleting || saving}
                  className="text-destructive/60 hover:bg-destructive hover:text-destructive-foreground"
                >
                  <Trash2 className="w-4 h-4 mr-1.5" strokeWidth={1.5} />
                  Remove
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {source && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={pullNow}
                  disabled={pulling || saving}
                >
                  {pulling ? (
                    <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" strokeWidth={1.5} />Pulling</>
                  ) : (
                    <><RefreshCw className="w-4 h-4 mr-1.5" strokeWidth={1.5} />Pull now</>
                  )}
                </Button>
              )}
              {canEdit && (
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? (
                    <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" strokeWidth={1.5} />Saving</>
                  ) : (
                    <><Save className="w-4 h-4 mr-1.5" strokeWidth={1.5} />{source ? 'Update' : 'Save'}</>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <GitSourceDiffDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        stackName={stackName}
        pull={pull}
        syncEnv={syncEnv}
        autoDeployDefault={applyMode === 'auto-deploy'}
        isDarkMode={isDarkMode}
        applying={applying}
        onApply={applyPull}
        onDismiss={dismissPending}
      />

      <AlertDialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Git source?</AlertDialogTitle>
            <AlertDialogDescription>
              The stack files on disk will be left in place. You can reconfigure the source later at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={deleting}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
