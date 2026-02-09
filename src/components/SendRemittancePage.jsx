import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, ArrowLeft, Check, DollarSign, User, FileText,
  AlertCircle, CheckCircle, Calculator, Copy, Target, RefreshCw, CreditCard, Tag
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useModal } from '@/contexts/ModalContext';
import { useBusiness } from '@/contexts/BusinessContext';
import {
  getActiveRemittanceTypes,
  getRemittanceExchangeRate,
  calculateRemittance,
  calculateReverseRemittance,
  createRemittance,
  uploadPaymentProof
} from '@/lib/remittanceService';
import { getActiveShippingZones } from '@/lib/shippingService';
import { getMunicipalitiesByProvince } from '@/lib/cubanLocations';
import { notifyAdminNewPaymentProof } from '@/lib/whatsappService';
import { getActiveWhatsappRecipient } from '@/lib/notificationSettingsService';
import { validateRemittanceOffer } from '@/lib/orderDiscountService';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';
import RecipientSelector from '@/components/RecipientSelector';
import ZelleAccountSelector from '@/components/ZelleAccountSelector';
import ZelleAccountAlert from '@/components/ZelleAccountAlert';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import ZelleAccountDisplay from '@/components/shared/ZelleAccountDisplay';
import AmountDisplayCard from '@/components/shared/AmountDisplayCard';
import PaymentProofForm from '@/components/shared/PaymentProofForm';

