import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { formatBytes } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { Image as ImageIcon, Copy } from 'lucide-react';

interface ImageInspect {
  Id: string;
  RepoTags?: string[] | null;
  RepoDigests?: string[] | null;
  Created: string;
  Size: number;
  Architecture?: string;
  Os?: string;
  Author?: string;
  Config?: {
    Cmd?: string[] | null;
    Entrypoint?: string[] | null;
    WorkingDir?: string;
    User?: string;
    Env?: string[] | null;
    Labels?: Record<string, string> | null;
    ExposedPorts?: Record<string, unknown> | null;
  };
  RootFS?: { Type?: string; Layers?: string[] };
}

interface ImageHistoryEntry {
  Id: string;
  Created: number;
  CreatedBy: string;
  Tags?: string[] | null;
  Size: number;
  Comment?: string;
}

interface ImageDetails {
  inspect: ImageInspect;
  history: ImageHistoryEntry[];
}

interface ImageDetailsSheetProps {
  imageId: string | null;
  onClose: () => void;
}

function formatRelativeAge(timestampSec: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestampSec;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

function shortDigest(id: string): string {
  const colon = id.indexOf(':');
  const hex = colon >= 0 ? id.slice(colon + 1) : id;
  return hex.substring(0, 12);
}

export function ImageDetailsSheet({ imageId, onClose }: ImageDetailsSheetProps) {
  const [data, setData] = useState<ImageDetails | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!imageId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);

    apiFetch(`/system/images/${encodeURIComponent(imageId)}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(res.status === 404 ? 'Image not found.' : 'Failed to load image details.');
        }
        return res.json() as Promise<ImageDetails>;
      })
      .then((details) => {
        if (!cancelled) setData(details);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load image details.';
        toast.error(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [imageId]);

  const inspect = data?.inspect;
  const history = data?.history ?? [];
  const totalLayers = history.length;

  return (
    <Sheet open={!!imageId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-lg">
        <ScrollArea className="h-full">
          <SheetHeader className="pr-8">
            <SheetTitle className="flex items-center gap-2 truncate">
              <ImageIcon className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
              <span className="truncate">{inspect?.RepoTags?.[0] || (inspect ? shortDigest(inspect.Id) : 'Image details')}</span>
            </SheetTitle>
          </SheetHeader>

          {loading && (
            <div className="space-y-3 mt-6 pr-8">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
            </div>
          )}

          {!loading && inspect && (
            <div className="space-y-6 mt-6 pb-6 pr-8">
              <Section title="Overview">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="ID">
                    <p className="font-mono text-xs mt-0.5 flex items-center gap-1.5">
                      {shortDigest(inspect.Id)}
                      <button
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={async () => {
                          try { await copyToClipboard(inspect.Id); toast.success('ID copied'); }
                          catch { toast.error('Copy failed.'); }
                        }}
                        aria-label="Copy image ID"
                      >
                        <Copy className="w-3 h-3" strokeWidth={1.5} />
                      </button>
                    </p>
                  </Field>
                  <Field label="Size">
                    <p className="font-mono text-xs mt-0.5 tabular-nums">{formatBytes(inspect.Size)}</p>
                  </Field>
                  <Field label="Created">
                    <p className="text-xs mt-0.5" title={new Date(inspect.Created).toLocaleString()}>
                      {new Date(inspect.Created).toLocaleDateString()}
                    </p>
                  </Field>
                  <Field label="Arch / OS">
                    <p className="text-xs mt-0.5">
                      <Badge variant="outline" className="text-[10px] h-5">{inspect.Architecture ?? 'unknown'} / {inspect.Os ?? 'unknown'}</Badge>
                    </p>
                  </Field>
                  {inspect.Author && (
                    <Field label="Author" span={2}>
                      <p className="text-xs mt-0.5">{inspect.Author}</p>
                    </Field>
                  )}
                  {inspect.RepoTags && inspect.RepoTags.length > 0 && (
                    <Field label="Tags" span={2}>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {inspect.RepoTags.map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px] h-5 font-mono">{t}</Badge>
                        ))}
                      </div>
                    </Field>
                  )}
                </div>
              </Section>

              {inspect.Config && (
                <Section title="Config">
                  <div className="space-y-2 text-sm">
                    <ConfigRow label="Cmd" value={inspect.Config.Cmd?.join(' ')} />
                    <ConfigRow label="Entrypoint" value={inspect.Config.Entrypoint?.join(' ')} />
                    <ConfigRow label="WorkingDir" value={inspect.Config.WorkingDir} />
                    <ConfigRow label="User" value={inspect.Config.User} />
                    <ConfigRow
                      label="Ports"
                      value={
                        inspect.Config.ExposedPorts
                          ? Object.keys(inspect.Config.ExposedPorts).join(', ')
                          : undefined
                      }
                    />
                    {inspect.Config.Env && inspect.Config.Env.length > 0 && (
                      <CollapsibleList label="Env" count={inspect.Config.Env.length} items={inspect.Config.Env} />
                    )}
                    {inspect.Config.Labels && Object.keys(inspect.Config.Labels).length > 0 && (
                      <CollapsibleList
                        label="Labels"
                        count={Object.keys(inspect.Config.Labels).length}
                        items={Object.entries(inspect.Config.Labels).map(([k, v]) => `${k}=${v}`)}
                      />
                    )}
                  </div>
                </Section>
              )}

              <Section title={`Layers (${totalLayers})`}>
                {totalLayers === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No layer history available.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {history.map((h, idx) => {
                      const empty = h.Size === 0;
                      return (
                        <li
                          key={`${h.Id}-${idx}`}
                          className={`rounded-md border border-card-border bg-card px-3 py-2 shadow-card-bevel ${empty ? 'opacity-60' : ''}`}
                        >
                          <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground tabular-nums">
                            <span>#{totalLayers - idx}</span>
                            <span className="font-mono">{formatBytes(h.Size)}</span>
                            <span>{formatRelativeAge(h.Created)}</span>
                          </div>
                          <p
                            className="font-mono text-[11px] mt-1 break-all"
                            title={h.CreatedBy}
                          >
                            {h.CreatedBy || '(no command)'}
                          </p>
                          {h.Comment && (
                            <p className="text-[11px] text-muted-foreground italic mt-0.5">{h.Comment}</p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</h4>
      {children}
    </div>
  );
}

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: 1 | 2 }) {
  return (
    <div className={span === 2 ? 'col-span-2' : undefined}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3 items-baseline">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] break-all">{value}</span>
    </div>
  );
}

function CollapsibleList({ label, count, items }: { label: string; count: number; items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3 items-baseline">
      <span className="text-xs text-muted-foreground">{label} ({count})</span>
      <div>
        <button
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
        {open && (
          <ol className="mt-1.5 space-y-0.5">
            {items.map((item, i) => (
              <li key={i} className="font-mono text-[11px] break-all">{item}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
