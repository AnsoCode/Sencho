import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowRight, Check, Copy, Download, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { TOTP_LENGTH, normalizeTotpInput } from '@/lib/mfa';
import { OtpDigitField } from '@/components/auth/OtpDigitField';
import { ErrorRail } from '@/components/auth/ErrorRail';

interface MfaEnrollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnrolled: () => void;
}

type Step = 'qr' | 'confirm' | 'backup';

function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function MfaEnrollDialog({ open, onOpenChange, onEnrolled }: MfaEnrollDialogProps) {
  const [step, setStep] = useState<Step>('qr');
  const [loading, setLoading] = useState(false);
  const [otpauthUri, setOtpauthUri] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep('qr');
    setCode('');
    setError('');
    setBackupCodes([]);
    setConfirmState('idle');
    submittedRef.current = false;
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

  const submitConfirm = async (valueToSubmit: string) => {
    setError('');
    setConfirmState('loading');
    setLoading(true);
    try {
      const res = await apiFetch('/auth/mfa/enroll/confirm', {
        method: 'POST',
        localOnly: true,
        body: JSON.stringify({ code: valueToSubmit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Verification failed');
        setCode('');
        setConfirmState('error');
        submittedRef.current = false;
        window.setTimeout(() => setConfirmState('idle'), 600);
        return;
      }
      setBackupCodes(data.backupCodes || []);
      setConfirmState('success');
      setStep('backup');
    } catch (err) {
      setError((err as Error)?.message || 'Verification failed');
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
      requestAnimationFrame(() => { void submitConfirm(normalized); });
    }
  };

  const handleCopySecret = async () => {
    try {
      await copyToClipboard(secret);
      toast.success('Secret copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleCopyBackupCodes = async () => {
    try {
      await copyToClipboard(backupCodes.join('\n'));
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
        if (!next && step === 'backup') onEnrolled();
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
              {step === 'qr' && 'Pair your authenticator'}
              {step === 'confirm' && 'Confirm the pairing'}
              {step === 'backup' && 'Save your recovery codes'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Enrol a time-based one-time password (TOTP) authenticator and save
              single-use backup codes.
            </DialogDescription>
          </DialogHeader>

          <StepRail step={step} />

          <div className="px-6 py-5">
            {step === 'qr' && (
              <div className="flex flex-col gap-4">
                <p className="text-sm leading-snug text-stat-subtitle">
                  Scan the code with 1Password, Bitwarden, Google Authenticator, or any TOTP app.
                </p>
                <div className="flex justify-center rounded-md bg-background p-5 shadow-[inset_0_2px_6px_0_oklch(0_0_0/0.45)]">
                  {otpauthUri ? (
                    <QRCodeSVG value={otpauthUri} size={180} />
                  ) : (
                    <div className="flex h-[180px] w-[180px] items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-stat-subtitle" strokeWidth={1.5} />
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
                    Secret · manual entry
                  </span>
                  <div className="flex items-stretch gap-2">
                    <code className="flex-1 truncate rounded-md border border-card-border bg-background/60 px-3 py-2 font-mono text-xs tabular-nums tracking-[0.2em] text-stat-value shadow-[inset_0_2px_4px_0_oklch(0_0_0/0.25)]">
                      {formatSecret(secret) || '...'}
                    </code>
                    <Button type="button" size="icon" variant="outline" onClick={handleCopySecret} disabled={!secret}>
                      <Copy className="h-4 w-4" strokeWidth={1.5} />
                    </Button>
                  </div>
                </div>
                <DialogFooter className="mt-2 gap-2 sm:gap-2">
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setStep('confirm')}
                    disabled={!otpauthUri || loading}
                    className="bg-brand text-brand-foreground shadow-btn-glow hover:bg-brand/90"
                  >
                    Continue
                    <ArrowRight strokeWidth={1.5} />
                  </Button>
                </DialogFooter>
              </div>
            )}

            {step === 'confirm' && (
              <div className="flex flex-col gap-4">
                <p className="text-sm leading-snug text-stat-subtitle">
                  Enter the 6-digit code shown in your authenticator to confirm the pairing.
                </p>
                <OtpDigitField
                  id="mfa-confirm-code"
                  value={code}
                  onChange={handleCodeChange}
                  state={confirmState}
                  disabled={loading || confirmState === 'success'}
                  autoFocus
                />
                {error && <ErrorRail>{error}</ErrorRail>}
                <DialogFooter className="mt-2 gap-2 sm:gap-2">
                  <Button type="button" variant="ghost" onClick={() => setStep('qr')} disabled={loading}>
                    Back
                  </Button>
                </DialogFooter>
              </div>
            )}

            {step === 'backup' && (
              <div className="flex flex-col gap-4">
                <p className="text-sm leading-snug text-stat-subtitle">
                  Each code unlocks your account once if your authenticator is unavailable. Store them safely. They will not be shown again.
                </p>
                <BackupCodeTicket codes={backupCodes} />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={handleCopyBackupCodes}>
                    <Copy className="h-4 w-4" strokeWidth={1.5} />
                    Copy all
                  </Button>
                  <Button type="button" variant="outline" className="flex-1" onClick={handleDownloadBackupCodes}>
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

function StepRail({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'qr', label: 'Pair' },
    { id: 'confirm', label: 'Confirm' },
    { id: 'backup', label: 'Archive' },
  ];
  const activeIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="grid grid-cols-3 border-b border-card-border/60">
      {steps.map((s, i) => {
        const isActive = i === activeIndex;
        const isComplete = i < activeIndex;
        return (
          <div
            key={s.id}
            className={cn(
              'relative flex items-center justify-center gap-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em]',
              i < steps.length - 1 && 'border-r border-card-border/60',
              isActive ? 'text-brand' : isComplete ? 'text-stat-subtitle' : 'text-stat-subtitle/60',
            )}
          >
            {isComplete ? (
              <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            ) : (
              <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
            )}
            <span>{s.label}</span>
            {isActive && (
              <span aria-hidden className="absolute inset-x-3 bottom-0 h-[2px] bg-brand" />
            )}
          </div>
        );
      })}
    </div>
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

