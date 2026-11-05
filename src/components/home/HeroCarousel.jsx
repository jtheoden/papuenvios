import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildHomeTheme } from '@/lib/homeTheme';
import { cn } from '@/lib/utils';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const DEFAULT_AUTOPLAY_MS = 5000;
const DEFAULT_TRANSITION_MS = 1000;

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(REDUCED_MOTION);
    const onChange = (event) => setReduced(event.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
};

const useDocumentHidden = () => {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return hidden;
};

const controlClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2';

/**
 * Hero carousel. WCAG 2.2.2: it pauses on hover, on focus inside, when the tab is hidden and with the pause
 * button; with prefers-reduced-motion it starts paused. The user's own pause is never undone automatically.
 */
const HeroCarousel = ({ slides, visualSettings }) => {
  const { t, language } = useLanguage();
  const theme = buildHomeTheme(visualSettings);
  const reducedMotion = useReducedMotion();
  const hidden = useDocumentHidden();
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(reducedMotion);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const count = slides.length;
  const multiple = count > 1;
  const current = Math.min(index, Math.max(count - 1, 0));
  const slide = slides[current];
  const speed = visualSettings.carouselAutoplaySpeed || DEFAULT_AUTOPLAY_MS;
  const transitionMs = visualSettings.carouselTransitionSpeed || DEFAULT_TRANSITION_MS;
  const running = multiple && !userPaused && !hovered && !focused && !hidden;

  useEffect(() => {
    if (reducedMotion) setUserPaused(true);
  }, [reducedMotion]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setIndex((i) => (Math.min(i, count - 1) + 1) % count), speed);
    return () => clearInterval(timer);
  }, [running, speed, count]);

  if (!slide) return null;

  const go = (delta) => setIndex((current + delta + count) % count);
  const title = language === 'es' ? slide.title_es : slide.title_en;
  const controlStyle = { borderColor: theme.border, backgroundColor: theme.cardBg, color: theme.ink };

  return (
    <div
      data-testid="hero-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label={t('home.carousel.label')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div
        data-testid="hero-carousel-frame"
        aria-live={running ? 'off' : 'polite'}
        className="relative aspect-video w-full overflow-hidden rounded-xl border"
        style={{ borderColor: theme.border, backgroundColor: theme.cardBg }}
      >
        <img
          key={current}
          data-testid="hero-slide-image"
          src={slide.image_url || slide.image_file}
          alt={title || t('home.hero.title')}
          className="h-full w-full object-contain animate-in fade-in motion-reduce:animate-none"
          style={{ animationDuration: `${transitionMs}ms` }}
        />
      </div>

      {multiple && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={controlClass}
              style={controlStyle}
              aria-label={userPaused ? t('home.carousel.play') : t('home.carousel.pause')}
              onClick={() => setUserPaused((paused) => !paused)}
            >
              {userPaused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button type="button" className={controlClass} style={controlStyle} aria-label={t('home.carousel.previous')} onClick={() => go(-1)}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" className={controlClass} style={controlStyle} aria-label={t('home.carousel.next')} onClick={() => go(1)}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {slides.map((item, i) => {
              const active = i === current;
              return (
                <button
                  key={item.id ?? i}
                  type="button"
                  aria-label={t('home.carousel.goTo', { count: i + 1 })}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setIndex(i)}
                  className={cn(
                    'h-6 rounded-full border-2 transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2',
                    active ? 'w-8' : 'w-6'
                  )}
                  style={{ backgroundColor: active ? theme.dotActive : theme.border, borderColor: theme.ink }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default HeroCarousel;
