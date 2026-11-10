import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ES = JSON.parse(read('src/translations/ES.json'));
const EN = JSON.parse(read('src/translations/EN.json'));

const keys = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );

describe('legal acceptance wiring', () => {
  it('mounts the provider inside AuthProvider and LanguageProvider in App.jsx', () => {
    const app = read('src/App.jsx');
    const lang = app.indexOf('<LanguageProvider>');
    const auth = app.indexOf('<AuthProvider>');
    const legal = app.indexOf('<LegalAcceptanceProvider>');
    expect(lang).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(lang);
    expect(legal).toBeGreaterThan(auth);
    expect(app).toMatch(/<\/LegalAcceptanceProvider>/);
  });

  it('ES and EN expose the same legal.gate keys', () => {
    const es = keys(ES.legal.gate).sort();
    const en = keys(EN.legal.gate).sort();
    expect(es.length).toBeGreaterThan(10);
    expect(es).toEqual(en);
  });

  it('calls the gate before creating orders and remittances', () => {
    const cart = read('src/components/CartPage.jsx');
    expect(cart.indexOf("ensureAccepted('checkout')")).toBeGreaterThan(-1);
    expect(cart.indexOf("ensureAccepted('checkout')")).toBeLessThan(cart.indexOf('await createOrder('));
    const remit = read('src/components/SendRemittancePage.jsx');
    expect(remit.indexOf("ensureAccepted('remittance')")).toBeGreaterThan(-1);
    expect(remit.indexOf("ensureAccepted('remittance')")).toBeLessThan(remit.indexOf('await createRemittance('));
  });
});
