import { describe, it, expect, vi, beforeEach } from 'vitest';

const TYPE = {
  id: 'type-1',
  currency_code: 'USD',
  delivery_currency: 'CUP',
  exchange_rate: 400,
  commission_percentage: 0,
  commission_fixed: 0,
  min_amount: 1,
  max_amount: null,
  delivery_method: 'cash'
};

const state = { type: { ...TYPE }, insertPayload: null };

const makeQuery = (table) => {
  const q = {
    select: () => q,
    eq: () => q,
    or: () => q,
    insert: (rows) => {
      state.insertPayload = rows[0];
      return q;
    },
    single: async () => {
      if (table === 'remittance_types') return { data: state.type, error: null };
      if (table === 'remittances') {
        return { data: { id: 'rem-1', remittance_number: 'REM-1', ...state.insertPayload }, error: null };
      }
      return { data: null, error: null };
    }
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => makeQuery(table)),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))
    }
  }
}));

vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ recordOfferUsage: vi.fn() }));
vi.mock('@/lib/currencyService', () => ({ getExchangeRate: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({ getFreshWhatsappRecipient: vi.fn() }));
vi.mock('@/lib/whatsappService', () => ({
  notifyAdminNewPaymentProof: vi.fn(),
  notifyUserPaymentValidated: vi.fn(),
  notifyUserPaymentRejected: vi.fn(),
  notifyUserRemittanceDelivered: vi.fn()
}));

vi.mock('@/lib/zelleService', () => ({
  reserveZelleAccount: vi.fn(async () => ({ id: 'zelle-1' })),
  registerZelleTransaction: vi.fn(async () => ({})),
  upsertZelleTransactionStatus: vi.fn(),
  ZELLE_STATUS: {},
  ZELLE_TRANSACTION_TYPES: { REMITTANCE: 'remittance' }
}));

vi.mock('@/lib/shippingService', () => ({
  getActiveShippingZones: vi.fn(),
  calculateShippingCost: vi.fn()
}));

import { createRemittance } from '@/lib/remittanceService';
import { reserveZelleAccount, registerZelleTransaction } from '@/lib/zelleService';
import { getActiveShippingZones, calculateShippingCost } from '@/lib/shippingService';

const ZONE = { id: 'zone-1', province_name: 'La Habana', municipality_name: null, shipping_cost: 7, free_shipping: false, is_active: true };
const BASE_INPUT = {
  remittance_type_id: 'type-1',
  amount: 100,
  recipient_name: 'Ana',
  recipient_phone: '+5355555555',
  recipient_province: 'La Habana',
  recipient_municipality: null
};

describe('createRemittance delivery cost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.type = { ...TYPE };
    state.insertPayload = null;
    getActiveShippingZones.mockResolvedValue([ZONE]);
    calculateShippingCost.mockResolvedValue({ cost: 7, freeShipping: false, zone: ZONE, source: 'province' });
  });

  it('persists delivery_cost and shipping_zone_id for cash delivery', async () => {
    await createRemittance(BASE_INPUT);

    expect(calculateShippingCost).toHaveBeenCalledWith('La Habana', 100, null);
    expect(state.insertPayload.delivery_cost).toBe(7);
    expect(state.insertPayload.shipping_zone_id).toBe('zone-1');
    expect(state.insertPayload.amount_sent).toBe(100);
  });

  it('does not reduce amount_to_deliver by the delivery cost', async () => {
    await createRemittance(BASE_INPUT);
    expect(state.insertPayload.amount_to_deliver).toBe(40000);
  });

  it('stores 0 and null for non-cash delivery and never resolves a zone', async () => {
    state.type = { ...TYPE, delivery_method: 'transfer' };
    await createRemittance(BASE_INPUT);

    expect(calculateShippingCost).not.toHaveBeenCalled();
    expect(state.insertPayload.delivery_cost).toBe(0);
    expect(state.insertPayload.shipping_zone_id).toBeNull();
  });

  it('stores a 0 cost with the zone id for a free-shipping zone', async () => {
    const freeZone = { ...ZONE, free_shipping: true, shipping_cost: 0 };
    getActiveShippingZones.mockResolvedValue([freeZone]);
    calculateShippingCost.mockResolvedValue({ cost: 0, freeShipping: true, zone: freeZone, source: 'province' });

    await createRemittance(BASE_INPUT);

    expect(state.insertPayload.delivery_cost).toBe(0);
    expect(state.insertPayload.shipping_zone_id).toBe('zone-1');
  });

  it('refuses an unavailable zone before reserving Zelle or inserting', async () => {
    getActiveShippingZones.mockResolvedValue([{ ...ZONE, shipping_cost: 0, free_shipping: false }]);

    await expect(createRemittance(BASE_INPUT)).rejects.toMatchObject({ code: expect.any(String) });

    expect(reserveZelleAccount).not.toHaveBeenCalled();
    expect(registerZelleTransaction).not.toHaveBeenCalled();
    expect(state.insertPayload).toBeNull();
  });

  it('refuses a cash remittance without a destination province', async () => {
    await expect(
      createRemittance({ ...BASE_INPUT, recipient_province: undefined })
    ).rejects.toBeTruthy();
    expect(state.insertPayload).toBeNull();
  });

  it('reserves and registers the Zelle amount as amount_sent + delivery_cost', async () => {
    await createRemittance(BASE_INPUT);

    expect(reserveZelleAccount).toHaveBeenCalledWith('remittance', 107);
    expect(registerZelleTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ reference_id: 'rem-1', amount: 107 })
    );
  });

  it('keeps the Zelle amount equal to amount_sent for non-cash delivery', async () => {
    state.type = { ...TYPE, delivery_method: 'transfer' };
    await createRemittance(BASE_INPUT);

    expect(reserveZelleAccount).toHaveBeenCalledWith('remittance', 100);
    expect(registerZelleTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }));
  });
});
