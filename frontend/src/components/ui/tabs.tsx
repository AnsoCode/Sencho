import * as React from 'react';
import { cn } from '@/lib/utils';

import {
  Tabs,
  TabsList as AnimateTabsList,
  TabsTrigger as AnimateTabsTrigger,
  TabsContent as AnimateTabsContent,
} from '@/components/animate-ui/primitives/radix/tabs';

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof AnimateTabsList>
>(({ className, ...props }, ref) => (
  <AnimateTabsList
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
      className
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof AnimateTabsTrigger>
>(({ className, ...props }, ref) => (
  <AnimateTabsTrigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

const TabsContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof AnimateTabsContent>
>(({ className, ...props }, ref) => (
  <AnimateTabsContent
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    transition={{ duration: 0.2, ease: 'easeOut' }}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
