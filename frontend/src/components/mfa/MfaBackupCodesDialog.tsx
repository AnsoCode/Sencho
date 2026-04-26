import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Copy, Download } from 'lucide-react';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { TOTP_LENGTH, normalizeTotpInput } from '@/lib/mfa';
import { OtpDigitField } from '@/components/auth/OtpDigitField';
import { ErrorRail } from '@/components/auth/ErrorRail';

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
  const [confirmState, setConfirmState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const submittedRef = useRef(false);

  const resetState = () => {
    setStep('confirm');
    setCode('');
    setError('');
    setConfirmState('idle');
    setBackupCodes([]);
    submittedRef.current = false;
  };

  const submitRegenerate = async (valueToSubmit: string) => {
    setError('');
    setConfirmState('loading');
    setLoading(true);
    try {
      const res = await apiFetch('/auth/mfa/backup-codes/regenerate', {
        method: 'POST',
        localOnly: true,
        body: JSON.stringify({ code: valueToSubmit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Could not regenerate backup codes');
        setCode('');
        setConfirmState('error');
        submittedRef.current = false;
        window.setTimeout(() => setConfirmState('idle'), 600);
        return;
      }
      setBackupCodes(data.backupCodes || []);
      setConfirmState('success');
      setStep('show');
    } catch (err) {
      setError((err as Error)?.message || 'Could not regenerate backup codes');
      setConfirmState('error');
      submittedRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (raw: string) => {
    const normalized = normalizeTotpInput(raw);
    setCode(normalized);
    if (normalized.length < TOTP_LENGTH) {
      submittedRef.current = false;
      if (confirmState === 'error') setConfirmState('idle');
    }
    if (
      normalized.length === TOTP_LENGTH &&
      !loading &&
      !submittedRef.current
    ) {
      submittedRef.current = true;
      requestAnimationFrame(() => { void submitRegenerate(normalized); });
    }
  };

  const handleCopy = async () => {
    try {
      await copyToClipboard(backupCodes.join('\n'));
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
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="relative">
          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-brand/70" />

          <DialogHeader className="border-b border-card-border/60 px-6 pt-6 pb-4 text-left">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-stat-subtitle">
              SENCHO · MFA
            </div>
            <DialogTitle className="mt-1 font-display text-[1.75rem] italic leading-tight text-stat-value">
              {step === 'confirm' ? 'Confirm identity' : 'New recovery codes'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Replace your backup codes with a freshly generated set. The previous
              set stops working immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-5">
            {step === 'confirm' && (
              <div className="flex flex-col gap-4">
                <p className="text-sm leading-snug text-stat-subtitle">
                  Enter a code from your authenticator to generate a new set. The previous codes stop working immediately.
                </p>
                <OtpDigitField
                  id="mfa-regen-code"
                  value={code}
                  onChange={handleCodeChange}
                  state={confirmState}
                  disabled={loading || confirmState === 'success'}
                  autoFocus
                />
                {error && <ErrorRail>{error}</ErrorRail>}
                <DialogFooter className="mt-2 gap-2 sm:gap-2">
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
                    Cancel
                  </Button>
                </DialogFooter>
              </div>
            )}

            {step === 'show' && (
              <div className="flex flex-col gap-4">
                <WarningRail>Previous codes have been invalidated.</WarningRail>
                <p className="text-sm leading-snug text-stat-subtitle">
                  Each code can be used once. Store them safely. They will not be shown again.
                </p>
                <BackupCodeTicket codes={backupCodes} />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={handleCopy}>
                    <Copy className="h-4 w-4" strokeWidth={1.5} />
                    Copy all
                  </Button>
                  <Button type="button" variant="outline" className="flex-1" onClick={handleDownload}>
                    <Download className="h-4 w-4" strokeWidth={1.5} />
                    Download
                  </Button>
                </div>
                <DialogFooter className="mt-2">
                  <Button
                    type="button"
                    onClick={handleFinish}
                    className="bg-brand text-brand-foreground shadow-btn-glow hover:bg-brand/90"
                  >
                    <Check strokeWidth={1.5} />
                    Done
                  </Button>
                </DialogFooter>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BackupCodeTicket({ codes }: { codes: string[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-card-border bg-background/60 shadow-[inset_0_2px_6px_0_oklch(0_0_0/0.35)]">
      <div className="flex items-center justify-between border-b border-card-border/60 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
        <span>Recovery codes</span>
        <span className="tabular-nums">{codes.length} issued</span>
      </div>
      <ol className="grid grid-cols-1 sm:grid-cols-2">
        {codes.map((c, i) => (
          <li
            key={c}
            className={cn(
              'flex items-center gap-3 px-3 py-2 font-mono text-sm tabular-nums tracking-[0.15em] text-stat-value',
              'border-t border-card-border/40',
              i === 0 && 'sm:border-t-0',
              i === 1 && 'sm:border-t-0',
            )}
          >
            <span className="text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{c}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function WarningRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-warning/30 bg-warning/8 pl-4 pr-3 py-2">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-warning/70" aria-hidden />
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-warning">
        {children}
      </div>
    </div>
  );
}

