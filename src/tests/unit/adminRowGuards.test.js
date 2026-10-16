import { describe, it, expect } from 'vitest';
import { hasAdminProductFields, hasAdminComboFields } from '@/lib/adminCatalogColumns';

describe('admin row guards: public rows must never seed an admin edit form', () => {
  it('recognises a product row that carries its cost fields', () => {
    expect(hasAdminProductFields({ id: 'p1', base_price: 10, profit_margin: 30 })).toBe(true);
    expect(hasAdminProductFields({ id: 'p1', base_price: 0, profit_margin: 0 })).toBe(true);
  });

  it('rejects a public product row (no cost fields)', () => {
    expect(hasAdminProductFields({ id: 'p1', final_price: 13 })).toBe(false);
    expect(hasAdminProductFields({ id: 'p1', base_price: null })).toBe(false);
    expect(hasAdminProductFields(undefined)).toBe(false);
  });

  it('recognises a combo row that carries its cost fields', () => {
    expect(hasAdminComboFields({ id: 'c1', baseTotalPrice: 50, profitMargin: 20 })).toBe(true);
    expect(hasAdminComboFields({ id: 'c1', baseTotalPrice: 0, profitMargin: 0 })).toBe(true);
  });

  it('rejects a public combo row (no cost fields)', () => {
    expect(hasAdminComboFields({ id: 'c1', finalPrice: 66 })).toBe(false);
    expect(hasAdminComboFields({ id: 'c1', baseTotalPrice: 50 })).toBe(false);
    expect(hasAdminComboFields(null)).toBe(false);
  });
});
