import { useEffect, useRef, useState } from 'react';
import { Modal, ModalDestructiveHeader, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import {
  BACKUP_CODE_DISPLAY_LENGTH,
  BACKUP_CODE_RAW_LENGTH,
  TOTP_LENGTH,
  normalizeBackupCodeInput,
  normalizeTotpInput,
} from '@/lib/mfa';
import { OtpDigitField } from '@/components/auth/OtpDigitField';
import { ErrorRail } from '@/components/auth/ErrorRail';

interface MfaDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}

export function MfaDisableDialog({ open, onOpenChange, onDisabled }: MfaDisableDialogProps) {
  const [display, setDisplay] = useState('');
  const [raw, setRaw] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpState, setOtpState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const submittedRef = useRef(false);

  useEffect(() => {
    if (open) {
      setDisplay('');
      setRaw('');
      setError('');
      setUseBackup(false);
      setOtpState('idle');
      submittedRef.current = false;
    }
  }, [open]);

  const submitDisable = async (valueToSubmit: string) => {
    setError('');
    setOtpState('loading');
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
        setOtpState('error');
        submittedRef.current = false;
        window.setTimeout(() => setOtpState('idle'), 600);
        return;
      }
      toast.success('Two-factor authentication disabled');
      setOtpState('success');
      setDisplay('');
      setRaw('');
      onOpenChange(false);
      onDisabled();
    } catch (err) {
      setError((err as Error)?.message || 'Could not disable two-factor authentication');
      setOtpState('error');
      submittedRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  const expectedLength = useBackup ? BACKUP_CODE_RAW_LENGTH : TOTP_LENGTH;

  const handleOtpChange = (value: string) => {
    const normalized = normalizeTotpInput(value);
    setDisplay(normalized);
    setRaw(normalized);
    if (normalized.length < TOTP_LENGTH) {
      submittedRef.current = false;
      if (otpState === 'error') setOtpState('idle');
    }
    if (
      normalized.length === TOTP_LENGTH &&
      !loading &&
      !submittedRef.current
    ) {
      submittedRef.current = true;
      requestAnimationFrame(() => { void submitDisable(normalized); });
    }
  };

  const handleBackupChange = (value: string) => {
    const next = normalizeBackupCodeInput(value);
    setDisplay(next.display);
    setRaw(next.raw);
    if (next.raw.length < BACKUP_CODE_RAW_LENGTH) submittedRef.current = false;
    if (otpState === 'error') setOtpState('idle');
  };

  const handleToggleBackup = () => {
    setUseBackup((v) => !v);
    setDisplay('');
    setRaw('');
    setError('');
    setOtpState('idle');
    submittedRef.current = false;
  };

  const handleDisableClick = () => {
    if (loading || raw.length !== expectedLength) return;
    submittedRef.current = true;
    void submitDisable(raw);
  };

  return (
    <Modal size="md" open={open} onOpenChange={onOpenChange}>
      <ModalDestructiveHeader
        kicker="SECURITY · MFA · DISABLE"
        title="Turn off two-factor"
        description="Disabling 2FA removes this login layer. Your backup codes become invalid."
      />
      <ModalBody>
        <p className="text-sm leading-snug text-stat-subtitle">
          Disabling 2FA removes this login layer. Your backup codes become invalid.
          Confirm with a current code to proceed.
        </p>
        {useBackup ? (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
              Backup code · 10 chars
            </span>
            <Input
              id="mfa-disable-backup"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              maxLength={BACKUP_CODE_DISPLAY_LENGTH}
              value={display}
              onChange={(e) => handleBackupChange(e.target.value)}
              placeholder="ABCDE-FGHIJ"
              className="h-12 bg-background/60 border-card-border text-center font-mono text-lg tabular-nums tracking-[0.3em] shadow-[inset_0_2px_4px_0_oklch(0_0_0/0.25)] focus-visible:border-brand/60 focus-visible:ring-2 focus-visible:ring-brand/40"
            />
          </div>
        ) : (
          <OtpDigitField
            id="mfa-disable-code"
            value={display}
            onChange={handleOtpChange}
            state={otpState}
            disabled={loading || otpState === 'success'}
            autoFocus
          />
        )}
        <button
          type="button"
          onClick={handleToggleBackup}
          className="self-start font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle transition-colors hover:text-brand"
        >
          {useBackup ? '[ Use authenticator ]' : '[ Use backup code ]'}
        </button>
        {error && <ErrorRail>{error}</ErrorRail>}
      </ModalBody>
      <ModalFooter
        secondary={
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
        }
        primary={
          <Button
            type="button"
            variant="destructive"
            disabled={loading || raw.length !== expectedLength}
            onClick={handleDisableClick}
          >
            {loading ? 'Disabling...' : 'Disable'}
          </Button>
        }
      />
    </Modal>
  );
}
