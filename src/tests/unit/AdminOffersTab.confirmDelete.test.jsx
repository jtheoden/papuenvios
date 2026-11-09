import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmWrapper, findConfirmDialog, answerConfirm } from './helpers/confirmDialog';

const mocks = vi.hoisted(() => ({ deletes: [] }));
const OFFER = { id: 'o-1', code: 'PAPU10', is_active: true, discount_type: 'percentage', discount_value: 10, created_at: '2026-01-01T00:00:00Z' };

const query = (table) => {
  const builder = { op: 'select' };
  ['select', 'order', 'in', 'gte', 'lte'].forEach((m) => { builder[m] = () => builder; });
  builder.delete = () => { builder.op = 'delete'; return builder; };
  builder.eq = (_col, value) => { if (builder.op === 'delete') mocks.deletes.push([table, value]); return builder; };
  builder.then = (resolve, reject) => Promise.resolve({ data: table === 'offers' && builder.op === 'select' ? [OFFER] : [], error: null }).then(resolve, reject);
  return builder;
};

vi.mock('@/contexts/LanguageContext', async () => {
  const { makeRealT } = await import('./helpers/realTranslator');
  const value = { t: makeRealT('en'), language: 'en' }; // stable identity: the component reloads when t changes
  return { useLanguage: () => value };
});
// Stable references: the component re-runs its load effects when these identities change.
const stable = vi.hoisted(() => ({ currency: { currencySymbol: '$' }, auth: { user: { id: 'admin-1' } }, business: { visualSettings: {} } }));
vi.mock('@/contexts/CurrencyContext', () => ({ useCurrency: () => stable.currency }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => stable.auth }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => stable.business }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn() }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeOffers: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({ getPrimaryButtonStyle: () => '' }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'admin-1' } } } }) },
    from: (table) => query(table)
  }
}));

import AdminOffersTab from '@/components/AdminOffersTab';

describe('AdminOffersTab delete uses the themed confirmation', () => {
  beforeEach(() => { mocks.deletes = []; });

  it('deletes only after confirming', async () => {
    render(<AdminOffersTab />, { wrapper: ConfirmWrapper });
    await screen.findAllByText('PAPU10');
    fireEvent.click(screen.getByTitle('Delete'));
    const dialog = await findConfirmDialog();
    expect(dialog).toHaveTextContent('Delete this offer?');
    expect(mocks.deletes).toHaveLength(0);
    await answerConfirm(true);
    await waitFor(() => expect(mocks.deletes).toEqual([['offers', 'o-1']]));
  });

  it('does not delete when cancelled', async () => {
    render(<AdminOffersTab />, { wrapper: ConfirmWrapper });
    await screen.findAllByText('PAPU10');
    fireEvent.click(screen.getByTitle('Delete'));
    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.deletes).toHaveLength(0);
  });
});
