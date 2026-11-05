import { describe, it, expect, vi } from 'vitest';
import { buildCartLinesLive, getCartItemUnitPrice } from '@/lib/cartPricing';

// The cart SHOWS prices converted with the cached display rates; the order must be priced with rates read live.
const cup = { id: 'p1', quantity: 2, base_currency_id: 'cup', final_price: '4000' };
const usd = { id: 'p2', quantity: 1, base_currency_id: 'usd', final_price: '10' };
const priceItem = (item, convertAmount) => getCartItemUnitPrice(item, { baseCurrencyId: 'usd', convertAmount });

describe('buildCartLinesLive', () => {
  it('prices every line with the rates returned by getRate (one read per pair actually needed)', async () => {
    const getRate = vi.fn(async (from, to) => (from === 'cup' && to === 'usd' ? 1 / 500 : NaN));
    const live = await buildCartLinesLive([cup, usd], priceItem, getRate);
    expect(getRate).toHaveBeenCalledWith('cup', 'usd');
    expect(getRate).toHaveBeenCalledTimes(1);
    expect(live.lines.map((l) => l.unitPrice)).toEqual([8, 10]);
    expect(live.subtotal).toBe(26);
    expect(live.hasInvalidLines).toBe(false);
  });

  it('fails closed (invalid line) when a live rate cannot be read', async () => {
    const live = await buildCartLinesLive([cup], priceItem, async () => { throw new Error('down'); });
    expect(live.hasInvalidLines).toBe(true);
  });

  it('needs no read at all for a cart already in the base currency', async () => {
    const getRate = vi.fn();
    const live = await buildCartLinesLive([usd], priceItem, getRate);
    expect(getRate).not.toHaveBeenCalled();
    expect(live.subtotal).toBe(10);
  });
});
