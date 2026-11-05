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

// Panoramic ratio of the skeleton and fallback of the frame; the real banners are wide.
export const DEFAULT_POSTER_RATIO = 3.8;
const MIN_FRAME_RATIO = 1; // never taller than a square, whatever a poster reports
const MAX_FRAME_RATIO = 6;
const PRELOAD_TIMEOUT_MS = 3000;

/**
 * Frame ratio of the spaced carousel, computed ONCE per mount: every poster is preloaded (`new Image()`) and the
 * tallest ratio wins (lowest width/height, clamped), so every poster fits and no later slide change or load can
 * resize the frame. `ratio` is null while the posters are being measured (the caller shows a skeleton). If any
 * poster fails, has no intrinsic size, or does not answer within 3 s, the frame falls back to 3.8:1 and does not
 * wait any longer. Posters that differ from the frame are letterboxed by object-contain.
 */
export const useFrameRatio = (urls) => {
  const [ratio, setRatio] = useState(null);
  const key = urls.join('\n');
  const settled = ratio !== null;

  useEffect(() => {
    if (settled || urls.length === 0) return undefined;
    const known = [];
    let waiting = urls.length;
    let done = false;
    const finish = (fallback) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setRatio(fallback || known.length < urls.length ? DEFAULT_POSTER_RATIO : Math.min(...known));
    };
    const timer = setTimeout(() => finish(true), PRELOAD_TIMEOUT_MS);
    const probes = urls.map((url, i) => {
      const probe = new Image();
      probe.onload = () => {
        if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
          known.push(Math.min(MAX_FRAME_RATIO, Math.max(MIN_FRAME_RATIO, probe.naturalWidth / probe.naturalHeight)));
        }
        waiting -= 1;
        if (waiting === 0) finish(false);
      };
      probe.onerror = () => finish(true);
      if (i === 0) probe.fetchPriority = 'high'; // the first poster is the LCP candidate
      probe.src = url;
      return probe;
    });
    return () => {
      done = true;
      clearTimeout(timer);
      probes.forEach((probe) => { probe.onload = null; probe.onerror = null; });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the url list
  }, [key, settled]);

  return ratio;
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
