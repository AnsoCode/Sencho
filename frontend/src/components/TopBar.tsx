import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Menu } from 'lucide-react';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';
import { Highlight, HighlightItem } from './animate-ui/primitives/effects/highlight';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface TopBarNavItem {
    value: string;
    label: string;
    icon: LucideIcon;
}

interface TopBarProps {
    activeView: string;
    navItems: TopBarNavItem[];
    navTabValue: string | undefined;
    onNavigate: (value: string) => void;
    mobileNavOpen: boolean;
    onMobileNavOpenChange: (open: boolean) => void;
    notifications: ReactNode;
    userMenu: ReactNode;
}

export function TopBar({
    activeView,
    navItems,
    navTabValue,
    onNavigate,
    mobileNavOpen,
    onMobileNavOpenChange,
    notifications,
    userMenu,
}: TopBarProps) {
    return (
        <div
            className={cn(
                'relative flex h-14 items-center gap-3 px-4',
                'border-b border-glass-border bg-sidebar backdrop-blur-md',
                'shadow-chrome-top',
            )}
        >
            {/* LEFT ZONE: reserved spacer (keeps nav visually centered) */}
            <div className="flex-1 min-w-0" />

            {/* CENTER ZONE: Navigation (hidden on mobile) */}
            <nav aria-label="Primary" className="hidden md:flex justify-center">
                <Highlight
                    className="inset-0 rounded-md bg-accent"
                    value={navTabValue}
                    controlledItems
                    mode="children"
                    click={false}
                    transition={springs.snappy}
                >
                    <div className="inline-flex items-center rounded-lg p-1 gap-0.5">
                        {navItems.map(({ value, label, icon: Icon }) => (
                            <HighlightItem key={value} value={value}>
                                <button
                                    onClick={() => onNavigate(value)}
                                    aria-label={label}
                                    aria-current={activeView === value ? 'page' : undefined}
                                    className={cn(
                                        'relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
                                        activeView === value
                                            ? 'text-foreground after:absolute after:bottom-0 after:left-1/4 after:right-1/4 after:h-[2px] after:rounded-full after:bg-brand after:blur-[2px]'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                                    <span className="hidden xl:inline">{label}</span>
                                </button>
                            </HighlightItem>
                        ))}
                    </div>
                </Highlight>
            </nav>

            {/* RIGHT ZONE: Utilities + identity pin */}
            <div className="flex flex-1 min-w-0 items-center justify-end gap-2">
                {notifications}
                {userMenu}

                {/* Mobile nav trigger */}
                <Sheet open={mobileNavOpen} onOpenChange={onMobileNavOpenChange}>
                    <SheetTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Open navigation menu"
                            className="h-8 w-8 rounded-lg md:hidden"
                        >
                            <Menu className="w-4 h-4" strokeWidth={1.5} />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-64 p-0">
                        <div className="p-4 border-b">
                            <p className="text-sm font-medium">Navigation</p>
                        </div>
                        <nav className="flex flex-col p-2 gap-1">
                            {navItems.map(({ value, label, icon: Icon }) => (
                                <button
                                    key={value}
                                    onClick={() => {
                                        onNavigate(value);
                                        onMobileNavOpenChange(false);
                                    }}
                                    className={cn(
                                        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                                        activeView === value
                                            ? 'bg-glass-highlight font-medium text-foreground'
                                            : 'text-muted-foreground hover:bg-glass-highlight hover:text-foreground',
                                    )}
                                >
                                    <Icon className="w-4 h-4" strokeWidth={1.5} />
                                    {label}
                                </button>
                            ))}
                        </nav>
                    </SheetContent>
                </Sheet>
            </div>
        </div>
    );
}
