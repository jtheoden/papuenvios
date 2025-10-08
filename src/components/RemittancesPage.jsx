import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, Calculator, TrendingUp, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle, getInputStyle } from '@/lib/styleUtils';
import { getEnabledRemittanceConfigs, getPaymentMethodsForCurrency } from '@/lib/remittanceService';

const RemittancesPage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();
  const [amount, setAmount] = useState('');
  const [country, setCountry] = useState('');
  const [view, setView] = useState('offers'); // offers, recipient
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [recipientDetails, setRecipientDetails] = useState({
    deliveryMethod: 'transfer',
    currency: 'USD',
    fullName: '',
    bankName: '',
    accountNumber: ''
  });

  // Remittance configuration state
  const [remittanceConfigs, setRemittanceConfigs] = useState([]);
  const [availablePaymentMethods, setAvailablePaymentMethods] = useState([]);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // Load remittance configurations
  useEffect(() => {
    loadRemittanceConfigs();
  }, []);

  // Load payment methods when currency changes
  useEffect(() => {
    if (recipientDetails.currency) {
      loadPaymentMethods(recipientDetails.currency);
    }
  }, [recipientDetails.currency]);

  const loadRemittanceConfigs = async () => {
    setLoadingConfig(true);
    try {
      const result = await getEnabledRemittanceConfigs();
      if (result.success) {
        setRemittanceConfigs(result.configs);
        // Set default currency if available
        if (result.configs.length > 0 && !recipientDetails.currency) {
          setRecipientDetails(prev => ({
            ...prev,
            currency: result.configs[0].currency
          }));
        }
      }
    } catch (error) {
      console.error('Error loading remittance configs:', error);
    } finally {
      setLoadingConfig(false);
    }
  };

  const loadPaymentMethods = async (currency) => {
    try {
      const result = await getPaymentMethodsForCurrency(currency);
      if (result.success) {
        setAvailablePaymentMethods(result.methods);
        // Set default payment method if available
        if (result.methods.length > 0) {
          setRecipientDetails(prev => ({
            ...prev,
            deliveryMethod: result.methods[0].id
          }));
        }
      }
    } catch (error) {
      console.error('Error loading payment methods:', error);
    }
  };

  const remittanceOffers = [
    { id: 1, country: 'Cuba', rate: 120, fee: 5, time: '2-4 hours', popular: true, currency: 'CUP' },
  ];

  const handleSendRemittance = (offer) => {
    setSelectedOffer(offer);
    setView('recipient');
  };

  const handleRecipientSubmit = () => {
    toast({ title: "🚧 Esta funcionalidad no está implementada aún—¡pero no te preocupes! ¡Puedes solicitarla en tu próximo prompt! 🚀" });
    setView('offers');
    setAmount('');
  };

  const calculateTotal = (offer) => {
    if (!amount) return 0;
    const usdAmount = parseFloat(amount);
    return (usdAmount * offer.rate - offer.fee).toFixed(2);
  };

  if (view === 'recipient') {
    return (
      <div className="container mx-auto max-w-2xl py-8 px-4">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="glass-effect p-8 rounded-2xl">
          <h1 className="text-3xl font-bold mb-6" style={getHeadingStyle(visualSettings)}>{t('remittances.recipient.title')}</h1>
          <div className="space-y-4">
            {/* Currency Selector */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {language === 'es' ? 'Moneda' : 'Currency'}
              </label>
              <select
                value={recipientDetails.currency}
                onChange={e => setRecipientDetails({...recipientDetails, currency: e.target.value})}
                className="input-style w-full"
                style={getInputStyle(visualSettings)}
              >
                {remittanceConfigs.map(config => (
                  <option key={config.currency} value={config.currency}>
                    {config.currency} - {config.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {language === 'es' ? 'Método de Pago' : 'Payment Method'}
              </label>
              <select
                value={recipientDetails.deliveryMethod}
                onChange={e => setRecipientDetails({...recipientDetails, deliveryMethod: e.target.value})}
                className="input-style w-full"
                style={getInputStyle(visualSettings)}
              >
                {availablePaymentMethods.map(method => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Recipient Full Name */}
            <div>
              <label className="block text-sm font-medium mb-2">
                {t('remittances.recipient.fullName')}
              </label>
              <input
                type="text"
                placeholder={t('remittances.recipient.fullName')}
                value={recipientDetails.fullName}
                onChange={e => setRecipientDetails({...recipientDetails, fullName: e.target.value})}
                className="input-style w-full"
                style={getInputStyle(visualSettings)}
              />
            </div>

            {/* Conditional fields based on payment method */}
            {(recipientDetails.deliveryMethod === 'transfer' || recipientDetails.deliveryMethod === 'card_transfer') && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    {t('remittances.recipient.bankName')}
                  </label>
                  <input
                    type="text"
                    placeholder={t('remittances.recipient.bankName')}
                    value={recipientDetails.bankName}
                    onChange={e => setRecipientDetails({...recipientDetails, bankName: e.target.value})}
                    className="input-style w-full"
                    style={getInputStyle(visualSettings)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    {recipientDetails.deliveryMethod === 'card_transfer'
                      ? (language === 'es' ? 'Número de Tarjeta' : 'Card Number')
                      : t('remittances.recipient.accountNumber')}
                  </label>
                  <input
                    type="text"
                    placeholder={recipientDetails.deliveryMethod === 'card_transfer'
                      ? (language === 'es' ? 'Número de Tarjeta' : 'Card Number')
                      : t('remittances.recipient.accountNumber')}
                    value={recipientDetails.accountNumber}
                    onChange={e => setRecipientDetails({...recipientDetails, accountNumber: e.target.value})}
                    className="input-style w-full"
                    style={getInputStyle(visualSettings)}
                  />
                </div>
              </>
            )}

            {/* Info message for cash pickup */}
            {recipientDetails.deliveryMethod === 'cash' && (
              <div className="p-4 rounded-lg" style={{
                backgroundColor: `${visualSettings.primaryColor || '#2563eb'}10`,
                borderColor: visualSettings.primaryColor || '#2563eb',
                borderWidth: '1px',
                borderStyle: 'solid'
              }}>
                <p className="text-sm">
                  {language === 'es'
                    ? 'El destinatario recogerá el efectivo en el punto de entrega especificado.'
                    : 'The recipient will pick up cash at the specified delivery point.'}
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={() => setView('offers')}>{t('vendor.addProduct.cancel')}</Button>
            <Button onClick={handleRecipientSubmit} style={getPrimaryButtonStyle(visualSettings)}>{t('remittances.recipient.confirm')}</Button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container mx-auto">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4" style={getHeadingStyle(visualSettings)}>{t('remittances.title')}</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">{t('remittances.subtitle')}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-effect p-8 rounded-2xl mb-8">
          <div className="grid md:grid-cols-2 gap-6">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t('remittances.amount')} className="input-style w-full" />
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="input-style w-full">
              <option value="">{t('remittances.selectCountry')}</option>
              {remittanceOffers.map(offer => <option key={offer.id} value={offer.country}>{offer.country}</option>)}
            </select>
          </div>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {remittanceOffers.map((offer, index) => (
            <motion.div key={offer.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }} className={`glass-effect rounded-2xl p-6 hover-lift relative ${offer.popular ? 'ring-2 ring-blue-500' : ''}`}>
              {offer.popular && <div className="absolute -top-3 left-1/2 transform -translate-x-1/2"><span className="bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-semibold">{t('remittances.popular')}</span></div>}
              <h3 className="text-lg font-semibold text-center mb-4">{offer.country}</h3>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between"><span>{t('remittances.rate')}:</span><span className="font-semibold">{offer.rate.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>{t('remittances.fee')}:</span><span className="font-semibold">${offer.fee}</span></div>
                <div className="flex justify-between"><span>{t('remittances.time')}:</span><span className="font-semibold flex items-center"><Clock className="w-4 h-4 mr-1" />{offer.time}</span></div>
                {amount && (
                  <div className="border-t pt-3 mt-3">
                    <div className="flex justify-between text-lg font-bold" style={{ color: visualSettings.accentColor || '#22c55e' }}>
                      <span>{t('remittances.youReceive')}:</span>
                      <span>{calculateTotal(offer)} {offer.currency || 'USD'}</span>
                    </div>
                  </div>
                )}
              </div>
              <Button
                onClick={() => handleSendRemittance(offer)}
                className="w-full"
                disabled={!amount}
                style={getPrimaryButtonStyle(visualSettings)}
              >
                <Send className="w-4 h-4 mr-2" />{t('remittances.send')}
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RemittancesPage;