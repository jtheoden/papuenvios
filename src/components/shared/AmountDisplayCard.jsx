/**
 * AmountDisplayCard Component
 * Displays payment amount with optional currency conversion info
 * Used in both remittance and order payment flows
 */

import { Copy } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const AmountDisplayCard = ({
  amount,
  currency = 'USD',
  deliveryAmount = null,
  deliveryCurrency = null,
  showCopyButton = true,
  onCopy = () => {},
  label = null,
  className = ''
}) => {
  const { language } = useLanguage();

  const handleCopy = () => {
    navigator.clipboard.writeText(String(amount)).then(() => {
      onCopy(amount);
    }).catch(err => {
      console.error('Copy failed:', err);
    });
  };

  const defaultLabel = language === 'es' ? 'Monto a Transferir' : 'Amount to Transfer';
  const displayLabel = label || defaultLabel;

  return (
    <div className={`glass-effect p-6 rounded-xl border-2 border-green-200 bg-green-50 ${className}`}>
      <h3 className="text-lg font-bold mb-3 text-green-900">
        {displayLabel}
      </h3>
      <div className="flex items-center justify-between bg-white p-4 rounded-lg border-2 border-green-300">
        <div>
          <p className="text-3xl font-bold text-green-600">
            ${amount} {currency}
          </p>
          {deliveryAmount && deliveryCurrency && (
            <p className="text-sm text-gray-500 mt-1">
              {language === 'es' ? 'El destinatario recibirá:' : 'Recipient will receive:'}{' '}
              {typeof deliveryAmount === 'number' ? deliveryAmount.toFixed(2) : deliveryAmount} {deliveryCurrency}
            </p>
          )}
        </div>
        {showCopyButton && (
          <button
            type="button"
            onClick={handleCopy}
            className="p-3 bg-green-100 hover:bg-green-200 rounded-lg transition-colors flex-shrink-0"
            title={language === 'es' ? 'Copiar monto' : 'Copy amount'}
          >
            <Copy className="h-6 w-6 text-green-600" />
          </button>
        )}
      </div>
    </div>
  );
};

export default AmountDisplayCard;
