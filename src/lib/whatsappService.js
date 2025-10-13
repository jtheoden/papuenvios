/**
 * WhatsApp Service
 * Handles WhatsApp notification integration for orders and admin notifications
 */

/**
 * Get WhatsApp configuration from environment or settings
 * @returns {Object} WhatsApp configuration
 */
const getWhatsAppConfig = () => {
  // Configuration can be loaded from environment variables or system settings
  return {
    adminPhone: import.meta.env.VITE_WHATSAPP_ADMIN_PHONE || '+53XXXXXXXXX',
    supportPhone: import.meta.env.VITE_WHATSAPP_SUPPORT_PHONE || '+53XXXXXXXXX',
    businessName: import.meta.env.VITE_BUSINESS_NAME || 'PapuEnvíos'
  };
};

/**
 * Format phone number for WhatsApp
 * Removes spaces, dashes, and country code prefixes
 * @param {string} phone - Phone number
 * @returns {string} Formatted phone number
 */
export const formatPhoneForWhatsApp = (phone) => {
  if (!phone) return '';

  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  // Remove leading + if present
  if (cleaned.startsWith('1')) {
    // US/Canada number
    cleaned = cleaned.substring(1);
  } else if (cleaned.startsWith('53')) {
    // Cuban number - keep as is
  } else if (cleaned.startsWith('0')) {
    // Remove leading 0
    cleaned = cleaned.substring(1);
  }

  return cleaned;
};

/**
 * Generate WhatsApp message URL
 * @param {string} phone - Recipient phone number
 * @param {string} message - Pre-filled message
 * @returns {string} WhatsApp URL
 */
export const generateWhatsAppURL = (phone, message = '') => {
  const formattedPhone = formatPhoneForWhatsApp(phone);
  const encodedMessage = encodeURIComponent(message);

  // Use WhatsApp API URL format
  // Works on both mobile and desktop
  return `https://wa.me/${formattedPhone}?text=${encodedMessage}`;
};

/**
 * Open WhatsApp chat with pre-filled message
 * @param {string} phone - Recipient phone number
 * @param {string} message - Pre-filled message
 */
export const openWhatsAppChat = (phone, message = '') => {
  const url = generateWhatsAppURL(phone, message);
  window.open(url, '_blank');
};

/**
 * Notify admin about new payment submission
 * Opens WhatsApp directly from user's device
 * @param {Object} order - Order details
 * @param {string} adminPhone - Admin phone from settings
 * @param {string} language - Language for message ('es' or 'en')
 */
export const notifyAdminNewPayment = (order, adminPhone, language = 'es') => {
  if (!adminPhone) {
    console.error('Admin WhatsApp number not configured');
    alert('Número de WhatsApp del administrador no configurado. Contacte al soporte.');
    return;
  }

  const config = getWhatsAppConfig();

  // Build items list
  const itemsList = order.order_items?.map((item, i) =>
    `${i + 1}. ${item.item_name_es || item.item_name_en} (x${item.quantity})`
  ).join('\n   ') || 'Sin items';

  const messages = {
    es: `🆕 *Nueva Orden Registrada*\n\n` +
        `📋 *Orden:* ${order.order_number}\n` +
        `👤 *Cliente:* ${order.user_name || order.user_profile?.full_name || 'N/A'}\n` +
        `📧 *Email:* ${order.user_email || order.user_profile?.email || 'N/A'}\n\n` +
        `📦 *Items:*\n   ${itemsList}\n\n` +
        `💰 *Total:* ${order.total_amount} ${order.currency?.code || order.currencies?.code || 'USD'}\n` +
        `💳 *Método de Pago:* ${order.payment_method || 'N/A'}\n` +
        `📍 *Provincia:* ${order.shipping_zone?.province_name || order.shipping_address || 'N/A'}\n\n` +
        `🔗 *Ver en sistema:*\n${window.location.origin}/dashboard?tab=orders\n\n` +
        `_Mensaje desde PapuEnvíos_`,

    en: `🆕 *New Order Registered*\n\n` +
        `📋 *Order:* ${order.order_number}\n` +
        `👤 *Customer:* ${order.user_name || order.user_profile?.full_name || 'N/A'}\n` +
        `📧 *Email:* ${order.user_email || order.user_profile?.email || 'N/A'}\n\n` +
        `📦 *Items:*\n   ${itemsList}\n\n` +
        `💰 *Total:* ${order.total_amount} ${order.currency?.code || order.currencies?.code || 'USD'}\n` +
        `💳 *Payment Method:* ${order.payment_method || 'N/A'}\n` +
        `📍 *Province:* ${order.shipping_zone?.province_name || order.shipping_address || 'N/A'}\n\n` +
        `🔗 *View in system:*\n${window.location.origin}/dashboard?tab=orders\n\n` +
        `_Message from PapuEnvíos_`
  };

  const url = generateWhatsAppURL(adminPhone, messages[language] || messages.es);
  window.open(url, '_blank');
};

