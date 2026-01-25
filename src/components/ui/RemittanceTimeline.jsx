/**
 * RemittanceTimeline Component
 * Visual timeline showing the progression of a remittance through its states
 * Displays: Pending → Proof Uploaded → Validated → Processing → Delivered → Completed
 */

import { motion } from 'framer-motion';
import {
  Clock, Upload, CheckCircle, Loader, Truck, Package,
  XCircle, AlertCircle
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';

// Define the standard remittance flow steps - MUST match database status values
const REMITTANCE_STEPS = [
  { id: 'payment_pending', icon: Clock, statusMatch: ['payment_pending'] },
  { id: 'payment_proof_uploaded', icon: Upload, statusMatch: ['payment_proof_uploaded'] },
  { id: 'payment_validated', icon: CheckCircle, statusMatch: ['payment_validated'] },
  { id: 'processing', icon: Loader, statusMatch: ['processing'] },
  { id: 'delivered', icon: Truck, statusMatch: ['delivered'] },
  { id: 'completed', icon: CheckCircle, statusMatch: ['completed'] }
];

const RemittanceTimeline = ({
  currentStatus,
  rejectionReason = null,
  statusHistory = [],
  compact = false
}) => {
  const { language, t } = useLanguage();
  const { visualSettings } = useBusiness();

  // Labels using translation dictionaries - keys MUST match database status values
  const labels = {
    payment_pending: t('remittances.status.paymentPending'),
    payment_proof_uploaded: t('remittances.status.paymentProofUploaded'),
    payment_validated: t('remittances.status.paymentValidated'),
    processing: t('remittances.status.processing'),
    delivered: t('remittances.status.delivered'),
    completed: t('remittances.status.completed'),
    payment_rejected: t('remittances.status.paymentRejected')
  };

  // Check if a step is completed based on current status
  const getStepState = (step) => {
    if (currentStatus === 'payment_rejected') {
      // If rejected, show all steps as inactive except a special rejection indicator
      return 'inactive';
    }

    const currentIndex = REMITTANCE_STEPS.findIndex(s =>
      s.statusMatch.includes(currentStatus)
    );
    const stepIndex = REMITTANCE_STEPS.findIndex(s => s.id === step.id);

    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'current';
    return 'pending'; // Changed from 'inactive' to 'pending' for future states
  };

  // Get timestamp for a step from history
  const getStepTimestamp = (stepId) => {
    if (!statusHistory || statusHistory.length === 0) return null;

    const historyEntry = statusHistory.find(h =>
      REMITTANCE_STEPS.find(s => s.id === stepId)?.statusMatch.includes(h.status)
    );

    return historyEntry?.timestamp || historyEntry?.created_at;
  };

  // Format timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return null;

    try {
      const date = new Date(timestamp);
      return date.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return null;
    }
  };

  const primaryColor = visualSettings?.primaryColor || '#2563eb';
  const successColor = visualSettings?.successColor || '#10b981';

  // If rejected, show rejection state
  if (currentStatus === 'payment_rejected') {
    return (
      <div className="py-4">
        <div className="flex items-center justify-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <XCircle className="h-8 w-8 text-red-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-red-700">{labels.payment_rejected}</p>
            {rejectionReason && (
              <p className="text-sm text-red-600 mt-1">{rejectionReason}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Compact horizontal timeline
  if (compact) {
    return (
      <div className="py-2">
        <div className="flex items-center justify-between">
          {REMITTANCE_STEPS.map((step, index) => {
            const state = getStepState(step);
            const StepIcon = step.icon;

            return (
              <div key={step.id} className="flex items-center">
                <motion.div
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className={`flex items-center justify-center w-8 h-8 rounded-full transition-all ${
                    state === 'completed'
                      ? 'bg-green-500 text-white'  // Past states: green
                      : state === 'current'
                        ? 'bg-blue-600 text-white ring-4 ring-blue-200 shadow-lg'  // Current state: blue with ring and shadow
                        : 'bg-gray-100 text-gray-300 border border-gray-200'  // Future states: light gray, no color
                  }`}
                >
                  <StepIcon className="h-4 w-4" />
                </motion.div>
                {index < REMITTANCE_STEPS.length - 1 && (
                  <div
                    className={`h-0.5 w-6 mx-1 transition-all ${
                      state === 'completed' ? 'bg-green-500' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Full vertical timeline
  return (
    <div className="py-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
        <Clock className="h-4 w-4" />
        {language === 'es' ? 'Progreso de la Remesa' : 'Remittance Progress'}
      </h4>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

        <div className="space-y-4">
          {REMITTANCE_STEPS.map((step, index) => {
            const state = getStepState(step);
            const StepIcon = step.icon;
            const timestamp = getStepTimestamp(step.id);
            const formattedTime = formatTimestamp(timestamp);

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="relative flex items-start gap-4 pl-0"
              >
                {/* Step indicator */}
                <div
                  className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full transition-all flex-shrink-0 ${
                    state === 'completed'
                      ? 'bg-green-500 text-white'  // Past states: solid green
                      : state === 'current'
                        ? 'text-white ring-4 ring-blue-200 shadow-lg'  // Current state: with ring and shadow
                        : 'bg-gray-100 text-gray-300 border border-gray-200'  // Future states: light gray, no color
                  }`}
                  style={state === 'current' ? {
                    backgroundColor: primaryColor
                  } : {}}
                >
                  {state === 'current' ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    >
                      <Loader className="h-4 w-4" />
                    </motion.div>
                  ) : state === 'completed' ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <StepIcon className="h-4 w-4" />
                  )}
                </div>

                {/* Step content */}
                <div className={`flex-1 pb-4 ${index === REMITTANCE_STEPS.length - 1 ? 'pb-0' : ''}`}>
                  <p className={`font-medium text-sm ${
                    state === 'completed'
                      ? 'text-green-700'  // Past states: green text
                      : state === 'current'
                        ? 'text-blue-700 font-semibold'  // Current state: blue, bold
                        : 'text-gray-400'  // Future states: light gray
                  }`}>
                    {labels[step.id]}
                  </p>
                  {formattedTime && state !== 'pending' && (
                    <p className="text-xs text-gray-500 mt-0.5">{formattedTime}</p>
                  )}
                  {state === 'current' && (
                    <p className="text-xs mt-1 font-medium" style={{ color: primaryColor }}>
                      {language === 'es' ? '← Estado actual' : '← Current status'}
                    </p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default RemittanceTimeline;
