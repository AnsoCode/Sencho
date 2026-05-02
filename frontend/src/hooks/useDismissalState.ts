import { useState } from 'react';

const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Tracks the localStorage-backed dismissal flag for an upsell gate.
 * `dismiss()` writes the current timestamp and flips state to dismissed;
 * `restore()` removes the timestamp so the next render falls through to
 * the full upsell card. The dismissal window is 24h; after expiry,
 * `localStorage.getItem(key)` still returns a stale timestamp but the
 * lazy initializer treats it as expired and returns `dismissed: false`,
 * so the gate shows the full upsell again on next mount.
 *
 * Each hook instance owns its own React state. If two `<PaidGate>`
 * mounts share the same key in the same tab, dismissing one does not
 * sync to the other until that other re-mounts. Cross-instance pub-sub
 * is not provided; the dismissal is a soft UX nicety, not a security
 * boundary.
 */
export function useDismissalState(key: string) {
    const [dismissed, setDismissed] = useState(() => {
        const dismissedAt = localStorage.getItem(key);
        if (!dismissedAt) return false;
        const ts = Number.parseInt(dismissedAt, 10);
        if (!Number.isFinite(ts)) return false;
        return Date.now() - ts < DISMISS_DURATION_MS;
    });

    const dismiss = () => {
        localStorage.setItem(key, Date.now().toString());
        setDismissed(true);
    };

    const restore = () => {
        localStorage.removeItem(key);
        setDismissed(false);
    };

    return { dismissed, dismiss, restore };
}