/**
 * Send payment validation notification to customer
 * @param {Object} order - Order details
 * @param {string} customerPhone - Customer phone number
 * @param {string} language - Language for message ('es' or 'en')
 * @returns {string} WhatsApp URL
 */
export const notifyCustomerPaymentValidated = (order, customerPhone, language = 'es') => {
  const config = getWhatsAppConfig();

  const messages = {
    es: `✅ *Pago Validado - ${config.businessName}*\n\n` +
        `Hola! Tu pago ha sido validado exitosamente.\n\n` +
        `📋 Pedido: ${order.order_number}\n` +
        `💰 Total: ${order.total_amount} ${order.currency?.code || 'USD'}\n` +
        `📦 Estado: En proceso\n\n` +
        `Tu pedido está siendo preparado y pronto será enviado.\n` +
        `Te notificaremos cuando esté en camino.\n\n` +
        `Gracias por tu compra! 🎉`,

    en: `✅ *Payment Validated - ${config.businessName}*\n\n` +
        `Hello! Your payment has been successfully validated.\n\n` +
        `📋 Order: ${order.order_number}\n` +
        `💰 Total: ${order.total_amount} ${order.currency?.code || 'USD'}\n` +
        `📦 Status: Processing\n\n` +
        `Your order is being prepared and will be shipped soon.\n` +
        `We'll notify you when it's on its way.\n\n` +
        `Thank you for your purchase! 🎉`
  };

  return generateWhatsAppURL(customerPhone, messages[language] || messages.es);
};

/**
 * Send payment rejection notification to customer
 * @param {Object} order - Order details
 * @param {string} customerPhone - Customer phone number
 * @param {string} language - Language for message ('es' or 'en')
 * @returns {string} WhatsApp URL
 */
export const notifyCustomerPaymentRejected = (order, customerPhone, language = 'es') => {
  const config = getWhatsAppConfig();

  const messages = {
    es: `❌ *Pago No Validado - ${config.businessName}*\n\n` +
        `Hola, lamentablemente no pudimos validar tu pago.\n\n` +
        `📋 Pedido: ${order.order_number}\n` +
        `💰 Total: ${order.total_amount} ${order.currency?.code || 'USD'}\n\n` +
        `📝 Motivo: ${order.rejection_reason || 'No especificado'}\n\n` +
        `Por favor, contacta con nosotros para resolver esta situación.\n` +
        `Estamos aquí para ayudarte.`,

    en: `❌ *Payment Not Validated - ${config.businessName}*\n\n` +
        `Hello, unfortunately we couldn't validate your payment.\n\n` +
        `📋 Order: ${order.order_number}\n` +
        `💰 Total: ${order.total_amount} ${order.currency?.code || 'USD'}\n\n` +
        `📝 Reason: ${order.rejection_reason || 'Not specified'}\n\n` +
        `Please contact us to resolve this situation.\n` +
        `We're here to help.`
  };

  return generateWhatsAppURL(customerPhone, messages[language] || messages.es);
};

/**
 * Generate support chat message for customer
 * @param {Object} order - Optional order context
 * @param {string} language - Language for message ('es' or 'en')
 * @returns {string} WhatsApp URL
 */
export const openSupportChat = (order = null, language = 'es') => {
  const config = getWhatsAppConfig();

  let message = '';

  if (order) {
    const messages = {
      es: `Hola! Necesito ayuda con mi pedido ${order.order_number}.\n\n`,
      en: `Hello! I need help with my order ${order.order_number}.\n\n`
    };
    message = messages[language] || messages.es;
  } else {
    const messages = {
      es: `Hola! Necesito ayuda con ${config.businessName}.\n\n`,
      en: `Hello! I need help with ${config.businessName}.\n\n`
    };
    message = messages[language] || messages.es;
  }

  return generateWhatsAppURL(config.supportPhone, message);
};

/**
 * Open support chat in new window
 * @param {Object} order - Optional order context
 * @param {string} language - Language for message ('es' or 'en')
 */
export const contactSupport = (order = null, language = 'es') => {
  const url = openSupportChat(order, language);
  window.open(url, '_blank');
};

/**
 * Generate order confirmation message for customer
 * @param {Object} order - Order details
 * @param {string} language - Language for message ('es' or 'en')
 * @returns {string} Message text
 */
export const generateOrderConfirmationMessage = (order, language = 'es') => {
  const config = getWhatsAppConfig();

  const messages = {
    es: `✅ *Pedido Confirmado - ${config.businessName}*\n\n` +
        `Gracias por tu pedido!\n\n` +
        `📋 Número de pedido: ${order.order_number}\n` +
        `💰 Total: ${order.total_amount} ${order.currency?.code || 'USD'}\n` +
        `📍 Provincia: ${order.shipping_zone?.province_name || 'N/A'}\n` +
        `📦 Estado: Pendiente de pago\n\n` +
        `📸 Por favor, envía el comprobante de pago para procesar tu pedido.\n\n` +
        `Métodos de pago aceptados:\n` +
        `💳 Zelle\n\n` +
        `¿Necesitas ayuda? Contáctanos!`,

    en: `✅ *Order Confirmed - ${config.businessName}*\n\n` +
        `Thank you for your order!\n\n` +
        `📋 Order number: ${order.order_number}\n` +
        `💰 Total: ${order.total_amount} ${order.currency?.code || 'USD'}\n` +
        `📍 Province: ${order.shipping_zone?.province_name || 'N/A'}\n` +
        `📦 Status: Pending payment\n\n` +
        `📸 Please send payment proof to process your order.\n\n` +
        `Accepted payment methods:\n` +
        `💳 Zelle\n\n` +
        `Need help? Contact us!`
  };

  return messages[language] || messages.es;
};

