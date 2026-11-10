import { useEffect, useMemo, useState } from 'react';
import { fetchComboDefinitions, fetchProductUnits } from '@/lib/orderComboService';
import { buildOrderItemLines, collectComboIds, collectProductIds } from '@/lib/orderItemsPure';

/**
 * Display lines for one order's items: combo lines expanded into their current components and
 * plain product lines carrying their current unit of measure.
 * Makes at most one query per concern (combo definitions only when the order has combos, product
 * units only when it has plain product lines). Display-only: failures leave the plain
 * quantity rendering in place.
 *
 * @param {object|null} order - order with order_items and created_at
 * @param {'es'|'en'} language
 * @returns {{ lines: Array, comboLookupDone: boolean }}
 */
export const useOrderItemLines = (order, language) => {
  const comboIdsKey = useMemo(() => collectComboIds(order ? [order] : []).sort().join(','), [order]);
  const productIdsKey = useMemo(() => collectProductIds(order ? [order] : []).sort().join(','), [order]);
  const [resolved, setResolved] = useState({ key: '', definitions: new Map() });
  const [resolvedUnits, setResolvedUnits] = useState({ key: '', units: new Map() });

  useEffect(() => {
    if (!comboIdsKey) return undefined;
    let cancelled = false;
    fetchComboDefinitions(comboIdsKey.split(','))
      .then((definitions) => {
        if (!cancelled) setResolved({ key: comboIdsKey, definitions });
      })
      .catch(() => {
        if (!cancelled) setResolved({ key: comboIdsKey, definitions: new Map() });
      });
    return () => {
      cancelled = true;
    };
  }, [comboIdsKey]);

  useEffect(() => {
    if (!productIdsKey) return undefined;
    let cancelled = false;
    fetchProductUnits(productIdsKey.split(','))
      .then((units) => {
        if (!cancelled) setResolvedUnits({ key: productIdsKey, units });
      })
      .catch(() => {
        if (!cancelled) setResolvedUnits({ key: productIdsKey, units: new Map() });
      });
    return () => {
      cancelled = true;
    };
  }, [productIdsKey]);

  const comboLookupDone = !comboIdsKey || resolved.key === comboIdsKey;
  const unitsReady = productIdsKey && resolvedUnits.key === productIdsKey;

  const lines = useMemo(
    () =>
      buildOrderItemLines(order?.order_items, comboLookupDone ? resolved.definitions : undefined, {
        language,
        orderCreatedAt: order?.created_at,
        productUnits: unitsReady ? resolvedUnits.units : undefined
      }),
    [order, language, resolved, comboLookupDone, resolvedUnits, unitsReady]
  );

  return { lines, comboLookupDone };
};

export default useOrderItemLines;
