import { useEffect, useState } from 'react';

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
 * Cross-tab sync: a `storage` event listener on `window` propagates
 * dismiss / restore actions from other tabs. The browser fires
 * `storage` events only on tabs OTHER than the one that wrote the
 * change, so this listener handles tab B updates after tab A
 * dismisses or restores; same-tab updates flow through `setDismissed`
 * directly. Stale timestamps that arrive past the 24h window are
 * treated as not-dismissed.
 */
export function useDismissalState(key: string) {
    const [dismissed, setDismissed] = useState(() => readDismissedFromStorage(key));

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== key) return;
            // event.newValue is null when the entry was removed (restore)
            // and a string when it was set (dismiss).
            if (event.newValue === null) {
                setDismissed(false);
                return;
            }
            const ts = Number.parseInt(event.newValue, 10);
            setDismissed(Number.isFinite(ts) && Date.now() - ts < DISMISS_DURATION_MS);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
        // setDismissed is stable per React's setter guarantee; the handler
        // closes over `key` only. Do not add setDismissed (harmless) or
        // dismissed (would re-attach the listener on every state change)
        // to satisfy a future drive-by exhaustive-deps "fix."
    }, [key]);

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

function readDismissedFromStorage(key: string): boolean {
    const dismissedAt = localStorage.getItem(key);
    if (!dismissedAt) return false;
    const ts = Number.parseInt(dismissedAt, 10);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_DURATION_MS;
}
