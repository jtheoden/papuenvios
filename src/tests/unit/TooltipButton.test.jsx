import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import TooltipButton from '@/components/TooltipButton';

describe('TooltipButton', () => {
  it('defaults to type="button" so it never submits a surrounding form', () => {
    render(<TooltipButton tooltipText="View">icon</TooltipButton>);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('forwards aria-label and keeps the title fallback', () => {
    render(<TooltipButton tooltipText="View" aria-label="View details">icon</TooltipButton>);

    const button = screen.getByRole('button', { name: 'View details' });
    expect(button).toHaveAttribute('title', 'View');
  });

  it('omits aria-label when none is given', () => {
    render(<TooltipButton tooltipText="View">icon</TooltipButton>);

    expect(screen.getByRole('button')).not.toHaveAttribute('aria-label');
  });

  it('does not fire onClick while disabled', () => {
    const onClick = vi.fn();
    render(<TooltipButton tooltipText="View" onClick={onClick} disabled>icon</TooltipButton>);

    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
