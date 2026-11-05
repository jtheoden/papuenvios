import React from 'react';
import { ShoppingBag, Package, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { getHeadingStyle } from '@/lib/styleUtils';
import { buildHomeTheme } from '@/lib/homeTheme';
import { resolveHeroLayout } from '@/lib/heroLayout';
import HeroCarousel, { HeroCarouselSkeleton } from '@/components/home/HeroCarousel';
import CoverHero from '@/components/home/CoverHero';

// One width for the cards and the carousel, so the two blocks line up
const CONTENT_WIDTH = 'max-w-5xl';

// Hero cards (mockup): both use routes that already exist. "Combos" has no page of its own yet (S6/ND-4), so it opens products.
const HERO_CARDS = [
  { key: 'combos', icon: Package, route: 'products', variant: 'brand' },
  { key: 'remittances', icon: DollarSign, route: 'remittances', variant: 'brand-outline' },
];

/**
 * Presentational hero of the Home. The page owns the data (slides, loading flag, settings) and the navigation.
 * Layout = option A (mockup): centered title block, two cards, full-width carousel below; stacked on mobile.
 */
const HomeHero = ({ slides, loading, visualSettings, onNavigate }) => {
  const { t } = useLanguage();
  const theme = buildHomeTheme(visualSettings);
  const { legacy } = theme;
  const carouselEnabled = visualSettings.carouselEnabled !== false;
  // slides without an image cannot be shown (the admin may leave the URL empty)
  const usableSlides = slides.filter((slide) => slide.image_url || slide.image_file);
  const hasCarousel = carouselEnabled && (loading || usableSlides.length > 0);

  // The stored value is only compared against the closed list, never used as a class. Without slides to cover
  // the section there is nothing for `cover` to show, so it falls back to the spaced block.
  if (hasCarousel && resolveHeroLayout(visualSettings) === 'cover') {
    return <CoverHero slides={usableSlides} loading={loading} visualSettings={visualSettings} onNavigate={onNavigate} />;
  }

  return (
    <section data-testid="home-hero" className="px-4 pb-8 pt-[4.5rem] sm:pb-12 md:pt-12 lg:py-16">
      <div className="container mx-auto flex flex-col items-center gap-6 text-center md:gap-8">
        <div className="w-full max-w-3xl">
          <h1
            className="mb-4 break-words text-3xl font-bold sm:text-4xl lg:text-5xl"
            // legacy look: solid ink, because the stored gradient fails AA contrast on the page colour (2.98:1)
            style={legacy ? { color: theme.ink } : getHeadingStyle(visualSettings)}
          >
            {t('home.hero.title')}
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg md:text-xl" style={{ color: theme.muted }}>
            {t('home.hero.subtitle')}
          </p>
          <Button
            size="lg"
            variant={theme.ctaStyle ? undefined : 'brand'}
            onClick={() => onNavigate('products')}
            className="min-h-[44px] w-full px-8 py-3 text-lg sm:w-auto"
            style={theme.ctaStyle}
          >
            <ShoppingBag className="mr-2 h-5 w-5" aria-hidden="true" />
            {t('home.hero.cta.products')}
          </Button>
        </div>

        <div className={`grid w-full ${CONTENT_WIDTH} gap-4 md:grid-cols-2`}>
          {HERO_CARDS.map(({ key, icon: Icon, route, variant }) => (
            <div
              key={key}
              data-testid="hero-card"
              className="flex flex-col items-center gap-3 rounded-2xl border p-6"
              style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}
            >
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ backgroundColor: theme.softAccent, color: theme.ink }}
              >
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 className="break-words text-xl font-semibold" style={{ color: theme.ink }}>
                {t(`home.hero.cards.${key}.title`)}
              </h2>
              <p className="flex-1" style={{ color: theme.muted }}>
                {t(`home.hero.cards.${key}.description`)}
              </p>
              <Button variant={variant} className="min-h-[44px] w-full sm:w-auto" onClick={() => onNavigate(route)}>
                {t(`home.hero.cards.${key}.cta`)}
              </Button>
            </div>
          ))}
        </div>

        {hasCarousel && (
          <div className={`mx-auto w-full ${CONTENT_WIDTH}`}>
            {loading ? (
              <HeroCarouselSkeleton visualSettings={visualSettings} />
            ) : (
              <HeroCarousel slides={usableSlides} visualSettings={visualSettings} />
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default HomeHero;
