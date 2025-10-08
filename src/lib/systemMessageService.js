/**
 * System Message Service
 * Handles configurable bilingual system messages (payment instructions, announcements, etc.)
 */

import { supabase } from './supabase';

/**
 * Get system message by key
 * @param {string} messageKey - Message key identifier
 * @param {string} language - Language code ('es' or 'en')
 * @returns {Object} System message
 */
export const getSystemMessage = async (messageKey, language = 'es') => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('*')
      .eq('message_key', messageKey)
      .eq('is_active', true)
      .single();

    if (error) throw error;

    // Return language-specific content
    const message = {
      key: data.message_key,
      title: language === 'es' ? data.title_es : data.title_en,
      content: language === 'es' ? data.content_es : data.content_en,
      isActive: data.is_active
    };

    return {
      success: true,
      message
    };
  } catch (error) {
    console.error('Error fetching system message:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get all active system messages
 * @param {string} language - Language code ('es' or 'en')
 * @returns {Array} List of active system messages
 */
export const getActiveSystemMessages = async (language = 'es') => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('*')
      .eq('is_active', true)
      .order('message_key', { ascending: true });

    if (error) throw error;

    // Return language-specific content
    const messages = data.map(msg => ({
      key: msg.message_key,
      title: language === 'es' ? msg.title_es : msg.title_en,
      content: language === 'es' ? msg.content_es : msg.content_en,
      isActive: msg.is_active
    }));

    return {
      success: true,
      messages
    };
  } catch (error) {
    console.error('Error fetching active system messages:', error);
    return {
      success: false,
      error: error.message,
      messages: []
    };
  }
};

/**
 * Get all system messages (admin only)
 * @returns {Array} List of all system messages
 */
export const getAllSystemMessages = async () => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('*')
      .order('message_key', { ascending: true });

    if (error) throw error;

    return {
      success: true,
      messages: data || []
    };
  } catch (error) {
    console.error('Error fetching all system messages:', error);
    return {
      success: false,
      error: error.message,
      messages: []
    };
  }
};

/**
 * Get system message by ID (admin only)
 * @param {string} messageId - System message ID
 * @returns {Object} System message
 */
