import { Button } from '@/components/ui/button';
import { Rocket } from 'lucide-react';
import { TemplateLogo, firstSentence } from './TemplateLogo';
import type { Template } from './types';

interface FeaturedHeroProps {
  template: Template;
  category?: string;
  onOpen: (t: Template) => void;
  imgError: boolean;
  onImgError: () => void;
}

export function FeaturedHero({ template, category, onOpen, imgError, onImgError }: FeaturedHeroProps) {
  const pitch = firstSentence(template.description);

  return (
    <div className="relative overflow-hidden rounded-lg border border-brand/25 border-t-brand/35 bg-card shadow-card-bevel">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand/[0.10] via-brand/[0.02] to-transparent" />
      <div className="absolute inset-y-0 left-0 w-[3px] bg-brand" />
      <div className="relative grid grid-cols-[80px_1fr_auto] items-center gap-5 py-5 pl-7 pr-6">
        <TemplateLogo
          logo={template.logo}
          title={template.title}
          size="lg"
          imgError={imgError}
          onImgError={onImgError}
        />

        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
            Featured{category ? ` · ${category}` : ''}
          </span>
          <span className="font-display italic text-3xl leading-tight tracking-tight text-stat-value truncate">
            {template.title}
          </span>
          {pitch ? (
            <span className="text-sm text-stat-subtitle/90 line-clamp-1">
              {pitch}.
            </span>
          ) : null}
        </div>

        <div className="flex items-center">
          <Button
            className="gap-2"
            onClick={() => onOpen(template)}
          >
            <Rocket className="h-4 w-4" strokeWidth={1.5} />
            Deploy
          </Button>
        </div>
      </div>
    </div>
  );
}
