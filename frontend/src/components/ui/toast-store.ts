import { useSyncExternalStore } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  createdAt: number;
}

let toasts: Toast[] = [];
const listeners: Set<() => void> = new Set();
let idCounter = 0;

function notify() {
  listeners.forEach((fn) => fn());
}

function addToast(type: ToastType, message: string): string {
  const id = `toast-${++idCounter}-${Date.now()}`;
  toasts = [...toasts, { id, type, message, createdAt: Date.now() }];
  notify();
  return id;
}

export function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
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
  success: (message: string) => addToast('success', message),
  error: (message: string) => addToast('error', message),
  warning: (message: string) => addToast('warning', message),
  info: (message: string) => addToast('info', message),
  loading: (message: string) => addToast('loading', message),
  dismiss: (id: string) => removeToast(id),
};
