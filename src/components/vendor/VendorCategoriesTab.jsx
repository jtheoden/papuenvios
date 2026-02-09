import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit, Trash2, Plus, X, Save, Loader2, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { createCategory, updateCategory, deleteCategory } from '@/lib/productService';
import { useRealtimeCategories } from '@/hooks/useRealtimeSubscription';

/**
 * Vendor Categories Tab Component
 * Manages product categories with bilingual support
 */
const VendorCategoriesTab = ({ categories, onCategoriesChange, visualSettings }) => {
  const { t, language } = useLanguage();
  const { products, refreshCategories } = useBusiness();
  const { user } = useAuth();

  // Real-time subscription for category updates
  useRealtimeCategories({
    enabled: true,
    onUpdate: () => {
      if (refreshCategories) {
        refreshCategories();
      } else if (onCategoriesChange) {
        onCategoriesChange();
      }
    }
  });

  const [categoryForm, setCategoryForm] = useState({
    dbId: null,
    es: '',
    en: '',
    description_es: '',
    description_en: ''
  });
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);

  // Refs for form focus and scroll
  const categoryFormRef = useRef(null);
  const categoryNameInputRef = useRef(null);

  // Function to scroll and focus the form
  const scrollToFormAndFocus = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (categoryFormRef.current) {
          categoryFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setTimeout(() => {
          if (categoryNameInputRef.current) {
            categoryNameInputRef.current.focus();
          }
        }, 300);
      }, 50);
    });
  }, []);

  const handleCategorySubmit = async (e) => {
    e?.preventDefault?.();

    // Validation
    if (!categoryForm.es?.trim() || !categoryForm.en?.trim()) {
      toast({
        title: t('vendor.validation.error'),
        description: t('vendor.validation.fillFields'),
        variant: 'destructive'
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const performedBy = user?.email || user?.id || 'anonymous';

      if (categoryForm.dbId) {
        // Update existing category
        await updateCategory(categoryForm.dbId, categoryForm, performedBy);
        toast({
          title: language === 'es' ? 'Categoría actualizada' : 'Category updated',
          description: categoryForm.es
        });
      } else {
        // Create new category
        await createCategory(categoryForm, performedBy);
        toast({
          title: t('vendor.categoryAdded'),
          description: categoryForm.es
        });
      }

      // Refresh categories list immediately
      if (refreshCategories) {
        await refreshCategories();
      } else if (onCategoriesChange) {
        await onCategoriesChange();
      }

      setCategoryForm({
        dbId: null,
        es: '',
        en: '',
        description_es: '',
        description_en: ''
      });
      setShowCategoryForm(false);
    } catch (error) {
      console.error('[handleCategorySubmit] ERROR:', error);
      console.error('[handleCategorySubmit] Error details:', { message: error?.message, code: error?.code });
      toast({
        title: t('vendor.validation.error'),
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditCategory = (category) => {
    try {
      setCategoryForm({
        dbId: category.id,
        es: category.name_es || category.es || '',
        en: category.name_en || category.en || '',
        description_es: category.description_es || '',
        description_en: category.description_en || ''
      });
      setShowCategoryForm(true);
      // Scroll to form and focus after state update
      scrollToFormAndFocus();
    } catch (error) {
      console.error('[handleEditCategory] ERROR:', error);
      console.error('[handleEditCategory] Error details:', { message: error?.message, code: error?.code });
      throw error;
    }
  };

  const handleOpenNewCategoryForm = () => {
    setCategoryForm({
      dbId: null,
      es: '',
      en: '',
      description_es: '',
      description_en: ''
    });
    setShowCategoryForm(true);
    scrollToFormAndFocus();
  };

  const handleCloseCategoryForm = () => {
    setCategoryForm({
      dbId: null,
      es: '',
      en: '',
      description_es: '',
      description_en: ''
    });
    setShowCategoryForm(false);
  };

  const handleConfirmDelete = async (categoryId) => {
    setDeletingCategoryId(categoryId);
    setConfirmingDeleteId(null);
    try {
      const performedBy = user?.email || user?.id || 'anonymous';
      const result = await deleteCategory(categoryId, performedBy);

      toast({
        title: t('vendor.categoryRemoved'),
        description: result?.deletedCategory?.name
      });

      // Refresh categories list immediately
      if (refreshCategories) {
        await refreshCategories();
      } else if (onCategoriesChange) {
        await onCategoriesChange();
      }
    } catch (error) {
      console.error('[handleConfirmDelete] ERROR:', error);
      console.error('[handleConfirmDelete] Error details:', { message: error?.message, code: error?.code, context: error?.context });

      // Check if error is due to products using this category
      if (error?.context?.productNames) {
        toast({
          title: language === 'es' ? 'No se puede eliminar' : 'Cannot delete',
          description: error.message,
          variant: 'destructive'
        });
      } else {
        toast({
          title: t('vendor.validation.error'),
          description: error.message,
          variant: 'destructive'
        });
      }
    } finally {
      setDeletingCategoryId(null);
    }
  };

  const handleCancelDelete = () => {
    setConfirmingDeleteId(null);
  };

  return (
    <div className="space-y-6">
      {/* Create New Category Button - Show when form is hidden */}
      {!showCategoryForm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <Button
            onClick={handleOpenNewCategoryForm}
            className="w-full sm:w-auto"
            style={{
              backgroundColor: visualSettings.primaryColor || '#2563eb',
              color: 'white'
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {language === 'es' ? 'Nueva Categoría' : 'New Category'}
          </Button>
        </motion.div>
      )}

      {/* Category Form - Toggleable */}
      <AnimatePresence>
        {showCategoryForm && (
          <motion.div
            ref={categoryFormRef}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="glass-effect p-3 sm:p-8 rounded-2xl overflow-hidden"
          >
            <div className="flex justify-between items-center mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-2xl font-semibold">
                {categoryForm.dbId
                  ? (language === 'es' ? 'Editar Categoría' : 'Edit Category')
                  : (language === 'es' ? 'Nueva Categoría' : 'New Category')}
              </h2>
              <button
                onClick={handleCloseCategoryForm}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
              {/* Bilingual Name Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
                    {language === 'es' ? 'Nombre (Español) *' : 'Name (Spanish) *'}
                  </label>
                  <input
                    ref={categoryNameInputRef}
                    type="text"
                    value={categoryForm.es}
                    onChange={e => setCategoryForm({ ...categoryForm, es: e.target.value })}
                    className="input-style w-full text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
                    {language === 'es' ? 'Nombre (Inglés) *' : 'Name (English) *'}
                  </label>
                  <input
                    type="text"
                    value={categoryForm.en}
                    onChange={e => setCategoryForm({ ...categoryForm, en: e.target.value })}
                    className="input-style w-full text-sm"
                    required
                  />
                </div>
              </div>

              {/* Bilingual Description Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
                    {language === 'es' ? 'Descripción (Español)' : 'Description (Spanish)'}
                  </label>
                  <textarea
                    value={categoryForm.description_es}
                    onChange={e => setCategoryForm({ ...categoryForm, description_es: e.target.value })}
                    className="input-style w-full text-sm"
                    rows="2"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
                    {language === 'es' ? 'Descripción (Inglés)' : 'Description (English)'}
                  </label>
                  <textarea
                    value={categoryForm.description_en}
                    onChange={e => setCategoryForm({ ...categoryForm, description_en: e.target.value })}
                    className="input-style w-full text-sm"
                    rows="2"
                  />
                </div>
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex gap-2">
              <Button
                onClick={handleCategorySubmit}
                disabled={isSubmitting}
                className="text-sm"
                style={{
                  backgroundColor: visualSettings.primaryColor || '#2563eb',
                  color: 'white'
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" />
                    <span className="hidden sm:inline">{language === 'es' ? 'Guardando...' : 'Saving...'}</span>
                  </>
                ) : categoryForm.dbId ? (
                  <>
                    <Save className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{language === 'es' ? 'Actualizar' : 'Update'}</span>
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{language === 'es' ? 'Crear' : 'Create'}</span>
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleCloseCategoryForm}
                className="text-sm"
              >
                <X className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('common.cancel')}</span>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Categories List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h3 className="text-lg font-semibold mb-4">
          {language === 'es' ? 'Categorías Existentes' : 'Existing Categories'}
        </h3>

        {categories.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            {language === 'es' ? 'No hay categorías aún' : 'No categories yet'}
          </p>
        ) : (
          <ul className="space-y-2">
            {categories.map(c => {
              const isConfirming = confirmingDeleteId === c.id;
              const isDeleting = deletingCategoryId === c.id;
              const categoryName = language === 'es' ? (c.name_es || c.es) : (c.name_en || c.en);

              return (
                <li
                  key={c.id}
                  className={`flex justify-between items-center p-3 sm:p-4 rounded-lg transition-all duration-200 ${
                    isConfirming
                      ? 'bg-red-50 border-2 border-red-200'
                      : 'bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:gap-4 sm:items-center">
                      <span className="font-semibold text-sm sm:text-base truncate">{categoryName}</span>
                      <span className="text-gray-500 text-xs sm:text-sm">({c.slug})</span>
                    </div>
                    {(c.description_es || c.description_en) && (
                      <p className="text-xs sm:text-sm text-gray-600 mt-1 truncate">
                        {language === 'es' ? c.description_es : c.description_en}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 sm:gap-2 ml-2 sm:ml-4 flex-shrink-0">
                    <AnimatePresence mode="wait">
                      {isConfirming ? (
                        <motion.div
                          key="confirm-actions"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          className="flex items-center gap-1 sm:gap-2"
                        >
                          <span className="text-xs sm:text-sm text-red-600 font-medium flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="hidden xs:inline">{language === 'es' ? '¿Eliminar?' : 'Delete?'}</span>
                          </span>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleConfirmDelete(c.id)}
                            disabled={isDeleting}
                            className="h-7 sm:h-8 px-2 sm:px-3"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-1" />
                                <span className="hidden sm:inline">{language === 'es' ? 'Sí' : 'Yes'}</span>
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCancelDelete}
                            disabled={isDeleting}
                            className="h-7 sm:h-8 px-2 sm:px-3"
                          >
                            <X className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-1" />
                            <span className="hidden sm:inline">{language === 'es' ? 'No' : 'No'}</span>
                          </Button>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="default-actions"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          className="flex gap-0.5 sm:gap-1"
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditCategory(c)}
                            disabled={isDeleting}
                            className="h-8 w-8"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="icon"
                            onClick={() => setConfirmingDeleteId(c.id)}
                            disabled={isDeleting}
                            className="h-8 w-8"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </motion.div>
    </div>
  );
};

export default VendorCategoriesTab;
