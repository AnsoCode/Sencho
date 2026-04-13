import { type MouseEvent, type ReactNode } from 'react';

export type LabelColor = 'teal' | 'blue' | 'purple' | 'rose' | 'amber' | 'green' | 'orange' | 'pink' | 'cyan' | 'slate';

export const LABEL_COLORS: LabelColor[] = ['teal', 'blue', 'purple', 'rose', 'amber', 'green', 'orange', 'pink', 'cyan', 'slate'];

export const MAX_LABELS_PER_NODE = 50;

export interface Label {
    id: number;
    node_id: number;
    name: string;
    color: LabelColor;
}

const COLOR_STYLES: Record<LabelColor, { bg: string; text: string; border: string; activeBg: string }> = {
    teal:   { bg: 'bg-[var(--label-teal-bg)]',   text: 'text-[var(--label-teal)]',   border: 'border-[var(--label-teal)]/30',   activeBg: 'bg-[var(--label-teal)]' },
    blue:   { bg: 'bg-[var(--label-blue-bg)]',   text: 'text-[var(--label-blue)]',   border: 'border-[var(--label-blue)]/30',   activeBg: 'bg-[var(--label-blue)]' },
    purple: { bg: 'bg-[var(--label-purple-bg)]', text: 'text-[var(--label-purple)]', border: 'border-[var(--label-purple)]/30', activeBg: 'bg-[var(--label-purple)]' },
    rose:   { bg: 'bg-[var(--label-rose-bg)]',   text: 'text-[var(--label-rose)]',   border: 'border-[var(--label-rose)]/30',   activeBg: 'bg-[var(--label-rose)]' },
    amber:  { bg: 'bg-[var(--label-amber-bg)]',  text: 'text-[var(--label-amber)]',  border: 'border-[var(--label-amber)]/30',  activeBg: 'bg-[var(--label-amber)]' },
    green:  { bg: 'bg-[var(--label-green-bg)]',  text: 'text-[var(--label-green)]',  border: 'border-[var(--label-green)]/30',  activeBg: 'bg-[var(--label-green)]' },
    orange: { bg: 'bg-[var(--label-orange-bg)]', text: 'text-[var(--label-orange)]', border: 'border-[var(--label-orange)]/30', activeBg: 'bg-[var(--label-orange)]' },
    pink:   { bg: 'bg-[var(--label-pink-bg)]',   text: 'text-[var(--label-pink)]',   border: 'border-[var(--label-pink)]/30',   activeBg: 'bg-[var(--label-pink)]' },
    cyan:   { bg: 'bg-[var(--label-cyan-bg)]',   text: 'text-[var(--label-cyan)]',   border: 'border-[var(--label-cyan)]/30',   activeBg: 'bg-[var(--label-cyan)]' },
    slate:  { bg: 'bg-[var(--label-slate-bg)]',  text: 'text-[var(--label-slate)]',  border: 'border-[var(--label-slate)]/30',  activeBg: 'bg-[var(--label-slate)]' },
};

interface LabelPillProps {
    label: Label;
    active?: boolean;
    onClick?: (e: MouseEvent) => void;
    onContextMenu?: (e: MouseEvent) => void;
    size?: 'sm' | 'md';
    children?: ReactNode;
}

export function LabelPill({ label, active, onClick, onContextMenu, size = 'md', children }: LabelPillProps) {
    const styles = COLOR_STYLES[label.color] ?? COLOR_STYLES.slate;
    const sizeClasses = size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-[11px] px-2 py-0.5';

    return (
        <button
            type="button"
            onClick={onClick}
            onContextMenu={onContextMenu}
            className={`
                inline-flex items-center gap-1 rounded-md border font-mono
                ${sizeClasses}
                ${active
                    ? `${styles.activeBg} text-white border-transparent`
                    : `${styles.bg} ${styles.text} ${styles.border} hover:border-[var(--label-${label.color})]/60`
                }
                transition-colors cursor-pointer shrink-0
            `}
        >
            {children ?? label.name}
        </button>
    );
}

export function LabelDot({ color }: { color: LabelColor }) {
    return (
        <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: `var(--label-${color})` }}
        />
    );
}

