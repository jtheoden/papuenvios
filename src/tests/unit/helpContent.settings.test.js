import { describe, expect, it } from 'vitest';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

// Sources: SettingsPageFinancial/Shipping/Visual/Content, SettingsIbanStatus,
// SettingsBizumSection, zelleService, productService, comboUtils, AdminOffersTab,
// priceCalculationService, stockPolicyService, BulkDeleteBar and reset/delete/reprice migrations.
const sections = getHelpSectionsForRole('super_admin');
const entryFor = (sectionId, entryId, language) => sections.find(({ id }) => id === sectionId)
  .entries.find(({ id }) => id === entryId).answer[language];
const textFor = (language, page, tab, detail) => {
  const section = sections.find(({ id }) => id === getHelpSectionForPage(page, tab, detail));
  expect(section).toBeTruthy();
  return section.entries.map(({ answer }) => answer[language]).join(' ');
};

describe.each(['es', 'en'])('settings and catalog help in %s', (language) => {
  it('distinguishes free municipal shipping from inactive provincial zones', () => {
    const text = entryFor('context-settings-envios', 'shipping-autosave', language);
    expect(text).toMatch(language === 'es' ? /autoguardado.*salir del campo/i : /autosav.*field.*blur/i);
    expect(text).toMatch(language === 'es' ? /Costo Envío.*cliente.*Costo Transporte.*interno/i : /Shipping Cost.*customer.*Transport Cost.*internal/i);
    expect(text).toMatch(language === 'es' ? /provincia.*costo.*transporte.*0.*desactiv/i : /province.*shipping.*transport.*0.*deactiv/i);
    // Only Shipping Cost's blur recalculates is_active; Transport Cost's does not.
    expect(text).toMatch(language === 'es' ? /al salir de Costo Envío/i : /blurring Shipping Cost/i);
    expect(text).toMatch(language === 'es' ? /solo Costo Transporte no recalcula.*estado/i : /only Transport Cost does not recompute.*status/i);
    expect(text).toMatch(language === 'es' ? /municipio.*Envío 0.*envío gratis/i : /municipality.*Shipping Cost 0.*free shipping/i);
    expect(text).toMatch(language === 'es' ? /municipal activa prevalece.*falta.*inactiva.*provincial/i : /active municipal row takes precedence.*missing.*inactive.*province/i);
    expect(text).not.toMatch(/no envío gratis|aunque esté no disponible|not free (delivery|shipping)|even if unavailable/i);
  });
  it('warns that product deletion is permanent in the inventory confirmation', () => {
    const text = (language === 'es' ? ES : EN).vendor.inventory.deleteConfirmMessage;
    expect(text).toContain('{name}');
    expect(text).not.toMatch(/desactivará|deactivate/i);
    expect(text).toMatch(language === 'es' ? /elimina.*permanente/i : /permanently deleted/i);
    expect(text).toMatch(language === 'es' ? /combos.*desactivan/i : /combos.*disabled/i);
    expect(text).toMatch(language === 'es' ? /no se puede deshacer/i : /cannot be undone/i);
    expect(text).toMatch(language === 'es' ? /bloquea.*pedidos en curso.*reservas/i : /blocked.*in-progress orders.*reserved/i);
  });
  it('compares repricing against the latest stored run including the backfill', () => {
    const text = entryFor('context-settings-financiero', 'financial-reprice', language);
    expect(text).toMatch(language === 'es' ? /última ejecución.*applied.*noop.*backfill/i : /latest run.*applied.*noop.*backfill/i);
    expect(text).toMatch(language === 'es' ? /sin.*ejecución previa.*primera aplicación/i : /no previous run.*first application/i);
    expect(text).toMatch(language === 'es' ? /backfill.*2026-11-10.*tasa.*guardada/i : /2026-11-10 backfill.*stored rate/i);
    expect(text).not.toMatch(/o es la primera aplicación|\bor the first application/i);
  });
  it('describes currency removal as deactivation of currencies and rates', () => {
    const text = entryFor('context-settings-financiero', 'financial-permissions-margins', language);
    expect(text).toMatch(language === 'es' ? /desactiva monedas \(y sus tasas\)/i : /deactivates currencies \(and their rates\)/i);
    expect(text).not.toMatch(/elimina monedas|deletes currencies|deleting a currency/i);
  });
  it('includes reset cascades while preserving independent refund events', () => {
    for (const [section, entry] of [['context-settings-sistema', 'system-reset'], ['platform', 'platform-reset']]) {
      const text = entryFor(section, entry, language);
      expect(text).toMatch(language === 'es' ? /cascada.*refund_requests.*devengos.*costos.*mensajer.*reajustes/i : /cascade.*refund_requests.*courier accruals.*costs.*readjustments/i);
      expect(text).toMatch(language === 'es' ? /refund_request_events.*sin.*FK.*conserva/i : /refund_request_events.*no.*FK.*retained/i);
    }
  });
  it('makes both stock-policy guides depend on the scheduled expiry job', () => {
    for (const [section, entry] of [['context-settings-stock-policy', 'settings-stock-policy'], ['context-settings-sistema', 'system-stock-policy']]) {
      const text = entryFor(section, entry, language);
      expect(text).toMatch(language === 'es' ? /depende.*tarea programada/i : /depends.*scheduled.*job/i);
      expect(text).toMatch(language === 'es' ? /guardar no activa/i : /saving does not activate/i);
      expect(text).not.toMatch(/liberan stock automáticamente|release stock automatically/i);
    }
  });
  it('explains USD/CUP catalog repricing, confirmations and permissions', () => {
    const text = textFor(language, 'settings', 'financiero');
    for (const fact of [/USD.*CUP/, /10 %/, /super_admin/]) expect(text).toMatch(fact);
    expect(text).toMatch(language === 'es' ? /productos.*costo CUP.*combos/i : /CUP-cost products.*combos/i);
    expect(text).toMatch(language === 'es' ? /vista previa.*segunda confirmación/i : /preview.*second confirmation/i);
    expect(text).toMatch(language === 'es' ? /pedidos existentes no cambian/i : /existing orders do not change/i);
  });
  it('keeps IBAN read-only and documents the real Bizum tab', () => {
    const iban = sections.find(({ id }) => id === getHelpSectionForPage('settings', 'zelle', 'iban'));
    expect(iban?.id).toBe('context-settings-zelle-iban');
    const text = iban.entries.map(({ answer }) => answer[language]).join(' ');
    expect(text).toMatch(language === 'es' ? /no disponible.*solo lectura/i : /not available.*read-only/i);
    expect(text).toMatch(language === 'es' ? /no.*activar/i : /cannot.*activat/i);
    const bizum = textFor(language, 'settings', 'zelle', 'bizum');
    expect(bizum).toMatch(language === 'es' ? /parámetros.*cuentas/i : /parameters.*accounts/i);
    expect(bizum).toMatch(/USD.*EUR/);
    expect(bizum).toMatch(language === 'es' ? /antigua.*bloque/i : /stale.*block/i);
    const all = sections.flatMap(({ entries }) => entries).map(({ answer }) => answer[language]).join(' ');
    expect(all).not.toMatch(/activa Bizum y\/o IBAN|enable Bizum and\/or IBAN/i);
  });
  it('distinguishes physical deletion, category slug generation and component stock', () => {
    const catalog = sections.find(({ id }) => id === 'catalog').entries.find(({ id }) => id === 'hide-vs-delete').answer[language];
    expect(catalog).toMatch(language === 'es' ? /físico.*irreversible/i : /physical.*irreversible/i);
    expect(catalog).toMatch(language === 'es' ? /bloque.*pedidos/i : /block.*orders/i);
    expect(textFor(language, 'admin', 'categories')).toMatch(language === 'es' ? /slug no es editable/i : /slug is not editable/i);
    expect(textFor(language, 'admin', 'combos')).toMatch(language === 'es' ? /no tienen stock propio/i : /no stock of their own/i);
    expect(textFor(language, 'admin', 'management')).toMatch(language === 'es' ? /testimonios/i : /testimonials/i);
  });
  it('explains advisory Zelle limits and delete dependencies', () => {
    const text = textFor(language, 'settings', 'zelle', 'zelle');
    for (const fact of [/USD/, /America\/New_York/]) expect(text).toMatch(fact);
    expect(text).toMatch(language === 'es' ? /orientativos.*no bloquean/i : /advisory.*do not block/i);
    expect(text).toMatch(language === 'es' ? /comprobante.*bloque/i : /proof.*block/i);
    expect(text).toMatch(language === 'es' ? /alertas.*emails/i : /alerts.*emails/i);
  });
  it('names the Visual save and separate Content saves, with shipping autosave', () => {
    const visual = textFor(language, 'settings', 'visual');
    expect(visual).toMatch(/super_admin/);
    expect(visual).toMatch(language === 'es' ? /Guardar Personalización/ : /Save Personalization/);
    expect(visual).toMatch(language === 'es' ? /diapositivas.*independientes/i : /slides.*independent/i);
    expect(textFor(language, 'settings', 'envios')).toMatch(language === 'es' ? /autoguard.*salir del campo/i : /autosav.*field.*blur/i);
    expect(textFor(language, 'settings', 'contenido')).toMatch(language === 'es' ? /tres guardados independientes/i : /three independent saves/i);
  });
  it('defines offer applies-to, mandatory dates and stacking order', () => {
    const text = textFor(language, 'dashboard', 'offers');
    expect(text).toMatch(/product.*combo.*remittance/);
    expect(text).toMatch(language === 'es' ? /inicio.*fin.*obligatori/i : /start.*end.*required/i);
    expect(text).toMatch(language === 'es' ? /primero.*categoría.*luego.*oferta/i : /category.*first.*then.*offer/i);
  });
  it('explains reset scope, disabled users and SQL-only flag', () => {
    const text = textFor(language, 'settings', 'sistema');
    for (const fact of [/RESETEAR/, /SQL/, /super_admin/, /stock 0/]) expect(text).toMatch(fact);
    expect(text).toMatch(language === 'es' ? /deshabilita.*no.*borra/i : /disables.*not.*delete/i);
    expect(text).toMatch(language === 'es' ? /conserva.*productos.*categorías/i : /keeps.*products.*categories/i);
    expect(text).toMatch(language === 'es' ? /auto.desarma/i : /disarms itself/i);
  });
  it('documents stock policy bounds and partial physical bulk delete', () => {
    const text = textFor(language, 'settings', 'sistema');
    for (const fact of [/48 h/, /168 h/, /6–720/, /24–2160/, /1–50/]) expect(text).toMatch(fact);
    expect(text).toMatch(language === 'es' ? /tarea.*programada/i : /scheduled.*job/i);
    const bulk = textFor(language, 'admin', 'inventory');
    expect(bulk).toMatch(/super_admin/);
    expect(bulk).toMatch(language === 'es' ? /parcial/i : /partial/i);
    expect(bulk).toMatch(language === 'es' ? /reservad/i : /reserved/i);
  });
});
