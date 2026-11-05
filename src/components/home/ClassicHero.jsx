import React from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildHomeTheme } from '@/lib/homeTheme';
import { cn } from '@/lib/utils';
import StackedSlides from '@/components/home/StackedSlides';
import { useHeroSlides, slideKey, slideTexts } from '@/components/home/useHeroSlides';

const overlayRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black';
const arrowClass = cn(
  'absolute top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/40 motion-reduce:transition-none',
  overlayRing
);
// legibility over any poster, on top of the veil
const textShadow = '[text-shadow:0_1px_3px_rgba(0,0,0,0.6)]';

/**
 * `classic` composition: the original full-bleed cover. The poster covers the section under a bg-black/50 veil and
 * the slide text sits over it, with translucent arrows at the sides. Unlike the original, the page title is the one
 * stable h1 (the slide title is an h2) and the carousel keeps its accessibility: visible pause button, pauses on
 * hover / focus / hidden tab, prefers-reduced-motion, 2 s minimum and dots as buttons.
 * While the slides load, or if none can be shown, the same box keeps the h1 and the CTA over a dark background so
 * the page never loses its heading and the height does not change.
 */
const ClassicHero = ({ slides, loading, visualSettings, onNavigate }) => {
  const { t, language } = useLanguage();
  const theme = buildHomeTheme(visualSettings);
  const carousel = useHeroSlides(loading ? [] : slides, visualSettings);
  const { slide, usable, count, current, multiple, running, userPaused, transitionMs } = carousel;

  const region = slide
    ? {
        role: 'region',
        'aria-roledescription': t('home.carousel.roleDescription'),
        'aria-label': t('home.carousel.label'),
        ...carousel.regionHandlers,
      }
    : {};

  return (
    <section
      data-testid="home-hero"
      className={cn('relative h-[60vh] min-h-[30rem] w-full overflow-hidden md:h-[80vh]', !slide && 'bg-neutral-900')}
    >
      <div data-testid="hero-carousel" className="relative h-full w-full" {...region}>
        {slide && (
          <div
            role="group"
            aria-roledescription={t('home.carousel.slide')}
            aria-label={t('home.carousel.slideOf', { count: current + 1, total: count })}
            aria-live={running ? 'off' : 'polite'}
            className="absolute inset-0"
          >
            <img
              key={slideKey(slide, current)}
              data-testid="hero-slide-image"
              src={slide.image_url || slide.image_file}
              alt={slideTexts(slide, language).title}
              fetchpriority={carousel.isFirst(slide) ? 'high' : undefined}
              onError={() => carousel.markFailed(slide)}
              className="absolute inset-0 h-full w-full object-cover animate-in fade-in motion-reduce:animate-none"
              style={{ animationDuration: `${transitionMs}ms` }}
            />
            <div data-testid="hero-veil" aria-hidden="true" className="absolute inset-0 bg-black/50" />
          </div>
        )}

        <div className={cn('relative z-10 flex h-full flex-col items-center justify-center px-14 pb-16 pt-4 text-center text-white md:px-20', textShadow)}>
          <h1 className="mb-4 break-words text-3xl font-bold sm:text-4xl md:text-5xl lg:text-6xl">{t('home.hero.title')}</h1>
          {slide && (
            <StackedSlides
              testId="hero-slide-text"
              className="mb-6 max-w-2xl"
              items={usable}
              current={current}
              render={(item) => {
                const texts = slideTexts(item, language);
                return (
                  <>
                    {texts.title && <h2 className="mb-2 break-words text-xl font-semibold md:text-3xl">{texts.title}</h2>}
                    {texts.subtitle && <p className="text-lg md:text-xl">{texts.subtitle}</p>}
                  </>
                );
              }}
            />
          )}
          <Button
            size="lg"
            variant={theme.ctaStyle ? undefined : 'brand'}
            onClick={() => onNavigate('products')}
            className={cn('min-h-[44px] w-full px-8 py-3 text-lg [text-shadow:none] sm:w-auto', !slide && 'mt-4')}
            style={theme.ctaStyle}
          >
            <ShoppingBag className="mr-2 h-5 w-5" aria-hidden="true" />
            {t('home.hero.cta.products')}
          </Button>
        </div>

        {multiple && (
          <>
            <button type="button" className={cn(arrowClass, 'left-2 md:left-4')} aria-label={t('home.carousel.previous')} onClick={() => carousel.go(-1)}>
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
            <button type="button" className={cn(arrowClass, 'right-2 md:right-4')} aria-label={t('home.carousel.next')} onClick={() => carousel.go(1)}>
              <ChevronRight className="h-6 w-6" aria-hidden="true" />
            </button>
            <div className="absolute inset-x-0 bottom-4 z-20 flex items-center justify-center gap-3 px-4">
              <button
                type="button"
                className={cn(
                  'inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-black/40 text-white transition-colors hover:bg-black/60 motion-reduce:transition-none',
                  overlayRing
                )}
                aria-label={userPaused ? t('home.carousel.play') : t('home.carousel.pause')}
                onClick={carousel.togglePause}
              >
                {userPaused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
              </button>
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
                        'h-6 rounded-full border-2 border-white transition-all motion-reduce:transition-none',
                        overlayRing,
                        active ? 'w-8 bg-white' : 'w-6 bg-white/40'
                      )}
                    />
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export default ClassicHero;
