import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

const KICKER_CLASS = 'font-mono text-[10px] uppercase tracking-[0.22em]';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl w-[95vw]',
};

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  size?: ModalSize;
  className?: string;
}

export function Modal({ open, onOpenChange, children, size = 'md', className }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'p-0 gap-0 overflow-hidden',
          SIZE_CLASS[size],
          className,
        )}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

interface ModalHeaderBaseProps {
  kicker: string;
  title: React.ReactNode;
  description?: string;
}

function HeaderShell({
  kicker,
  title,
  description,
  railClassName,
  kickerClassName,
}: ModalHeaderBaseProps & { railClassName: string; kickerClassName: string }) {
  return (
    <div className="relative border-b border-card-border/60 px-6 pt-6 pb-4 pr-12">
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', railClassName)} />
      <div className={cn(KICKER_CLASS, kickerClassName)}>
        {kicker}
      </div>
      <DialogTitle className="mt-1 font-display text-[1.75rem] italic leading-tight text-stat-value">
        {title}
      </DialogTitle>
      <DialogDescription className="sr-only">
        {description ?? (typeof title === 'string' ? title : kicker)}
      </DialogDescription>
    </div>
  );
}

export function ModalHeader(props: ModalHeaderBaseProps) {
  return (
    <HeaderShell
      {...props}
      railClassName="bg-brand"
      kickerClassName="text-stat-subtitle"
    />
  );
}

export function ModalDestructiveHeader(props: ModalHeaderBaseProps) {
  return (
    <HeaderShell
      {...props}
      railClassName="bg-destructive"
      kickerClassName="text-destructive"
    />
  );
}

export function ModalBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 py-5 space-y-4', className)} {...props} />;
}

interface ModalFooterProps {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  hint?: React.ReactNode;
  hintAccent?: React.ReactNode;
}

export function ModalFooter({ primary, secondary, hint, hintAccent }: ModalFooterProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-card-border/60 px-6 py-4">
      <div className={cn(KICKER_CLASS, 'text-stat-subtitle')}>
        {hint}
        {hintAccent !== undefined && (
          <span className="ml-1.5 rounded-sm border border-card-border bg-card px-1.5 py-0.5 text-stat-value">
            {hintAccent}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {secondary}
        {primary}
      </div>
    </div>
  );
}
