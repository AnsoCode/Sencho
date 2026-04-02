import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { LabelDot, type Label, type LabelColor } from './LabelPill';

const LABEL_COLORS: LabelColor[] = ['teal', 'blue', 'purple', 'rose', 'amber', 'green', 'orange', 'pink', 'cyan', 'slate'];

interface LabelAssignPopoverProps {
    stackName: string;
    allLabels: Label[];
    assignedLabelIds: number[];
    onLabelsChanged: () => void;
    children: React.ReactNode;
}

export function LabelAssignPopover({ stackName, allLabels, assignedLabelIds, onLabelsChanged, children }: LabelAssignPopoverProps) {
    const [open, setOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState<LabelColor>('teal');
    const [saving, setSaving] = useState(false);

    const toggleLabel = async (labelId: number) => {
        const current = new Set(assignedLabelIds);
        if (current.has(labelId)) {
            current.delete(labelId);
        } else {
            current.add(labelId);
        }
        try {
            const res = await apiFetch(`/stacks/${encodeURIComponent(stackName)}/labels`, {
                method: 'PUT',
                body: JSON.stringify({ labelIds: Array.from(current) }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error || 'Failed to update labels.');
            }
            onLabelsChanged();
        } catch (err: unknown) {
            toast.error((err as Error)?.message || 'Failed to update labels.');
        }
    };

    const createAndAssign = async () => {
        if (!newName.trim()) return;
        setSaving(true);
        try {
            const res = await apiFetch('/labels', {
                method: 'POST',
                body: JSON.stringify({ name: newName.trim(), color: newColor }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error || 'Failed to create label.');
            }
            const label: Label = await res.json();
            const newIds = [...assignedLabelIds, label.id];
            const assignRes = await apiFetch(`/stacks/${encodeURIComponent(stackName)}/labels`, {
                method: 'PUT',
                body: JSON.stringify({ labelIds: newIds }),
            });
            if (!assignRes.ok) {
                const data = await assignRes.json().catch(() => ({}));
                throw new Error(data?.error || 'Failed to assign label.');
            }
            onLabelsChanged();
            setCreating(false);
            setNewName('');
            setNewColor('teal');
        } catch (err: unknown) {
            toast.error((err as Error)?.message || 'Failed to create label.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {children}
            </PopoverTrigger>
            <PopoverContent
                className="w-56 p-2 backdrop-blur-[10px] backdrop-saturate-[1.15]"
                align="start"
            >
                <div className="text-xs font-medium text-muted-foreground px-2 py-1">Labels</div>
                <div className="max-h-[200px] overflow-y-auto">
                    {allLabels.map(label => (
                        <button
                            key={label.id}
                            type="button"
                            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm hover:bg-accent/50 transition-colors cursor-pointer"
                            onClick={() => toggleLabel(label.id)}
                        >
                            <LabelDot color={label.color} />
                            <span className="flex-1 text-left font-mono text-[12px] truncate">{label.name}</span>
                            {assignedLabelIds.includes(label.id) && (
                                <Check className="w-3.5 h-3.5 text-success shrink-0" strokeWidth={1.5} />
                            )}
                        </button>
                    ))}
                    {allLabels.length === 0 && !creating && (
                        <div className="text-xs text-muted-foreground px-2 py-2">No labels yet.</div>
                    )}
                </div>
                {creating ? (
                    <div className="border-t border-border mt-1 pt-2 px-1 space-y-2">
                        <Input
                            placeholder="Label name"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="h-7 text-xs font-mono"
                            maxLength={30}
                            autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') createAndAssign(); if (e.key === 'Escape') setCreating(false); }}
                        />
                        <div className="flex flex-wrap gap-1">
                            {LABEL_COLORS.map(c => (
                                <button
                                    key={c}
                                    type="button"
                                    className={`w-5 h-5 rounded-full border-2 transition-colors ${c === newColor ? 'border-foreground' : 'border-transparent'}`}
                                    style={{ backgroundColor: `var(--label-${c})` }}
                                    onClick={() => setNewColor(c)}
                                />
                            ))}
                        </div>
                        <div className="flex gap-1">
                            <Button size="sm" className="h-6 text-xs flex-1" onClick={createAndAssign} disabled={saving || !newName.trim()}>
                                {saving ? 'Creating...' : 'Create'}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setCreating(false)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent/50 transition-colors mt-1 border-t border-border pt-2 cursor-pointer"
                        onClick={() => setCreating(true)}
                    >
                        <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
                        Create new label
                    </button>
                )}
            </PopoverContent>
        </Popover>
    );
}
