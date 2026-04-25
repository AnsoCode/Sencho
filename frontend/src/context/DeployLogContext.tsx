import React, { createContext, useContext, useState, useRef, useCallback } from 'react';

export type ActionVerb = 'deploy' | 'update' | 'down' | 'restart' | 'stop';

export interface DeployPanelState {
  isOpen: boolean;
  stackName: string;
  action: ActionVerb;
  status: 'preparing' | 'streaming' | 'succeeded' | 'failed';
  errorMessage?: string;
}

interface RunResult {
  ok: boolean;
  errorMessage?: string;
}

interface DeployLogContextValue {
  runWithLog: (
    params: { stackName: string; action: ActionVerb },
    run: (deployStarted: Promise<void>) => Promise<RunResult>
  ) => Promise<RunResult>;
  panelState: DeployPanelState;
  onTerminalReady: () => void;
  onPanelClose: () => void;
}

const DEFAULT_PANEL_STATE: DeployPanelState = {
  isOpen: false,
  stackName: '',
  action: 'deploy',
  status: 'preparing',
};

const DeployLogContext = createContext<DeployLogContextValue | undefined>(undefined);

export function DeployLogProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [panelState, setPanelState] = useState<DeployPanelState>(DEFAULT_PANEL_STATE);

  // Holds the resolver for the current session's deployStarted promise.
  // Updated at the start of each runWithLog call; not state because
  // changing it must not trigger a re-render.
  const readyResolverRef = useRef<(() => void) | null>(null);

  // Tracks whether a session is still active so a cancelled session
  // cannot mutate state for the new session that replaced it.
  const sessionIdRef = useRef(0);

  const onTerminalReady = useCallback(() => {
    if (readyResolverRef.current !== null) {
      readyResolverRef.current();
      readyResolverRef.current = null;
    }
  }, []);

  const onPanelClose = useCallback(() => {
    // Invalidate any in-progress session
    sessionIdRef.current += 1;
    readyResolverRef.current = null;
    setPanelState(DEFAULT_PANEL_STATE);
  }, []);

  const runWithLog = useCallback(
    async (
      params: { stackName: string; action: ActionVerb },
      run: (deployStarted: Promise<void>) => Promise<RunResult>
    ): Promise<RunResult> => {
      // Cancel any existing session before starting a new one
      sessionIdRef.current += 1;
      const mySession = sessionIdRef.current;

      setPanelState({
        isOpen: true,
        stackName: params.stackName,
        action: params.action,
        status: 'preparing',
      });

      const deployStarted = new Promise<void>((resolve) => {
        readyResolverRef.current = () => {
          setTimeout(resolve, 50);
        };
      });

      let result: RunResult;
      try {
        result = await run(deployStarted);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        result = { ok: false, errorMessage: message };
      }

      if (sessionIdRef.current === mySession) {
        setPanelState((prev) => ({
          ...prev,
          status: result.ok ? 'succeeded' : 'failed',
          errorMessage: result.ok ? undefined : result.errorMessage,
        }));
      }

      return result;
    },
    []
  );

  return (
    <DeployLogContext.Provider value={{ runWithLog, panelState, onTerminalReady, onPanelClose }}>
      {children}
    </DeployLogContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDeployLog(): DeployLogContextValue {
  const context = useContext(DeployLogContext);
  if (context === undefined) {
    throw new Error('useDeployLog must be used within a DeployLogProvider');
  }
  return context;
}
