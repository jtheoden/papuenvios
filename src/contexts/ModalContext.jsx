import { createContext, useContext, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, CheckCircle, Info } from 'lucide-react';

const ModalContext = createContext();

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) throw new Error('useModal must be used within ModalProvider');
  return context;
};

export const ModalProvider = ({ children }) => {
  const [modalState, setModalState] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
    input: false,
    inputLabel: '',
    inputPlaceholder: '',
    confirmText: 'Confirmar',
    cancelText: 'Cancelar',
    required: false,
    resolve: null
  });

  const showModal = (config) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        title: config.title || 'Confirmación',
        message: config.message || '',
        type: config.type || 'info',
        input: config.input || false,
        inputLabel: config.inputLabel || '',
        inputPlaceholder: config.inputPlaceholder || '',
        confirmText: config.confirmText || 'Confirmar',
        cancelText: config.cancelText || 'Cancelar',
        required: config.required || false,
        resolve
      });
    });
  };

  const handleConfirm = (value) => {
    if (modalState.resolve) {
      modalState.resolve(modalState.input ? value : true);
    }
    setModalState(prev => ({ ...prev, isOpen: false }));
  };

  const handleCancel = () => {
    if (modalState.resolve) {
      modalState.resolve(false);
    }
    setModalState(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <ModalContext.Provider value={{ showModal }}>
      {children}
      <ModalComponent
        {...modalState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ModalContext.Provider>
  );
};

const ModalComponent = ({
  isOpen,
  title,
  message,
  type,
  input,
  inputLabel,
  inputPlaceholder,
  confirmText,
  cancelText,
  required,
  onConfirm,
  onCancel
}) => {
  const [inputValue, setInputValue] = useState('');

  const icons = {
    danger: AlertTriangle,
    success: CheckCircle,
    info: Info,
    confirm: AlertTriangle,
    warning: AlertTriangle
  };

  const colors = {
    danger: 'text-red-600',
    success: 'text-green-600',
    info: 'text-blue-600',
    confirm: 'text-orange-600',
    warning: 'text-yellow-600'
  };

  const buttonColors = {
    danger: 'bg-red-600 hover:bg-red-700',
    success: 'bg-green-600 hover:bg-green-700',
    info: 'bg-blue-600 hover:bg-blue-700',
    confirm: 'bg-orange-600 hover:bg-orange-700',
    warning: 'bg-yellow-600 hover:bg-yellow-700'
  };

  const iconBgColors = {
    danger: 'bg-red-100',
    success: 'bg-green-100',
    info: 'bg-blue-100',
    confirm: 'bg-orange-100',
    warning: 'bg-yellow-100'
  };

  const Icon = icons[type] || Info;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input && required && !inputValue.trim()) return;
    onConfirm(input ? inputValue : true);
    setInputValue('');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className={`flex-shrink-0 w-12 h-12 rounded-full ${iconBgColors[type] || 'bg-blue-100'} flex items-center justify-center`}>
                  <Icon className={`h-6 w-6 ${colors[type] || 'text-blue-600'}`} />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
                  <p className="text-gray-600">{message}</p>
                </div>
                <button
                  onClick={onCancel}
                  className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit}>
                {input && (
                  <div className="mb-6">
                    {inputLabel && (
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {inputLabel} {required && <span className="text-red-500">*</span>}
                      </label>
                    )}
                    <textarea
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder={inputPlaceholder}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                      rows="3"
                      autoFocus
                    />
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      onCancel();
                      setInputValue('');
                    }}
                    className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                  >
                    {cancelText}
                  </button>
                  <button
                    type="submit"
                    disabled={input && required && !inputValue.trim()}
                    className={`flex-1 px-6 py-3 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonColors[type] || 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {confirmText}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
