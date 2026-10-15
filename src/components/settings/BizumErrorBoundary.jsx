import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

const Fallback = () => {
  const { t } = useLanguage();
  return (
    <p role="status" className="mt-6 text-sm text-gray-700">
      {t('settings.bizum.renderError')}
    </p>
  );
};

/**
 * Local boundary: a render error inside the Bizum section must not unmount Zelle or the rest of
 * Settings. It shows a discreet notice instead.
 */
class BizumErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <Fallback /> : this.props.children;
  }
}

export default BizumErrorBoundary;