/**
 * Notify admin about low stock product
 * @param {Object} product - Product details
 * @param {number} currentStock - Current available quantity
 * @param {string} language - Language for message ('es' or 'en')
 * @returns {string} WhatsApp URL
 */
export const notifyAdminLowStock = (product, currentStock, language = 'es') => {
  const config = getWhatsAppConfig();

  const messages = {
    es: `⚠️ *Alerta de Stock Bajo - ${config.businessName}*\n\n` +
        `📦 Producto: ${product.name_es}\n` +
        `🔢 SKU: ${product.sku}\n` +
        `📊 Stock disponible: ${currentStock}\n` +
        `🔴 Alerta mínima: ${product.min_stock_alert}\n\n` +
        `Es necesario reponer el inventario pronto.`,

    en: `⚠️ *Low Stock Alert - ${config.businessName}*\n\n` +
        `📦 Product: ${product.name_en}\n` +
        `🔢 SKU: ${product.sku}\n` +
        `📊 Available stock: ${currentStock}\n` +
        `🔴 Minimum alert: ${product.min_stock_alert}\n\n` +
        `Inventory needs to be replenished soon.`
  };

  return generateWhatsAppURL(config.adminPhone, messages[language] || messages.es);
};

/**
 * Generate shipping notification message
 * @param {Object} order - Order details
 * @param {string} trackingNumber - Tracking number
 * @param {string} language - Language for message ('es' or 'en')
 * @returns {string} Message text
 */
export const generateShippingNotification = (order, trackingNumber, language = 'es') => {
  const config = getWhatsAppConfig();

  const messages = {
    es: `📦 *Pedido Enviado - ${config.businessName}*\n\n` +
        `Tu pedido está en camino!\n\n` +
        `📋 Pedido: ${order.order_number}\n` +
        `🚚 Número de seguimiento: ${trackingNumber}\n` +
        `📍 Destino: ${order.shipping_zone?.province_name || 'N/A'}\n` +
        `📅 Entrega estimada: ${order.estimated_delivery ? new Date(order.estimated_delivery).toLocaleDateString('es-CU') : 'Próximamente'}\n\n` +
        `Recibirás tu pedido pronto. ¡Gracias por tu compra! 🎉`,

    en: `📦 *Order Shipped - ${config.businessName}*\n\n` +
        `Your order is on its way!\n\n` +
        `📋 Order: ${order.order_number}\n` +
        `🚚 Tracking number: ${trackingNumber}\n` +
        `📍 Destination: ${order.shipping_zone?.province_name || 'N/A'}\n` +
        `📅 Estimated delivery: ${order.estimated_delivery ? new Date(order.estimated_delivery).toLocaleDateString('en-US') : 'Soon'}\n\n` +
        `You'll receive your order soon. Thank you for your purchase! 🎉`
  };

  return messages[language] || messages.es;
};

/**
 * Copy message to clipboard and open WhatsApp
 * @param {string} phone - Phone number
 * @param {string} message - Message to send
 */
export const copyAndOpenWhatsApp = (phone, message) => {
  // Copy message to clipboard
  if (navigator.clipboard) {
    navigator.clipboard.writeText(message).catch(err => {
      console.error('Failed to copy message:', err);
    });
  }

  // Open WhatsApp
  openWhatsAppChat(phone, message);
};

/**
 * Get WhatsApp support link for UI display
 * @returns {string} WhatsApp support URL
 */
export const getWhatsAppSupportLink = () => {
  const config = getWhatsAppConfig();
  return generateWhatsAppURL(config.supportPhone, '');
};

/**
 * Get WhatsApp admin link
 * @returns {string} WhatsApp admin URL
 */
export const getWhatsAppAdminLink = () => {
  const config = getWhatsAppConfig();
  return generateWhatsAppURL(config.adminPhone, '');
};

/**
 * Validate phone number format
 * @param {string} phone - Phone number to validate
 * @returns {boolean} Whether phone is valid
 */
export const isValidPhoneNumber = (phone) => {
  if (!phone) return false;

  const cleaned = phone.replace(/\D/g, '');

  // Check if it's a valid length (Cuban numbers are typically 8 digits after country code)
  // Allow 8-15 digits for international flexibility
  return cleaned.length >= 8 && cleaned.length <= 15;
};
