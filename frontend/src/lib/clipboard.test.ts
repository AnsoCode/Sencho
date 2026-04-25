import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { copyToClipboard } from './clipboard';

const originalIsSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value,
  });
}

function setNavigatorClipboard(clipboard: Clipboard | undefined): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  });
}

function setExecCommand(impl: () => boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    writable: true,
    value: fn,
  });
  return fn;
}

describe('copyToClipboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalIsSecureContext) Object.defineProperty(window, 'isSecureContext', originalIsSecureContext);
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
    if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
    else delete (document as { execCommand?: unknown }).execCommand;
  });

  it('uses navigator.clipboard in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setSecureContext(true);
    setNavigatorClipboard({ writeText } as unknown as Clipboard);

    await copyToClipboard('hello');

    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when not in a secure context', async () => {
    setSecureContext(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorClipboard({ writeText } as unknown as Clipboard);
    const execCommand = setExecCommand(() => true);

    await copyToClipboard('lan-host');

    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when clipboard API rejects', async () => {
    setSecureContext(true);
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    setNavigatorClipboard({ writeText } as unknown as Clipboard);
    const execCommand = setExecCommand(() => true);

    await copyToClipboard('rejected');

    expect(writeText).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('rejects when both modern API and execCommand fail and removes the textarea', async () => {
    setSecureContext(false);
    setNavigatorClipboard(undefined);
    setExecCommand(() => false);

    await expect(copyToClipboard('nope')).rejects.toThrow();
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });

  it('removes the textarea after using the fallback', async () => {
    setSecureContext(false);
    setNavigatorClipboard(undefined);
    setExecCommand(() => true);

    await copyToClipboard('cleanup');

    expect(document.querySelectorAll('textarea').length).toBe(0);
  });
});
