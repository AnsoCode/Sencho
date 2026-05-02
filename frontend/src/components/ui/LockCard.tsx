import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Centered glass-card lock state shared by tier gates and capability
 * gates. Both gate variants short-circuit before mounting their gated
 * children, so this card lives in the "no children rendered" branch and
 * cannot trigger any lazy chunk fetches.
 *
 * Sized via `min-h-[280px]` so the card looks reasonable in inline
 * contexts (e.g. a settings section panel) where the parent has no
 * explicit height. Full-page contexts with explicit height stretch the
 * card via `flex-1`. Override the outer layout with `className` when a
 * specific consumer needs different proportions; the inner card box is
 * intentionally fixed so all lock states across the app share the same
 * geometry.
 */
interface LockCardProps {
    icon: LucideIcon;
    title: string;
    body: string;
    className?: string;
}

export function LockCard({ icon: Icon, title, body, className }: LockCardProps) {
    return (
        <div className={cn('flex flex-1 items-center justify-center p-8 min-h-[280px]', className)}>
            <div className="flex flex-col items-center gap-4 rounded-xl border border-glass-border bg-glass px-10 py-8 text-center max-w-md">
                <div className="flex items-center justify-center w-12 h-12 rounded-full border border-glass-border bg-glass">
                    <Icon className="w-5 h-5 text-stat-subtitle" strokeWidth={1.5} />
                </div>
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-stat-value">{title}</p>
                    <p className="text-sm text-stat-subtitle">{body}</p>
                </div>
            </div>
        </div>
    );
}
