import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLAIM_WINDOW_HOURS,
  REFUND_BUSINESS_DAYS,
  ACTIVITY_LOGS_RETENTION_DAYS,
  LEGAL_LAST_UPDATED,
} from '@/lib/legalConfig';

const lang = { current: 'es' };

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: lang.current, t: (key) => key }),
}));

const business = { notificationSettings: {} };
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => business,
}));

import TermsPage from '@/components/TermsPage';
import PrivacyPage from '@/components/PrivacyPage';

const OLD_EMAIL = 'soporte@papuenvios.com';
const LANGS = ['es', 'en'];

const textOf = (Page, language) => {
  lang.current = language;
  const { container } = render(<Page onNavigate={vi.fn()} />);
  const text = container.textContent;
  const html = container.innerHTML;
  cleanup();
  return { text, html };
};

beforeEach(() => {
  business.notificationSettings = {};
  lang.current = 'es';
  vi.stubEnv('VITE_SUPPORT_EMAIL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(LANGS)('Terms and Privacy forbidden claims (%s)', (language) => {
  it.each([
    ['Terms', TermsPage],
    ['Privacy', PrivacyPage],
  ])('%s page makes no unproven claims', (_name, Page) => {
    const { text, html } = textOf(Page, language);
    expect(text).not.toMatch(/Florida/i);
    expect(text).not.toMatch(/licens|licenci/i);
    expect(text).not.toMatch(/\bregistered\b|registrad[oa]s?\b/i);
    expect(text).not.toMatch(/authorized by|autorizad[oa]s? por/i);
    expect(text).not.toMatch(/FinCEN/i);
    expect(text).not.toContain(OLD_EMAIL);
    expect(html).not.toContain(OLD_EMAIL);
  });

  it('renders no mailto link and a generic contact channel when no support email is configured', () => {
    for (const Page of [TermsPage, PrivacyPage]) {
      const { html } = textOf(Page, language);
      expect(html).not.toContain('mailto:');
    }
  });

  it('renders a mailto link when VITE_SUPPORT_EMAIL is configured', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'help@example.test');
    for (const Page of [TermsPage, PrivacyPage]) {
      const { html } = textOf(Page, language);
      expect(html).toContain('mailto:help@example.test');
    }
  });

  it('shows the last-updated date from legalConfig', () => {
    expect(textOf(TermsPage, language).text).toContain(LEGAL_LAST_UPDATED);
    expect(textOf(PrivacyPage, language).text).toContain(LEGAL_LAST_UPDATED);
  });
});

describe.each(LANGS)('Terms content (%s)', (language) => {
  it('has a refund section anchored as #refunds using the configured windows', () => {
    const { text, html } = textOf(TermsPage, language);
    expect(html).toContain('id="refunds"');
    expect(text).toContain(
      language === 'es' ? `${CLAIM_WINDOW_HOURS} horas` : `${CLAIM_WINDOW_HOURS} hours`
    );
    expect(text).toContain(
      language === 'es' ? `${REFUND_BUSINESS_DAYS} días hábiles` : `${REFUND_BUSINESS_DAYS} business days`
    );
  });

  it('describes delivery by an independent local agent without naming anyone', () => {
    const { text } = textOf(TermsPage, language);
    expect(text).toMatch(language === 'es' ? /agente de entrega local independiente/i : /independent local delivery agent/i);
    expect(text).toMatch(language === 'es' ? /estimad/i : /estimate/i);
  });

  it('states PapuEnvios is not a bank or financial institution', () => {
    const { text } = textOf(TermsPage, language);
    expect(text).toMatch(language === 'es' ? /no es un banco/i : /not a bank/i);
  });

  it('keeps the Zelle irreversibility and OFAC clauses', () => {
    const { text } = textOf(TermsPage, language);
    expect(text).toMatch(language === 'es' ? /Zelle[^.]*irreversible/i : /Zelle[^.]*irreversible/i);
    expect(text).toContain('OFAC');
  });
});

