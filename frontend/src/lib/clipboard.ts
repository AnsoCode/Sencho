/**
 * Copy text to the clipboard with a fallback for non-secure contexts.
 *
 * The Clipboard API (`navigator.clipboard`) is only available in secure
 * contexts (HTTPS, localhost, or 127.0.0.1). Self-hosted Sencho is commonly
 * accessed over plain HTTP on LAN IPs, so we fall back to the legacy
 * `document.execCommand('copy')` path when the modern API is unavailable
 * or rejects.
 *
 * Rejects only when both paths fail.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof window !== 'undefined' &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to legacy fallback
    }
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('execCommand copy returned false');
  } finally {
    document.body.removeChild(ta);
  }
}
