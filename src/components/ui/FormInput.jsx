import React, { useState } from 'react';
import { AlertCircle, Check, Eye, EyeOff } from 'lucide-react';

/**
 * FormInput Component
 * Enhanced form input with validation feedback, error states, and accessibility
 *
 * @prop {string} label - Input label text
 * @prop {string} name - Input name attribute
 * @prop {string} type - Input type (text, email, password, number, etc.)
 * @prop {string} value - Input value
 * @prop {function} onChange - Change handler
 * @prop {boolean} error - Error state (string or boolean)
 * @prop {string} helper - Helper text below input
 * @prop {boolean} required - Mark as required field
 * @prop {string} placeholder - Placeholder text
 * @prop {number} maxLength - Maximum character length
 * @prop {boolean} disabled - Disable input
 * @prop {string} className - Additional CSS classes
 */
const FormInput = ({
  label,
  name,
  type = 'text',
  value = '',
  onChange,
  error = false,
  helper = '',
  required = false,
  placeholder = '',
  maxLength = null,
  disabled = false,
  className = '',
  showCharCount = false,
  success = false,
  ariaDescribedBy = ''
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const inputType = type === 'password' && showPassword ? 'text' : type;
  const hasError = error && error !== '';
  const isSuccessState = success && !hasError;

  // Generate unique IDs for accessibility
  const inputId = `input-${name}`;
  const helperId = `helper-${name}`;
  const errorId = `error-${name}`;
  const charCountId = `char-count-${name}`;

  // Build aria-describedby
  const describedByIds = [
    hasError ? errorId : null,
    helper && !hasError ? helperId : null,
    showCharCount && maxLength ? charCountId : null,
    ariaDescribedBy
  ].filter(Boolean).join(' ');

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Label */}
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-gray-700 flex items-center gap-1"
        >
          {label}
          {required && <span className="text-red-500" aria-label="required">*</span>}
        </label>
      )}

      {/* Input Container */}
      <div className="relative flex items-center">
        <input
          id={inputId}
          name={name}
          type={inputType}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={hasError}
          aria-required={required}
          aria-describedby={describedByIds || undefined}
          className={`
            w-full px-3 py-2 rounded-md text-base font-normal
            transition-all duration-200
            border-2
            focus:outline-none focus:ring-0
            disabled:opacity-50 disabled:cursor-not-allowed
            ${
              hasError
                ? 'border-red-500 bg-red-50 focus:border-red-600 focus:bg-white'
                : isSuccessState
                ? 'border-green-500 bg-green-50 focus:border-green-600 focus:bg-white'
                : 'border-gray-300 bg-white focus:border-blue-500 focus:bg-white'
            }
          `}
        />

        {/* Password Toggle Button */}
        {type === 'password' && value && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            disabled={disabled}
            className="absolute right-3 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}

        {/* Success Icon */}
        {isSuccessState && (
          <div className="absolute right-3 text-green-500 flex-shrink-0">
            <Check size={18} />
          </div>
        )}

        {/* Error Icon */}
        {hasError && (
          <div className="absolute right-3 text-red-500 flex-shrink-0">
            <AlertCircle size={18} />
          </div>
        )}
      </div>

      {/* Helper Text or Error Text */}
      {hasError && error && (
        <p
          id={errorId}
          className="text-sm text-red-600 font-medium flex items-center gap-1"
          role="alert"
        >
          <AlertCircle size={14} className="flex-shrink-0" />
          {error}
        </p>
      )}

      {!hasError && helper && (
        <p
          id={helperId}
          className="text-sm text-gray-600 font-normal"
        >
          {helper}
        </p>
      )}

      {isSuccessState && (
        <p
          className="text-sm text-green-600 font-medium flex items-center gap-1"
          role="status"
        >
          <Check size={14} className="flex-shrink-0" />
          Looks good!
        </p>
      )}

      {/* Character Counter */}
      {showCharCount && maxLength && (
        <p
          id={charCountId}
          className={`text-xs font-medium ${
            value.length > maxLength * 0.9
              ? 'text-orange-600'
              : value.length === maxLength
              ? 'text-red-600'
              : 'text-gray-500'
          }`}
        >
          {value.length} / {maxLength}
        </p>
      )}
    </div>
  );
};

export default FormInput;
