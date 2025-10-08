/**
 * Combo Service
 * Handles all combo-related database operations
 */

import { supabase } from './supabase';

/**
 * Get all combos with their products
 * @param {boolean} includeInactive - If true, returns all combos (active and inactive). Default: false
 */
export const getCombos = async (includeInactive = false) => {
  try {
    let query = supabase
      .from('combo_products')
      .select(`
        *,
        items:combo_items(
          quantity,
          product:products(id, name_es, name_en, base_price)
        )
      `);

    // Only filter by is_active if we don't want inactive combos
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching combos:', error);
    return { data: null, error };
  }
};

/**
 * Create a new combo
 */
export const createCombo = async (comboData) => {
  try {
    // Calculate base total price from selected products with quantities
    let baseTotalPrice = 0;
    if (comboData.productsWithQuantities && comboData.productsWithQuantities.length > 0) {
      const productIds = comboData.productsWithQuantities.map(item => item.productId);
      const { data: productPrices } = await supabase
        .from('products')
        .select('id, base_price')
        .in('id', productIds);

      if (productPrices) {
        baseTotalPrice = comboData.productsWithQuantities.reduce((sum, item) => {
          const product = productPrices.find(p => p.id === item.productId);
          if (product) {
            return sum + (parseFloat(product.base_price) * item.quantity);
          }
          return sum;
        }, 0);
      }
    }

    // Create combo
    const { data: combo, error: comboError } = await supabase
      .from('combo_products')
      .insert([{
        name_es: comboData.name,
        name_en: comboData.name,
        description_es: comboData.description || '',
        description_en: comboData.description || '',
        image_url: comboData.image || null,
        base_total_price: baseTotalPrice,
        profit_margin: parseFloat(comboData.profitMargin || 40),
        is_active: true
      }])
      .select()
      .single();

    if (comboError) throw comboError;

    // Create combo items with quantities
    if (comboData.productsWithQuantities && comboData.productsWithQuantities.length > 0) {
      const comboItems = comboData.productsWithQuantities.map(item => ({
        combo_id: combo.id,
        product_id: item.productId,
        quantity: item.quantity
      }));

      const { error: itemsError } = await supabase
        .from('combo_items')
        .insert(comboItems);

      if (itemsError) throw itemsError;
    }

    return { data: combo, error: null };
  } catch (error) {
    console.error('Error creating combo:', error);
    return { data: null, error };
  }
};

/**
 * Update an existing combo
 */
export const updateCombo = async (comboId, comboData) => {
  try {
    // Calculate new base total price if products changed
    let baseTotalPrice = undefined;
    if (comboData.productsWithQuantities && comboData.productsWithQuantities.length > 0) {
      const productIds = comboData.productsWithQuantities.map(item => item.productId);
      const { data: productPrices } = await supabase
        .from('products')
        .select('id, base_price')
        .in('id', productIds);

      if (productPrices) {
        baseTotalPrice = comboData.productsWithQuantities.reduce((sum, item) => {
          const product = productPrices.find(p => p.id === item.productId);
          if (product) {
            return sum + (parseFloat(product.base_price) * item.quantity);
          }
          return sum;
        }, 0);
      }
    }

    // Update combo
    const updateData = {
      name_es: comboData.name,
      name_en: comboData.name,
      description_es: comboData.description || '',
      description_en: comboData.description || '',
      profit_margin: parseFloat(comboData.profitMargin || 40),
      updated_at: new Date().toISOString()
    };

    if (comboData.image) {
      updateData.image_url = comboData.image;
    }

    if (baseTotalPrice !== undefined) {
      updateData.base_total_price = baseTotalPrice;
    }

    const { data: combo, error: comboError } = await supabase
      .from('combo_products')
      .update(updateData)
      .eq('id', comboId)
      .select()
      .single();

    if (comboError) throw comboError;

    // Update combo items if products changed
    if (comboData.productsWithQuantities) {
      // Delete existing items
      await supabase
        .from('combo_items')
        .delete()
        .eq('combo_id', comboId);

      // Insert new items with quantities
      if (comboData.productsWithQuantities.length > 0) {
        const comboItems = comboData.productsWithQuantities.map(item => ({
          combo_id: comboId,
          product_id: item.productId,
          quantity: item.quantity
        }));

        const { error: itemsError } = await supabase
          .from('combo_items')
          .insert(comboItems);

        if (itemsError) throw itemsError;
      }
    }

    return { data: combo, error: null };
  } catch (error) {
    console.error('Error updating combo:', error);
    return { data: null, error };
  }
};

/**
 * Delete a combo (soft delete)
 */
export const deleteCombo = async (comboId) => {
  try {
    const { data, error } = await supabase
      .from('combo_products')
      .update({ is_active: false })
      .eq('id', comboId)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error deleting combo:', error);
    return { data: null, error };
  }
};
