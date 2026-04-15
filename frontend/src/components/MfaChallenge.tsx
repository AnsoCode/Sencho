import { useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  BACKUP_CODE_DISPLAY_LENGTH,
  TOTP_LENGTH,
  normalizeBackupCodeInput,
  normalizeTotpInput,
} from '@/lib/mfa';

export function MfaChallenge({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'>) {
  const { submitMfa, cancelMfa } = useAuth();
  // `display` is what the user sees in the input (with dash for backup codes);
  // `raw` is the normalized value we send to the server.
  const [display, setDisplay] = useState('');
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  // Latch so auto-submit only fires once per full code entry: cleared on any
  // edit that brings the input back below a full code.
  const submittedRef = useRef(false);

  const runSubmit = async (valueToSubmit: string) => {
    setError('');
    setIsLoading(true);
    const result = await submitMfa(valueToSubmit, { isBackupCode: useBackup });
    if (!result.success) {
      const retryNote = result.retryAfter ? ` (try again in ${Math.ceil(result.retryAfter / 60)} min)` : '';
      setError((result.error || 'Verification failed') + retryNote);
      setDisplay('');
      setRaw('');
      submittedRef.current = false;
    }
    setIsLoading(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || !raw) return;
    submittedRef.current = true;
    void runSubmit(raw);
  };

  const handleChange = (value: string) => {
    if (useBackup) {
      const next = normalizeBackupCodeInput(value);
      setDisplay(next.display);
      setRaw(next.raw);
      if (next.raw.length < 10) submittedRef.current = false;
      // Backup codes are longer and deliberate; do not auto-submit.
      return;
    }
    const normalized = normalizeTotpInput(value);
    setDisplay(normalized);
    setRaw(normalized);
    if (normalized.length < TOTP_LENGTH) submittedRef.current = false;
    if (
      normalized.length === TOTP_LENGTH &&
      !isLoading &&
      !submittedRef.current
    ) {
      submittedRef.current = true;
      // Let the state update flush before firing so the spinner state lines
      // up with the disabled button.
      requestAnimationFrame(() => { void runSubmit(normalized); });
    }
  };

  const handleToggleBackup = () => {
    setUseBackup((v) => !v);
    setDisplay('');
    setRaw('');
    setError('');
    submittedRef.current = false;
  };

  return (
    <div className={cn('grid min-h-svh md:grid-cols-2', className)} {...props}>
      {/* Branding panel (matches Login layout) */}
      <div className="relative hidden md:flex flex-col items-center justify-center bg-zinc-950 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.7) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-6 px-12">
          <img
            src="/sencho-logo-dark.png"
            alt="Sencho"
            className="w-28 h-28"
            draggable={false}
          />
          <div className="text-center">
            <h1 className="text-4xl font-medium text-foreground tracking-tight">Sencho</h1>
            <p className="text-base text-zinc-400 mt-2">Docker Compose Management</p>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-brand" />
      </div>

      {/* Form panel */}
      <div className="flex flex-col items-center justify-center bg-background px-6 py-12">
        <div className="flex items-center gap-2.5 mb-10 md:hidden">
          <img src="/sencho-logo-light.png" alt="Sencho" className="w-8 h-8 dark:hidden" draggable={false} />
          <img src="/sencho-logo-dark.png" alt="Sencho" className="w-8 h-8 hidden dark:block" draggable={false} />
          <span className="text-lg font-semibold tracking-tight">Sencho</span>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">Two-factor authentication</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {useBackup
                ? 'Enter one of your saved backup codes to continue.'
                : 'Open your authenticator app and enter the 6-digit code.'}
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-5">
              <div className="grid gap-2">
                <Label htmlFor="mfa-code">{useBackup ? 'Backup code' : 'Verification code'}</Label>
                <Input
                  id="mfa-code"
                  type="text"
                  inputMode={useBackup ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  maxLength={useBackup ? BACKUP_CODE_DISPLAY_LENGTH : TOTP_LENGTH}
                  value={display}
                  onChange={(e) => handleChange(e.target.value)}
                  className="font-mono tabular-nums tracking-widest text-center"
                  placeholder={useBackup ? 'ABCDE-FGHIJ' : '123456'}
                />
              </div>
              {error && (
                <div className="text-sm text-destructive text-center">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isLoading || !raw}>
                {isLoading ? 'Verifying...' : 'Verify and sign in'}
              </Button>
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground text-center transition-colors"
                onClick={handleToggleBackup}
              >
                {useBackup ? 'Use your authenticator app instead' : 'Use a backup code instead'}
              </button>
              <button
                type="button"
                className="text-sm text-muted-foreground/70 hover:text-foreground text-center transition-colors"
                onClick={cancelMfa}
              >
                Cancel and sign out
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
