/**
 * Style Utilities for System-Wide Visual Personalization
 * Provides centralized styling functions based on visualSettings from BusinessContext
 */

/**
 * Get application background style
 */
export const getBackgroundStyle = (visualSettings) => {
  if (!visualSettings) return {};
  return {
    backgroundColor: visualSettings.appBgColor || '#f8f9fa'
  };
};

/**
 * Get card/container style
 */
export const getCardStyle = (visualSettings) => {
  if (!visualSettings) return {};
  return {
    backgroundColor: visualSettings.cardBgColor || '#ffffff',
    borderColor: visualSettings.borderColor || '#e5e7eb'
  };
};

/**
 * Get primary button styles based on visual settings
 * @param {Object} visualSettings - The visual settings object from BusinessContext
 * @returns {Object} - Style object for primary button elements
 */
export const getPrimaryButtonStyle = (visualSettings) => {
  if (!visualSettings) return {};

  return {
    background: visualSettings.useGradient
      ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
      : visualSettings.buttonBgColor || visualSettings.primaryColor || '#2563eb',
    color: visualSettings.buttonTextColor || '#ffffff',
    border: 'none'
  };
};

/**
 * Get secondary/outline button style
 */
export const getSecondaryButtonStyle = (visualSettings) => {
  if (!visualSettings) return {};
  return {
    backgroundColor: 'transparent',
    color: visualSettings.primaryColor || '#2563eb',
    borderColor: visualSettings.primaryColor || '#2563eb',
    borderWidth: '1px',
    borderStyle: 'solid'
  };
};

/**
 * Get destructive button styles based on visual settings
 * @param {Object} visualSettings - The visual settings object from BusinessContext
 * @returns {Object} - Style object for destructive button elements
 */
export const getDestructiveButtonStyle = (visualSettings) => {
  if (!visualSettings) return {};

  return {
    backgroundColor: visualSettings.destructiveBgColor || '#dc2626',
    color: visualSettings.destructiveTextColor || '#ffffff',
    borderColor: visualSettings.destructiveBgColor || '#dc2626'
  };
};

/**
 * Get heading/title styles based on visual settings
 * @param {Object} visualSettings - The visual settings object from BusinessContext
 * @returns {Object} - Style object for heading elements
 */
export const getHeadingStyle = (visualSettings) => {
  if (!visualSettings) return {};

  if (visualSettings.useHeadingGradient || visualSettings.useGradient) {
    return {
      backgroundImage: `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`,
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text'
    };
  }

  return {
    color: visualSettings.headingColor || visualSettings.primaryColor || '#1f2937'
  };
};

/**
 * Get text styles for primary and secondary text
 */
export const getTextStyle = (visualSettings, variant = 'primary') => {
  if (!visualSettings) return {};

  const styles = {
    primary: {
      color: visualSettings.textPrimaryColor || '#1f2937'
    },
    secondary: {
      color: visualSettings.textSecondaryColor || '#6b7280'
    },
    muted: {
      color: visualSettings.textMutedColor || '#9ca3af'
    }
  };
  return styles[variant] || styles.primary;
};

/**
 * Get pill/badge style
 */
export const getPillStyle = (visualSettings, variant = 'default') => {
  if (!visualSettings) return {};

  const variants = {
    default: {
      backgroundColor: visualSettings.pillBgColor || '#e5e7eb',
      color: visualSettings.pillTextColor || '#374151'
    },
    success: {
      backgroundColor: `${visualSettings.successColor || '#10b981'}20`,
      color: visualSettings.successColor || '#10b981',
      borderColor: visualSettings.successColor || '#10b981'
    },
    warning: {
      backgroundColor: `${visualSettings.warningColor || '#f59e0b'}20`,
      color: visualSettings.warningColor || '#f59e0b',
      borderColor: visualSettings.warningColor || '#f59e0b'
    },
    error: {
      backgroundColor: `${visualSettings.errorColor || '#ef4444'}20`,
      color: visualSettings.errorColor || '#ef4444',
      borderColor: visualSettings.errorColor || '#ef4444'
    },
    info: {
      backgroundColor: `${visualSettings.primaryColor || '#2563eb'}20`,
      color: visualSettings.primaryColor || '#2563eb',
      borderColor: visualSettings.primaryColor || '#2563eb'
    }
  };
  return variants[variant] || variants.default;
};

/**
 * Get status color for orders, payments, etc.
 */
export const getStatusColor = (status, visualSettings) => {
  if (!visualSettings) return '#6b7280';

  const colors = {
    validated: visualSettings.successColor || '#10b981',
    pending: visualSettings.warningColor || '#f59e0b',
    rejected: visualSettings.errorColor || '#ef4444',
    cancelled: visualSettings.textMutedColor || '#9ca3af',
    processing: visualSettings.primaryColor || '#2563eb',
    completed: visualSettings.successColor || '#10b981'
  };
  return colors[status] || visualSettings.textSecondaryColor || '#6b7280';
};

