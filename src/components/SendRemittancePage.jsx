import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, ArrowLeft, Check, DollarSign, User, FileText, Upload,
  AlertCircle, CheckCircle, Calculator
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useModal } from '@/contexts/ModalContext';
import {
  getActiveRemittanceTypes,
  calculateRemittance,
  createRemittance,
  uploadPaymentProof
} from '@/lib/remittanceService';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';

const SendRemittancePage = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const { showModal } = useModal();

  const [step, setStep] = useState(1);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedType, setSelectedType] = useState(null);
  const [amount, setAmount] = useState('');
  const [calculation, setCalculation] = useState(null);

  const [recipientData, setRecipientData] = useState({
    name: '',
    phone: '',
    address: '',
    city: '',
    id_number: '',
    notes: ''
  });

  const [paymentData, setPaymentData] = useState({
    file: null,
    reference: '',
    notes: ''
  });

  const [createdRemittance, setCreatedRemittance] = useState(null);

  useEffect(() => {
    loadTypes();
  }, []);

  useEffect(() => {
    if (isAdmin || isSuperAdmin) {
      showModal({
        type: 'info',
        title: t('common.accessDenied'),
        message: t('remittances.admin.adminCannotSendRemittance'),
        confirmText: t('common.ok')
      }).then(() => {
        onNavigate('dashboard');
      });
    }
  }, [isAdmin, isSuperAdmin]);

  const loadTypes = async () => {
    setLoading(true);
    const result = await getActiveRemittanceTypes();
    if (result.success) {
      setTypes(result.types);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
    setLoading(false);
  };

  const handleSelectType = (type) => {
    setSelectedType(type);
    setAmount('');
    setCalculation(null);
  };

  const handleCalculate = async () => {
    if (!selectedType || !amount) {
      toast({
        title: t('common.error'),
        description: t('remittances.wizard.selectTypeAndAmount'),
        variant: 'destructive'
      });
      return;
    }

    setCalculating(true);
    const result = await calculateRemittance(selectedType.id, parseFloat(amount));

    if (result.success) {
      setCalculation(result.calculation);
      setStep(2);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }
    setCalculating(false);
  };

  const handleRecipientSubmit = () => {
    if (!recipientData.name || !recipientData.phone) {
      toast({
        title: t('common.error'),
        description: t('remittances.wizard.fillRecipientInfo'),
        variant: 'destructive'
      });
      return;
    }
    setStep(3);
  };

  const handleConfirmRemittance = async () => {
    setSubmitting(true);

    const remittanceData = {
      remittance_type_id: selectedType.id,
      amount: parseFloat(amount),
      recipient_name: recipientData.name,
      recipient_phone: recipientData.phone,
      recipient_address: recipientData.address,
      recipient_city: recipientData.city,
      recipient_id_number: recipientData.id_number,
      notes: recipientData.notes
    };

    const result = await createRemittance(remittanceData);

    if (result.success) {
      setCreatedRemittance(result.remittance);
      toast({
        title: t('common.success'),
        description: t('remittances.wizard.remittanceCreatedSuccess')
      });
      setStep(4);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }

    setSubmitting(false);
  };

  const handlePaymentProofSubmit = async (e) => {
    e.preventDefault();

    if (!paymentData.file || !paymentData.reference) {
      toast({
        title: t('common.error'),
        description: t('remittances.wizard.uploadProofAndReference'),
        variant: 'destructive'
      });
      return;
    }

    setSubmitting(true);

    const result = await uploadPaymentProof(
      createdRemittance.id,
      paymentData.file,
      paymentData.reference,
      paymentData.notes
    );

    if (result.success) {
      toast({
        title: t('common.success'),
        description: t('remittances.wizard.proofSentSuccess')
      });

      // Redirect to my remittances
      setTimeout(() => {
        if (onNavigate) {
          onNavigate('myRemittances');
        }
      }, 2000);
    } else {
      toast({
        title: t('common.error'),
        description: result.error,
        variant: 'destructive'
      });
    }

    setSubmitting(false);
  };

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center mb-8">
      {[1, 2, 3, 4].map((stepNum) => (
        <React.Fragment key={stepNum}>
          <div
            className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
              step >= stepNum
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-gray-300 text-gray-400'
            }`}
          >
            {step > stepNum ? (
              <Check className="h-5 w-5" />
            ) : (
              <span className="font-semibold">{stepNum}</span>
            )}
          </div>
          {stepNum < 4 && (
            <div
              className={`h-0.5 w-16 transition-all ${
                step > stepNum ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <h1 className={`${getHeadingStyle()} text-3xl mb-2 text-center`}>
        {t('remittances.wizard.pageTitle')}
      </h1>
      <p className="text-gray-600 text-center mb-8">
        {t('remittances.wizard.pageSubtitle')}
      </p>

      {renderStepIndicator()}

      <AnimatePresence mode="wait">
        {/* Step 1: Select Type and Amount */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="glass-effect p-6 rounded-xl">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <DollarSign className="h-6 w-6 text-blue-600" />
                {t('remittances.wizard.step1Title')}
              </h2>

              {/* Type Selection */}
              <div className="space-y-3 mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('remittances.wizard.selectTypeRequired')}
                </label>
                {types.map((type) => (
                  <div
                    key={type.id}
                    onClick={() => handleSelectType(type)}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      selectedType?.id === type.id
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-lg">{type.name}</h3>
                        {type.description && (
                          <p className="text-sm text-gray-600 mt-1">{type.description}</p>
                        )}
                        <div className="mt-2 text-sm">
                          <span className="text-gray-600">{t('remittances.wizard.rate')}: </span>
                          <span className="font-semibold">
                            1 {type.currency_code} = {type.exchange_rate} {type.delivery_currency}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">{t('remittances.wizard.limits')}</p>
                        <p className="text-sm font-semibold">
                          {type.min_amount} - {type.max_amount || '∞'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{type.currency_code}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Amount Input */}
              {selectedType && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.wizard.amountToSend')} ({selectedType.currency_code}) *
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                      placeholder={`Ej: ${selectedType.min_amount}`}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {t('remittances.wizard.minAmount')}: {selectedType.min_amount} {selectedType.currency_code}
                    {selectedType.max_amount && ` • ${t('remittances.wizard.maxAmount')}: ${selectedType.max_amount} ${selectedType.currency_code}`}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleCalculate}
                disabled={!selectedType || !amount || calculating}
                className={`${getPrimaryButtonStyle()} flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {calculating ? t('remittances.wizard.calculating') : t('remittances.wizard.continue')}
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 2: Recipient Details */}
        {step === 2 && calculation && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            {/* Calculation Summary */}
            <div className="glass-effect p-6 rounded-xl bg-gradient-to-r from-blue-50 to-purple-50">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Calculator className="h-5 w-5 text-blue-600" />
                {t('remittances.wizard.calculationSummary')}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">{t('remittances.wizard.youSend')}</p>
                  <p className="text-2xl font-bold">{calculation.amount} {calculation.currency}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">{t('remittances.wizard.commission')}</p>
                  <p className="text-xl font-semibold text-red-600">
                    -{calculation.totalCommission.toFixed(2)} {calculation.currency}
                  </p>
                </div>
                <div className="col-span-2 pt-4 border-t-2 border-blue-200">
                  <p className="text-sm text-gray-600 mb-1">{t('remittances.wizard.recipientReceives')}</p>
                  <p className="text-3xl font-bold text-green-600">
                    {calculation.amountToDeliver.toFixed(2)} {calculation.deliveryCurrency}
                  </p>
                </div>
              </div>
            </div>

            {/* Recipient Form */}
            <div className="glass-effect p-6 rounded-xl">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <User className="h-6 w-6 text-blue-600" />
                {t('remittances.wizard.step2Title')}
              </h2>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.recipient.fullName')} *
                  </label>
                  <input
                    type="text"
                    value={recipientData.name}
                    onChange={(e) => setRecipientData({ ...recipientData, name: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Juan Pérez"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.recipient.phone')} *
                  </label>
                  <input
                    type="tel"
                    value={recipientData.phone}
                    onChange={(e) => setRecipientData({ ...recipientData, phone: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="+53 5555 5555"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.recipient.city')}
                  </label>
                  <input
                    type="text"
                    value={recipientData.city}
                    onChange={(e) => setRecipientData({ ...recipientData, city: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="La Habana"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.recipient.address')}
                  </label>
                  <input
                    type="text"
                    value={recipientData.address}
                    onChange={(e) => setRecipientData({ ...recipientData, address: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Calle 23, entre L y M, Vedado"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.recipient.idNumber')}
                  </label>
                  <input
                    type="text"
                    value={recipientData.id_number}
                    onChange={(e) => setRecipientData({ ...recipientData, id_number: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="12345678901"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.recipient.notes')}
                  </label>
                  <textarea
                    value={recipientData.notes}
                    onChange={(e) => setRecipientData({ ...recipientData, notes: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows="3"
                    placeholder="Información adicional..."
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <ArrowLeft className="h-5 w-5" />
                {t('remittances.wizard.back')}
              </button>
              <button
                onClick={handleRecipientSubmit}
                className={`${getPrimaryButtonStyle()} flex items-center gap-2`}
              >
                {t('remittances.wizard.continue')}
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="glass-effect p-6 rounded-xl">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <FileText className="h-6 w-6 text-blue-600" />
                {t('remittances.wizard.step3Title')}
              </h2>

              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-2">{t('common.type')} {t('nav.remittances')}</h3>
                  <p className="text-gray-700">{selectedType.name}</p>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">{t('remittances.wizard.youSend')}</h3>
                  <p className="text-2xl font-bold text-blue-600">
                    {calculation.amount} {calculation.currency}
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">{t('remittances.wizard.recipientReceives')}</h3>
                  <p className="text-2xl font-bold text-green-600">
                    {calculation.amountToDeliver.toFixed(2)} {calculation.deliveryCurrency}
                  </p>
                </div>

                <div className="pt-4 border-t">
                  <h3 className="font-semibold mb-2">{t('remittances.wizard.step2Title')}</h3>
                  <div className="space-y-1 text-gray-700">
                    <p><span className="font-medium">{t('common.name')}:</span> {recipientData.name}</p>
                    <p><span className="font-medium">{t('common.phone')}:</span> {recipientData.phone}</p>
                    {recipientData.city && (
                      <p><span className="font-medium">{t('common.city')}:</span> {recipientData.city}</p>
                    )}
                    {recipientData.address && (
                      <p><span className="font-medium">{t('common.address')}:</span> {recipientData.address}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <ArrowLeft className="h-5 w-5" />
                {t('remittances.wizard.back')}
              </button>
              <button
                onClick={handleConfirmRemittance}
                disabled={submitting}
                className={`${getPrimaryButtonStyle()} flex items-center gap-2 disabled:opacity-50`}
              >
                {submitting ? t('remittances.wizard.creating') : t('remittances.wizard.confirmAndCreate')}
                <CheckCircle className="h-5 w-5" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 4: Upload Payment Proof */}
        {step === 4 && createdRemittance && (
          <motion.div
            key="step4"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="glass-effect p-6 rounded-xl text-center">
              <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-2">{t('remittances.wizard.remittanceCreated')}</h2>
              <p className="text-gray-600 mb-4">
                {t('remittances.wizard.remittanceNumber')}: <span className="font-bold">{createdRemittance.remittance_number}</span>
              </p>
            </div>

            <form onSubmit={handlePaymentProofSubmit} className="glass-effect p-6 rounded-xl">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Upload className="h-6 w-6 text-blue-600" />
                {t('remittances.wizard.step4Title')}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.user.paymentProof')} *
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setPaymentData({ ...paymentData, file: e.target.files[0] })}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.user.paymentReference')} *
                  </label>
                  <input
                    type="text"
                    value={paymentData.reference}
                    onChange={(e) => setPaymentData({ ...paymentData, reference: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Ej: ZELLE123456"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('remittances.user.additionalNotes')}
                  </label>
                  <textarea
                    value={paymentData.notes}
                    onChange={(e) => setPaymentData({ ...paymentData, notes: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows="3"
                    placeholder="Detalles adicionales del pago..."
                  />
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-semibold mb-1">{t('remittances.wizard.importantNote')}:</p>
                    <p>{t('remittances.wizard.proofNote')}</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    if (onNavigate) {
                      onNavigate('myRemittances');
                    }
                  }}
                  className="flex-1 px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {t('remittances.wizard.uploadLater')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`flex-1 ${getPrimaryButtonStyle()} disabled:opacity-50`}
                >
                  {submitting ? t('remittances.wizard.sending') : t('remittances.wizard.sendProof')}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SendRemittancePage;