describe.each(LANGS)('Privacy content (%s)', (language) => {
  it('discloses the real third parties and data flows', () => {
    const { text } = textOf(PrivacyPage, language);
    for (const needle of [
      'Google',
      'api.exchangerate-api.com',
      'wa.me',
      'Resend',
      'Supabase',
      'Vercel',
    ]) {
      expect(text).toContain(needle);
    }
    expect(text).toMatch(/WhatsApp Business/i);
  });

  it('no longer lists Google Fonts: the typography is served by the site itself', () => {
    const { text } = textOf(PrivacyPage, language);
    expect(text).not.toMatch(/fonts\.googleapis\.com|Google Fonts/i);
    expect(text).toMatch(language === 'es' ? /tipograf[ií]a[^.]*servid[ao]s? (desde|por) (nuestro|el) sitio/i : /typography[^.]*served (from|by) (our|the) (own )?(site|servers?)/i);
  });

  it('describes analytics as opt-in, honors GPC and says how to change the choice', () => {
    const { text } = textOf(PrivacyPage, language);
    expect(text).toMatch(language === 'es' ? /solo si (usted )?acepta/i : /only if you accept/i);
    expect(text).toContain('Global Privacy Control');
    expect(text).toContain(language === 'es' ? 'Preferencias de cookies' : 'Cookie preferences');
    expect(text).not.toMatch(language === 'es' ? /por cada página que visita, incluso sin/i : /for each page you visit, even if you are not signed/i);
  });

  it('scopes the preferences link, GPC override, browser storage key and withdrawal effect', () => {
    const { text } = textOf(PrivacyPage, language);
    expect(text).toMatch(language === 'es' ? /en las páginas con pie de página/i : /on pages with a footer/i);
    expect(text).not.toMatch(language === 'es' ? /al pie de cada página/i : /bottom of every page/i);
    expect(text).toMatch(language === 'es' ? /salvo que (usted )?acepte expresamente/i : /unless you expressly accept/i);
    expect(text).toContain('papuenvios_consent');
    expect(text).toMatch(language === 'es' ? /no borra las visitas ya almacenadas/i : /does not delete visits already stored/i);
  });

  it('describes page-visit analytics accurately, not as aggregate', () => {
    const { text } = textOf(PrivacyPage, language);
    expect(text).not.toMatch(/agregad|aggregate/i);
    expect(text).toContain('user_agent');
    expect(text).toContain('session_id');
  });

  it('states only retention periods proven by the code', () => {
    const { text } = textOf(PrivacyPage, language);
    expect(text).toContain(String(ACTIVITY_LOGS_RETENTION_DAYS));
    expect(text).not.toMatch(/5 a(ñ|n)os|5 years|five years/i);
  });
});

describe('Privacy encryption claim', () => {
  it('names AES-256 only because the edge function really uses AES-GCM with a 256-bit key', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'supabase/functions/bank-account-crypto/index.ts'),
      'utf8'
    );
    expect(source).toMatch(/name:\s*'AES-GCM'/);
    expect(source).toMatch(/length:\s*256/);
    for (const language of LANGS) {
      expect(textOf(PrivacyPage, language).text).toContain('AES-256');
    }
  });
});

describe.each(LANGS)('Support channel and cancellation wording (%s)', (language) => {
  it('links to the in-app WhatsApp contact when a phone is configured and no email is', () => {
    business.notificationSettings = { whatsapp: '+5355550000', whatsappGroup: '', whatsappTarget: 'whatsapp' };
    for (const Page of [TermsPage, PrivacyPage]) {
      const { html } = textOf(Page, language);
      expect(html).toContain('https://wa.me/5355550000');
      expect(html).not.toContain('mailto:');
    }
  });

  it('does not use a group URL as a wa.me target', () => {
    business.notificationSettings = {
      whatsapp: '',
      whatsappGroup: 'https://chat.whatsapp.com/abc',
      whatsappTarget: 'whatsappGroup',
    };
    const { html } = textOf(TermsPage, language);
    expect(html).not.toContain('wa.me/');
  });

  it('prefers the configured support email over WhatsApp', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'help@example.test');
    business.notificationSettings = { whatsapp: '+5355550000', whatsappTarget: 'whatsapp' };
    const { html } = textOf(TermsPage, language);
    expect(html).toContain('mailto:help@example.test');
    expect(html).not.toContain('wa.me/');
  });

  it('explains that remittances can be cancelled in the app until payment validation', () => {
    const { text } = textOf(TermsPage, language);
    expect(text).toContain(language === 'es' ? 'Mis Remesas' : 'My Remittances');
    expect(text).toMatch(language === 'es' ? /hasta que (nuestro equipo )?valide/i : /until our team validates/i);
  });
});
