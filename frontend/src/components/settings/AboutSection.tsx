import { useLicense } from '@/context/LicenseContext';
import { TierBadge } from '@/components/TierBadge';
import { SettingsSection } from './SettingsSection';
import { SettingsField } from './SettingsField';

export function AboutSection() {
    const { license } = useLicense();

    return (
        <div className="flex flex-col gap-10">
            <SettingsSection title="Build">
                <SettingsField label="Version">
                    <span className="font-mono text-sm text-stat-value">v{__APP_VERSION__}</span>
                </SettingsField>
                <SettingsField label="Tier">
                    <TierBadge />
                </SettingsField>
                <SettingsField label="License status">
                    <span className="font-mono text-[10px] leading-3 uppercase tracking-[0.18em] text-stat-value">
                        {license?.status ?? 'community'}
                    </span>
                </SettingsField>
                {license?.instanceId ? (
                    <SettingsField
                        label="Instance ID"
                        helper="Used to identify this control plane to the license server."
                    >
                        <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                            {license.instanceId.slice(0, 8)}
                        </code>
                    </SettingsField>
                ) : null}
            </SettingsSection>

            <SettingsSection title="Links">
                <SettingsField
                    label="Changelog"
                    helper="See what shipped, when, and why."
                >
                    <a
                        href="https://github.com/studio-saelix/sencho/blob/main/CHANGELOG.md"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] leading-3 uppercase tracking-[0.18em] text-brand hover:text-brand/80 transition-colors"
                    >
                        github.com/studio-saelix/sencho →
                    </a>
                </SettingsField>
            </SettingsSection>
        </div>
    );
}
