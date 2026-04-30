export function isInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function isPaletteOpen(): boolean {
  return !!document.querySelector('[role="dialog"] [cmdk-root]');
}
