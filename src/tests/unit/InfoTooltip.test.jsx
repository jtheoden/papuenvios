import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

describe('InfoTooltip', () => {
  it('renders nothing when no text is provided', () => {
    const { container } = render(<InfoTooltip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes the explanation via aria-label on the trigger', () => {
    render(<InfoTooltip text="La comisión se descuenta del monto enviado." />);
    expect(
      screen.getByRole('button', { name: 'La comisión se descuenta del monto enviado.' })
    ).toBeInTheDocument();
  });

  it('shows the tooltip content when the trigger receives focus (keyboard accessible)', async () => {
    render(<InfoTooltip text="1 USD equivale al tipo de cambio configurado para este tipo de remesa." />);
    const trigger = screen.getByRole('button', {
      name: '1 USD equivale al tipo de cambio configurado para este tipo de remesa.'
    });

    fireEvent.focus(trigger);

    await waitFor(() => {
      expect(
        screen.getAllByText('1 USD equivale al tipo de cambio configurado para este tipo de remesa.').length
      ).toBeGreaterThan(0);
    });
  });
});
