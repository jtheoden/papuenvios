/**
 * Password Validation Utilities
 * Enforce strong password requirements
 */

export const PASSWORD_REQUIREMENTS = {
  MIN_LENGTH: 8,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_NUMBER: true,
  REQUIRE_SPECIAL: false,
};

/**
 * Validate password strength
 * @param {string} password
 * @returns {{isValid: boolean, errors: string[], strength: 'weak'|'medium'|'strong'}}
 */
export const validatePassword = (password) => {
  const errors = [];

  if (!password) {
    return { isValid: false, errors: ['La contraseña es requerida'], strength: 'weak' };
  }

  if (password.length < PASSWORD_REQUIREMENTS.MIN_LENGTH) {
    errors.push(`Mínimo ${PASSWORD_REQUIREMENTS.MIN_LENGTH} caracteres`);
  }

  if (PASSWORD_REQUIREMENTS.REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
    errors.push('Debe incluir una letra mayúscula');
  }

  if (PASSWORD_REQUIREMENTS.REQUIRE_LOWERCASE && !/[a-z]/.test(password)) {
    errors.push('Debe incluir una letra minúscula');
  }

  if (PASSWORD_REQUIREMENTS.REQUIRE_NUMBER && !/\d/.test(password)) {
    errors.push('Debe incluir un número');
  }

  if (PASSWORD_REQUIREMENTS.REQUIRE_SPECIAL && !/[!@#$%^&*]/.test(password)) {
    errors.push('Debe incluir un carácter especial (!@#$%^&*)');
  }

  // Determine strength
  let strength = 'weak';
  const passedChecks = [
    password.length >= PASSWORD_REQUIREMENTS.MIN_LENGTH,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[!@#$%^&*]/.test(password),
  ].filter(Boolean).length;

  if (passedChecks >= 4) strength = 'strong';
  else if (passedChecks >= 3) strength = 'medium';

  return {
    isValid: errors.length === 0,
    errors,
    strength,
  };
};

/**
 * Get strength indicator color
 * @param {string} strength
 * @returns {string} color class
 */
export const getStrengthColor = (strength) => {
  const colors = {
    weak: 'bg-red-500',
    medium: 'bg-yellow-500',
    strong: 'bg-green-500',
  };
  return colors[strength] || colors.weak;
};

/**
 * Validate email format
 * @param {string} email
 * @returns {boolean}
 */
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};
