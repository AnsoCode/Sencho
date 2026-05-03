import { ConfirmModal } from '../ui/modal';

export interface UnsavedChangesDialogProps {
    open: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

export function UnsavedChangesDialog({ open, onCancel, onConfirm }: UnsavedChangesDialogProps) {
    return (
        <ConfirmModal
            open={open}
            onOpenChange={(next) => { if (!next) onCancel(); }}
            kicker="EDITOR · UNSAVED CHANGES"
            title="Discard unsaved changes?"
            description="You have unsaved changes. Switching stacks will discard them."
            confirmLabel="Discard changes"
            onConfirm={onConfirm}
        >
            <p className="text-sm text-muted-foreground">
                You have unsaved changes. Switching stacks will discard them.
            </p>
        </ConfirmModal>
    );
}
