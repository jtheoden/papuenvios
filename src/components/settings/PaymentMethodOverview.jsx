import React from 'react';

/** A shared overview frame; rates, status and actions are slots so each payment method keeps its own workflow. */
export default function PaymentMethodOverview({ id, title, description, rates, status, actions, className = '' }) {
  return (
    <section
      data-testid="payment-method-overview"
      className={`rounded-xl border border-theme-accent-line bg-white/70 p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={id} className="text-xl font-semibold text-gray-900 sm:text-2xl">{title}</h2>
          <p className="mt-1 text-sm text-gray-700">{description}</p>
        </div>
        {(status || actions) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {status && <div data-testid="payment-method-status">{status}</div>}
            {actions && <div data-testid="payment-method-actions">{actions}</div>}
          </div>
        )}
      </div>
      {rates && <div data-testid="payment-method-rates" className="mt-4">{rates}</div>}
    </section>
  );
}
