import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConfirmDialog from '@/components/admin/modals/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders line breaks of the message (whitespace-pre-line)', () => {
    render(<ConfirmDialog show title="T" message={'first\n\nsecond'} onConfirm={vi.fn()} onCancel={vi.fn()} t={(k) => k} />);
    const message = screen.getByText(/first/);
    expect(message.className).toContain('whitespace-pre-line');
    expect(message.textContent).toBe('first\n\nsecond');
  });
});
