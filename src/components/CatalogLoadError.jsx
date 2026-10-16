import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Visible failure state for the public catalog. A reload is the right recovery: the usual
 * cause of a permission error is a cached bundle that still requests columns the database
 * no longer exposes, and only a fresh bundle fixes that.
 */
const CatalogLoadError = ({ error }) => {
  const { t } = useLanguage();

  if (!error) return null;

  const message = error.kind === 'permission'
    ? t('products.catalogError.permission')
    : t('products.catalogError.load');

  return (
    <div
      role="alert"
      className="glass-effect mb-8 flex flex-col items-center gap-4 rounded-xl border-2 border-red-200 p-6 text-center"
    >
      <AlertTriangle className="h-8 w-8 text-red-500" aria-hidden="true" />
      <p className="text-gray-700">{message}</p>
      <Button type="button" onClick={() => window.location.reload()}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
        {t('products.catalogError.reload')}
      </Button>
    </div>
  );
};

export default CatalogLoadError;
