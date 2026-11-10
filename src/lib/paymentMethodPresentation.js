/** Add visible, disabled payment choices that are not in an older DB catalog yet. */
export function includePlannedPaymentMethods(methods) {
  const rows = Array.isArray(methods) ? methods : [];
  if (rows.some((row) => row.code === 'iban')) return rows;

  return [
    ...rows,
    {
      code: 'iban',
      available: false,
      enabled_for_orders: false,
      enabled_for_remittances: false,
      planned_placeholder: true
    }
  ];
}
