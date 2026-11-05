import React, { useState, useEffect, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildLoadingTheme, readStoredVisualSettings } from '@/lib/loadingTheme';

const AuthLoadingScreen = ({ loadingMessage }) => {
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();
  const defaultMessage = loadingMessage || t('auth.authenticating');
  // Rendered by AuthProvider, outside BusinessProvider: colours come from the settings the app cached.
  const theme = useMemo(() => buildLoadingTheme(readStoredVisualSettings()), []);
  const [displayMessage, setDisplayMessage] = useState(defaultMessage);
  const [dotCount, setDotCount] = useState(0);

  // Animate loading dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount(prev => (prev + 1) % 4);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Update message with animated dots
  useEffect(() => {
    const dots = '.'.repeat(dotCount);
    setDisplayMessage(defaultMessage + dots);
  }, [dotCount, defaultMessage]);

  const messages = [
    t('auth.loadingMessages.connecting'),
    t('auth.loadingMessages.validating'),
    t('auth.loadingMessages.fetching'),
    t('auth.loadingMessages.syncing'),
    t('auth.loadingMessages.finalizing')
  ];

  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-screen flex items-center justify-center px-4 [background:var(--ld-bg)]"
      style={theme}
    >
      {/* Static text for assistive tech: the animated dots and rotating hints below are hidden from it. */}
      <span className="sr-only">{defaultMessage}</span>
      <motion.div
        aria-hidden="true"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          duration: 0.3,
          ease: [0, 0.71, 0.2, 1.01],
          scale: {
            type: "spring",
            damping: 5,
            stiffness: 100,
            restDelta: 0.001
          }
        }}
        className="p-8 rounded-2xl shadow-xl max-w-md bg-[color:var(--ld-card-bg)]"
      >
        <div className="flex flex-col items-center space-y-6">
          {/* Spinner */}
          <div className="w-16 h-16 border-4 border-transparent border-t-[color:var(--ld-accent)] rounded-full animate-spin motion-reduce:animate-none" />

          {/* Main message */}
          <div className="text-center">
            <p className="font-medium text-lg mb-4 text-[color:var(--ld-text)]">
              {displayMessage}
            </p>

            {/* Status messages carousel */}
            <motion.div
              className="min-h-6"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <p className="text-sm text-[color:var(--ld-muted)]">
                {messages[Math.floor(Date.now() / 2000) % messages.length]}
              </p>
            </motion.div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-[color:var(--ld-accent)]"
              initial={{ width: reduceMotion ? '100%' : '0%' }}
              animate={{ width: '100%' }}
              transition={reduceMotion ? { duration: 0 } : {
                duration: 3,
                ease: 'easeInOut',
                repeat: Infinity,
                repeatType: 'reverse'
              }}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default AuthLoadingScreen;
