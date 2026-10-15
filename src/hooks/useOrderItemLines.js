import { useEffect, useMemo, useState } from 'react';
import { fetchComboDefinitions } from '@/lib/orderComboService';
import { buildOrderItemLines, collectComboIds } from '@/lib/orderItemsPure';

/**
 * Display lines for one order's items, with combo lines expanded into their current components.
 * Makes at most one query (only when the order contains combos). Display-only: failures leave the
 * plain single-line rendering in place.
 *
 * @param {object|null} order - order with order_items and created_at
 * @param {'es'|'en'} language
 * @returns {{ lines: Array, comboLookupDone: boolean }}
 */
export const useOrderItemLines = (order, language) => {
  const comboIdsKey = useMemo(() => collectComboIds(order ? [order] : []).sort().join(','), [order]);
  const [resolved, setResolved] = useState({ key: '', definitions: new Map() });

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

  const comboLookupDone = !comboIdsKey || resolved.key === comboIdsKey;

  const lines = useMemo(
    () =>
      buildOrderItemLines(order?.order_items, comboLookupDone ? resolved.definitions : undefined, {
        language,
        orderCreatedAt: order?.created_at
      }),
    [order, language, resolved, comboLookupDone]
  );

  return { lines, comboLookupDone };
};

export default useOrderItemLines;