/**
 * Get status style (background + text) for badges/pills
 */
export const getStatusStyle = (status, visualSettings) => {
  if (!visualSettings) return {};

  const statusColorMap = {
    validated: 'success',
    pending: 'warning',
    rejected: 'error',
    cancelled: 'default',
    processing: 'info',
    completed: 'success'
  };

  const variant = statusColorMap[status] || 'default';
  return getPillStyle(visualSettings, variant);
};

/**
 * Get icon/accent background style
 */
export const getIconBackgroundStyle = (visualSettings) => {
  if (!visualSettings) return {};
  return {
    background: visualSettings.useGradient
      ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
      : visualSettings.primaryColor || '#2563eb'
  };
};

/**
 * Get input/form field style
 */
export const getInputStyle = (visualSettings) => {
  if (!visualSettings) return {};
  return {
    backgroundColor: visualSettings.inputBgColor || '#ffffff',
    borderColor: visualSettings.inputBorderColor || '#d1d5db',
    color: visualSettings.textPrimaryColor || '#1f2937'
  };
};

/**
 * Get input focus style
 */
export const getInputFocusStyle = (visualSettings) => {
  if (!visualSettings) return {};
  return {
    borderColor: visualSettings.primaryColor || '#2563eb',
    boxShadow: `0 0 0 3px ${visualSettings.primaryColor || '#2563eb'}20`
  };
};

/**
 * Get link style
 */
export const getLinkStyle = (visualSettings) => {
  if (!visualSettings) return {};
  return {
    color: visualSettings.primaryColor || '#2563eb',
    textDecoration: 'underline'
  };
};

/**
 * Get hover background color (for interactive elements)
 */
export const getHoverBackgroundColor = (visualSettings) => {
  if (!visualSettings) return '#f3f4f6';
  const primaryColor = visualSettings.primaryColor || '#2563eb';
  // Add 15% opacity for subtle hover effect
  return `${primaryColor}15`;
};

/**
 * Get divider/border style
 */
export const getDividerStyle = (visualSettings) => {
  if (!visualSettings) return {};
  return {
    borderColor: visualSettings.borderColor || '#e5e7eb'
  };
};

/**
 * Get alert/notification style
 */
export const getAlertStyle = (visualSettings, variant = 'info') => {
  if (!visualSettings) return {};

  const variants = {
    success: {
      backgroundColor: `${visualSettings.successColor || '#10b981'}10`,
      borderColor: visualSettings.successColor || '#10b981',
      color: visualSettings.successColor || '#10b981'
    },
    warning: {
      backgroundColor: `${visualSettings.warningColor || '#f59e0b'}10`,
      borderColor: visualSettings.warningColor || '#f59e0b',
      color: visualSettings.warningColor || '#f59e0b'
    },
    error: {
      backgroundColor: `${visualSettings.errorColor || '#ef4444'}10`,
      borderColor: visualSettings.errorColor || '#ef4444',
      color: visualSettings.errorColor || '#ef4444'
    },
    info: {
      backgroundColor: `${visualSettings.primaryColor || '#2563eb'}10`,
      borderColor: visualSettings.primaryColor || '#2563eb',
      color: visualSettings.primaryColor || '#2563eb'
    }
  };
  return variants[variant] || variants.info;
};

/**
 * Get button hover handlers
 * @param {Object} visualSettings - The visual settings object from BusinessContext
 * @param {string} type - Button type: 'primary', 'destructive'
 * @returns {Object} - Object with onMouseEnter and onMouseLeave handlers
 */
export const getButtonHoverHandlers = (visualSettings, type = 'primary') => {
  if (!visualSettings) return {};

  const hoverColor = type === 'destructive'
    ? visualSettings.destructiveHoverBgColor || '#b91c1c'
    : visualSettings.buttonHoverBgColor || '#1d4ed8';

  const normalColor = type === 'destructive'
    ? visualSettings.destructiveBgColor || '#dc2626'
    : visualSettings.buttonBgColor || '#2563eb';

  return {
    onMouseEnter: (e) => {
      e.currentTarget.style.backgroundColor = hoverColor;
    },
    onMouseLeave: (e) => {
      e.currentTarget.style.backgroundColor = normalColor;
    }
  };
};

/**
 * Check if a color is dark (for contrast calculation)
 */
export const isColorDark = (hexColor) => {
  if (!hexColor) return false;

  // Remove # if present
  const hex = hexColor.replace('#', '');

  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance < 0.5;
};

/**
 * Get contrasting text color (white or black) based on background
 */
export const getContrastTextColor = (backgroundColor) => {
  return isColorDark(backgroundColor) ? '#ffffff' : '#000000';
};

/**
 * Apply opacity to hex color
 */
export const hexWithOpacity = (hexColor, opacity) => {
  if (!hexColor) return 'transparent';

  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};
