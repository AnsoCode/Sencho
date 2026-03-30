import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RefreshCw } from 'lucide-react';

interface AccountSectionProps {
    authData: { oldPassword: string; newPassword: string; confirmPassword: string };
    onAuthDataChange: (data: { oldPassword: string; newPassword: string; confirmPassword: string }) => void;
    onPasswordChange: () => Promise<void>;
    isSaving: boolean;
}

export function AccountSection({ authData, onAuthDataChange, onPasswordChange, isSaving }: AccountSectionProps) {
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium tracking-tight">Account & Security</h3>
                <p className="text-sm text-muted-foreground">Manage your credentials and authentication.</p>
            </div>
            <div className="space-y-4 max-w-sm">
                <div className="space-y-2">
                    <Label>Current Password</Label>
                    <Input
                        type="password"
                        value={authData.oldPassword}
                        onChange={(e) => onAuthDataChange({ ...authData, oldPassword: e.target.value })}
                    />
                </div>
                <div className="space-y-2">
                    <Label>New Password</Label>
                    <Input
                        type="password"
                        value={authData.newPassword}
                        onChange={(e) => onAuthDataChange({ ...authData, newPassword: e.target.value })}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Confirm New Password</Label>
                    <Input
                        type="password"
                        value={authData.confirmPassword}
                        onChange={(e) => onAuthDataChange({ ...authData, confirmPassword: e.target.value })}
                    />
                </div>
                <Button onClick={onPasswordChange} disabled={isSaving} className="w-full">
                    {isSaving
                        ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Updating...</>
                        : 'Update Password'
                    }
                </Button>
            </div>
        </div>
    );
}
