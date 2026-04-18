import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TemplateLogo, firstSentence } from './TemplateLogo';
import type { Template, ScanStatus } from './types';

interface TemplateTileProps {
  template: Template;
  onSelect: (t: Template) => void;
  imgError: boolean;
  onImgError: () => void;
}

function ScanBadge({ status, cveCount }: { status: ScanStatus; cveCount: number }) {
  if (status === 'clean') {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-success">
        Clean
      </span>
    );
  }
  if (status === 'vulnerable') {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-warning tabular-nums">
        {cveCount} CVE{cveCount === 1 ? '' : 's'}
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
      Unscanned
    </span>
  );
}

export function TemplateTile({ template, onSelect, imgError, onImgError }: TemplateTileProps) {
  const status: ScanStatus = template.scan_status ?? 'unscanned';
  const cveCount = template.scan_cve_count ?? 0;
  const pitch = firstSentence(template.description);

  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className={cn(
        'group relative grid grid-cols-[36px_1fr_auto] items-start gap-3 rounded-md border border-card-border border-t-card-border-top bg-card px-3 py-3 text-left shadow-card-bevel transition-colors',
        'hover:border-t-card-border-hover',
      )}
    >
      <TemplateLogo
        logo={template.logo}
        title={template.title}
        size="sm"
        imgError={imgError}
        onImgError={onImgError}
      />

      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium text-stat-value truncate">{template.title}</span>
        {pitch ? (
          <span className="text-xs text-stat-subtitle line-clamp-1">{pitch}.</span>
        ) : null}
        <div className="flex items-center gap-3 pt-1">
          {typeof template.stars === 'number' && template.stars > 0 ? (
            <span className="flex items-center gap-1 text-[10px] text-stat-subtitle tabular-nums font-mono">
              <Star className="h-3 w-3 fill-warning text-warning" strokeWidth={1.5} />
              {template.stars.toLocaleString()}
            </span>
          ) : null}
          {template.categories?.[0] ? (
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-stat-subtitle/80 truncate">
              {template.categories[0]}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-start pt-0.5">
        <ScanBadge status={status} cveCount={cveCount} />
      </div>
    </button>
  );
}
