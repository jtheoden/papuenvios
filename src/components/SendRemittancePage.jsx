import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, ArrowLeft, Check, DollarSign, User, FileText, Upload,
  AlertCircle, CheckCircle, Calculator, Copy, CreditCard, MessageCircle
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useModal } from '@/contexts/ModalContext';
import { useBusiness } from '@/contexts/BusinessContext';
import {
  getActiveRemittanceTypes,
  calculateRemittance,
  createRemittance,
  uploadPaymentProof
} from '@/lib/remittanceService';
import { getActiveShippingZones } from '@/lib/shippingService';
import { getMunicipalitiesByProvince } from '@/lib/cubanLocations';
import { notifyAdminNewPaymentProof } from '@/lib/whatsappService';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import RecipientSelector from '@/components/RecipientSelector';
import ZelleAccountSelector from '@/components/ZelleAccountSelector';
import FileUploadWithPreview from '@/components/FileUploadWithPreview';

const SendRemittancePage = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const { showModal } = useModal();
  const { notificationSettings } = useBusiness();

  const recipientSelectorRef = useRef();

  const [step, setStep] = useState(1);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedType, setSelectedType] = useState(null);
  const [amount, setAmount] = useState('');
  const [calculation, setCalculation] = useState(null);

  const [selectedRecipientData, setSelectedRecipientData] = useState(null);
  const [selectedZelle, setSelectedZelle] = useState(null);
  const [shippingZones, setShippingZones] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);

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

  const [imagePreview, setImagePreview] = useState(null);
  const [createdRemittance, setCreatedRemittance] = useState(null);

  useEffect(() => {
    loadTypes();
    loadShippingZones();
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

  const loadShippingZones = async () => {
    try {
      const result = await getActiveShippingZones();
      if (result.success) {
        const availableZones = (result.zones || []).filter(zone => {
          const cost = parseFloat(zone.shipping_cost || 0);
          return zone.free_shipping === true || cost > 0;
        });
        setShippingZones(availableZones);
      }
    } catch (error) {
      console.error('Error loading shipping zones:', error);
    }
  };

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
    if (!selectedRecipientData) {
      toast({
        title: t('common.error'),
        description: t('remittances.wizard.selectRecipient') || 'Selecciona un destinatario',
        variant: 'destructive'
      });
      return;
    }

    if (!recipientData.name || !recipientData.phone) {
      toast({
        title: t('common.error'),
        description: t('remittances.wizard.fillRecipientInfo'),
        variant: 'destructive'
      });
      return;
    }

    if (!selectedZelle) {
      toast({
        title: t('common.error'),
        description: t('zelle.selectAccountRequired') || 'Selecciona una cuenta Zelle',
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

  const handleCopyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({
        title: t('common.success'),
        description: `${label} copiado al portapapeles`,
        variant: 'default'
      });
    }).catch(() => {
      toast({
        title: t('common.error'),
        description: 'Error al copiar al portapapeles',
        variant: 'destructive'
      });
    });
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setPaymentData({ ...paymentData, file });

    // Generate preview
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      setImagePreview(null);
    }
  };

  const handleNotifyAdminWhatsApp = () => {
    if (!notificationSettings?.whatsapp) {
      toast({
        title: t('common.error'),
        description: 'Número de WhatsApp del administrador no configurado',
        variant: 'destructive'
      });
      return;
    }

    try {
      const enrichedRemittance = {
        ...createdRemittance,
        remittance_types: selectedType,
        remittance_type: selectedType,
        amount: parseFloat(amount),
        currency: calculation?.currency || 'USD',
        amount_to_deliver: calculation?.amountToDeliver,
        delivery_currency: calculation?.deliveryCurrency,
        payment_reference: paymentData.reference || '(Pendiente)'
      };
      notifyAdminNewPaymentProof(enrichedRemittance, notificationSettings.whatsapp, t('common.language') === 'en' ? 'en' : 'es');

      toast({
        title: t('common.success'),
        description: 'WhatsApp abierto. Envía el mensaje al administrador.'
      });
    } catch (error) {
      console.error('Error opening WhatsApp:', error);
      toast({
        title: t('common.error'),
        description: 'Error al abrir WhatsApp',
        variant: 'destructive'
      });
    }
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

      // Send WhatsApp notification to admin if configured
      if (notificationSettings?.whatsapp) {
        try {
          // Enrich remittance data with full information for WhatsApp notification
          const enrichedRemittance = {
            ...createdRemittance,
            remittance_types: selectedType,
            remittance_type: selectedType,
            amount: parseFloat(amount),
            currency: calculation?.currency || 'USD',
            amount_to_deliver: calculation?.amountToDeliver,
            delivery_currency: calculation?.deliveryCurrency,
            payment_reference: paymentData.reference
          };
          notifyAdminNewPaymentProof(enrichedRemittance, notificationSettings.whatsapp, t('common.language') === 'en' ? 'en' : 'es');
        } catch (error) {
          console.error('Error sending WhatsApp notification:', error);
          // Don't prevent the redirect if WhatsApp notification fails
        }
      }

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

            {/* Zelle Account Selector - First */}
            <div className="glass-effect p-6 rounded-xl">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <DollarSign className="h-6 w-6 text-blue-600" />
                {t('zelle.selectAccount')}
              </h2>
              <ZelleAccountSelector
                onSelect={(account) => {
                  setSelectedZelle(account);
                }}
              />
            </div>

            {/* Recipient Selector - Second */}
            <div className="glass-effect p-6 rounded-xl">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <User className="h-6 w-6 text-blue-600" />
                {t('remittances.wizard.step2Title')}
              </h2>
              <RecipientSelector
                ref={recipientSelectorRef}
                onSelect={(recipientData) => {
                  setSelectedRecipientData(recipientData);
                  if (recipientData.recipientData) {
                    // Existing recipient selected
                    setRecipientData({
                      name: recipientData.recipientData.full_name || '',
                      phone: recipientData.recipientData.phone || '',
                      address: recipientData.recipientData.addresses?.[0]?.address_line_1 || '',
                      city: recipientData.recipientData.addresses?.[0]?.municipality || '',
                      id_number: recipientData.recipientData.id_number || '',
                      notes: ''
                    });
                  } else if (recipientData.formData) {
                    // New recipient created
                    setRecipientData({
                      name: recipientData.formData.full_name || '',
                      phone: recipientData.formData.phone || '',
                      address: recipientData.formData.address_line_1 || '',
                      city: recipientData.formData.municipality || '',
                      id_number: '',
                      notes: ''
                    });
                  }
                }}
                shippingZones={shippingZones}
                municipalities={municipalities}
                showAddressSelection={true}
                showProvinceInForm={true}
              />
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

            {/* Zelle Account Information */}
            {selectedZelle && (
              <div className="glass-effect p-6 rounded-xl border-2 border-blue-200 bg-blue-50">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-blue-900">
                  <CreditCard className="h-5 w-5" />
                  {t('remittances.wizard.zelleAccountInfo')}
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-white p-3 rounded-lg">
                    <div>
                      <p className="text-xs text-gray-500">{t('remittances.wizard.accountName')}</p>
                      <p className="font-semibold text-gray-800">{selectedZelle.account_name}</p>
                      {selectedZelle.phone_number && (
                        <p className="text-sm text-gray-700 font-medium mt-1">
                          {selectedZelle.phone_number}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyToClipboard(selectedZelle.account_name, 'Nombre de cuenta')}
                      className="p-2 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
                      title="Copiar nombre de cuenta"
                    >
                      <Copy className="h-4 w-4 text-blue-600" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between bg-white p-3 rounded-lg">
                    <div>
                      <p className="text-xs text-gray-500">{t('remittances.wizard.zelleEmail')}</p>
                      <p className="font-semibold text-gray-800">{selectedZelle.email || selectedZelle.zelle_email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyToClipboard(selectedZelle.email || selectedZelle.zelle_email, 'Email Zelle')}
                      className="p-2 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
                      title="Copiar email Zelle"
                    >
                      <Copy className="h-4 w-4 text-blue-600" />
                    </button>
                  </div>

                  {(selectedZelle.phone_number || selectedZelle.phone || selectedZelle.telefono) && (
                    <div className="flex items-center justify-between bg-white p-3 rounded-lg">
                      <div>
                        <p className="text-xs text-gray-500">{t('common.phone')}</p>
                        <p className="font-semibold text-gray-800">{selectedZelle.phone_number || selectedZelle.phone || selectedZelle.telefono}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyToClipboard(selectedZelle.phone_number || selectedZelle.phone || selectedZelle.telefono, 'Teléfono')}
                        className="p-2 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
                        title="Copiar teléfono"
                      >
                        <Copy className="h-4 w-4 text-blue-600" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Remittance ID and Amount to Transfer */}
            <div className="glass-effect p-6 rounded-xl border-2 border-green-200 bg-green-50">
              <h3 className="text-lg font-bold mb-4 text-green-900">
                {t('remittances.wizard.transferDescription')}
              </h3>
              <div className="space-y-3">
                {/* Remittance ID */}
                <div className="flex items-center justify-between bg-white p-4 rounded-lg border border-green-300">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('remittances.wizard.remittanceIdForTransfer')}</p>
                    <p className="text-xl font-mono font-bold text-gray-900">{createdRemittance.id}</p>
                    <p className="text-xs text-gray-600 mt-1">{t('remittances.wizard.useThisInTransfer')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyToClipboard(createdRemittance.id, 'ID de remesa')}
                    className="p-3 bg-green-100 hover:bg-green-200 rounded-lg transition-colors flex-shrink-0"
                    title="Copiar ID de remesa"
                  >
                    <Copy className="h-5 w-5 text-green-600" />
                  </button>
                </div>

                {/* Amount to Transfer */}
                <div className="flex items-center justify-between bg-white p-4 rounded-lg border border-green-300">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Monto a Transferir</p>
                    <p className="text-2xl font-bold text-green-600">
                      {calculation?.amount} {calculation?.currency || 'USD'}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">Cantidad que debes enviar al número Zelle</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyToClipboard(`${calculation?.amount}`, 'Monto')}
                    className="p-3 bg-green-100 hover:bg-green-200 rounded-lg transition-colors flex-shrink-0"
                    title="Copiar monto"
                  >
                    <Copy className="h-5 w-5 text-green-600" />
                  </button>
                </div>
              </div>
            </div>

            {/* WhatsApp Notification Info Section */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`glass-effect p-6 rounded-xl border-2 ${
                notificationSettings?.whatsapp
                  ? 'border-green-200 bg-green-50'
                  : 'border-yellow-200 bg-yellow-50'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <MessageCircle className={`h-6 w-6 ${
                    notificationSettings?.whatsapp ? 'text-green-600' : 'text-yellow-600'
                  }`} />
                </div>
                <div className="flex-1">
                  <h3 className={`text-lg font-bold mb-2 ${
                    notificationSettings?.whatsapp ? 'text-green-900' : 'text-yellow-900'
                  }`}>
                    📱 {t('remittances.wizard.whatsappNotification') || 'Notificación por WhatsApp'}
                  </h3>

                  {notificationSettings?.whatsapp ? (
                    <>
                      <p className="text-sm text-green-800 mb-4">
                        {t('remittances.wizard.whatsappInfo') || 'Cuando envíes el comprobante de pago, se notificará automáticamente al administrador a través de WhatsApp con todos los detalles de tu remesa.'}
                      </p>
                      <button
                        type="button"
                        onClick={handleNotifyAdminWhatsApp}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
                        title="Notificar al administrador ahora por WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                        {t('remittances.wizard.notifyAdmin') || 'Notificar Administrador Ahora'}
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-yellow-800">
                      ⚠️ Número de WhatsApp del administrador no configurado. Contacta con soporte para activar esta función y recibir notificaciones instantáneas cuando envíes comprobantes de pago.
                    </p>
                  )}
                </div>
              </div>
            </motion.div>

            <form onSubmit={handlePaymentProofSubmit} className="glass-effect p-6 rounded-xl">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Upload className="h-6 w-6 text-blue-600" />
                {t('remittances.wizard.step4Title')}
              </h3>

              <div className="space-y-4">
                {/* File Upload with Preview Component */}
                <FileUploadWithPreview
                  label={t('remittances.user.paymentProof') || 'Comprobante de pago'}
                  accept="image/*,.pdf"
                  value={paymentData.file}
                  preview={imagePreview}
                  previewPosition="above"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    setPaymentData({ ...paymentData, file });

                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        setImagePreview(reader.result);
                      };
                      reader.readAsDataURL(file);
                    } else {
                      setImagePreview(null);
                    }
                  }}
                  required={true}
                />

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

              <div className="mt-6 space-y-3">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                      <p className="font-semibold mb-1">{t('remittances.wizard.importantNote')}:</p>
                      <p>{t('remittances.wizard.proofNote')}</p>
                    </div>
                  </div>
                </div>

                {notificationSettings?.whatsapp && (
                  <div className="p-4 bg-green-50 rounded-lg">
                    <div className="flex items-start gap-3">
                      <MessageCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-green-800">
                        <p className="font-semibold mb-1">📱 Notificación WhatsApp:</p>
                        <p>Cuando envíes el comprobante, se notificará automáticamente al administrador vía WhatsApp con tu número de remesa, monto y detalles del comprobante.</p>
                      </div>
                    </div>
                  </div>
                )}
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
