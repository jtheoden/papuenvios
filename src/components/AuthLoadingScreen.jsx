import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const AuthLoadingScreen = () => {
  // Load visual settings from localStorage
  const [visualSettings, setVisualSettings] = useState(null);

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

  // Use stored settings or defaults
  const primaryColor = visualSettings?.primaryColor || '#2563eb';
  const secondaryColor = visualSettings?.secondaryColor || '#9333ea';
  const useGradient = visualSettings?.useGradient !== undefined ? visualSettings.useGradient : true;
  const pageBgColor = visualSettings?.pageBgColor || '#f9fafb';

  const backgroundStyle = useGradient
    ? { background: `linear-gradient(to right, ${primaryColor}, ${secondaryColor})` }
    : { backgroundColor: pageBgColor };

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
        className="p-8 rounded-2xl shadow-xl"
        style={{
          backgroundColor: visualSettings?.cardBgColor || '#ffffff'
        }}
      >
        <div className="flex flex-col items-center space-y-4">
          <div
            className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: `${primaryColor} transparent transparent transparent` }}
          />
          <p className="font-medium" style={{ color: visualSettings?.textPrimaryColor || '#4b5563' }}>
            Authenticating...
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default AuthLoadingScreen;