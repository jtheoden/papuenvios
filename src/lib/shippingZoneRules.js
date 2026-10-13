/**
 * Pure rules deciding which shipping zones a customer can pick and what a
 * destination costs. No I/O, no mutation of the inputs.
 *
 * Zone rows come from `shipping_zones`: `municipality_name` is null for a
 * province-wide row. A province row may exist only as a fallback price for
 * municipalities that have no row of their own.
 */

const toCost = (zone) => {
  const cost = parseFloat(zone?.shipping_cost);
  return Number.isFinite(cost) ? cost : 0;
};

const isProvinceRow = (zone) => !zone.municipality_name;

/**
 * A zone is available when it is active and either explicitly free or priced above 0.
 * A zone with cost 0 that is not marked free means "shipping disabled", never "free".
 *
 * @param {object|null|undefined} zone
 * @returns {boolean}
 */
export const isZoneAvailable = (zone) => {
  if (!zone || zone.is_active === false) return false;
  return zone.free_shipping === true || toCost(zone) > 0;
};

/**
 * Names of provinces a customer may select (decision D3, interpretation B): the
 * province row itself is available OR at least one of its municipality rows is.
 *
 * @param {Array<object>} zones - zone rows (any order)
 * @returns {Set<string>} province names
 */
export const getSelectableProvinceNames = (zones = []) => {
  const names = new Set();
  (zones || []).forEach((zone) => {
    if (isZoneAvailable(zone)) names.add(zone.province_name);
  });
  return names;
};

/**
 * @param {Array<object>} zones
 * @param {string} provinceName
 * @returns {boolean}
 */
export const isProvinceSelectable = (zones, provinceName) =>
  Boolean(provinceName) && getSelectableProvinceNames(zones).has(provinceName);

/**
 * Zone list the province/municipality selectors should receive.
 * Returns a NEW array (same row objects, original order) holding every active row
 * of each selectable province: its province row (even when that row alone is not
 * available, e.g. Camaguey, which is selectable only through its municipalities)
 * and all its municipality rows. Unavailable municipality rows are kept on purpose
 * so the selectors can show them as unavailable instead of silently falling back
 * to the province fee. Rows of non-selectable provinces and inactive rows are dropped.
 *
 * @param {Array<object>} zones
 * @returns {Array<object>}
 */
export const getSelectableProvinces = (zones = []) => {
  const list = (zones || []).filter((zone) => zone && zone.is_active !== false);
  const selectable = getSelectableProvinceNames(list);
  return list.filter((zone) => selectable.has(zone.province_name));
};

/**
 * Resolves what a destination costs, mirroring the lookup priority of
 * `shippingService.getShippingZoneForLocation`: municipality row first, then the
 * province-wide row as fallback. A resolved zone that is not available (cost 0 and
 * not free) is reported as unavailable, never as free.
 *
 * @param {Array<object>} zones - zone rows (selectable list or raw active rows)
 * @param {string} provinceName
 * @param {string|null} [municipalityName]
 * @returns {{ status: 'none'|'unavailable'|'available', cost: number, freeShipping: boolean, source: 'municipality'|'province'|null }}
 */
export const getShippingState = (zones, provinceName, municipalityName = null) => {
  if (!provinceName) {
    return { status: 'none', cost: 0, freeShipping: false, source: null };
  }

  const rows = (zones || []).filter(
    (zone) => zone && zone.is_active !== false && zone.province_name === provinceName
  );

  const municipalityRow = municipalityName
    ? rows.find((zone) => zone.municipality_name === municipalityName)
    : null;
  const zone = municipalityRow || rows.find(isProvinceRow);
  const source = municipalityRow ? 'municipality' : 'province';

  if (!isZoneAvailable(zone)) {
    return { status: 'unavailable', cost: 0, freeShipping: false, source: zone ? source : null };
  }

  const freeShipping = zone.free_shipping === true;
  return { status: 'available', cost: freeShipping ? 0 : toCost(zone), freeShipping, source };
};

/**
 * True when the chosen destination must block checkout / advancing.
 *
 * @param {{ status: string }} state - result of getShippingState
 * @returns {boolean}
 */
export const isShippingBlocked = (state) => state?.status === 'unavailable';

/**
 * Remittances only depend on the destination zone for cash deliveries to a Cuban
 * address; transfer/card/moneypocket deliveries are never blocked by zone rules.
 *
 * @param {{ zones: Array<object>, deliveryMethod?: string, province?: string, municipality?: string|null }} params
 * @returns {boolean}
 */
export const isCashDeliveryBlocked = ({ zones, deliveryMethod = 'cash', province, municipality = null } = {}) =>
  deliveryMethod === 'cash' && isShippingBlocked(getShippingState(zones, province, municipality));
