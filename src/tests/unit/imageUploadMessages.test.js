import { describe, it, expect, vi } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { getImageUploadMessageKey, resolveImageUrl } from '@/lib/imageStorage';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const lookup = (dict, key) => key.split('.').reduce((acc, part) => acc?.[part], dict);

describe('image upload messages (ES/EN)', () => {
  it.each(['upload_failed', 'invalid_image', 'too_large'])('has ES and EN texts for %s', async (reason) => {
    const error = await resolveImageUrl(PNG_1PX, {
      folder: 'products',
      id: 'p1',
      resize: async () => (reason === 'too_large' ? null : new Blob(['x'])),
      upload: async () => { throw new Error('down'); }
    }).catch((e) => e);
    // map reason -> force each failure path
    const forced = reason === 'invalid_image'
      ? await resolveImageUrl('data:image/png;base64,@@@', { folder: 'p', id: '1' }).catch((e) => e)
      : error;

    const key = getImageUploadMessageKey(forced);
    const es = lookup(ES, key);
    const en = lookup(EN, key);
    expect(typeof es).toBe('string');
    expect(typeof en).toBe('string');
    expect(es.length).toBeGreaterThan(0);
    expect(es).not.toBe(en);
  });
});
