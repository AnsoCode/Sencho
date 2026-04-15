import { useState, useMemo } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { AlertTriangle, GitBranch, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsHighlight, TabsHighlightItem } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { springs } from '@/lib/motion';

export interface PullResult {
  commitSha: string;
  incomingCompose: string;
  incomingEnv: string | null;
  currentCompose: string;
  currentEnv: string | null;
  validation: { ok: boolean; error?: string };
  hasLocalChanges: boolean;
}

interface GitSourceDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stackName: string;
  pull: PullResult | null;
  syncEnv: boolean;
  autoDeployDefault: boolean;
  isDarkMode: boolean;
  applying: boolean;
  onApply: (commitSha: string, deploy: boolean) => Promise<void>;
  onDismiss: () => Promise<void>;
}

export function GitSourceDiffDialog({
  open,
  onOpenChange,
  stackName,
  pull,
  syncEnv,
  autoDeployDefault,
  isDarkMode,
  applying,
  onApply,
  onDismiss,
}: GitSourceDiffDialogProps) {
  const [diffTab, setDiffTab] = useState<'compose' | 'env'>('compose');
  const [deployAfter, setDeployAfter] = useState<boolean>(autoDeployDefault);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const envAvailable = syncEnv && pull?.incomingEnv !== null;
  const effectiveTab = envAvailable ? diffTab : 'compose';

  const shortSha = useMemo(() => (pull?.commitSha ? pull.commitSha.slice(0, 7) : ''), [pull?.commitSha]);

  if (!pull) return null;

  const apply = async () => {
    await onApply(pull.commitSha, deployAfter);
  };

  const handleApplyClick = () => {
    if (pull.hasLocalChanges) {
      setConfirmOpen(true);
      return;
    }
    apply();
  };

  const currentValue = effectiveTab === 'compose' ? pull.currentCompose : (pull.currentEnv ?? '');
  const incomingValue = effectiveTab === 'compose' ? pull.incomingCompose : (pull.incomingEnv ?? '');

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl w-[95vw] p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-glass-border">
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="w-4 h-4" strokeWidth={1.5} />
              <span>Review update for</span>
              <span className="font-mono tabular-nums">{stackName}</span>
              <span className="font-mono tabular-nums text-xs text-stat-subtitle">@{shortSha}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Review the diff between the current on-disk stack files and the incoming Git commit.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 pt-4 space-y-3">
            {!pull.validation.ok && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
                <div>
                  <p className="font-medium">Incoming compose failed validation</p>
                  <pre className="font-mono text-[11px] whitespace-pre-wrap mt-1">{pull.validation.error}</pre>
                </div>
              </div>
            )}
            {pull.hasLocalChanges && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
                <div>
                  <p className="font-medium">Local edits detected on disk</p>
                  <p className="mt-0.5">Applying will overwrite changes that differ from the last applied commit.</p>
                </div>
              </div>
            )}

            {envAvailable && (
              <Tabs value={diffTab} onValueChange={(v) => setDiffTab(v as 'compose' | 'env')}>
                <TabsList>
                  <TabsHighlight className="rounded-md bg-glass-highlight" transition={springs.snappy}>
                    <TabsHighlightItem value="compose">
                      <TabsTrigger value="compose">compose.yaml</TabsTrigger>
                    </TabsHighlightItem>
                    <TabsHighlightItem value="env">
                      <TabsTrigger value="env">.env</TabsTrigger>
                    </TabsHighlightItem>
                  </TabsHighlight>
                </TabsList>
              </Tabs>
            )}
          </div>

          <div className="px-6 pb-4 pt-3">
            <div className="h-[55vh] border border-glass-border rounded-md overflow-hidden">
              <DiffEditor
                height="100%"
                language={effectiveTab === 'compose' ? 'yaml' : 'ini'}
                theme={isDarkMode ? 'vs-dark' : 'vs'}
                original={currentValue}
                modified={incomingValue}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 12,
                }}
              />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-glass-border flex flex-row items-center justify-between sm:justify-between gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="git-source-deploy-after"
                checked={deployAfter}
                onCheckedChange={(checked) => setDeployAfter(checked === true)}
                disabled={applying || !pull.validation.ok}
              />
              <Label htmlFor="git-source-deploy-after" className="text-xs cursor-pointer">
                Deploy after apply
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDismiss()}
                disabled={applying}
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                onClick={handleApplyClick}
                disabled={applying || !pull.validation.ok}
              >
                {applying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" strokeWidth={1.5} />
                    Applying...
                  </>
                ) : (
                  'Apply'
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite local edits?</AlertDialogTitle>
            <AlertDialogDescription>
              The on-disk stack files differ from the last applied commit. Applying this pull will replace them with the incoming content.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmOpen(false);
                await apply();
              }}
              disabled={applying}
            >
              Overwrite and apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
