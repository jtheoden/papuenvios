import { describe, it, expect, vi, beforeEach } from 'vitest';

const sb = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: sb }));
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError: vi.fn() }));

import { getOpenProposals, acceptCommission, resetBackendMissingForTests } from '@/lib/commissionProposalService';
import { PROPOSAL_COLUMNS } from '@/lib/commissionProposalRules';

const chain = (result) => {
  const q = { select: vi.fn(() => q), in: vi.fn(() => q), order: vi.fn(() => Promise.resolve(result)) };
  return q;
};

describe('commissionProposalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBackendMissingForTests();
  });

  it('getOpenProposals selects EXPLICIT columns (never *) for pending/informed rows of the given remittances', async () => {
    const q = chain({ data: [{ id: 'p1' }], error: null });
    sb.from.mockReturnValue(q);
    expect(await getOpenProposals(['r1', 'r2'])).toEqual([{ id: 'p1' }]);
    expect(sb.from).toHaveBeenCalledWith('remittance_commission_proposals');
    expect(q.select).toHaveBeenCalledWith(PROPOSAL_COLUMNS);
    expect(q.select.mock.calls[0][0]).not.toContain('*');
    expect(q.in).toHaveBeenCalledWith('remittance_id', ['r1', 'r2']);
    expect(q.in).toHaveBeenCalledWith('status', ['pending', 'informed']);
  });

  it('getOpenProposals does not query without ids', async () => {
    expect(await getOpenProposals([])).toEqual([]);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('getOpenProposals degrades to [] when the table does not exist yet (42P01 / schema cache)', async () => {
    sb.from.mockReturnValue(chain({ data: null, error: { code: '42P01', message: 'relation does not exist' } }));
    expect(await getOpenProposals(['r1'])).toEqual([]);
    sb.from.mockReturnValue(chain({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }));
    expect(await getOpenProposals(['r1'])).toEqual([]);
  });

  it('getOpenProposals throws other errors', async () => {
    sb.from.mockReturnValue(chain({ data: null, error: { code: '500', message: 'boom' } }));
    await expect(getOpenProposals(['r1'])).rejects.toBeTruthy();
  });

  it('acceptCommission calls the RPC with named arguments and returns the proposal', async () => {
    sb.rpc.mockResolvedValue({ data: { id: 'p1', status: 'accepted' }, error: null });
    expect(await acceptCommission('r1', 'p1')).toEqual({ id: 'p1', status: 'accepted' });
    expect(sb.rpc).toHaveBeenCalledWith('remittance_accept_commission', { p_remittance_id: 'r1', p_proposal_id: 'p1' });
  });

  it.each([
    [{ code: '22023', message: 'proposal_not_open' }, 'proposal_not_open'],
    [{ code: '22023', message: 'proposal_stale' }, 'proposal_stale'],
    [{ code: '22023', message: 'invalid_transition' }, 'invalid_transition'],
    [{ code: '42501', message: 'not_authorized' }, 'not_authorized'],
  ])('acceptCommission maps %j to an error with context.reason %s', async (error, reason) => {
    sb.rpc.mockResolvedValue({ data: null, error });
    await expect(acceptCommission('r1', 'p1')).rejects.toMatchObject({ context: { reason } });
  });

  it('acceptCommission rejects missing arguments without calling the RPC', async () => {
    await expect(acceptCommission('', 'p1')).rejects.toBeTruthy();
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it('after the first "missing" answer it stops querying (no console noise on every refetch)', async () => {
    sb.from.mockReturnValue(chain({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }));
    expect(await getOpenProposals(['r1'])).toEqual([]);
    expect(await getOpenProposals(['r1'])).toEqual([]);
    expect(sb.from).toHaveBeenCalledTimes(1);
  });
});
