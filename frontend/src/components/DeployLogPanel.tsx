import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, ChevronUp, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Sheet, SheetContent } from './ui/sheet';
import TerminalComponent from './Terminal';
import { Button } from './ui/button';
import { type DeployPanelState, type ActionVerb } from '../context/DeployLogContext';

// ---- Layout constants ----
const DEFAULT_HEIGHT_VH = 45;
const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_RATIO = 0.8;
const HEADER_HEIGHT_PX = 48;
const AUTO_CLOSE_DELAY_MS = 4000;
const STORAGE_KEY = 'sencho.deploy-log-panel.height';

// ---- Verb labels ----
const VERB_LABELS: Record<ActionVerb, { present: string; past: string }> = {
  deploy:  { present: 'Deploying',           past: 'Deployed'  },
  update:  { present: 'Updating',            past: 'Updated'   },
  down:    { present: 'Stopping & removing', past: 'Stopped'   },
  restart: { present: 'Restarting',          past: 'Restarted' },
  stop:    { present: 'Stopping',            past: 'Stopped'   },
};

function getInitialHeight(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) {
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= MIN_HEIGHT_PX) {
      return parsed;
    }
  }
  return Math.round((window.innerHeight * DEFAULT_HEIGHT_VH) / 100);
}

export interface DeployLogPanelProps {
  panelState: DeployPanelState;
  onTerminalReady: () => void;
  onPanelClose: () => void;
}

export default function DeployLogPanel({
  panelState,
  onTerminalReady,
  onPanelClose,
}: DeployLogPanelProps): React.ReactElement | null {
  const { isOpen, stackName, action, status, errorMessage } = panelState;

  const [height, setHeight] = useState<number>(getInitialHeight);
  const lastExpandedHeightRef = useRef<number>(getInitialHeight());
  const isDraggingRef = useRef(false);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMinimized = height <= HEADER_HEIGHT_PX;

  // ---- Auto-close on success ----
  const startAutoClose = useCallback(() => {
    if (autoCloseTimerRef.current !== null) {
      clearTimeout(autoCloseTimerRef.current);
    }
    autoCloseTimerRef.current = setTimeout(() => {
      onPanelClose();
    }, AUTO_CLOSE_DELAY_MS);
  }, [onPanelClose]);

  const cancelAutoClose = useCallback(() => {
    if (autoCloseTimerRef.current !== null) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (status === 'succeeded') {
      startAutoClose();
    } else {
      cancelAutoClose();
    }
    return () => {
      cancelAutoClose();
    };
  }, [status, startAutoClose, cancelAutoClose]);

  // Clear timer when panel closes
  useEffect(() => {
    if (!isOpen) {
      cancelAutoClose();
    }
  }, [isOpen, cancelAutoClose]);

  // ---- Drag handle ----
  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newHeight = window.innerHeight - moveEvent.clientY;
      const clamped = Math.max(
        MIN_HEIGHT_PX,
        Math.min(newHeight, window.innerHeight * MAX_HEIGHT_RATIO)
      );
      setHeight(clamped);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      setHeight((prev) => {
        localStorage.setItem(STORAGE_KEY, String(prev));
        if (prev > HEADER_HEIGHT_PX) {
          lastExpandedHeightRef.current = prev;
        }
        return prev;
      });
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => {
      isDraggingRef.current = false;
    };
  }, []);

  // ---- Minimize / expand ----
  const handleMinimizeToggle = useCallback(() => {
    setHeight((prev) => {
      if (prev <= HEADER_HEIGHT_PX) {
        const restored = lastExpandedHeightRef.current;
        localStorage.setItem(STORAGE_KEY, String(restored));
        return restored;
      }
      lastExpandedHeightRef.current = prev;
      localStorage.setItem(STORAGE_KEY, String(HEADER_HEIGHT_PX));
      return HEADER_HEIGHT_PX;
    });
  }, []);

  // ---- Status indicator ----
  const renderStatusIndicator = () => {
    if (status === 'succeeded') {
      return (
        <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--success)]">
          <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.5} />
          {VERB_LABELS[action].past} successfully
        </span>
      );
    }

    if (status === 'failed') {
      const message = errorMessage ?? 'Operation failed';
      return (
        <span className="flex items-center gap-1.5 text-sm font-medium text-destructive" title={message}>
          <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
          <span className="truncate max-w-[320px]">{message}</span>
        </span>
      );
    }

    // preparing / streaming
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.5} />
        Connecting...
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onPanelClose(); }}>
      <SheetContent
        data-testid="deploy-log-panel"
        side="bottom"
        style={{ height: `${height}px` }}
        className="p-0 flex flex-col gap-0 border-glass-border [&>button:first-of-type]:hidden"
      >
        {/* Drag handle */}
        <div
          className="h-2 w-full cursor-ns-resize shrink-0 hover:bg-muted/40 transition-colors"
          onMouseDown={handleDragMouseDown}
          aria-label="Resize panel"
        />

        {/* Header bar */}
        <div
          className="flex items-center justify-between px-4 shrink-0 border-b border-glass-border"
          style={{ height: `${HEADER_HEIGHT_PX}px` }}
          onMouseEnter={cancelAutoClose}
          onMouseLeave={() => { if (status === 'succeeded') startAutoClose(); }}
        >
          {/* Left: title + status */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-sm font-semibold text-foreground truncate">
              {VERB_LABELS[action].present} <span className="font-mono text-muted-foreground">{stackName}</span>
            </span>
            <div className="shrink-0">
              {renderStatusIndicator()}
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1 ml-2 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={handleMinimizeToggle}
              aria-label={isMinimized ? 'Expand panel' : 'Minimize panel'}
            >
              {isMinimized ? (
                <ChevronUp className="h-4 w-4" strokeWidth={1.5} />
              ) : (
                <Minus className="h-4 w-4" strokeWidth={1.5} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={onPanelClose}
              aria-label="Close panel"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </Button>
          </div>
        </div>

        {/* Terminal body (stays mounted when minimized, hidden via display:none) */}
        <div
          className="flex-1 min-h-0 shadow-[inset_0_2px_4px_0_oklch(0_0_0/0.4)]"
          style={{ display: isMinimized ? 'none' : 'flex', flexDirection: 'column' }}
          onMouseEnter={cancelAutoClose}
          onMouseLeave={() => { if (status === 'succeeded') startAutoClose(); }}
        >
          <TerminalComponent
            onReady={onTerminalReady}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
