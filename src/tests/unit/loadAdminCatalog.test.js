import { describe, it, expect, vi } from 'vitest';
import { loadAdminCatalog } from '@/lib/adminCatalogLoader';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

describe('loadAdminCatalog', () => {
  it('starts products, testimonials and combos together instead of sequentially', async () => {
    const products = deferred();
    const refreshProducts = vi.fn(() => products.promise);
    const refreshTestimonials = vi.fn(async () => {});
    const refreshCombos = vi.fn(async () => {});

    const pending = loadAdminCatalog({ refreshProducts, refreshTestimonials, refreshCombos });

    // Nothing has resolved yet and all three loads are already running
    expect(refreshProducts).toHaveBeenCalledWith(true);
    expect(refreshTestimonials).toHaveBeenCalledWith(true);
    expect(refreshCombos).toHaveBeenCalledWith(true, products.promise);

    products.resolve([]);
    await pending;
  });

  it('does not reject when one of the loads fails', async () => {
    const refreshProducts = vi.fn(async () => { throw new Error('boom'); });
    const refreshTestimonials = vi.fn(async () => {});
    const refreshCombos = vi.fn(async () => {});

    await expect(
      loadAdminCatalog({ refreshProducts, refreshTestimonials, refreshCombos })
    ).resolves.toBeUndefined();
    expect(refreshTestimonials).toHaveBeenCalled();
    expect(refreshCombos).toHaveBeenCalled();
  });
});
