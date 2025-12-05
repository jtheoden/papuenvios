/**
 * System Message Service
 * Handles configurable bilingual system messages (payment instructions, announcements, etc.)
 */

import { supabase } from './supabase';
import {
  handleError, logError, createValidationError,
  createNotFoundError, parseSupabaseError, ERROR_CODES
} from './errorHandler';

/**
 * Get system message by key
 * @param {string} messageKey - Message key identifier
 * @param {string} language - Language code ('es' or 'en')
 * @returns {Promise<Object>} System message with language-specific content
 * @throws {AppError} VALIDATION_FAILED if messageKey missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const getSystemMessage = async (messageKey, language = 'es') => {
  try {
    if (!messageKey) {
      throw createValidationError({ messageKey: 'Message key is required' }, 'Missing message key');
    }

    const { data, error } = await supabase
      .from('system_messages')
      .select('*')
      .eq('message_key', messageKey)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('System message', messageKey);
      }
      throw parseSupabaseError(error);
    }

    return {
      key: data.message_key,
      title: language === 'es' ? data.title_es : data.title_en,
      content: language === 'es' ? data.content_es : data.content_en,
      isActive: data.is_active
    };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getSystemMessage', messageKey });
    logError(appError, { operation: 'getSystemMessage', messageKey });
    throw appError;
  }
};

/**
 * Get all active system messages
 * @param {string} language - Language code ('es' or 'en')
 * @returns {Promise<Array>} List of active system messages with language-specific content
 * @throws {AppError} DB_ERROR if query fails
 */
export const getActiveSystemMessages = async (language = 'es') => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('*')
      .eq('is_active', true)
      .order('message_key', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return (data || []).map(msg => ({
      key: msg.message_key,
      title: language === 'es' ? msg.title_es : msg.title_en,
      content: language === 'es' ? msg.content_es : msg.content_en,
      isActive: msg.is_active
    }));
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getActiveSystemMessages' });
    logError(appError, { operation: 'getActiveSystemMessages' });
    throw appError;
  }
};

/**
 * Get all system messages (admin only)
 * @returns {Promise<Array>} List of all system messages
 * @throws {AppError} DB_ERROR if query fails
 */
export const getAllSystemMessages = async () => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('*')
      .order('message_key', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getAllSystemMessages' });
    logError(appError, { operation: 'getAllSystemMessages' });
    throw appError;
  }
};

/**
 * Get system message by ID (admin only)
 * @param {string} messageId - System message ID
 * @returns {Promise<Object>} System message
 * @throws {AppError} VALIDATION_FAILED if messageId missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const getSystemMessageById = async (messageId) => {
  try {
    if (!messageId) {
      throw createValidationError({ messageId: 'Message ID is required' }, 'Missing message ID');
    }

    const { data, error } = await supabase
      .from('system_messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('System message', messageId);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getSystemMessageById', messageId });
    logError(appError, { operation: 'getSystemMessageById', messageId });
    throw appError;
  }
};

/**
 * Get payment instructions (convenience method)
 * @param {string} language - Language code ('es' or 'en')
 * @returns {Promise<Object>} Payment instructions with language-specific content
 * @throws {AppError} NOT_FOUND if payment instructions not configured, DB_ERROR on failure
 */
export const getPaymentInstructions = async (language = 'es') => {
  return await getSystemMessage('payment_instructions', language);
};

/**
 * Create system message (admin only)
 * @param {Object} messageData - System message information
 * @param {string} messageData.messageKey - Unique message key identifier
 * @param {string} messageData.contentEs - Spanish content
 * @param {string} messageData.contentEn - English content
 * @param {string} [messageData.titleEs] - Spanish title (optional)
 * @param {string} [messageData.titleEn] - English title (optional)
 * @param {boolean} [messageData.isActive] - Active status (default: true)
 * @returns {Promise<Object>} Created system message
 * @throws {AppError} VALIDATION_FAILED if required fields missing, DB_ERROR on failure
 */
