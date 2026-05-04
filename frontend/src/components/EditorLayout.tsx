import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';

import type { NotificationItem } from './dashboard/types';
import BashExecModal from './BashExecModal';
import LazyBoundary from './LazyBoundary';
import { Button } from './ui/button';
import { Plus } from 'lucide-react';
import { type Label as StackLabel, type LabelColor } from './label-types';
import { UserProfileDropdown } from './UserProfileDropdown';
import { NotificationPanel } from './NotificationPanel';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { PolicyBlockDialog, type PolicyBlockPayload } from './stack/PolicyBlockDialog';
import { TopBar } from './TopBar';
import { ViewRouter } from './EditorLayout/ViewRouter';
import { CreateStackDialog } from './EditorLayout/CreateStackDialog';
import { DeleteStackDialog } from './EditorLayout/DeleteStackDialog';
import { UnsavedChangesDialog } from './EditorLayout/UnsavedChangesDialog';
import { EditorView, type StackAction } from './EditorLayout/EditorView';
import { useEditorViewState } from './EditorLayout/hooks/useEditorViewState';
import { useStackListState } from './EditorLayout/hooks/useStackListState';
import { useViewNavigationState } from './EditorLayout/hooks/useViewNavigationState';
import { useTheme } from './EditorLayout/hooks/useTheme';
import { useNotifications } from './EditorLayout/hooks/useNotifications';
import { useContainerStats } from './EditorLayout/hooks/useContainerStats';
import { StackAlertSheet } from './StackAlertSheet';
import { StackAutoHealSheet } from '@/components/StackAutoHealSheet';
import { GitSourcePanel } from './stack/GitSourcePanel';
import { LogViewer } from './LogViewer';

// SecurityHistoryView is the only lazy-loaded view that lives outside
// the ViewRouter switch — it renders as an overlay sheet wired into the
// settings flow, not as a top-level tab. The other tab-level lazy views
// (HostConsole, FleetView, AuditLogView, etc.) live inside ViewRouter.
const SecurityHistoryView = lazy(() =>
    import('./SecurityHistoryView').then(m => ({ default: m.SecurityHistoryView })),
);
import { NodeSwitcher } from './NodeSwitcher';
import {
    GlobalCommandPalette,
    GlobalCommandPaletteProvider,
    GlobalCommandPaletteTrigger,
} from './GlobalCommandPalette';
import { SENCHO_OPEN_LOGS_EVENT } from '@/lib/events';
import type { SenchoOpenLogsDetail } from '@/lib/events';
import { useNodes } from '@/context/NodeContext';
import type { Node } from '@/context/NodeContext';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { useDeployFeedback } from '@/context/DeployFeedbackContext';
import { useTrivyStatus } from '@/hooks/useTrivyStatus';
import { VulnerabilityScanSheet } from './VulnerabilityScanSheet';
import { StackSidebar } from '@/components/sidebar/StackSidebar';
import type { StackRowStatus } from '@/components/sidebar/stack-status-utils';
import type { StackMenuCtx } from '@/components/sidebar/sidebar-types';
import { useComposeDiffPreviewEnabled } from '@/hooks/use-compose-diff-preview-enabled';
import { ComposeDiffPreviewDialog } from '@/components/ComposeDiffPreviewDialog';

