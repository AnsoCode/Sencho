import { useCallback, useEffect, useState } from 'react';
import { SENCHO_SETTINGS_CHANGED } from '@/lib/events';

export const DEPLOY_FEEDBACK_KEY = 'sencho.deploy-feedback.enabled';

function readStored(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(DEPLOY_FEEDBACK_KEY) === 'true';
    } catch {
        return false;
    }
}

export function useDeployFeedbackEnabled(): [boolean, (next: boolean) => void] {
    const [enabled, setEnabledState] = useState<boolean>(readStored);

    useEffect(() => {
        function onSettingsChanged() {
            setEnabledState(readStored());
        }
        window.addEventListener(SENCHO_SETTINGS_CHANGED, onSettingsChanged);
        return () => window.removeEventListener(SENCHO_SETTINGS_CHANGED, onSettingsChanged);
    }, []);

    useEffect(() => {
        function onStorage(event: StorageEvent) {
            if (event.key !== DEPLOY_FEEDBACK_KEY) return;
            setEnabledState(event.newValue === 'true');
        }
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const setEnabled = useCallback((next: boolean) => {
        try {
            window.localStorage.setItem(DEPLOY_FEEDBACK_KEY, next ? 'true' : 'false');
        } catch {
            // ignore; localStorage may be unavailable (private mode, quota)
        }
        setEnabledState(next);
        window.dispatchEvent(new CustomEvent(SENCHO_SETTINGS_CHANGED));
    }, []);

    return [enabled, setEnabled];
}
