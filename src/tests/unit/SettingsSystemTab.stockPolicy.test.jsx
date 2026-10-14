import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/platformResetService', () => ({
  getPlatformResetStatus: vi.fn(async () => ({ enabled: false })),
  executePlatformReset: vi.fn()
}));
vi.mock('@/components/settings/StockPolicyCard', () => ({
  default: () => <section data-testid="stock-policy-card" />
}));

import SettingsSystemTab from '@/components/settings/SettingsSystemTab';

describe('SettingsSystemTab - stock policy card', () => {
  it('renders the stock policy card ABOVE the platform reset section', async () => {
    render(<SettingsSystemTab />);

    const card = screen.getByTestId('stock-policy-card');
    const resetHeading = await screen.findByText(/Reset de plataforma/);

    expect(card.compareDocumentPosition(resetHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
