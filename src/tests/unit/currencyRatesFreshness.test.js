import { describe, it, expect, vi } from 'vitest';
import { API_CACHE_TTL_MS } from '@/lib/requestBudget';

describe('CurrencyContext refresh vs the request cache', () => {
  it('the cached rates read lives at most half the context refresh interval, so a forced refresh never reads an answer older than one interval', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const { RATE_REFRESH_MS } = await import('@/contexts/CurrencyContext');
    vi.unstubAllEnvs();
    expect(RATE_REFRESH_MS).toBeGreaterThan(0);
    expect(API_CACHE_TTL_MS * 2).toBeLessThanOrEqual(RATE_REFRESH_MS);
  });
});
