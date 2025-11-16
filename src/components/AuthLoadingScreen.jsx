import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const AuthLoadingScreen = ({ loadingMessage = 'Autenticando...' }) => {
  // Load visual settings from localStorage
  const [visualSettings, setVisualSettings] = useState(null);
  const [displayMessage, setDisplayMessage] = useState(loadingMessage);
  const [dotCount, setDotCount] = useState(0);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('visualSettings');
      if (stored) {
        setVisualSettings(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading visual settings:', error);
    }
  }, []);

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
    setDisplayMessage(loadingMessage + dots);
  }, [dotCount, loadingMessage]);

  // Use stored settings or defaults
  const primaryColor = visualSettings?.primaryColor || '#2563eb';
  const secondaryColor = visualSettings?.secondaryColor || '#9333ea';
  const useGradient = visualSettings?.useGradient !== undefined ? visualSettings.useGradient : true;
  const pageBgColor = visualSettings?.pageBgColor || '#f9fafb';

  const backgroundStyle = useGradient
    ? { background: `linear-gradient(to right, ${primaryColor}, ${secondaryColor})` }
    : { backgroundColor: pageBgColor };

  const messages = [
    'Conectando con Google...',
    'Validando credenciales...',
    'Obteniendo datos de usuario...',
    'Sincronizando perfil...',
    'Finalizando autenticación...'
  ];

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={backgroundStyle}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
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
        className="p-8 rounded-2xl shadow-xl max-w-md"
        style={{
          backgroundColor: visualSettings?.cardBgColor || '#ffffff'
        }}
      >
        <div className="flex flex-col items-center space-y-6">
          {/* Spinner */}
          <div
            className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: `${primaryColor} transparent transparent transparent` }}
          />

          {/* Main message */}
          <div className="text-center">
            <p
              className="font-medium text-lg mb-4"
              style={{ color: visualSettings?.textPrimaryColor || '#4b5563' }}
            >
              {displayMessage}
            </p>

            {/* Status messages carousel */}
            <motion.div
              className="min-h-6"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <p
                className="text-sm"
                style={{ color: visualSettings?.textSecondaryColor || '#9ca3af' }}
              >
                {messages[Math.floor(Date.now() / 2000) % messages.length]}
              </p>
            </motion.div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: primaryColor }}
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{
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