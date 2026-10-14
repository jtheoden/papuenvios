import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { createComboMock, updateComboMock, translate } = vi.hoisted(() => ({
  // Identity for pre-existing keys; real EN copy for the keys added by this feature
  translate: (key) => {
    if (!/^vendor\.combos\.(priceWarning|confirmMoreExpensive|saveAnyway|moreExpensiveBadge)/.test(key)) return key;
    return globalThis.__EN_COMBOS__?.[key.split('.')[2]] ?? key;
  },
  createComboMock: vi.fn().mockResolvedValue({ id: 'new-combo' }),
  updateComboMock: vi.fn().mockResolvedValue({})
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: 'en' })
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'a@b.com' } })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ refreshCombos: vi.fn() })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/imageUtils', () => ({ validateAndProcessImage: vi.fn() }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn() }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeCombos: vi.fn() }));
vi.mock('@/lib/comboService', () => ({
  createCombo: createComboMock,
  updateCombo: updateComboMock,
  deleteCombo: vi.fn(),
  setComboActiveState: vi.fn()
}));

import EN from '@/translations/EN.json';
import VendorCombosTab from '@/components/vendor/VendorCombosTab';

globalThis.__EN_COMBOS__ = EN.vendor.combos;

const currencies = [{ id: 'usd', code: 'USD', symbol: '$', is_base: true }];

const products = [
  { id: 'a', name_es: 'Arroz', base_price: 40, final_price: 56, base_currency_id: 'usd', stock: 50 },
  { id: 'b', name_es: 'Frijol', base_price: 36.44, final_price: 50.75, base_currency_id: 'usd', stock: 50 }
];

const overpricedCombo = {
  id: 'c1',
  name: 'Pricey',
  name_es: 'Pricey',
  is_active: true,
  products: ['a', 'b'],
  productQuantities: { a: 1, b: 1 },
  profit_margin: 45
};
const fairCombo = { ...overpricedCombo, id: 'c2', name: 'Fair', name_es: 'Fair', profit_margin: 20 };

const renderTab = (combos = []) =>
  render(
    <VendorCombosTab
      combos={combos}
      products={products}
      currencies={currencies}
      visualSettings={{}}
      financialSettings={{ comboProfit: 45 }}
      exchangeRates={{}}
      selectedCurrency="usd"
      onSelectedCurrencyChange={vi.fn()}
      onCombosRefresh={vi.fn().mockResolvedValue(undefined)}
    />
  );

const openNewForm = () => {
  renderTab();
  fireEvent.click(screen.getByText('vendor.combos.new').closest('button'));
};

const pickProducts = () => {
  fireEvent.click(document.getElementById('p-a'));
  fireEvent.click(document.getElementById('p-b'));
};
const setMargin = (value) =>
  fireEvent.change(screen.getByPlaceholderText('45%'), { target: { value: String(value) } });
const setName = (value) =>
  fireEvent.change(screen.getByPlaceholderText('vendor.combos.name'), { target: { value } });
const clickSave = () =>
  fireEvent.click(screen.getByText('vendor.combos.save').closest('button'));

beforeEach(() => {
  createComboMock.mockClear();
  updateComboMock.mockClear();
});

describe('VendorCombosTab price warning (form)', () => {
  it('shows no warning before products are selected', () => {
    openNewForm();
    setMargin(45);
    expect(screen.queryByTestId('combo-margin-warning')).toBeNull();
  });

  it('shows the warning when the margin makes the combo more expensive than its products', () => {
    openNewForm();
    pickProducts();
    setMargin(45);
    const warning = screen.getByTestId('combo-margin-warning');
    expect(warning.getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('combo-warning-combo-price').textContent).toContain('$110.84');
    expect(screen.getByTestId('combo-warning-individual-total').textContent).toContain('$106.75');
    expect(screen.getByTestId('combo-warning-max-margin').textContent).toContain('39.65');
  });

  it('updates live: disappears with a lower margin and returns with a higher one', () => {
    openNewForm();
    pickProducts();
    setMargin(45);
    expect(screen.queryByTestId('combo-margin-warning')).not.toBeNull();
    setMargin(20);
    expect(screen.queryByTestId('combo-margin-warning')).toBeNull();
    setMargin(41);
    expect(screen.queryByTestId('combo-margin-warning')).not.toBeNull();
  });

  it('reacts to removing products', () => {
    openNewForm();
    pickProducts();
    setMargin(39.65);
    expect(screen.queryByTestId('combo-margin-warning')).toBeNull();
    fireEvent.click(document.getElementById('p-b'));
    // only product a: base 40 -> 55.86 vs 56, still fine; margin 41 breaks it
    setMargin(41);
    expect(screen.queryByTestId('combo-margin-warning')).not.toBeNull();
    fireEvent.click(document.getElementById('p-a'));
    expect(screen.queryByTestId('combo-margin-warning')).toBeNull();
  });

  it('applies the suggested margin into the form', () => {
    openNewForm();
    pickProducts();
    setMargin(45);
    fireEvent.click(screen.getByTestId('combo-warning-apply'));
    expect(screen.getByPlaceholderText('45%').value).toBe('39.65');
    expect(screen.queryByTestId('combo-margin-warning')).toBeNull();
  });

  it('asks for confirmation before saving a more expensive combo, then saves on confirm', async () => {
    openNewForm();
    setName('Pricey');
    pickProducts();
    setMargin(45);
    clickSave();
    expect(createComboMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('combo-price-confirm')).toBeTruthy();

    fireEvent.click(screen.getByTestId('combo-price-confirm-accept'));
    await waitFor(() => expect(createComboMock).toHaveBeenCalledTimes(1));
    expect(createComboMock.mock.calls[0][0].profitMargin).toBe(45);
  });

  it('does not save when the confirmation is cancelled', () => {
    openNewForm();
    setName('Pricey');
    pickProducts();
    setMargin(45);
    clickSave();
    fireEvent.click(screen.getByTestId('combo-price-confirm-cancel'));
    expect(screen.queryByTestId('combo-price-confirm')).toBeNull();
    expect(createComboMock).not.toHaveBeenCalled();
  });

  it('saves directly, with no confirmation, when the combo is not more expensive', async () => {
    openNewForm();
    setName('Fair');
    pickProducts();
    setMargin(20);
    clickSave();
    expect(screen.queryByTestId('combo-price-confirm')).toBeNull();
    await waitFor(() => expect(createComboMock).toHaveBeenCalledTimes(1));
  });
});

describe('VendorCombosTab price warning (list)', () => {
  it('badges only the combos that cost more than their products', () => {
    renderTab([overpricedCombo, fairCombo]);
    const badges = screen.getAllByTestId('combo-more-expensive-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('[data-testid="combo-card"]').textContent).toContain('Pricey');
  });

  it('shows the amount in the badge accessible text', () => {
    renderTab([overpricedCombo]);
    expect(screen.getByTestId('combo-more-expensive-badge').textContent).toContain('4.09');
  });
});
