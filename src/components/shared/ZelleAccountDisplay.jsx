/**
 * ZelleAccountDisplay Component
 * Displays Zelle account information with optional copy buttons
 * Used in both remittance and order payment flows
 */

import { Copy, CreditCard } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const ZelleAccountDisplay = ({
  account,
  showCopyButtons = true,
  onCopy = () => {},
  className = ''
}) => {
  const { language } = useLanguage();

  if (!account) return null;

  const accountName = account.account_name || account.account_holder || account.name;
  const email = account.email || account.zelle_email;
  const phone = account.phone_number || account.phone;

  const handleCopy = (value, label) => {
    navigator.clipboard.writeText(value).then(() => {
      onCopy(label, value);
    }).catch(err => {
      console.error('Copy failed:', err);
    });
  };

  // Inline copy button that appears next to the value
  const InlineCopyButton = ({ value, label }) => (
    <button
      type="button"
      onClick={() => handleCopy(value, label)}
      className="ml-2 p-1.5 bg-blue-100 hover:bg-blue-200 rounded-md transition-colors inline-flex items-center"
      title={language === 'es' ? `Copiar ${label}` : `Copy ${label}`}
    >
      <Copy className="h-4 w-4 text-blue-600" />
    </button>
  );

  return (
    <div className={`glass-effect p-6 rounded-xl border-2 border-blue-200 bg-blue-50 ${className}`}>
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-blue-900">
        <CreditCard className="h-5 w-5" />
        {language === 'es' ? 'Envía tu pago Zelle a:' : 'Send your Zelle payment to:'}
      </h3>
      <div className="space-y-3">
        {/* Account Name */}
        <div className="bg-white p-3 rounded-lg">
          <p className="text-xs text-gray-500 mb-1">
            {language === 'es' ? 'Nombre de Cuenta' : 'Account Name'}
          </p>
          <div className="flex items-center">
            <p className="font-semibold text-gray-800">{accountName}</p>
            {showCopyButtons && <InlineCopyButton value={accountName} label="Nombre" />}
          </div>
        </div>

        {/* Email */}
        {email && (
          <div className="bg-white p-3 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">Email Zelle</p>
            <div className="flex items-center">
              <p className="font-semibold text-gray-800">{email}</p>
              {showCopyButtons && <InlineCopyButton value={email} label="Email" />}
            </div>
          </div>
        )}

        {/* Phone */}
        {phone && (
          <div className="bg-white p-3 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">
              {language === 'es' ? 'Teléfono Zelle' : 'Zelle Phone'}
            </p>
            <div className="flex items-center">
              <p className="font-semibold text-gray-800">{phone}</p>
              {showCopyButtons && <InlineCopyButton value={phone} label="Teléfono" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ZelleAccountDisplay;
