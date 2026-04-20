import * as React from 'react';
import { cn } from '@/lib/utils';

type OtpState = 'idle' | 'loading' | 'success' | 'error';

interface OtpDigitFieldProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  state?: OtpState;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  ariaLabel?: string;
}

export function OtpDigitField({
  value,
  onChange,
  length = 6,
  state = 'idle',
  disabled = false,
  autoFocus = false,
  id,
  ariaLabel = '6-digit verification code',
}: OtpDigitFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (autoFocus && inputRef.current && !disabled) inputRef.current.focus();
  }, [autoFocus, disabled]);

  const activeIndex = Math.min(value.length, length - 1);
  const isSuccess = state === 'success';
  const isError = state === 'error';
  const isLoading = state === 'loading';

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'relative flex w-full items-stretch gap-2',
        disabled && 'pointer-events-none opacity-60',
      )}
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      {Array.from({ length }).map((_, i) => {
        const char = value[i] ?? '';
        const filled = char !== '';
        const isActive = focused && !disabled && i === activeIndex;
        return (
          <div
            key={i}
            aria-hidden
            className={cn(
              'relative flex h-14 flex-1 items-center justify-center rounded-md border bg-background transition-colors',
              'shadow-[inset_0_2px_4px_0_oklch(0_0_0/0.4)]',
              'font-mono tabular-nums text-2xl',
              isError
                ? 'border-destructive/60 text-destructive'
                : isSuccess
                  ? 'border-brand/60 text-brand'
                  : isActive
                    ? 'border-brand/70 text-stat-value shadow-[inset_0_2px_4px_0_oklch(0_0_0/0.4),0_0_0_3px_oklch(0.78_0.11_195_/_0.22)]'
                    : filled
                      ? 'border-card-border-top text-stat-value'
                      : 'border-card-border text-stat-subtitle',
              isLoading && 'opacity-70',
            )}
          >
            {char || (isActive ? <span className="h-5 w-[1.5px] animate-pulse bg-brand" /> : null)}
          </div>
        );
      })}
    </div>
  );
}
