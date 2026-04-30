import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MastheadMetadataItem } from '@/components/ui/PageMasthead';

interface MastheadStatsContextValue {
    extras: MastheadMetadataItem[] | null;
    setExtras: (stats: MastheadMetadataItem[] | null) => void;
}

const MastheadStatsContext = createContext<MastheadStatsContextValue | null>(null);

export function MastheadStatsProvider({ children }: { children: ReactNode }) {
    const [extras, setExtras] = useState<MastheadMetadataItem[] | null>(null);
    const value = useMemo<MastheadStatsContextValue>(() => ({ extras, setExtras }), [extras]);
    return <MastheadStatsContext.Provider value={value}>{children}</MastheadStatsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMastheadStatsValue(): MastheadMetadataItem[] | null {
    return useContext(MastheadStatsContext)?.extras ?? null;
}

/**
 * Sections call this with their contextual stats; they appear in the page masthead.
 * Pass null to clear. Stats are cleared automatically when the calling section unmounts.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useMastheadStats(stats: MastheadMetadataItem[] | null): void {
    const ctx = useContext(MastheadStatsContext);
    const setExtras = ctx?.setExtras;
    const signature = stats ? stats.map(s => `${s.label}|${s.value}|${s.tone ?? ''}`).join('§') : '';
    const lastSignatureRef = useRef<string>('');

    useEffect(() => {
        if (!setExtras) return;
        if (lastSignatureRef.current === signature) return;
        lastSignatureRef.current = signature;
        setExtras(stats);
    }, [setExtras, signature, stats]);

    useEffect(() => {
        if (!setExtras) return;
        return () => setExtras(null);
    }, [setExtras]);
}
