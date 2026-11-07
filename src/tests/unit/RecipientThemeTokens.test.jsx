import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ getMyRecipients: vi.fn(), toast: vi.fn() }));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => mocks.toast(...args) }));
vi.mock('@/lib/recipientService', () => ({
  getMyRecipients: (...args) => mocks.getMyRecipients(...args),
  createRecipient: vi.fn(),
  addRecipientAddress: vi.fn()
}));
vi.mock('@/components/BankAccountSelector', () => ({ default: () => null }));

import RecipientSelector from '@/components/RecipientSelector';
import ProvinceSelector from '@/components/ProvinceSelector';

const zones = [
  { id: 'province', province_name: 'Matanzas', municipality_name: null, shipping_cost: 5, free_shipping: false, is_active: true },
  { id: 'municipality', province_name: 'Matanzas', municipality_name: 'Colón', shipping_cost: 4, free_shipping: false, is_active: true }
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMyRecipients.mockResolvedValue([
    { id: 'recipient-1', full_name: 'Ana Pérez', phone: '+53 5555 5555', addresses: [{ id: 'address-1', province: 'Matanzas', municipality: 'Colón', address_line_1: 'Calle 1', is_default: true }] }
  ]);
});

describe('recipient UI follows active theme tokens', () => {
  it('marks selected recipients for PapuEnvios-only token overrides while keeping Classic classes intact', async () => {
    render(<RecipientSelector onSelect={vi.fn()} shippingZones={zones} deliveryMethod="cash" />);
    const card = await screen.findByRole('button', { name: /Ana Pérez/ });
    fireEvent.click(card);

    expect(card.className).toContain('recipient-theme-card-selected');
    expect(card.className).toContain('border-blue-500');
    expect(card.className).toContain('bg-blue-50');
  });

  it('retains the former Classic selected-recipient and selected-address utilities as the baseline', async () => {
    mocks.getMyRecipients.mockResolvedValue([
      {
        id: 'recipient-1',
        full_name: 'Ana Pérez',
        phone: '+53 5555 5555',
        addresses: [
          { id: 'address-1', province: 'Matanzas', municipality: 'Colón', address_line_1: 'Calle 1', is_default: true },
          { id: 'address-2', province: 'Matanzas', municipality: 'Jovellanos', address_line_1: 'Calle 2', is_default: false }
        ]
      }
    ]);
    render(<RecipientSelector onSelect={vi.fn()} shippingZones={zones} deliveryMethod="cash" showAddressSelection />);
    const card = await screen.findByRole('button', { name: /Ana Pérez/ });
    fireEvent.click(card);
    expect(card.className).toContain('border-blue-500');
    expect(card.className).toContain('bg-blue-50');

    const address = screen.getByRole('button', { name: /Calle 1/ });
    fireEvent.click(address);
    expect(address.className).toContain('border-green-500');
    expect(address.className).toContain('bg-green-50');
  });

  it('uses tokenized focus and chrome for province and municipality selectors while retaining shipping costs', () => {
    render(
      <ProvinceSelector
        shippingZones={zones}
        selectedProvince="Matanzas"
        municipalities={['Colón']}
        onProvinceChange={vi.fn()}
        onMunicipalityChange={vi.fn()}
      />
    );
    const selects = screen.getAllByRole('combobox');

    for (const select of selects) {
      expect(select.className).toContain('recipient-theme-control');
      expect(select.className).not.toContain('focus-visible:ring-theme-focus');
    }
    expect(screen.getByRole('option', { name: /Colón - \$4\.00/ })).toBeInTheDocument();
  });
});
