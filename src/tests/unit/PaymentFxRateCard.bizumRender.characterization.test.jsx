import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { tEcho } = await import('./helpers/bizumTestUtils.js');
  return { useLanguage: () => ({ t: tEcho, language: 'en' }) };
});

import PaymentFxRateCard from '@/components/settings/PaymentFxRateCard';
import PaymentFxBadge from '@/components/settings/PaymentFxBadge';
import { toBizumError } from '@/lib/bizumErrors';

// RB-17 characterization: pins the Bizum (default, no `pair`) render so generalizing the card cannot change it.
// Decorative icons are aria-hidden SVGs; they are stripped so only the pre-existing markup is pinned.
const markup = (container) => container.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '');

const status = (over = {}) => ({
  id: 'r1', mid_rate: 0.9234, spread_pct: 1.5, effective_rate: 0.937251, source: 'exchange_rates', created_by: null,
  created_at: '2026-10-15T10:00:00Z', age_hours: 3.5, state: 'ok', fx_warn_hours: 24, fx_block_hours: 96, ...over
});

describe('Bizum rate card markup (default props)', () => {
  const cases = {
    ok: status(),
    warn: status({ state: 'warn', age_hours: 30 }),
    blocked: status({ state: 'blocked', age_hours: 120 }),
    none: { state: 'none', id: null, fx_warn_hours: 24, fx_block_hours: 96 }
  };

  it.each(Object.entries(cases))('state %s renders the same markup', (_, s) => {
    const { container } = render(<PaymentFxRateCard status={s} error={null} onRetry={() => {}} onGoToFinancial={() => {}} />);
    expect(markup(container)).toMatchSnapshot();
  });

  it('load error renders the same markup', () => {
    const { container } = render(
      <PaymentFxRateCard status={null} error={toBizumError({ code: 'XX000', message: 'boom' })} onRetry={() => {}} />
    );
    expect(markup(container)).toMatchSnapshot();
  });

  it.each(['ok', 'warn', 'blocked', 'none'])('badge %s renders the same markup', (state) => {
    const { container } = render(<PaymentFxBadge status={{ state }} />);
    expect(markup(container)).toMatchSnapshot();
  });
});
