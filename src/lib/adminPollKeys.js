// src/lib/adminPollKeys.js
// Shared polling keys and write predicate for admin pending work (no service imports: hooks and tests stay light).

export const ADMIN_PENDING_KEY = 'admin:pending-counts';
export const REFUND_COUNTS_KEY = 'admin:refund-counts';
export const REFUND_QUEUE_KEY = 'admin:refund-queue';
export const WORK_REMITTANCES_KEY = 'admin:work-remittances';

/** Own writes that can change pending work: orders, remittances, refunds and any mutating RPC. */
export const affectsAdminPending = (path) => /^\/rest\/v1\/(orders|remittances|refund_requests|rpc\/)/.test(path);
