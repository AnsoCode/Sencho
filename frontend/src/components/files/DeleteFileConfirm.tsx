import { useState, useEffect } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast-store';
import { deleteStackPath } from '@/lib/stackFilesApi';
import type { FileEntry } from '@/lib/stackFilesApi';

interface DeleteFileConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stackName: string;
  relPath: string;
  entry: FileEntry | null;
  onDeleted: () => void;
}

export function DeleteFileConfirm({
  open,
  onOpenChange,
  stackName,
  relPath,
  entry,
  onDeleted,
}: DeleteFileConfirmProps) {
  const [deleting, setDeleting] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [notEmpty, setNotEmpty] = useState(false);

  const isProtected = entry?.isProtected ?? false;
  const entryName = entry?.name ?? '';

  useEffect(() => {
    if (!open) {
      setConfirmInput('');
      setNotEmpty(false);
    }
  }, [open]);

  const handleClose = (next: boolean) => {
    if (deleting) return;
    onOpenChange(next);
  };

  const executeDelete = async (recursive: boolean) => {
    setDeleting(true);
    try {
      await deleteStackPath(stackName, relPath, recursive || undefined);
      onDeleted();
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Delete failed.';
      if (!recursive && msg.toUpperCase().includes('NOT_EMPTY')) {
        setNotEmpty(true);
      } else {
        toast.error(msg);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleDelete = () => void executeDelete(notEmpty);

  const protectedOk = !isProtected || confirmInput === entryName;

  const deleteLabel = notEmpty ? 'Delete all' : 'Delete';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-destructive" strokeWidth={1.5} />
            Delete {entryName ? `"${entryName}"` : 'item'}?
          </DialogTitle>
          <DialogDescription>
            {notEmpty ? (
              <span className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
                This folder is not empty. Delete everything inside?
              </span>
            ) : (
              'This action cannot be undone.'
            )}
          </DialogDescription>
        </DialogHeader>

        {isProtected && !notEmpty && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.5} />
              <p>This is a critical stack file. Type the filename to confirm.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delete-confirm-input" className="text-xs">
                Type <span className="font-mono">{entryName}</span> to confirm
              </Label>
              <Input
                id="delete-confirm-input"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={entryName}
                disabled={deleting}
                autoFocus
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleClose(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleDelete}
            disabled={deleting || !protectedOk}
          >
            {deleting && (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" strokeWidth={1.5} />
            )}
            {deleteLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