export const createSystemMessage = async (messageData) => {
  try {
    if (!messageData.messageKey) {
      throw createValidationError({ messageKey: 'Message key is required' }, 'Missing required field');
    }
    if (!messageData.contentEs && !messageData.contentEn) {
      throw createValidationError({ content: 'At least one language content is required' }, 'Missing content');
    }

    const message = {
      message_key: messageData.messageKey,
      title_es: messageData.titleEs || '',
      title_en: messageData.titleEn || '',
      content_es: messageData.contentEs || '',
      content_en: messageData.contentEn || '',
      is_active: messageData.isActive !== undefined ? messageData.isActive : true
    };

    const { data, error } = await supabase
      .from('system_messages')
      .insert(message)
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createSystemMessage', messageKey: messageData.messageKey });
    logError(appError, { operation: 'createSystemMessage', messageKey: messageData.messageKey });
    throw appError;
  }
};

/**
 * Update system message (admin only)
 * @param {string} messageId - System message ID
 * @param {Object} updates - Fields to update
 * @param {string} [updates.messageKey] - Message key
 * @param {string} [updates.titleEs] - Spanish title
 * @param {string} [updates.titleEn] - English title
 * @param {string} [updates.contentEs] - Spanish content
 * @param {string} [updates.contentEn] - English content
 * @param {boolean} [updates.isActive] - Active status
 * @returns {Promise<Object>} Updated system message
 * @throws {AppError} VALIDATION_FAILED if messageId missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const updateSystemMessage = async (messageId, updates) => {
  try {
    if (!messageId) {
      throw createValidationError({ messageId: 'Message ID is required' }, 'Missing message ID');
    }

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

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('System message', messageId);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateSystemMessage', messageId });
    logError(appError, { operation: 'updateSystemMessage', messageId });
    throw appError;
  }
};

/**
 * Update system message by key (admin only)
 * @param {string} messageKey - Message key
 * @param {Object} updates - Fields to update
 * @param {string} [updates.titleEs] - Spanish title
 * @param {string} [updates.titleEn] - English title
 * @param {string} [updates.contentEs] - Spanish content
 * @param {string} [updates.contentEn] - English content
 * @param {boolean} [updates.isActive] - Active status
 * @returns {Promise<Object>} Updated system message
 * @throws {AppError} VALIDATION_FAILED if messageKey missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const updateSystemMessageByKey = async (messageKey, updates) => {
  try {
    if (!messageKey) {
      throw createValidationError({ messageKey: 'Message key is required' }, 'Missing message key');
    }

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

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('System message', messageKey);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateSystemMessageByKey', messageKey });
    logError(appError, { operation: 'updateSystemMessageByKey', messageKey });
    throw appError;
  }
};

/**
 * Toggle system message active status (admin only)
 * @param {string} messageId - System message ID
 * @returns {Promise<Object>} Updated system message with toggled status
 * @throws {AppError} VALIDATION_FAILED if messageId missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const toggleSystemMessageStatus = async (messageId) => {
  try {
    if (!messageId) {
      throw createValidationError({ messageId: 'Message ID is required' }, 'Missing message ID');
    }

    // Get current status
    const { data: message, error: fetchError } = await supabase
      .from('system_messages')
      .select('is_active')
      .eq('id', messageId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        throw createNotFoundError('System message', messageId);
      }
      throw parseSupabaseError(fetchError);
    }

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

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'toggleSystemMessageStatus', messageId });
    logError(appError, { operation: 'toggleSystemMessageStatus', messageId });
    throw appError;
  }
};

/**
 * Delete system message (admin only)
 * @param {string} messageId - System message ID
 * @returns {Promise<void>}
 * @throws {AppError} VALIDATION_FAILED if messageId missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const deleteSystemMessage = async (messageId) => {
  try {
    if (!messageId) {
      throw createValidationError({ messageId: 'Message ID is required' }, 'Missing message ID');
    }

    // Check existence first
    const { data: exists, error: checkError } = await supabase
      .from('system_messages')
      .select('id')
      .eq('id', messageId)
      .single();

    if (checkError) {
      if (checkError.code === 'PGRST116') {
        throw createNotFoundError('System message', messageId);
      }
      throw parseSupabaseError(checkError);
    }

    const { error } = await supabase
      .from('system_messages')
      .delete()
      .eq('id', messageId);

    if (error) {
      throw parseSupabaseError(error);
    }
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'deleteSystemMessage', messageId });
    logError(appError, { operation: 'deleteSystemMessage', messageId });
    throw appError;
  }
};

/**
 * Check if message key exists (admin only)
 * @param {string} messageKey - Message key to check
 * @returns {Promise<boolean>} Whether key exists
 * @throws {AppError} VALIDATION_FAILED if messageKey missing, DB_ERROR on failure
 */
