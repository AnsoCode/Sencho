import { useState } from 'react';
import { ChevronDown, Lock, Layers, AlertCircle } from 'lucide-react';
import type { AnalyzerResult } from '@/lib/blueprintsApi';

interface BlueprintClassificationBannerProps {
    analysis: AnalyzerResult | null;
    /** When true, render an even more compact strip suitable for inline detail sheets. */
    compact?: boolean;
}

const COPY: Record<'stateless' | 'stateful' | 'unknown', { kicker: string; message: string }> = {
    stateless: {
        kicker: 'Stateless · portable',
        message: 'No persistent volumes detected. Sencho can deploy and evict freely across nodes.',
    },
    stateful: {
        kicker: 'Stateful · pins to data',
        message: 'Persistent volumes detected. Each node holds its own data; eviction requires explicit operator confirmation.',
    },
    unknown: {
        kicker: 'State unknown',
        message: 'External or unanalyzable volumes detected. Treated as stateful for safety.',
    },
};

export function BlueprintClassificationBanner({ analysis, compact = false }: BlueprintClassificationBannerProps) {
    const [showDetails, setShowDetails] = useState(false);

    if (!analysis) {
        return (
            <div className="rounded-lg border border-card-border bg-card/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Compose not analyzed yet
            </div>
        );
    }

    const { classification, reasons, parseError } = analysis;
    const tone = classification === 'stateless' ? 'success' : classification === 'unknown' ? 'muted' : 'warning';
    const Icon = classification === 'stateless' ? Layers : classification === 'unknown' ? AlertCircle : Lock;

    const dotColor =
        tone === 'success' ? 'bg-success'
        : tone === 'warning' ? 'bg-warning'
        : 'bg-muted-foreground';

    return (
        <div className={`rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel ${compact ? 'px-3 py-2' : 'p-3'}`}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} aria-hidden />
                    <Icon className="w-3.5 h-3.5 text-stat-icon shrink-0" strokeWidth={1.5} />
                    <div className="flex flex-col min-w-0">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stat-icon">
                            {COPY[classification].kicker}
                        </span>
                        {!compact && (
                            <span className="text-xs text-stat-subtitle leading-snug truncate">
                                {parseError ? `Could not parse compose: ${parseError}` : COPY[classification].message}
                            </span>
                        )}
                    </div>
                </div>
                {reasons.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setShowDetails(s => !s)}
                        className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-stat-icon hover:text-stat-value cursor-pointer shrink-0"
                    >
                        {showDetails ? 'Hide' : `${reasons.length} signal${reasons.length === 1 ? '' : 's'}`}
                        <ChevronDown className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} strokeWidth={1.5} />
                    </button>
                )}
            </div>
            {showDetails && reasons.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border pt-3">
                    {reasons.map((reason, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-stat-subtitle leading-relaxed">
                            <span className="text-stat-icon font-mono">·</span>
                            <span>{reason}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
