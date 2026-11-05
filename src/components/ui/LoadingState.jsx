import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

// Fast networks never see the skeleton; once shown it stays long enough not to flicker.
export const SHOW_DELAY_MS = 300;
export const MIN_VISIBLE_MS = 400;

/** Skeleton placeholder block: theme token colour, pulse only without prefers-reduced-motion. */
export const SkeletonBox = ({ className }) => (
  <div data-skeleton aria-hidden="true" className={cn('rounded-md bg-muted motion-safe:animate-skeleton', className)} />
);

/**
 * Loading gate for network-loaded lists. While `loading`, it renders `skeleton` (invisible for the first
 * SHOW_DELAY_MS so it already reserves the space, then faded in with a visible "loading" label) and never
 * `children`, so an empty state cannot show before the data arrives. Pass `loading={false}` on error so the
 * view's error state replaces the skeleton.
 */
const LoadingState = ({ loading, skeleton, label, className, children }) => {
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
      }, SHOW_DELAY_MS);
      return () => clearTimeout(id);
    }
    const remaining = phaseRef.current === 'visible' ? MIN_VISIBLE_MS - (Date.now() - shownAt.current) : 0;
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

  if (showContent) {
    return wasShown.current ? <div className="motion-safe:animate-fade-in">{children}</div> : children;
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
