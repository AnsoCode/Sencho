import type { ReactNode } from 'react';
import { useLicense } from '@/context/LicenseContext';

/**
 * Thin wrapper that renders its children only for licensees on the
 * Admiral plan. All other tiers (Community, Skipper) see nothing in
 * this slot. Backend tier guards (`requireAdmiral`) remain the
 * authoritative enforcement; this component only controls UI
 * visibility.
 */
export function AdmiralGate({ children }: { children: ReactNode }) {
    const { isPaid, license } = useLicense();
    const isAdmiral = isPaid && license?.variant === 'admiral';
    return isAdmiral ? <>{children}</> : null;
}
