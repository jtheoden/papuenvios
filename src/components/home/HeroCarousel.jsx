import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildHomeTheme } from '@/lib/homeTheme';
import { cn } from '@/lib/utils';
import StackedSlides from '@/components/home/StackedSlides';
import { DOT_GAP, DOT_HIT_AREA } from '@/components/home/heroControls';
import { readHeroShape, saveHeroShape } from '@/components/home/heroShape';
import { useHeroSlides, useIsWide, useFrameRatio, slideKey, slideTexts, DEFAULT_POSTER_RATIO } from '@/components/home/useHeroSlides';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2';
const controlClass = cn(
  'inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors motion-reduce:transition-none',
  focusRing
);
const arrowClass = cn(controlClass, 'absolute top-1/2 z-10 -translate-y-1/2 shadow-md');

// Reserved by the skeleton so swapping it for the carousel does not move the page:
// the controls row (h-11 buttons) and a caption block of a one-line title + a one-line subtitle
// (16px padding + 24px + 20px on mobile, 16px + 28px + 24px from md).
const CONTROLS_ROW = 'mt-3 min-h-[2.75rem]';
const CAPTION_MIN_HEIGHT = 'min-h-[3.75rem] md:min-h-[4.25rem]';

const cardStyle = (theme) => ({ borderColor: theme.border, backgroundColor: theme.cardBg });

/**
 * Reserves the card, the panoramic frame and, when the previous visit had them, the caption and the controls row
 * while the slides are being fetched (see heroShape.js; without a previous visit it assumes both).
 */
export const HeroCarouselSkeleton = ({ visualSettings }) => {
  const theme = buildHomeTheme(visualSettings);
  const { caption, multiple } = readHeroShape();
  return (
    <div data-testid="hero-carousel-skeleton" aria-hidden="true">
      <div className="rounded-2xl border p-2 md:p-3" style={cardStyle(theme)}>
        <div
          className="w-full animate-pulse rounded-xl bg-gray-200 motion-reduce:animate-none"
          data-frame-ratio={DEFAULT_POSTER_RATIO}
          style={{ aspectRatio: DEFAULT_POSTER_RATIO }}
        />
        {caption && <div data-testid="hero-caption-placeholder" className={cn('px-2 pb-1 pt-3', CAPTION_MIN_HEIGHT)} />}
      </div>
      {multiple && <div data-testid="hero-controls-placeholder" className={CONTROLS_ROW} />}
    </div>
  );
};

/**
 * Hero carousel of the `spaced` composition: the poster in a card (padding p-2 md:p-3), its title and subtitle as a
 * caption under it when they exist, arrows over the sides from md, and pause + dots below.
 *
 * Frame ratio: computed once, before the real frame is shown, from the size of every poster (useFrameRatio). Until
 * then the frame is a 3.8:1 skeleton with the poster hidden; after that it never changes, so neither a slide change
 * nor a late image can shift the page. The only layout change is the one at that first reveal, when the real ratio
 * differs from 3.8:1 (the real banners are 3.8:1).
 */
const HeroCarousel = ({ slides, visualSettings }) => {
  const { t, language } = useLanguage();
  const theme = buildHomeTheme(visualSettings);
  const wide = useIsWide();
  const carousel = useHeroSlides(slides, visualSettings);
  const { usable, count, multiple, current, slide, running, userPaused, transitionMs } = carousel;
  const measured = useFrameRatio(usable.map((item) => item.image_url || item.image_file));
  const hasCaption = usable.some((item) => {
    const texts = slideTexts(item, language);
    return texts.title || texts.subtitle;
  });

  useEffect(() => {
    if (slide) saveHeroShape({ caption: hasCaption, multiple });
  }, [slide, hasCaption, multiple]);

  if (!slide) return null;

  const ready = measured !== null;
  const live = running ? 'off' : 'polite';
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
            aria-live={live}
            data-frame-ready={ready}
            data-frame-ratio={measured ?? DEFAULT_POSTER_RATIO}
            className="relative w-full overflow-hidden rounded-xl"
            style={{ aspectRatio: measured ?? DEFAULT_POSTER_RATIO }}
          >
            <div
              role="group"
              aria-roledescription={t('home.carousel.slide')}
              aria-label={t('home.carousel.slideOf', { count: current + 1, total: count })}
              className="h-full w-full"
            >
              {/* empty alt: the title is the visible caption below (and the live region announces changes) */}
              <img
                key={slideKey(slide, current)}
                data-testid="hero-slide-image"
                src={slide.image_url || slide.image_file}
                alt=""
                fetchpriority={carousel.isFirst(slide) ? 'high' : undefined}
                onError={() => carousel.markFailed(slide)}
                className={cn('h-full w-full object-contain animate-in fade-in motion-reduce:animate-none', !ready && 'invisible')}
                style={{ animationDuration: `${transitionMs}ms` }}
              />
            </div>
            {!ready && (
              <div
                data-testid="hero-frame-skeleton"
                aria-hidden="true"
                className="absolute inset-0 animate-pulse bg-gray-200 motion-reduce:animate-none"
              />
            )}
          </div>
          {multiple && wide && arrows.map((arrow) => renderArrow(arrow, true))}
        </div>

        {hasCaption && (
          <StackedSlides
            testId="hero-slide-caption"
            live={live}
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
          <div className={cn('flex flex-wrap items-center justify-center', DOT_GAP)}>
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
                    DOT_HIT_AREA,
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
