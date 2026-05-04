import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useOverlayState } from './useOverlayState';

describe('useOverlayState', () => {
  it('initialises with all overlays closed and null/empty data', () => {
    const { result } = renderHook(() => useOverlayState());
    expect(result.current.createDialogOpen).toBe(false);
    expect(result.current.deleteDialogOpen).toBe(false);
    expect(result.current.stackToDelete).toBeNull();
    expect(result.current.pendingUnsavedLoad).toBeNull();
    expect(result.current.pendingUnsavedNode).toBeNull();
    expect(result.current.bashModalOpen).toBe(false);
    expect(result.current.selectedContainer).toBeNull();
    expect(result.current.logViewerOpen).toBe(false);
    expect(result.current.logContainer).toBeNull();
    expect(result.current.alertSheetOpen).toBe(false);
    expect(result.current.alertSheetStack).toBe('');
    expect(result.current.autoHealStackName).toBeNull();
    expect(result.current.policyBlock).toBeNull();
    expect(result.current.policyBypassing).toBe(false);
    expect(result.current.stackMisconfigScanId).toBeNull();
    expect(result.current.diffPreview).toBeNull();
    expect(result.current.diffPreviewConfirming).toBe(false);
  });

  it('openBashModal sets open flag and container object', () => {
    const { result } = renderHook(() => useOverlayState());
    act(() => result.current.openBashModal({ id: 'abc', name: 'my-container' }));
    expect(result.current.bashModalOpen).toBe(true);
    expect(result.current.selectedContainer).toEqual({ id: 'abc', name: 'my-container' });
  });

  it('closeBashModal resets bash state', () => {
    const { result } = renderHook(() => useOverlayState());
    act(() => result.current.openBashModal({ id: 'abc', name: 'my-container' }));
    act(() => result.current.closeBashModal());
    expect(result.current.bashModalOpen).toBe(false);
    expect(result.current.selectedContainer).toBeNull();
  });

  it('openDeleteDialog sets open flag and stack name', () => {
    const { result } = renderHook(() => useOverlayState());
    act(() => result.current.openDeleteDialog('my-stack'));
    expect(result.current.deleteDialogOpen).toBe(true);
    expect(result.current.stackToDelete).toBe('my-stack');
  });

  it('closeDeleteDialog resets delete state', () => {
    const { result } = renderHook(() => useOverlayState());
    act(() => result.current.openDeleteDialog('my-stack'));
    act(() => result.current.closeDeleteDialog());
    expect(result.current.deleteDialogOpen).toBe(false);
    expect(result.current.stackToDelete).toBeNull();
  });

  it('openLogViewer sets open flag and container object', () => {
    const { result } = renderHook(() => useOverlayState());
    act(() => result.current.openLogViewer({ id: 'xyz', name: 'log-container' }));
    expect(result.current.logViewerOpen).toBe(true);
    expect(result.current.logContainer).toEqual({ id: 'xyz', name: 'log-container' });
  });

  it('closeLogViewer resets log viewer state', () => {
    const { result } = renderHook(() => useOverlayState());
    act(() => result.current.openLogViewer({ id: 'xyz', name: 'log-container' }));
    act(() => result.current.closeLogViewer());
    expect(result.current.logViewerOpen).toBe(false);
    expect(result.current.logContainer).toBeNull();
  });

  it('openAlertSheet sets sheet state', () => {
    const { result } = renderHook(() => useOverlayState());
    act(() => result.current.openAlertSheet('web-stack'));
    expect(result.current.alertSheetOpen).toBe(true);
    expect(result.current.alertSheetStack).toBe('web-stack');
  });

  it('openAlertSheet with autoHeal sets autoHealStackName', () => {
    const { result } = renderHook(() => useOverlayState());
    act(() => result.current.openAlertSheet('web-stack', 'web-stack'));
    expect(result.current.alertSheetOpen).toBe(true);
    expect(result.current.alertSheetStack).toBe('web-stack');
    expect(result.current.autoHealStackName).toBe('web-stack');
  });

  it('openAlertSheet without autoHeal leaves autoHealStackName null', () => {
    const { result } = renderHook(() => useOverlayState());
    act(() => result.current.openAlertSheet('web-stack'));
    expect(result.current.alertSheetOpen).toBe(true);
    expect(result.current.autoHealStackName).toBeNull();
  });

  it('closeAlertSheet sets alertSheetOpen to false', () => {
    const { result } = renderHook(() => useOverlayState());
    act(() => result.current.openAlertSheet('web-stack'));
    act(() => result.current.closeAlertSheet());
    expect(result.current.alertSheetOpen).toBe(false);
  });
});
