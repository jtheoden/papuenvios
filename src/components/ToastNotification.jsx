import { X } from 'lucide-react';

const typeStyles = {
  success: 'bg-green-50 text-green-800 border-green-200',
  error: 'bg-red-50 text-red-800 border-red-200',
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  warning: 'bg-yellow-50 text-yellow-800 border-yellow-200'
};

const ToastNotification = ({ message, type = 'info', onClose }) => {
  const style = typeStyles[type] || typeStyles.info;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg ${style}`}>
        <div className="text-sm leading-5">{message}</div>
        {onClose && (
          <button
            type="button"
            aria-label="Close notification"
            onClick={onClose}
            className="text-current hover:opacity-70"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ToastNotification;
