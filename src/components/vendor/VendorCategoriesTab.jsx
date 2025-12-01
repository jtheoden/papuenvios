import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Edit, Trash2, Plus, X, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { toast } from '@/components/ui/use-toast';

/**
 * Vendor Categories Tab Component
 * Manages product categories with bilingual support
 */
const VendorCategoriesTab = ({ categories, onCategoriesChange, visualSettings }) => {
  const { t, language } = useLanguage();
  const { products } = useBusiness();

  const [categoryForm, setCategoryForm] = useState({
    dbId: null,
    es: '',
    en: '',
    description_es: '',
    description_en: ''
  });

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

    try {
      // TODO: Connect to productService for create/update
      // if (categoryForm.dbId) {
      //   await updateCategory(categoryForm);
      // } else {
      //   await createCategory(categoryForm);
      // }

      toast({
        title: t('vendor.categoryAdded')
      });

      setCategoryForm({
        dbId: null,
        es: '',
        en: '',
        description_es: '',
        description_en: ''
      });
    } catch (error) {
      toast({
        title: t('vendor.validation.error'),
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleEditCategory = (category) => {
    setCategoryForm({
      dbId: category.id,
      es: category.name_es || category.es || '',
      en: category.name_en || category.en || '',
      description_es: category.description_es || '',
      description_en: category.description_en || ''
    });
  };

  const handleRemoveCategory = async (categoryId) => {
    if (!window.confirm(language === 'es' ? '¿Eliminar categoría?' : 'Delete category?')) {
      return;
    }

    try {
      // TODO: Connect to productService for delete
      // await deleteCategory(categoryId);

      toast({
        title: t('vendor.categoryRemoved')
      });
    } catch (error) {
      toast({
        title: t('vendor.validation.error'),
        description: error.message,
        variant: 'destructive'
      });
    }
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
            style={{
              backgroundColor: visualSettings.primaryColor || '#2563eb',
              color: 'white'
            }}
          >
            {categoryForm.dbId ? (
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
            {categories.map(c => (
              <li
                key={c.id}
                className="flex justify-between items-center p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex gap-4">
                    <span className="font-semibold">
                      {language === 'es' ? (c.name_es || c.es) : (c.name_en || c.en)}
                    </span>
                    <span className="text-gray-500 text-sm">({c.slug})</span>
                  </div>
                  {(c.description_es || c.description_en) && (
                    <p className="text-sm text-gray-600 mt-1 truncate">
                      {language === 'es' ? c.description_es : c.description_en}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 ml-4 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEditCategory(c)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => handleRemoveCategory(c.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
    </div>
  );
};

export default VendorCategoriesTab;
