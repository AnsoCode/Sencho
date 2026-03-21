'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

import {
  Dialog,
  DialogPortal,
  DialogOverlay as AnimateDialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent as AnimateDialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/animate-ui/primitives/radix/dialog';

// Drop-in DialogContent that bundles portal + overlay + close button
// while delegating animation to animate-ui's spring-based dialog
const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof AnimateDialogContent>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <AnimateDialogOverlay className="fixed inset-0 z-50 bg-black/80" />
    <AnimateDialogContent
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg sm:rounded-lg',
        className
      )}
      {...props}
    >
      {children}
      <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogClose>
    </AnimateDialogContent>
  </DialogPortal>
));
DialogContent.displayName = 'DialogContent';

const DialogOverlay = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof AnimateDialogOverlay>
>((props, ref) => (
  <AnimateDialogOverlay ref={ref} {...props} />
));
DialogOverlay.displayName = 'DialogOverlay';

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
