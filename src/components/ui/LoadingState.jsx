import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

import { loadingTiming, SHOW_DELAY_MS, MIN_VISIBLE_MS } from '@/components/ui/loadingTiming';

// Fast networks never see the skeleton; once shown it stays long enough not to flicker.
export { SHOW_DELAY_MS, MIN_VISIBLE_MS };

/**
 * Skeleton placeholder block. Colour: the theme's accent line token (beige in the brand look, blue-200 in classic),
 * a step darker than bg-muted so it stays visible on glass and ivory. Pulse only without prefers-reduced-motion.
 */
export const SkeletonBox = ({ className }) => (
  <div data-skeleton aria-hidden="true" className={cn('rounded-md bg-theme-accent-line/70 motion-safe:animate-skeleton', className)} />
);

/**
 * Loading gate for network-loaded lists. While `loading`, it renders `skeleton` (invisible for the first
 * SHOW_DELAY_MS so it already reserves the space, then faded in with a visible "loading" label) and never
 * `children`, so an empty state cannot show before the data arrives. Pass `loading={false}` on error so the
 * view's error state replaces the skeleton. `refreshing` marks content that stays on screen during a reload.
 */
const LoadingState = ({ loading, skeleton, label, className, contentClassName, refreshing = false, children }) => {
  const { t } = useLanguage();
  const [phase, setPhase] = useState(loading ? 'waiting' : 'done');
  const [paused, setPaused] = useState(false);
  const phaseRef = useRef(phase);
  const shownAt = useRef(0);
  const wasShown = useRef(false);
  const statusRef = useRef(null);

  const enter = (next) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    if (loading) {
      if (phaseRef.current === 'visible') return undefined;
      wasShown.current = false;
      enter('waiting');
      const id = setTimeout(() => {
        shownAt.current = Date.now();
        wasShown.current = true;
        enter('visible');
      }, loadingTiming.showDelayMs);
      return () => clearTimeout(id);
    }
    const remaining = phaseRef.current === 'visible' ? loadingTiming.minVisibleMs - (Date.now() - shownAt.current) : 0;
    if (remaining <= 0) {
      enter('done');
      return undefined;
    }
    const id = setTimeout(() => enter('done'), remaining);
    return () => clearTimeout(id);
  }, [loading]);

  // A load that ends before the skeleton appeared shows the content in the same render.
  const showContent = phase === 'done' || (!loading && phase === 'waiting');

  // The infinite pulse stops while the tab is hidden or the skeleton is scrolled out of view.
  useEffect(() => {
    if (showContent) return undefined;
    let offscreen = false;
    const update = () => setPaused(document.visibilityState === 'hidden' || offscreen);
    let observer;
    if (typeof IntersectionObserver !== 'undefined' && statusRef.current) {
      observer = new IntersectionObserver(([entry]) => {
        offscreen = !entry.isIntersecting;
        update();
      });
      observer.observe(statusRef.current);
    }
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      document.removeEventListener('visibilitychange', update);
      observer?.disconnect();
    };
  }, [showContent]);

  // Always the same wrapper, so the content DOM does not depend on how fast the network was: pass the
  // layout class the children need from their container (e.g. `space-y-3`) as contentClassName.
  if (showContent) {
    return (
      <div
        aria-busy={refreshing || undefined}
        className={cn(
          contentClassName,
          wasShown.current && 'motion-safe:animate-fade-in',
          // A reload with content on screen: dim it in place (opacity only, no layout shift).
          refreshing && 'opacity-60 motion-safe:transition-opacity motion-safe:duration-motion'
        ) || undefined}
      >
        {children}
      </div>
    );
  }

  const visible = phase === 'visible';
  return (
    <div
      ref={statusRef}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-state={visible ? 'visible' : 'waiting'}
      data-paused={paused ? '' : undefined}
      className={cn('motion-safe:transition-opacity motion-safe:duration-motion', visible ? 'opacity-100' : 'opacity-0', className)}
    >
      {/* Fixed height: inserting the text later must not move the skeleton (CLS). Inserted text is announced. */}
      <p className="mb-4 min-h-5 text-center text-sm text-muted-foreground">
        {visible ? (label ?? t('common.loading')) : null}
      </p>
      <div aria-hidden="true">{skeleton}</div>
    </div>
  );
};

export default LoadingState;
