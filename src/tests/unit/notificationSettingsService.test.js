import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { tableResult } = vi.hoisted(() => ({
  tableResult: { current: { data: [], error: null } }
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve(tableResult.current)
      })
    }),
    auth: {
      // No session: the edge-function fallback fails and the service returns defaults.
      getSession: () => Promise.resolve({ data: { session: null }, error: null })
    },
    functions: {
      invoke: vi.fn()
    }
  }
}));

import {
  getGuidedWhatsappPhone,
  getFreshGuidedWhatsappPhone
} from '@/lib/notificationSettingsService';

const PHONE = '+1 (561) 601-1675';
const OTHER_PHONE = '+1 (305) 555-0000';
const GROUP_URL = 'https://chat.whatsapp.com/AbC123xyz';

const rows = (settings) => [
  { setting_type: 'whatsapp_admin_phone', value: settings.whatsapp ?? '', is_active: true },
  { setting_type: 'whatsapp_group', value: settings.whatsappGroup ?? '', is_active: true },
  { setting_type: 'admin_email', value: settings.adminEmail ?? '', is_active: true },
  { setting_type: 'whatsapp_target', value: settings.whatsappTarget ?? '', is_active: true }
];

describe('getGuidedWhatsappPhone', () => {
  it('returns the phone when the active target is the phone', () => {
    expect(getGuidedWhatsappPhone({ whatsapp: PHONE, whatsappGroup: GROUP_URL, whatsappTarget: 'whatsapp' })).toBe(PHONE);
  });

  it('falls back to the admin phone when the active target is a group URL', () => {
    expect(getGuidedWhatsappPhone({ whatsapp: PHONE, whatsappGroup: GROUP_URL, whatsappTarget: 'whatsappGroup' })).toBe(PHONE);
  });

  it('returns empty string when the target is a group and there is no phone', () => {
    expect(getGuidedWhatsappPhone({ whatsapp: '', whatsappGroup: GROUP_URL, whatsappTarget: 'whatsappGroup' })).toBe('');
    expect(getGuidedWhatsappPhone({ whatsappGroup: GROUP_URL })).toBe('');
  });

  it('returns empty string when the phone field itself holds a URL', () => {
    expect(getGuidedWhatsappPhone({ whatsapp: GROUP_URL, whatsappGroup: GROUP_URL, whatsappTarget: 'whatsappGroup' })).toBe('');
  });

  it('returns empty string for empty or missing settings', () => {
    expect(getGuidedWhatsappPhone({})).toBe('');
    expect(getGuidedWhatsappPhone()).toBe('');
    expect(getGuidedWhatsappPhone(null)).toBe('');
  });
});

describe('getFreshGuidedWhatsappPhone', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the fresh settings over the cached fallback', async () => {
    tableResult.current = { data: rows({ whatsapp: PHONE, whatsappTarget: 'whatsapp' }), error: null };

    await expect(getFreshGuidedWhatsappPhone({ whatsapp: OTHER_PHONE })).resolves.toBe(PHONE);
  });

  it('resolves the phone from fresh settings when the fresh target is a group', async () => {
    tableResult.current = {
      data: rows({ whatsapp: PHONE, whatsappGroup: GROUP_URL, whatsappTarget: 'whatsappGroup' }),
      error: null
    };

    await expect(getFreshGuidedWhatsappPhone({})).resolves.toBe(PHONE);
  });

  it('falls back to the cached settings when the fresh fetch yields no phone', async () => {
    tableResult.current = { data: null, error: { message: 'permission denied' } };

    await expect(
      getFreshGuidedWhatsappPhone({ whatsapp: OTHER_PHONE, whatsappGroup: GROUP_URL, whatsappTarget: 'whatsappGroup' })
    ).resolves.toBe(OTHER_PHONE);
  });

  it('resolves empty string when neither fresh nor cached settings have a phone', async () => {
    tableResult.current = { data: [], error: null };

    await expect(getFreshGuidedWhatsappPhone(undefined)).resolves.toBe('');
  });
});
