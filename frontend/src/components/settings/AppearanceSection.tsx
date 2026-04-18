import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { useDensity } from '@/hooks/use-density';
import type { Density } from '@/hooks/use-density';

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

    return (
        <div className="space-y-6">
            <div className="space-y-4 bg-glass border border-glass-border p-4 rounded-lg">
                <div className="space-y-2">
                    <Label htmlFor="density-select">Density</Label>
                    <Combobox
                        options={DENSITY_OPTIONS}
                        value={density}
                        onValueChange={(v) => {
                            if (v === 'comfortable' || v === 'compact') setDensity(v);
                        }}
                        placeholder="Select density"
                    />
                    <p className="text-xs text-stat-subtitle">
                        {DENSITY_DESCRIPTIONS[density]}
                    </p>
                </div>
            </div>
            <p className="text-xs text-stat-subtitle">
                Preference is saved to this browser only. Each device you use remembers its own choice.
            </p>
        </div>
    );
}
