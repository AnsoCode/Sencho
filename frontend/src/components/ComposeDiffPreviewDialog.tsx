import { Suspense } from 'react';
import { DiffEditor } from '@/lib/monacoLoader';
import { FileDiff, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ComposeDiffPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stackName: string;
  fileName: string;
  language: 'yaml' | 'ini';
  original: string;
  modified: string;
  actionLabel: 'Save' | 'Save & deploy';
  confirming: boolean;
  isDarkMode: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ComposeDiffPreviewDialog({
  open,
  onOpenChange,
  stackName,
  fileName,
  language,
  original,
  modified,
  actionLabel,
  confirming,
  isDarkMode,
  onConfirm,
}: ComposeDiffPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-glass-border">
          <DialogTitle className="flex items-center gap-2">
            <FileDiff className="w-4 h-4" strokeWidth={1.5} />
            <span>Review changes to {stackName}</span>
            <span className="font-mono tabular-nums text-xs text-stat-subtitle">{fileName}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Review the diff between on-disk content and unsaved editor changes before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4 pt-3">
          <div className="h-[55vh] border border-glass-border rounded-md overflow-hidden">
            <Suspense fallback={<div className="w-full h-full" aria-busy="true" />}>
              <DiffEditor
                height="100%"
                language={language}
                theme={isDarkMode ? 'vs-dark' : 'vs'}
                original={original}
                modified={modified}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 12,
                }}
              />
            </Suspense>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-glass-border flex flex-row items-center justify-between sm:justify-between gap-4">
          <span className="font-mono text-xs text-stat-subtitle">ON DISK → UNSAVED</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={confirming}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => onConfirm()}
              disabled={confirming}
            >
              {confirming && (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" strokeWidth={1.5} />
              )}
              {actionLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
