import type { Transition } from 'motion/react';

export const springs = {
  snappy: { type: 'spring', stiffness: 350, damping: 30 } as Transition,
  gentle: { type: 'spring', stiffness: 200, damping: 25 } as Transition,
  slow: { type: 'spring', stiffness: 150, damping: 25 } as Transition,
} as const;
