/**
 * Centralized Animation Configuration
 *
 * This file provides standardized animation presets for Framer Motion
 * to ensure consistent, performant animations across the application.
 *
 * Benefits:
 * - Consistent animation timing across all components
 * - Easy to modify animations globally
 * - Performance optimizations built-in
 * - Reduced bundle size (no duplicated animation objects)
 */

// =============================================================================
// ANIMATION DURATIONS (in seconds)
// =============================================================================
export const DURATIONS = {
  instant: 0.1,
  fast: 0.2,
  normal: 0.3,
  slow: 0.5,
  slower: 0.8,
  slowest: 1.0,
};

// =============================================================================
// EASING FUNCTIONS
// =============================================================================
export const EASINGS = {
  // Standard easings
  easeOut: [0.0, 0.0, 0.2, 1],
  easeIn: [0.4, 0.0, 1, 1],
  easeInOut: [0.4, 0.0, 0.2, 1],
  // Spring-like
  spring: { type: 'spring', stiffness: 300, damping: 30 },
  springBouncy: { type: 'spring', stiffness: 400, damping: 25 },
  springGentle: { type: 'spring', stiffness: 200, damping: 35 },
  // Linear
  linear: 'linear',
};

// =============================================================================
// STAGGER CONFIGURATION
// For list animations - limits delay to prevent slow loading
// =============================================================================
export const STAGGER = {
  fast: 0.03,
  normal: 0.05,
  slow: 0.08,
  // Maximum delay to prevent extremely slow animations for long lists
  maxDelay: 0.5,
};

/**
 * Calculate stagger delay with maximum cap
 * Prevents animations from taking too long on large lists
 */
export const getStaggerDelay = (index, baseDelay = STAGGER.normal) => {
  const calculatedDelay = index * baseDelay;
  return Math.min(calculatedDelay, STAGGER.maxDelay);
};

// =============================================================================
// FADE ANIMATIONS
// =============================================================================
export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATIONS.normal },
};

export const fadeInFast = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATIONS.fast },
};

export const fadeInSlow = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATIONS.slow },
};

// =============================================================================
// SLIDE ANIMATIONS
// =============================================================================
export const slideUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeOut },
};

export const slideUpFast = {
  initial: { opacity: 0, y: 15 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: DURATIONS.fast, ease: EASINGS.easeOut },
};

export const slideDown = {
  initial: { opacity: 0, y: -20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 20 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeOut },
};

export const slideLeft = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeOut },
};

export const slideRight = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeOut },
};

// =============================================================================
// SCALE ANIMATIONS
// =============================================================================
export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: DURATIONS.fast, ease: EASINGS.easeOut },
};

export const scaleInSpring = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: EASINGS.spring,
};

export const popIn = {
  initial: { opacity: 0, scale: 0 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0 },
  transition: EASINGS.springBouncy,
};

// =============================================================================
// PAGE TRANSITIONS
// =============================================================================
export const pageTransition = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: { duration: DURATIONS.slow, ease: EASINGS.easeOut },
};

export const pageTransitionFast = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeOut },
};

// =============================================================================
// CARD ANIMATIONS (for product cards, feature cards, etc.)
// =============================================================================
export const cardAnimation = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 10 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeOut },
};

// For lists of cards with stagger - use with getStaggerDelay
export const cardListAnimation = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  // Note: pass transition separately with getStaggerDelay
};

// =============================================================================
// MODAL ANIMATIONS
// =============================================================================
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
// ACCORDION / COLLAPSE ANIMATIONS
// =============================================================================
export const accordion = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeInOut },
};

// =============================================================================
// LOADING ANIMATIONS
// =============================================================================
export const pulse = {
  animate: {
    opacity: [0.5, 1, 0.5],
  },
  transition: {
    duration: 1.5,
    repeat: Infinity,
    ease: 'easeInOut',
  },
};

export const spin = {
  animate: { rotate: 360 },
  transition: {
    duration: 1,
    repeat: Infinity,
    ease: 'linear',
  },
};

export const bounce = {
  animate: { y: [0, -10, 0] },
  transition: {
    duration: 1.5,
    repeat: Infinity,
    ease: 'easeInOut',
  },
};

// Staggered bounce for multiple items
export const bounceStaggered = (delay = 0) => ({
  animate: { y: [0, -10, 0] },
  transition: {
    duration: 1.5,
    repeat: Infinity,
    ease: 'easeInOut',
    delay,
  },
});

// =============================================================================
// HOVER ANIMATIONS (for whileHover prop)
// =============================================================================
export const hoverScale = {
  scale: 1.02,
  transition: { duration: DURATIONS.fast },
};

