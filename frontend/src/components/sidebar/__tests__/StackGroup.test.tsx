import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StackGroup } from '../StackGroup';

describe('StackGroup', () => {
  it('renders label and count', () => {
    render(
      <StackGroup id="prod" label="PROD" count={4} collapsed={false} onToggle={() => {}}>
        <div>child</div>
      </StackGroup>
    );
    expect(screen.getByText('PROD')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('hides children when collapsed', () => {
    render(
      <StackGroup id="prod" label="PROD" count={4} collapsed={true} onToggle={() => {}}>
        <div data-testid="child">child</div>
      </StackGroup>
    );
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('invokes onToggle when header clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <StackGroup id="prod" label="PROD" count={4} collapsed={false} onToggle={onToggle}>
        <div>child</div>
      </StackGroup>
    );
    await user.click(screen.getByRole('button', { name: /PROD/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('applies pinned variant styling when variant="pinned"', () => {
    render(
      <StackGroup id="pinned" label="PINNED" count={2} collapsed={false} onToggle={() => {}} variant="pinned">
        <div>child</div>
      </StackGroup>
    );
    expect(screen.getByText('PINNED')).toHaveClass('text-brand/90');
  });
});
