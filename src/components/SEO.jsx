import { useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * SEO Component
 * Updates document meta tags for SEO purposes
 */
const SEO = ({
  titleKey,
  descriptionKey,
  path = '',
  type = 'website',
  keywords = []
}) => {
  const { t } = useLanguage();

  useEffect(() => {
    // Get translated title and description
    const title = t(titleKey) || 'Papuenvios';
    const description = t(descriptionKey) || 'Sistema de envío de remesas';

    // Update document title
    document.title = title;

    // Update or create meta tags
    const updateMetaTag = (name, content) => {
      let meta = document.querySelector(`meta[name="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = name;
        document.head.appendChild(meta);
      }
      meta.content = content;
    };

    const updateOgTag = (property, content) => {
      let meta = document.querySelector(`meta[property="${property}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.property = property;
        document.head.appendChild(meta);
      }
      meta.content = content;
    };

    // Update standard meta tags
    updateMetaTag('description', description);
    updateMetaTag('keywords', keywords.join(', '));

    // Update Open Graph meta tags
    updateOgTag('og:title', title);
    updateOgTag('og:description', description);
    updateOgTag('og:type', type);
    if (path) {
      const baseUrl = window.location.origin;
      updateOgTag('og:url', `${baseUrl}${path}`);
    }

    return () => {
      // Optional: cleanup on unmount
    };
  }, [titleKey, descriptionKey, path, type, keywords, t]);

  return null; // SEO component doesn't render anything
};

export default SEO;