export const hoverLift = {
  y: -4,
  transition: { duration: DURATIONS.fast },
};

export const hoverGlow = {
  boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
  transition: { duration: DURATIONS.fast },
};

// =============================================================================
// TAP ANIMATIONS (for whileTap prop)
// =============================================================================
export const tapScale = {
  scale: 0.98,
};

export const tapPress = {
  scale: 0.95,
};

// =============================================================================
// CAROUSEL / SLIDER ANIMATIONS
// =============================================================================
export const carouselSlide = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATIONS.slower },
};

export const carouselSlideLeft = {
  initial: { opacity: 0, x: 100 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -100 },
  transition: { duration: DURATIONS.slow, ease: EASINGS.easeInOut },
};

// =============================================================================
// NOTIFICATION / TOAST ANIMATIONS
// =============================================================================
export const toastSlideIn = {
  initial: { opacity: 0, y: -20, x: 20 },
  animate: { opacity: 1, y: 0, x: 0 },
  exit: { opacity: 0, x: 20 },
  transition: { duration: DURATIONS.normal, ease: EASINGS.easeOut },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Creates a staggered animation for list items
 * @param {number} index - Item index in the list
 * @param {Object} baseAnimation - Base animation preset to extend
 * @param {number} staggerDelay - Delay between each item (default: STAGGER.normal)
 * @returns {Object} Animation props with calculated delay
 */
export const withStagger = (index, baseAnimation = cardAnimation, staggerDelay = STAGGER.normal) => ({
  ...baseAnimation,
  transition: {
    ...baseAnimation.transition,
    delay: getStaggerDelay(index, staggerDelay),
  },
});

/**
 * Creates animation props for a list item with performance optimization
 * Skips animation for items beyond a threshold for better performance
 * @param {number} index - Item index
 * @param {number} threshold - Max items to animate (default: 12)
 * @returns {Object} Animation props or empty object
 */
export const listItemAnimation = (index, threshold = 12) => {
  if (index >= threshold) {
    // Skip animation for items beyond threshold
    return {};
  }
  return withStagger(index, cardAnimation, STAGGER.fast);
};

/**
 * Combines multiple animation presets
 * @param {...Object} animations - Animation objects to merge
 * @returns {Object} Combined animation object
 */
export const combineAnimations = (...animations) => {
  return animations.reduce((acc, anim) => ({
    initial: { ...acc.initial, ...anim.initial },
    animate: { ...acc.animate, ...anim.animate },
    exit: { ...acc.exit, ...anim.exit },
    transition: { ...acc.transition, ...anim.transition },
  }), {});
};

/**
 * Creates a delayed version of an animation
 * @param {Object} animation - Base animation preset
 * @param {number} delay - Delay in seconds
 * @returns {Object} Animation with delay
 */
export const withDelay = (animation, delay) => ({
  ...animation,
  transition: {
    ...animation.transition,
    delay,
  },
});

// =============================================================================
// REDUCED MOTION SUPPORT
// =============================================================================

/**
 * Returns animation or null based on user's reduced motion preference
 * Use this to respect accessibility settings
 * @param {Object} animation - Animation preset
 * @returns {Object|null} Animation or empty object
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

// =============================================================================
// CSS ANIMATION CLASSES (for non-Framer-Motion use)
// =============================================================================
export const CSS_ANIMATIONS = {
  shimmer: 'shimmer',
  pulse: 'animate-pulse',
  spin: 'animate-spin',
  bounce: 'animate-bounce',
  fadeIn: 'animate-in fade-in',
  slideUp: 'animate-in slide-in-from-bottom',
  slideDown: 'animate-in slide-in-from-top',
};

// Default export for convenience
export default {
  DURATIONS,
  EASINGS,
  STAGGER,
  getStaggerDelay,
  fadeIn,
  fadeInFast,
  fadeInSlow,
  slideUp,
  slideUpFast,
  slideDown,
  slideLeft,
  slideRight,
  scaleIn,
  scaleInSpring,
  popIn,
  pageTransition,
  pageTransitionFast,
  cardAnimation,
  cardListAnimation,
  modalOverlay,
  modalContent,
  accordion,
  pulse,
  spin,
  bounce,
  bounceStaggered,
  hoverScale,
  hoverLift,
  hoverGlow,
  tapScale,
  tapPress,
  carouselSlide,
  carouselSlideLeft,
  toastSlideIn,
  withStagger,
  listItemAnimation,
  combineAnimations,
  withDelay,
  respectReducedMotion,
  CSS_ANIMATIONS,
};
