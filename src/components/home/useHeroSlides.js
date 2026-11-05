import { useState, useEffect, useMemo } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const WIDE_VIEWPORT = '(min-width: 768px)'; // Tailwind md
const DEFAULT_AUTOPLAY_MS = 5000;
const MIN_AUTOPLAY_MS = 2000; // WCAG 2.2.2 / readability: never flip faster than this, whatever the stored setting
const DEFAULT_TRANSITION_MS = 1000;

// stable identity of a slide for the failed-image set and React keys
export const slideKey = (item, i) => item.id ?? `${i}:${item.image_url || item.image_file}`;

const matches = (query) => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

const useMediaQuery = (query) => {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = (event) => setValue(event.matches);
    list.addEventListener?.('change', onChange);
    return () => list.removeEventListener?.('change', onChange);
  }, [query]);
  return value;
};

export const useIsWide = () => useMediaQuery(WIDE_VIEWPORT);

const useDocumentHidden = () => {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return hidden;
};

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/** Title and subtitle of a slide in the given language; empty strings when it has none. */
export const slideTexts = (slide, language) => ({
  title: clean(language === 'es' ? slide.title_es : slide.title_en),
  subtitle: clean(language === 'es' ? slide.subtitle_es : slide.subtitle_en),
});

/**
 * Carousel behaviour shared by both hero compositions. WCAG 2.2.2: it pauses on hover, on focus inside, when the
 * tab is hidden and with the pause button; with prefers-reduced-motion it starts paused. The user's own pause is
 * never undone automatically, and an explicit "resume" wins over hover/focus until the pointer and the focus have
 * both left the carousel. Slides without an image, or whose image fails to load, are skipped.
 */
export const useHeroSlides = (slides, visualSettings) => {
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const hidden = useDocumentHidden();
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(reducedMotion);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [holdIgnored, setHoldIgnored] = useState(false);
  const [failed, setFailed] = useState(() => new Set());

  const usable = useMemo(
    () => slides.filter((item, i) => (item.image_url || item.image_file) && !failed.has(slideKey(item, i))),
    [slides, failed]
  );
  const count = usable.length;
  const multiple = count > 1;
  const current = Math.min(index, Math.max(count - 1, 0));
  const speed = Math.max(MIN_AUTOPLAY_MS, Number(visualSettings.carouselAutoplaySpeed) || DEFAULT_AUTOPLAY_MS);
  const running = multiple && !userPaused && (holdIgnored || (!hovered && !focused)) && !hidden;

  useEffect(() => {
    if (reducedMotion) setUserPaused(true);
  }, [reducedMotion]);

  useEffect(() => {
    if (!hovered && !focused) setHoldIgnored(false);
  }, [hovered, focused]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setIndex((i) => (Math.min(i, count - 1) + 1) % count), speed);
    return () => clearInterval(timer);
  }, [running, speed, count]);

  return {
    usable,
    count,
    multiple,
    current,
    slide: usable[current],
    running,
    userPaused,
    transitionMs: visualSettings.carouselTransitionSpeed || DEFAULT_TRANSITION_MS,
    select: setIndex,
    go: (delta) => setIndex((current + delta + count) % count),
    togglePause: () => {
      setHoldIgnored(userPaused); // resuming ignores hover/focus until both are gone
      setUserPaused(!userPaused);
    },
    // the first poster is the LCP candidate of the page
    isFirst: (slide) => slide === usable[0],
    markFailed: (slide) => setFailed((prev) => new Set(prev).add(slideKey(slide, slides.indexOf(slide)))),
    regionHandlers: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      },
    },
  };
};
