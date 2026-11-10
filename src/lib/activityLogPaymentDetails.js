const PAYMENT_METHODS = new Set(['zelle', 'bizum', 'iban']);

/** Extract only explicit payment facts from activity metadata; never infer zeros. */
export function getActivityPaymentDetails(log, language = 'es') {
  const metadata = log?.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;

  const method = String(metadata.paymentMethod || metadata.payment_method || '').toLowerCase();
  if (!PAYMENT_METHODS.has(method)) return null;

  const amountValue = metadata.paymentAmount ?? metadata.payment_amount;
  const currencyValue = metadata.paymentCurrency ?? metadata.payment_currency;
  const amount = amountValue === null || amountValue === undefined || amountValue === ''
    ? null
    : Number(amountValue);
  const currency = typeof currencyValue === 'string' ? currencyValue.trim().toUpperCase() : '';
  let formattedAmount = null;

  if (Number.isFinite(amount) && currency) {
    try {
      formattedAmount = new Intl.NumberFormat(language === 'es' ? 'es-ES' : 'en-US', {
        style: 'currency',
        currency
      }).format(amount);
    } catch {
      formattedAmount = `${amount.toLocaleString(language === 'es' ? 'es-ES' : 'en-US')} ${currency}`;
    }
  }

  return {
    method: method.toUpperCase(),
    amount: formattedAmount,
    reference: metadata.orderNumber || metadata.remittanceNumber || null
  };
}
