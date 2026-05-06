import type { ReactNode } from 'react';
import { FilePlus, FolderPlus, Pencil, Lock, Trash2 } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { FileEntry } from '@/lib/stackFilesApi';

interface FileTreeContextMenuProps {
  entry: FileEntry;
  relPath: string;
  canEdit: boolean;
  isPaid: boolean;
  onRequestRename: (relPath: string) => void;
  onRequestNewFile: (dirRelPath: string) => void;
  onRequestNewFolder: (dirRelPath: string) => void;
  onRequestDelete: (relPath: string, entry: FileEntry) => void;
  onRequestPermissions: (relPath: string, entry: FileEntry) => void;
  children: ReactNode;
}

export function FileTreeContextMenu({
  entry,
  relPath,
  canEdit,
  isPaid,
  onRequestRename,
  onRequestNewFile,
  onRequestNewFolder,
  onRequestDelete,
  onRequestPermissions,
  children,
}: FileTreeContextMenuProps) {
  const isDir = entry.type === 'directory';

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[180px]">
        {isDir ? (
          <>
            {isPaid && (
              <>
                <ContextMenuItem
                  onSelect={() => onRequestNewFile(relPath)}
                >
                  <FilePlus className="h-4 w-4 mr-2" strokeWidth={1.5} />
                  <span>New File</span>
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => onRequestNewFolder(relPath)}
                >
                  <FolderPlus className="h-4 w-4 mr-2" strokeWidth={1.5} />
                  <span>New Folder</span>
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            {canEdit && (
              <ContextMenuItem onSelect={() => onRequestRename(relPath)}>
                <Pencil className="h-4 w-4 mr-2" strokeWidth={1.5} />
                <span>Rename</span>
              </ContextMenuItem>
            )}
            {canEdit && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() => onRequestDelete(relPath, entry)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" strokeWidth={1.5} />
                  <span>Delete</span>
                </ContextMenuItem>
              </>
            )}
          </>
        ) : (
          <>
            {canEdit && (
              <ContextMenuItem onSelect={() => onRequestRename(relPath)}>
                <Pencil className="h-4 w-4 mr-2" strokeWidth={1.5} />
                <span>Rename</span>
              </ContextMenuItem>
            )}
            <ContextMenuItem onSelect={() => onRequestPermissions(relPath, entry)}>
              <Lock className="h-4 w-4 mr-2" strokeWidth={1.5} />
              <span>Permissions</span>
            </ContextMenuItem>
            {canEdit && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() => onRequestDelete(relPath, entry)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" strokeWidth={1.5} />
                  <span>Delete</span>
                </ContextMenuItem>
              </>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
