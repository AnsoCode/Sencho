import { useSyncExternalStore } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  duration?: number;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  createdAt: number;
  action?: ToastAction;
  duration?: number;
}

const MAX_BUFFERED = 20;

let toasts: Toast[] = [];
const listeners: Set<() => void> = new Set();
let idCounter = 0;

function notify() {
  listeners.forEach((fn) => fn());
}

function addToast(type: ToastType, message: string, opts?: ToastOptions): string {
  const id = `toast-${++idCounter}-${Date.now()}`;
  const next: Toast[] = [
    ...toasts,
    {
      id,
      type,
      message,
      createdAt: Date.now(),
      action: opts?.action,
      duration: opts?.duration,
    },
  ];
  toasts = next.length > MAX_BUFFERED ? next.slice(-MAX_BUFFERED) : next;
  notify();
  return id;
}

export function removeToast(id: string) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  notify();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot() {
  return toasts;
}

export function useToasts() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export const toast = {
  success: (message: string, opts?: ToastOptions) => addToast('success', message, opts),
  error: (message: string, opts?: ToastOptions) => addToast('error', message, opts),
  warning: (message: string, opts?: ToastOptions) => addToast('warning', message, opts),
  info: (message: string, opts?: ToastOptions) => addToast('info', message, opts),
  loading: (message: string, opts?: Omit<ToastOptions, 'duration'>) =>
    addToast('loading', message, opts),
  dismiss: (id: string) => removeToast(id),
};
