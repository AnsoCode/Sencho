'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent as AnimateTooltipContent,
} from '@/components/animate-ui/primitives/radix/tooltip';

// Bundles the portal so consumers keep the same <TooltipContent> API
const TooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof AnimateTooltipContent>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPortal>
    <AnimateTooltipContent
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground origin-[--radix-tooltip-content-transform-origin]',
        className
      )}
      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
      {...props}
    />
  </TooltipPortal>
));
TooltipContent.displayName = 'TooltipContent';

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
