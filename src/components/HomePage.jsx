import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingBag, DollarSign, TrendingUp, Users, ChevronLeft, ChevronRight, Star, Gift,
  Package, Truck, CreditCard, Globe, BarChart3, Banknote, Heart, Zap, BookOpen, ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { getActiveCarouselSlides } from '@/lib/carouselService';
import { getPublications } from '@/lib/publicationService';
import { getTestimonials } from '@/lib/testimonialService';
import { getHeadingStyle } from '@/lib/styleUtils';
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription, useRealtimeCarouselSlides } from '@/hooks/useRealtimeSubscription';
import SkeletonCard from '@/components/ui/SkeletonCard';
import RegulatoryNotice from '@/components/RegulatoryNotice';
import HeroCarousel from '@/components/home/HeroCarousel';
import { buildHomeTheme } from '@/lib/homeTheme';

const COMPLETED_REMITTANCE_STATUSES = ['delivered', 'completed'];
const COMPLETED_ORDER_STATUS = 'completed';
const DEFAULT_START_YEAR = 2020;

const isCount = (value) => Number.isInteger(value) && value >= 0;

// Validates the get_public_landing_stats payload; returns null when it is unusable so the caller
// hides the counters instead of rendering misleading zeros.
const parseLandingStats = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const { users, remittances_completed: remittances, orders_completed: orders, first_year: firstYear } = payload;
  if (![users, remittances, orders].every(isCount)) return null;
  const startYear = Number.isInteger(firstYear) ? firstYear : DEFAULT_START_YEAR;
  return {
    users,
    remittancesCompleted: remittances,
    ordersCompleted: orders,
    years: Math.max(1, new Date().getFullYear() - startYear + 1)
  };
};

