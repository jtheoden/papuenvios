import React from 'react';
import { motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { ShoppingBag, DollarSign, Globe } from 'lucide-react';
import { useBusiness } from '@/contexts/BusinessContext';
import { useLanguage } from '@/contexts/LanguageContext';

const LoadingScreen = () => {
  const { visualSettings } = useBusiness();
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();
  // Reduced motion: no entry/exit fade; MotionConfig also stops the looping transform animations below.
  const enter = (from) => (reduceMotion ? false : from);

  return (
    <MotionConfig reducedMotion="user">
    <motion.div
      initial={enter({ opacity: 0 })}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.2 } }}
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{
        background: visualSettings.useGradient
          ? `linear-gradient(to bottom right, ${visualSettings.primaryColor}, ${visualSettings.secondaryColor})`
          : visualSettings.primaryColor
      }}
    >
      <div className="text-center">
        <motion.div
          initial={enter({ scale: 0 })}
          animate={{ scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mb-8"
        >
          <div className="relative">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-24 h-24 mx-auto mb-4 relative"
            >
              <div className="absolute inset-0 rounded-full border-4 border-white/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-white border-t-transparent animate-spin motion-reduce:animate-none"></div>
            </motion.div>
            
            <motion.div
              initial={enter({ y: 20, opacity: 0 })}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex justify-center space-x-4 mb-6"
            >
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: 0 }}
              >
                <ShoppingBag className="w-8 h-8 text-white" />
              </motion.div>
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
              >
                <DollarSign className="w-8 h-8 text-white" />
              </motion.div>
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
              >
                <Globe className="w-8 h-8 text-white" />
              </motion.div>
            </motion.div>
          </div>
        </motion.div>

        <motion.h1
          initial={enter({ y: 30, opacity: 0 })}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-4xl font-bold text-white mb-4"
        >
          {visualSettings.companyName || 'PapuEnvíos'}
        </motion.h1>

        <motion.p
          initial={enter({ y: 20, opacity: 0 })}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="text-xl text-white/80 mb-8"
        >
          {t('common.loadingPlatform')}
        </motion.p>

        <motion.div
          initial={enter({ scaleX: 0 })}
          animate={{ scaleX: 1 }}
          transition={{ duration: 2, delay: 1 }}
          className="w-64 h-2 rounded-full mx-auto overflow-hidden"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.2)'
          }}
        >
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            className="h-full w-1/3"
            style={{
              background: visualSettings.useGradient
                ? `linear-gradient(to right, transparent, ${visualSettings.secondaryColor}, transparent)`
                : `linear-gradient(to right, transparent, ${visualSettings.primaryColor}, transparent)`
            }}
          />
        </motion.div>
      </div>
    </motion.div>
    </MotionConfig>
  );
};

export default LoadingScreen;