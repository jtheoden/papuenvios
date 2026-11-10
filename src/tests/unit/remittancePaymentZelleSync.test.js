import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
const getUserMock = vi.fn();
const logActivityMock = vi.fn();
const upsertZelleMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    rpc: (...args) => rpcMock(...args),
    auth: { getUser: (...args) => getUserMock(...args) }
  }
}));

vi.mock('@/lib/activityLogger', () => ({
  logActivity: (...args) => logActivityMock(...args)
}));

vi.mock('@/lib/zelleService', () => ({
  pickAvailableZelleAccount: vi.fn(),
  registerZelleTransaction: vi.fn(),
  upsertZelleTransactionStatus: (...args) => upsertZelleMock(...args),
  ZELLE_STATUS: { PENDING: 'pending', VALIDATED: 'validated', REJECTED: 'rejected' },
  ZELLE_TRANSACTION_TYPES: { REMITTANCE: 'remittance', PRODUCT: 'product', COMBO: 'combo' }
}));

vi.mock('@/lib/whatsappService', () => ({
  notifyAdminNewPaymentProof: vi.fn(),
  notifyUserPaymentValidated: vi.fn().mockResolvedValue(undefined),
  notifyUserPaymentRejected: vi.fn().mockResolvedValue(undefined),
  notifyUserRemittanceDelivered: vi.fn()
}));

vi.mock('@/lib/notificationSettingsService', () => ({
  getFreshWhatsappRecipient: vi.fn()
}));

vi.mock('@/lib/orderDiscountService', () => ({
  recordOfferUsage: vi.fn()
}));

vi.mock('@/lib/currencyService', () => ({
  getExchangeRate: vi.fn()
}));

import { validatePayment, rejectPayment } from '@/lib/remittanceService';

const ADMIN = { id: 'admin-1', email: 'admin@example.com' };

const buildRemittance = (overrides = {}) => ({
  id: 'rem-1',
  remittance_number: 'REM-2026-0001',
  user_id: 'user-1',
  status: 'payment_proof_uploaded',
  amount_sent: 100,
  amount_to_deliver: 36000,
  zelle_account_id: 'zelle-1',
  ...overrides
});

/** What each transition RPC leaves on the row (the database applies it; here it is emulated). */
const AFTER_RPC = {
  remittance_validate_payment: { status: 'payment_validated', payment_validated: true },
  remittance_reject_payment: { status: 'payment_rejected' }
};

/**
 * The transition RPC answers with the row after the transition; the service then re-reads it with its type.
 */
const mockRemittanceTable = (remittance) => {
  let current = remittance;
  rpcMock.mockImplementation(async (name) => {
    current = { ...remittance, ...AFTER_RPC[name] };
    return { data: current, error: null };
  });
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: current, error: null })
      })
    })
  }));
};

const PERMISSION_DENIED = { code: '42501', message: 'permission denied for function redact_pii_jsonb' };

const NON_INSERTED_RESULTS = [
  ['error', { status: 'error', error: new Error('boom') }],
  ['queued after 42501', { status: 'queued', reason: 'rls_denied', error: PERMISSION_DENIED }]
];

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  getUserMock.mockReset();
  logActivityMock.mockReset();
  upsertZelleMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: ADMIN }, error: null });
  upsertZelleMock.mockResolvedValue({ id: 'tx-1' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('remittanceService.validatePayment — Zelle sync', () => {
  it.each(NON_INSERTED_RESULTS)(
    'syncs the Zelle transaction even when the activity log result is %s',
    async (_label, activityResult) => {
      mockRemittanceTable(buildRemittance());
      logActivityMock.mockResolvedValue(activityResult);

      const result = await validatePayment('rem-1');

      expect(result.status).toBe('payment_validated');
      expect(upsertZelleMock).toHaveBeenCalledTimes(1);
      expect(upsertZelleMock).toHaveBeenCalledWith({
        referenceId: 'rem-1',
        transactionType: 'remittance',
        status: 'validated',
        amount: 100,
        zelleAccountId: 'zelle-1',
        validatedBy: ADMIN.id
      });
    }
  );

  it('records amount_sent (amount paid via Zelle), never amount_to_deliver', async () => {
    const remittance = buildRemittance({ amount_sent: 250, amount_to_deliver: 90000 });
    mockRemittanceTable(remittance);
    logActivityMock.mockResolvedValue({ status: 'inserted' });

    await validatePayment('rem-1');
    await rejectPayment('rem-1', 'Amount does not match');

    expect(upsertZelleMock).toHaveBeenCalledTimes(2);
    upsertZelleMock.mock.calls.forEach(([params]) => {
      expect(params.amount).toBe(250);
      expect(params.amount).not.toBe(remittance.amount_to_deliver);
    });
  });

  it('syncs the Zelle transaction when the activity logger itself throws', async () => {
    mockRemittanceTable(buildRemittance());
    logActivityMock.mockRejectedValue(new Error('logger exploded'));

    await validatePayment('rem-1');

    expect(upsertZelleMock).toHaveBeenCalledTimes(1);
  });

  it('does not sync when the remittance has no zelle_account_id', async () => {
    mockRemittanceTable(buildRemittance({ zelle_account_id: null }));
    logActivityMock.mockResolvedValue({ status: 'inserted' });

    await validatePayment('rem-1');

    expect(upsertZelleMock).not.toHaveBeenCalled();
  });

  it('does not fail the validation when the Zelle sync fails', async () => {
    mockRemittanceTable(buildRemittance());
    logActivityMock.mockResolvedValue({ status: 'inserted' });
    upsertZelleMock.mockRejectedValue(new Error('zelle history unavailable'));

    const result = await validatePayment('rem-1');

    expect(upsertZelleMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('payment_validated');
    expect(result.payment_validated).toBe(true);
  });
});

describe('remittanceService.rejectPayment — Zelle sync', () => {
  it.each(NON_INSERTED_RESULTS)(
    'syncs the Zelle transaction even when the activity log result is %s',
    async (_label, activityResult) => {
      mockRemittanceTable(buildRemittance());
      logActivityMock.mockResolvedValue(activityResult);

      const result = await rejectPayment('rem-1', 'Amount does not match');

      expect(result.status).toBe('payment_rejected');
      expect(upsertZelleMock).toHaveBeenCalledTimes(1);
      expect(upsertZelleMock).toHaveBeenCalledWith({
        referenceId: 'rem-1',
        transactionType: 'remittance',
        status: 'rejected',
        amount: 100,
        zelleAccountId: 'zelle-1',
        validatedBy: ADMIN.id
      });
    }
  );

  it('does not sync when the remittance has no zelle_account_id', async () => {
    mockRemittanceTable(buildRemittance({ zelle_account_id: null }));
    logActivityMock.mockResolvedValue({ status: 'inserted' });

    await rejectPayment('rem-1', 'Amount does not match');

    expect(upsertZelleMock).not.toHaveBeenCalled();
  });

  it('does not fail the rejection when the Zelle sync fails', async () => {
    mockRemittanceTable(buildRemittance());
    logActivityMock.mockResolvedValue({ status: 'inserted' });
    upsertZelleMock.mockRejectedValue(new Error('zelle history unavailable'));

    const result = await rejectPayment('rem-1', 'Amount does not match');

    expect(upsertZelleMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('payment_rejected');
  });
});
