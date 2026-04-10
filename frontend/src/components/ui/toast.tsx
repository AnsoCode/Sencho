import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { useToasts, removeToast, type ToastType } from './toast-store';

/* ── Durations & Config ── */

const DURATIONS: Record<ToastType, number> = {
  success: 4000,
  error: 6000,
  warning: 5000,
  info: 4000,
  loading: Infinity,
};

const MAX_VISIBLE = 5;

/* ── SVG Icons (matching Sera UI exactly — h-6 w-6, stroke-based) ── */

const InfoIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const SuccessIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const WarningIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const ErrorIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

/* ── Type config (matching Sera UI's notificationConfig) ── */

const notificationConfig: Record<ToastType, {
  iconColor: string;
  icon: React.ReactNode;
}> = {
  info: {
    iconColor: 'text-info',
    icon: <InfoIcon className="h-6 w-6" />,
  },
  success: {
    iconColor: 'text-success',
    icon: <SuccessIcon className="h-6 w-6" />,
  },
  warning: {
    iconColor: 'text-warning',
    icon: <WarningIcon className="h-6 w-6" />,
  },
  error: {
    iconColor: 'text-destructive',
    icon: <ErrorIcon className="h-6 w-6" />,
  },
  loading: {
    iconColor: 'text-brand',
    icon: <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.5} />,
  },
};

/* ── ToastItem — faithful Sera UI Notification replica ── */

function ToastItem({ id, type, message }: { id: string; type: ToastType; message: string }) {
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(DURATIONS[type]);
  const startRef = useRef(0);
  const config = notificationConfig[type];
  const duration = DURATIONS[type];

  const dismiss = useCallback(() => {
    removeToast(id);
  }, [id]);

  // Auto-dismiss timer with hover pause (loading toasts never auto-dismiss)
  useEffect(() => {
    if (type === 'loading') return;
    if (hovered) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      remainingRef.current -= Date.now() - startRef.current;
      return;
    }
    startRef.current = Date.now();
    timerRef.current = setTimeout(dismiss, remainingRef.current);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hovered, dismiss, type]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      transition={{ duration: 0.3 }}
      className="relative w-full max-w-sm rounded-xl p-4 backdrop-blur-[10px] backdrop-saturate-[1.15] bg-popover/95 border border-glass-border overflow-hidden ring-1 ring-glass-border drop-shadow-xl transition-all duration-300 ease-in-out transform hover:scale-105 font-[family-name:var(--font-sans)]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center space-x-4">
        <div className={`flex-shrink-0 ${config.iconColor}`}>
          {config.icon}
        </div>
        <div className="flex-1">
          <p className="font-normal text-foreground text-lg">{message}</p>
        </div>
        <button
          onClick={dismiss}
          className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-full hover:bg-accent"
          aria-label="Close notification"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 h-1 w-full bg-glass-border rounded-b-xl overflow-hidden">
        {type === 'loading' ? (
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: '200%' }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            className="h-full w-1/3 bg-gradient-to-r from-transparent via-brand to-transparent"
          />
        ) : (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: hovered ? undefined : '100%' }}
            transition={{ duration: duration / 1000, ease: 'linear' }}
            className="h-full bg-gradient-to-r from-transparent via-brand to-transparent"
          />
        )}
      </div>
    </motion.div>
  );
}

/* ── ToastContainer ── */

export function ToastContainer() {
  const toasts = useToasts();
  const visible = toasts.slice(-MAX_VISIBLE);

  return createPortal(
    <div className="fixed p-4 space-y-2 w-full max-w-sm z-50 bottom-4 right-4">
      <AnimatePresence mode="popLayout">
        {visible.map((t) => (
          <ToastItem key={t.id} id={t.id} type={t.type} message={t.message} />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}
