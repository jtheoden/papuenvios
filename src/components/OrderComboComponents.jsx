import { formatQuantityWithUnit } from '@/lib/productUnits';

/**
 * Indented list of a combo line's components, plus the "modified after order" and
 * "unavailable" notes. Renders nothing for non-combo lines.
 *
 * @param {object} line - entry from buildOrderItemLines
 * @param {boolean} lookupDone - false while the combo definitions are still loading
 * @param {function} t - i18n function
 * @param {'es'|'en'} [language] - used to render component units
 */
const OrderComboComponents = ({ line, lookupDone, t, language = 'es' }) => {
  if (line?.item?.item_type !== 'combo') return null;

  if (!line.components) {
    if (!lookupDone) return null;
    return <p className="mt-1 pl-4 text-xs italic text-gray-500">{t('orderCombo.unavailable')}</p>;
  }

  return (
    <div className="mt-1 pl-4">
      <ul aria-label={t('orderCombo.contains')} className="list-disc pl-4 text-xs text-gray-600">
        {line.components.map((component, index) => (
          <li key={`${component.productId}-${index}`}>
            {`${formatQuantityWithUnit(component.quantity, component.unit, language)} × ${component.name || t('orderCombo.unknownProduct')}`}
          </li>
        ))}
      </ul>
      {line.compositionChanged && (
        <p className="mt-1 text-xs italic text-amber-700">{t('orderCombo.modifiedNote')}</p>
      )}
    </div>
  );
};

export default OrderComboComponents;
