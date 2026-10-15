import React from 'react';
import { pageToPath } from '@/lib/routes';

const isModifiedClick = (event) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/**
 * Real <a href> to an in-app page. Plain clicks use the app's onNavigate (no reload);
 * modified clicks fall through so "open in new tab" keeps working.
 *
 * With a hash: arriving from another page replaces the just-pushed entry with the anchored URL
 * (one history entry); when already on the page a new entry is pushed (Back returns to the
 * previous position) and the target section is scrolled into view explicitly, because
 * pushState does not emit hashchange.
 */
const LegalLink = ({ page, hash, onNavigate, className = 'underline', children }) => {
  const path = pageToPath(page);
  const href = `${path}${hash ? `#${hash}` : ''}`;

  const handleClick = (event) => {
    if (isModifiedClick(event) || typeof onNavigate !== 'function') return;
    event.preventDefault();

    const alreadyOnPage = window.location.pathname.replace(/\/$/, '') === path;
    onNavigate(page);

    if (!hash) return;
    if (alreadyOnPage) {
      window.history.pushState({ path }, '', href);
      document.getElementById(hash)?.scrollIntoView?.();
    } else {
      window.history.replaceState({ path }, '', href);
    }
  };

  return (
    <a href={href} onClick={handleClick} className={className}>
      {children}
    </a>
  );
};

export default LegalLink;
