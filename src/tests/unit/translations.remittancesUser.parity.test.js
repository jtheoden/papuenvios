import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

// Known pre-existing gaps (ES-only keys). Pinned so that any NEW drift in the
// namespace (including a one-sided removal of a key) fails this test.
const KNOWN_ES_ONLY = [
  'cancelReasonPlaceholder',
  'close',
  'confirmCancelMessage',
  'paymentProofAlt',
  'paymentProofRequired',
  'paymentProofTitle',
  'paymentReferenceRequired',
  'referenceExamplePlaceholder',
  'status',
];

describe('remittances.user translation namespace', () => {
  it('only drifts between ES and EN by the known pre-existing gaps', () => {
    const es = Object.keys(ES.remittances.user);
    const en = Object.keys(EN.remittances.user);
    expect(es.filter((k) => !en.includes(k)).sort()).toEqual(KNOWN_ES_ONLY);
    expect(en.filter((k) => !es.includes(k))).toEqual([]);
  });

  it('does not keep the unused recipientCity key', () => {
    expect(ES.remittances.user).not.toHaveProperty('recipientCity');
    expect(EN.remittances.user).not.toHaveProperty('recipientCity');
  });
});
