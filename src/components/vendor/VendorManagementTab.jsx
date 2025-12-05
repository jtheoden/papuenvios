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
    try {
      const { error } = await toggleTestimonialVisibility(id, !currentVisibility);
      if (error) throw error;

      toast({
        title: language === 'es' ? 'Actualizado' : 'Updated',
        description: language === 'es'
          ? `Testimonio ${!currentVisibility ? 'visible' : 'oculto'}`
          : `Testimonial ${!currentVisibility ? 'visible' : 'hidden'}`
      });

      await onTestimonialsRefresh(true);
    } catch (error) {
      console.error('Error toggling testimonial visibility:', error);
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
    try {
      const { error } = await toggleTestimonialVerification(id, !currentFeatured);
      if (error) throw error;

      toast({
        title: language === 'es' ? 'Actualizado' : 'Updated',
        description: language === 'es'
          ? `Testimonio ${!currentFeatured ? 'destacado' : 'normal'}`
          : `Testimonial ${!currentFeatured ? 'featured' : 'unfeatured'}`
      });

      await onTestimonialsRefresh(true);
    } catch (error) {
      console.error('Error toggling testimonial featured status:', error);
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
                className="flex justify-between items-center p-3 border-b hover:bg-gray-50 transition-colors"
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
                      <div className="flex items-center gap-2">
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
                <div className="flex gap-2 ml-4">
                  <Button
                    size="sm"
                    variant={testimonial.is_featured ? "default" : "outline"}
                    onClick={() => handleToggleTestimonialFeatured(testimonial.id, testimonial.is_featured)}
                    title={language === 'es' ? 'Destacar/Quitar destaque' : 'Feature/Unfeature'}
                  >
                    {testimonial.is_featured ? (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        {language === 'es' ? 'Destacado' : 'Featured'}
                      </>
                    ) : (
                      <>
                        <X className="mr-2 h-4 w-4" />
                        {language === 'es' ? 'Normal' : 'Normal'}
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant={testimonial.is_visible ? "default" : "outline"}
                    onClick={() => handleToggleTestimonialVisibility(testimonial.id, testimonial.is_visible)}
                  >
                    {testimonial.is_visible ? (
                      <>
                        <Eye className="mr-2 h-4 w-4" />
                        {t('vendor.management.hide')}
                      </>
                    ) : (
                      <>
                        <EyeOff className="mr-2 h-4 w-4" />
                        {t('vendor.management.show')}
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