export default function EditorLayout() {
  const { isAdmin, can } = useAuth();
  const { isPaid, license } = useLicense();
  const { status: trivy } = useTrivyStatus();
  const { runWithLog } = useDeployFeedback();
  const {
    stackMisconfigScanning, setStackMisconfigScanning,
    copiedDigest, setCopiedDigest,
    copiedDigestTimerRef,
    content, setContent,
    originalContent, setOriginalContent,
    envContent, setEnvContent,
    originalEnvContent, setOriginalEnvContent,
    envExists, setEnvExists,
    envFiles, setEnvFiles,
    selectedEnvFile, setSelectedEnvFile,
    containers, setContainers,
    activeTab, setActiveTab,
    logsMode, setLogsMode,
    gitSourceOpen, setGitSourceOpen,
    gitSourcePendingMap, setGitSourcePendingMap,
    isFileLoading, setIsFileLoading,
    backupInfo, setBackupInfo,
    isEditing, setIsEditing,
    editingCompose, setEditingCompose,
  } = useEditorViewState();
  const {
    files,
    selectedFile, setSelectedFile,
    isLoading,
    stackActions,
    isScanning,
    searchQuery, setSearchQuery,
    stackStatuses,
    stackPorts,
    labels,
    stackLabelMap,
    autoUpdateSettings, setAutoUpdateSettings,
    filterChip, setFilterChip,
    bulkMode,
    selectedFiles,
    filterCounts,
    chipFilteredFiles,
    remoteResults,
    setStackAction, clearStackAction, isStackBusy,
    setOptimisticStatus,
    refreshLabels,
    refreshStacks,
    fetchAutoUpdateSettings,
    handleScanStacks,
    scheduleStateInvalidateRefresh,
    toggleBulkMode, toggleSelect, clearSelection, handleBulkAction,
    stackUpdates, fetchImageUpdates,
    pinned, pin, unpin, isPinned,
    isCollapsed, toggleCollapse,
    remoteSearchLoading,
  } = useStackListState();
  const [stackMisconfigScanId, setStackMisconfigScanId] = useState<number | null>(null);
  const [policyBlock, setPolicyBlock] = useState<{ stackName: string; payload: PolicyBlockPayload } | null>(null);
  const [policyBypassing, setPolicyBypassing] = useState(false);
  const { nodes, activeNode, setActiveNode } = useNodes();
  const monacoEditorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);
  const pendingStackLoadRef = useRef<string | null>(null);
  const pendingLogsRef = useRef<{ stackName: string; containerName: string } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [stackToDelete, setStackToDelete] = useState<string | null>(null);
  const [pendingUnsavedLoad, setPendingUnsavedLoad] = useState<string | null>(null);
  const [pendingUnsavedNode, setPendingUnsavedNode] = useState<Node | null>(null);
  const getStackMenuVisibility = (file: string) => {
    const status = stackStatuses[file];
    return {
      showDeploy: status !== 'running',
      showStop: status === 'running',
      showRestart: status === 'running',
      showUpdate: status === 'running',
    };
  };

  const openStackApp = (file: string) => {
    const port = stackPorts[file];
    if (!port) return;
    const host = activeNode?.type === 'remote' && activeNode?.api_url
      ? new URL(activeNode.api_url).hostname
      : window.location.hostname;
    window.open(`http://${host}:${port}`, '_blank');
  };

  const loadingAction = selectedFile ? (stackActions[selectedFile] ?? null) : null;

  const { theme, setTheme, isDarkMode } = useTheme();
  const [diffPreviewEnabled] = useComposeDiffPreviewEnabled();
  const [diffPreview, setDiffPreview] = useState<{
    mode: 'save' | 'save-and-deploy';
    language: 'yaml' | 'ini';
    original: string;
    modified: string;
    fileName: string;
  } | null>(null);
  const [diffPreviewConfirming, setDiffPreviewConfirming] = useState(false);
  // Bash exec modal state
  const [bashModalOpen, setBashModalOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<{ id: string; name: string } | null>(null);

  // LogViewer state
  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [logContainer, setLogContainer] = useState<{ id: string; name: string } | null>(null);


  const resetEditorState = () => {
    setSelectedFile(null);
    setContent('');
    setOriginalContent('');
    setEnvContent('');
    setOriginalEnvContent('');
    setEnvFiles([]);
    setSelectedEnvFile('');
    setEnvExists(false);
    setContainers([]);
    setIsEditing(false);
  };

  const {
    activeView, setActiveView,
    settingsSection, setSettingsSection,
    securityHistoryOpen, setSecurityHistoryOpen,
    filterNodeId, setFilterNodeId,
    schedulePrefill, setSchedulePrefill,
    mobileNavOpen, setMobileNavOpen,
    handleOpenSettings,
    handlePrefillConsumed,
    handleNavigate,
    navItems,
  } = useViewNavigationState({ onNavigateToDashboard: resetEditorState });

  const isAdmiral = license?.variant === 'admiral';

  const {
    notifications,
    tickerConnected,
    markAllRead,
    deleteNotification,
    clearAllNotifications,
  } = useNotifications({
    nodes,
    onStateInvalidate: scheduleStateInvalidateRefresh,
    onAutoUpdateChange: fetchAutoUpdateSettings,
  });

  const containerStats = useContainerStats(containers);
  const [alertSheetOpen, setAlertSheetOpen] = useState(false);
  const [alertSheetStack, setAlertSheetStack] = useState('');
  const [autoHealStackName, setAutoHealStackName] = useState<string | null>(null);

  const openAlertSheet = (stackName: string) => {
    setAlertSheetStack(stackName);
    setAlertSheetOpen(true);
  };

  // Force Monaco to re-measure its container after the tab switch DOM settles.
  // Monaco's internal child is position:static with an explicit pixel height that
  // creates a circular CSS dependency (Monaco drives card height → grid height → Monaco).
  // Fix: reset Monaco to 0×0 first (breaks the cycle), then trigger a forced synchronous
  // reflow so the container has its CSS-correct size before Monaco re-measures.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const editor = monacoEditorRef.current;
      if (!editor) return;
      editor.layout({ width: 0, height: 0 }); // collapse → breaks CSS circular dependency
      editor.layout();                          // forced reflow → measures correct container size
    });
    return () => cancelAnimationFrame(id);
  }, [activeTab]);

  /**
   * Populate the per-stack "pending git source update" map. Runs on mount and
   * whenever a git-source change is signalled by the panel. Backend failure
   * leaves the map empty, which is the correct fallback (no badges shown).
   */
  const refreshGitSourcePending = async () => {
    try {
      const res = await apiFetch('/git-sources');
      if (!res.ok) return;
      const sources: Array<{ stack_name: string; pending_commit_sha: string | null }> = await res.json();
      const map: Record<string, boolean> = {};
      for (const s of sources) {
        if (s.pending_commit_sha) map[s.stack_name] = true;
      }
      setGitSourcePendingMap(map);
    } catch {
      // Non-critical; leave prior state.
    }
  };

  // Re-fetch stacks whenever the active node changes (or becomes available on mount).
  // Also clears any stale editor/container state that belonged to the previous node.
  useEffect(() => {
    if (!activeNode) return;
    const pendingStack = pendingStackLoadRef.current;
    pendingStackLoadRef.current = null;

    setSelectedFile(null);
    setContent('');
    setOriginalContent('');
    setEnvContent('');
    setOriginalEnvContent('');
    setContainers([]);
    setIsEditing(false);

    if (pendingStack) {
      loadFile(pendingStack);
    } else {
      setActiveView('dashboard');
    }

    refreshStacks();
    // Image-update fetching + 5-minute poll are owned by useImageUpdates,
    // which mirrors this effect's activeNode.id dependency.
    fetchAutoUpdateSettings();
    refreshGitSourcePending();
  }, [activeNode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve a pending container name (from notification click) to a live
  // container id once the target stack's container list loads, then dispatch
  // the logs event. Only consume when the current stack matches the pending
  // target — prevents a canceled unsaved-load from leaking the pending name
  // into an unrelated container refresh. Container ids churn across
  // recreations, so we store the name and resolve here instead of storing an
  // id at dispatch time.
  useEffect(() => {
    const pending = pendingLogsRef.current;
    if (!pending || selectedFile !== pending.stackName || containers.length === 0) return;
    pendingLogsRef.current = null;
    const match = containers.find(c =>
      (c.Names ?? []).some(n => n.replace(/^\//, '') === pending.containerName),
    );
    if (match) {
      window.dispatchEvent(new CustomEvent<SenchoOpenLogsDetail>(SENCHO_OPEN_LOGS_EVENT, {
        detail: { containerId: match.Id, containerName: pending.containerName },
      }));
    }
  }, [containers, selectedFile]);

  const hasUnsavedChanges = () =>
    content !== originalContent || envContent !== originalEnvContent;

  // Global-search result click: switch the active node, clear the query so the
  // sidebar snaps back to the new node's full stack list, then open the stack.
  // setActiveNode writes to localStorage synchronously, so the next apiFetch
  // picks up the new node-id header without waiting for a re-render.
  const loadFileOnNode = async (node: Node, filename: string) => {
    if (!filename) return;
    if (selectedFile && filename !== selectedFile && hasUnsavedChanges()) {
      setPendingUnsavedNode(node);
      setPendingUnsavedLoad(filename);
      return;
    }
    setActiveNode(node);
    setSearchQuery('');
    await loadFile(filename);
  };

  const loadFile = async (filename: string) => {
    if (!filename) return;
    // Guard: if there are unsaved changes and we're switching to a different stack, confirm first
    if (selectedFile && filename !== selectedFile && hasUnsavedChanges()) {
      setPendingUnsavedLoad(filename);
      return;
    }
    setIsFileLoading(true);
    setIsEditing(false); // Reset to view mode when loading a new file
    setEditingCompose(false); // Default back to anatomy on stack switch
    setActiveTab('compose');
    try {
      const res = await apiFetch(`/stacks/${filename}`);
      const text = await res.text();
      setSelectedFile(filename);
      setActiveView('editor');
      setContent(text || '');
      setOriginalContent(text || '');

      // Load env files
      try {
        const envsRes = await apiFetch(`/stacks/${filename}/envs`);
        if (envsRes.ok) {
          const { envFiles } = await envsRes.json();
          if (envFiles && envFiles.length > 0) {
            setEnvFiles(envFiles);
            const firstFile = envFiles[0];
            setSelectedEnvFile(firstFile);
            setEnvExists(true);

            // Load specific env file content
            const envContentRes = await apiFetch(`/stacks/${filename}/env?file=${encodeURIComponent(firstFile)}`);
            if (envContentRes.ok) {
              const envText = await envContentRes.text();
              setEnvContent(envText || '');
              setOriginalEnvContent(envText || '');
            } else {
              setEnvContent('');
              setOriginalEnvContent('');
            }
          } else {
            setEnvFiles([]);
            setSelectedEnvFile('');
            setEnvContent('');
            setOriginalEnvContent('');
            setEnvExists(false);
          }
        } else {
          setEnvFiles([]);
          setSelectedEnvFile('');
          setEnvContent('');
          setOriginalEnvContent('');
          setEnvExists(false);
        }
      } catch {
        setEnvFiles([]);
        setSelectedEnvFile('');
        setEnvContent('');
        setOriginalEnvContent('');
        setEnvExists(false);
      }

      // Load containers
      try {
        const containersRes = await apiFetch(`/stacks/${filename}/containers`);
        const conts = await containersRes.json();
        setContainers(Array.isArray(conts) ? conts : []);
      } catch (error) {
        console.error('Failed to load containers:', error);
        setContainers([]);
      }

      // Load backup info (Skipper+ only)
      if (isPaid) {
        try {
          const backupRes = await apiFetch(`/stacks/${filename}/backup`);
          if (backupRes.ok) setBackupInfo(await backupRes.json());
          else setBackupInfo({ exists: false, timestamp: null });
        } catch {
          setBackupInfo({ exists: false, timestamp: null });
        }
      }
    } catch (error) {
      console.error('Failed to load file:', error);
      setSelectedFile(null);
      setContent('');
      setOriginalContent('');
      setEnvContent('');
      setOriginalEnvContent('');
      setContainers([]);
    } finally {
      setIsFileLoading(false);
    }
  };

  const navigateToNotification = (notif: NotificationItem) => {
    if (!notif.stack_name) return;
    pendingLogsRef.current = notif.container_name
      ? { stackName: notif.stack_name, containerName: notif.container_name }
      : null;
    const targetNode = notif.nodeId !== undefined
      ? nodes.find(n => n.id === notif.nodeId)
      : activeNode;
    if (targetNode && targetNode.id !== activeNode?.id) {
      loadFileOnNode(targetNode, notif.stack_name);
    } else {
      loadFile(notif.stack_name);
    }
  };

  const changeEnvFile = async (file: string) => {
    setSelectedEnvFile(file);
    setIsFileLoading(true);
    try {
      const res = await apiFetch(`/stacks/${selectedFile}/env?file=${encodeURIComponent(file)}`);
      if (!res.ok) {
        // Don't stuff a JSON error body into the editor on a non-OK response.
        setEnvContent('');
        setOriginalEnvContent('');
        toast.error('Could not load env file');
        return;
      }
      const text = await res.text();
      setEnvContent(text || '');
      setOriginalEnvContent(text || '');
    } catch (e) {
      console.error('Failed to switch env file', e);
      setEnvContent('');
      setOriginalEnvContent('');
    } finally {
      setIsFileLoading(false);
    }
  };

  const saveFile = async () => {
    if (activeTab === 'files') return;
    if (!selectedFile) return;
    const currentContent = activeTab === 'compose' ? (content || '') : (envContent || '');
    const endpoint = activeTab === 'compose' ? `/stacks/${selectedFile}` : `/stacks/${selectedFile}/env?file=${encodeURIComponent(selectedEnvFile)}`;
    try {
      const response = await apiFetch(endpoint, {
        method: 'PUT',
        body: JSON.stringify({ content: currentContent }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      // Update original content after save
      if (activeTab === 'compose') {
        setOriginalContent(content);
      } else {
        setOriginalEnvContent(envContent);
      }
      setIsEditing(false);
      toast.success('File saved successfully!');
    } catch (error) {
      console.error('Failed to save file:', error);
      toast.error(`Failed to save file: ${(error as Error).message}`);
    }
  };

  const requestSave = () => {
    const isCompose = activeTab === 'compose';
    const orig = isCompose ? originalContent : originalEnvContent;
    const curr = isCompose ? content : envContent;
    if (diffPreviewEnabled && activeTab !== 'files' && curr !== orig) {
      setDiffPreview({
        mode: 'save',
        language: isCompose ? 'yaml' : 'ini',
        original: orig,
        modified: curr,
        fileName: isCompose ? 'compose.yaml' : (selectedEnvFile || '.env'),
      });
    } else {
      void saveFile();
    }
  };

  const requestSaveAndDeploy = (e: React.MouseEvent) => {
    const isCompose = activeTab === 'compose';
    const orig = isCompose ? originalContent : originalEnvContent;
    const curr = isCompose ? content : envContent;
    if (diffPreviewEnabled && activeTab !== 'files' && curr !== orig) {
      setDiffPreview({
        mode: 'save-and-deploy',
        language: isCompose ? 'yaml' : 'ini',
        original: orig,
        modified: curr,
        fileName: isCompose ? 'compose.yaml' : (selectedEnvFile || '.env'),
      });
    } else {
      void handleSaveAndDeploy(e);
    }
  };

  const rollbackStack = async () => {
    if (!selectedFile || isStackBusy(selectedFile)) return;
    const stackFile = selectedFile;
    setStackAction(stackFile, 'rollback');
    setOptimisticStatus(stackFile, 'running');
    try {
      const res = await apiFetch(`/stacks/${stackFile}/rollback`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Rollback failed');
      }
      toast.success('Stack rolled back successfully.');
      // Reload the editor content
      const contentRes = await apiFetch(`/stacks/${stackFile}`);
      const text = await contentRes.text();
      setContent(text || '');
      setOriginalContent(text || '');
      // Refresh backup info
      const backupRes = await apiFetch(`/stacks/${stackFile}/backup`);
      if (backupRes.ok) setBackupInfo(await backupRes.json());
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Rollback failed';
      toast.error(msg);
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const handleSaveAndDeploy = async (e: React.MouseEvent) => {
    await saveFile();
    await deployStack(e);
  };

  const discardChanges = () => {
    if (activeTab === 'files') return;
    if (activeTab === 'compose') {
      setContent(originalContent);
    } else {
      setEnvContent(originalEnvContent);
    }
    setIsEditing(false);
  };

  const enterEditMode = () => {
    setIsEditing(true);
  };

  const scanStackConfig = async () => {
    if (!selectedFile || stackMisconfigScanning) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    setStackMisconfigScanning(true);
    const loadingId = toast.loading(`Scanning ${stackName} configuration...`);
    try {
      const res = await apiFetch('/security/scan/stack', {
        method: 'POST',
        body: JSON.stringify({ stackName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to start scan');
      if (data.status === 'failed') {
        throw new Error(data.error || 'Scan failed');
      }
      toast.success(
        `Config scan complete: ${data.misconfig_count ?? 0} misconfigurations found`,
      );
      setStackMisconfigScanId(data.id as number);
    } catch (error) {
      const err = error as { message?: string; error?: string; data?: { error?: string } };
      toast.error(err?.message || err?.error || err?.data?.error || 'Config scan failed');
    } finally {
      toast.dismiss(loadingId);
      setStackMisconfigScanning(false);
    }
  };

  const runDeploy = async (
    stackName: string,
    stackFile: string,
    ignorePolicy: boolean,
    started?: Promise<void>,
  ): Promise<{ ok: boolean; errorMessage?: string }> => {
    const previousStatus = stackStatuses[stackFile];
    setOptimisticStatus(stackFile, 'running');
    try {
      const path = ignorePolicy
        ? `/stacks/${stackName}/deploy?ignorePolicy=true`
        : `/stacks/${stackName}/deploy`;
      if (started) await started;
      const response = await apiFetch(path, { method: 'POST' });
      if (!response.ok) {
        const rawBody = await response.text();
        if (response.status === 409) {
          let parsed: PolicyBlockPayload | null = null;
          try { parsed = JSON.parse(rawBody) as PolicyBlockPayload; } catch { /* not JSON */ }
          if (parsed && parsed.policy && Array.isArray(parsed.violations)) {
            setPolicyBlock({ stackName, payload: parsed });
            if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
            toast.error(`Deploy blocked by policy "${parsed.policy.name}"`);
            return { ok: false, errorMessage: `Deploy blocked by policy "${parsed.policy.name}"` };
          }
        }
        throw new Error(rawBody || 'Deploy failed');
      }
      setPolicyBlock(null);
      toast.success(ignorePolicy ? 'Stack deployed (policy bypassed).' : 'Stack deployed successfully!');
      if (selectedFile === stackFile) {
        const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
        const conts = await containersRes.json();
        setContainers(Array.isArray(conts) ? conts : []);
      }
      if (isPaid) {
        try {
          const backupRes = await apiFetch(`/stacks/${stackName}/backup`);
          if (backupRes.ok) setBackupInfo(await backupRes.json());
        } catch { /* ignore */ }
      }
      return { ok: true };
    } catch (error) {
      console.error('Failed to deploy:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      const errorMessage = (error as Error).message || 'Failed to deploy stack';
      toast.error(isPaid ? `${errorMessage} - automatically rolled back to previous version.` : errorMessage);
      return { ok: false, errorMessage };
    }
  };

  const deployStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || isStackBusy(selectedFile)) return;
    const stackFile = selectedFile;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setStackAction(stackFile, 'deploy');
    try {
      await runWithLog({ stackName, action: 'deploy' }, (started) =>
        runDeploy(stackName, stackFile, false, started)
      );
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const bypassPolicyAndDeploy = async () => {
    if (!policyBlock) return;
    const stackFile = `${policyBlock.stackName}.yml`;
    const existingFile = selectedFile && selectedFile.startsWith(policyBlock.stackName + '.')
      ? selectedFile
      : stackFile;
    setPolicyBypassing(true);
    setStackAction(existingFile, 'deploy');
    try {
      await runWithLog({ stackName: policyBlock.stackName, action: 'deploy' }, (started) =>
        runDeploy(policyBlock.stackName, existingFile, true, started)
      );
    } finally {
      setPolicyBypassing(false);
      clearStackAction(existingFile);
      refreshStacks(true);
    }
  };

  const stopStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || isStackBusy(selectedFile)) return;
    const stackFile = selectedFile;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setStackAction(stackFile, 'stop');
    const previousStatus = stackStatuses[stackFile];
    setOptimisticStatus(stackFile, 'exited');
    try {
      await runWithLog({ stackName, action: 'stop' }, async (started) => {
        await started;
        const response = await apiFetch(`/stacks/${stackName}/stop`, { method: 'POST' });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || 'Stop failed');
        }
        toast.success('Stack stopped successfully!');
        if (selectedFile === stackFile) {
          const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
          const conts = await containersRes.json();
          setContainers(Array.isArray(conts) ? conts : []);
        }
        return { ok: true };
      });
    } catch (error) {
      console.error('Failed to stop:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      toast.error((error as Error).message || 'Failed to stop stack');
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const restartStack = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFile || isStackBusy(selectedFile)) return;
    const stackFile = selectedFile;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setStackAction(stackFile, 'restart');
    const previousStatus = stackStatuses[stackFile];
    setOptimisticStatus(stackFile, 'running');
    try {
      await runWithLog({ stackName, action: 'restart' }, async (started) => {
        await started;
        const response = await apiFetch(`/stacks/${stackName}/restart`, { method: 'POST' });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || 'Restart failed');
        }
        toast.success('Stack restarted successfully!');
        if (selectedFile === stackFile) {
          const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
          const conts = await containersRes.json();
          setContainers(Array.isArray(conts) ? conts : []);
        }
        return { ok: true };
      });
    } catch (error) {
      console.error('Failed to restart:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      toast.error((error as Error).message || 'Failed to restart stack');
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const serviceAction = async (action: 'start' | 'stop' | 'restart', serviceName: string) => {
    if (!selectedFile) return;
    const stackName = selectedFile.replace(/\.(yml|yaml)$/, '');
    try {
      const r = await apiFetch(`/stacks/${stackName}/services/${encodeURIComponent(serviceName)}/${action}`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error((await r.text()) || `${action} failed`);
      const label = action === 'restart' ? 'restarted' : action === 'stop' ? 'stopped' : 'started';
      toast.success(`Service "${serviceName}" ${label}`);
      const cr = await apiFetch(`/stacks/${stackName}/containers`);
      const conts = await cr.json();
      setContainers(Array.isArray(conts) ? conts : []);
    } catch (e) {
      console.error(`Failed to ${action} service "${serviceName}":`, e);
      toast.error((e as Error).message || `Failed to ${action} service "${serviceName}"`);
    } finally {
      refreshStacks(true);
    }
  };

  const updateStack = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!selectedFile || isStackBusy(selectedFile)) return;
    const stackFile = selectedFile;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setStackAction(stackFile, 'update');
    const previousStatus = stackStatuses[stackFile];
    setOptimisticStatus(stackFile, 'running');
    try {
      await runWithLog({ stackName, action: 'update' }, async (started) => {
        await started;
        const response = await apiFetch(`/stacks/${stackName}/update`, { method: 'POST' });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || 'Update failed');
        }
        toast.success('Stack updated successfully!');
        fetchImageUpdates();
        if (selectedFile === stackFile) {
          const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
          const conts = await containersRes.json();
          setContainers(Array.isArray(conts) ? conts : []);
        }
        return { ok: true };
      });
    } catch (error) {
      console.error('Failed to update:', error);
      if (previousStatus !== undefined) setOptimisticStatus(stackFile, previousStatus as 'running' | 'exited');
      toast.error((error as Error).message || 'Failed to update stack');
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const deleteStack = async (pruneVolumes: boolean) => {
    if (!stackToDelete) return;
    // Find matching file entry for per-stack tracking
    const deleteKey = files.find(f => f === stackToDelete || f.replace(/\.(yml|yaml)$/, '') === stackToDelete) ?? stackToDelete;
    if (isStackBusy(deleteKey)) return;
    setStackAction(deleteKey, 'delete');
    try {
      const url = pruneVolumes
        ? `/stacks/${stackToDelete}?pruneVolumes=true`
        : `/stacks/${stackToDelete}`;
      const response = await apiFetch(url, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to delete stack');
      }
      toast.success('Stack deleted successfully!');
      setDeleteDialogOpen(false);
      setStackToDelete(null);
      if (selectedFile === stackToDelete) {
        setSelectedFile(null);
        setContent('');
        setOriginalContent('');
        setEnvContent('');
        setOriginalEnvContent('');
        setEnvExists(false);
        setContainers([]);
        setIsEditing(false);
      }
      await refreshStacks();
    } catch (error) {
      console.error('Failed to delete stack:', error);
      toast.error((error as Error).message || 'Failed to delete stack');
    } finally {
      clearStackAction(deleteKey);
    }
  };

  const cancelPendingUnsavedLoad = () => {
    setPendingUnsavedLoad(null);
    setPendingUnsavedNode(null);
  };

  const discardAndLoadPending = () => {
    const target = pendingUnsavedLoad;
    const targetNode = pendingUnsavedNode;
    setContent(originalContent);
    setEnvContent(originalEnvContent);
    setPendingUnsavedLoad(null);
    setPendingUnsavedNode(null);
    if (target) {
      if (targetNode) loadFileOnNode(targetNode, target);
      else loadFile(target);
    }
  };

  const requestDeleteStack = () => {
    setStackToDelete(selectedFile);
    setDeleteDialogOpen(true);
  };

  // Context-menu-friendly stack actions (accept file name directly)
  const executeStackActionByFile = async (stackFile: string, action: StackAction, endpoint: string) => {
    if (isStackBusy(stackFile)) return;
    const stackName = stackFile.replace(/\.(yml|yaml)$/, '');
    setStackAction(stackFile, action);

    // Optimistic status update
    if (action === 'stop') {
      setOptimisticStatus(stackFile, 'exited');
    } else if (action === 'deploy' || action === 'restart' || action === 'update') {
      setOptimisticStatus(stackFile, 'running');
    }

    try {
      const response = await apiFetch(`/stacks/${stackName}/${endpoint}`, { method: 'POST' });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `${action} failed`);
      }
      toast.success(`Stack ${action}ed successfully!`);
      if (selectedFile === stackFile) {
        const containersRes = await apiFetch(`/stacks/${stackName}/containers`);
        const conts = await containersRes.json();
        setContainers(Array.isArray(conts) ? conts : []);
      }
      if (action === 'update') fetchImageUpdates();
      if (action === 'deploy' && isPaid) {
        try {
          const backupRes = await apiFetch(`/stacks/${stackName}/backup`);
          if (backupRes.ok) setBackupInfo(await backupRes.json());
        } catch { /* ignore */ }
      }
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
      const msg = (error as Error).message || `Failed to ${action} stack`;
      toast.error(action === 'deploy' && isPaid ? `${msg} - automatically rolled back to previous version.` : msg);
    } finally {
      clearStackAction(stackFile);
      refreshStacks(true);
    }
  };

  const checkUpdatesForStack = async () => {
    try {
      const res = await apiFetch('/image-updates/refresh', { method: 'POST' });
      if (res.ok) {
        toast.success('Checking for image updates...');
        // Poll until the background check completes instead of using a fixed timeout
        let elapsed = 0;
        const poll = setInterval(async () => {
          elapsed += 2000;
          try {
            const statusRes = await apiFetch('/image-updates/status');
            if (statusRes.ok) {
              const { checking } = await statusRes.json();
              if (!checking || elapsed >= 60000) {
                clearInterval(poll);
                await fetchImageUpdates();
                if (!checking) toast.success('Image update check complete.');
              }
            }
          } catch {
            clearInterval(poll);
            await fetchImageUpdates();
          }
        }, 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to check for updates');
      }
    } catch {
      toast.error('Failed to check for updates');
    }
  };

  const openBashModal = (containerId: string, containerName: string) => {
    setSelectedContainer({ id: containerId, name: containerName });
    setBashModalOpen(true);
  };

  const closeBashModal = () => {
    setBashModalOpen(false);
    setSelectedContainer(null);
  };

  const openLogViewer = (containerId: string, containerName: string) => {
    setLogContainer({ id: containerId, name: containerName });
    setLogViewerOpen(true);
  };

  const closeLogViewer = () => {
    setLogViewerOpen(false);
    setLogContainer(null);
  };

  // Listen for topology click-to-logs events (ref avoids stale closure)
  const openLogViewerRef = useRef(openLogViewer);
  openLogViewerRef.current = openLogViewer;
  useEffect(() => {
    const handler = (e: Event) => {
      const { containerId, containerName } = (e as CustomEvent<SenchoOpenLogsDetail>).detail;
      openLogViewerRef.current(containerId, containerName);
    };
    window.addEventListener(SENCHO_OPEN_LOGS_EVENT, handler);
    return () => window.removeEventListener(SENCHO_OPEN_LOGS_EVENT, handler);
  }, []);

  // Stack name is now the same as selectedFile (no extension to strip)
  const stackName = selectedFile || '';

  // Get display name for stack (now just returns the name as-is since no extension)
  const getDisplayName = (stackName: string) => {
    return stackName;
  };

  const buildMenuCtx = useCallback((file: string): StackMenuCtx => {
    const stackName = file.replace(/\.(yml|yaml)$/, '');
    return {
      stackStatus: (stackStatuses[file] ?? 'unknown') as 'running' | 'exited' | 'unknown',
      hasPort: Boolean(stackPorts[file]),
      isBusy: isStackBusy(file),
      isPaid,
      isAdmiral,
      canDelete: can('stack:delete', 'stack', stackName),
      isPinned: isPinned(file),
      labels,
      assignedLabelIds: (stackLabelMap[file] ?? []).map(l => l.id),
      menuVisibility: getStackMenuVisibility(file),
      autoUpdateEnabled: autoUpdateSettings[stackName] ?? true,
      openAlertSheet: () => openAlertSheet(file),
      openAutoHeal: () => setAutoHealStackName(file),
      checkUpdates: () => checkUpdatesForStack(),
      openStackApp: () => openStackApp(file),
      deploy: () => executeStackActionByFile(file, 'deploy', 'deploy'),
      stop: () => executeStackActionByFile(file, 'stop', 'stop'),
      restart: () => executeStackActionByFile(file, 'restart', 'restart'),
      update: () => executeStackActionByFile(file, 'update', 'update'),
      remove: () => { setStackToDelete(stackName); setDeleteDialogOpen(true); },
      pin: () => pin(file),
      unpin: () => unpin(file),
      setAutoUpdateEnabled: async (enabled: boolean) => {
        setAutoUpdateSettings(prev => ({ ...prev, [stackName]: enabled }));
        try {
          const res = await apiFetch(`/stacks/${encodeURIComponent(stackName)}/auto-update`, {
            method: 'PUT',
            body: JSON.stringify({ enabled }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error || 'Failed to update auto-update setting.');
          }
        } catch (err: unknown) {
          setAutoUpdateSettings(prev => ({ ...prev, [stackName]: !enabled }));
          toast.error((err as Error)?.message || 'Failed to update auto-update setting.');
        }
      },
      toggleLabel: async (labelId: number) => {
        const currentIds = (stackLabelMap[file] ?? []).map(l => l.id);
        const assigned = currentIds.includes(labelId);
        const newIds = assigned ? currentIds.filter(id => id !== labelId) : [...currentIds, labelId];
        const loadingId = toast.loading('Updating labels...');
        try {
          const res = await apiFetch(`/stacks/${encodeURIComponent(file)}/labels`, {
            method: 'PUT',
            body: JSON.stringify({ labelIds: newIds }),
          });
          if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error((data as { error?: string })?.error || 'Failed to update labels.'); }
          refreshLabels();
        } catch (err: unknown) {
          toast.error((err as Error)?.message || 'Failed to update labels.');
        } finally {
          toast.dismiss(loadingId);
        }
      },
      createAndAssignLabel: async (name: string, color: LabelColor) => {
        const loadingId = toast.loading('Creating label...');
        try {
          const createRes = await apiFetch('/labels', {
            method: 'POST',
            body: JSON.stringify({ name, color }),
          });
          if (!createRes.ok) {
            const data = await createRes.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error || 'Failed to create label.');
          }
          const created: StackLabel = await createRes.json();
          const currentIds = (stackLabelMap[file] ?? []).map(l => l.id);
          const newIds = [...currentIds, created.id];
          const assignRes = await apiFetch(`/stacks/${encodeURIComponent(file)}/labels`, {
            method: 'PUT',
            body: JSON.stringify({ labelIds: newIds }),
          });
          if (!assignRes.ok) {
            const data = await assignRes.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error || 'Failed to assign label.');
          }
          toast.success(`Label "${created.name}" created.`);
          refreshLabels();
        } catch (err: unknown) {
          toast.error((err as Error)?.message || 'Failed to create label.');
          throw err;
        } finally {
          toast.dismiss(loadingId);
        }
      },
      openLabelManager: () => handleOpenSettings('labels'),
      openScheduleTask: () => {
        const stackName = file.replace(/\.(yml|yaml)$/, '');
        setSchedulePrefill({ stackName, nodeId: activeNode?.id ?? null });
        setActiveView('scheduled-ops');
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stackStatuses, stackPorts, isPaid, isAdmiral, isPinned, labels, stackLabelMap,
    autoUpdateSettings, pin, unpin,
  ]);

  const createStackSlot = can('stack:create') ? (
    <>
      <Button
        variant="outline"
        className="rounded-lg w-full"
        onClick={() => setCreateDialogOpen(true)}
      >
        <Plus className="w-4 h-4 mr-2" />
        Create Stack
      </Button>
      <CreateStackDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onStackCreated={async (stackName) => {
          await refreshStacks();
          await loadFile(stackName);
        }}
        onStacksChanged={async () => { await refreshStacks(); }}
      />
    </>
  ) : null;

  return (
    <GlobalCommandPaletteProvider>
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <GlobalCommandPalette
        navItems={navItems}
        onNavigate={handleNavigate}
        onSelectStack={loadFileOnNode}
      />
      {/* Left Sidebar (Stacks) */}
      <StackSidebar
        isDarkMode={isDarkMode}
        nodeSwitcherSlot={
          <NodeSwitcher
            onManageNodes={() => handleOpenSettings('nodes')}
          />
        }
        createStackSlot={createStackSlot}
        onScan={handleScanStacks}
        isScanning={isScanning}
        canCreate={can('stack:create')}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterChip={filterChip}
        filterCounts={filterCounts}
        onFilterChipChange={setFilterChip}
        list={{
          files: chipFilteredFiles,
          isLoading,
          isPaid,
          selectedFile,
          searchQuery,
          stackLabelMap,
          stackStatuses: stackStatuses as Record<string, StackRowStatus | undefined>,
          stackUpdates,
          gitSourcePendingMap,
          pinnedFiles: pinned,
          isCollapsed,
          toggleCollapse,
          isBusy: isStackBusy,
          getDisplayName,
          onSelectFile: loadFile,
          buildMenuCtx,
          remoteResults,
          remoteLoading: remoteSearchLoading,
          onSelectRemoteFile: (nodeId, file) => {
            const node = nodes.find(n => n.id === nodeId);
            if (node) loadFileOnNode(node, file);
          },
        }}
        notifications={notifications}
        tickerConnected={tickerConnected}
        onOpenActivity={() => setActiveView('global-observability')}
        bulkMode={bulkMode}
        selectedFiles={selectedFiles}
        isPaid={isPaid}
        onToggleBulkMode={toggleBulkMode}
        onToggleSelect={toggleSelect}
        onClearSelection={clearSelection}
        onBulkAction={handleBulkAction}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          activeView={activeView}
          navItems={navItems}
          onNavigate={handleNavigate}
          mobileNavOpen={mobileNavOpen}
          onMobileNavOpenChange={setMobileNavOpen}
          search={<GlobalCommandPaletteTrigger />}
          notifications={
            <NotificationPanel
              notifications={notifications}
              nodes={nodes}
              onMarkAllRead={markAllRead}
              onClearAll={clearAllNotifications}
              onDelete={deleteNotification}
              onNavigate={navigateToNotification}
            />
          }
          userMenu={
            <UserProfileDropdown
              theme={theme}
              setTheme={setTheme}
              onOpenSettings={() => handleOpenSettings('account')}
            />
          }
        />

        {/* Main Workspace */}
        <div key={activeView} className="flex-1 overflow-y-auto p-6 animate-fade-up">
          <ViewRouter
            activeView={activeView}
            selectedFile={selectedFile}
            isLoading={isLoading}
            settingsSection={settingsSection}
            onSettingsSectionChange={setSettingsSection}
            onTemplateDeploySuccess={(stackName) => { refreshStacks(); loadFile(stackName); }}
            onHostConsoleClose={() => setActiveView(selectedFile ? 'editor' : 'dashboard')}
            onFleetNavigateToNode={(nodeId, stackName) => {
              const node = nodes.find(n => n.id === nodeId);
              if (node) {
                if (activeNode?.id === nodeId) {
                  loadFile(stackName);
                } else {
                  pendingStackLoadRef.current = stackName;
                  setActiveNode(node);
                }
              }
            }}
            filterNodeId={filterNodeId}
            onClearScheduledOpsFilter={() => setFilterNodeId(null)}
            schedulePrefill={schedulePrefill}
            onPrefillConsumed={handlePrefillConsumed}
            notifications={notifications}
            onNavigateToStack={(stackFile) => { loadFile(stackFile); }}
            onOpenSettingsSection={(section) => handleOpenSettings(section)}
            onClearNotifications={clearAllNotifications}
            renderEditor={() => (
              <EditorView
                stackName={stackName}
                isDarkMode={isDarkMode}
                containers={containers}
                containerStats={containerStats}
                content={content}
                envContent={envContent}
                envExists={envExists}
                envFiles={envFiles}
                selectedEnvFile={selectedEnvFile}
                isFileLoading={isFileLoading}
                backupInfo={backupInfo}
                gitSourcePendingMap={gitSourcePendingMap}
                notifications={notifications}
                activeTab={activeTab}
                isEditing={isEditing}
                editingCompose={editingCompose}
                logsMode={logsMode}
                copiedDigest={copiedDigest}
                loadingAction={loadingAction}
                stackMisconfigScanning={stackMisconfigScanning}
                can={can}
                isAdmin={isAdmin}
                isPaid={isPaid}
                trivy={trivy}
                activeNode={activeNode}
                monacoEditorRef={monacoEditorRef}
                copiedDigestTimerRef={copiedDigestTimerRef}
                deployStack={deployStack}
                restartStack={restartStack}
                stopStack={stopStack}
                updateStack={updateStack}
                rollbackStack={rollbackStack}
                scanStackConfig={scanStackConfig}
                enterEditMode={enterEditMode}
                requestSave={requestSave}
                requestSaveAndDeploy={requestSaveAndDeploy}
                discardChanges={discardChanges}
                setContent={setContent}
                setEnvContent={setEnvContent}
                changeEnvFile={changeEnvFile}
                openLogViewer={openLogViewer}
                openBashModal={openBashModal}
                serviceAction={serviceAction}
                setActiveTab={setActiveTab}
                setLogsMode={setLogsMode}
                setEditingCompose={setEditingCompose}
                setGitSourceOpen={setGitSourceOpen}
                setCopiedDigest={setCopiedDigest}
                requestDeleteStack={requestDeleteStack}
              />
            )}
          />
        </div>
      </div>

      <DeleteStackDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        stackName={stackToDelete}
        onConfirm={deleteStack}
      />

      <UnsavedChangesDialog
        open={!!pendingUnsavedLoad}
        onCancel={cancelPendingUnsavedLoad}
        onConfirm={discardAndLoadPending}
      />

      {/* Bash Exec Modal */}
      {selectedContainer && (
        <BashExecModal
          isOpen={bashModalOpen}
          onClose={closeBashModal}
          containerId={selectedContainer.id}
          containerName={selectedContainer.name}
        />
      )}

      {/* LogViewer Modal */}
      {logContainer && (
        <LogViewer
          isOpen={logViewerOpen}
          onClose={closeLogViewer}
          containerId={logContainer.id}
          containerName={logContainer.name}
        />
      )}


      {/* Stack Alert Sheet */}
      <StackAlertSheet
        isOpen={alertSheetOpen}
        onClose={() => setAlertSheetOpen(false)}
        stackName={alertSheetStack}
      />

      {/* Pre-deploy policy block */}
      <PolicyBlockDialog
        open={policyBlock !== null}
        payload={policyBlock?.payload ?? null}
        stackName={policyBlock?.stackName ?? ''}
        canBypass={isAdmin}
        bypassing={policyBypassing}
        onClose={() => setPolicyBlock(null)}
        onBypass={bypassPolicyAndDeploy}
      />

      {/* Stack Auto-Heal Sheet */}
      <StackAutoHealSheet
        stackName={autoHealStackName ?? ''}
        open={autoHealStackName !== null}
        onOpenChange={(open) => { if (!open) setAutoHealStackName(null); }}
      />

      {/* Git Source Panel */}
      {stackName && (
        <GitSourcePanel
          open={gitSourceOpen}
          onOpenChange={setGitSourceOpen}
          stackName={stackName}
          canEdit={can('stack:edit', 'stack', stackName)}
          isDarkMode={isDarkMode}
          onSourceChanged={refreshGitSourcePending}
        />
      )}

      {/* Stack config misconfig scan results */}
      <VulnerabilityScanSheet
        scanId={stackMisconfigScanId}
        onClose={() => setStackMisconfigScanId(null)}
      />

      {/* Compose diff preview */}
      <ComposeDiffPreviewDialog
        open={diffPreview !== null}
        onOpenChange={(open) => { if (!open && !diffPreviewConfirming) setDiffPreview(null); }}
        stackName={selectedFile ? selectedFile.replace(/\.(yml|yaml)$/, '') : ''}
        fileName={diffPreview?.fileName ?? ''}
        language={diffPreview?.language ?? 'yaml'}
        original={diffPreview?.original ?? ''}
        modified={diffPreview?.modified ?? ''}
        actionLabel={diffPreview?.mode === 'save-and-deploy' ? 'Save & deploy' : 'Save'}
        confirming={diffPreviewConfirming}
        isDarkMode={isDarkMode}
        onConfirm={async () => {
          const snapshot = diffPreview;
          setDiffPreviewConfirming(true);
          try {
            if (snapshot?.mode === 'save-and-deploy') {
              await saveFile();
              // e.preventDefault/stopPropagation are no-ops here; no browser event is in flight
              await deployStack({ preventDefault() {}, stopPropagation() {} } as unknown as React.MouseEvent);
            } else {
              await saveFile();
            }
          } finally {
            setDiffPreviewConfirming(false);
            setDiffPreview(null);
          }
        }}
      />

      {/* Scan history overlay. Conditionally mounted so the lazy chunk
          only fetches when the user opens the overlay; an always-mounted
          lazy component would fetch on EditorLayout's first render and
          defeat the split. The overlay has no internal state that needs
          to persist across opens. */}
      {securityHistoryOpen ? (
        <LazyBoundary>
          <Suspense fallback={null}>
            <SecurityHistoryView
              open
              onClose={() => setSecurityHistoryOpen(false)}
            />
          </Suspense>
        </LazyBoundary>
      ) : null}
    </div>
    </GlobalCommandPaletteProvider>
  );
}
