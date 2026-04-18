import { cn } from '@/lib/utils';

interface TemplateLogoProps {
  logo?: string;
  title: string;
  size: 'sm' | 'lg';
  imgError: boolean;
  onImgError: () => void;
}

const SIZE_CLASS = {
  sm: 'h-9 w-9 rounded-sm',
  lg: 'h-20 w-20 rounded-md',
} as const;

const LETTER_CLASS = {
  sm: 'text-lg',
  lg: 'text-5xl',
} as const;

const PAD_CLASS = {
  sm: 'p-1',
  lg: 'p-3',
} as const;

export function TemplateLogo({ logo, title, size, imgError, onImgError }: TemplateLogoProps) {
  const firstLetter = title.charAt(0).toUpperCase();

  return (
    <div
      className={cn(
        SIZE_CLASS[size],
        'bg-gradient-to-br border border-brand/25 flex items-center justify-center overflow-hidden',
        size === 'lg'
          ? 'from-brand/40 via-brand/20 to-teal-500/20 border-brand/30'
          : 'from-brand/25 via-brand/10 to-teal-500/10',
      )}
    >
      {logo && !imgError ? (
        <img
          src={logo}
          alt={title}
          className={cn('w-full h-full object-contain', PAD_CLASS[size])}
          onError={onImgError}
        />
      ) : (
        <span className={cn('font-display italic text-brand leading-none', LETTER_CLASS[size])}>
          {firstLetter}
        </span>
      )}
    </div>
  );
}
