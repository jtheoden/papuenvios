import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ getAllShippingZones: vi.fn(), getShippingZonesForProvince: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'en' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {} }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/shippingService', () => ({
  getAllShippingZones: (...a) => mocks.getAllShippingZones(...a),
  getShippingZonesForProvince: (...a) => mocks.getShippingZonesForProvince(...a),
  updateShippingZone: vi.fn(),
  createShippingZone: vi.fn(),
  deleteShippingZone: vi.fn()
}));

import SettingsPageShipping from '@/components/settings/SettingsPageShipping';
import { AppError } from '@/lib/errorHandler';
import { ADMIN_COST_RPC_UNAVAILABLE } from '@/lib/adminCostService';

describe('SettingsPageShipping: transport costs come from an admin RPC', () => {
  beforeEach(() => {
    mocks.getAllShippingZones.mockReset();
    mocks.getShippingZonesForProvince.mockReset();
  });

  it('shows a clear alert and no editable zones when the cost RPC is missing', async () => {
    mocks.getAllShippingZones.mockRejectedValue(new AppError('missing', ADMIN_COST_RPC_UNAVAILABLE, 503));
    render(<SettingsPageShipping />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('products.catalogError.adminCosts'));
    // Nothing editable: saving a "new" zone with a default 0 transport cost would overwrite the real one.
    expect(screen.queryByText('La Habana')).toBeNull();
  });

  it('renders the zones and no alert when the load works', async () => {
    mocks.getAllShippingZones.mockResolvedValue([
      { id: 'z1', province_name: 'La Habana', municipality_name: null, shipping_cost: 5, transport_cost: 2, is_active: true, free_shipping: false }
    ]);
    render(<SettingsPageShipping />);
    await waitFor(() => expect(screen.getByText('La Habana')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