export const messageKeyExists = async (messageKey) => {
  try {
    if (!messageKey) {
      throw createValidationError({ messageKey: 'Message key is required' }, 'Missing message key');
    }

    const { data, error } = await supabase
      .from('system_messages')
      .select('id')
      .eq('message_key', messageKey)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return false;
      }
      throw parseSupabaseError(error);
    }

    return !!data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'messageKeyExists', messageKey });
    logError(appError, { operation: 'messageKeyExists', messageKey });
    throw appError;
  }
};

/**
 * Get message keys list (admin only)
 * @returns {Promise<Array>} List of message keys with active status
 * @throws {AppError} DB_ERROR if query fails
 */
export const getMessageKeys = async () => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('message_key, is_active')
      .order('message_key', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getMessageKeys' });
    logError(appError, { operation: 'getMessageKeys' });
    throw appError;
  }
};

/**
 * Bulk create system messages (admin only)
 * @param {Array} messages - Array of message objects
 * @param {string} messages[].messageKey - Unique message key identifier
 * @param {string} messages[].contentEs - Spanish content
 * @param {string} messages[].contentEn - English content
 * @param {string} [messages[].titleEs] - Spanish title (optional)
 * @param {string} [messages[].titleEn] - English title (optional)
 * @param {boolean} [messages[].isActive] - Active status (default: true)
 * @returns {Promise<Array>} Created system messages
 * @throws {AppError} VALIDATION_FAILED if messages array invalid, DB_ERROR on failure
 */
export const bulkCreateSystemMessages = async (messages) => {
  try {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw createValidationError({ messages: 'Messages array is required and must not be empty' }, 'Invalid messages');
    }

    const messageData = messages.map(msg => {
      if (!msg.messageKey) {
        throw createValidationError({ messageKey: 'Message key is required for all messages' }, 'Missing required field');
      }
      return {
        message_key: msg.messageKey,
        title_es: msg.titleEs || '',
        title_en: msg.titleEn || '',
        content_es: msg.contentEs || '',
        content_en: msg.contentEn || '',
        is_active: msg.isActive !== undefined ? msg.isActive : true
      };
    });

    const { data, error } = await supabase
      .from('system_messages')
      .insert(messageData)
      .select();

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'bulkCreateSystemMessages', count: messages?.length });
    logError(appError, { operation: 'bulkCreateSystemMessages', count: messages?.length });
    throw appError;
  }
};

/**
 * Get system messages statistics (admin only)
 * @returns {Promise<Object>} Statistics object with counts
 * @returns {number} .totalMessages - Total system messages count
 * @returns {number} .activeMessages - Active messages count
 * @returns {number} .inactiveMessages - Inactive messages count
 * @throws {AppError} DB_ERROR if query fails
 */
export const getSystemMessagesStatistics = async () => {
  try {
    const { data, error } = await supabase
      .from('system_messages')
      .select('is_active');

    if (error) {
      throw parseSupabaseError(error);
    }

    const stats = {
      totalMessages: (data || []).length,
      activeMessages: (data || []).filter(m => m.is_active).length,
      inactiveMessages: (data || []).filter(m => !m.is_active).length
    };

    return stats;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getSystemMessagesStatistics' });
    logError(appError, { operation: 'getSystemMessagesStatistics' });
    throw appError;
  }
};
