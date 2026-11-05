import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';

const ROWS = [
  ['order_submitted', 'order'],
  ['payment_proof_uploaded', 'order'],
  ['user_management_fetch_users_success', 'user_management'],
  ['user_management_export_csv_start', 'user_management'],
  ['checkout_initiated', 'cart'],
  ['category_created', 'category'],
  ['brand_new_thing', 'weird_entity']
].map(([action, entity_type], i) => ({
  id: `row-${i}`,
  action,
  entity_type,
  performed_by: 'admin@x.test',
  description: 'free text',
  metadata: null,
  created_at: '2026-11-05T10:00:00.000Z'
}));

vi.mock('@/lib/activityLogger', () => ({ fetchActivityLogs: vi.fn(async () => ROWS) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeActivityLogs: () => {} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: true }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {} }) }));

import { LanguageProvider } from '@/contexts/LanguageContext';
import ActivityLogTab from '@/components/ActivityLogTab';

const EXPECTED = {
  es: ['Pedido enviado', 'Comprobante de pago subido', 'Compra iniciada', 'Categoría creada', 'Brand new thing', 'Weird entity'],
  en: ['Order submitted', 'Payment proof uploaded', 'Checkout started', 'Category created', 'Brand new thing', 'Weird entity']
};

const renderTab = async () => {
  render(
    <LanguageProvider>
      <ActivityLogTab />
    </LanguageProvider>
  );
  await waitFor(() => expect(screen.getAllByText('admin@x.test').length).toBeGreaterThan(0));
};

describe.each(['es', 'en'])('ActivityLogTab labels (%s)', (lang) => {
  beforeEach(() => {
    localStorage.setItem('preferredLanguage', lang);
  });

  it('renders translated action and entity labels, never raw keys', async () => {
    await renderTab();
    const text = document.body.textContent;
    expect(text).not.toContain('activityLog.');
    for (const row of ROWS) {
      expect(text).not.toContain(row.action);
      expect(text).not.toContain(row.entity_type);
    }
    expect(text).not.toMatch(/User_management/i);
    for (const label of EXPECTED[lang]) expect(text).toContain(label);
  });

  it('does not force capitalize on the entity cell', async () => {
    await renderTab();
    const cell = screen.getAllByText(EXPECTED[lang][5])[0];
    expect(cell.className).not.toContain('capitalize');
  });

  it('shows translated labels in the detail modal too', async () => {
    await renderTab();
    fireEvent.click(screen.getAllByText('admin@x.test')[0]);
    const heading = await screen.findByText(lang === 'es' ? 'Detalles de Actividad' : 'Activity Details');
    const modal = heading.closest('div.bg-white');
    expect(within(modal).queryByText('order_submitted')).toBeNull();
    expect(modal.textContent).not.toContain('activityLog.');
    expect(modal.textContent).not.toMatch(/[a-z]_[a-z]/);
  });
});
