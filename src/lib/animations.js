/**
 * Centralized Animation Configuration
 *
 * Standardized animation presets for Framer Motion ensuring consistent,
 * performant animations across the application.
 */

// =============================================================================
// CORE CONFIGURATION
// =============================================================================

export const DURATIONS = {
  instant: 0.1,
  fast: 0.2,
  normal: 0.3,
  slow: 0.5,
};

export const EASINGS = {
  easeOut: [0.0, 0.0, 0.2, 1],
  easeIn: [0.4, 0.0, 1, 1],
  easeInOut: [0.4, 0.0, 0.2, 1],
  spring: { type: 'spring', stiffness: 300, damping: 30 },
};

export const STAGGER = {
  fast: 0.03,
  normal: 0.05,
  slow: 0.08,
  maxDelay: 0.5,
};

// =============================================================================
// CORE HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate stagger delay with maximum cap
 */
export const getStaggerDelay = (index, baseDelay = STAGGER.normal) => {
  return Math.min(index * baseDelay, STAGGER.maxDelay);
};

// =============================================================================
// BASE ANIMATION PRESETS
// =============================================================================

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATIONS.normal },
};

export const slideUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeOut },
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: DURATIONS.fast, ease: EASINGS.easeOut },
};

// =============================================================================
// COMPONENT-SPECIFIC PRESETS
// =============================================================================

export const cardAnimation = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 10 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeOut },
};

export const pageTransition = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: { duration: DURATIONS.slow, ease: EASINGS.easeOut },
};

export const modalOverlay = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATIONS.fast },
};

export const modalContent = {
  initial: { opacity: 0, scale: 0.95, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 10 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeOut },
};

// =============================================================================
// LIST ANIMATION HELPERS
// =============================================================================

/**
 * Creates a staggered animation for list items
 */
export const withStagger = (index, baseAnimation = cardAnimation, staggerDelay = STAGGER.normal) => ({
  ...baseAnimation,
  transition: {
    ...baseAnimation.transition,
    delay: getStaggerDelay(index, staggerDelay),
  },
});

/**
 * Optimized list item animation - skips animation beyond threshold
 * @param {number} index - Item index
 * @param {number} threshold - Max items to animate (default: 12)
 */
export const listItemAnimation = (index, threshold = 12) => {
  if (index >= threshold) {
    return {};
  }
  return withStagger(index, cardAnimation, STAGGER.fast);
};

/**
 * Creates a delayed version of an animation
 */
export const withDelay = (animation, delay) => ({
  ...animation,
  transition: {
    ...animation.transition,
    delay,
  },
});

// =============================================================================
// ACCESSIBILITY
// =============================================================================

/**
 * Respects user's reduced motion preference
 */
export const respectReducedMotion = (animation) => {
  if (typeof window !== 'undefined') {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      return {
        initial: {},
        animate: {},
        exit: {},
        transition: { duration: 0 },
      };
    }
  }
  return animation;
};
