import React, { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

// Non-blocking notice rendered as the last row INSIDE the fixed Header, so it always
// follows the header's real height (quick-nav row, open mobile menu) and never overlaps it.
const RoleUnresolvedBanner = () => {
  const { t } = useLanguage();
  const { user, roleStatus, roleFetchFailed, retryRoleResolution } = useAuth();

  const visible = Boolean(user) && roleFetchFailed && roleStatus !== 'resolved';
  const ref = useRef(null);

  // Publish the banner height so <main> (padded for the fixed header) can make room for it.
  useEffect(() => {
    if (!visible || !ref.current) return undefined;
    const el = ref.current;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--role-banner-h', `${el.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.setProperty('--role-banner-h', '0px');
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      ref={ref}
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <span>{t('auth.roleUnresolved')}</span>
      <button
        type="button"
        onClick={retryRoleResolution}
        className="rounded-md bg-amber-900 px-3 py-1.5 font-medium text-white hover:bg-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-900 focus-visible:ring-offset-2"
      >
        {t('auth.roleRetry')}
      </button>
    </div>
  );
};

export default RoleUnresolvedBanner;
