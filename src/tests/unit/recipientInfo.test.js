import { describe, it, expect } from 'vitest';
import { parseRecipientInfo, formatRecipientLocation } from '@/lib/recipientInfo';

describe('parseRecipientInfo', () => {
  const info = { fullName: 'Ana', phone: '+5355555555', province: 'La Habana', municipality: 'Plaza' };

  it('returns an object as-is', () => {
    expect(parseRecipientInfo(info)).toEqual(info);
  });

  it('parses a JSON string', () => {
    expect(parseRecipientInfo(JSON.stringify(info))).toEqual(info);
  });

  it('parses a double-encoded JSON string', () => {
    expect(parseRecipientInfo(JSON.stringify(JSON.stringify(info)))).toEqual(info);
  });

  it.each([null, undefined, '', 'garbage', '{broken', 42, true, [], '[1,2]', '"just a string"', 'null'])(
    'returns {} for non-object input %j',
    (value) => {
      expect(parseRecipientInfo(value)).toEqual({});
    }
  );
});

describe('formatRecipientLocation', () => {
  it('joins municipality and province', () => {
    expect(formatRecipientLocation('Plaza', 'La Habana')).toBe('Plaza, La Habana');
  });

  it('handles a single value', () => {
    expect(formatRecipientLocation('Plaza', null)).toBe('Plaza');
    expect(formatRecipientLocation(undefined, 'La Habana')).toBe('La Habana');
  });

  it('returns empty string when both are missing or blank', () => {
    expect(formatRecipientLocation(null, undefined)).toBe('');
    expect(formatRecipientLocation('  ', '')).toBe('');
  });
});
