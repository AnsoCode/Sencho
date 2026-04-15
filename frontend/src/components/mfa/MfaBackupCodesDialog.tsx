import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Download } from 'lucide-react';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';

interface MfaBackupCodesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegenerated: () => void;
}

type Step = 'confirm' | 'show';

export function MfaBackupCodesDialog({ open, onOpenChange, onRegenerated }: MfaBackupCodesDialogProps) {
  const [step, setStep] = useState<Step>('confirm');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const resetState = () => {
    setStep('confirm');
    setCode('');
    setError('');
    setBackupCodes([]);
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/auth/mfa/backup-codes/regenerate', {
        method: 'POST',
        localOnly: true,
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Could not regenerate backup codes');
        return;
      }
      setBackupCodes(data.backupCodes || []);
      setStep('show');
    } catch (err) {
      setError((err as Error)?.message || 'Could not regenerate backup codes');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      toast.success('Backup codes copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([
      'Sencho backup codes\n',
      'Each code can be used once. Keep this file somewhere safe.\n\n',
      backupCodes.join('\n'),
      '\n',
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sencho-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFinish = () => {
    resetState();
    onOpenChange(false);
    onRegenerated();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (step === 'show') onRegenerated();
          resetState();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'confirm' ? 'Regenerate backup codes' : 'New backup codes'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Replace your backup codes with a freshly generated set. The previous
            set stops working immediately.
          </DialogDescription>
        </DialogHeader>

        {step === 'confirm' && (
          <form onSubmit={handleConfirm} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Your current backup codes will stop working immediately. Confirm with a code from your authenticator app to continue.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="mfa-regen-code">Verification code</Label>
              <Input
                id="mfa-regen-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="font-mono tabular-nums tracking-widest text-center"
                placeholder="123456"
              />
            </div>
            {error && <div className="text-sm text-destructive">{error}</div>}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
              <Button type="submit" disabled={loading || code.length !== 6}>
                {loading ? 'Working...' : 'Regenerate'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'show' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Each code can be used once. Store them somewhere safe; they will not be shown again.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-card-border bg-card p-4 font-mono text-sm tabular-nums tracking-wider shadow-card-bevel">
              {backupCodes.map((c) => (
                <div key={c} className="text-center">{c}</div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={handleCopy}>
                <Copy className="w-4 h-4 mr-2" strokeWidth={1.5} />
                Copy all
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" strokeWidth={1.5} />
                Download
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={handleFinish}>I&apos;ve saved these</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
