// src/lib/adminPendingCounts.js
//
// Pending work for admins (orders + remittances + refund counts) for the header badge, read as ONE answer so the
// badge never shows a half-updated sum. The dashboard refunds card and the refunds queue watch it (watchPoll).
// A failing source reads as 0 (refunds: null) without hiding the others.
import { getPendingOrdersCount } from '@/lib/orderService';
import { getPendingRemittancesCount } from '@/lib/remittanceService';
import { getRefundCounts } from '@/lib/refundService';

export { ADMIN_PENDING_KEY, affectsAdminPending } from '@/lib/adminPollKeys';

/** @returns {Promise<{ orders: number, remittances: number, refunds: object|null }>} */
export const loadAdminPendingCounts = async () => {
  const [orders, remittances, refunds] = await Promise.all([
    getPendingOrdersCount().catch((error) => {
      console.error('Error loading pending orders:', error);
      return 0;
    }),
    getPendingRemittancesCount(),
    getRefundCounts().catch(() => null)
  ]);
  return { orders: orders || 0, remittances: remittances || 0, refunds };
};
