import { useState } from 'react';
import { Settings, LogOut, ExternalLink, Monitor, Sun, Moon, User, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { TierBadge } from './TierBadge';

type Theme = 'light' | 'dark' | 'auto';

interface UserProfileDropdownProps {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    onOpenSettings: () => void;
}

export function UserProfileDropdown({ theme, setTheme, onOpenSettings }: UserProfileDropdownProps) {
    const { logout, user, isAdmin } = useAuth();
    const { license } = useLicense();
    const [billingLoading, setBillingLoading] = useState(false);

    const openBillingPortal = async () => {
        setBillingLoading(true);
        try {
            const res = await apiFetch('/license/billing-portal', { localOnly: true });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.url) {
                window.open(data.url, '_blank');
                return;
            }
            toast.error(data?.error || data?.message || data?.data?.error || 'Something went wrong.');
        } catch {
            toast.error('Failed to open billing portal.');
        } finally {
            setBillingLoading(false);
        }
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="rounded-full w-9 h-9" title="Profile">
                    <User className="w-4 h-4" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0 rounded-xl" align="end" sideOffset={8}>
                {/* User Info */}
                <div className="px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                            <User className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{user?.username ?? 'admin'}</p>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${isAdmin ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                                    {user?.role ?? 'admin'}
                                </span>
                                <span className="text-muted-foreground/40">·</span>
                                <TierBadge />
                            </div>
                        </div>
                    </div>
                </div>

                <Separator />

                {/* Navigation Links */}
                <div className="p-1">
                    <button
                        onClick={onOpenSettings}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors text-left"
                    >
                        <Settings className="w-4 h-4 text-muted-foreground" />
                        Settings
                    </button>
                    {license?.status === 'active' && (
                        <button
                            onClick={openBillingPortal}
                            disabled={billingLoading}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors text-left disabled:opacity-50"
                        >
                            {billingLoading ? (
                                <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                            ) : (
                                <ExternalLink className="w-4 h-4 text-muted-foreground" />
                            )}
                            Billing
                        </button>
                    )}
                </div>

                <Separator />

                {/* Theme Toggle */}
                <div className="p-3">
                    <p className="text-xs text-muted-foreground mb-2">Theme</p>
                    <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
                        <button
                            onClick={() => setTheme('auto')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                                theme === 'auto' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <Monitor className="w-3.5 h-3.5" />
                            System
                        </button>
                        <button
                            onClick={() => setTheme('light')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                                theme === 'light' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <Sun className="w-3.5 h-3.5" />
                            Light
                        </button>
                        <button
                            onClick={() => setTheme('dark')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                                theme === 'dark' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <Moon className="w-3.5 h-3.5" />
                            Dark
                        </button>
                    </div>
                </div>

                <Separator />

                {/* Documentation Links */}
                <div className="p-1">
                    <a
                        href="https://docs.sencho.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors"
                    >
                        <ExternalLink className="w-4 h-4 text-muted-foreground" />
                        Documentation
                    </a>
                    <a
                        href="https://github.com/AnsoCode/Sencho/issues"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors"
                    >
                        <ExternalLink className="w-4 h-4 text-muted-foreground" />
                        Feedback
                    </a>
                </div>

                <Separator />

                {/* Logout */}
                <div className="p-2">
                    <Button
                        variant="outline"
                        className="w-full justify-center"
                        onClick={logout}
                    >
                        <LogOut className="w-4 h-4 mr-2" />
                        Log Out
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
