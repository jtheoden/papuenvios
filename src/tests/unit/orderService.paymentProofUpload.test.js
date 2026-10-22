import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORDER = {
  id: 'ord-1',
  order_number: 'ORD-1',
  user_id: 'user-1',
  status: 'pending',
  payment_status: 'pending',
  payment_method: 'zelle',
  total_amount: 10,
  payment_reference: 'John'
};

const state = { updatePayload: null, rpcCalls: [] };
const uploadMock = vi.fn(async () => ({ error: null }));
const getPublicUrlMock = vi.fn(() => ({ data: { publicUrl: 'https://public.test/leak' } }));

const makeQuery = () => {
  const q = {
    select: () => q,
    eq: () => q,
    single: async () => ({ data: ORDER, error: null }),
    update: (payload) => {
      state.updatePayload = payload;
      return q;
    },
    then: (resolve) => resolve({ data: [], error: null })
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => makeQuery()),
    rpc: vi.fn(async (name, args) => {
      state.rpcCalls.push([name, args]);
      return { data: { ...ORDER, payment_status: 'proof_uploaded' }, error: null };
    }),
    storage: {
      from: vi.fn(() => ({
        upload: (...args) => uploadMock(...args),
        getPublicUrl: (...args) => getPublicUrlMock(...args)
      }))
    }
  }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ getUserCategoryWithDiscount: vi.fn(), recordOfferUsage: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({
  ZELLE_STATUS: {},
  ZELLE_TRANSACTION_TYPES: {},
  upsertZelleTransactionStatus: vi.fn()
}));

import { uploadPaymentProof } from '@/lib/orderService';

const png = (name = 'proof.png') => new File(['x'], name, { type: 'image/png' });
const PHONE = '+13055550100';

beforeEach(() => {
  state.updatePayload = null;
  state.rpcCalls = [];
  vi.clearAllMocks();
});

describe('orderService.uploadPaymentProof (private bucket)', () => {
  it('stores the storage PATH, never a public URL, and does not call getPublicUrl', async () => {
    const result = await uploadPaymentProof(png(), 'ord-1', 'user-1', 'John', { payerPhone: PHONE });
    expect(getPublicUrlMock).not.toHaveBeenCalled();
    expect(result).toMatch(/^payment-proofs\/payment-proof-ord-1-\d+\.png$/);
    expect(state.rpcCalls[0]).toEqual(['order_submit_proof', expect.objectContaining({ p_order_id: 'ord-1', p_proof_path: result })]);
    expect(state.updatePayload).toBeNull();
    expect(uploadMock.mock.calls[0][0]).toBe(result);
  });

  it('derives the extension from the validated MIME, not from the file name', async () => {
    const file = new File(['x'], 'evil.html', { type: 'image/webp' });
    const result = await uploadPaymentProof(file, 'ord-1', 'user-1', 'John', { payerPhone: PHONE });
    expect(result).toMatch(/\.webp$/);
  });

  it('rejects text/html without uploading', async () => {
    const file = new File(['<script>'], 'proof.png', { type: 'text/html' });
    await expect(uploadPaymentProof(file, 'ord-1', 'user-1', 'John', { payerPhone: PHONE })).rejects.toBeTruthy();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rejects files larger than 5 MB without uploading', async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await expect(uploadPaymentProof(big, 'ord-1', 'user-1', 'John', { payerPhone: PHONE })).rejects.toBeTruthy();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
