/**
 * Remittance Service
 * Manages remittance types, remittance orders, and all related operations
 */

import { supabase } from '@/lib/supabase';
import { notifyAdminNewPaymentProof } from '@/lib/whatsappService';

// ============================================================================
// CONSTANTES
// ============================================================================

export const REMITTANCE_STATUS = {
  PAYMENT_PENDING: 'payment_pending',
  PAYMENT_PROOF_UPLOADED: 'payment_proof_uploaded',
  PAYMENT_VALIDATED: 'payment_validated',
  PAYMENT_REJECTED: 'payment_rejected',
  PROCESSING: 'processing',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

export const DELIVERY_METHODS = {
  CASH: 'cash',
  TRANSFER: 'transfer',
  CARD: 'card'
};

// ============================================================================
// GESTIÓN DE TIPOS DE REMESAS (ADMIN)
// ============================================================================

/**
 * Obtener todos los tipos de remesas (Admin)
 * @returns {Promise<{success: boolean, types: Array, error?: string}>}
 */
export const getAllRemittanceTypes = async () => {
  try {
    const { data, error } = await supabase
      .from('remittance_types')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) throw error;

    return { success: true, types: data || [] };
  } catch (error) {
    console.error('Error fetching remittance types:', error);
    return { success: false, types: [], error: error.message };
  }
};

/**
 * Obtener tipos de remesas activos (Usuario)
 * @returns {Promise<{success: boolean, types: Array, error?: string}>}
 */
export const getActiveRemittanceTypes = async () => {
  try {
    const { data, error } = await supabase
      .from('remittance_types')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw error;

    return { success: true, types: data || [] };
  } catch (error) {
    console.error('Error fetching active remittance types:', error);
    return { success: false, types: [], error: error.message };
  }
};

/**
 * Obtener un tipo de remesa por ID
 * @param {string} typeId - ID del tipo
 * @returns {Promise<{success: boolean, type?: Object, error?: string}>}
 */
