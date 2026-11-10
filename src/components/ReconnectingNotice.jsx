import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

// Shown in place of business data while the session is being renewed: reads made without a valid
// token come back empty (RLS), and empty figures must not be read as "no data".
const ReconnectingNotice = ({ onRetry }) => {
  const { t } = useLanguage();
  return (
    <div
      role="status"
      data-testid="reconnecting-notice"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p>{t('auth.sessionReconnecting')}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium hover:bg-amber-100"
        >
          {t('dashboard.retry')}
        </button>
      )}
    </div>
  );
};

export default ReconnectingNotice;
