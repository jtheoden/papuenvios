/**
 * E7: every remittance status change goes through its remittance_* RPC (the database owns lock, matrix and history).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const state = { rpcResults: {}, rpcCalls: [], directWrites: [], uploads: [], selectRow: null };

const ROW = { id: 'rem-1', remittance_number: 'REM-1', user_id: 'u1', status: 'payment_pending', zelle_account_id: 'z1', amount_sent: 50, delivery_proof_url: null };

const rpcMock = vi.fn(async (name, args) => {
  state.rpcCalls.push([name, args]);
  const configured = state.rpcResults[name];
  if (configured !== undefined) return configured;
  return { data: { ...ROW }, error: null };
});

const makeQuery = (table) => {
  const q = {
    select: () => q,
    eq: () => q,
    single: async () => ({ data: state.selectRow ?? { ...ROW, remittance_types: { id: 't1' } }, error: null }),
    update: (payload) => {
      state.directWrites.push(['update', table, payload]);
      return q;
    },
    insert: (payload) => {
      state.directWrites.push(['insert', table, payload]);
      return q;
    }
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((t) => makeQuery(t)),
    rpc: (...a) => rpcMock(...a),
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@x.test' } }, error: null }) },
    storage: {
      from: (bucket) => ({
        upload: async (path) => {
          state.uploads.push({ bucket, path });
          return { error: null };
        }
      })
    }
  }
}));

vi.mock('@/lib/errorHandler', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, logError: vi.fn() };
});
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
const zelleUpsert = vi.fn(async () => ({}));
vi.mock('@/lib/zelleService', () => ({
  pickAvailableZelleAccount: vi.fn(),
  registerZelleTransaction: vi.fn(),
  upsertZelleTransactionStatus: (...a) => zelleUpsert(...a),
  ZELLE_STATUS: { PENDING: 'pending', VALIDATED: 'validated', REJECTED: 'rejected' },
  ZELLE_TRANSACTION_TYPES: { REMITTANCE: 'remittance', PRODUCT: 'product', COMBO: 'combo' }
}));
vi.mock('@/lib/whatsappService', async (importOriginal) => ({
  ...(await importOriginal()),
  notifyAdminNewPaymentProof: vi.fn(),
  notifyUserPaymentValidated: vi.fn(async () => {}),
  notifyUserPaymentRejected: vi.fn(async () => {}),
  notifyUserRemittanceDelivered: vi.fn(async () => {})
}));
vi.mock('@/lib/notificationSettingsService', () => ({ getFreshWhatsappRecipient: vi.fn() }));
vi.mock('@/lib/orderDiscountService', () => ({ recordOfferUsage: vi.fn() }));
vi.mock('@/lib/currencyService', () => ({ getExchangeRate: vi.fn() }));

import {
  uploadPaymentProof,
  cancelRemittance,
  validatePayment,
  rejectPayment,
  startProcessing,
  confirmDelivery,
  completeRemittance
} from '@/lib/remittanceService';

const png = { name: 'p.png', type: 'image/png', size: 10 };
const lastRpc = () => state.rpcCalls[state.rpcCalls.length - 1];

beforeEach(() => {
  Object.assign(state, { rpcResults: {}, rpcCalls: [], directWrites: [], uploads: [], selectRow: null });
  zelleUpsert.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('each function calls its RPC', () => {
  it('uploadPaymentProof uploads first, then remittance_submit_proof', async () => {
    await uploadPaymentProof('rem-1', png, ' REF-1 ', 'note', { payerPhone: '+1 305 555 0100' });
    expect(state.uploads).toHaveLength(1);
    const [name, args] = lastRpc();
    expect(name).toBe('remittance_submit_proof');
    expect(args).toMatchObject({ p_remittance_id: 'rem-1', p_proof_path: state.uploads[0].path, p_reference: 'REF-1', p_notes: 'note' });
    expect(args.p_payer_phone).toMatch(/305/);
  });

  it('cancelRemittance -> remittance_cancel with the reason (null when empty)', async () => {
    await cancelRemittance('rem-1', 'changed my mind');
    expect(lastRpc()).toEqual(['remittance_cancel', { p_remittance_id: 'rem-1', p_reason: 'changed my mind' }]);
    await cancelRemittance('rem-1');
    expect(lastRpc()).toEqual(['remittance_cancel', { p_remittance_id: 'rem-1', p_reason: null }]);
  });

  it('validatePayment -> remittance_validate_payment, then syncs Zelle', async () => {
    await validatePayment('rem-1', 'ok');
    expect(state.rpcCalls[0]).toEqual(['remittance_validate_payment', { p_remittance_id: 'rem-1' }]);
    expect(zelleUpsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'validated', referenceId: 'rem-1' }));
  });

  it('rejectPayment -> remittance_reject_payment with the reason, then syncs Zelle', async () => {
    await rejectPayment('rem-1', 'blurry');
    expect(state.rpcCalls[0]).toEqual(['remittance_reject_payment', { p_remittance_id: 'rem-1', p_reason: 'blurry' }]);
    expect(zelleUpsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }));
  });

  it('startProcessing -> remittance_start_processing', async () => {
    await startProcessing('rem-1');
    expect(lastRpc()).toEqual(['remittance_start_processing', { p_remittance_id: 'rem-1' }]);
  });

  it('confirmDelivery with a new file uploads it and passes the path', async () => {
    await confirmDelivery('rem-1', png, 'left at door');
    expect(state.uploads).toHaveLength(1);
    expect(lastRpc()).toEqual(['remittance_confirm_delivery', { p_remittance_id: 'rem-1', p_proof_path: state.uploads[0].path, p_notes: 'left at door' }]);
  });

  it('confirmDelivery without a file relies on the stored proof (path null)', async () => {
    state.selectRow = { ...ROW, delivery_proof_url: 'u1/delivery/x.png' };
    await confirmDelivery('rem-1', null, '');
    expect(lastRpc()).toEqual(['remittance_confirm_delivery', { p_remittance_id: 'rem-1', p_proof_path: null, p_notes: null }]);
    expect(state.uploads).toHaveLength(0);
  });

  it('confirmDelivery without a file and without a stored proof fails before the RPC', async () => {
    state.selectRow = { ...ROW, delivery_proof_url: null };
    await expect(confirmDelivery('rem-1', null, '')).rejects.toThrow(/proof/i);
    expect(state.rpcCalls).toEqual([]);
  });

  it('completeRemittance -> remittance_complete with the notes (null when empty)', async () => {
    await completeRemittance('rem-1', 'done');
    expect(lastRpc()).toEqual(['remittance_complete', { p_remittance_id: 'rem-1', p_notes: 'done' }]);
    await completeRemittance('rem-1');
    expect(lastRpc()).toEqual(['remittance_complete', { p_remittance_id: 'rem-1', p_notes: null }]);
  });

  it('returns the row re-read with remittance_types for the notifications', async () => {
    const row = await validatePayment('rem-1');
    expect(row.remittance_types).toEqual({ id: 't1' });
  });
});

describe('uploadPaymentProof pre-check (the upload overwrites a deterministic path)', () => {
  it.each(['payment_proof_uploaded', 'payment_validated', 'processing', 'delivered', 'completed', 'cancelled'])(
    'a %s remittance never reaches storage.upload nor the RPC',
    async (status) => {
      state.selectRow = { ...ROW, status };
      await expect(uploadPaymentProof('rem-1', png, 'R', '', { payerPhone: '+1 305 555 0100' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(state.uploads).toEqual([]);
      expect(state.rpcCalls).toEqual([]);
    }
  );

  it.each(['payment_pending', 'payment_rejected'])('a %s remittance uploads', async (status) => {
    state.selectRow = { ...ROW, status };
    await uploadPaymentProof('rem-1', png, 'R', '', { payerPhone: '+1 305 555 0100' });
    expect(state.uploads).toHaveLength(1);
  });
});

describe('error mapping', () => {
  it('22023 invalid_transition -> CONFLICT, no Zelle sync, no notification side effects', async () => {
    state.rpcResults.remittance_validate_payment = { data: null, error: { code: '22023', message: 'invalid_transition', details: '{"status":"processing"}' } };
    await expect(validatePayment('rem-1')).rejects.toMatchObject({ code: 'CONFLICT', context: { reason: 'invalid_transition' } });
    expect(zelleUpsert).not.toHaveBeenCalled();
  });

  it('invalid_argument -> VALIDATION_FAILED', async () => {
    state.rpcResults.remittance_reject_payment = { data: null, error: { code: '22023', message: 'invalid_argument', details: 'reason' } };
    await expect(rejectPayment('rem-1', 'x')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('no client status write remains', () => {
  it('none of the seven functions updates remittances directly', async () => {
    await uploadPaymentProof('rem-1', png, 'R', '', { payerPhone: '+1 305 555 0100' });
    await cancelRemittance('rem-1', 'x');
    await validatePayment('rem-1');
    await rejectPayment('rem-1', 'x');
    await startProcessing('rem-1');
    state.selectRow = { ...ROW, delivery_proof_url: 'p' };
    await confirmDelivery('rem-1');
    await completeRemittance('rem-1');
    expect(state.directWrites).toEqual([]);
  });

  it('the source has no REMITTANCE_STATUS write in an update payload', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/remittanceService.js'), 'utf8');
    expect(src).not.toMatch(/status:\s*REMITTANCE_STATUS\.(PAYMENT_PROOF_UPLOADED|CANCELLED|PAYMENT_VALIDATED|PAYMENT_REJECTED|PROCESSING|DELIVERED|COMPLETED)/);
  });
});
