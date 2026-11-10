import React, { useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import AuthLoadingScreen from '@/components/AuthLoadingScreen';
import { useBusiness } from '@/contexts/BusinessContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDelayedSplash } from '@/hooks/useDelayedSplash';
import { buildLoadingTheme, readStoredVisualSettings } from '@/lib/loadingTheme';

/**
 * Waits for the visual settings before showing the app. Auth is gated earlier by AuthProvider (its own 6 s cap),
 * so the worst case is sequential: auth cap + VISUAL_SETTINGS_TIMEOUT_MS. Under 300 ms only a themed backdrop
 * (same look as AuthLoadingScreen, never the bare body); after that the loading screen, kept at least 400 ms.
 */
const StartupGate = ({ children }) => {
  const { visualSettingsLoaded } = useBusiness();
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();
  const showSplash = useDelayedSplash(visualSettingsLoaded);
  const theme = useMemo(() => buildLoadingTheme(readStoredVisualSettings()), []);

  let content = children;
  if (showSplash) {
    content = (
      <motion.div key="loading" initial={false} exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.2 } }}>
        <AuthLoadingScreen loadingMessage={t('common.loadingPlatform')} />
      </motion.div>
    );
  } else if (!visualSettingsLoaded) {
    content = (
      // motion.div (not div): AnimatePresence mode="wait" only lets the next child in once this one reports its exit.
      <motion.div key="backdrop" data-testid="startup-backdrop" aria-hidden="true" className="min-h-screen [background:var(--ld-bg)]" style={theme} exit={{ opacity: 1, transition: { duration: 0 } }} />
    );
  }

  return <AnimatePresence mode="wait">{content}</AnimatePresence>;
};

export default StartupGate;
