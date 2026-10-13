import { describe, it, expect } from 'vitest';
import { pickRecipientAddress } from '@/lib/recipientInfo';

const A = { id: 'a', province: 'La Habana', municipality: 'Plaza' };
const B = { id: 'b', province: 'Matanzas', municipality: 'Varadero' };

describe('pickRecipientAddress', () => {
  it('returns the address matching the selected id, not the first one', () => {
    expect(pickRecipientAddress([A, B], 'b')).toBe(B);
  });

  it('falls back to the first address when no id is given', () => {
    expect(pickRecipientAddress([A, B], undefined)).toBe(A);
  });

  it('falls back to the first address when the id is unknown', () => {
    expect(pickRecipientAddress([A, B], 'zzz')).toBe(A);
  });

  it('returns undefined for missing or empty address lists', () => {
    expect(pickRecipientAddress(undefined, 'a')).toBeUndefined();
    expect(pickRecipientAddress([], 'a')).toBeUndefined();
  });
});
