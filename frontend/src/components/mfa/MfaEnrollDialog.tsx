import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';

interface MfaEnrollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnrolled: () => void;
}

type Step = 'qr' | 'confirm' | 'backup';

/**
 * Format a raw base32 secret as groups of 4 characters so it is easier for
 * users typing it into authenticator apps manually.
 */
function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function MfaEnrollDialog({ open, onOpenChange, onEnrolled }: MfaEnrollDialogProps) {
  const [step, setStep] = useState<Step>('qr');
  const [loading, setLoading] = useState(false);
  const [otpauthUri, setOtpauthUri] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  // When the dialog opens, start enrolment so the QR is ready immediately.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep('qr');
    setCode('');
    setError('');
    setBackupCodes([]);
    setShowSecret(false);
    setLoading(true);
    apiFetch('/auth/mfa/enroll/start', { method: 'POST', localOnly: true })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          toast.error(data?.error || 'Failed to start enrolment');
          onOpenChange(false);
          return;
        }
        setOtpauthUri(data.otpauthUri);
        setSecret(data.secret);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e?.message || 'Failed to start enrolment');
        onOpenChange(false);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, onOpenChange]);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/auth/mfa/enroll/confirm', {
        method: 'POST',
        localOnly: true,
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Verification failed');
        return;
      }
      setBackupCodes(data.backupCodes || []);
      setStep('backup');
    } catch (err) {
      setError((err as Error)?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success('Secret copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleCopyBackupCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      toast.success('Backup codes copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleDownloadBackupCodes = () => {
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
    onOpenChange(false);
    onEnrolled();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Once backup codes have been shown, a close is equivalent to
        // finishing, so the parent can refresh the status card.
        if (!next && step === 'backup') onEnrolled();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'qr' && 'Set up two-factor authentication'}
            {step === 'confirm' && 'Confirm your authenticator'}
            {step === 'backup' && 'Save your backup codes'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Enrol a time-based one-time password (TOTP) authenticator and save
            single-use backup codes.
          </DialogDescription>
        </DialogHeader>

        {step === 'qr' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Scan the QR code with an authenticator app such as 1Password, Bitwarden, or Google Authenticator.
            </p>
            <div className="flex justify-center rounded-md border border-card-border bg-card p-4 shadow-card-bevel">
              {otpauthUri
                ? <QRCodeSVG value={otpauthUri} size={176} />
                : <div className="h-[176px] w-[176px] bg-muted/20 animate-pulse rounded" />
              }
            </div>
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {showSecret ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Can&apos;t scan? Show secret key
            </button>
            {showSecret && (
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border border-card-border bg-card px-3 py-2 font-mono text-xs tracking-wider break-all shadow-card-bevel">
                  {formatSecret(secret) || '...'}
                </code>
                <Button type="button" size="icon" variant="outline" onClick={handleCopySecret} disabled={!secret}>
                  <Copy className="w-4 h-4" strokeWidth={1.5} />
                </Button>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" onClick={() => setStep('confirm')} disabled={!otpauthUri || loading}>
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'confirm' && (
          <form onSubmit={handleConfirm} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code shown in your authenticator app to confirm enrolment.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="mfa-confirm-code">Verification code</Label>
              <Input
                id="mfa-confirm-code"
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
              <Button type="button" variant="ghost" onClick={() => setStep('qr')} disabled={loading}>Back</Button>
              <Button type="submit" disabled={loading || code.length !== 6}>
                {loading ? 'Verifying...' : 'Verify'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'backup' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Each code can be used once if your authenticator is unavailable. Store them somewhere safe; they will not be shown again.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-card-border bg-card p-4 font-mono text-sm tabular-nums tracking-wider shadow-card-bevel">
              {backupCodes.map((c) => (
                <div key={c} className="text-center">{c}</div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={handleCopyBackupCodes}>
                <Copy className="w-4 h-4 mr-2" strokeWidth={1.5} />
                Copy all
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={handleDownloadBackupCodes}>
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
