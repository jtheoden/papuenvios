/**
 * A9 regression: opening a type for edit must never rewrite its stored commission_percentage.
 * remittance_types.commission_percentage is numeric(20,10); only a change of the market or delivery rate by the
 * super_admin recomputes it (rounded to 2 decimals, A9). Editing anything else keeps the stored value exactly.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
const auth = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'en' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: auth.isSuperAdmin }) }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}), getPrimaryButtonStyle: () => '' }));
vi.mock('@/lib/currencyService', () => ({
  getCurrenciesWithRates: vi.fn(async () => [
    { id: 'usd', code: 'USD', name_es: 'Dólar', name_en: 'Dollar' },
    { id: 'cup', code: 'CUP', name_es: 'Peso', name_en: 'Peso' }
  ])
}));

const svc = vi.hoisted(() => ({ update: vi.fn(), pending: vi.fn(), types: [] }));
vi.mock('@/lib/remittanceService', () => ({
  getAllRemittanceTypes: vi.fn(async () => svc.types),
  createRemittanceType: vi.fn(),
  updateRemittanceType: (...args) => svc.update(...args),
  deleteRemittanceType: vi.fn(),
  getPendingRemittancesCountByType: (...args) => svc.pending(...args),
  DELIVERY_METHODS: { CASH: 'cash', TRANSFER: 'transfer', CARD: 'card' }
}));

import RemittanceTypesConfig from '@/components/RemittanceTypesConfig';

// The live rows of remittance_types (rate / full-precision commission).
const LIVE_ROWS = [
  { rate: 915, commission: 2.1857923497 },
  { rate: 103, commission: 2.9126213592 },
  { rate: 900, commission: 5.5555555556 },
  { rate: 105, commission: 4.7619047619 }
];

const typeFor = ({ rate, commission }) => ({
  id: 't1',
  name: 'Dollars to CUP',
  currency_code: 'USD',
  delivery_currency: 'CUP',
  exchange_rate: rate,
  commission_percentage: commission,
  commission_fixed: 0,
  min_amount: 5,
  max_amount: 1000,
  delivery_method: 'cash',
  max_delivery_days: 3,
  warning_days: 2,
  description: '',
  icon: 'dollar-sign',
  is_active: true,
  display_order: 0
});

const openEdit = async () => {
  fireEvent.click(await screen.findByTitle('common.edit'));
  return {
    name: await screen.findByDisplayValue('Dollars to CUP'),
    market: await screen.findByPlaceholderText('472.00'),
    delivery: await screen.findByPlaceholderText('470.00')
  };
};

const save = async () => {
  fireEvent.click(screen.getByRole('button', { name: /common\.save$/ }));
  await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
  return svc.update.mock.calls[0][1];
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.isSuperAdmin = true;
  svc.update.mockResolvedValue({});
  svc.pending.mockResolvedValue(0);
});

describe.each(LIVE_ROWS)('super_admin editing only the name of a type with rate $rate', (row) => {
  beforeEach(() => {
    svc.types = [typeFor(row)];
  });

  it(`keeps commission_percentage exactly ${row.commission}`, async () => {
    render(<RemittanceTypesConfig />);
    const { name } = await openEdit();
    fireEvent.change(name, { target: { value: 'Dollars to CUP (cash)' } });

    const payload = await save();
    expect(payload.commission_percentage).toBe(row.commission);
    expect(payload.exchange_rate).toBe(row.rate);
    // nothing changed in the pricing, so no "pending remittances" prompt either
    expect(svc.pending).not.toHaveBeenCalled();
  });
});

describe('super_admin editing limits or is_active only', () => {
  beforeEach(() => {
    svc.types = [typeFor(LIVE_ROWS[0])];
  });

  it('keeps the exact commission and rate when only the limits change', async () => {
    render(<RemittanceTypesConfig />);
    await openEdit();
    fireEvent.change(screen.getByDisplayValue('1000'), { target: { value: '2000' } });

    const payload = await save();
    expect(payload.max_amount).toBe(2000);
    expect(payload.commission_percentage).toBe(2.1857923497);
    expect(payload.exchange_rate).toBe(915);
  });

  it('keeps the exact commission when only is_active changes', async () => {
    render(<RemittanceTypesConfig />);
    await openEdit();
    fireEvent.click(screen.getByRole('checkbox'));

    const payload = await save();
    expect(payload.is_active).toBe(false);
    expect(payload.commission_percentage).toBe(2.1857923497);
  });
});

describe('plain admin editing limits or is_active only', () => {
  beforeEach(() => {
    auth.isSuperAdmin = false;
    svc.types = [typeFor(LIVE_ROWS[0])];
  });

  it('does not send commission_percentage (nor the other pricing columns)', async () => {
    render(<RemittanceTypesConfig />);
    await openEdit();
    fireEvent.change(screen.getByDisplayValue('1000'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('checkbox'));

    const payload = await save();
    expect(payload).toMatchObject({ max_amount: 2000, is_active: false });
    expect(payload).not.toHaveProperty('commission_percentage');
    expect(payload).not.toHaveProperty('exchange_rate');
    expect(payload).not.toHaveProperty('commission_fixed');
  });
});

describe('super_admin changing the delivery rate', () => {
  beforeEach(() => {
    svc.types = [typeFor(LIVE_ROWS[0])];
  });

  it('stores the A9 commission (2 decimals) and shows the effective delivery rate it produces', async () => {
    render(<RemittanceTypesConfig />);
    const { delivery } = await openEdit();
    fireEvent.change(delivery, { target: { value: '890' } });

    // (1 - 890 / 915) * 100 = 2.7322404...% -> 2.73
    await waitFor(() => expect(screen.getByText('2.73%')).toBeInTheDocument());
    expect(screen.getByTestId('effective-delivery-rate')).toHaveTextContent('890.02');

    const payload = await save();
    expect(payload.commission_percentage).toBe(2.73);
    expect(payload.exchange_rate).toBe(915);
  });

  it('recomputes the commission when the market rate changes', async () => {
    render(<RemittanceTypesConfig />);
    const { market } = await openEdit();
    fireEvent.change(market, { target: { value: '920' } });

    // delivery stays at the derived 895.00 -> (1 - 895 / 920) * 100 = 2.7173913...% -> 2.72
    await waitFor(() => expect(screen.getByText('2.72%')).toBeInTheDocument());
    const payload = await save();
    expect(payload.commission_percentage).toBe(2.72);
    expect(payload.exchange_rate).toBe(920);
  });
});
