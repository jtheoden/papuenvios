import React, { useState } from 'react';
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
      console.log('[VendorCategoriesTab] Categories realtime update detected');
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);

  const handleCategorySubmit = async (e) => {
    console.log('[handleCategorySubmit] START - Input:', { categoryForm, hasId: !!categoryForm.dbId });
    e?.preventDefault?.();

    // Validation
    if (!categoryForm.es?.trim() || !categoryForm.en?.trim()) {
      console.log('[handleCategorySubmit] VALIDATION ERROR - Missing required fields');
      toast({
        title: t('vendor.validation.error'),
        description: t('vendor.validation.fillFields'),
        variant: 'destructive'
      });
      return;
    }

    setIsSubmitting(true);
    try {
      console.log('[handleCategorySubmit] Validation passed, processing submission...');
      const performedBy = user?.email || user?.id || 'anonymous';

      if (categoryForm.dbId) {
        // Update existing category
        await updateCategory(categoryForm.dbId, categoryForm, performedBy);
        console.log('[handleCategorySubmit] SUCCESS - Category updated');
        toast({
          title: language === 'es' ? 'Categoría actualizada' : 'Category updated',
          description: categoryForm.es
        });
      } else {
        // Create new category
        await createCategory(categoryForm, performedBy);
        console.log('[handleCategorySubmit] SUCCESS - Category created');
        toast({
          title: t('vendor.categoryAdded'),
          description: categoryForm.es
        });
      }

      setCategoryForm({
        dbId: null,
        es: '',
        en: '',
        description_es: '',
        description_en: ''
      });
      console.log('[handleCategorySubmit] Form reset complete');
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
    console.log('[handleEditCategory] START - Input:', { categoryId: category.id, categoryName: category.name_es || category.es });
    try {
      setCategoryForm({
        dbId: category.id,
        es: category.name_es || category.es || '',
        en: category.name_en || category.en || '',
        description_es: category.description_es || '',
        description_en: category.description_en || ''
      });
      console.log('[handleEditCategory] SUCCESS - Form populated for editing');
    } catch (error) {
      console.error('[handleEditCategory] ERROR:', error);
      console.error('[handleEditCategory] Error details:', { message: error?.message, code: error?.code });
      throw error;
    }
  };

  const handleConfirmDelete = async (categoryId) => {
    console.log('[handleConfirmDelete] START - Input:', { categoryId });
    setDeletingCategoryId(categoryId);
    setConfirmingDeleteId(null);
    try {
      const performedBy = user?.email || user?.id || 'anonymous';
      const result = await deleteCategory(categoryId, performedBy);

      console.log('[handleConfirmDelete] SUCCESS - Category deleted:', result);
      toast({
        title: t('vendor.categoryRemoved'),
        description: result?.deletedCategory?.name
      });
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
    <div className="space-y-8">
      {/* Category Form */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-effect p-8 rounded-2xl"
      >
        <h2 className="text-2xl font-semibold mb-6">
          {categoryForm.dbId
            ? (language === 'es' ? 'Editar Categoría' : 'Edit Category')
            : (language === 'es' ? 'Nueva Categoría' : 'New Category')}
        </h2>

        <div className="space-y-4 mb-6">
          {/* Bilingual Name Fields */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {language === 'es' ? 'Nombre (Español) *' : 'Name (Spanish) *'}
              </label>
              <input
                type="text"
                value={categoryForm.es}
                onChange={e => setCategoryForm({ ...categoryForm, es: e.target.value })}
                className="input-style w-full"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {language === 'es' ? 'Nombre (Inglés) *' : 'Name (English) *'}
              </label>
              <input
                type="text"
                value={categoryForm.en}
                onChange={e => setCategoryForm({ ...categoryForm, en: e.target.value })}
                className="input-style w-full"
                required
              />
            </div>
          </div>

          {/* Bilingual Description Fields */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {language === 'es' ? 'Descripción (Español)' : 'Description (Spanish)'}
              </label>
              <textarea
                value={categoryForm.description_es}
                onChange={e => setCategoryForm({ ...categoryForm, description_es: e.target.value })}
                className="input-style w-full"
                rows="3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {language === 'es' ? 'Descripción (Inglés)' : 'Description (English)'}
              </label>
              <textarea
                value={categoryForm.description_en}
                onChange={e => setCategoryForm({ ...categoryForm, description_en: e.target.value })}
                className="input-style w-full"
                rows="3"
              />
            </div>
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex gap-2">
          <Button
            onClick={handleCategorySubmit}
            disabled={isSubmitting}
            style={{
              backgroundColor: visualSettings.primaryColor || '#2563eb',
              color: 'white'
            }}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {language === 'es' ? 'Guardando...' : 'Saving...'}
              </>
            ) : categoryForm.dbId ? (
              <>
                <Save className="mr-2 h-4 w-4" />
                {language === 'es' ? 'Actualizar Categoría' : 'Update Category'}
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                {language === 'es' ? 'Crear Categoría' : 'Create Category'}
              </>
            )}
          </Button>
          {categoryForm.dbId && (
            <Button
              variant="outline"
              onClick={() => setCategoryForm({
                dbId: null,
                es: '',
                en: '',
                description_es: '',
                description_en: ''
              })}
            >
              <X className="mr-2 h-4 w-4" />
              {t('vendor.addProduct.cancel')}
            </Button>
          )}
        </div>
      </motion.div>

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
                  className={`flex justify-between items-center p-4 rounded-lg transition-all duration-200 ${
                    isConfirming
                      ? 'bg-red-50 border-2 border-red-200'
                      : 'bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex gap-4 items-center">
                      <span className="font-semibold">{categoryName}</span>
                      <span className="text-gray-500 text-sm">({c.slug})</span>
                    </div>
                    {(c.description_es || c.description_en) && (
                      <p className="text-sm text-gray-600 mt-1 truncate">
                        {language === 'es' ? c.description_es : c.description_en}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    <AnimatePresence mode="wait">
                      {isConfirming ? (
                        <motion.div
                          key="confirm-actions"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          className="flex items-center gap-2"
                        >
                          <span className="text-sm text-red-600 font-medium flex items-center gap-1">
                            <AlertTriangle className="h-4 w-4" />
                            {language === 'es' ? '¿Eliminar?' : 'Delete?'}
                          </span>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleConfirmDelete(c.id)}
                            disabled={isDeleting}
                            className="h-8 px-3"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="h-4 w-4 mr-1" />
                                {language === 'es' ? 'Sí' : 'Yes'}
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCancelDelete}
                            disabled={isDeleting}
                            className="h-8 px-3"
                          >
                            <X className="h-4 w-4 mr-1" />
                            {language === 'es' ? 'No' : 'No'}
                          </Button>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="default-actions"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          className="flex gap-1"
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditCategory(c)}
                            disabled={isDeleting}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="icon"
                            onClick={() => setConfirmingDeleteId(c.id)}
                            disabled={isDeleting}
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
