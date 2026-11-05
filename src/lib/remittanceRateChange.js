import { roundTo } from '@/lib/moneyPure';

/**
 * Compare the rate locked on a remittance with the current rate of its type.
 * Deliberately returns NO amounts: recalculate_remittance_at_current_rate can apply an admin commission override
 * and offers that the owner cannot read (RLS), so a client-side figure could differ from what the RPC delivers.
 * Follow-up (Phase 3/F4): a read-only SQL function that quotes with the RPC's own logic.
 * Same-currency remittances (USD to USD) always use rate 1 in SQL, so there is no rate change to report.
 */
export const quoteRateChange = (remittance) => {
  const type = remittance?.remittance_types;
  const snapshotRate = remittance?.exchange_rate;
  const currentRate = type?.exchange_rate;
  if (!type || !Number.isFinite(snapshotRate) || snapshotRate <= 0 || !Number.isFinite(currentRate) || currentRate <= 0) {
    return null;
  }

  const sent = remittance.currency_sent ?? type.currency_code;
  const delivered = remittance.currency_delivered ?? type.delivery_currency;
  if (sent && delivered && sent === delivered) return null;

  return {
    snapshotRate,
    currentRate,
    rateUp: currentRate > snapshotRate,
    pctChange: roundTo((currentRate - snapshotRate) / snapshotRate * 100, 2)
  };
};
