/**
 * Recipient Service
 * Gestión de destinatarios y sus direcciones
 */

import { supabase } from '@/lib/supabase';

// ============================================================================
// DESTINATARIOS
// ============================================================================

/**
 * Obtener todos los destinatarios del usuario
 */
export const getMyRecipients = async () => {
  try {
    const { data, error } = await supabase
      .from('recipients')
      .select(`
        *,
        addresses:recipient_addresses(*)
      `)
      .order('is_favorite', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, recipients: data || [] };
  } catch (error) {
    console.error('Error fetching recipients:', error);
    return { success: false, recipients: [], error: error.message };
  }
};

/**
 * Obtener un destinatario por ID
 */
export const getRecipientById = async (recipientId) => {
  try {
    const { data, error } = await supabase
      .from('recipients')
      .select(`
        *,
        addresses:recipient_addresses(*)
      `)
      .eq('id', recipientId)
      .single();

    if (error) throw error;
    return { success: true, recipient: data };
  } catch (error) {
    console.error('Error fetching recipient:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Crear nuevo destinatario
 */
export const createRecipient = async (recipientData) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Usuario no autenticado');

    const { data, error } = await supabase
      .from('recipients')
      .insert([{
        user_id: user.id,
        ...recipientData
      }])
      .select()
      .single();

    if (error) throw error;
    return { success: true, recipient: data };
  } catch (error) {
    console.error('Error creating recipient:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Actualizar destinatario
 */
export const updateRecipient = async (recipientId, updates) => {
  try {
    const { data, error } = await supabase
      .from('recipients')
      .update(updates)
      .eq('id', recipientId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, recipient: data };
  } catch (error) {
    console.error('Error updating recipient:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Eliminar destinatario
 */
export const deleteRecipient = async (recipientId) => {
  try {
    const { error } = await supabase
      .from('recipients')
      .delete()
      .eq('id', recipientId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error deleting recipient:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// DIRECCIONES DE DESTINATARIOS
// ============================================================================

/**
 * Agregar dirección a destinatario
 */
export const addRecipientAddress = async (addressData) => {
  try {
    // Si es dirección por defecto, desmarcar las demás
    if (addressData.is_default) {
      await supabase
        .from('recipient_addresses')
        .update({ is_default: false })
        .eq('recipient_id', addressData.recipient_id);
    }

    const { data, error } = await supabase
      .from('recipient_addresses')
      .insert([addressData])
      .select()
      .single();

    if (error) throw error;
    return { success: true, address: data };
  } catch (error) {
    console.error('Error adding address:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Actualizar dirección
 */
export const updateRecipientAddress = async (addressId, updates) => {
  try {
    // Si se marca como default, desmarcar las demás
    if (updates.is_default) {
      const { data: address } = await supabase
        .from('recipient_addresses')
        .select('recipient_id')
        .eq('id', addressId)
        .single();

      if (address) {
        await supabase
          .from('recipient_addresses')
          .update({ is_default: false })
          .eq('recipient_id', address.recipient_id);
      }
    }

    const { data, error } = await supabase
      .from('recipient_addresses')
      .update(updates)
      .eq('id', addressId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, address: data };
  } catch (error) {
    console.error('Error updating address:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Eliminar dirección
 */
export const deleteRecipientAddress = async (addressId) => {
  try {
    const { error } = await supabase
      .from('recipient_addresses')
      .delete()
      .eq('id', addressId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error deleting address:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// LOCALIDADES DE CUBA
// ============================================================================

/**
 * Obtener todas las provincias
 */
export const getCubanProvinces = async () => {
  try {
    const { data, error } = await supabase
      .from('cuban_municipalities')
      .select('province')
      .eq('delivery_available', true);

    if (error) throw error;

    // Eliminar duplicados
    const provinces = [...new Set(data.map(item => item.province))].sort();
    return { success: true, provinces };
  } catch (error) {
    console.error('Error fetching provinces:', error);
    return { success: false, provinces: [], error: error.message };
  }
};

/**
 * Obtener municipios por provincia
 */
export const getMunicipalitiesByProvince = async (province) => {
  try {
    const { data, error } = await supabase
      .from('cuban_municipalities')
      .select('*')
      .eq('province', province)
      .eq('delivery_available', true)
      .order('municipality');

    if (error) throw error;
    return { success: true, municipalities: data || [] };
  } catch (error) {
    console.error('Error fetching municipalities:', error);
    return { success: false, municipalities: [], error: error.message };
  }
};
