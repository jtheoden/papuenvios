import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Camera, RefreshCw, CheckCircle, Trash2 } from 'lucide-react';
import { transitionMessage } from '@/lib/statusConflict';
import { assignDeliveryCourier } from '@/lib/courierService';
import DeliveryCourierSelect from '@/components/admin/DeliveryCourierSelect';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_NOTES = 2000;
const K = 'adminOrders.deliveryModal.';
const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([tabindex="-1"]), [href]';

/**
 * Delivery confirmation dialog for orders and remittances. The delivery photo is OPTIONAL.
 * The dialog owns its own state (photo, preview, validation, errors); the caller only supplies what to show and
 * `onConfirm({ file, notes })`, which must resolve on success (the caller then closes the dialog) or throw.
 * A thrown error with `stage === 'upload'` and a photo attached offers "Retry" / "Confirm without photo";
 * any other error is shown as a message and the primary action stays available.
 *
 * @param {{ label: string, value: string }[]} summary - lines shown at the top (order number, customer, ...)
 * @param {boolean} [notesEnabled] - show the optional notes field (remittances)
 * @param {() => void} onClose
 * @param {(payload: { file: File|null, notes: string }) => Promise<unknown>} onConfirm
 * @param {(key: string) => string} t
 */
const DeliveryProofModal = ({ summary = [], notesEnabled = false, onClose, onConfirm, t, courierKind, courierOperationId }) => {
  const [courierId, setCourierId] = useState('');
  const [assignedId, setAssignedId] = useState(''); // courier already recorded by an earlier attempt of this dialog
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const fileInputRef = useRef(null);
  const returnFocusRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reading, setReading] = useState(false);
  const [notes, setNotes] = useState('');
  const [fileError, setFileError] = useState(null);
  const [submitError, setSubmitError] = useState(null); // { uploadFailed: boolean, message: string }
  const [working, setWorking] = useState(false);
  const [workingText, setWorkingText] = useState('');
  const mounted = useRef(true);
  const titleId = 'delivery-proof-title';
  const helpId = 'delivery-proof-help';
  const inputId = 'delivery-proof-input';

  useEffect(() => {
    mounted.current = true;
    returnFocusRef.current = document.activeElement;
    titleRef.current?.focus();
    return () => {
      mounted.current = false;
      returnFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !working) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, working]);

  // Keep Tab inside the dialog.
  const trapFocus = useCallback((e) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const clearPhoto = () => {
    setFile(null);
    setPreview(null);
    setReading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e) => {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setSubmitError(null);
    if (!chosen.type?.startsWith('image/')) {
      clearPhoto();
      setFileError(t('adminOrders.messages.invalidImage'));
      return;
    }
    if (chosen.size > MAX_PHOTO_BYTES) {
      clearPhoto();
      setFileError(t('adminOrders.messages.imageTooLarge'));
      return;
    }
    setFileError(null);
    setFile(chosen);
    setReading(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      if (!mounted.current) return;
      setPreview(reader.result);
      setReading(false);
    };
    reader.readAsDataURL(chosen);
  };

  const run = async (photo) => {
    setSubmitError(null);
    setWorking(true);
    setWorkingText(t(photo ? `${K}uploading` : `${K}saving`));
    try {
      // The courier must be recorded before the transition: the accrual trigger reads it when the status becomes delivered.
      if (courierKind && courierOperationId && courierId) {
        await assignDeliveryCourier(courierKind, courierOperationId, courierId);
        setAssignedId(courierId);
      }
      await onConfirm({ file: photo, notes: notes.trim() });
    } catch (error) {
      if (!mounted.current) return;
      const uploadFailed = Boolean(photo) && error?.stage === 'upload';
      setSubmitError({
        uploadFailed,
        message: uploadFailed
          ? t(`${K}uploadFailed`)
          : error?.i18nKey ? t(error.i18nKey) : transitionMessage(t, error, error?.message || t(`${K}saveFailed`))
      });
    } finally {
      if (mounted.current) setWorking(false);
    }
  };

  const continueWithoutPhoto = () => {
    clearPhoto();
    run(null);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !working) onClose();
      }}
    >
      <motion.div
        ref={dialogRef}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={helpId}
        aria-busy={working}
        onKeyDown={trapFocus}
      >
        <div className="border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <h3 id={titleId} ref={titleRef} tabIndex={-1} className="text-lg sm:text-xl font-bold text-gray-900 focus:outline-none">
            {t(`${K}title`)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center disabled:opacity-50"
            aria-label={t(`${K}closeLabel`)}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-4">
          {summary.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
              {summary.map(({ label, value }) => (
                <p key={label} className="text-sm text-blue-900">
                  <strong>{t(label)}</strong> {value}
                </p>
              ))}
            </div>
          )}

          <div>
            <label htmlFor={inputId} className="block text-sm font-medium text-gray-800">
              {t(`${K}photoLabel`)}
            </label>
            <p id={helpId} className="text-sm text-gray-600 mt-1 mb-2">
              {t(`${K}photoHelp`)}
            </p>

            <input
              ref={fileInputRef}
              id={inputId}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              onChange={handleFileChange}
              disabled={working}
            />

            {preview ? (
              <div className="flex items-center gap-3 border border-gray-200 rounded-lg p-2">
                <img src={preview} alt={t(`${K}previewAlt`)} className="h-20 w-20 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">{file?.name}</p>
                  <p className="text-xs text-gray-600">{file ? `${(file.size / 1024).toFixed(0)} KB` : ''}</p>
                </div>
                <button
                  type="button"
                  onClick={clearPhoto}
                  disabled={working}
                  className="inline-flex items-center gap-1 px-3 min-h-[44px] text-sm text-red-700 rounded-lg hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                  aria-label={t(`${K}removePhoto`)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t(`${K}removePhoto`)}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={working || reading}
                className="w-full min-h-[96px] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <Camera className="h-6 w-6" aria-hidden="true" />
                <span className="text-sm font-medium">{t(`${K}takeOrChoose`)}</span>
                <span className="text-xs text-gray-600">{t(`${K}fileTypes`)}</span>
              </button>
            )}
            <p className="sr-only" aria-live="polite">{reading ? t(`${K}reading`) : ''}</p>

            {fileError && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {fileError}
              </p>
            )}
          </div>

          {notesEnabled && (
            <div>
              <label htmlFor="delivery-proof-notes" className="block text-sm font-medium text-gray-800 mb-1">
                {t(`${K}notesLabel`)}
              </label>
              <textarea
                id="delivery-proof-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={MAX_NOTES}
                rows={3}
                disabled={working}
                placeholder={t(`${K}notesPlaceholder`)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {courierKind && courierOperationId && (
            <DeliveryCourierSelect value={courierId} onChange={setCourierId} disabled={working} t={t} />
          )}
          {courierKind && courierOperationId && !courierId && assignedId && (
            <p role="status" className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg p-2">{t('couriers.delivery.clearedWarning')}</p>
          )}

          <p className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <strong>{t(`${K}note`)}</strong> {t(`${K}noteText`)}
          </p>

          {submitError && (
            <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
              <p className="text-sm text-red-800">{submitError.message}</p>
              {submitError.uploadFailed && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => run(file)}
                    className="min-h-[44px] px-4 rounded-lg bg-white border border-red-300 text-red-800 text-sm font-medium hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {t(`${K}retry`)}
                  </button>
                  <button
                    type="button"
                    onClick={continueWithoutPhoto}
                    className="min-h-[44px] px-4 rounded-lg bg-white border border-gray-300 text-gray-800 text-sm font-medium hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {t(`${K}continueWithout`)}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-gray-50 border-t border-gray-200 px-4 sm:px-6 py-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 sm:rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="min-h-[44px] px-4 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => run(file)}
            disabled={working || reading}
            className="min-h-[44px] px-6 bg-green-700 text-white rounded-lg hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            aria-live="polite"
          >
            {working ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                {workingText}
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4" aria-hidden="true" />
                {t(`${K}submit`)}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default DeliveryProofModal;
