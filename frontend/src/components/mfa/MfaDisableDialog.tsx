import { useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import {
  BACKUP_CODE_DISPLAY_LENGTH,
  BACKUP_CODE_RAW_LENGTH,
  TOTP_LENGTH,
  normalizeBackupCodeInput,
  normalizeTotpInput,
} from '@/lib/mfa';

interface MfaDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}

export function MfaDisableDialog({ open, onOpenChange, onDisabled }: MfaDisableDialogProps) {
  // `display` is what the input shows (backup codes carry a dash after five chars);
  // `raw` is the normalized value sent to the server.
  const [display, setDisplay] = useState('');
  const [raw, setRaw] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (open) {
      setDisplay('');
      setRaw('');
      setError('');
      setUseBackup(false);
      submittedRef.current = false;
    }
  }, [open]);

  const submitDisable = async (valueToSubmit: string) => {
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/auth/mfa/disable', {
        method: 'POST',
        localOnly: true,
        body: JSON.stringify({ code: valueToSubmit, isBackupCode: useBackup }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Could not disable two-factor authentication');
        setDisplay('');
        setRaw('');
        submittedRef.current = false;
        return;
      }
      toast.success('Two-factor authentication disabled');
      setDisplay('');
      setRaw('');
      onOpenChange(false);
      onDisabled();
    } catch (err) {
      setError((err as Error)?.message || 'Could not disable two-factor authentication');
      submittedRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  const expectedLength = useBackup ? BACKUP_CODE_RAW_LENGTH : TOTP_LENGTH;

  const handleCodeChange = (value: string) => {
    if (useBackup) {
      const next = normalizeBackupCodeInput(value);
      setDisplay(next.display);
      setRaw(next.raw);
      // Never auto-submit a backup code; the action is destructive.
      if (next.raw.length < BACKUP_CODE_RAW_LENGTH) submittedRef.current = false;
      return;
    }
    const normalized = normalizeTotpInput(value);
    setDisplay(normalized);
    setRaw(normalized);
    if (normalized.length < TOTP_LENGTH) submittedRef.current = false;
    if (
      normalized.length === TOTP_LENGTH &&
      !loading &&
      !submittedRef.current
    ) {
      submittedRef.current = true;
      requestAnimationFrame(() => { void submitDisable(normalized); });
    }
  };

  const handleToggleBackup = () => {
    setUseBackup((v) => !v);
    setDisplay('');
    setRaw('');
    setError('');
    submittedRef.current = false;
  };

  const handleDisableClick = () => {
    if (loading || raw.length !== expectedLength) return;
    submittedRef.current = true;
    void submitDisable(raw);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disable two-factor authentication?</AlertDialogTitle>
          <AlertDialogDescription>
            Your account will only be protected by a password. Anyone who obtains that password can sign in. Confirm with a current code to continue.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="mfa-disable-code">{useBackup ? 'Backup code' : 'Verification code'}</Label>
            <Input
              id="mfa-disable-code"
              type="text"
              inputMode={useBackup ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              maxLength={useBackup ? BACKUP_CODE_DISPLAY_LENGTH : TOTP_LENGTH}
              value={display}
              onChange={(e) => handleCodeChange(e.target.value)}
              className="font-mono tabular-nums tracking-widest text-center"
              placeholder={useBackup ? 'ABCDE-FGHIJ' : '123456'}
            />
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
            onClick={handleToggleBackup}
          >
            {useBackup ? 'Use your authenticator app instead' : 'Use a backup code instead'}
          </button>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="ghost"
            className="text-destructive/60 hover:bg-destructive hover:text-destructive-foreground"
            disabled={loading || raw.length !== expectedLength}
            onClick={handleDisableClick}
          >
            {loading ? 'Disabling...' : 'Disable'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
