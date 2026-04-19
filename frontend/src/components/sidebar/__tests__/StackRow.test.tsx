import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { StackRow } from '../StackRow';
import type { Label } from '@/components/label-types';

function base(overrides: Partial<ComponentProps<typeof StackRow>> = {}) {
  return {
    file: 'web.yml',
    displayName: 'web',
    status: 'running' as const,
    isBusy: false,
    isActive: false,
    isPaid: true,
    labels: [] as Label[],
    hasUpdate: false,
    hasGitPending: false,
    onSelect: vi.fn(),
    kebabSlot: null,
    ...overrides,
  };
}

describe('StackRow', () => {
  it('renders UP for running', () => {
    render(<StackRow {...base()} />);
    expect(screen.getByText('UP')).toBeInTheDocument();
  });

  it('renders DN for exited', () => {
    render(<StackRow {...base({ status: 'exited' })} />);
    expect(screen.getByText('DN')).toBeInTheDocument();
  });

  it('renders -- for unknown', () => {
    render(<StackRow {...base({ status: 'unknown' })} />);
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('renders cyan rail only when active', () => {
    const { rerender } = render(<StackRow {...base({ isActive: false })} />);
    expect(screen.getByTestId('stack-row')).not.toHaveClass('bg-accent/[0.07]');
    rerender(<StackRow {...base({ isActive: true })} />);
    expect(screen.getByTestId('stack-row')).toHaveClass('bg-accent/[0.07]');
  });
});
