/**
 * Color Tokens Utility
 * Centralized color definitions from design.js for easy consumption
 * Use this instead of hardcoded colors or visualSettings fallbacks
 *
 * Example:
 * import { colors } from '@/lib/colorTokens';
 * <div style={{ color: colors.primary.main }}>Text</div>
 */

import { colors, components } from '@/tokens/design';

/**
 * Semantic color palette - Use these instead of specific hex codes
 */
export const semanticColors = {
  // Primary action colors
  primary: {
    main: colors.primary.main,      // #2563eb - Default primary color
    light: colors.primary.light,    // #3b82f6 - Hover/lighter state
    dark: colors.primary.dark,      // #1d4ed8 - Pressed/darker state
    hex: '#2563eb'
  },

  // Secondary/Accent colors
  secondary: {
    main: colors.primary.main,      // Using primary as secondary fallback
    light: colors.primary.light,
    dark: colors.primary.dark,
    hex: '#9333ea'                  // Purple secondary
  },

  // Status colors
  success: {
    main: colors.success.main,      // #10b981
    light: colors.success.light,    // #d1fae5
    dark: colors.success.dark,      // #059669
    hex: '#10b981'
  },

  warning: {
    main: colors.warning.main,      // #f59e0b
    light: colors.warning.light,    // #fef3c7
    dark: colors.warning.dark,      // #d97706
    hex: '#f59e0b'
  },

  error: {
    main: colors.error.main,        // #ef4444
    light: colors.error.light,      // #fee2e2
    dark: colors.error.dark,        // #dc2626
    hex: '#dc2626'
  },

  info: {
    main: colors.info.main,         // #0ea5e9
    light: colors.info.light,       // #e0f2fe
    dark: colors.info.dark,         // #0284c7
    hex: '#0ea5e9'
  },

  // Neutral/Grayscale
  neutral: {
    50: colors.neutral[50],         // #f9fafb - Nearly white
    100: colors.neutral[100],       // #f3f4f6
    200: colors.neutral[200],       // #e5e7eb
    300: colors.neutral[300],       // #d1d5db
    400: colors.neutral[400],       // #9ca3af
    500: colors.neutral[500],       // #6b7280
    600: colors.neutral[600],       // #4b5563
    700: colors.neutral[700],       // #374151
    800: colors.neutral[800],       // #1f2937
    900: colors.neutral[900]        // #111827 - Almost black
  },

  // Backgrounds
  background: {
    primary: colors.background.primary,    // #ffffff
    secondary: colors.background.secondary,// #f9fafb
    tertiary: colors.background.tertiary,  // #f3f4f6
    hover: colors.background.hover         // #f0f4f8
  },

  // Text colors
  text: {
    primary: colors.neutral[900],        // #111827 - Dark text
    secondary: colors.neutral[600],      // #4b5563 - Medium text
    tertiary: colors.neutral[500],       // #6b7280 - Light text
    muted: colors.neutral[400]           // #9ca3af - Muted text
  }
};

/**
 * Component-specific color tokens
 * Pre-configured color combinations for common UI patterns
 */
export const componentColors = {
  button: {
    primary: {
      bg: components.button.primary.bg,
      bgHover: components.button.primary.bgHover,
      text: components.button.primary.text,
      border: components.button.primary.border
    },
    secondary: {
      bg: components.button.secondary.bg,
      bgHover: components.button.secondary.bgHover,
      text: components.button.secondary.text,
      border: components.button.secondary.border
    },
    danger: {
      bg: components.button.danger.bg,
      bgHover: components.button.danger.bgHover,
      text: components.button.danger.text,
      border: components.button.danger.bg
    },
    disabled: {
      bg: components.button.disabled.bg,
      text: components.button.disabled.text,
      opacity: components.button.disabled.opacity
    }
  },

  form: {
    input: {
      bg: components.form.input.bg,
      border: components.form.input.border,
      borderFocus: components.form.input.borderFocus,
      text: components.form.input.text,
      placeholder: components.form.input.placeholder
    },
    label: {
      text: components.form.label.text,
      required: components.form.label.required
    },
    error: {
      bg: components.form.error.bg,
      border: components.form.error.border,
      text: components.form.error.text
    },
    success: {
      bg: components.form.success.bg,
      border: components.form.success.border,
      text: components.form.success.text
    }
  },

  table: {
    header: {
      bg: components.table.header.bg,
      text: components.table.header.text,
      border: components.table.header.border
    },
    row: {
      border: components.table.row.border,
      hoverBg: components.table.row.hoverBg
    },
    cell: {
      text: components.table.cell.text,
      padding: components.table.cell.padding
    }
  },

  card: {
    bg: components.card.bg,
    border: components.card.border,
    shadow: components.card.shadow,
    padding: components.card.padding
  },

  modal: {
    overlay: components.modal.overlay,
    bg: components.modal.bg,
    shadow: components.modal.shadow,
    border: components.modal.border
  },

  badge: {
    success: {
      bg: components.badge.success.bg,
      text: components.badge.success.text,
      icon: components.badge.success.icon
    },
    error: {
      bg: components.badge.error.bg,
      text: components.badge.error.text,
      icon: components.badge.error.icon
    },
    warning: {
      bg: components.badge.warning.bg,
      text: components.badge.warning.text,
      icon: components.badge.warning.icon
    },
    info: {
      bg: components.badge.info.bg,
      text: components.badge.info.text,
      icon: components.badge.info.icon
    }
  }
};

/**
 * Helper function to get a color by semantic name
 * Usage: getSemanticColor('primary.main') => '#2563eb'
 */
export const getSemanticColor = (path, fallback = '#2563eb') => {
  const keys = path.split('.');
  let value = semanticColors;

  for (const key of keys) {
    value = value?.[key];
    if (value === undefined) return fallback;
  }

  return value || fallback;
};

/**
 * Helper function to get component color configuration
 * Usage: getComponentColor('button.primary.bg') => '#2563eb'
 */
export const getComponentColor = (path, fallback = '#ffffff') => {
  const keys = path.split('.');
  let value = componentColors;

  for (const key of keys) {
    value = value?.[key];
    if (value === undefined) return fallback;
  }

  return value || fallback;
};

/**
 * Gradient helpers - Common gradient combinations
 */
export const gradients = {
  primary: {
    default: `linear-gradient(to right, ${colors.primary.main}, ${colors.primary.light})`,
    reverse: `linear-gradient(to left, ${colors.primary.main}, ${colors.primary.light})`,
    diagonal: `linear-gradient(135deg, ${colors.primary.main}, ${colors.primary.light})`
  },
  primarySecondary: {
    default: `linear-gradient(to right, ${colors.primary.main}, #9333ea)`,
    reverse: `linear-gradient(to left, ${colors.primary.main}, #9333ea)`,
    diagonal: `linear-gradient(135deg, ${colors.primary.main}, #9333ea)`
  },
  success: {
    default: `linear-gradient(to right, ${colors.success.main}, ${colors.success.light})`,
    reverse: `linear-gradient(to left, ${colors.success.main}, ${colors.success.light})`
  },
  error: {
    default: `linear-gradient(to right, ${colors.error.main}, ${colors.error.light})`,
    reverse: `linear-gradient(to left, ${colors.error.main}, ${colors.error.light})`
  }
};

export default semanticColors;
