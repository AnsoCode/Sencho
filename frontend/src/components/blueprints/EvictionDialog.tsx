import { useState } from 'react';
import { AlertTriangle, Camera } from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface EvictionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    blueprintName: string;
    nodeName: string;
    isStateful: boolean;
    busy: boolean;
    onConfirm: (mode: 'standard' | 'snapshot_then_evict' | 'evict_and_destroy') => void;
}

export function EvictionDialog({
    open, onOpenChange, blueprintName, nodeName, isStateful, busy, onConfirm,
}: EvictionDialogProps) {
    const [confirmText, setConfirmText] = useState('');
    const destructiveDisabled = isStateful && confirmText.trim() !== blueprintName;

    function reset() {
        setConfirmText('');
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <div className="flex items-center gap-2 text-brand font-mono text-[10px] uppercase tracking-[0.2em]">
                        <span className="inline-block w-1 h-3 bg-brand" />
                        Withdraw deployment
                    </div>
                    <DialogTitle className="font-serif italic text-xl tracking-[-0.01em]">
                        Stop {blueprintName} on {nodeName}
                    </DialogTitle>
                    <DialogDescription>
                        {isStateful
                            ? 'This blueprint is stateful. Choose how to handle its data on this node.'
                            : 'Sencho will run docker compose down and remove the blueprint directory on this node.'}
                    </DialogDescription>
                </DialogHeader>

                {isStateful && (
                    <div className="space-y-3">
                        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 flex gap-2">
                            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" strokeWidth={1.5} />
                            <p className="text-xs text-stat-subtitle leading-relaxed">
                                Named volumes or bind mounts were detected. Evicting destroys the named volumes managed by this stack on <span className="font-mono">{nodeName}</span>. Bind mounts on the host filesystem are left in place.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => onConfirm('snapshot_then_evict')}
                            disabled={busy}
                            className="w-full text-left rounded-lg border border-card-border border-t-card-border-top bg-card hover:border-t-card-border-hover transition-colors p-3 cursor-pointer"
                        >
                            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-brand">
                                <Camera className="w-3 h-3" strokeWidth={1.5} />
                                Snapshot, then evict (recommended)
                            </div>
                            <p className="text-xs text-stat-subtitle mt-1.5 leading-relaxed">
                                Captures the compose definition into the existing fleet-snapshot store, then runs the eviction. Note: volume bytes are not shipped; that ships in a future Volume Migration feature.
                            </p>
                        </button>

                        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-destructive">
                                Evict and destroy data
                            </div>
                            <p className="text-xs text-stat-subtitle leading-relaxed">
                                Type <span className="font-mono text-stat-value">{blueprintName}</span> to confirm.
                            </p>
                            <Input
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                placeholder={blueprintName}
                                className="font-mono text-xs"
                                disabled={busy}
                            />
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    {isStateful ? (
                        <Button
                            variant="outline"
                            className="text-destructive border-destructive/40 hover:bg-destructive/10"
                            disabled={destructiveDisabled || busy}
                            onClick={() => onConfirm('evict_and_destroy')}
                        >
                            Evict and destroy data
                        </Button>
                    ) : (
                        <Button onClick={() => onConfirm('standard')} disabled={busy}>
                            Withdraw deployment
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
