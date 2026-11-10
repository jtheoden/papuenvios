import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const USD = { id: 'usd', code: 'USD' };
const CUP = { id: 'cup', code: 'CUP', show_in_selector: false };
const ctx = vi.hoisted(() => ({ value: null }));
vi.mock('@/contexts/CurrencyContext', () => ({ useCurrency: () => ctx.value }));

import CurrencySelector from '@/components/CurrencySelector';

ctx.value = { currencies: [USD, CUP], selectorCurrencies: [USD], loading: false };

const codes = () => screen.getAllByRole('option').map((o) => o.textContent);

describe('CurrencySelector', () => {
  it('public selector hides a currency with show_in_selector=false', () => {
    render(<CurrencySelector selectedCurrency="usd" onCurrencyChange={() => {}} />);
    expect(codes()).toEqual(['USD']);
  });

  it('authoring selector (includeHidden) lists every currency', () => {
    render(<CurrencySelector selectedCurrency="usd" onCurrencyChange={() => {}} includeHidden />);
    expect(codes()).toEqual(['USD', 'CUP']);
  });
});