const SendRemittancePage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
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

  // Calculator mode: 'send' = user enters amount to send, 'receive' = user enters desired receive amount
  const [calcMode, setCalcMode] = useState('send');
  const [desiredReceiveAmount, setDesiredReceiveAmount] = useState('');
  const [liveCalc, setLiveCalc] = useState(null);
  const [isCalculatingLive, setIsCalculatingLive] = useState(false);

  const [selectedRecipientData, setSelectedRecipientData] = useState(null);
  const [selectedZelle, setSelectedZelle] = useState(null);
  const [shippingZones, setShippingZones] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [selectedBankAccount, setSelectedBankAccount] = useState(null);
  const [selectedBankAccountDetails, setSelectedBankAccountDetails] = useState(null);

  const [recipientData, setRecipientData] = useState({
    name: '',
    phone: '',
    address: '',
    city: '',
    province: '',
    municipality: '',
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

  // Confirmation modal state
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [confirmedRemittanceInfo, setConfirmedRemittanceInfo] = useState(null);

  // Coupon/offer state
  const [couponCode, setCouponCode] = useState('');
  const [appliedOffer, setAppliedOffer] = useState(null);
  const [couponValidation, setCouponValidation] = useState(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    const currentAmount = parseFloat(amount) || 0;
    if (currentAmount <= 0) {
      setCouponValidation({ valid: false, message: t('remittances.wizard.enterAmountFirst') });
      return;
    }
    setValidatingCoupon(true);
    setCouponValidation(null);
    try {
      const result = await validateRemittanceOffer(couponCode.trim(), currentAmount, user?.id);
      if (result.valid) {
        setAppliedOffer(result.offer);
        setCouponValidation({ valid: true, message: t('remittances.wizard.couponApplied') });
      } else {
        setAppliedOffer(null);
        setCouponValidation({ valid: false, message: result.error || t('remittances.wizard.couponInvalid') });
      }
    } catch (error) {
      setAppliedOffer(null);
      setCouponValidation({ valid: false, message: t('remittances.wizard.couponInvalid') });
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedOffer(null);
    setCouponCode('');
    setCouponValidation(null);
  };

  // Validation: Check if amount is within limits for selected type
  // Limits are always in send currency (USD), so we validate the USD amount state
  const getAmountValidation = () => {
    if (!selectedType) return { isValid: true, error: null };

    // Always validate against 'amount' state (USD to send)
    const amountToValidate = parseFloat(amount) || 0;

    if (amountToValidate <= 0) return { isValid: true, error: null };

    const minAmount = parseFloat(selectedType.min_amount) || 0;
    const maxAmount = selectedType.max_amount ? parseFloat(selectedType.max_amount) : null;

    if (amountToValidate < minAmount) {
      const receiveHint = calcMode === 'receive'
        ? ' ' + t('remittances.wizard.sendingEquivalent', { amount: amountToValidate.toFixed(2) })
        : '';
      return {
        isValid: false,
        error: 'min',
        message: t('remittances.wizard.belowMinAmount', { min: minAmount, currency: selectedType.currency_code }) + receiveHint,
        limit: minAmount
      };
    }

    if (maxAmount && amountToValidate > maxAmount) {
      const receiveHint = calcMode === 'receive'
        ? ' ' + t('remittances.wizard.sendingEquivalent', { amount: amountToValidate.toFixed(2) })
        : '';
      return {
        isValid: false,
        error: 'max',
        message: t('remittances.wizard.aboveMaxAmount', { max: maxAmount, currency: selectedType.currency_code }) + receiveHint,
        limit: maxAmount
      };
    }

    return { isValid: true, error: null };
  };

  // Immediate calculation of complementary field when user types
  // This preserves user input and calculates the other field instantly
  const handleAmountChange = (value) => {
    setAmount(value);
    if (selectedType && value) {
      const numValue = parseFloat(value) || 0;
      if (numValue > 0) {
        const rate = selectedType.currentRate || selectedType.exchange_rate || 1;
        const receiveValue = numValue * rate;
        setDesiredReceiveAmount(receiveValue.toFixed(2));
      }
    }
  };

  const handleDesiredReceiveChange = (value) => {
    setDesiredReceiveAmount(value);
    if (selectedType && value) {
      const numValue = parseFloat(value) || 0;
      if (numValue > 0) {
        const rate = selectedType.currentRate || selectedType.exchange_rate || 1;
        const sendValue = numValue / rate;
        setAmount(sendValue.toFixed(2));
      }
    }
  };

  const amountValidation = getAmountValidation();

  useEffect(() => {
    loadTypes();
    loadShippingZones();
  }, []);

  // Live calculation effect with debounce
  useEffect(() => {
    if (!selectedType) {
      setLiveCalc(null);
      return;
    }

    const inputAmount = calcMode === 'send' ? amount : desiredReceiveAmount;
    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      setLiveCalc(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCalculatingLive(true);
      try {
        if (calcMode === 'send') {
          // Normal calculation: user enters amount to send
          const result = await calculateRemittance(selectedType.id, parseFloat(amount), appliedOffer || null);
          setLiveCalc({
            mode: 'send',
            amountToSend: parseFloat(amount),
            amountToReceive: result.amountToDeliver,
            commission: result.totalCommission,
            originalCommission: result.originalCommission || result.totalCommission,
            discountAmount: result.discountAmount || 0,
            exchangeRate: result.exchangeRate || selectedType.exchange_rate,
            currency: result.currency,
            deliveryCurrency: result.deliveryCurrency
          });
        } else {
          // Reverse calculation: user enters desired receive amount
          const result = await calculateReverseRemittance(selectedType.id, parseFloat(desiredReceiveAmount));
          setLiveCalc({
            mode: 'receive',
            amountToSend: result.amountToSend,
            amountToReceive: parseFloat(desiredReceiveAmount),
            commission: result.totalCommission,
            exchangeRate: result.exchangeRate,
            currency: result.currency,
            deliveryCurrency: result.deliveryCurrency
          });
          // Auto-sync amount for when user proceeds
          setAmount(result.amountToSend.toString());
        }
      } catch (error) {
        console.warn('[LiveCalc] Error:', error.message);
        setLiveCalc(null);
      } finally {
        setIsCalculatingLive(false);
      }
    }, 400); // 400ms debounce

    return () => clearTimeout(timer);
  }, [selectedType, amount, desiredReceiveAmount, calcMode, appliedOffer]);

  // Restore saved state after login (guest → authenticated flow)
  useEffect(() => {
    if (user && types.length > 0) {
      const savedState = localStorage.getItem('pendingRemittance');
      if (savedState) {
        try {
          const { savedAmount, savedTypeId, savedCalcMode, savedDesiredReceive } = JSON.parse(savedState);
          localStorage.removeItem('pendingRemittance');

          const savedType = types.find(t => t.id === savedTypeId);
          if (savedType && savedAmount) {
            // Restore state
            setSelectedType(savedType);
            setAmount(savedAmount);
            setCalcMode(savedCalcMode || 'send');
            setDesiredReceiveAmount(savedDesiredReceive || '');

            // Calculate and go to step 2
            setCalculating(true);
            calculateRemittance(savedType.id, parseFloat(savedAmount))
              .then((calc) => {
                setCalculation(calc);
                setStep(2);
                toast({
                  title: t('remittances.wizard.dataRestored'),
                  description: t('remittances.wizard.dataRestoredDesc')
                });
              })
              .catch((err) => {
                console.warn('[Remittance] Restore calculation error:', err);
              })
              .finally(() => setCalculating(false));
          }
        } catch (e) {
          console.warn('[Remittance] Error restoring state:', e);
          localStorage.removeItem('pendingRemittance');
        }
      }
    }
  }, [user, types, language]);

  useEffect(() => {
    // Check for admin users - they cannot send remittances
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
      const zones = await getActiveShippingZones();
      const availableZones = (zones || []).filter(zone => {
        const cost = parseFloat(zone.shipping_cost || 0);
        return zone.free_shipping === true || cost > 0;
      });
      setShippingZones(availableZones);
    } catch (error) {
      console.error('Error loading shipping zones:', error);
    }
  };

  const loadTypes = async () => {
    setLoading(true);
    try {
      const rawTypes = await getActiveRemittanceTypes();

      // Enrich each type with current exchange rate from exchange_rates table
      const enrichedTypes = await Promise.all(
        (rawTypes || []).map(async (type) => {
          try {
            const { rate, source } = await getRemittanceExchangeRate(
              type.currency_code,
              type.delivery_currency,
              type.exchange_rate
            );
            return {
              ...type,
              currentRate: rate,
              rateSource: source, // 'configured' or 'fallback'
              // Keep original exchange_rate as fallback reference
            };
          } catch (err) {
            console.warn(`[loadTypes] Error getting rate for ${type.name}:`, err);
            return {
              ...type,
              currentRate: type.exchange_rate,
              rateSource: 'fallback'
            };
          }
        })
      );

      setTypes(enrichedTypes);
    } catch (error) {
      console.error('Error loading remittance types:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('common.error'),
        variant: 'destructive'
      });
    }
    setLoading(false);
  };

  const handleSelectType = (type) => {
    const previousType = selectedType;
    setSelectedType(type);

    // Preserve values and recalculate with new rate (Req 4)
    if (previousType && type.id !== previousType.id) {
      const currentAmount = calcMode === 'send' ? parseFloat(amount) : parseFloat(desiredReceiveAmount);

      if (currentAmount > 0) {
        // Recalculate with new type's rate
        if (calcMode === 'send') {
          // User entered send amount - recalculate receive amount with new rate
          const newReceive = currentAmount * type.currentRate;
          setDesiredReceiveAmount(newReceive.toFixed(2));
        } else {
          // User entered receive amount - recalculate send amount with new rate
          const newSend = currentAmount / type.currentRate;
          setAmount(newSend.toFixed(2));
        }
      }
    }

    // Clear calculation to force recalculation on continue
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

    // Check authentication before proceeding to Step 2
    if (!user) {
      // Save current state for restoration after login
      const stateToSave = {
        savedAmount: amount,
        savedTypeId: selectedType.id,
        savedCalcMode: calcMode,
        savedDesiredReceive: desiredReceiveAmount
      };
      localStorage.setItem('pendingRemittance', JSON.stringify(stateToSave));

      // Show modal and redirect to login
      showModal({
        type: 'info',
        title: t('auth.loginRequired'),
        message: t('remittances.wizard.loginRequiredMessage'),
        confirmText: t('auth.goToLogin'),
        cancelText: t('common.cancel')
      }).then((confirmed) => {
        if (confirmed) {
          onNavigate('login');
        }
      });
      return;
    }

    setCalculating(true);
    try {
      const calculation = await calculateRemittance(selectedType.id, parseFloat(amount), appliedOffer || null);
      setCalculation(calculation);
      setStep(2);
    } catch (error) {
      console.error('Error calculating remittance:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('remittances.wizard.errorCalculating'),
        variant: 'destructive'
      });
    } finally {
      setCalculating(false);
    }
  };

  const handleRecipientSubmit = async () => {
    if (!selectedRecipientData) {
      toast({
        title: t('common.error'),
        description: t('remittances.wizard.selectRecipient'),
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
        description: t('zelle.selectAccountRequired'),
        variant: 'destructive'
      });
      return;
    }

    // Validación para remesas off-cash (transfer, card, moneypocket)
    const deliveryMethod = selectedType?.delivery_method || 'cash';
    if (deliveryMethod !== 'cash' && !selectedBankAccount) {
      const deliveryCurrency = selectedType?.delivery_currency || '';
      toast({
        title: t('common.error'),
        description: deliveryCurrency
          ? t('remittances.wizard.selectBankAccountCurrency', { currency: deliveryCurrency })
          : t('remittances.wizard.selectBankAccountRequired'),
        variant: 'destructive'
      });
      return;
    }

    // Show payment proof notification before proceeding to payment step
    await showModal({
      type: 'info',
      title: t('auth.paymentProofRequired'),
      message: t('auth.paymentProofMessage'),
      confirmText: t('common.continue'),
      cancelText: null
    });

    setStep(3);
  };

  const handleConfirmRemittance = async () => {
    setSubmitting(true);

    try {
      const remittanceData = {
        remittance_type_id: selectedType.id,
        amount: parseFloat(amount),
        recipient_name: recipientData.name,
        recipient_phone: recipientData.phone,
        recipient_address: recipientData.address,
        recipient_city: recipientData.city,
        recipient_province: recipientData.province,
        recipient_municipality: recipientData.municipality,
        recipient_id_number: recipientData.id_number,
        notes: recipientData.notes,
        zelle_account_id: selectedZelle?.id,
        recipient_id: selectedRecipientData?.recipientId,
        recipient_address_id: selectedRecipientData?.addressId
      };

      // Si es remesa off-cash, incluir recipient_bank_account_id
      if (selectedType?.delivery_method !== 'cash' && selectedBankAccount) {
        remittanceData.recipient_bank_account_id = selectedBankAccount;
      }

      // Include offer data if coupon applied
      if (appliedOffer) {
        remittanceData.offer_id = appliedOffer.id;
        remittanceData.discount_amount = calculation?.discountAmount || 0;
      }

      const remittance = await createRemittance(remittanceData);
      setCreatedRemittance(remittance);

      toast({
        title: t('common.success'),
        description: t('remittances.wizard.remittanceCreatedSuccess')
      });

      // Todas las remesas (cash y transfer) proceden al Step 4 para subir comprobante de pago
      setStep(4);
    } catch (error) {
      console.error('Error creating remittance:', error);
      toast({
        title: t('common.error'),
        description: error?.message || t('remittances.wizard.errorCreatingRemittance'),
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({
        title: t('common.success'),
        description: t('common.copiedToClipboard', { label }),
        variant: 'default'
      });
    }).catch(() => {
      toast({
        title: t('common.error'),
        description: t('common.copyError'),
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
      {/* Alert for Zelle account deactivation */}
      <ZelleAccountAlert
        operationType="remittance"
        onSelectNewAccount={() => setStep(4)}
      />

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

              {/* Calculator Mode Toggle + Amount Input */}
              <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border-2 border-blue-200">
                {/* Toggle Tabs */}
                <div className="flex mb-4 bg-white rounded-lg p-1 border border-gray-200">
                  <button
                    type="button"
                    onClick={() => {
                      if (calcMode === 'send') return; // Already in send mode

                      // When switching to 'send' mode:
                      // - If user had entered a receive amount, use liveCalc to pre-fill send amount (if available)
                      // - Otherwise, keep existing amount or leave empty
                      if (liveCalc && liveCalc.mode === 'receive' && liveCalc.amountToSend) {
                        setAmount(liveCalc.amountToSend.toFixed(2));
                      }
                      // Do NOT clear the receive amount - preserve it for if user switches back
                      setCalcMode('send');
                      setLiveCalc(null);
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-semibold transition-all ${
                      calcMode === 'send'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <DollarSign className="w-4 h-4" />
                    {t('remittances.wizard.youSendTab')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (calcMode === 'receive') return; // Already in receive mode

                      // When switching to 'receive' mode:
                      // - If user had entered a send amount, use liveCalc to pre-fill receive amount (if available)
                      // - Otherwise, keep existing receive amount or leave empty
                      if (liveCalc && liveCalc.mode === 'send' && liveCalc.amountToReceive) {
                        setDesiredReceiveAmount(liveCalc.amountToReceive.toFixed(2));
                      }
                      // Do NOT clear the send amount - preserve it for if user switches back
                      setCalcMode('receive');
                      setLiveCalc(null);
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-semibold transition-all ${
                      calcMode === 'receive'
                        ? 'bg-green-600 text-white shadow-md'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <Target className="w-4 h-4" />
                    {t('remittances.wizard.theyReceiveTab')}
                  </button>
                </div>
 {/* Type Selection - Dropdown (Req 2) */}
              <div className="space-y-3 p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('remittances.wizard.selectTypeRequired')}
                </label>
                <select
                  value={selectedType?.id || ''}
                  onChange={(e) => {
                    const type = types.find(t => t.id === e.target.value);
                    if (type) handleSelectType(type);
                  }}
                  className="w-full p-3 border-2 border-gray-200 rounded-lg bg-white text-gray-900 font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                >
                  <option value="">{t('remittances.wizard.selectType')}</option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name} 
                    </option>
                  ))}
                </select>

                {/* Selected type details card */}
               {/*  {selectedType && (
                  <div className="p-4 rounded-xl border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-purple-50">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-lg text-blue-900">{selectedType.name}</h3>
                          {selectedType.rateSource === 'configured' && (
                            <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">✓ {language === 'es' ? 'Tasa actualizada' : 'Updated rate'}</span>
                          )}
                        </div>
                        {selectedType.description && (
                          <p className="text-sm mt-1 text-blue-700">{selectedType.description}</p>
                        )}
                        <div className="mt-2 text-sm">
                          <span className="text-blue-700">{t('remittances.wizard.rate')}: </span>
                          <span className="font-semibold text-blue-900">
                            1 {selectedType.currency_code} = {selectedType.currentRate || selectedType.exchange_rate} {selectedType.delivery_currency}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-blue-600">{t('remittances.wizard.limits')}</p>
                        <p className="text-sm font-semibold text-blue-900">
                          {selectedType.min_amount} - {selectedType.max_amount || '∞'} {selectedType.currency_code}
                        </p>
                      </div>
                    </div>
                  </div>
                )} */}
              </div>
                {/* Amount Input - Changes based on mode */}
                <label className={`block text-sm font-semibold mb-2 transition-colors ${
                  !amountValidation.isValid
                    ? 'text-red-600'
                    : 'text-gray-700'
                }`}>
                  {calcMode === 'send'
                    ? `${t('remittances.wizard.amountToSend')} (USD) *`
                    : `${t('remittances.wizard.amountToReceive')} (${selectedType?.delivery_currency || 'CUP'}) *`
                  }
                </label>
                <div className="relative">
                  {calcMode === 'send' ? (
                    <DollarSign className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 ${
                      !selectedType ? 'text-gray-400' : !amountValidation.isValid ? 'text-red-500' : 'text-blue-600'
                    }`} />
                  ) : (
                    <Target className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 ${
                      !selectedType ? 'text-gray-400' : !amountValidation.isValid ? 'text-red-500' : 'text-green-600'
                    }`} />
                  )}
                  <input
                    type="number"
                    step="0.01"
                    value={calcMode === 'send' ? amount : desiredReceiveAmount}
                    onChange={(e) => {
                      if (calcMode === 'send') {
                        handleAmountChange(e.target.value);
                      } else {
                        handleDesiredReceiveChange(e.target.value);
                      }
                    }}
                    disabled={!selectedType}
                    className={`w-full pl-10 pr-4 py-3 rounded-lg border-2 focus:ring-2 text-lg font-semibold transition-colors ${
                      !selectedType
                        ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                        : !amountValidation.isValid
                          ? 'border-red-400 focus:ring-red-500 focus:border-red-500 bg-red-50'
                          : calcMode === 'send'
                            ? 'border-blue-300 focus:ring-blue-500 focus:border-blue-500'
                            : 'border-green-300 focus:ring-green-500 focus:border-green-500'
                    }`}
                    placeholder={!selectedType
                      ? t('remittances.wizard.selectTypeFirst')
                      : (calcMode === 'send' ? t('remittances.wizard.placeholderSend') : t('remittances.wizard.placeholderReceive'))
                    }
                  />
                </div>

                {/* Validation Error Message */}
                {!amountValidation.isValid && (
                  <p className="text-sm text-red-600 font-medium mt-2 flex items-center gap-1">
                    <AlertCircle className="h-4 w-4" />
                    {amountValidation.message}
                  </p>
                )}

                {/* Live Calculation Preview */}
                {(isCalculatingLive || liveCalc) && selectedType && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`mt-4 p-4 rounded-xl border-2 ${
                      calcMode === 'send'
                        ? 'bg-green-50 border-green-200'
                        : 'bg-blue-50 border-blue-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Calculator className="w-4 h-4 text-gray-600" />
                      <span className="text-sm font-semibold text-gray-700">
                        {t('remittances.wizard.liveCalculation')}
                      </span>
                      {isCalculatingLive && (
                        <RefreshCw className="w-4 h-4 text-gray-400 animate-spin ml-auto" />
                      )}
                    </div>

                    {liveCalc && !isCalculatingLive && (
                      <div className="space-y-2">
                        {/* Exchange Rate */}
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">{t('remittances.wizard.exchangeRateLabel')}:</span>
                          <span className="font-medium">1 {liveCalc.currency} = {liveCalc.exchangeRate} {liveCalc.deliveryCurrency}</span>
                        </div>

                        {/* Commission */}
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">{t('remittances.wizard.commission')}:</span>
                          <span className="font-medium text-red-600">
                            -{(liveCalc.discountAmount > 0 ? liveCalc.originalCommission : liveCalc.commission).toFixed(2)} {liveCalc.currency}
                          </span>
                        </div>

                        {/* Coupon discount line */}
                        {liveCalc.discountAmount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-green-600 flex items-center gap-1">
                              <Tag className="w-3 h-3" />
                              {t('remittances.wizard.couponDiscount')}:
                            </span>
                            <span className="font-medium text-green-600">+{liveCalc.discountAmount.toFixed(2)} {liveCalc.currency}</span>
                          </div>
                        )}

                        <div className="border-t border-gray-200 pt-2 mt-2">
                          {calcMode === 'send' ? (
                            /* Show what they will receive */
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-semibold text-gray-700">
                                {t('remittances.wizard.theyWillReceive')}:
                              </span>
                              <span className="text-xl font-bold text-green-600">
                                {liveCalc.amountToReceive.toFixed(2)} {liveCalc.deliveryCurrency}
                              </span>
                            </div>
                          ) : (
                            /* Show what user must send */
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-semibold text-gray-700">
                                {t('remittances.wizard.youMustSend')}:
                              </span>
                              <span className="text-xl font-bold text-blue-600">
                                ${liveCalc.amountToSend.toFixed(2)} {liveCalc.currency}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {isCalculatingLive && !liveCalc && (
                      <div className="text-sm text-gray-500 text-center py-2">
                        {t('remittances.wizard.calculating')}
                      </div>
                    )}
                  </motion.div>
                )}

                {/* Coupon/Offer Section */}
                {selectedType && amount && parseFloat(amount) > 0 && (
                  <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50">
                    <div className="flex items-center gap-2 mb-2">
                      <Tag className="w-4 h-4 text-gray-500" />
                      <span className="text-sm font-semibold text-gray-700">{t('remittances.wizard.couponLabel')}</span>
                    </div>
                    {appliedOffer ? (
                      <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-medium text-green-700">
                            {t('remittances.wizard.couponApplied')}: {appliedOffer.discount_type === 'percentage'
                              ? `${appliedOffer.discount_value}%`
                              : `$${appliedOffer.discount_value}`
                            } {t('remittances.wizard.offCommission')}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleRemoveCoupon}
                          className="text-xs text-red-500 hover:text-red-700 font-medium"
                        >
                          {t('common.remove')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                          placeholder={t('remittances.wizard.couponPlaceholder')}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          onKeyDown={(e) => e.key === 'Enter' && handleApplyCoupon()}
                        />
                        <button
                          type="button"
                          onClick={handleApplyCoupon}
                          disabled={!couponCode.trim() || validatingCoupon}
                          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {validatingCoupon ? '...' : t('remittances.wizard.applyCoupon')}
                        </button>
                      </div>
                    )}
                    {couponValidation && !couponValidation.valid && (
                      <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {couponValidation.message}
                      </p>
                    )}
                  </div>
                )}

                {selectedType && (
                  <p className="text-xs text-gray-600 mt-3">
                    {t('remittances.wizard.minAmount')}: {selectedType.min_amount} {selectedType.currency_code}
                    {selectedType.max_amount && ` • ${t('remittances.wizard.maxAmount')}: ${selectedType.max_amount} ${selectedType.currency_code}`}
                  </p>
                )}
              </div>

             
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={handleCalculate}
                disabled={!selectedType || !amount || calculating || !amountValidation.isValid}
                className={`${getPrimaryButtonStyle()} flex items-center gap-3 px-8 py-4 text-lg font-bold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none ${!calculating && selectedType && amount && amountValidation.isValid ? 'animate-pulse ring-2 ring-blue-300 ring-offset-2' : ''}`}
              >
                {calculating ? t('remittances.wizard.calculating') : t('remittances.wizard.continue')}
                <ArrowRight className="h-6 w-6" />
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
                {calculation.discountAmount > 0 && (
                  <div className="col-span-2">
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <Tag className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-green-700 font-medium">
                        {t('remittances.wizard.couponDiscount')}: +{calculation.discountAmount.toFixed(2)} {calculation.currency}
                      </span>
                    </div>
                  </div>
                )}
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
                usageType="remittances"
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

                  // Guardar recipient_bank_account_id y detalles si es una remesa off-cash
                  if (recipientData.recipient_bank_account_id) {
                    setSelectedBankAccount(recipientData.recipient_bank_account_id);
                    setSelectedBankAccountDetails(recipientData.bank_account_details || null);
                  }

                  if (recipientData.recipientData) {
                    // Existing recipient selected
                    const primaryAddress = recipientData.recipientData.addresses?.[0];
                    setRecipientData({
                      name: recipientData.recipientData.full_name || '',
                      phone: recipientData.recipientData.phone || '',
                      address: primaryAddress?.address_line_1 || '',
                      city: primaryAddress?.municipality || '',
                      province: primaryAddress?.province || '',
                      municipality: primaryAddress?.municipality || '',
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
                      province: recipientData.formData.province || '',
                      municipality: recipientData.formData.municipality || '',
                      id_number: '',
                      notes: ''
                    });
                  }
                }}
                shippingZones={shippingZones}
                municipalities={municipalities}
                showAddressSelection={selectedType?.delivery_method === 'cash'}
                showProvinceInForm={selectedType?.delivery_method === 'cash'}
                deliveryMethod={selectedType?.delivery_method || 'cash'}
                selectedRecipientData={selectedRecipientData}
                selectedRemittanceType={selectedType}
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
                className={`${getPrimaryButtonStyle()} flex items-center gap-3 px-8 py-4 text-lg font-bold shadow-lg hover:shadow-xl transition-all duration-200`}
              >
                {t('remittances.wizard.continue')}
                <ArrowRight className="h-6 w-6" />
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

                {/* Bank Account Info (for off-cash remittances) */}
                {selectedType?.delivery_method !== 'cash' && selectedBankAccountDetails && (
                  <div className="pt-4 border-t">
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                      <CreditCard className="h-5 w-5 text-blue-600" />
                      {t('remittances.wizard.destinationBankAccount')}
                    </h3>
                    <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          {t('remittances.wizard.bankLabel')}:
                        </span>
                        <span className="text-sm text-gray-900 font-semibold">
                          {selectedBankAccountDetails.bank?.name}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          {t('remittances.wizard.accountTypeLabel')}:
                        </span>
                        <span className="text-sm text-gray-900">
                          {selectedBankAccountDetails.account_type?.name}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          {t('remittances.wizard.currencyLabel')}:
                        </span>
                        <span className="text-sm text-gray-900 font-semibold">
                          {selectedBankAccountDetails.currency?.code}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          {t('remittances.wizard.last4Digits')}:
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-lg text-gray-900 font-mono font-bold bg-white px-3 py-1 rounded border-2 border-blue-300">
                            ****{selectedBankAccountDetails.account_number_last4}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          {t('remittances.wizard.holderLabel')}:
                        </span>
                        <span className="text-sm text-gray-900">
                          {selectedBankAccountDetails.account_holder_name}
                        </span>
                      </div>
                      <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded">
                        <p className="text-xs text-yellow-800 flex items-start gap-1">
                          <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          {t('remittances.wizard.verifyDataWarning')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
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
                className={`${getPrimaryButtonStyle()} flex items-center gap-3 px-8 py-4 text-lg font-bold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:shadow-none`}
              >
                {submitting ? t('remittances.wizard.creating') : t('remittances.wizard.confirmAndCreate')}
                <CheckCircle className="h-6 w-6" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 4: Payment - Copy info, make payment, upload proof */}
        {step === 4 && createdRemittance && (
          <motion.div
            key="step4"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            {/* Success Header */}
            <div className="glass-effect p-6 rounded-xl text-center border-2 border-green-200 bg-green-50">
              <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-3" />
              <h2 className="text-xl font-bold mb-2 text-green-900">
                {t('remittances.wizard.remittanceCreatedTitle')}
              </h2>
              <p className="text-gray-600">
                {t('remittances.wizard.paymentInstructions')}
              </p>
            </div>

           
            {/* Datos Zelle para el pago - Using shared component */}
            {selectedZelle && (
              <ZelleAccountDisplay
                account={selectedZelle}
                showCopyButtons={true}
                onCopy={(label, value) => {
                  toast({
                    title: t('common.copied'),
                    description: `${label}: ${value}`
                  });
                }}
              />
            )}

            {/* Monto a Transferir - Using shared component */}
            <AmountDisplayCard
              amount={calculation?.amount}
              currency={calculation?.currency || 'USD'}
              deliveryAmount={calculation?.amountToDeliver}
              deliveryCurrency={calculation?.deliveryCurrency}
              showCopyButton={true}
              onCopy={(value) => {
                toast({
                  title: t('common.copied'),
                  description: `${t('common.amount')}: $${value}`
                });
              }}
            />

            {/* Upload comprobante de pago - Using shared component */}
            <PaymentProofForm
              file={paymentData.file}
              preview={imagePreview}
              reference={paymentData.reference}
              notes={paymentData.notes}
              requireReference={true}
              showNotesField={true}
              onFileChange={(e) => {
                const file = e.target.files[0];
                setPaymentData({ ...paymentData, file });
                if (file) {
                  const reader = new FileReader();
                  reader.onloadend = () => setImagePreview(reader.result);
                  reader.readAsDataURL(file);
                } else {
                  setImagePreview(null);
                }
              }}
              onReferenceChange={(value) => setPaymentData({ ...paymentData, reference: value })}
              onNotesChange={(value) => setPaymentData({ ...paymentData, notes: value })}
              onSubmit={async () => {
                setSubmitting(true);
                try {
                  await uploadPaymentProof(createdRemittance.id, paymentData.file, paymentData.reference, paymentData.notes);

                  const notificationWhatsapp = getActiveWhatsappRecipient(notificationSettings);
                  if (notificationWhatsapp) {
                    try {
                      const enrichedRemittance = {
                        ...createdRemittance,
                        remittance_types: selectedType,
                        amount: parseFloat(amount),
                        currency: calculation?.currency || 'USD',
                        amount_to_deliver: calculation?.amountToDeliver,
                        delivery_currency: calculation?.deliveryCurrency,
                        payment_reference: paymentData.reference,
                        user_email: user?.email,
                        user_name: user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0]
                      };
                      await notifyAdminNewPaymentProof(enrichedRemittance, notificationWhatsapp, language);
                    } catch (e) { console.warn('WhatsApp notification failed', e); }
                  }

                  toast({ title: t('common.success'), description: t('remittances.wizard.proofSubmittedSuccess') });

                  setConfirmedRemittanceInfo({
                    remittanceNumber: createdRemittance.remittance_number,
                    total: calculation?.amountToDeliver || parseFloat(amount),
                    currency: calculation?.deliveryCurrency || 'CUP',
                    recipientName: recipientData.name
                  });
                  setShowConfirmationModal(true);
                } catch (error) {
                  console.error('Error uploading proof:', error);
                  toast({ title: t('common.error'), description: error?.message || t('remittances.wizard.errorUploadingProof'), variant: 'destructive' });
                } finally {
                  setSubmitting(false);
                }
              }}
              submitting={submitting}
              submitLabel={t('remittances.wizard.submitProofAndComplete')}
              showUploadLater={true}
              onUploadLater={() => onNavigate('my-remittances')}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        onClose={() => {
          setShowConfirmationModal(false);
          onNavigate('my-remittances');
        }}
        onViewOrders={() => {
          setShowConfirmationModal(false);
          onNavigate('my-remittances');
        }}
        orderNumber={confirmedRemittanceInfo?.remittanceNumber}
        orderType="remittance"
        total={confirmedRemittanceInfo?.total}
        currency={confirmedRemittanceInfo?.currency}
        recipientName={confirmedRemittanceInfo?.recipientName}
        estimatedDelivery={t('remittances.wizard.estimatedDeliveryTime')}
      />
    </div>
  );
};

export default SendRemittancePage;
