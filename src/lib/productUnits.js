/**
 * Product unit-of-measure catalog (pure, no I/O).
 *
 * The allowed codes live HERE, not in the database: products.unit is free text with only a
 * length CHECK, so adding a unit never needs a migration. A missing unit (null) means
 * "no unit defined" and is never replaced by a guess.
 *
 * Each language defines `name` (select label), and the text appended to a quantity:
 * `one` for exactly 1 and `other` for any other amount. Abbreviations use the same text for both.
 */

const UNITS = {
  unit: { es: { name: 'Unidad (ud)', one: 'ud', other: 'ud' }, en: { name: 'Unit', one: 'unit', other: 'units' } },
  lb: { es: { name: 'Libra (lb)', one: 'lb', other: 'lb' }, en: { name: 'Pound (lb)', one: 'lb', other: 'lb' } },
  kg: { es: { name: 'Kilogramo (kg)', one: 'kg', other: 'kg' }, en: { name: 'Kilogram (kg)', one: 'kg', other: 'kg' } },
  g: { es: { name: 'Gramo (g)', one: 'g', other: 'g' }, en: { name: 'Gram (g)', one: 'g', other: 'g' } },
  oz: { es: { name: 'Onza (oz)', one: 'oz', other: 'oz' }, en: { name: 'Ounce (oz)', one: 'oz', other: 'oz' } },
  l: { es: { name: 'Litro (l)', one: 'l', other: 'l' }, en: { name: 'Liter (l)', one: 'l', other: 'l' } },
  ml: { es: { name: 'Mililitro (ml)', one: 'ml', other: 'ml' }, en: { name: 'Milliliter (ml)', one: 'ml', other: 'ml' } },
  pack: { es: { name: 'Paquete', one: 'paquete', other: 'paquetes' }, en: { name: 'Pack', one: 'pack', other: 'packs' } },
  box: { es: { name: 'Caja', one: 'caja', other: 'cajas' }, en: { name: 'Box', one: 'box', other: 'boxes' } },
  can: { es: { name: 'Lata', one: 'lata', other: 'latas' }, en: { name: 'Can', one: 'can', other: 'cans' } },
  bottle: { es: { name: 'Botella', one: 'botella', other: 'botellas' }, en: { name: 'Bottle', one: 'bottle', other: 'bottles' } },
  dozen: { es: { name: 'Docena', one: 'docena', other: 'docenas' }, en: { name: 'Dozen', one: 'dozen', other: 'dozens' } },
  bag: { es: { name: 'Bolsa', one: 'bolsa', other: 'bolsas' }, en: { name: 'Bag', one: 'bag', other: 'bags' } }
};

export const UNIT_CODES = Object.keys(UNITS);

const toLang = (language) => (language === 'en' ? 'en' : 'es');

export const isKnownUnit = (code) => typeof code === 'string' && Object.hasOwn(UNITS, code);

/** Trimmed unit code, or null when blank / not a string. Unknown codes are preserved. */
export const normalizeUnitCode = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Human label for a unit code (select option text). Unknown code -> the raw code. */
export const getUnitLabel = (code, language = 'es') => {
  const normalized = normalizeUnitCode(code);
  if (!normalized) return '';
  return isKnownUnit(normalized) ? UNITS[normalized][toLang(language)].name : normalized;
};

/** Options for a unit select (without the empty option). */
export const getUnitOptions = (language = 'es') =>
  UNIT_CODES.map((code) => ({ value: code, label: getUnitLabel(code, language) }));

const formatNumber = (quantity) => {
  if (quantity === null || quantity === undefined) return '';
  const n = Number(quantity);
  if (!Number.isFinite(n)) return String(quantity);
  // Round away float noise from products like 0.1 * 3
  return String(Math.round(n * 10000) / 10000);
};

/**
 * "2 lb", "1 paquete", "3 paquetes". No unit -> the plain quantity. Unknown code -> "<qty> <code>".
 */
export const formatQuantityWithUnit = (quantity, unitCode, language = 'es') => {
  const amount = formatNumber(quantity);
  const code = normalizeUnitCode(unitCode);
  if (!code) return amount;
  if (!isKnownUnit(code)) return `${amount} ${code}`;

  const forms = UNITS[code][toLang(language)];
  return `${amount} ${Number(quantity) === 1 ? forms.one : forms.other}`;
};
