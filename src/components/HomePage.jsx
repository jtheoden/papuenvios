import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, DollarSign, TrendingUp, Users, ChevronLeft, ChevronRight, Star, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { getActiveCarouselSlides } from '@/lib/carouselService';
import { getTestimonials } from '@/lib/testimonialService';
import { getHeadingStyle } from '@/lib/styleUtils';
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import SkeletonCard from '@/components/ui/SkeletonCard';

const COMPLETED_REMITTANCE_STATUSES = ['delivered', 'completed'];
const COMPLETED_ORDER_STATUS = 'completed';

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
  const [landingStats, setLandingStats] = useState({
    users: 0,
    remittancesCompleted: 0,
    ordersCompleted: 0,
    years: 1
  });
  const [testimonialIndex, setTestimonialIndex] = useState(0);

  const features = [
    {
      icon: ShoppingBag,
      title: t('home.features.products.title'),
      description: t('home.features.products.description'),
      action: () => onNavigate('products')
    },
    {
      icon: DollarSign,
      title: t('home.features.remittances.title'),
      description: t('home.features.remittances.description'),
      action: () => onNavigate('remittances')
    },
    {
      icon: TrendingUp,
      title: t('home.features.analytics.title'),
      description: t('home.features.analytics.description'),
      action: () => onNavigate('dashboard'),
      admin: true
    },
    {
      icon: Users,
      title: t('home.features.vendors.title'),
      description: t('home.features.vendors.description'),
      action: () => onNavigate('admin'),
      admin: true
    }
  ].filter(f => !f.admin || isAdmin);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [testimonialsError, setTestimonialsError] = useState(null);

  const updateCompletedCounts = useCallback((type, delta) => {
    if (!delta) return;

    setLandingStats(prev => {
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
  useEffect(() => {
    const loadSlides = async () => {
      try {
        const slides = await getActiveCarouselSlides();
        setCarouselSlides(slides || []);
      } catch (error) {
        console.error('Error loading carousel slides:', error);
        // Fallback to empty array if database fails
        setCarouselSlides([]);
      } finally {
        setCarouselLoading(false);
      }
    };
    loadSlides();
  }, []);

  useEffect(() => {
    const fetchLandingData = async () => {
      try {
        const now = new Date();
        const [offersRes, usersRes, remittancesRes, ordersRes] = await Promise.all([
          supabase.from('offers').select('*').eq('is_active', true),
          supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
          supabase.from('remittances').select('id, status, created_at'),
          supabase.from('orders').select('id, status, created_at')
        ]);

        const offersList = (offersRes.data || []).filter((offer) => {
          const starts = offer.start_date ? new Date(offer.start_date) <= now : true;
          const ends = offer.end_date ? new Date(offer.end_date) >= now : true;
          return starts && ends;
        });

        setActiveOffers(offersList);

        const remittances = remittancesRes.data || [];
        const orders = ordersRes.data || [];

        const completedRemittances = remittances.filter(r => COMPLETED_REMITTANCE_STATUSES.includes(r.status)).length;
        const completedOrders = orders.filter(o => o.status === COMPLETED_ORDER_STATUS).length;

        const earliestRemittance = remittances.reduce((earliestItem, current) => {
          if (!current.created_at) return earliestItem;
          if (!earliestItem) return current;
          return new Date(current.created_at) < new Date(earliestItem.created_at) ? current : earliestItem;
        }, null);

        const earliestOrder = orders.reduce((earliestItem, current) => {
          if (!current.created_at) return earliestItem;
          if (!earliestItem) return current;
          return new Date(current.created_at) < new Date(earliestItem.created_at) ? current : earliestItem;
        }, null);

        const earliestDate = [earliestRemittance?.created_at, earliestOrder?.created_at]
          .filter(Boolean)
          .map(date => new Date(date))
          .sort((a, b) => a - b)[0];

        const startYear = earliestDate ? earliestDate.getFullYear() : 2020;
        const years = Math.max(1, new Date().getFullYear() - startYear + 1);

        setLandingStats({
          users: usersRes.count || 0,
          remittancesCompleted: completedRemittances,
          ordersCompleted: completedOrders,
          years
        });
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

  const nextSlide = () => {
    setCurrentSlide(prev => (prev === carouselSlides.length - 1 ? 0 : prev + 1));
  };

  const prevSlide = () => {
    setCurrentSlide(prev => (prev === 0 ? carouselSlides.length - 1 : prev - 1));
  };

  useEffect(() => {
    if (carouselSlides.length > 1) {
      const slideInterval = setInterval(nextSlide, 5000);
      return () => clearInterval(slideInterval);
    }
  }, [carouselSlides.length]);

  return (
    <div className="min-h-screen">
      <section className="relative h-[60vh] md:h-[80vh] w-full overflow-hidden">
        {carouselLoading ? (
          <div className="absolute inset-0">
            <SkeletonCard variant="carousel" />
          </div>
        ) : carouselSlides.length > 0 ? (
          <>
            <AnimatePresence initial={false}>
              <motion.div
                key={currentSlide}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1 }}
                style={{ backgroundImage: `url(${carouselSlides[currentSlide]?.image_url || carouselSlides[currentSlide]?.image_file})` }}
                className="absolute inset-0 bg-cover bg-center"
              >
                <div className="absolute inset-0 bg-black/50" />
              </motion.div>
            </AnimatePresence>

            <div className="relative z-10 flex flex-col items-center justify-center h-full text-center text-white p-4">
              <motion.h1
                key={`main-${currentSlide}`}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="text-4xl md:text-6xl font-bold mb-4"
              >
                {language === 'es' ? carouselSlides[currentSlide]?.title_es : carouselSlides[currentSlide]?.title_en}
              </motion.h1>
              <motion.p
                key={`secondary-${currentSlide}`}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="text-lg md:text-xl max-w-2xl mx-auto mb-8"
              >
                {language === 'es' ? carouselSlides[currentSlide]?.subtitle_es : carouselSlides[currentSlide]?.subtitle_en}
              </motion.p>
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.6 }}
                className="flex flex-col sm:flex-row gap-4 justify-center"
              >
                <Button
                  size="lg"
                  onClick={() => onNavigate('products')}
                  className="px-8 py-3 text-lg"
                  style={{
                    background: visualSettings.useGradient
                      ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                      : visualSettings.buttonBgColor || '#2563eb',
                    color: visualSettings.buttonTextColor || '#ffffff',
                    border: 'none'
                  }}
                >
                  <ShoppingBag className="w-5 h-5 mr-2" />
                  {t('home.hero.cta.products')}
                </Button>
              </motion.div>
            </div>

            {carouselSlides.length > 1 && (
              <>
                <button onClick={prevSlide} className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2 bg-white/20 rounded-full hover:bg-white/40 transition-colors">
                  <ChevronLeft className="h-6 w-6 text-white" />
                </button>
                <button onClick={nextSlide} className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2 bg-white/20 rounded-full hover:bg-white/40 transition-colors">
                  <ChevronRight className="h-6 w-6 text-white" />
                </button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-2">
                  {carouselSlides.map((_, index) => (
                    <div
                      key={index}
                      onClick={() => setCurrentSlide(index)}
                      className={`w-3 h-3 rounded-full cursor-pointer transition-colors ${currentSlide === index ? 'bg-white' : 'bg-white/50'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              background: visualSettings.useGradient
                ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                : visualSettings.primaryColor || '#2563eb'
            }}
          >
            <div className="text-center text-white p-4">
              <h1 className="text-4xl md:text-6xl font-bold mb-4">{t('home.hero.title')}</h1>
              <p className="text-lg md:text-xl max-w-2xl mx-auto mb-8">{t('home.hero.subtitle')}</p>
              <Button
                size="lg"
                onClick={() => onNavigate('products')}
                className="px-8 py-3 text-lg"
                style={{
                  backgroundColor: visualSettings.cardBgColor || '#ffffff',
                  color: visualSettings.primaryColor || '#2563eb',
                  border: 'none'
                }}
              >
                <ShoppingBag className="w-5 h-5 mr-2" />
                {t('home.hero.cta.products')}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="py-16 px-4 bg-white">
        <div className="container mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
            <div>
              <h2 className="text-3xl font-bold" style={getHeadingStyle(visualSettings)}>
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
                <Button
                  onClick={() => onNavigate('dashboard')}
                  style={{
                    backgroundColor: visualSettings.buttonBgColor || visualSettings.primaryColor || '#2563eb',
                    color: visualSettings.buttonTextColor || '#ffffff'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = visualSettings.buttonHoverBgColor || '#1d4ed8';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = visualSettings.buttonBgColor || visualSettings.primaryColor || '#2563eb';
                  }}
                >
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
                  style={{ border: `1px solid ${visualSettings.accentColor || '#9333ea'}30` }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-semibold"
                      style={{
                        backgroundColor: `${visualSettings.accentColor || '#9333ea'}20`,
                        color: visualSettings.accentColor || '#9333ea'
                      }}
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
                      onClick={() => navigator.clipboard.writeText(offer.code)}
                      style={{
                        backgroundColor: `${visualSettings.primaryColor || '#2563eb'}15`,
                        color: visualSettings.primaryColor || '#2563eb'
                      }}
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

      <section className="py-16 px-4 bg-slate-50">
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <h2 className="text-4xl font-bold mb-3" style={getHeadingStyle(visualSettings)}>
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
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-r ${stat.color} flex items-center justify-center mb-4 text-white text-xl font-bold`}>
                  {stat.value}
                </div>
                <p className="text-gray-700 font-semibold">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4">
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <h2
              className="text-4xl font-bold mb-4"
              style={getHeadingStyle(visualSettings)}
            >
              {t('home.features.title')}
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              {t('home.features.subtitle')}
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
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
                  style={{
                    background: visualSettings.useGradient
                      ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                      : visualSettings.primaryColor || '#2563eb'
                  }}
                >
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 bg-slate-100/50">
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h2
              className="text-4xl font-bold mb-4"
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
