import React from 'react';
import { Button } from '@/components/ui/button';
import { isStaleChunkError } from '@/lib/lazyWithRetry';
import { reportClientError } from '@/lib/errorHandler';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

// The boundary wraps LanguageProvider, so it cannot use useLanguage(): read the same
// stored preference directly and fall back to Spanish (the app default) if storage throws.
const resolveCopy = () => {
  try {
    return localStorage.getItem('preferredLanguage') === 'en' ? EN.errorBoundary : ES.errorBoundary;
  } catch {
    return ES.errorBoundary;
  }
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    reportClientError(error, 'ErrorBoundary');
  }

  render() {
    if (this.state.hasError) {
      const copy = resolveCopy();
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="glass-effect p-8 rounded-2xl text-center max-w-lg" role="alert">
            <h2 className="text-2xl font-bold mb-4 text-red-600">{copy.title}</h2>
            <p className="text-gray-600 mb-4">
              {isStaleChunkError(this.state.error) ? copy.staleVersion : copy.generic}
            </p>
            <Button variant="brand" onClick={() => window.location.reload()}>
              {copy.reload}
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
