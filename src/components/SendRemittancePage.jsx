import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, ArrowLeft, Check, DollarSign, User, FileText, Upload,
  AlertCircle, CheckCircle, Calculator
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
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
  const { user } = useAuth();

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
        description: 'Por favor seleccione un tipo y monto',
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
        description: 'Por favor complete nombre y teléfono del destinatario',
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
        description: 'Remesa creada exitosamente'
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
        description: 'Por favor suba el comprobante y la referencia de pago',
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
        description: 'Comprobante enviado. Recibirá notificación cuando se valide el pago.'
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
        Enviar Remesa
      </h1>
      <p className="text-gray-600 text-center mb-8">
        Envía dinero de forma rápida y segura
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
                Tipo y Monto de Remesa
              </h2>

              {/* Type Selection */}
              <div className="space-y-3 mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Seleccione el tipo de remesa *
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
                          <span className="text-gray-600">Tasa: </span>
                          <span className="font-semibold">
                            1 {type.currency_code} = {type.exchange_rate} {type.delivery_currency}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Límites</p>
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
                    Monto a enviar ({selectedType.currency_code}) *
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
                    Monto mínimo: {selectedType.min_amount} {selectedType.currency_code}
                    {selectedType.max_amount && ` • Máximo: ${selectedType.max_amount} ${selectedType.currency_code}`}
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
                {calculating ? 'Calculando...' : 'Continuar'}
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
                Resumen del Cálculo
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Monto a enviar</p>
                  <p className="text-2xl font-bold">{calculation.amount} {calculation.currency}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Comisión</p>
                  <p className="text-xl font-semibold text-red-600">
                    -{calculation.totalCommission.toFixed(2)} {calculation.currency}
                  </p>
                </div>
                <div className="col-span-2 pt-4 border-t-2 border-blue-200">
                  <p className="text-sm text-gray-600 mb-1">Destinatario recibirá</p>
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
                Datos del Destinatario
              </h2>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre completo *
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
                    Teléfono *
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
                    Ciudad
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
                    Dirección
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
                    Carnet de Identidad
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
                    Notas adicionales
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
                Atrás
              </button>
              <button
                onClick={handleRecipientSubmit}
                className={`${getPrimaryButtonStyle()} flex items-center gap-2`}
              >
                Continuar
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
                Confirmar Remesa
              </h2>

              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-2">Tipo de Remesa</h3>
                  <p className="text-gray-700">{selectedType.name}</p>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Monto a Enviar</h3>
                  <p className="text-2xl font-bold text-blue-600">
                    {calculation.amount} {calculation.currency}
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Destinatario Recibirá</h3>
                  <p className="text-2xl font-bold text-green-600">
                    {calculation.amountToDeliver.toFixed(2)} {calculation.deliveryCurrency}
                  </p>
                </div>

                <div className="pt-4 border-t">
                  <h3 className="font-semibold mb-2">Datos del Destinatario</h3>
                  <div className="space-y-1 text-gray-700">
                    <p><span className="font-medium">Nombre:</span> {recipientData.name}</p>
                    <p><span className="font-medium">Teléfono:</span> {recipientData.phone}</p>
                    {recipientData.city && (
                      <p><span className="font-medium">Ciudad:</span> {recipientData.city}</p>
                    )}
                    {recipientData.address && (
                      <p><span className="font-medium">Dirección:</span> {recipientData.address}</p>
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
                Atrás
              </button>
              <button
                onClick={handleConfirmRemittance}
                disabled={submitting}
                className={`${getPrimaryButtonStyle()} flex items-center gap-2 disabled:opacity-50`}
              >
                {submitting ? 'Creando...' : 'Confirmar Remesa'}
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
              <h2 className="text-2xl font-bold mb-2">Remesa Creada</h2>
              <p className="text-gray-600 mb-4">
                Número de remesa: <span className="font-bold">{createdRemittance.remittance_number}</span>
              </p>
            </div>

            <form onSubmit={handlePaymentProofSubmit} className="glass-effect p-6 rounded-xl">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Upload className="h-6 w-6 text-blue-600" />
                Subir Comprobante de Pago
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Comprobante de pago *
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
                    Referencia de pago *
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
                    Notas adicionales
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
                    <p className="font-semibold mb-1">Importante:</p>
                    <p>Su remesa será procesada una vez validemos el comprobante de pago. Recibirá una notificación cuando esto ocurra.</p>
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
                  Subir Después
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`flex-1 ${getPrimaryButtonStyle()} disabled:opacity-50`}
                >
                  {submitting ? 'Enviando...' : 'Enviar Comprobante'}
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
