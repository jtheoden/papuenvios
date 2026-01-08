import React from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { toggleTestimonialVisibility, toggleTestimonialVerification } from '@/lib/testimonialService';

/**
 * Vendor Management Tab Component
 * Manages testimonials with visibility and featured status
 */
const VendorManagementTab = ({ testimonials, onTestimonialsRefresh }) => {
  const { t, language } = useLanguage();

  const handleToggleTestimonialVisibility = async (id, currentVisibility) => {
    console.log('[handleToggleTestimonialVisibility] START - Input:', { id, currentVisibility, newVisibility: !currentVisibility });
    try {
      console.log('[handleToggleTestimonialVisibility] Toggling visibility...');
      const { error } = await toggleTestimonialVisibility(id, !currentVisibility);
      if (error) {
        console.error('[handleToggleTestimonialVisibility] Service returned error:', error);
        throw error;
      }

      console.log('[handleToggleTestimonialVisibility] SUCCESS - Visibility toggled');
      toast({
        title: language === 'es' ? 'Actualizado' : 'Updated',
        description: language === 'es'
          ? `Testimonio ${!currentVisibility ? 'visible' : 'oculto'}`
          : `Testimonial ${!currentVisibility ? 'visible' : 'hidden'}`
      });

      console.log('[handleToggleTestimonialVisibility] Refreshing testimonials list...');
      await onTestimonialsRefresh(true);
      console.log('[handleToggleTestimonialVisibility] Testimonials refreshed');
    } catch (error) {
      console.error('[handleToggleTestimonialVisibility] ERROR:', error);
      console.error('[handleToggleTestimonialVisibility] Error details:', { message: error?.message, code: error?.code });
      toast({
        title: 'Error',
        description: error.message || (language === 'es'
          ? 'Error al actualizar testimonio'
          : 'Error updating testimonial'),
        variant: 'destructive'
      });
    }
  };

  const handleToggleTestimonialFeatured = async (id, currentFeatured) => {
    console.log('[handleToggleTestimonialFeatured] START - Input:', { id, currentFeatured, newFeatured: !currentFeatured });
    try {
      console.log('[handleToggleTestimonialFeatured] Toggling featured status...');
      const { error } = await toggleTestimonialVerification(id, !currentFeatured);
      if (error) {
        console.error('[handleToggleTestimonialFeatured] Service returned error:', error);
        throw error;
      }

      console.log('[handleToggleTestimonialFeatured] SUCCESS - Featured status toggled');
      toast({
        title: language === 'es' ? 'Actualizado' : 'Updated',
        description: language === 'es'
          ? `Testimonio ${!currentFeatured ? 'destacado' : 'normal'}`
          : `Testimonial ${!currentFeatured ? 'featured' : 'unfeatured'}`
      });

      console.log('[handleToggleTestimonialFeatured] Refreshing testimonials list...');
      await onTestimonialsRefresh(true);
      console.log('[handleToggleTestimonialFeatured] Testimonials refreshed');
    } catch (error) {
      console.error('[handleToggleTestimonialFeatured] ERROR:', error);
      console.error('[handleToggleTestimonialFeatured] Error details:', { message: error?.message, code: error?.code });
      toast({
        title: 'Error',
        description: error.message || (language === 'es'
          ? 'Error al destacar testimonio'
          : 'Error featuring testimonial'),
        variant: 'destructive'
      });
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div>
        <h2 className="text-2xl font-semibold mb-4">
          {t('vendor.management.testimonials')}
        </h2>
        <div className="glass-effect p-4 rounded-lg space-y-2">
          {testimonials.length === 0 ? (
            <p className="text-gray-500 text-center py-4">
              {language === 'es' ? 'No hay testimonios aún' : 'No testimonials yet'}
            </p>
          ) : (
            testimonials.map(testimonial => (
              <div
                key={testimonial.id}
                className="flex flex-col sm:flex-row sm:justify-between sm:items-center p-3 border-b hover:bg-gray-50 transition-colors gap-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    {/* Author Avatar */}
                    {(testimonial.user_avatar || testimonial.user_photo) && (
                      <img
                        src={testimonial.user_avatar || testimonial.user_photo}
                        alt={testimonial.user_name || 'User'}
                        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900">
                          {testimonial.user_name || 'Usuario'}
                        </p>
                        {testimonial.is_featured && (
                          <Check
                            className="w-4 h-4 text-purple-500"
                            title={language === 'es' ? 'Destacado' : 'Featured'}
                          />
                        )}
                        <span className="text-yellow-500">
                          {'★'.repeat(testimonial.rating)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm italic text-gray-600">
                    "{testimonial.comment}"
                  </p>
                </div>
                <div className="flex gap-2 sm:ml-4 flex-shrink-0">
                  <Button
                    size="sm"
                    className="h-8 px-2 sm:px-3"
                    variant={testimonial.is_featured ? "default" : "outline"}
                    onClick={() => handleToggleTestimonialFeatured(testimonial.id, testimonial.is_featured)}
                    title={language === 'es' ? 'Destacar/Quitar destaque' : 'Feature/Unfeature'}
                  >
                    {testimonial.is_featured ? (
                      <>
                        <Check className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">{language === 'es' ? 'Destacado' : 'Featured'}</span>
                      </>
                    ) : (
                      <>
                        <X className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">{language === 'es' ? 'Normal' : 'Normal'}</span>
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 px-2 sm:px-3"
                    variant={testimonial.is_visible ? "default" : "outline"}
                    onClick={() => handleToggleTestimonialVisibility(testimonial.id, testimonial.is_visible)}
                    title={testimonial.is_visible ? t('vendor.management.hide') : t('vendor.management.show')}
                  >
                    {testimonial.is_visible ? (
                      <>
                        <Eye className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">{t('vendor.management.hide')}</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">{t('vendor.management.show')}</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default VendorManagementTab;
