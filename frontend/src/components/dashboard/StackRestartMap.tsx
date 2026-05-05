import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { useStackRestartMap } from './useStackRestartMap';
import type { StackRestartSummary } from './useStackRestartMap';

type DominantCategory = 'crash' | 'autoheal' | 'manual';

function dominantCategory(entry: StackRestartSummary): DominantCategory {
  if (entry.crash >= entry.autoheal && entry.crash >= entry.manual) return 'crash';
  if (entry.autoheal >= entry.manual) return 'autoheal';
  return 'manual';
}

const CATEGORY_LABELS: Record<DominantCategory, string> = {
  crash: 'crash',
  autoheal: 'auto-heal',
  manual: 'manual',
};

const CATEGORY_CLASSES: Record<DominantCategory, string> = {
  crash: 'border-destructive/30 bg-destructive/10 text-destructive',
  autoheal: 'border-success/30 bg-success/10 text-success',
  manual: 'border-brand/30 bg-brand/10 text-brand',
};

const CATEGORY_BAR_CLASSES: Record<DominantCategory, string> = {
  crash: 'bg-destructive/50',
  autoheal: 'bg-success/50',
  manual: 'bg-brand/50',
};

function CategoryBadge({ category }: { category: DominantCategory }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-mono tracking-wide uppercase shrink-0 ${CATEGORY_CLASSES[category]}`}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-2.5 py-1.5 px-1">
      <div className="h-3 w-20 rounded-sm bg-accent/10 animate-pulse" />
      <div className="h-3 flex-1 rounded-sm bg-accent/10 animate-pulse" />
      <div className="h-3 w-8 rounded-sm bg-accent/10 animate-pulse shrink-0" />
    </div>
  );
}

export function StackRestartMap() {
  const { restarts, loading, error } = useStackRestartMap();

  if (loading) {
    return (
      <Card className="bg-card shadow-card-bevel">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-stat-title">Stack Restarts (7d)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-0.5">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-card shadow-card-bevel">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-stat-title">Stack Restarts (7d)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-stat-subtitle py-4 text-center">Unable to load restart data.</p>
        </CardContent>
      </Card>
    );
  }

  const withRestarts = restarts.filter(s => s.total > 0);
  const stableCount = restarts.length - withRestarts.length;
  const maxTotal = withRestarts.reduce((m, s) => Math.max(m, s.total), 1);

  return (
    <Card className="bg-card shadow-card-bevel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-stat-title">Stack Restarts (7d)</CardTitle>
          <RotateCcw className="h-3.5 w-3.5 text-stat-icon" strokeWidth={1.5} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {withRestarts.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-stat-subtitle">
            <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.5} />
            <span className="text-sm">No restarts in the last 7 days.</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {withRestarts.map(entry => {
              const category = dominantCategory(entry);
              const barWidth = Math.round((entry.total / maxTotal) * 100);
              return (
                <div key={entry.stackName} className="space-y-0.5 py-0.5 px-1 rounded-sm hover:bg-accent/5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-stat-value truncate flex-1">
                      {entry.stackName}
                    </span>
                    <CategoryBadge category={category} />
                    <span className="text-xs font-mono tabular-nums text-stat-subtitle shrink-0 min-w-[2rem] text-right">
                      {entry.total}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-accent/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${CATEGORY_BAR_CLASSES[category]}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {stableCount > 0 && (
              <div className="flex items-center gap-2 py-1.5 px-1 mt-1 border-t border-card-border">
                <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" strokeWidth={1.5} />
                <span className="text-xs text-stat-subtitle">
                  {stableCount} stack{stableCount !== 1 ? 's' : ''} stable
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
