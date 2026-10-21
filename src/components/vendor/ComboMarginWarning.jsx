import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Non-blocking warning shown when a combo costs more than the sum of its
 * products bought separately. Purely presentational: the evaluation comes
 * from evaluateComboPricing().
 */
const ComboMarginWarning = ({ evaluation, currencySymbol = '$', currencyCode = '', t, onApplyMargin }) => {
  if (!evaluation || !evaluation.isMoreExpensive) return null;

  const money = (amount) => `${currencySymbol}${Math.abs(amount).toFixed(2)} ${currencyCode}`.trim();
  const maxMargin = evaluation.maxMarginWithoutLoss;
  const canApply = typeof onApplyMargin === 'function' && maxMargin > 0;

  return (
    <div
      role="alert"
      data-testid="combo-margin-warning"
      className="p-4 bg-red-50 border-2 border-red-400 rounded-lg text-sm space-y-2"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p className="font-semibold text-red-800">{t('vendor.combos.priceWarningTitle')}</p>
      </div>

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-red-900">
        <dt>{t('vendor.combos.priceWarningComboPrice')}</dt>
        <dd data-testid="combo-warning-combo-price" className="font-semibold text-right">
          {money(evaluation.comboPrice)}
        </dd>
        <dt>{t('vendor.combos.priceWarningIndividualTotal')}</dt>
        <dd data-testid="combo-warning-individual-total" className="font-semibold text-right">
          {money(evaluation.individualTotal)}
        </dd>
        <dt>{t('vendor.combos.priceWarningDifference')}</dt>
        <dd data-testid="combo-warning-difference" className="font-bold text-right">
          {money(evaluation.difference)}
        </dd>
      </dl>

      {maxMargin > 0 && (
        <p data-testid="combo-warning-max-margin" className="text-red-900">
          {t('vendor.combos.priceWarningMaxMargin').replace('{value}', maxMargin.toFixed(2))}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canApply && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="combo-warning-apply"
            onClick={() => onApplyMargin(maxMargin)}
          >
            {t('vendor.combos.priceWarningApply').replace('{value}', maxMargin.toFixed(2))}
          </Button>
        )}
        <span className="text-xs text-red-700">{t('vendor.combos.priceWarningNote')}</span>
      </div>
    </div>
  );
};

export default ComboMarginWarning;
