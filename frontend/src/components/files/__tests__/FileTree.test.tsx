/**
 * Coverage for FileTree.
 *
 * Locks the expand/collapse behavior: root directory loaded on mount,
 * subdirectory fetched on first expand, collapsed on second click, and
 * re-expanded from cache (no second fetch) on third click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FileEntry } from '@/lib/stackFilesApi';

vi.mock('@/lib/stackFilesApi', () => ({
  listStackDirectory: vi.fn(),
}));

vi.mock('@/components/ui/toast-store', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// ScrollArea just renders children so the tree nodes are accessible in jsdom.
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

import { listStackDirectory } from '@/lib/stackFilesApi';
import { FileTree } from '../FileTree';

const mockListDir = listStackDirectory as unknown as ReturnType<typeof vi.fn>;

function makeFile(name: string): FileEntry {
  return { name, type: 'file', size: 100, mtime: 0, isProtected: false };
}

function makeDir(name: string): FileEntry {
  return { name, type: 'directory', size: 0, mtime: 0, isProtected: false };
}

const ROOT_ENTRIES: FileEntry[] = [makeDir('src'), makeFile('README.md')];
const SRC_ENTRIES: FileEntry[] = [makeFile('index.ts'), makeFile('app.ts')];

function fakeOk(entries: FileEntry[]): Promise<FileEntry[]> {
  return Promise.resolve(entries);
}

const defaultProps = {
  stackName: 'my-stack',
  selectedPath: '',
  onSelectFile: vi.fn(),
};

beforeEach(() => {
  mockListDir.mockReset();
  defaultProps.onSelectFile = vi.fn();
});

afterEach(() => vi.clearAllMocks());

describe('FileTree', () => {
  it('fetches root entries on mount and renders them', async () => {
    mockListDir.mockReturnValue(fakeOk(ROOT_ENTRIES));

    render(<FileTree {...defaultProps} />);

    await waitFor(() => expect(mockListDir).toHaveBeenCalledWith('my-stack', ''));
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('fetches subdirectory on first expand and shows children', async () => {
    mockListDir
      .mockReturnValueOnce(fakeOk(ROOT_ENTRIES))
      .mockReturnValueOnce(fakeOk(SRC_ENTRIES));

    const user = userEvent.setup();
    render(<FileTree {...defaultProps} />);

    await screen.findByText('src');

    // One call so far: root fetch.
    expect(mockListDir).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText('src'));

    await waitFor(() => expect(mockListDir).toHaveBeenCalledTimes(2));
    expect(mockListDir).toHaveBeenNthCalledWith(2, 'my-stack', 'src');

    expect(await screen.findByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('app.ts')).toBeInTheDocument();
  });

  it('collapses on second click (no additional fetch)', async () => {
    mockListDir
      .mockReturnValueOnce(fakeOk(ROOT_ENTRIES))
      .mockReturnValueOnce(fakeOk(SRC_ENTRIES));

    const user = userEvent.setup();
    render(<FileTree {...defaultProps} />);

    await screen.findByText('src');

    // Expand.
    await user.click(screen.getByText('src'));
    await screen.findByText('index.ts');

    const callsAfterExpand = mockListDir.mock.calls.length;

    // Collapse.
    await user.click(screen.getByText('src'));
    await waitFor(() => expect(screen.queryByText('index.ts')).not.toBeInTheDocument());

    // No extra fetch should have happened.
    expect(mockListDir).toHaveBeenCalledTimes(callsAfterExpand);
  });

  it('re-expands from cache on third click (no second fetch for that dir)', async () => {
    mockListDir
      .mockReturnValueOnce(fakeOk(ROOT_ENTRIES))
      .mockReturnValueOnce(fakeOk(SRC_ENTRIES));

    const user = userEvent.setup();
    render(<FileTree {...defaultProps} />);

    await screen.findByText('src');

    // First click: expand (fetches subdirectory).
    await user.click(screen.getByText('src'));
    await screen.findByText('index.ts');

    // Second click: collapse.
    await user.click(screen.getByText('src'));
    await waitFor(() => expect(screen.queryByText('index.ts')).not.toBeInTheDocument());

    const callsAfterCollapse = mockListDir.mock.calls.length;

    // Third click: re-expand from cache.
    await user.click(screen.getByText('src'));
    await screen.findByText('index.ts');

    // Fetch count must not have increased.
    expect(mockListDir).toHaveBeenCalledTimes(callsAfterCollapse);
  });

  it('shows error message when root fetch fails', async () => {
    mockListDir.mockRejectedValue(new Error('Network error'));

    render(<FileTree {...defaultProps} />);

    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });

  it('shows empty state when root returns no entries', async () => {
    mockListDir.mockReturnValue(fakeOk([]));

    render(<FileTree {...defaultProps} />);

    expect(await screen.findByText(/empty folder/i)).toBeInTheDocument();
  });
});
