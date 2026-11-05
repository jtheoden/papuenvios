import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildHomeTheme } from '@/lib/homeTheme';
import { cn } from '@/lib/utils';
import StackedSlides from '@/components/home/StackedSlides';
import { useHeroSlides, useIsWide, slideKey, slideTexts } from '@/components/home/useHeroSlides';

// Panoramic skeleton ratio shown until a poster reports its real size; the real banners are wide.
export const DEFAULT_POSTER_RATIO = 3.8;
const MIN_FRAME_RATIO = 1; // never taller than a square, whatever a poster reports
const MAX_FRAME_RATIO = 6;

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2';
const controlClass = cn(
  'inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors motion-reduce:transition-none',
  focusRing
);
const arrowClass = cn(controlClass, 'absolute top-1/2 z-10 -translate-y-1/2 shadow-md md:h-11 md:w-11');

// Height of the controls row (h-10 buttons) reserved by the skeleton so the swap does not move the page
const CONTROLS_ROW = 'mt-3 min-h-[2.5rem]';

const cardStyle = (theme) => ({ borderColor: theme.border, backgroundColor: theme.cardBg });

/** Reserves the card, the panoramic frame and the controls row while the slides are being fetched. */
export const HeroCarouselSkeleton = ({ visualSettings }) => {
  const theme = buildHomeTheme(visualSettings);
  return (
    <div data-testid="hero-carousel-skeleton" aria-hidden="true">
      <div className="rounded-2xl border p-2 md:p-3" style={cardStyle(theme)}>
        <div className="w-full animate-pulse rounded-xl bg-gray-200 motion-reduce:animate-none" data-frame-ratio={DEFAULT_POSTER_RATIO} style={{ aspectRatio: DEFAULT_POSTER_RATIO }} />
      </div>
      <div data-testid="hero-controls-placeholder" className={CONTROLS_ROW} />
    </div>
  );
};

/**
 * Hero carousel of the `spaced` composition: the poster in a card (padding p-2 md:p-3), its title and subtitle as a
 * caption under it when they exist, arrows over the sides from md, and pause + dots below.
 *
 * Frame ratio: taken from the poster once it loads (naturalWidth / naturalHeight). The frame then keeps the tallest
 * ratio seen (the lowest width/height) and never shrinks, so changing slide never moves the page; a wider poster is
 * letterboxed by object-contain. Only a poster taller than every one seen before grows the frame, once. Before any
 * poster has loaded the frame is a 3.8:1 skeleton, which is already the real ratio of the banners in use.
 */
const HeroCarousel = ({ slides, visualSettings }) => {
  const { t, language } = useLanguage();
  const theme = buildHomeTheme(visualSettings);
  const wide = useIsWide();
  const carousel = useHeroSlides(slides, visualSettings);
  const { usable, count, multiple, current, slide, running, userPaused, transitionMs } = carousel;
  const [ratios, setRatios] = useState({});

  if (!slide) return null;

  const recordRatio = (key, { naturalWidth, naturalHeight }) => {
    if (!naturalWidth || !naturalHeight) return; // not decoded yet (or no intrinsic size): keep what we have
    const ratio = Math.min(MAX_FRAME_RATIO, Math.max(MIN_FRAME_RATIO, naturalWidth / naturalHeight));
    setRatios((prev) => (prev[key] === ratio ? prev : { ...prev, [key]: ratio }));
  };
  const known = Object.values(ratios);
  const frameRatio = known.length ? Math.min(...known) : DEFAULT_POSTER_RATIO;

  const { title } = slideTexts(slide, language);
  const hasCaption = usable.some((item) => {
    const texts = slideTexts(item, language);
    return texts.title || texts.subtitle;
  });
  const controlStyle = { borderColor: theme.border, backgroundColor: theme.cardBg, color: theme.ink };
  const arrows = [
    { name: t('home.carousel.previous'), delta: -1, Icon: ChevronLeft, side: 'left-2 md:left-3' },
    { name: t('home.carousel.next'), delta: 1, Icon: ChevronRight, side: 'right-2 md:right-3' },
  ];
  const renderArrow = ({ name, delta, Icon, side }, overlay) => (
    <button
      key={delta}
      type="button"
      className={overlay ? cn(arrowClass, side) : controlClass}
      style={controlStyle}
      aria-label={name}
      onClick={() => carousel.go(delta)}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );

  return (
    <div
      data-testid="hero-carousel"
      role="region"
      aria-roledescription={t('home.carousel.roleDescription')}
      aria-label={t('home.carousel.label')}
      {...carousel.regionHandlers}
    >
      <div data-testid="hero-carousel-card" className="rounded-2xl border p-2 md:p-3" style={cardStyle(theme)}>
        <div className="relative">
          <div
            data-testid="hero-carousel-frame"
            aria-live={running ? 'off' : 'polite'}
            data-frame-ratio={frameRatio}
            className="relative w-full overflow-hidden rounded-xl"
            style={{ aspectRatio: frameRatio }}
          >
            <div
              role="group"
              aria-roledescription={t('home.carousel.slide')}
              aria-label={t('home.carousel.slideOf', { count: current + 1, total: count })}
              className="h-full w-full"
            >
              <img
                key={slideKey(slide, current)}
                data-testid="hero-slide-image"
                src={slide.image_url || slide.image_file}
                alt={title}
                fetchpriority={carousel.isFirst(slide) ? 'high' : undefined}
                onLoad={(event) => recordRatio(slideKey(slide, current), event.currentTarget)}
                onError={() => carousel.markFailed(slide)}
                className="h-full w-full object-contain animate-in fade-in motion-reduce:animate-none"
                style={{ animationDuration: `${transitionMs}ms` }}
              />
            </div>
          </div>
          {multiple && wide && arrows.map((arrow) => renderArrow(arrow, true))}
        </div>

        {hasCaption && (
          <StackedSlides
            testId="hero-slide-caption"
            className="px-2 pb-1 pt-3 text-center"
            items={usable}
            current={current}
            render={(item) => {
              const texts = slideTexts(item, language);
              return (
                <>
                  {texts.title && <p className="font-semibold md:text-lg" style={{ color: theme.ink }}>{texts.title}</p>}
                  {texts.subtitle && <p className="text-sm md:text-base" style={{ color: theme.muted }}>{texts.subtitle}</p>}
                </>
              );
            }}
          />
        )}
      </div>

      {multiple && (
        <div className={cn(CONTROLS_ROW, 'flex flex-wrap items-center justify-center gap-x-4 gap-y-2')}>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={controlClass}
              style={controlStyle}
              aria-label={userPaused ? t('home.carousel.play') : t('home.carousel.pause')}
              onClick={carousel.togglePause}
            >
              {userPaused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
            </button>
            {!wide && arrows.map((arrow) => renderArrow(arrow, false))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {usable.map((item, i) => {
              const active = i === current;
              return (
                <button
                  key={slideKey(item, i)}
                  type="button"
                  aria-label={t('home.carousel.goTo', { count: i + 1 })}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => carousel.select(i)}
                  className={cn(
                    'h-6 rounded-full border-2 transition-all motion-reduce:transition-none',
                    focusRing,
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
