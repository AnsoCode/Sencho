import { Crown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ProBadgeProps {
    className?: string;
}

export function ProBadge({ className }: ProBadgeProps) {
    return (
        <Badge variant="secondary" className={`gap-1 text-[10px] font-semibold uppercase px-1.5 py-0 ${className || ''}`}>
            <Crown className="w-2.5 h-2.5" />
            Pro
        </Badge>
    );
}
