import { useState, useEffect, useCallback } from 'react';
import { Trash2, FolderPlus, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast-store';
import { useLicense } from '@/context/LicenseContext';
import { downloadStackFile } from '@/lib/stackFilesApi';
import { FileTree } from './FileTree';
import { FileViewer } from './FileViewer';
import { FileUploadDropzone } from './FileUploadDropzone';
import { NewFolderDialog } from './NewFolderDialog';
import { DeleteFileConfirm } from './DeleteFileConfirm';
import type { FileEntry } from '@/lib/stackFilesApi';

interface StackFileExplorerProps {
  stackName: string;
  canEdit: boolean;
  isDarkMode: boolean;
  onNavigateToCompose?: () => void;
  onNavigateToEnv?: () => void;
}

export function StackFileExplorer({
  stackName,
  canEdit,
  isDarkMode,
  onNavigateToCompose,
  onNavigateToEnv,
}: StackFileExplorerProps) {
  const { isPaid } = useLicense();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);
  const [currentDir, setCurrentDir] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    setSelectedPath(null);
    setSelectedEntry(null);
    setCurrentDir('');
  }, [stackName]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleSelectFile = useCallback((relPath: string, entry: FileEntry) => {
    setSelectedPath(relPath);
    setSelectedEntry(entry);
    const parts = relPath.split('/');
    parts.pop();
    setCurrentDir(parts.join('/'));
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedPath(null);
    setSelectedEntry(null);
    refresh();
  }, [refresh]);

  const handleDownload = async () => {
    if (!selectedPath) return;
    setIsDownloading(true);
    try {
      const res = await downloadStackFile(stackName, selectedPath);
      if (!res.ok) {
        toast.error('Download failed.');
        return;
      }
      const blob = await res.blob();
      const filename = selectedPath.split('/').pop() ?? selectedPath;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Left pane: tree + upload + new folder */}
      <div className="flex flex-col w-56 shrink-0 border-r border-glass-border min-h-0">
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-glass-border shrink-0">
          <div className="flex-1 min-w-0">
            <FileUploadDropzone
              stackName={stackName}
              currentDir={currentDir}
              onUploaded={refresh}
            />
          </div>
          {isPaid && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              title="New folder"
              onClick={() => setNewFolderOpen(true)}
            >
              <FolderPlus className="w-3.5 h-3.5" strokeWidth={1.5} />
            </Button>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <FileTree
            stackName={stackName}
            refreshKey={refreshKey}
            selectedPath={selectedPath ?? ''}
            onSelectFile={handleSelectFile}
            onNavigateToCompose={onNavigateToCompose}
            onNavigateToEnv={onNavigateToEnv}
          />
        </div>
      </div>

      {/* Right pane: action bar + viewer */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0">
        {selectedPath !== null && isPaid && (
          <div className="flex items-center justify-end gap-1 px-2 py-1 border-b border-glass-border shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => void handleDownload()}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" strokeWidth={1.5} />
              ) : (
                <Download className="w-3.5 h-3.5 mr-1" strokeWidth={1.5} />
              )}
              Download
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" strokeWidth={1.5} />
              Delete
            </Button>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <FileViewer
            stackName={stackName}
            selectedPath={selectedPath}
            canEdit={canEdit}
            isDarkMode={isDarkMode}
            onSaved={refresh}
          />
        </div>
      </div>

      <DeleteFileConfirm
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        stackName={stackName}
        relPath={selectedPath ?? ''}
        entry={selectedEntry}
        onDeleted={handleDeleted}
      />

      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        stackName={stackName}
        currentDir={currentDir}
        onCreated={refresh}
      />
    </div>
  );
}
