/**
 * Product Service
 * Handles all product-related database operations
 */

import { supabase } from './supabase';

/**
 * Get all active products with their categories
 */
export const getProducts = async () => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        category:product_categories(id, name_es, name_en, slug)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get inventory data for all products
    const productIds = (data || []).map(p => p.id);
    const { data: inventoryData } = await supabase
      .from('inventory')
      .select('product_id, quantity, available_quantity, expiry_date')
      .in('product_id', productIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    // Create inventory map with stock and expiry_date
    const inventoryMap = {};
    const expiryDateMap = {};
    (inventoryData || []).forEach(inv => {
      if (!inventoryMap[inv.product_id]) {
        inventoryMap[inv.product_id] = 0;
      }
      inventoryMap[inv.product_id] += inv.available_quantity || 0;

      // Keep the most recent expiry_date (first one due to order by created_at desc)
      if (!expiryDateMap[inv.product_id] && inv.expiry_date) {
        expiryDateMap[inv.product_id] = inv.expiry_date;
      }
    });

    // Add stock and expiry_date from inventory
    const transformedData = (data || []).map(product => ({
      ...product,
      stock: inventoryMap[product.id] || 0,
      expiry_date: expiryDateMap[product.id] || null
    }));

    return { data: transformedData, error: null };
  } catch (error) {
    console.error('Error fetching products:', error);
    return { data: null, error };
  }
};

/**
 * Create a new product
 */
export const createProduct = async (productData) => {
  try {
    console.log('📝 createProduct called with:', productData);

    const { data, error} = await supabase
      .from('products')
      .insert([{
        sku: productData.sku || `SKU-${Date.now()}`,
        name_es: productData.name,
        name_en: productData.name, // Can be updated later for multi-language
        description_es: productData.description_es || '',
        description_en: productData.description_en || '',
        category_id: productData.category_id,
        base_price: parseFloat(productData.basePrice),
        base_currency_id: productData.base_currency_id,
        profit_margin: parseFloat(productData.profitMargin || 40),
        min_stock_alert: productData.min_stock_alert ? parseInt(productData.min_stock_alert) : 10,
        image_url: productData.image || null,
        image_file: productData.image || null,
        is_active: true
      }])
      .select()
      .single();

    if (error) throw error;
    console.log('✅ Product created:', data);

    // Create initial inventory record if stock is provided
    if (productData.stock && parseInt(productData.stock) > 0) {
      console.log('📦 Creating inventory with stock:', productData.stock);
      const inventoryData = {
        product_id: data.id,
        quantity: parseInt(productData.stock),
        batch_number: `BATCH-${Date.now()}`,
        is_active: true
      };

      // Add expiry_date if provided
      if (productData.expiryDate) {
        inventoryData.expiry_date = productData.expiryDate;
      }

      const { error: invError } = await supabase
        .from('inventory')
        .insert([inventoryData]);

      if (invError) {
        console.error('❌ Error creating inventory:', invError);
        // Don't fail product creation if inventory fails
      } else {
        console.log('✅ Inventory created successfully');
      }
    } else {
      console.log('⚠️ No stock to create, stock value:', productData.stock);
    }

    return { data, error: null };
  } catch (error) {
    console.error('❌ Error creating product:', error);
    return { data: null, error };
  }
};

/**
 * Update an existing product
 */
