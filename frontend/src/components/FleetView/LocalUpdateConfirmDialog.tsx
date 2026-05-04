import { Download } from 'lucide-react';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface LocalUpdateConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
}

export function LocalUpdateConfirmDialog({ open, onOpenChange, onConfirm }: LocalUpdateConfirmDialogProps) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Update local node?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will pull the latest Sencho image and restart the server. The dashboard will be
                        briefly disconnected and will automatically reconnect when the update completes.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>
                        <Download className="w-4 h-4 mr-1.5" strokeWidth={1.5} />
                        Update &amp; Restart
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
