/**
 * SettingsPageBusiness Component
 * Super Admin only - Controls business open/closed status and global pricing
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store, Power, DollarSign, Clock, Calendar,
  AlertTriangle, Check, X, History, TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import {
  getBusinessStatus,
  setBusinessStatus,
  getGlobalPricing,
  setGlobalPriceMultiplier,
  subscribeToBusinessStatus,
  subscribeToGlobalPricing
} from '@/lib/businessStatusService';

/**
 * Confirmation Modal with animation
 */
const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, variant = 'warning' }) => {
  if (!isOpen) return null;

  const variants = {
    warning: { icon: AlertTriangle, iconColor: 'text-amber-500', btnColor: 'bg-amber-500 hover:bg-amber-600' },
    danger: { icon: AlertTriangle, iconColor: 'text-red-500', btnColor: 'bg-red-500 hover:bg-red-600' },
    success: { icon: Check, iconColor: 'text-green-500', btnColor: 'bg-green-500 hover:bg-green-600' }
  };
  const style = variants[variant] || variants.warning;
  const Icon = style.icon;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex justify-center mb-4">
            <div className={`p-3 rounded-full bg-gray-100`}>
              <Icon className={`w-8 h-8 ${style.iconColor}`} />
            </div>
          </div>
          <h3 className="text-xl font-bold text-center mb-2">{title}</h3>
          <p className="text-gray-600 text-center mb-6">{message}</p>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              className={`flex-1 text-white ${style.btnColor}`}
              onClick={() => { onConfirm(); onClose(); }}
            >
              Confirmar
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const SettingsPageBusiness = () => {
  const { t, language } = useLanguage();
  const { isSuperAdmin } = useAuth();

  // Business status state
  const [businessStatus, setBusinessStatusState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state for business status
  const [isOpen, setIsOpen] = useState(true);
  const [closedMessageEs, setClosedMessageEs] = useState('');
  const [closedMessageEn, setClosedMessageEn] = useState('');
  const [expectedReopenAt, setExpectedReopenAt] = useState('');
  const [autoReopen, setAutoReopen] = useState(true); // Auto-reopen when time is reached

  // Global pricing state
  const [globalPricing, setGlobalPricingState] = useState(null);
  const [priceMultiplier, setPriceMultiplier] = useState(1.0);
  const [appliesToOrders, setAppliesToOrders] = useState(true);
  const [appliesToCombos, setAppliesToCombos] = useState(true);
  const [savingPricing, setSavingPricing] = useState(false);

  // Confirmation modals
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmPricing, setConfirmPricing] = useState(false);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [status, pricing] = await Promise.all([
          getBusinessStatus(),
          getGlobalPricing()
        ]);

        setBusinessStatusState(status);
        setIsOpen(status?.is_open !== false);
        setClosedMessageEs(status?.closed_message_es || '');
        setClosedMessageEn(status?.closed_message_en || '');
        setExpectedReopenAt(status?.expected_reopen_at || '');
        setAutoReopen(status?.auto_reopen !== false);

        setGlobalPricingState(pricing);
        setPriceMultiplier(pricing?.price_multiplier || 1.0);
        setAppliesToOrders(pricing?.applies_to_orders !== false);
        setAppliesToCombos(pricing?.applies_to_combos !== false);
      } catch (error) {
        console.error('Failed to load business settings:', error);
        toast({
          title: 'Error',
          description: language === 'es'
            ? 'Error al cargar configuración del negocio'
            : 'Failed to load business configuration',
          variant: 'destructive'
        });
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Subscribe to realtime changes
    const unsubStatus = subscribeToBusinessStatus(setBusinessStatusState);
    const unsubPricing = subscribeToGlobalPricing(setGlobalPricingState);

    return () => {
      unsubStatus();
      unsubPricing();
    };
  }, [language]);

  // Handle business status toggle
  const handleToggleBusinessStatus = async () => {
    if (isOpen) {
      // Closing - show confirmation
      setConfirmClose(true);
    } else {
      // Opening - no confirmation needed
      await saveBusinessStatus(true);
    }
  };

  const saveBusinessStatus = async (newIsOpen) => {
    setSaving(true);
    try {
      await setBusinessStatus(newIsOpen, {
        messageEs: closedMessageEs,
        messageEn: closedMessageEn,
        expectedReopenAt: expectedReopenAt ? new Date(expectedReopenAt) : null,
        autoReopen: autoReopen && !!expectedReopenAt // Only auto-reopen if time is set
      });

      setIsOpen(newIsOpen);

      // Build description message
      let description;
      if (newIsOpen) {
        description = language === 'es'
          ? 'Los clientes pueden realizar pedidos nuevamente'
          : 'Customers can place orders again';
      } else if (expectedReopenAt && autoReopen) {
        description = language === 'es'
          ? `Reabrirá automáticamente el ${formatDate(expectedReopenAt)}`
          : `Will auto-reopen on ${formatDate(expectedReopenAt)}`;
      } else {
        description = language === 'es'
          ? 'Los clientes verán el mensaje de cierre'
          : 'Customers will see the closed message';
      }

      toast({
        title: newIsOpen
          ? (language === 'es' ? '¡Negocio Abierto!' : 'Business Open!')
          : (language === 'es' ? 'Negocio Cerrado' : 'Business Closed'),
        description
      });
    } catch (error) {
      console.error('Failed to update business status:', error);
      toast({
        title: 'Error',
        description: error.message || (language === 'es'
          ? 'Error al actualizar estado del negocio'
          : 'Failed to update business status'),
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  // Handle global pricing save
  const handleSavePricing = async () => {
    if (priceMultiplier !== (globalPricing?.price_multiplier || 1.0)) {
      setConfirmPricing(true);
    } else {
      await savePricing();
    }
  };

  const savePricing = async () => {
    setSavingPricing(true);
    try {
      await setGlobalPriceMultiplier(priceMultiplier, {
        appliesToOrders,
        appliesToCombos
      });

      toast({
        title: language === 'es' ? 'Precios Actualizados' : 'Pricing Updated',
        description: language === 'es'
          ? `Multiplicador global: ${priceMultiplier}x`
          : `Global multiplier: ${priceMultiplier}x`
      });
    } catch (error) {
      console.error('Failed to update pricing:', error);
      toast({
        title: 'Error',
        description: error.message || (language === 'es'
          ? 'Error al actualizar precios'
          : 'Failed to update pricing'),
        variant: 'destructive'
      });
    } finally {
      setSavingPricing(false);
    }
  };

  // Format date for display
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString(language === 'es' ? 'es-ES' : 'en-US');
    } catch {
      return '-';
    }
  };

  if (!isSuperAdmin) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-red-50 border border-red-200 rounded-xl p-6 text-center"
      >
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-red-700 mb-2">
          {language === 'es' ? 'Acceso Restringido' : 'Restricted Access'}
        </h3>
        <p className="text-red-600">
          {language === 'es'
            ? 'Solo los Super Administradores pueden acceder a esta configuración.'
            : 'Only Super Administrators can access this configuration.'}
        </p>
      </motion.div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Business Status Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden"
      >
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <Store className="w-8 h-8" />
            <div>
              <h2 className="text-2xl font-bold">
                {language === 'es' ? 'Estado del Negocio' : 'Business Status'}
              </h2>
              <p className="text-blue-100 text-sm">
                {language === 'es'
                  ? 'Controla si los clientes pueden realizar pedidos'
                  : 'Control whether customers can place orders'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Current Status */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${isOpen ? 'bg-green-100' : 'bg-red-100'}`}>
                <Power className={`w-6 h-6 ${isOpen ? 'text-green-600' : 'text-red-600'}`} />
              </div>
              <div>
                <p className="font-semibold text-lg">
                  {isOpen
                    ? (language === 'es' ? 'Negocio Abierto' : 'Business Open')
                    : (language === 'es' ? 'Negocio Cerrado' : 'Business Closed')}
                </p>
                <p className="text-sm text-gray-500">
                  {isOpen
                    ? (language === 'es' ? 'Los clientes pueden realizar pedidos' : 'Customers can place orders')
                    : (language === 'es' ? 'Los pedidos están pausados' : 'Orders are paused')}
                </p>
              </div>
            </div>
            <Button
              onClick={handleToggleBusinessStatus}
              disabled={saving}
              className={isOpen
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'}
            >
              {saving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white" />
              ) : isOpen ? (
                <>{language === 'es' ? 'Cerrar Negocio' : 'Close Business'}</>
              ) : (
                <>{language === 'es' ? 'Abrir Negocio' : 'Open Business'}</>
              )}
            </Button>
          </div>

          {/* Closed Messages */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {language === 'es' ? 'Mensaje de cierre (Español)' : 'Closed message (Spanish)'}
              </label>
              <textarea
                value={closedMessageEs}
                onChange={(e) => setClosedMessageEs(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Estamos temporalmente cerrados..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {language === 'es' ? 'Mensaje de cierre (Inglés)' : 'Closed message (English)'}
              </label>
              <textarea
                value={closedMessageEn}
                onChange={(e) => setClosedMessageEn(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="We are temporarily closed..."
              />
            </div>
          </div>

          {/* Expected Reopen */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              {language === 'es' ? 'Reapertura programada (opcional)' : 'Scheduled reopen (optional)'}
            </label>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <input
                type="datetime-local"
                value={expectedReopenAt}
                onChange={(e) => setExpectedReopenAt(e.target.value)}
                className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {expectedReopenAt && (
                <label className="flex items-center gap-2 cursor-pointer bg-green-50 px-4 py-2 rounded-lg border border-green-200">
                  <input
                    type="checkbox"
                    checked={autoReopen}
                    onChange={(e) => setAutoReopen(e.target.checked)}
                    className="w-5 h-5 text-green-600 rounded focus:ring-green-500"
                  />
                  <span className="text-sm text-green-800 font-medium">
                    {language === 'es' ? 'Reabrir automáticamente' : 'Auto-reopen'}
                  </span>
                </label>
              )}
            </div>
            <p className="text-xs text-gray-500">
              {expectedReopenAt && autoReopen
                ? (language === 'es'
                    ? '✓ El negocio reabrirá automáticamente en la fecha/hora indicada'
                    : '✓ Business will automatically reopen at the specified date/time')
                : (language === 'es'
                    ? 'Si no se establece fecha o no activa auto-reabrir, deberá reabrir manualmente'
                    : 'If no date set or auto-reopen disabled, you must reopen manually')}
            </p>
          </div>

          {/* Save Messages Button */}
          {!isOpen && (
            <Button
              onClick={() => saveBusinessStatus(false)}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white mr-2" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              {language === 'es' ? 'Guardar Mensajes' : 'Save Messages'}
            </Button>
          )}

          {/* Last closed info */}
          {businessStatus?.closed_at && (
            <div className="text-sm text-gray-500 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {language === 'es' ? 'Último cierre:' : 'Last closed:'} {formatDate(businessStatus.closed_at)}
            </div>
          )}
        </div>
      </motion.div>

      {/* Global Pricing Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden"
      >
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-8 h-8" />
            <div>
              <h2 className="text-2xl font-bold">
                {language === 'es' ? 'Precios Globales' : 'Global Pricing'}
              </h2>
              <p className="text-emerald-100 text-sm">
                {language === 'es'
                  ? 'Multiplicador que afecta todos los precios de productos en pedidos'
                  : 'Multiplier that affects all product prices in orders'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Current Multiplier */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-emerald-100">
                <DollarSign className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="font-semibold text-lg">
                  {language === 'es' ? 'Multiplicador Actual' : 'Current Multiplier'}
                </p>
                <p className="text-sm text-gray-500">
                  {priceMultiplier === 1.0
                    ? (language === 'es' ? 'Sin ajuste de precios' : 'No price adjustment')
                    : priceMultiplier > 1.0
                      ? (language === 'es'
                          ? `Aumento del ${((priceMultiplier - 1) * 100).toFixed(0)}%`
                          : `${((priceMultiplier - 1) * 100).toFixed(0)}% increase`)
                      : (language === 'es'
                          ? `Descuento del ${((1 - priceMultiplier) * 100).toFixed(0)}%`
                          : `${((1 - priceMultiplier) * 100).toFixed(0)}% discount`)}
                </p>
              </div>
            </div>
            <span className="text-3xl font-bold text-emerald-600">{priceMultiplier}x</span>
          </div>

          {/* Multiplier Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {language === 'es' ? 'Nuevo multiplicador' : 'New multiplier'}
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={priceMultiplier}
                onChange={(e) => setPriceMultiplier(parseFloat(e.target.value) || 1.0)}
                step="0.01"
                min="0.01"
                max="10"
                className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-xl font-semibold text-center"
              />
              <div className="flex gap-2">
                {[0.9, 0.95, 1.0, 1.05, 1.1, 1.2].map(val => (
                  <button
                    key={val}
                    onClick={() => setPriceMultiplier(val)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      priceMultiplier === val
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {val}x
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              {language === 'es'
                ? 'Ejemplo: 1.1 = +10%, 0.9 = -10%, 1.0 = sin cambio'
                : 'Example: 1.1 = +10%, 0.9 = -10%, 1.0 = no change'}
            </p>
          </div>

          {/* Applies To */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={appliesToOrders}
                onChange={(e) => setAppliesToOrders(e.target.checked)}
                className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-700">
                {language === 'es' ? 'Aplicar a Pedidos' : 'Apply to Orders'}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={appliesToCombos}
                onChange={(e) => setAppliesToCombos(e.target.checked)}
                className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-700">
                {language === 'es' ? 'Aplicar a Combos' : 'Apply to Combos'}
              </span>
            </label>
          </div>

          {/* Info Box */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-medium mb-1">
                  {language === 'es' ? 'Nota importante' : 'Important note'}
                </p>
                <p>
                  {language === 'es'
                    ? 'Este multiplicador afecta los precios de productos en pedidos. Las remesas usan sus propias tasas de cambio y no son afectadas.'
                    : 'This multiplier affects product prices in orders. Remittances use their own exchange rates and are not affected.'}
                </p>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <Button
            onClick={handleSavePricing}
            disabled={savingPricing}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {savingPricing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white mr-2" />
            ) : (
              <Check className="w-4 h-4 mr-2" />
            )}
            {language === 'es' ? 'Guardar Precios' : 'Save Pricing'}
          </Button>

          {/* Price History */}
          {globalPricing?.history?.length > 0 && (
            <div>
              <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-2">
                <History className="w-4 h-4" />
                {language === 'es' ? 'Historial de cambios' : 'Change history'}
              </h4>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {globalPricing.history.slice(0, 5).map((entry, idx) => (
                  <div key={idx} className="text-sm text-gray-500 flex items-center gap-2">
                    <span className="font-medium">{entry.multiplier}x</span>
                    <span>-</span>
                    <span>{formatDate(entry.changed_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Confirmation Modals */}
      <ConfirmModal
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={() => saveBusinessStatus(false)}
        title={language === 'es' ? '¿Cerrar el negocio?' : 'Close business?'}
        message={language === 'es'
          ? 'Los clientes verán un mensaje de cierre y no podrán realizar nuevos pedidos hasta que vuelvas a abrir.'
          : 'Customers will see a closed message and won\'t be able to place new orders until you reopen.'}
        variant="warning"
      />

      <ConfirmModal
        isOpen={confirmPricing}
        onClose={() => setConfirmPricing(false)}
        onConfirm={savePricing}
        title={language === 'es' ? '¿Actualizar precios?' : 'Update pricing?'}
        message={language === 'es'
          ? `Todos los precios de productos en pedidos serán multiplicados por ${priceMultiplier}x. Este cambio es inmediato.`
          : `All product prices in orders will be multiplied by ${priceMultiplier}x. This change is immediate.`}
        variant="warning"
      />
    </div>
  );
};

export default SettingsPageBusiness;
