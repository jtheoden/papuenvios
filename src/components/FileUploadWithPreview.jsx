/**
 * FileUploadWithPreview Component
 * Componente reutilizable para cargar archivos con preview posicionable
 *
 * Props:
 * - label: Texto de la etiqueta (traducido)
 * - accept: Tipos de archivo aceptados (default: "image/*,.pdf")
 * - onChange: Callback cuando cambia el archivo
 * - value: Archivo actual
 * - preview: URL del preview
 * - previewPosition: 'above' | 'right' | 'left' | 'down' (default: 'above')
 * - onPreviewClick: Callback cuando se hace click en el preview
 * - required: Si es obligatorio
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, ZoomIn } from 'lucide-react';

const FileUploadWithPreview = ({
  label,
  accept = 'image/*,.pdf',
  onChange,
  value,
  preview,
  previewPosition = 'above',
  onPreviewClick,
  required = false,
  selectedFileLabel = 'Archivo seleccionado',
  viewFullSizeLabel = 'Ver en Grande',
  previewLabel = 'Vista Previa'
}) => {
  const isImage = value?.type?.startsWith('image/');
  const isPdf = value?.type === 'application/pdf';

  const PreviewContent = () => (
    <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-white">
      {isImage ? (
        <img
          src={preview}
          alt="Preview"
          className="w-full h-auto object-contain max-h-96"
        />
      ) : (
        <div className="flex items-center justify-center h-96 bg-gray-200">
          <div className="text-center">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-600">PDF File</p>
            <p className="text-xs text-gray-500 mt-1">{value?.name}</p>
          </div>
        </div>
      )}
    </div>
  );

  const PreviewButton = () => (
    isImage && onPreviewClick && (
      <button
        type="button"
        onClick={onPreviewClick}
        className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-600 rounded transition-colors"
        title="Ver en grande"
      >
        <ZoomIn className="h-3 w-3" />
        {viewFullSizeLabel}
      </button>
    )
  );

  const PreviewSection = (
    preview && (
      <div className="p-4 border-2 border-blue-300 rounded-lg bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-gray-600">{previewLabel}</p>
          <PreviewButton />
        </div>
        <button
          type="button"
          onClick={onPreviewClick}
          className={`w-full ${
            isImage ? 'cursor-pointer hover:border-blue-400 transition-colors' : ''
          }`}
        >
          <PreviewContent />
        </button>
      </div>
    )
  );

  // Layouts based on previewPosition
  const getLayout = () => {
    switch (previewPosition) {
      case 'right':
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            <div className="md:col-span-2">
              <FileInput />
            </div>
            {preview && (
              <div className="md:col-span-1">
                <div className="p-4 border-2 border-blue-300 rounded-lg bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-gray-600">{previewLabel}</p>
                    <PreviewButton />
                  </div>
                  <button
                    type="button"
                    onClick={onPreviewClick}
                    className={`w-full ${
                      isImage ? 'cursor-pointer hover:border-blue-400 transition-colors' : ''
                    }`}
                  >
                    <PreviewContent />
                  </button>
                </div>
              </div>
            )}
          </div>
        );

      case 'left':
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            {preview && (
              <div className="md:col-span-1">
                <div className="p-4 border-2 border-blue-300 rounded-lg bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-gray-600">{previewLabel}</p>
                    <PreviewButton />
                  </div>
                  <button
                    type="button"
                    onClick={onPreviewClick}
                    className={`w-full ${
                      isImage ? 'cursor-pointer hover:border-blue-400 transition-colors' : ''
                    }`}
                  >
                    <PreviewContent />
                  </button>
                </div>
              </div>
            )}
            <div className="md:col-span-2">
              <FileInput />
            </div>
          </div>
        );

      case 'down':
        return (
          <div className="space-y-4">
            <FileInput />
            {preview && (
              <div className="p-4 border-2 border-blue-300 rounded-lg bg-gray-50">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-gray-600">{previewLabel}</p>
                  <PreviewButton />
                </div>
                <button
                  type="button"
                  onClick={onPreviewClick}
                  className={`w-full ${
                    isImage ? 'cursor-pointer hover:border-blue-400 transition-colors' : ''
                  }`}
                >
                  <PreviewContent />
                </button>
              </div>
            )}
          </div>
        );

      // 'above' is default
      default:
        return (
          <div className="space-y-4">
            {preview && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {PreviewSection}
              </motion.div>
            )}
            <FileInput />
          </div>
        );
    }
  };

  function FileInput() {
    return (
      <div className="space-y-2">
        <input
          type="file"
          accept={accept}
          onChange={onChange}
          className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          required={required}
        />
        {value && (
          <p className="text-xs text-gray-500">
            ✓ {selectedFileLabel}: {value.name}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <AnimatePresence mode="wait">
        {getLayout()}
      </AnimatePresence>
    </div>
  );
};

export default FileUploadWithPreview;