export const getSystemMessageById = async (messageId) => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (error) throw error;

    return {
      success: true,
      message: data
    };
  } catch (error) {
    console.error('Error fetching system message by ID:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get payment instructions (convenience method)
 * @param {string} language - Language code ('es' or 'en')
 * @returns {Object} Payment instructions
 */
export const getPaymentInstructions = async (language = 'es') => {
  return await getSystemMessage('payment_instructions', language);
};

/**
 * Create system message (admin only)
 * @param {Object} messageData - System message information
 * @returns {Object} Created system message
 */
export const createSystemMessage = async (messageData) => {
  try {
    const message = {
      message_key: messageData.messageKey,
      title_es: messageData.titleEs || '',
      title_en: messageData.titleEn || '',
      content_es: messageData.contentEs,
      content_en: messageData.contentEn,
      is_active: messageData.isActive !== undefined ? messageData.isActive : true
    };

    const { data, error } = await supabase
      .from('system_messages')
      .insert(message)
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      message: data
    };
  } catch (error) {
    console.error('Error creating system message:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Update system message (admin only)
 * @param {string} messageId - System message ID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated system message
 */
export const updateSystemMessage = async (messageId, updates) => {
  try {
    const updateData = {};

    if (updates.messageKey !== undefined) {
      updateData.message_key = updates.messageKey;
    }
    if (updates.titleEs !== undefined) {
      updateData.title_es = updates.titleEs;
    }
    if (updates.titleEn !== undefined) {
      updateData.title_en = updates.titleEn;
    }
    if (updates.contentEs !== undefined) {
      updateData.content_es = updates.contentEs;
    }
    if (updates.contentEn !== undefined) {
      updateData.content_en = updates.contentEn;
    }
    if (updates.isActive !== undefined) {
      updateData.is_active = updates.isActive;
    }

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('system_messages')
      .update(updateData)
      .eq('id', messageId)
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      message: data
    };
  } catch (error) {
    console.error('Error updating system message:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Update system message by key (admin only)
 * @param {string} messageKey - Message key
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated system message
 */
export const updateSystemMessageByKey = async (messageKey, updates) => {
  try {
    const updateData = {};

    if (updates.titleEs !== undefined) {
      updateData.title_es = updates.titleEs;
    }
    if (updates.titleEn !== undefined) {
      updateData.title_en = updates.titleEn;
    }
    if (updates.contentEs !== undefined) {
      updateData.content_es = updates.contentEs;
    }
    if (updates.contentEn !== undefined) {
      updateData.content_en = updates.contentEn;
    }
    if (updates.isActive !== undefined) {
      updateData.is_active = updates.isActive;
    }

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('system_messages')
      .update(updateData)
      .eq('message_key', messageKey)
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      message: data
    };
  } catch (error) {
    console.error('Error updating system message by key:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Toggle system message active status (admin only)
 * @param {string} messageId - System message ID
 * @returns {Object} Updated system message
 */
export const toggleSystemMessageStatus = async (messageId) => {
  try {
    // Get current status
    const { data: message, error: fetchError } = await supabase
      .from('system_messages')
      .select('is_active')
      .eq('id', messageId)
      .single();

    if (fetchError) throw fetchError;

    // Toggle status
    const { data, error } = await supabase
      .from('system_messages')
      .update({
        is_active: !message.is_active,
        updated_at: new Date().toISOString()
      })
      .eq('id', messageId)
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      message: data
    };
  } catch (error) {
    console.error('Error toggling system message status:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Delete system message (admin only)
 * @param {string} messageId - System message ID
 * @returns {Object} Deletion result
 */
export const deleteSystemMessage = async (messageId) => {
  try {
    const { error } = await supabase
      .from('system_messages')
      .delete()
      .eq('id', messageId);

    if (error) throw error;

    return {
      success: true
    };
  } catch (error) {
    console.error('Error deleting system message:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Check if message key exists (admin only)
 * @param {string} messageKey - Message key to check
 * @returns {boolean} Whether key exists
 */
export const messageKeyExists = async (messageKey) => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('id')
      .eq('message_key', messageKey)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    return {
      success: true,
      exists: !!data
    };
  } catch (error) {
    console.error('Error checking message key existence:', error);
    return {
      success: false,
      exists: false
    };
  }
};

/**
 * Get message keys list (admin only)
 * @returns {Array} List of message keys
 */
export const getMessageKeys = async () => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('message_key, is_active')
      .order('message_key', { ascending: true });

    if (error) throw error;

    return {
      success: true,
      keys: data || []
    };
  } catch (error) {
    console.error('Error fetching message keys:', error);
    return {
      success: false,
      error: error.message,
      keys: []
    };
  }
};

/**
 * Bulk create system messages (admin only)
 * @param {Array} messages - Array of message objects
 * @returns {Object} Creation result
 */
export const bulkCreateSystemMessages = async (messages) => {
  try {
    const messageData = messages.map(msg => ({
      message_key: msg.messageKey,
      title_es: msg.titleEs || '',
      title_en: msg.titleEn || '',
      content_es: msg.contentEs,
      content_en: msg.contentEn,
      is_active: msg.isActive !== undefined ? msg.isActive : true
    }));

    const { data, error } = await supabase
      .from('system_messages')
      .insert(messageData)
      .select();

    if (error) throw error;

    return {
      success: true,
      messages: data,
      count: data.length
    };
  } catch (error) {
    console.error('Error bulk creating system messages:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get system messages statistics (admin only)
 * @returns {Object} Statistics
 */
export const getSystemMessagesStatistics = async () => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('is_active');

    if (error) throw error;

    const stats = {
      totalMessages: data.length,
      activeMessages: data.filter(m => m.is_active).length,
      inactiveMessages: data.filter(m => !m.is_active).length
    };

    return {
      success: true,
      statistics: stats
    };
  } catch (error) {
    console.error('Error fetching system messages statistics:', error);
    return {
      success: false,
      error: error.message
    };
  }
};
