import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getOpenProposals } from '@/lib/commissionProposalService';
import { groupProposals } from '@/lib/commissionProposalRules';
import { logError } from '@/lib/errorHandler';

const EMPTY = { pending: {}, informed: {} };
const CAN_HAVE_PROPOSAL = ['payment_pending', 'payment_rejected'];
const CHUNK = 50; // uuid x 50 keeps the PostgREST URL far below the proxy limit

/**
 * Open commission proposals (pending raises, informed decreases) of the given remittances.
 * No subscription of its own: the pages already reload their remittances from the Realtime channel, and an
 * accept / admin adjustment always touches remittances.updated_at, so a changed signature triggers the refetch.
 * Any failure (including missing table before the migrations) degrades to "no proposals" without a visible error.
 */
const useCommissionProposals = (remittances) => {
  const [grouped, setGrouped] = useState(EMPTY);
  // Only remittances still awaiting payment can carry a proposal
  const open = useMemo(() => (remittances || []).filter((r) => CAN_HAVE_PROPOSAL.includes(r.status)), [remittances]);
  const ids = useMemo(() => open.map((r) => r.id), [open]);
  const signature = useMemo(() => open.map((r) => `${r.id}:${r.updated_at ?? ''}:${r.status}`).join('|'), [open]);
  const requestRef = useRef(0);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    const wanted = idsRef.current;
    if (wanted.length === 0) {
      setGrouped(EMPTY);
      return;
    }
    try {
      const chunks = [];
      for (let i = 0; i < wanted.length; i += CHUNK) chunks.push(wanted.slice(i, i + CHUNK));
      const rows = (await Promise.all(chunks.map((chunk) => getOpenProposals(chunk)))).flat();
      if (request === requestRef.current) setGrouped(groupProposals(rows)); // an older answer must not overwrite a newer one
    } catch (error) {
      logError(error, { operation: 'useCommissionProposals' });
      if (request === requestRef.current) setGrouped(EMPTY);
    }
  }, []);

  useEffect(() => {
    if (!signature) {
      requestRef.current += 1; // drop any in-flight answer for a list that no longer applies
      setGrouped(EMPTY);
      return;
    }
    refresh();
  }, [signature, refresh]);

  return { pending: grouped.pending, informed: grouped.informed, refresh };
};

export default useCommissionProposals;
