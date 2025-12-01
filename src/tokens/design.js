/**
 * Design Tokens System
 * Centralized color, spacing, typography, and shadow definitions
 * Use these tokens instead of hardcoded values to ensure consistency
 */

// ============================================================================
// COLOR TOKENS
// ============================================================================

export const colors = {
  // Primary Colors
  primary: {
    light: '#3b82f6',      // bg-blue-400
    main: '#2563eb',       // bg-blue-600
    dark: '#1d4ed8'        // bg-blue-700
  },

  // Semantic Colors
  success: {
    light: '#d1fae5',      // bg-green-100
    main: '#10b981',       // green-600
    dark: '#059669'        // green-700
  },

  warning: {
    light: '#fef3c7',      // bg-yellow-100
    main: '#f59e0b',       // yellow-500
    dark: '#d97706'        // yellow-600
  },

  error: {
    light: '#fee2e2',      // bg-red-100
    main: '#ef4444',       // red-500
    dark: '#dc2626'        // red-600
  },

  info: {
    light: '#e0f2fe',      // bg-sky-100
    main: '#0ea5e9',       // sky-500
    dark: '#0284c7'        // sky-600
  },

  // Neutral/Grayscale
  neutral: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827'
  },

  // Status-specific backgrounds
  background: {
    primary: '#ffffff',
    secondary: '#f9fafb',
    tertiary: '#f3f4f6',
    hover: '#f0f4f8'
  }
};

// ============================================================================
// SPACING SCALE
// Base unit: 4px (Tailwind default)
// ============================================================================

export const spacing = {
  xs: '4px',      // Tight spacing for dense layouts
  sm: '8px',      // Between form elements
  md: '12px',     // Between components
  lg: '16px',     // Default padding/margin
  xl: '24px',     // Section spacing
  '2xl': '32px',  // Page margins
  '3xl': '48px'   // Major sections
};

// ============================================================================
// TYPOGRAPHY SCALE
// ============================================================================

export const typography = {
  h1: {
    fontSize: '32px',
    fontWeight: 700,
    lineHeight: 1.2,
    letterSpacing: '-0.02em'
  },
  h2: {
    fontSize: '24px',
    fontWeight: 600,
    lineHeight: 1.3,
    letterSpacing: '-0.01em'
  },
  h3: {
    fontSize: '20px',
    fontWeight: 600,
    lineHeight: 1.3
  },
  h4: {
    fontSize: '18px',
    fontWeight: 600,
    lineHeight: 1.4
  },
  body: {
    fontSize: '14px',
    fontWeight: 400,
    lineHeight: 1.5
  },
  small: {
    fontSize: '12px',
    fontWeight: 400,
    lineHeight: 1.4
  },
  xs: {
    fontSize: '11px',
    fontWeight: 500,
    lineHeight: 1.3
  }
};

// ============================================================================
// BORDER RADIUS SCALE
// 3-size standard system
// ============================================================================

export const borderRadius = {
  sm: '4px',      // Input fields, small elements
  md: '6px',      // Buttons, badges
  lg: '12px'      // Cards, modals
};

// ============================================================================
// SHADOW SYSTEM
// 4-level shadow scale
// ============================================================================

export const shadows = {
  sm: '0 1px 2px 0 rgba(0,0,0,0.05)',
  md: '0 4px 6px -1px rgba(0,0,0,0.1)',
  lg: '0 10px 15px -3px rgba(0,0,0,0.1)',
  xl: '0 20px 25px -5px rgba(0,0,0,0.1)'
};

// ============================================================================
// COMPONENT-SPECIFIC TOKENS
// ============================================================================

export const components = {
  // Button tokens
  button: {
    primary: {
      bg: colors.primary.main,
      bgHover: colors.primary.dark,
      text: '#ffffff',
      border: colors.primary.main
    },
    secondary: {
      bg: colors.neutral[200],
      bgHover: colors.neutral[300],
      text: colors.neutral[900],
      border: colors.neutral[300]
    },
    danger: {
      bg: colors.error.main,
      bgHover: colors.error.dark,
      text: '#ffffff',
      border: colors.error.main
    },
    disabled: {
      bg: colors.neutral[200],
      text: colors.neutral[500],
      opacity: 0.5
    }
  },

  // Form tokens
  form: {
    input: {
      bg: '#ffffff',
      border: colors.neutral[300],
      borderFocus: colors.primary.main,
      text: colors.neutral[900],
      placeholder: colors.neutral[400]
    },
    label: {
      text: colors.neutral[700],
      required: colors.error.main
    },
    error: {
      bg: colors.error.light,
      border: colors.error.main,
      text: colors.error.dark
    },
    success: {
      bg: colors.success.light,
      border: colors.success.main,
      text: colors.success.dark
    }
  },

  // Table tokens
  table: {
    header: {
      bg: colors.neutral[50],
      text: colors.neutral[700],
      border: colors.neutral[200]
    },
    row: {
      border: colors.neutral[200],
      hoverBg: colors.neutral[50]
    },
    cell: {
      text: colors.neutral[900],
      padding: spacing.md
    }
  },

  // Card tokens
  card: {
    bg: '#ffffff',
    border: colors.neutral[200],
    shadow: shadows.md,
    padding: spacing.lg
  },

  // Modal tokens
  modal: {
    overlay: 'rgba(0,0,0,0.5)',
    bg: '#ffffff',
    shadow: shadows.xl,
    border: colors.neutral[200]
  },

  // Badge/Status tokens
  badge: {
    success: {
      bg: colors.success.light,
      text: colors.success.dark,
      icon: colors.success.main
    },
    error: {
      bg: colors.error.light,
      text: colors.error.dark,
      icon: colors.error.main
    },
    warning: {
      bg: colors.warning.light,
      text: colors.warning.dark,
      icon: colors.warning.main
    },
    pending: {
      bg: colors.warning.light,
      text: colors.warning.dark,
      icon: colors.warning.main
    },
    info: {
      bg: colors.info.light,
      text: colors.info.dark,
      icon: colors.info.main
    }
  }
};

// ============================================================================
// RESPONSIVE VALUES
// Use these for consistent responsive behavior across components
// ============================================================================

export const responsive = {
  breakpoints: {
    xs: '0px',
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px'
  },

  // Mobile-first spacing adjustments
  spacing: {
    mobileGap: spacing.sm,
    tabletGap: spacing.md,
    desktopGap: spacing.lg
  }
};