const HomePage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();
  const { isAdmin } = useAuth();
  const { currencySymbol } = useCurrency();
  const [carouselSlides, setCarouselSlides] = useState([]);
  const [carouselLoading, setCarouselLoading] = useState(true);
  const [dbTestimonials, setDbTestimonials] = useState([]);
  const [testimonialsLoading, setTestimonialsLoading] = useState(true);
  const [activeOffers, setActiveOffers] = useState([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [landingStats, setLandingStats] = useState(null);
  const [testimonialIndex, setTestimonialIndex] = useState(0);
  const [guideArticles, setGuideArticles] = useState([]);

  // Icon name → component mapping for dynamic features
  const ICON_MAP = {
    ShoppingBag, DollarSign, TrendingUp, Users, Package, Truck,
    CreditCard, Star, Gift, Globe, BarChart3, Banknote, Heart, Zap
  };

  // Read feature cards from visual settings (admin-customizable) with fallback to i18n defaults
  const features = (visualSettings.homeFeatures && visualSettings.homeFeatures.length > 0
    ? visualSettings.homeFeatures
        .filter(f => f.isActive)
        .filter(f => !f.adminOnly || isAdmin)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map(f => ({
          icon: ICON_MAP[f.icon] || ShoppingBag,
          title: language === 'es' ? f.titleEs : f.titleEn,
          description: language === 'es' ? f.descriptionEs : f.descriptionEn,
          action: () => onNavigate(f.navigateTo)
        }))
    : [
        { icon: ShoppingBag, title: t('home.features.products.title'), description: t('home.features.products.description'), action: () => onNavigate('products') },
        { icon: DollarSign, title: t('home.features.remittances.title'), description: t('home.features.remittances.description'), action: () => onNavigate('remittances') },
        ...(isAdmin ? [
          { icon: TrendingUp, title: t('home.features.analytics.title'), description: t('home.features.analytics.description'), action: () => onNavigate('dashboard') },
          { icon: Users, title: t('home.features.vendors.title'), description: t('home.features.vendors.description'), action: () => onNavigate('admin') }
        ] : [])
      ]
  );

  const [testimonialsError, setTestimonialsError] = useState(null);

  const updateCompletedCounts = useCallback((type, delta) => {
    if (!delta) return;

    setLandingStats(prev => {
      if (!prev) return prev;

      if (type === 'remittance') {
        const nextValue = Math.max(0, (prev.remittancesCompleted || 0) + delta);
        return { ...prev, remittancesCompleted: nextValue };
      }

      if (type === 'order') {
        const nextValue = Math.max(0, (prev.ordersCompleted || 0) + delta);
        return { ...prev, ordersCompleted: nextValue };
      }

      return prev;
    });
  }, []);

  const handleRemittanceRealtime = useCallback((payload) => {
    const wasCompleted = COMPLETED_REMITTANCE_STATUSES.includes(payload?.old?.status);
    const isCompleted = COMPLETED_REMITTANCE_STATUSES.includes(payload?.new?.status);

    if (payload.eventType === 'INSERT' && isCompleted) {
      updateCompletedCounts('remittance', 1);
      return;
    }

    if (payload.eventType === 'UPDATE') {
      if (!wasCompleted && isCompleted) {
        updateCompletedCounts('remittance', 1);
      } else if (wasCompleted && !isCompleted) {
        updateCompletedCounts('remittance', -1);
      }
      return;
    }

    if (payload.eventType === 'DELETE' && wasCompleted) {
      updateCompletedCounts('remittance', -1);
    }
  }, [updateCompletedCounts]);

  const handleOrderRealtime = useCallback((payload) => {
    const wasCompleted = payload?.old?.status === COMPLETED_ORDER_STATUS;
    const isCompleted = payload?.new?.status === COMPLETED_ORDER_STATUS;

    if (payload.eventType === 'INSERT' && isCompleted) {
      updateCompletedCounts('order', 1);
      return;
    }

    if (payload.eventType === 'UPDATE') {
      if (!wasCompleted && isCompleted) {
        updateCompletedCounts('order', 1);
      } else if (wasCompleted && !isCompleted) {
        updateCompletedCounts('order', -1);
      }
      return;
    }

    if (payload.eventType === 'DELETE' && wasCompleted) {
      updateCompletedCounts('order', -1);
    }
  }, [updateCompletedCounts]);

  // Load testimonials from database
  useEffect(() => {
    const loadTestimonials = async () => {
      try {
        const testimonials = await getTestimonials(false);
        setDbTestimonials(testimonials);
        setTestimonialsError(null);
      } catch (error) {
        console.error('Error loading testimonials:', error);
        setTestimonialsError(error);
        setDbTestimonials([]);
      } finally {
        setTestimonialsLoading(false);
      }
    };
    loadTestimonials();
  }, []);

  useEffect(() => {
    setTestimonialIndex(0);
  }, [dbTestimonials.length]);

  useEffect(() => {
    if (dbTestimonials.length > 1) {
      const timer = setInterval(() => {
        setTestimonialIndex(prev => (prev + 1) % dbTestimonials.length);
      }, 7000);
      return () => clearInterval(timer);
    }
  }, [dbTestimonials.length]);

  // Load carousel slides from database
  const loadCarouselSlides = useCallback(async () => {
    try {
      const slides = await getActiveCarouselSlides();
      setCarouselSlides(slides || []);
    } catch (error) {
      console.error('Error loading carousel slides:', error);
      setCarouselSlides([]);
    } finally {
      setCarouselLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCarouselSlides();
  }, [loadCarouselSlides]);

  // Realtime: reload carousel when slides change in admin
  useRealtimeCarouselSlides({
    onUpdate: () => loadCarouselSlides()
  });

  useEffect(() => {
    // Load guide articles for featured section
    const loadGuideArticles = async () => {
      try {
        const pubs = await getPublications();
        setGuideArticles(pubs.slice(0, 3));
      } catch (error) {
        console.error('Error loading guide articles:', error);
      }
    };
    loadGuideArticles();

    const fetchLandingData = async () => {
      try {
        const now = new Date();
        const [offersRes, statsRes] = await Promise.all([
          supabase.from('offers').select('*').eq('is_active', true),
          supabase.rpc('get_public_landing_stats').then(
            (res) => res,
            () => ({ data: null, error: true })
          )
        ]);

        const offersList = (offersRes.data || []).filter((offer) => {
          const starts = offer.start_date ? new Date(offer.start_date) <= now : true;
          const ends = offer.end_date ? new Date(offer.end_date) >= now : true;
          return starts && ends;
        });

        setActiveOffers(offersList);

        // On RPC failure keep whatever was already loaded; with nothing loaded the block stays hidden.
        const parsed = statsRes.error ? null : parseLandingStats(statsRes.data);
        if (parsed) setLandingStats(parsed);
      } catch (error) {
        console.error('Error loading offers and stats:', error);
        setActiveOffers([]);
      } finally {
        setOffersLoading(false);
      }
    };

    fetchLandingData();
  }, []);

  useRealtimeSubscription({
    table: 'remittances',
    event: '*',
    enabled: true,
    onInsert: handleRemittanceRealtime,
    onUpdate: handleRemittanceRealtime,
    onDelete: handleRemittanceRealtime
  });

  useRealtimeSubscription({
    table: 'orders',
    event: '*',
    enabled: true,
    onInsert: handleOrderRealtime,
    onUpdate: handleOrderRealtime,
    onDelete: handleOrderRealtime
  });

  // Carousel settings from admin-configurable visual settings (autoplay and pauses live in HeroCarousel)
  const carouselEnabled = visualSettings.carouselEnabled !== false;
  const theme = buildHomeTheme(visualSettings);
  const { legacy } = theme;
  const hasCarousel = carouselEnabled && (carouselLoading || carouselSlides.length > 0);

  // Hero cards (mockup): both use routes that already exist. "Combos" has no page of its own yet (S6/ND-4), so it opens products.
  const heroCards = [
    { key: 'combos', icon: Package, route: 'products', variant: 'brand' },
    { key: 'remittances', icon: DollarSign, route: 'remittances', variant: 'brand-outline' }
  ];

  return (
    <div
      data-testid="home-page"
      className="min-h-screen"
      // the shadow paints the same colour over the 1rem gap between the 4rem header and the 5rem top padding of <main>
      style={theme.pageBg ? { ...theme.vars, backgroundColor: theme.pageBg, boxShadow: `0 -1rem 0 0 ${theme.pageBg}` } : theme.vars}
    >
      {/* Layout = option A (mockup): centered title block, two cards, full-width carousel below; stacked on mobile. */}
      <section data-testid="home-hero" className="px-4 py-8 sm:py-12 lg:py-16">
        <div className="container mx-auto flex flex-col items-center gap-8 text-center">
          <div className="w-full max-w-3xl">
            <h1
              className="mb-4 break-words text-3xl font-bold sm:text-4xl lg:text-5xl"
              style={getHeadingStyle(visualSettings)}
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

          <div className="grid w-full max-w-4xl gap-4 md:grid-cols-2">
            {heroCards.map(({ key, icon: Icon, route, variant }) => (
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
            <div className="mx-auto w-full max-w-5xl">
              {carouselLoading ? (
                <SkeletonCard variant="carousel" />
              ) : (
                <HeroCarousel slides={carouselSlides} visualSettings={visualSettings} />
              )}
            </div>
          )}
        </div>
      </section>

      <RegulatoryNotice variant="strip" onNavigate={onNavigate} />

      <section className="py-16 px-4 bg-white">
        <div className="container mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
            <div>
              <h2 className="text-2xl sm:text-3xl break-words font-bold" style={getHeadingStyle(visualSettings)}>
                {t('home.offers.title')}
              </h2>
              <p className="text-gray-600 mt-2">{t('home.offers.subtitle')}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => onNavigate('products')} variant="outline">
                <Gift className="w-4 h-4 mr-2" />
                {t('home.offers.cta')}
              </Button>
              {isAdmin && (
                <Button variant="brand" onClick={() => onNavigate('dashboard')}>
                  {t('home.offers.manage')}
                </Button>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {offersLoading ? (
              <>
                <SkeletonCard variant="stats" />
                <SkeletonCard variant="stats" />
                <SkeletonCard variant="stats" />
              </>
            ) : activeOffers.length > 0 ? (
              activeOffers.map((offer, idx) => (
                <motion.div
                  key={offer.id || idx}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="glass-effect p-6 rounded-2xl shadow-sm"
                  style={{ border: `1px solid ${legacy ? `${visualSettings.accentColor || '#9333ea'}30` : theme.border}` }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-semibold"
                      style={legacy ? {
                        backgroundColor: `${visualSettings.accentColor || '#9333ea'}20`,
                        color: visualSettings.accentColor || '#9333ea'
                      } : { backgroundColor: theme.softAccent, color: theme.ink }}
                    >{offer.discount_type === 'percentage' ? `${offer.discount_value}% OFF` : `${currencySymbol}${offer.discount_value}`}</span>
                    <span className="text-xs text-gray-500">{offer.code}</span>
                  </div>
                  <p className="text-gray-700 text-sm mb-3">{t('home.offers.availableUntil', { date: offer.end_date ? new Date(offer.end_date).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US') : t('home.offers.limited') })}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">{t('home.offers.usage')}</p>
                      <p className="font-semibold">{offer.max_usage_global || t('home.offers.unlimited')}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={legacy ? undefined : 'brand-outline'}
                      onClick={() => navigator.clipboard.writeText(offer.code)}
                      style={legacy ? {
                        backgroundColor: `${visualSettings.primaryColor || '#2563eb'}15`,
                        color: visualSettings.primaryColor || '#2563eb'
                      } : undefined}
                    >
                      {t('home.offers.copy')}
                    </Button>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="col-span-full text-center text-gray-500">
                {t('home.offers.empty')}
              </div>
            )}
          </div>
        </div>
      </section>

      {landingStats && (
        <section className={`py-16 px-4 ${legacy ? 'bg-slate-50' : ''}`}>
          <div className="container mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-center mb-12"
            >
              <h2 className="text-2xl sm:text-4xl break-words font-bold mb-3" style={getHeadingStyle(visualSettings)}>
                {t('home.stats.title')}
              </h2>
              <p className="text-gray-600">{t('home.stats.subtitle')}</p>
            </motion.div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[{
                label: t('home.stats.remittances'),
                value: landingStats.remittancesCompleted,
                color: 'from-emerald-500 to-green-600'
              }, {
                label: t('home.stats.orders'),
                value: landingStats.ordersCompleted,
                color: 'from-blue-500 to-cyan-600'
              }, {
                label: t('home.stats.users'),
                value: landingStats.users,
                color: 'from-purple-500 to-indigo-600'
              }, {
                label: t('home.stats.years'),
                value: landingStats.years,
                color: 'from-orange-500 to-amber-600'
              }].map((stat, idx) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="p-6 rounded-2xl bg-white shadow-sm border border-gray-100"
                >
                  <div
                    className={`w-12 h-12 rounded-xl ${legacy ? `bg-gradient-to-r ${stat.color} text-white` : ''} flex items-center justify-center mb-4 text-xl font-bold`}
                    style={legacy ? undefined : { backgroundColor: theme.buttonBg, color: theme.buttonText }}
                  >
                    {stat.value}
                  </div>
                  <p className="text-gray-700 font-semibold">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-20 px-4">
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <h2
              className="text-2xl sm:text-4xl break-words font-bold mb-4"
              style={getHeadingStyle(visualSettings)}
            >
              {t('home.features.title')}
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              {t('home.features.subtitle')}
            </p>
          </motion.div>

          <div className={`grid md:grid-cols-2 ${features.length <= 2 ? 'lg:grid-cols-2' : features.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-8`}>
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="glass-effect p-6 rounded-2xl hover-lift cursor-pointer group"
                onClick={feature.action}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"
                  style={legacy
                    ? { background: `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})` }
                    : { backgroundColor: theme.buttonBg }}
                >
                  <feature.icon className={`w-6 h-6 ${legacy ? 'text-white' : ''}`} style={legacy ? undefined : { color: theme.buttonText }} />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Blog Section */}
      {guideArticles.length > 0 && (
        <section className="py-16 px-4 bg-white">
          <div className="container mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-center mb-10"
            >
              <h2 className="text-2xl sm:text-4xl break-words font-bold mb-3" style={getHeadingStyle(visualSettings)}>
                {t('home.blog.title')}
              </h2>
              <p className="text-gray-600 text-lg">{t('home.blog.subtitle')}</p>
            </motion.div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {guideArticles.map((pub, idx) => {
                const title = language === 'es' ? pub.title_es : pub.title_en;
                const content = language === 'es' ? pub.content_es : pub.content_en;
                const preview = content ? content.substring(0, 100) + (content.length > 100 ? '...' : '') : '';

                return (
                  <motion.div
                    key={pub.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className="glass-effect rounded-2xl overflow-hidden hover-lift cursor-pointer group"
                    onClick={() => onNavigate('blog')}
                  >
                    <div className="h-36 overflow-hidden">
                      {pub.cover_image_url ? (
                        <img
                          src={pub.cover_image_url}
                          alt={title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center"
                          style={legacy
                            ? { background: `linear-gradient(135deg, ${visualSettings.primaryColor || '#2563eb'}30, ${visualSettings.secondaryColor || '#9333ea'}30)` }
                            : { backgroundColor: theme.softAccent }}
                        >
                          <BookOpen className="h-8 w-8 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="p-5">
                      <h3 className="font-semibold text-lg mb-2 line-clamp-2">{title}</h3>
                      <p className="text-sm text-gray-500 line-clamp-2">{preview}</p>
                      <span
                        className="inline-flex items-center gap-1 mt-3 text-sm font-medium"
                        style={{ color: legacy ? visualSettings.primaryColor || '#2563eb' : theme.ink }}
                      >
                        {t('blog.readMore')} <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <div className="text-center">
              <Button
                variant="outline"
                onClick={() => onNavigate('blog')}
                className="px-6"
              >
                <BookOpen className="w-4 h-4 mr-2" />
                {t('home.blog.viewAll')}
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className={`py-20 px-4 ${legacy ? 'bg-slate-100/50' : ''}`}>
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h2
              className="text-2xl sm:text-4xl break-words font-bold mb-4"
              style={getHeadingStyle(visualSettings)}
            >
              {t('home.testimonials.title')}
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              {t('home.testimonials.subtitle')}
            </p>
          </motion.div>

          {testimonialsLoading ? (
            <div className="max-w-4xl mx-auto">
              <SkeletonCard variant="testimonial" />
            </div>
          ) : dbTestimonials.length > 0 ? (
            <div className="relative max-w-4xl mx-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={dbTestimonials[testimonialIndex]?.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.4 }}
                  className="glass-effect p-8 rounded-2xl"
                >
                  <div className="flex items-center mb-4">
                    <img
                      className="w-14 h-14 rounded-full mr-4 object-cover"
                      alt={dbTestimonials[testimonialIndex]?.user_name || 'User'}
                      src={dbTestimonials[testimonialIndex]?.user_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(dbTestimonials[testimonialIndex]?.user_name || 'U')}&background=random`}
                    />
                    <div>
                      <p className="font-semibold">{dbTestimonials[testimonialIndex]?.user_name}</p>
                      <div className="flex">
                        {[...Array(dbTestimonials[testimonialIndex]?.rating || 0)].map((_, i) => (
                          <Star key={i} className="w-4 h-4 text-yellow-400 fill-current" />
                        ))}
                        {[...Array(Math.max(0, 5 - (dbTestimonials[testimonialIndex]?.rating || 0)))].map((_, i) => (
                          <Star key={i} className="w-4 h-4 text-gray-300" />
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-700 italic text-lg">"{dbTestimonials[testimonialIndex]?.comment}"</p>
                </motion.div>
              </AnimatePresence>
              {dbTestimonials.length > 1 && (
                <div className="flex justify-between mt-6">
                  <button
                    onClick={() => setTestimonialIndex(prev => (prev === 0 ? dbTestimonials.length - 1 : prev - 1))}
                    className="px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-100"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setTestimonialIndex(prev => (prev + 1) % dbTestimonials.length)}
                    className="px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-100"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 col-span-full text-center">
              {language === 'es' ? 'Aún no hay testimonios disponibles' : 'No testimonials available yet'}
            </p>
          )}
        </div>
      </section>
    </div>
  );
};

export default HomePage;
