import { useState, useEffect, useRef, Fragment } from 'react';
import type { ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast-store';
import { listStackDirectory } from '@/lib/stackFilesApi';
import type { FileEntry } from '@/lib/stackFilesApi';
import { FileTreeNode } from './FileTreeNode';

interface FileTreeProps {
  stackName: string;
  refreshKey?: number;
  selectedPath: string;
  onSelectFile: (relPath: string, entry: FileEntry) => void;
  onNavigateToCompose?: () => void;
  onNavigateToEnv?: () => void;
}

const COMPOSE_NAMES = new Set(['compose.yaml', 'compose.yml']);
const ENV_NAMES = new Set(['.env']);
const MAX_ENTRIES = 500;

export function FileTree({
  stackName,
  refreshKey,
  selectedPath,
  onSelectFile,
  onNavigateToCompose,
  onNavigateToEnv,
}: FileTreeProps) {
  const [rootEntries, setRootEntries] = useState<FileEntry[] | null>(null);
  const [rootLoading, setRootLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Map<string, FileEntry[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const stackNameRef = useRef(stackName);

  useEffect(() => {
    stackNameRef.current = stackName;
    let cancelled = false;
    setRootLoading(true);
    setError(null);
    setExpandedDirs(new Set());
    setDirContents(new Map());
    setLoadingDirs(new Set());

    listStackDirectory(stackName, '')
      .then((entries) => {
        if (!cancelled) {
          setRootEntries(entries);
          setRootLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load files.';
          setError(msg);
          setRootLoading(false);
          toast.error('Failed to load files.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [stackName, refreshKey]);

  function handleDirClick(dirRelPath: string) {
    if (expandedDirs.has(dirRelPath)) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.delete(dirRelPath);
        return next;
      });
      return;
    }

    if (dirContents.has(dirRelPath)) {
      setExpandedDirs((prev) => new Set(prev).add(dirRelPath));
      return;
    }

    setLoadingDirs((prev) => new Set(prev).add(dirRelPath));

    const capturedStackName = stackName;
    listStackDirectory(capturedStackName, dirRelPath)
      .then((entries) => {
        if (stackNameRef.current !== capturedStackName) return;
        setDirContents((prev) => {
          const next = new Map(prev);
          next.set(dirRelPath, entries);
          return next;
        });
        setExpandedDirs((prev) => new Set(prev).add(dirRelPath));
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load directory.';
        toast.error(msg);
      })
      .finally(() => {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(dirRelPath);
          return next;
        });
      });
  }

  function handleFileClick(relPath: string, entry: FileEntry) {
    if (COMPOSE_NAMES.has(entry.name)) {
      if (onNavigateToCompose) onNavigateToCompose();
      else toast.info('Open the Compose tab to edit this file.');
      return;
    }
    if (ENV_NAMES.has(entry.name)) {
      if (onNavigateToEnv) onNavigateToEnv();
      else toast.info('Open the Env tab to edit this file.');
      return;
    }
    onSelectFile(relPath, entry);
  }

  function renderEntries(entries: FileEntry[], parentRelPath: string, depth: number): ReactNode {
    const capped = entries.length > MAX_ENTRIES;
    const visible = capped ? entries.slice(0, MAX_ENTRIES) : entries;

    return (
      <>
        {visible.map((entry) => {
          const entryRelPath = parentRelPath ? `${parentRelPath}/${entry.name}` : entry.name;
          const isDir = entry.type === 'directory';
          const isExpanded = expandedDirs.has(entryRelPath);
          const isLoading = loadingDirs.has(entryRelPath);
          const children = dirContents.get(entryRelPath);

          return (
            <Fragment key={entryRelPath}>
              <FileTreeNode
                entry={entry}
                depth={depth}
                isSelected={selectedPath === entryRelPath}
                isExpanded={isExpanded}
                isLoading={isLoading}
                onClick={() => {
                  if (isDir) {
                    handleDirClick(entryRelPath);
                  } else {
                    handleFileClick(entryRelPath, entry);
                  }
                }}
              />
              {isDir && isExpanded && children !== undefined && (
                children.length === 0
                  ? (
                    <div className="text-xs text-muted-foreground pl-4 py-0.5 italic">
                      Empty folder
                    </div>
                  )
                  : renderEntries(children, entryRelPath, depth + 1)
              )}
            </Fragment>
          );
        })}
        {capped && (
          <div className="text-xs text-muted-foreground pl-4 py-0.5">
            Showing {MAX_ENTRIES} of {entries.length} - refine in shell
          </div>
        )}
      </>
    );
  }

  if (rootLoading) {
    return (
      <div className="flex flex-col gap-1.5 p-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="p-2 text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (rootEntries === null || rootEntries.length === 0) {
    return (
      <div className="p-2 text-xs text-muted-foreground italic">
        Empty folder
      </div>
    );
  }

  return (
    <ScrollArea type="hover" className="h-full">
      <div className="py-1">
        {renderEntries(rootEntries, '', 0)}
      </div>
    </ScrollArea>
  );
}
