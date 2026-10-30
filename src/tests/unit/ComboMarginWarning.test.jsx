import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EN from '@/translations/EN.json';
import ComboMarginWarning from '@/components/vendor/ComboMarginWarning';

const t = (key) => key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), EN) ?? key;


const over = {
  comboPrice: 110.84,
  individualTotal: 106.75,
  difference: -4.09,
  savingsPercent: -3.83,
  isMoreExpensive: true,
  maxMarginWithoutLoss: 39.65
};

const renderWarning = (props = {}) =>
  render(
    <ComboMarginWarning
      evaluation={over}
      currencySymbol="$"
      currencyCode="USD"
      t={t}
      onApplyMargin={vi.fn()}
      {...props}
    />
  );

describe('ComboMarginWarning', () => {
  it('renders nothing when the combo is not more expensive', () => {
    const { container } = renderWarning({
      evaluation: { ...over, isMoreExpensive: false, difference: 5 }
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without an evaluation', () => {
    const { container } = renderWarning({ evaluation: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('is announced as an alert and states the numbers', () => {
    renderWarning();
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(screen.getByTestId('combo-warning-combo-price').textContent).toContain('$110.84 USD');
    expect(screen.getByTestId('combo-warning-individual-total').textContent).toContain('$106.75 USD');
    expect(screen.getByTestId('combo-warning-difference').textContent).toContain('$4.09 USD');
    expect(screen.getByTestId('combo-warning-max-margin').textContent).toContain('39.65');
  });

  it('does not rely on color alone: shows a textual title', () => {
    renderWarning();
    expect(screen.getByText(EN.vendor.combos.priceWarningTitle)).toBeTruthy();
  });

  it('applies the suggested margin through the callback', () => {
    const onApplyMargin = vi.fn();
    renderWarning({ onApplyMargin });
    fireEvent.click(screen.getByTestId('combo-warning-apply'));
    expect(onApplyMargin).toHaveBeenCalledWith(39.65);
  });

  it('hides the apply button when there is no margin that avoids the problem', () => {
    renderWarning({ evaluation: { ...over, maxMarginWithoutLoss: 0 } });
    expect(screen.queryByTestId('combo-warning-apply')).toBeNull();
  });

  it('hides the apply button when no callback is given', () => {
    renderWarning({ onApplyMargin: undefined });
    expect(screen.queryByTestId('combo-warning-apply')).toBeNull();
  });
});
