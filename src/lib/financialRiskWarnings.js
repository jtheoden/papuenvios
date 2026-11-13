/**
 * Publish a focused financial-risk warning to the admin help launcher.
 * The event is intentionally UI-only: it never changes or approves a financial record.
 */
export const FINANCIAL_RISK_WARNING_EVENT = 'papuenvios:financial-risk-warning';

export function publishFinancialRiskWarning({ code, title, message, impact, severity = 'high' }) {
  if (typeof window === 'undefined' || !title || !message) return;
  window.dispatchEvent(new CustomEvent(FINANCIAL_RISK_WARNING_EVENT, {
    detail: {
      code: String(code || 'financial-risk'),
      title: String(title),
      message: String(message),
      impact: impact ? String(impact) : '',
      severity: severity === 'critical' ? 'critical' : 'high',
      createdAt: new Date().toISOString()
    }
  }));
}

export function getNegativeMarginWarning({ language = 'es', scope = 'configuration' } = {}) {
  const isEnglish = language === 'en';
  return {
    code: `negative-margin-${scope}`,
    severity: 'critical',
    title: isEnglish ? 'Negative profit margin detected' : 'Margen de ganancia negativo detectado',
    message: isEnglish
      ? 'This setting can price products or remittances below their cost, creating a direct loss on every affected transaction. Correct the margin and verify a sample quote before saving.'
      : 'Esta configuración puede dejar productos o remesas por debajo de su costo y generar una pérdida directa por cada operación afectada. Corrige el margen y verifica una cotización de prueba antes de guardar.',
    impact: isEnglish ? 'Potential direct financial loss' : 'Posible pérdida financiera directa'
  };
}

export function getInvalidRemittanceRateWarning({ language = 'es' } = {}) {
  const isEnglish = language === 'en';
  return {
    code: 'invalid-remittance-rate',
    severity: 'critical',
    title: isEnglish ? 'Invalid remittance rate or margin' : 'Tasa o margen de remesa no válido',
    message: isEnglish
      ? 'The delivery rate is higher than the market rate, or the resulting margin is negative. This can make the platform pay more than it collects. Review the source/delivery currencies, market rate, delivery rate and fees before saving.'
      : 'La tasa de entrega supera la tasa de mercado o el margen resultante es negativo. Esto puede hacer que la plataforma pague más de lo que cobra. Revisa monedas de origen/entrega, tasa de mercado, tasa de entrega y comisiones antes de guardar.',
    impact: isEnglish ? 'Potential loss on each remittance' : 'Posible pérdida por cada remesa'
  };
}

export function getInvalidOrderPricingWarning({ language = 'es' } = {}) {
  const isEnglish = language === 'en';
  return {
    code: 'invalid-order-pricing',
    severity: 'critical',
    title: isEnglish ? 'Order price or profit setting needs review' : 'Revisa el precio o la ganancia del pedido',
    message: isEnglish
      ? 'The saved product price or profit margin is invalid or below cost. New orders may be underpriced and create direct losses. Review the base price, currency and margin, then verify a test order before continuing.'
      : 'El precio o margen de ganancia guardado no es válido o queda por debajo del costo. Los nuevos pedidos podrían venderse demasiado baratos y generar pérdidas directas. Revisa precio base, moneda y margen; luego verifica un pedido de prueba.',
    impact: isEnglish ? 'Potential loss on new orders' : 'Posibles pérdidas en pedidos nuevos'
  };
}

export function getOverdueRefundWarning({ count, language = 'es' } = {}) {
  const isEnglish = language === 'en';
  return {
    code: 'refunds-overdue',
    severity: 'high',
    title: isEnglish ? 'Refunds past their due date' : 'Reembolsos vencidos',
    message: isEnglish
      ? `${count} pending refund${count === 1 ? '' : 's'} are past due. Reconcile the original payment, refund evidence and current status; do not issue a duplicate refund.`
      : `Hay ${count} reembolso${count === 1 ? '' : 's'} pendiente${count === 1 ? '' : 's'} fuera de plazo. Concilia el pago original, la evidencia del reembolso y el estado actual; no emitas un reembolso duplicado.`,
    impact: isEnglish ? 'Customer liability and duplicate-payment risk' : 'Riesgo de obligación con el cliente y pago duplicado'
  };
}

/** Run checks on the persisted snapshot and publish any anomalies to the admin chatbot. */
export function validatePersistedFinancialSetting({ kind, values = {}, language = 'es' } = {}) {
  const warnings = [];
  if (kind === 'margin') {
    const margins = [values.productProfit, values.comboProfit].filter(value => value !== undefined && value !== null);
    if (margins.some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) {
      warnings.push(getNegativeMarginWarning({ language, scope: 'product-or-combo' }));
    }
  }
  if (kind === 'order-pricing') {
    const price = Number(values.basePrice);
    const margin = Number(values.profitMargin);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(margin) || margin < 0) {
      warnings.push(getInvalidOrderPricingWarning({ language }));
    }
  }
  if (kind === 'exchange-rate') {
    const rate = Number(values.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      warnings.push({
        code: 'invalid-exchange-rate', severity: 'critical',
        title: language === 'es' ? 'Tasa de cambio guardada no válida' : 'Saved exchange rate is invalid',
        message: language === 'es'
          ? 'La tasa guardada no es un número positivo. Puede distorsionar precios, cobros y pagos. Suspende el uso de este par y corrige la tasa antes de procesar operaciones.'
          : 'The saved rate is not a positive number. It can distort prices, collections and payouts. Suspend use of this pair and correct the rate before processing transactions.',
        impact: language === 'es' ? 'Riesgo de pérdida en pedidos y remesas' : 'Order and remittance loss risk'
      });
    }
  }
  if (kind === 'remittance-type') {
    const marketRate = Number(values.exchange_rate);
    const deliveryRate = Number(values.delivery_rate);
    const commissionPct = Number(values.commission_percentage || 0);
    const fixedCommission = Number(values.commission_fixed || 0);
    if (!Number.isFinite(marketRate) || marketRate <= 0 || !Number.isFinite(commissionPct)
      || commissionPct < 0 || commissionPct >= 100 || !Number.isFinite(fixedCommission)
      || fixedCommission < 0 || (Number.isFinite(deliveryRate) && deliveryRate > marketRate)) {
      warnings.push(getInvalidRemittanceRateWarning({ language }));
    }
  }
  warnings.forEach(publishFinancialRiskWarning);
  return warnings;
}
