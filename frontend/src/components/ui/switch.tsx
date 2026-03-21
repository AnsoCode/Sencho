'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

import {
  Switch as AnimateSwitch,
  SwitchThumb,
  type SwitchProps as AnimateSwitchProps,
} from '@/components/animate-ui/primitives/radix/switch';

type SwitchProps = Omit<AnimateSwitchProps, 'children'>;

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, ...props }, ref) => (
    <AnimateSwitch
      ref={ref}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className
      )}
      {...props}
    >
      <SwitchThumb
        className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
        pressedAnimation={{ scale: 1.15 }}
      />
    </AnimateSwitch>
  )
);
Switch.displayName = 'Switch';

export { Switch };
