/**
 * Settings System Tab — reset a estado inicial funcional (Frente 2 del plan
 * admin-bulk-ops-reset-audit). Solo visible/renderizado para super_admin.
 * El botón permanece deshabilitado a menos que platform_reset_control.enabled
 * haya sido activado directamente en la base de datos — nunca desde acá.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RotateCcw, Loader, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { getPlatformResetStatus, executePlatformReset } from '@/lib/platformResetService';

const CONFIRMATION_WORD = 'RESETEAR';

const SettingsSystemTab = () => {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState({ enabled: false, loading: true });
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [result, setResult] = useState(null);

  const loadStatus = async () => {
    const s = await getPlatformResetStatus();
    setStatus({ ...s, loading: false });
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleReset = async () => {
    setIsResetting(true);
    try {
      const counts = await executePlatformReset(confirmText);
      setResult(counts);
      toast({
        title: language === 'es' ? 'Reset ejecutado' : 'Reset executed',
        description: language === 'es' ? 'La plataforma fue reseteada al estado inicial.' : 'The platform was reset to its initial state.'
      });
      await loadStatus();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error?.message || (language === 'es' ? 'No se pudo ejecutar el reset.' : 'Could not execute the reset.'),
        variant: 'destructive'
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-effect p-8 rounded-2xl space-y-6">
      <div className="flex items-center gap-2 text-red-700">
        <ShieldAlert className="h-6 w-6" />
        <h2 className="text-xl font-semibold">
          {language === 'es' ? 'Reset de plataforma (solo periodo de pruebas)' : 'Platform reset (test period only)'}
        </h2>
      </div>

      <p className="text-sm text-gray-600">
        {language === 'es'
          ? 'Elimina toda la data generada durante el periodo de pruebas (órdenes, remesas, carritos, ofertas, combos, inventario, estadísticas) y deshabilita los usuarios no-superadmin. Los catálogos (productos, categorías, configuración) no se tocan. Esta acción no se puede deshacer.'
          : 'Deletes all data generated during the test period (orders, remittances, carts, offers, combos, inventory, stats) and disables non-superadmin users. Catalogs (products, categories, configuration) are untouched. This action cannot be undone.'}
      </p>

      {status.loading ? (
        <Loader className="h-5 w-5 animate-spin text-gray-400" />
      ) : status.enabled ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          {language === 'es'
            ? 'El flag está ACTIVADO en la base de datos. El botón de reset está disponible.'
            : 'The flag is ENABLED in the database. The reset button is available.'}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          {language === 'es'
            ? 'Requiere activación desde la base de datos (platform_reset_control.enabled = true, vía SQL directo — nunca desde esta pantalla).'
            : 'Requires activation from the database (platform_reset_control.enabled = true, via direct SQL — never from this screen).'}
        </div>
      )}

      <Button
        variant="destructive"
        disabled={!status.enabled || status.loading}
        onClick={() => setShowConfirm(true)}
      >
        <RotateCcw className="h-4 w-4 mr-2" />
        {language === 'es' ? 'Resetear plataforma' : 'Reset platform'}
      </Button>

      {showConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => { setShowConfirm(false); setConfirmText(''); setResult(null); }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-red-600 mb-3">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="text-lg font-semibold">{language === 'es' ? 'Confirmar reset' : 'Confirm reset'}</h3>
            </div>

            {!result ? (
              <>
                <p className="text-sm text-gray-700 mb-4">
                  {language === 'es'
                    ? `Escribí "${CONFIRMATION_WORD}" para confirmar. Esta acción es irreversible.`
                    : `Type "${CONFIRMATION_WORD}" to confirm. This action is irreversible.`}
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm mb-4 border-gray-300"
                  placeholder={CONFIRMATION_WORD}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { setShowConfirm(false); setConfirmText(''); }} disabled={isResetting}>
                    {language === 'es' ? 'Cancelar' : 'Cancel'}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleReset}
                    disabled={confirmText !== CONFIRMATION_WORD || isResetting}
                  >
                    {isResetting ? '...' : (language === 'es' ? 'Resetear definitivamente' : 'Reset permanently')}
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-green-700 font-medium">
                  {language === 'es' ? 'Reset completado.' : 'Reset completed.'}
                </p>
                <div className="text-xs text-gray-600 max-h-48 overflow-y-auto space-y-1">
                  {Object.entries(result).map(([table, count]) => (
                    <div key={table} className="flex justify-between border-b border-gray-100 py-1">
                      <span>{table}</span>
                      <span className="font-mono">{count}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end pt-2">
                  <Button variant="outline" onClick={() => { setShowConfirm(false); setConfirmText(''); setResult(null); }}>
                    {language === 'es' ? 'Cerrar' : 'Close'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

export default SettingsSystemTab;