export const getRemittanceTypeById = async (typeId) => {
  try {
    const { data, error } = await supabase
      .from('remittance_types')
      .select('*')
      .eq('id', typeId)
      .single();

    if (error) throw error;

    return { success: true, type: data };
  } catch (error) {
    console.error('Error fetching remittance type:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Crear nuevo tipo de remesa (Admin)
 * @param {Object} typeData - Datos del tipo
 * @returns {Promise<{success: boolean, type?: Object, error?: string}>}
 */
export const createRemittanceType = async (typeData) => {
  try {
    // Validaciones
    if (!typeData.name || !typeData.currency_code || !typeData.delivery_currency) {
      throw new Error('Nombre y monedas son requeridos');
    }

    if (!typeData.exchange_rate || typeData.exchange_rate <= 0) {
      throw new Error('Tasa de cambio debe ser mayor a 0');
    }

    if (!typeData.min_amount || typeData.min_amount <= 0) {
      throw new Error('Monto mínimo debe ser mayor a 0');
    }

    if (typeData.max_amount && typeData.max_amount < typeData.min_amount) {
      throw new Error('Monto máximo debe ser mayor al mínimo');
    }

    const { data, error } = await supabase
      .from('remittance_types')
      .insert([typeData])
      .select()
      .single();

    if (error) throw error;

    return { success: true, type: data };
  } catch (error) {
    console.error('Error creating remittance type:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Actualizar tipo de remesa (Admin)
 * @param {string} typeId - ID del tipo
 * @param {Object} updates - Datos a actualizar
 * @returns {Promise<{success: boolean, type?: Object, error?: string}>}
 */
export const updateRemittanceType = async (typeId, updates) => {
  try {
    // Validaciones
    if (updates.exchange_rate && updates.exchange_rate <= 0) {
      throw new Error('Tasa de cambio debe ser mayor a 0');
    }

    if (updates.min_amount && updates.min_amount <= 0) {
      throw new Error('Monto mínimo debe ser mayor a 0');
    }

    if (updates.max_amount && updates.min_amount && updates.max_amount < updates.min_amount) {
      throw new Error('Monto máximo debe ser mayor al mínimo');
    }

    const { data, error } = await supabase
      .from('remittance_types')
      .update(updates)
      .eq('id', typeId)
      .select()
      .single();

    if (error) throw error;

    return { success: true, type: data };
  } catch (error) {
    console.error('Error updating remittance type:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Eliminar tipo de remesa (Super Admin)
 * @param {string} typeId - ID del tipo
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteRemittanceType = async (typeId) => {
  try {
    // Verificar si hay remesas asociadas
    const { data: remittances, error: checkError } = await supabase
      .from('remittances')
      .select('id')
      .eq('remittance_type_id', typeId)
      .limit(1);

    if (checkError) throw checkError;

    if (remittances && remittances.length > 0) {
      throw new Error('No se puede eliminar. Existen remesas asociadas a este tipo.');
    }

    const { error } = await supabase
      .from('remittance_types')
      .delete()
      .eq('id', typeId);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error('Error deleting remittance type:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// GESTIÓN DE REMESAS (USUARIO)
// ============================================================================

/**
 * Calcular detalles de una remesa
 * @param {string} typeId - ID del tipo de remesa
 * @param {number} amount - Monto a enviar
 * @returns {Promise<{success: boolean, calculation?: Object, error?: string}>}
 */
export const calculateRemittance = async (typeId, amount) => {
  try {
    const { data: type, error } = await supabase
      .from('remittance_types')
      .select('*')
      .eq('id', typeId)
      .eq('is_active', true)
      .single();

    if (error) throw error;
    if (!type) throw new Error('Tipo de remesa no encontrado');

    // Validar límites
    if (amount < type.min_amount) {
      throw new Error(`Monto mínimo: ${type.min_amount} ${type.currency_code}`);
    }

    if (type.max_amount && amount > type.max_amount) {
      throw new Error(`Monto máximo: ${type.max_amount} ${type.currency_code}`);
    }

    // Calcular comisión
    const commissionPercentage = (amount * (type.commission_percentage || 0)) / 100;
    const commissionFixed = type.commission_fixed || 0;
    const totalCommission = commissionPercentage + commissionFixed;

    // Calcular monto a entregar
    const amountToDeliver = (amount * type.exchange_rate) - (totalCommission * type.exchange_rate);

    return {
      success: true,
      calculation: {
        amount,
        exchangeRate: type.exchange_rate,
        commissionPercentage: type.commission_percentage || 0,
        commissionFixed: type.commission_fixed || 0,
        totalCommission,
        amountToDeliver,
        currency: type.currency_code,
        deliveryCurrency: type.delivery_currency,
        deliveryMethod: type.delivery_method
      }
    };
  } catch (error) {
    console.error('Error calculating remittance:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Crear nueva remesa (Usuario)
 * @param {Object} remittanceData - Datos de la remesa
 * @returns {Promise<{success: boolean, remittance?: Object, error?: string}>}
 */
export const createRemittance = async (remittanceData) => {
  try {
    const {
      remittance_type_id,
      amount,
      recipient_name,
      recipient_phone,
      recipient_address,
      recipient_city,
      recipient_id_number,
      notes
    } = remittanceData;

    // Validaciones básicas
    if (!remittance_type_id || !amount || !recipient_name || !recipient_phone) {
      throw new Error('Datos incompletos. Verifique tipo, monto, nombre y teléfono del destinatario.');
    }

    // Obtener tipo y validar
    const { data: type, error: typeError } = await supabase
      .from('remittance_types')
      .select('*')
      .eq('id', remittance_type_id)
      .eq('is_active', true)
      .single();

    if (typeError) throw typeError;
    if (!type) throw new Error('Tipo de remesa no válido o inactivo');

    // Validar límites
    if (amount < type.min_amount) {
      throw new Error(`Monto mínimo: ${type.min_amount} ${type.currency_code}`);
    }

    if (type.max_amount && amount > type.max_amount) {
      throw new Error(`Monto máximo: ${type.max_amount} ${type.currency_code}`);
    }

    // Calcular montos
    const calculation = await calculateRemittance(remittance_type_id, amount);
    if (!calculation.success) throw new Error(calculation.error);

    // Obtener usuario actual
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Usuario no autenticado');

    // Calcular comisiones según el esquema de la DB
    const commissionPercentage = type.commission_percentage || 0;
    const commissionFixed = type.commission_fixed || 0;
    const commissionTotal = (amount * commissionPercentage / 100) + commissionFixed;
    const amountToDeliver = (amount * type.exchange_rate) - (commissionTotal * type.exchange_rate);

    // Crear remesa con los nombres de columnas correctos según el esquema
    const { data, error } = await supabase
      .from('remittances')
      .insert([{
        user_id: user.id,
        remittance_type_id,
        amount_sent: amount,  // ← Columna correcta: amount_sent (no amount)
        exchange_rate: type.exchange_rate,
        commission_percentage: commissionPercentage,  // ← Columna correcta
        commission_fixed: commissionFixed,  // ← Columna correcta
        commission_total: commissionTotal,  // ← Columna correcta
        amount_to_deliver: amountToDeliver,
        currency_sent: type.currency_code,  // ← Columna correcta: currency_sent
        currency_delivered: type.delivery_currency,  // ← Columna correcta: currency_delivered
        recipient_name,
        recipient_phone,
        recipient_address,
        recipient_province: recipient_city,  // ← Se mapea city a province
        recipient_id_number,
        delivery_notes: notes,  // ← Columna correcta: delivery_notes
        status: REMITTANCE_STATUS.PAYMENT_PENDING
      }])
      .select()
      .single();

    if (error) throw error;

    return { success: true, remittance: data };
  } catch (error) {
    console.error('Error creating remittance:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Subir comprobante de pago (Usuario)
 * @param {string} remittanceId - ID de la remesa
 * @param {File} file - Archivo del comprobante
 * @param {string} reference - Referencia del pago
 * @param {string} notes - Notas adicionales
 * @returns {Promise<{success: boolean, remittance?: Object, error?: string}>}
 */
export const uploadPaymentProof = async (remittanceId, file, reference, notes = '') => {
  try {
    if (!file) throw new Error('Archivo de comprobante es requerido');
    if (!reference) throw new Error('Referencia de pago es requerida');

    // Obtener remesa actual
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) throw fetchError;
    if (!remittance) throw new Error('Remesa no encontrada');

    // Validar estado
    if (remittance.status !== REMITTANCE_STATUS.PAYMENT_PENDING) {
      throw new Error('Solo se puede subir comprobante en estado "Pendiente de Pago"');
    }

    // Obtener usuario actual
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;

    // Validar que sea el dueño de la remesa
    if (remittance.user_id !== user.id) {
      throw new Error('No tiene permisos para modificar esta remesa');
    }

    // Subir archivo a Supabase Storage
    const fileExt = file.name.split('.').pop();
    const fileName = `${remittance.remittance_number}.${fileExt}`;
    const filePath = `${user.id}/${fileName}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('remittance-proofs')
      .upload(filePath, file, { upsert: true });

    if (uploadError) throw uploadError;

    // Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from('remittance-proofs')
      .getPublicUrl(filePath);

    // Actualizar remesa
    const { data: updatedRemittance, error: updateError } = await supabase
      .from('remittances')
      .update({
        payment_proof_url: publicUrl,
        payment_reference: reference,
        payment_proof_notes: notes,
        payment_proof_uploaded_at: new Date().toISOString(),
        status: REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (updateError) throw updateError;

    // Enviar notificación WhatsApp al admin (opcional - requiere número configurado)
    try {
      const { data: settings } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'whatsapp_admin_phone')
        .single();

      if (settings?.value) {
        notifyAdminNewPaymentProof(updatedRemittance, settings.value, 'es');
      }
    } catch (notifError) {
      console.error('Error sending WhatsApp notification:', notifError);
      // No fallar la operación si falla la notificación
    }

    return { success: true, remittance: updatedRemittance };
  } catch (error) {
    console.error('Error uploading payment proof:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Obtener mis remesas (Usuario)
 * @param {Object} filters - Filtros opcionales
 * @returns {Promise<{success: boolean, remittances: Array, error?: string}>}
 */
export const getMyRemittances = async (filters = {}) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Usuario no autenticado');

    let query = supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('user_id', user.id);

    // Aplicar filtros
    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    // Ordenar por fecha más reciente
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, remittances: data || [] };
  } catch (error) {
    console.error('Error fetching my remittances:', error);
    return { success: false, remittances: [], error: error.message };
  }
};

/**
 * Obtener detalles de una remesa
 * @param {string} remittanceId - ID de la remesa
 * @returns {Promise<{success: boolean, remittance?: Object, error?: string}>}
 */
export const getRemittanceDetails = async (remittanceId) => {
  try {
    const { data, error } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (error) throw error;
    if (!data) throw new Error('Remesa no encontrada');

    // Obtener historial de estados
    const { data: history, error: historyError } = await supabase
      .from('remittance_status_history')
      .select('*')
      .eq('remittance_id', remittanceId)
      .order('changed_at', { ascending: true });

    if (historyError) console.error('Error fetching history:', historyError);

    return {
      success: true,
      remittance: {
        ...data,
        history: history || []
      }
    };
  } catch (error) {
    console.error('Error fetching remittance details:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Cancelar remesa (Usuario)
 * @param {string} remittanceId - ID de la remesa
 * @param {string} reason - Razón de cancelación
 * @returns {Promise<{success: boolean, remittance?: Object, error?: string}>}
 */
export const cancelRemittance = async (remittanceId, reason = '') => {
  try {
    // Obtener remesa actual
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*')
      .eq('id', remittanceId)
      .single();

    if (fetchError) throw fetchError;
    if (!remittance) throw new Error('Remesa no encontrada');

    // Validar que se pueda cancelar
    if ([
      REMITTANCE_STATUS.DELIVERED,
      REMITTANCE_STATUS.COMPLETED,
      REMITTANCE_STATUS.CANCELLED
    ].includes(remittance.status)) {
      throw new Error('No se puede cancelar una remesa en este estado');
    }

    // Obtener usuario actual
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;

    // Validar permisos
    if (remittance.user_id !== user.id) {
      throw new Error('No tiene permisos para cancelar esta remesa');
    }

    // Actualizar estado
    const { data, error } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.CANCELLED,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (error) throw error;

    return { success: true, remittance: data };
  } catch (error) {
    console.error('Error cancelling remittance:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// GESTIÓN DE REMESAS (ADMIN)
// ============================================================================

/**
 * Obtener todas las remesas (Admin)
 * @param {Object} filters - Filtros opcionales
 * @returns {Promise<{success: boolean, remittances: Array, error?: string}>}
 */
export const getAllRemittances = async (filters = {}) => {
  try {
    let query = supabase
      .from('remittances')
      .select('*, remittance_types(*), user_profiles!remittances_user_id_fkey(*)');

    // Aplicar filtros
    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    if (filters.search) {
      query = query.or(`remittance_number.ilike.%${filters.search}%,recipient_name.ilike.%${filters.search}%,recipient_phone.ilike.%${filters.search}%`);
    }

    // Ordenar
    const orderBy = filters.orderBy || 'created_at';
    const ascending = filters.ascending !== undefined ? filters.ascending : false;
    query = query.order(orderBy, { ascending });

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, remittances: data || [] };
  } catch (error) {
    console.error('Error fetching all remittances:', error);
    return { success: false, remittances: [], error: error.message };
  }
};

/**
 * Validar pago de remesa (Admin)
 * @param {string} remittanceId - ID de la remesa
 * @param {string} notes - Notas de validación
 * @returns {Promise<{success: boolean, remittance?: Object, error?: string}>}
 */
export const validatePayment = async (remittanceId, notes = '') => {
  try {
    // Obtener remesa actual
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) throw fetchError;
    if (!remittance) throw new Error('Remesa no encontrada');

    // Validar estado
    if (remittance.status !== REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED) {
      throw new Error('Solo se puede validar pago cuando hay comprobante subido');
    }

    // Actualizar estado
    const { data, error } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.PAYMENT_VALIDATED,
        payment_validated_at: new Date().toISOString(),
        payment_validation_notes: notes
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (error) throw error;

    // TODO: Enviar notificación WhatsApp al usuario
    // await notifyUserPaymentValidated(data);

    return { success: true, remittance: data };
  } catch (error) {
    console.error('Error validating payment:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Rechazar pago de remesa (Admin)
 * @param {string} remittanceId - ID de la remesa
 * @param {string} reason - Razón del rechazo
 * @returns {Promise<{success: boolean, remittance?: Object, error?: string}>}
 */
export const rejectPayment = async (remittanceId, reason) => {
  try {
    if (!reason) throw new Error('Debe proporcionar una razón para el rechazo');

    // Obtener remesa actual
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) throw fetchError;
    if (!remittance) throw new Error('Remesa no encontrada');

    // Validar estado
    if (remittance.status !== REMITTANCE_STATUS.PAYMENT_PROOF_UPLOADED) {
      throw new Error('Solo se puede rechazar pago cuando hay comprobante subido');
    }

    // Actualizar estado
    const { data, error } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.PAYMENT_REJECTED,
        payment_rejected_at: new Date().toISOString(),
        payment_rejection_reason: reason
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (error) throw error;

    // TODO: Enviar notificación WhatsApp al usuario
    // await notifyUserPaymentRejected(data);

    return { success: true, remittance: data };
  } catch (error) {
    console.error('Error rejecting payment:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Iniciar procesamiento de remesa (Admin)
 * @param {string} remittanceId - ID de la remesa
 * @param {string} notes - Notas de procesamiento
 * @returns {Promise<{success: boolean, remittance?: Object, error?: string}>}
 */
export const startProcessing = async (remittanceId, notes = '') => {
  try {
    // Obtener remesa actual
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) throw fetchError;
    if (!remittance) throw new Error('Remesa no encontrada');

    // Validar estado
    if (remittance.status !== REMITTANCE_STATUS.PAYMENT_VALIDATED) {
      throw new Error('Solo se puede procesar remesa con pago validado');
    }

    // Actualizar estado
    const { data, error } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.PROCESSING,
        processing_started_at: new Date().toISOString(),
        processing_notes: notes
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (error) throw error;

    return { success: true, remittance: data };
  } catch (error) {
    console.error('Error starting processing:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Confirmar entrega de remesa (Admin)
 * @param {string} remittanceId - ID de la remesa
 * @param {File} proofFile - Archivo de evidencia de entrega
 * @param {string} notes - Notas de entrega
 * @returns {Promise<{success: boolean, remittance?: Object, error?: string}>}
 */
export const confirmDelivery = async (remittanceId, proofFile = null, notes = '') => {
  try {
    // Obtener remesa actual
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) throw fetchError;
    if (!remittance) throw new Error('Remesa no encontrada');

    // Validar estado
    if (remittance.status !== REMITTANCE_STATUS.PROCESSING) {
      throw new Error('Solo se puede confirmar entrega de remesa en procesamiento');
    }

    let deliveryProofUrl = null;

    // Subir evidencia de entrega si se proporcionó
    if (proofFile) {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      const fileExt = proofFile.name.split('.').pop();
      const fileName = `${remittance.remittance_number}_delivery.${fileExt}`;
      const filePath = `delivery/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('remittance-proofs')
        .upload(filePath, proofFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('remittance-proofs')
        .getPublicUrl(filePath);

      deliveryProofUrl = publicUrl;
    }

    // Actualizar estado
    const { data, error } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.DELIVERED,
        delivered_at: new Date().toISOString(),
        delivery_proof_url: deliveryProofUrl,
        delivery_notes: notes
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (error) throw error;

    // TODO: Enviar notificación WhatsApp al usuario
    // await notifyUserDelivered(data);

    return { success: true, remittance: data };
  } catch (error) {
    console.error('Error confirming delivery:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Completar remesa (Admin)
 * @param {string} remittanceId - ID de la remesa
 * @param {string} notes - Notas finales
 * @returns {Promise<{success: boolean, remittance?: Object, error?: string}>}
 */
export const completeRemittance = async (remittanceId, notes = '') => {
  try {
    // Obtener remesa actual
    const { data: remittance, error: fetchError } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .eq('id', remittanceId)
      .single();

    if (fetchError) throw fetchError;
    if (!remittance) throw new Error('Remesa no encontrada');

    // Validar estado
    if (remittance.status !== REMITTANCE_STATUS.DELIVERED) {
      throw new Error('Solo se puede completar remesa ya entregada');
    }

    // Actualizar estado
    const { data, error } = await supabase
      .from('remittances')
      .update({
        status: REMITTANCE_STATUS.COMPLETED,
        completed_at: new Date().toISOString(),
        completion_notes: notes
      })
      .eq('id', remittanceId)
      .select('*, remittance_types(*)')
      .single();

    if (error) throw error;

    return { success: true, remittance: data };
  } catch (error) {
    console.error('Error completing remittance:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================

/**
 * Calcular alerta de tiempo para entrega
 * @param {Object} remittance - Objeto de remesa
 * @returns {Object} Estado de alerta {level: 'success'|'info'|'warning'|'error', message: string}
 */
export const calculateDeliveryAlert = (remittance) => {
  if (!remittance.payment_validated_at || !remittance.max_delivery_date) {
    return { level: 'info', message: 'Pendiente de validación' };
  }

  const now = new Date();
  const validatedAt = new Date(remittance.payment_validated_at);
  const maxDeliveryDate = new Date(remittance.max_delivery_date);
  const hoursElapsed = (now - validatedAt) / (1000 * 60 * 60);
  const hoursRemaining = (maxDeliveryDate - now) / (1000 * 60 * 60);

  // Ya entregada
  if ([REMITTANCE_STATUS.DELIVERED, REMITTANCE_STATUS.COMPLETED].includes(remittance.status)) {
    return { level: 'success', message: 'Entregada' };
  }

  // Vencida
  if (hoursRemaining < 0) {
    return { level: 'error', message: 'Entrega vencida' };
  }

  // Menos de 24 horas
  if (hoursRemaining < 24) {
    return { level: 'error', message: `Quedan ${Math.round(hoursRemaining)} horas` };
  }

  // Menos de 48 horas
  if (hoursRemaining < 48) {
    return { level: 'warning', message: `Quedan ${Math.round(hoursRemaining / 24)} días` };
  }

  // Más de 48 horas
  return { level: 'info', message: `Quedan ${Math.round(hoursRemaining / 24)} días` };
};

/**
 * Obtener estadísticas de remesas (Admin)
 * @param {Object} filters - Filtros de fecha
 * @returns {Promise<{success: boolean, stats?: Object, error?: string}>}
 */
export const getRemittanceStats = async (filters = {}) => {
  try {
    let query = supabase
      .from('remittances')
      .select('status, amount, currency, created_at, completed_at');

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Calcular estadísticas
    const stats = {
      total: data.length,
      byStatus: {},
      totalAmount: 0,
      completedAmount: 0,
      avgProcessingTime: 0
    };

    let totalProcessingTime = 0;
    let completedCount = 0;

    data.forEach(remittance => {
      // Por estado
      stats.byStatus[remittance.status] = (stats.byStatus[remittance.status] || 0) + 1;

      // Montos
      stats.totalAmount += parseFloat(remittance.amount);

      if (remittance.status === REMITTANCE_STATUS.COMPLETED) {
        stats.completedAmount += parseFloat(remittance.amount);
        completedCount++;

        // Tiempo de procesamiento
        if (remittance.completed_at && remittance.created_at) {
          const processingTime = new Date(remittance.completed_at) - new Date(remittance.created_at);
          totalProcessingTime += processingTime;
        }
      }
    });

    // Promedio de tiempo de procesamiento (en horas)
    if (completedCount > 0) {
      stats.avgProcessingTime = (totalProcessingTime / completedCount) / (1000 * 60 * 60);
    }

    return { success: true, stats };
  } catch (error) {
    console.error('Error fetching remittance stats:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Verificar permisos de admin
 * @returns {Promise<{success: boolean, isAdmin: boolean, error?: string}>}
 */
export const checkAdminPermissions = async () => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) return { success: true, isAdmin: false };

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (profileError) throw profileError;

    const isAdmin = profile && ['admin', 'super_admin'].includes(profile.role);

    return { success: true, isAdmin };
  } catch (error) {
    console.error('Error checking admin permissions:', error);
    return { success: false, isAdmin: false, error: error.message };
  }
};

/**
 * Obtener remesas que requieren alerta de tiempo (Admin)
 * @returns {Promise<{success: boolean, remittances: Array, error?: string}>}
 */
export const getRemittancesNeedingAlert = async () => {
  try {
    const now = new Date();
    const alertThreshold = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // 24 horas

    const { data, error } = await supabase
      .from('remittances')
      .select('*, remittance_types(*)')
      .in('status', [
        REMITTANCE_STATUS.PAYMENT_VALIDATED,
        REMITTANCE_STATUS.PROCESSING
      ])
      .lte('max_delivery_date', alertThreshold.toISOString())
      .order('max_delivery_date', { ascending: true });

    if (error) throw error;

    return { success: true, remittances: data || [] };
  } catch (error) {
    console.error('Error fetching remittances needing alert:', error);
    return { success: false, remittances: [], error: error.message };
  }
};
