import { useEffect } from 'react';

/**
 * Scroll handling for long static pages: on mount and on every hashchange, scroll to the
 * element matching location.hash, or to the top when there is no hash.
 */
export const useAnchorScroll = () => {
  useEffect(() => {
    const apply = () => {
      const id = decodeURIComponent(window.location.hash.replace('#', ''));
      if (id) {
        document.getElementById(id)?.scrollIntoView?.();
      } else {
        window.scrollTo({ top: 0, left: 0 });
      }
    };

    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);
};
