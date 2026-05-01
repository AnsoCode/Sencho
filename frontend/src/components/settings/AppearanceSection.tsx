import { Combobox } from '@/components/ui/combobox';
import { Checkbox } from '@/components/ui/checkbox';
import { useDensity } from '@/hooks/use-density';
import type { Density } from '@/hooks/use-density';
import { useDeployFeedbackEnabled } from '@/hooks/use-deploy-feedback-enabled';
import { useComposeDiffPreviewEnabled } from '@/hooks/use-compose-diff-preview-enabled';
import { SettingsSection } from './SettingsSection';
import { SettingsField } from './SettingsField';

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact', label: 'Compact' },
];

const DENSITY_DESCRIPTIONS: Record<Density, string> = {
    comfortable: 'Default spacing. Roomy rows for review and orientation.',
    compact: 'Tighter rows and tiles. Fits more on screen for dense dashboards.',
};

export function AppearanceSection() {
    const [density, setDensity] = useDensity();
    const [isEnabled, setEnabled] = useDeployFeedbackEnabled();
    const [diffPreviewEnabled, setDiffPreviewEnabled] = useComposeDiffPreviewEnabled();

    return (
        <div className="flex flex-col gap-10">
            <SettingsSection title="Display" kicker="this browser">
                <SettingsField
                    label="Density"
                    helper={DENSITY_DESCRIPTIONS[density]}
                >
                    <Combobox
                        options={DENSITY_OPTIONS}
                        value={density}
                        onValueChange={(v) => {
                            if (v === 'comfortable' || v === 'compact') setDensity(v);
                        }}
                        placeholder="Select density"
                    />
                </SettingsField>

                <SettingsField
                    label="Deploy progress modal"
                    helper="Stream live output for deploy, restart, update, install, and Git operations."
                >
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="deploy-feedback"
                            checked={isEnabled}
                            onCheckedChange={(v) => setEnabled(v === true)}
                        />
                        <label
                            htmlFor="deploy-feedback"
                            className="text-sm text-stat-value cursor-pointer select-none"
                        >
                            {isEnabled ? 'Enabled' : 'Disabled'}
                        </label>
                    </div>
                </SettingsField>

                <SettingsField
                    label="Diff preview before save"
                    helper="Show a side-by-side diff of compose and env edits before they reach disk."
                >
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="compose-diff-preview"
                            checked={diffPreviewEnabled}
                            onCheckedChange={(v) => setDiffPreviewEnabled(v === true)}
                        />
                        <label
                            htmlFor="compose-diff-preview"
                            className="text-sm text-stat-value cursor-pointer select-none"
                        >
                            {diffPreviewEnabled ? 'Enabled' : 'Disabled'}
                        </label>
                    </div>
                </SettingsField>
            </SettingsSection>

            <p className="font-mono text-[10px] leading-3 uppercase tracking-[0.18em] text-stat-subtitle/70">
                ⓘ saved to this browser only · every device remembers its own choice
            </p>
        </div>
    );
}
