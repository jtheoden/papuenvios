/**
 * PaymentProofForm Component
 * Unified payment proof upload form with optional reference and notes fields
 * Used in both remittance and order payment flows
 */

import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import FileUploadWithPreview from '@/components/FileUploadWithPreview';

const PaymentProofForm = ({
  // File handling
  file = null,
  preview = null,
  onFileChange,

  // Reference field (required for remittances)
  reference = '',
  onReferenceChange,
  requireReference = false,

  // Notes field (optional)
  notes = '',
  onNotesChange,
  showNotesField = false,

  // Submit handling
  onSubmit,
  submitting = false,
  submitLabel = null,
  disabled = false,

  // Optional: show upload later option
  showUploadLater = false,
  onUploadLater = null,

  // Styling
  className = ''
}) => {
  const { language } = useLanguage();
  const { visualSettings } = useBusiness();

  const t = (key) => {
    const translations = {
      'title': language === 'es' ? 'Subir Comprobante de Pago' : 'Upload Payment Proof',
      'titleRequired': language === 'es' ? 'Subir Comprobante de Pago (Obligatorio)' : 'Upload Payment Proof (Required)',
      'instructions': language === 'es'
        ? 'Una vez realizado el pago, sube el comprobante para que podamos procesar tu solicitud.'
        : 'Once payment is made, upload the proof so we can process your request.',
      'proofLabel': language === 'es' ? 'Comprobante de pago' : 'Payment proof',
      'referenceLabel': language === 'es' ? 'Titular/Empresa que realiza el pago' : 'Payer Name/Company',
      'referencePlaceholder': language === 'es' ? 'Ej: Juan Perez / Empresa ABC LLC' : 'E.g.: John Smith / ABC Corp LLC',
      'notesLabel': language === 'es' ? 'Notas adicionales (opcional)' : 'Additional notes (optional)',
      'notesPlaceholder': language === 'es' ? 'Detalles adicionales...' : 'Additional details...',
      'submitDefault': language === 'es' ? 'Enviar Comprobante' : 'Submit Proof',
      'submitting': language === 'es' ? 'Enviando...' : 'Sending...',
      'uploadLater': language === 'es' ? 'Subir comprobante más tarde' : 'Upload proof later',
      'validationError': language === 'es'
        ? 'Sube el comprobante e indica el titular/empresa que realiza el pago.'
        : 'Upload the proof and provide the payer name/company.'
    };
    return translations[key] || key;
  };

  const getPrimaryButtonStyle = () => {
    const primary = visualSettings?.primaryColor || '#2563eb';
    return {
      backgroundColor: primary,
      color: '#ffffff'
    };
  };

  const isValid = requireReference
    ? (file && reference.trim())
    : !!file;

  const handleSubmit = () => {
    if (!isValid || disabled || submitting) return;
    onSubmit?.();
  };

  return (
    <div className={`glass-effect p-6 rounded-xl border-2 border-orange-200 bg-orange-50 ${className}`}>
      <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-orange-900">
        <Upload className="h-6 w-6" />
        {requireReference ? t('titleRequired') : t('title')}
      </h3>

      {/* Instructions */}
      <div className="p-3 bg-orange-100 rounded-lg mb-4">
        <p className="text-sm text-orange-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          {t('instructions')}
        </p>
      </div>

      <div className="space-y-4">
        {/* File Upload */}
        <FileUploadWithPreview
          label={t('proofLabel')}
          accept="image/*,.pdf"
          value={file}
          preview={preview}
          previewPosition="above"
          onChange={onFileChange}
          required={true}
          selectedFileLabel={language === 'es' ? 'Archivo seleccionado' : 'Selected file'}
          viewFullSizeLabel={language === 'es' ? 'Ver en Grande' : 'View Full Size'}
          previewLabel={language === 'es' ? 'Vista Previa' : 'Preview'}
        />

        {/* Reference Field (conditional) */}
        {requireReference && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('referenceLabel')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => onReferenceChange?.(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder={t('referencePlaceholder')}
              required
            />
          </div>
        )}

        {/* Notes Field (conditional) */}
        {showNotesField && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('notesLabel')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange?.(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows="2"
              placeholder={t('notesPlaceholder')}
            />
          </div>
        )}
      </div>

      {/* Submit Button */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isValid || disabled || submitting}
        className="w-full mt-4 flex items-center justify-center gap-3 px-8 py-4 text-lg font-bold rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
        style={getPrimaryButtonStyle()}
      >
        {submitting ? t('submitting') : (submitLabel || t('submitDefault'))}
        <CheckCircle className="h-6 w-6" />
      </button>

      {/* Upload Later Link (optional) */}
      {showUploadLater && onUploadLater && (
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={onUploadLater}
            className="text-blue-600 hover:text-blue-800 underline text-sm"
          >
            {t('uploadLater')}
          </button>
        </div>
      )}
    </div>
  );
};

export default PaymentProofForm;
