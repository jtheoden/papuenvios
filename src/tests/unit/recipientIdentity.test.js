import { describe, it, expect } from 'vitest';
import {
  normalizeRecipientName,
  normalizeRecipientPhone,
  isSameRecipient,
  findSamePhone,
  describeRecipient,
  findEquivalentAddress
} from '@/lib/recipientIdentity';

describe('normalizeRecipientName', () => {
  it('trims, collapses inner whitespace and lowercases', () => {
    expect(normalizeRecipientName('  Ana   María  PÉREZ ')).toBe('ana maría pérez');
  });
  it('tolerates null and undefined', () => {
    expect(normalizeRecipientName(null)).toBe('');
    expect(normalizeRecipientName(undefined)).toBe('');
  });
});

describe('normalizeRecipientPhone', () => {
  it('keeps digits only', () => {
    expect(normalizeRecipientPhone('+53 (5) 555-5555')).toBe('5355555555');
  });
  it('tolerates null', () => {
    expect(normalizeRecipientPhone(null)).toBe('');
  });
});

describe('isSameRecipient', () => {
  const a = { full_name: 'Ana Pérez', phone: '+53 5555 5555' };
  it('matches on normalized name AND phone', () => {
    expect(isSameRecipient(a, { full_name: ' ana  pérez', phone: '5355555555' })).toBe(true);
  });
  it('does not match a different person sharing the phone (family case)', () => {
    expect(isSameRecipient(a, { full_name: 'Luis Pérez', phone: '5355555555' })).toBe(false);
  });
  it('does not match the same name with another phone', () => {
    expect(isSameRecipient(a, { full_name: 'Ana Pérez', phone: '5399999999' })).toBe(false);
  });
});

describe('findSamePhone', () => {
  const list = [
    { id: '1', full_name: 'Ana', phone: '+53 5555 5555' },
    { id: '2', full_name: 'Luis', phone: '5300000000' }
  ];
  it('returns the recipient with the same digits', () => {
    expect(findSamePhone(list, '53 5555-5555')?.id).toBe('1');
  });
  it('returns null for short or unknown phones', () => {
    expect(findSamePhone(list, '555')).toBeNull();
    expect(findSamePhone(list, '5311111111')).toBeNull();
  });
});

describe('describeRecipient', () => {
  const recipient = {
    addresses: [
      { municipality: 'Playa', is_default: false },
      { municipality: 'Centro Habana', is_default: true }
    ],
    bank_links: [
      { is_active: false, bank_account: { account_number_last4: '0000', bank: { name: 'Old' } } },
      { is_active: true, bank_account: { account_number_last4: '1234', bank: { name: 'BANDEC' } } }
    ]
  };
  it('cash: default address municipality', () => {
    expect(describeRecipient(recipient, 'cash')).toBe('Centro Habana');
  });
  it('non-cash: active bank and last 4 digits', () => {
    expect(describeRecipient(recipient, 'transfer')).toBe('BANDEC ****1234');
  });
  it('falls back to the other source and then to empty', () => {
    expect(describeRecipient({ addresses: [{ municipality: 'Playa' }] }, 'transfer')).toBe('Playa');
    expect(describeRecipient({}, 'cash')).toBe('');
  });
});

describe('findEquivalentAddress', () => {
  const stored = [
    { id: 'a1', province: 'Matanzas', municipality: 'Colón', address_line_1: 'Calle 1' },
    { id: 'a2', province: 'Matanzas', municipality: 'Perico', address_line_1: 'Calle 9' }
  ];
  it('matches ignoring case and extra whitespace', () => {
    const typed = { province: ' matanzas', municipality: 'COLÓN ', address_line_1: 'calle   1' };
    expect(findEquivalentAddress(stored, typed)?.id).toBe('a1');
  });
  it('returns null when the street differs or there are no addresses', () => {
    expect(findEquivalentAddress(stored, { province: 'Matanzas', municipality: 'Colón', address_line_1: 'Calle 2' })).toBeNull();
    expect(findEquivalentAddress(undefined, stored[0])).toBeNull();
  });
});
