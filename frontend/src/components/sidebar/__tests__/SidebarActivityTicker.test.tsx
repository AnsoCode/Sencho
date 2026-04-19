import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarActivityTicker } from '../SidebarActivityTicker';
import type { NotificationItem } from '@/components/dashboard/types';

function notif(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 1,
    level: 'info',
    message: 'web deployed',
    timestamp: Math.floor(Date.now() / 1000) - 12,
    is_read: 0,
    stack_name: 'web',
    ...overrides,
  };
}

describe('SidebarActivityTicker', () => {
  it('shows idle fallback when no recent stack events', () => {
    render(<SidebarActivityTicker notifications={[]} connected onNavigate={() => {}} />);
    expect(screen.getByText(/IDLE/i)).toBeInTheDocument();
  });

  it('renders stack name + message when a recent event exists', () => {
    render(
      <SidebarActivityTicker notifications={[notif()]} connected onNavigate={() => {}} />
    );
    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.getByText(/deployed/i)).toBeInTheDocument();
  });

  it('marks connected dot when connected, amber dot when disconnected', () => {
    const { rerender } = render(<SidebarActivityTicker notifications={[]} connected onNavigate={() => {}} />);
    expect(screen.getByTestId('ticker-dot')).toHaveClass('bg-success');
    rerender(<SidebarActivityTicker notifications={[]} connected={false} onNavigate={() => {}} />);
    expect(screen.getByTestId('ticker-dot')).toHaveClass('bg-warning');
  });

  it('falls back to idle when events are older than 1 hour', () => {
    const old = notif({ timestamp: Math.floor(Date.now() / 1000) - 60 * 60 - 1 });
    render(<SidebarActivityTicker notifications={[old]} connected onNavigate={() => {}} />);
    expect(screen.getByText(/IDLE/i)).toBeInTheDocument();
  });
});
