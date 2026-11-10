import React, { useEffect, useState } from 'react';

/** Shared active-rate badge for payment method tabs (USD/Zelle, EUR/Bizum and EUR/IBAN). */
export default function PaymentRateBadge({ sourceCurrency, targetCurrency = 'CUP', language = 'es' }) {
  const [rate, setRate] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    import('@/lib/currencyService')
      .then(({ getActiveRate }) => getActiveRate(sourceCurrency, targetCurrency))
      .then(result => {
        if (cancelled) return;
        setRate(result);
        setStatus(result ? 'active' : 'missing');
      })
      .catch(() => {
        if (cancelled) return;
        setRate(null);
        setStatus('missing');
      });
    return () => { cancelled = true; };
  }, [sourceCurrency, targetCurrency]);

  const isEnglish = language === 'en';
  const formattedRate = rate?.rate?.toLocaleString(isEnglish ? 'en-US' : 'es-ES', { maximumFractionDigits: 6 });
  const text = status === 'active'
    ? `${isEnglish ? 'Active rate' : 'Tasa activa'} · 1 ${sourceCurrency} = ${formattedRate} ${targetCurrency}`
    : status === 'loading'
      ? (isEnglish ? 'Loading active rate…' : 'Cargando tasa activa…')
      : (isEnglish ? `No active ${sourceCurrency}/${targetCurrency} rate` : `Sin tasa activa ${sourceCurrency}/${targetCurrency}`);

  return (
    <span
      role="status"
      data-testid={`payment-rate-${sourceCurrency.toLowerCase()}`}
      data-rate-status={status}
      className="inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-semibold"
      style={{
        borderColor: status === 'missing' ? 'hsl(var(--destructive, 0 72% 51%))' : 'rgb(var(--t-accent))',
        backgroundColor: status === 'missing' ? 'hsl(var(--destructive, 0 72% 51%) / 0.08)' : 'rgb(var(--t-accent) / 0.1)',
        color: status === 'missing' ? 'hsl(var(--destructive, 0 72% 36%))' : 'rgb(var(--t-ink))'
      }}
    >
      {text}
    </span>
  );
}
