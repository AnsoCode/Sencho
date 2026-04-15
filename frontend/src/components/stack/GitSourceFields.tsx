import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export type ApplyMode = 'review' | 'auto-write' | 'auto-deploy';

export interface GitSourceFieldsState {
  repoUrl: string;
  branch: string;
  composePath: string;
  syncEnv: boolean;
  authType: 'none' | 'token';
  token: string;
  /** When editing an existing source, the server tells us whether a token is already stored. */
  hasStoredToken: boolean;
  applyMode: ApplyMode;
}

export interface GitSourceFieldsProps extends GitSourceFieldsState {
  disabled?: boolean;
  /** 'edit' for the per-stack panel, 'create' for the new-stack dialog. Changes apply-mode copy. */
  variant: 'edit' | 'create';
  onRepoUrlChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onComposePathChange: (value: string) => void;
  onSyncEnvChange: (value: boolean) => void;
  onAuthTypeChange: (value: 'none' | 'token') => void;
  onTokenChange: (value: string) => void;
  onApplyModeChange: (value: ApplyMode) => void;
}

const APPLY_MODE_COPY: Record<'edit' | 'create', Record<ApplyMode, { title: string; description: string }>> = {
  edit: {
    'review': { title: 'Review only', description: 'Webhook fetches and flags a pending diff. You apply manually.' },
    'auto-write': { title: 'Auto-write files', description: 'Webhook writes to disk. You deploy manually.' },
    'auto-deploy': { title: 'Auto-deploy', description: 'Webhook writes and deploys in one step.' },
  },
  create: {
    'review': { title: 'Review only', description: 'Future webhook pulls surface a diff you apply manually.' },
    'auto-write': { title: 'Auto-write files', description: 'Future webhook pulls write to disk. You deploy manually.' },
    'auto-deploy': { title: 'Auto-deploy', description: 'Future webhook pulls write and redeploy automatically.' },
  },
};

export function GitSourceFields({
  repoUrl,
  branch,
  composePath,
  syncEnv,
  authType,
  token,
  hasStoredToken,
  applyMode,
  disabled = false,
  variant,
  onRepoUrlChange,
  onBranchChange,
  onComposePathChange,
  onSyncEnvChange,
  onAuthTypeChange,
  onTokenChange,
  onApplyModeChange,
}: GitSourceFieldsProps) {
  const copy = APPLY_MODE_COPY[variant];

  const radioOption = (mode: ApplyMode) => (
    <button
      type="button"
      key={mode}
      onClick={() => !disabled && onApplyModeChange(mode)}
      disabled={disabled}
      className={cn(
        'w-full text-left rounded-md border px-3 py-2 transition-colors',
        applyMode === mode
          ? 'border-brand/60 bg-brand/5'
          : 'border-glass-border hover:border-card-border-hover',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        <div className={cn(
          'w-3.5 h-3.5 rounded-full border mt-0.5 shrink-0 transition-colors',
          applyMode === mode ? 'border-brand bg-brand' : 'border-stat-subtitle',
        )} />
        <div>
          <p className="text-xs font-medium">{copy[mode].title}</p>
          <p className="text-[11px] text-stat-subtitle mt-0.5">{copy[mode].description}</p>
        </div>
      </div>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="git-source-repo">Repository URL</Label>
        <Input
          id="git-source-repo"
          placeholder="https://github.com/org/repo.git"
          value={repoUrl}
          onChange={(e) => onRepoUrlChange(e.target.value)}
          disabled={disabled}
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
            onChange={(e) => onBranchChange(e.target.value)}
            disabled={disabled}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="git-source-path">Compose file path</Label>
          <Input
            id="git-source-path"
            placeholder="compose.yaml"
            value={composePath}
            onChange={(e) => onComposePathChange(e.target.value)}
            disabled={disabled}
            className="font-mono text-xs"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="git-source-sync-env"
          checked={syncEnv}
          onCheckedChange={(c) => onSyncEnvChange(c === true)}
          disabled={disabled}
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
            onClick={() => !disabled && onAuthTypeChange('none')}
            disabled={disabled}
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
            onClick={() => !disabled && onAuthTypeChange('token')}
            disabled={disabled}
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
              placeholder={hasStoredToken ? '••••••••  (leave blank to keep current)' : 'ghp_xxx... or glpat-xxx...'}
              value={token}
              onChange={(e) => onTokenChange(e.target.value)}
              disabled={disabled}
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
          {radioOption('review')}
          {radioOption('auto-write')}
          {radioOption('auto-deploy')}
        </div>
      </div>
    </div>
  );
}
