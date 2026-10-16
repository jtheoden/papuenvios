import EN from '@/translations/EN.json';
import ES from '@/translations/ES.json';

/** Translator backed by the real ES/EN dictionaries, with the same {param} interpolation as LanguageContext. */
export const makeRealT = (language = 'en') => {
  const dict = language === 'es' ? ES : EN;
  return (key, params = {}) => {
    const raw = key.split('.').reduce((acc, part) => acc?.[part], dict);
    if (typeof raw !== 'string') return key;
    return Object.entries(params).reduce((acc, [name, value]) => acc.replace(`{${name}}`, value), raw);
  };
};
