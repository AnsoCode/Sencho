import { useEffect, useState } from 'react';
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

interface MfaDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}

export function MfaDisableDialog({ open, onOpenChange, onDisabled }: MfaDisableDialogProps) {
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setError('');
      setUseBackup(false);
    }
  }, [open]);

  const handleDisable = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/auth/mfa/disable', {
        method: 'POST',
        localOnly: true,
        body: JSON.stringify({ code, isBackupCode: useBackup }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Could not disable two-factor authentication');
        return;
      }
      toast.success('Two-factor authentication disabled');
      setCode('');
      onOpenChange(false);
      onDisabled();
    } catch (err) {
      setError((err as Error)?.message || 'Could not disable two-factor authentication');
    } finally {
      setLoading(false);
    }
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
              maxLength={useBackup ? 12 : 6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono tabular-nums tracking-widest text-center"
              placeholder={useBackup ? 'ABCDE-FGHIJ' : '123456'}
            />
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
            onClick={() => { setUseBackup((v) => !v); setCode(''); setError(''); }}
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
            disabled={loading || !code}
            onClick={handleDisable}
          >
            {loading ? 'Disabling...' : 'Disable'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
