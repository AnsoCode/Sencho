import { useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import BashExecModal from './BashExecModal';
import LazyBoundary from './LazyBoundary';
import { Button } from './ui/button';
import { Plus } from 'lucide-react';
import { type Label as StackLabel, type LabelColor } from './label-types';
import { UserProfileDropdown } from './UserProfileDropdown';
import { NotificationPanel } from './NotificationPanel';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { PolicyBlockDialog } from './stack/PolicyBlockDialog';
import { TopBar } from './TopBar';
import { ViewRouter } from './EditorLayout/ViewRouter';
import { CreateStackDialog } from './EditorLayout/CreateStackDialog';
import { DeleteStackDialog } from './EditorLayout/DeleteStackDialog';
import { UnsavedChangesDialog } from './EditorLayout/UnsavedChangesDialog';
import { EditorView } from './EditorLayout/EditorView';
import { useEditorViewState } from './EditorLayout/hooks/useEditorViewState';
import { useStackListState } from './EditorLayout/hooks/useStackListState';
import { useViewNavigationState } from './EditorLayout/hooks/useViewNavigationState';
import { useOverlayState } from './EditorLayout/hooks/useOverlayState';
import { useStackActions } from './EditorLayout/hooks/useStackActions';
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

  const editorState = useEditorViewState();
  const {
    stackMisconfigScanning,
    copiedDigest, setCopiedDigest,
    copiedDigestTimerRef,
    content, setContent,
    envContent, setEnvContent,
    envExists,
    envFiles,
    selectedEnvFile,
    containers,
    activeTab, setActiveTab,
    logsMode, setLogsMode,
    gitSourceOpen, setGitSourceOpen,
    gitSourcePendingMap,
    isFileLoading,
    backupInfo,
    isEditing,
    editingCompose, setEditingCompose,
  } = editorState;

  const stackListState = useStackListState();
  const {
    selectedFile,
    isLoading,
    stackActions: stackActionMap,
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
    isStackBusy,
    refreshLabels,
    refreshStacks,
    fetchAutoUpdateSettings,
    handleScanStacks,
    scheduleStateInvalidateRefresh,
    toggleBulkMode, toggleSelect, clearSelection, handleBulkAction,
    stackUpdates,
    pinned, pin, unpin, isPinned,
    isCollapsed, toggleCollapse,
    remoteSearchLoading,
  } = stackListState;

  const { nodes, activeNode, setActiveNode } = useNodes();
  const monacoEditorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);

  const overlayState = useOverlayState();
  const {
    createDialogOpen, setCreateDialogOpen,
    deleteDialogOpen,
    stackToDelete,
    pendingUnsavedLoad,
    bashModalOpen,
    selectedContainer,
    logViewerOpen,
    logContainer,
    alertSheetOpen,
    alertSheetStack,
    autoHealStackName, setAutoHealStackName,
    policyBlock,
    policyBypassing,
    stackMisconfigScanId,
    diffPreview, setDiffPreview,
    diffPreviewConfirming, setDiffPreviewConfirming,
  } = overlayState;

  const [diffPreviewEnabled] = useComposeDiffPreviewEnabled();

  // Use a ref to break the circular dependency:
  // useViewNavigationState needs onNavigateToDashboard -> resetEditorState
  // but stackActions isn't created until after navState
  const resetEditorStateRef = useRef<() => void>(() => {});

  const navState = useViewNavigationState({
    onNavigateToDashboard: () => resetEditorStateRef.current(),
  });
  const {
    activeView, setActiveView,
    settingsSection, setSettingsSection,
    securityHistoryOpen, setSecurityHistoryOpen,
    filterNodeId, setFilterNodeId,
    schedulePrefill,
    mobileNavOpen, setMobileNavOpen,
    handleOpenSettings,
    handlePrefillConsumed,
    handleNavigate,
    navItems,
  } = navState;

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

  const stackActions = useStackActions({
    editorState,
    stackListState,
    navState,
    overlayState,
    activeNode,
    setActiveNode,
    nodes,
    isPaid,
    runWithLog,
    diffPreviewEnabled,
  });

  // Wire the ref now that stackActions is available
  resetEditorStateRef.current = stackActions.resetEditorState;

  const {
    pendingStackLoadRef,
    pendingLogsRef,
  } = stackActions;

  const loadingAction = selectedFile ? (stackActionMap[selectedFile] ?? null) : null;
  const stackName = selectedFile || '';

  const { theme, setTheme, isDarkMode } = useTheme();

  // Force Monaco to re-measure its container after the tab switch DOM settles.
  // Monaco's internal child is position:static with an explicit pixel height that
  // creates a circular CSS dependency (Monaco drives card height -> grid height -> Monaco).
  // Fix: reset Monaco to 0x0 first (breaks the cycle), then trigger a forced synchronous
  // reflow so the container has its CSS-correct size before Monaco re-measures.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const editor = monacoEditorRef.current;
      if (!editor) return;
      editor.layout({ width: 0, height: 0 }); // collapse -> breaks CSS circular dependency
      editor.layout();                          // forced reflow -> measures correct container size
    });
    return () => cancelAnimationFrame(id);
  }, [activeTab]);

  // Re-fetch stacks whenever the active node changes (or becomes available on mount).
  // Also clears any stale editor/container state that belonged to the previous node.
  useEffect(() => {
    if (!activeNode) return;
    const pendingStack = pendingStackLoadRef.current;
    pendingStackLoadRef.current = null;

    stackActions.resetEditorState();

    if (pendingStack) {
      void stackActions.loadFile(pendingStack);
    } else {
      setActiveView('dashboard');
    }

    refreshStacks();
    fetchAutoUpdateSettings();
    void stackActions.refreshGitSourcePending();
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
  }, [containers, selectedFile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for topology click-to-logs events (ref avoids stale closure)
  const openLogViewerRef = useRef(stackActions.openLogViewer);
  openLogViewerRef.current = stackActions.openLogViewer;
  useEffect(() => {
    const handler = (e: Event) => {
      const { containerId, containerName } = (e as CustomEvent<SenchoOpenLogsDetail>).detail;
      openLogViewerRef.current(containerId, containerName);
    };
    window.addEventListener(SENCHO_OPEN_LOGS_EVENT, handler);
    return () => window.removeEventListener(SENCHO_OPEN_LOGS_EVENT, handler);
  }, []);

  const buildMenuCtx = useCallback((file: string): StackMenuCtx => {
    const sName = file.replace(/\.(yml|yaml)$/, '');
    return {
      stackStatus: (stackStatuses[file] ?? 'unknown') as 'running' | 'exited' | 'unknown',
      hasPort: Boolean(stackPorts[file]),
      isBusy: isStackBusy(file),
      isPaid,
      isAdmiral,
      canDelete: can('stack:delete', 'stack', sName),
      isPinned: isPinned(file),
      labels,
      assignedLabelIds: (stackLabelMap[file] ?? []).map(l => l.id),
      menuVisibility: stackActions.getStackMenuVisibility(file),
      autoUpdateEnabled: autoUpdateSettings[sName] ?? true,
      openAlertSheet: () => overlayState.openAlertSheet(file),
      openAutoHeal: () => setAutoHealStackName(file),
      checkUpdates: () => stackActions.checkUpdatesForStack(),
      openStackApp: () => stackActions.openStackApp(file),
      deploy: () => stackActions.executeStackActionByFile(file, 'deploy', 'deploy'),
      stop: () => stackActions.executeStackActionByFile(file, 'stop', 'stop'),
      restart: () => stackActions.executeStackActionByFile(file, 'restart', 'restart'),
      update: () => stackActions.executeStackActionByFile(file, 'update', 'update'),
      remove: () => overlayState.openDeleteDialog(sName),
      pin: () => pin(file),
      unpin: () => unpin(file),
      setAutoUpdateEnabled: async (enabled: boolean) => {
        setAutoUpdateSettings(prev => ({ ...prev, [sName]: enabled }));
        try {
          const res = await apiFetch(`/stacks/${encodeURIComponent(sName)}/auto-update`, {
            method: 'PUT',
            body: JSON.stringify({ enabled }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error || 'Failed to update auto-update setting.');
          }
        } catch (err: unknown) {
          setAutoUpdateSettings(prev => ({ ...prev, [sName]: !enabled }));
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
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error || 'Failed to update labels.');
          }
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
        const taskStackName = file.replace(/\.(yml|yaml)$/, '');
        navState.setSchedulePrefill({ stackName: taskStackName, nodeId: activeNode?.id ?? null });
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
        onStackCreated={async (sName) => {
          await refreshStacks();
          await stackActions.loadFile(sName);
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
        onSelectStack={stackActions.loadFileOnNode}
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
          getDisplayName: stackActions.getDisplayName,
          onSelectFile: stackActions.loadFile,
          buildMenuCtx,
          remoteResults,
          remoteLoading: remoteSearchLoading,
          onSelectRemoteFile: (nodeId, file) => {
            const node = nodes.find(n => n.id === nodeId);
            if (node) void stackActions.loadFileOnNode(node, file);
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
              onNavigate={stackActions.navigateToNotification}
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
            onTemplateDeploySuccess={(sName) => {
              refreshStacks();
              void stackActions.loadFile(sName);
            }}
            onHostConsoleClose={() => setActiveView(selectedFile ? 'editor' : 'dashboard')}
            onFleetNavigateToNode={(nodeId, sName) => {
              const node = nodes.find(n => n.id === nodeId);
              if (node) {
                if (activeNode?.id === nodeId) {
                  void stackActions.loadFile(sName);
                } else {
                  pendingStackLoadRef.current = sName;
                  setActiveNode(node);
                }
              }
            }}
            filterNodeId={filterNodeId}
            onClearScheduledOpsFilter={() => setFilterNodeId(null)}
            schedulePrefill={schedulePrefill}
            onPrefillConsumed={handlePrefillConsumed}
            notifications={notifications}
            onNavigateToStack={(stackFile) => { void stackActions.loadFile(stackFile); }}
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
                deployStack={stackActions.deployStack}
                restartStack={stackActions.restartStack}
                stopStack={stackActions.stopStack}
                updateStack={stackActions.updateStack}
                rollbackStack={stackActions.rollbackStack}
                scanStackConfig={stackActions.scanStackConfig}
                enterEditMode={stackActions.enterEditMode}
                requestSave={stackActions.requestSave}
                requestSaveAndDeploy={stackActions.requestSaveAndDeploy}
                discardChanges={stackActions.discardChanges}
                setContent={setContent}
                setEnvContent={setEnvContent}
                changeEnvFile={stackActions.changeEnvFile}
                openLogViewer={stackActions.openLogViewer}
                openBashModal={stackActions.openBashModal}
                serviceAction={stackActions.serviceAction}
                setActiveTab={setActiveTab}
                setLogsMode={setLogsMode}
                setEditingCompose={setEditingCompose}
                setGitSourceOpen={setGitSourceOpen}
                setCopiedDigest={setCopiedDigest}
                requestDeleteStack={stackActions.requestDeleteStack}
              />
            )}
          />
        </div>
      </div>

      <DeleteStackDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => { if (!open) overlayState.closeDeleteDialog(); }}
        stackName={stackToDelete}
        onConfirm={stackActions.deleteStack}
      />

      <UnsavedChangesDialog
        open={!!pendingUnsavedLoad}
        onCancel={stackActions.cancelPendingUnsavedLoad}
        onConfirm={stackActions.discardAndLoadPending}
      />

      {/* Bash Exec Modal */}
      {selectedContainer && (
        <BashExecModal
          isOpen={bashModalOpen}
          onClose={stackActions.closeBashModal}
          containerId={selectedContainer.id}
          containerName={selectedContainer.name}
        />
      )}

      {/* LogViewer Modal */}
      {logContainer && (
        <LogViewer
          isOpen={logViewerOpen}
          onClose={stackActions.closeLogViewer}
          containerId={logContainer.id}
          containerName={logContainer.name}
        />
      )}


      {/* Stack Alert Sheet */}
      <StackAlertSheet
        isOpen={alertSheetOpen}
        onClose={overlayState.closeAlertSheet}
        stackName={alertSheetStack}
      />

      {/* Pre-deploy policy block */}
      <PolicyBlockDialog
        open={policyBlock !== null}
        payload={policyBlock?.payload ?? null}
        stackName={policyBlock?.stackName ?? ''}
        canBypass={isAdmin}
        bypassing={policyBypassing}
        onClose={() => overlayState.setPolicyBlock(null)}
        onBypass={stackActions.bypassPolicyAndDeploy}
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
          onSourceChanged={stackActions.refreshGitSourcePending}
        />
      )}

      {/* Stack config misconfig scan results */}
      <VulnerabilityScanSheet
        scanId={stackMisconfigScanId}
        onClose={() => overlayState.setStackMisconfigScanId(null)}
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
              await stackActions.saveFile();
              await stackActions.deployStack();
            } else {
              await stackActions.saveFile();
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
