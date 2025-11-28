import React, { createContext, useContext, useState } from 'react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const LanguageContext = createContext();

const translations = { es: ES, en: EN };

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState(() => {
    // Load language preference from localStorage on initial mount
    if (typeof window !== 'undefined') {
      const savedLanguage = localStorage.getItem('preferredLanguage');
      return savedLanguage || 'es';
    }
    return 'es';
  });

  const handleSetLanguage = (newLanguage) => {
    setLanguage(newLanguage);
    // Save language preference to localStorage whenever it changes
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferredLanguage', newLanguage);
    }
  };

  const t = (key, params = {}) => {
    const keys = key.split('.');
    let value = translations[language];

    for (const k of keys) {
      value = value?.[k];
    }

    if (typeof value === 'string') {
      return Object.entries(params).reduce(
        (acc, [paramKey, paramValue]) => acc.replace(`{${paramKey}}`, paramValue),
        value
      );
    }

    return value || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};