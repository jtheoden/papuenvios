import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, DollarSign, TrendingUp, Users, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { getActiveCarouselSlides } from '@/lib/carouselService';
import { getTestimonials } from '@/lib/testimonialService';
import { getHeadingStyle } from '@/lib/styleUtils';

const HomePage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();
  const { isAdmin } = useAuth();
  const [carouselSlides, setCarouselSlides] = useState([]);
  const [dbTestimonials, setDbTestimonials] = useState([]);

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
      }
    };
    loadTestimonials();
  }, []);

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
      }
    };
    loadSlides();
  }, []);

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
        {carouselSlides.length > 0 ? (
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
            className="text-center mb-16"
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
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {dbTestimonials.length > 0 ? (
              dbTestimonials.map((testimonial) => (
                <motion.div
                  key={testimonial.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="glass-effect p-6 rounded-2xl"
                >
                  {/* SECURITY: Only displays public author info (avatar + name)
                      Sensitive user data (email, phone, address, etc.) is never exposed */}
                  <div className="flex items-center mb-4">
                    <img
                      className="w-12 h-12 rounded-full mr-4 object-cover"
                      alt={testimonial.user_name || 'User'}
                      src={testimonial.user_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(testimonial.user_name || 'U')}&background=random`}
                    />
                    <div>
                      <p className="font-semibold">{testimonial.user_name}</p>
                      <div className="flex">
                        {[...Array(testimonial.rating)].map((_, i) => (
                          <Star key={i} className="w-4 h-4 text-yellow-400 fill-current" />
                        ))}
                        {[...Array(5 - testimonial.rating)].map((_, i) => (
                          <Star key={i} className="w-4 h-4 text-gray-300" />
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-600 italic">"{testimonial.comment}"</p>
                </motion.div>
              ))
            ) : (
              <p className="text-gray-500 col-span-full text-center">
                {language === 'es' ? 'Aún no hay testimonios disponibles' : 'No testimonials available yet'}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;