export const updateProduct = async (productId, productData) => {
  try {
    console.log('📝 updateProduct called for:', productId, 'with data:', productData);

    const updateData = {
      name_es: productData.name,
      name_en: productData.name,
      description_es: productData.description_es || '',
      description_en: productData.description_en || '',
      category_id: productData.category_id,
      base_price: parseFloat(productData.basePrice),
      profit_margin: parseFloat(productData.profitMargin || 40),
      min_stock_alert: productData.min_stock_alert !== undefined ? parseInt(productData.min_stock_alert) : 10,
      updated_at: new Date().toISOString()
    };

    if (productData.image) {
      updateData.image_url = productData.image;
      updateData.image_file = productData.image;
    }

    console.log('📤 Sending update to products table:', updateData);

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', productId)
      .select()
      .single();

    if (error) throw error;
    console.log('✅ Product updated:', data);

    // Update inventory if stock or expiry date changed
    if (productData.stock !== undefined || productData.expiryDate !== undefined) {
      // Check if inventory record exists for this product
      const { data: inventoryRecords } = await supabase
        .from('inventory')
        .select('id')
        .eq('product_id', productId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1);

      const existingInventory = inventoryRecords && inventoryRecords.length > 0 ? inventoryRecords[0] : null;

      if (existingInventory) {
        // Update existing inventory record
        const inventoryUpdate = {
          updated_at: new Date().toISOString()
        };

        // Update stock if provided
        if (productData.stock !== undefined) {
          inventoryUpdate.quantity = parseInt(productData.stock);
        }

        // Update expiry_date if provided
        if (productData.expiryDate !== undefined) {
          inventoryUpdate.expiry_date = productData.expiryDate || null;
        }

        const { error: invError } = await supabase
          .from('inventory')
          .update(inventoryUpdate)
          .eq('id', existingInventory.id);

        if (invError) {
          console.error('Error updating inventory:', invError);
        }
      } else if (productData.stock !== undefined && parseInt(productData.stock) > 0) {
        // Create new inventory record only if stock > 0
        const inventoryData = {
          product_id: productId,
          quantity: parseInt(productData.stock),
          batch_number: `BATCH-${Date.now()}`,
          is_active: true
        };

        // Add expiry_date if provided
        if (productData.expiryDate) {
          inventoryData.expiry_date = productData.expiryDate;
        }

        const { error: invError } = await supabase
          .from('inventory')
          .insert([inventoryData]);

        if (invError) {
          console.error('Error creating inventory:', invError);
        }
      }
    }

    return { data, error: null };
  } catch (error) {
    console.error('Error updating product:', error);
    return { data: null, error };
  }
};

/**
 * Delete a product (soft delete by setting is_active to false)
 */
export const deleteProduct = async (productId) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .update({ is_active: false })
      .eq('id', productId)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error deleting product:', error);
    return { data: null, error };
  }
};

/**
 * Get product categories
 */
export const getCategories = async () => {
  try {
    const { data, error } = await supabase
      .from('product_categories')
      .select('id, slug, name_es, name_en, description_es, description_en, display_order, is_active')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('Error fetching categories:', error);
    return { data: null, error };
  }
};

/**
 * Create a new category
 */
export const createCategory = async (categoryData) => {
  try {
    // Generate slug from name_es
    const slug = categoryData.es
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

    const { data, error } = await supabase
      .from('product_categories')
      .insert([{
        name_es: categoryData.es,
        name_en: categoryData.en,
        description_es: categoryData.description_es || '',
        description_en: categoryData.description_en || '',
        slug: slug,
        is_active: true,
        display_order: 0
      }])
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error creating category:', error);
    return { data: null, error };
  }
};

/**
 * Update a category
 */
export const updateCategory = async (categoryId, categoryData) => {
  try {
    // Generate new slug from name_es
    const slug = categoryData.es
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const { data, error } = await supabase
      .from('product_categories')
      .update({
        name_es: categoryData.es,
        name_en: categoryData.en,
        description_es: categoryData.description_es || '',
        description_en: categoryData.description_en || '',
        slug: slug,
        updated_at: new Date().toISOString()
      })
      .eq('id', categoryId)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error updating category:', error);
    return { data: null, error };
  }
};

/**
 * Delete a category (soft delete)
 */
export const deleteCategory = async (categoryId) => {
  try {
    const { error } = await supabase
      .from('product_categories')
      .update({ is_active: false })
      .eq('id', categoryId);

    if (error) throw error;
    return { data: true, error: null };
  } catch (error) {
    console.error('Error deleting category:', error);
    return { data: null, error };
  }
};
