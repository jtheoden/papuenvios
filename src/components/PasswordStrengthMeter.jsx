import React from 'react';
import { validatePassword, getStrengthColor } from '@/lib/passwordValidation';

export function PasswordStrengthMeter({ password }) {
  const { errors, strength } = validatePassword(password);

  return (
    <div className="space-y-2">
      {/* Strength Bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${getStrengthColor(strength)}`}
            style={{
              width: strength === 'weak' ? '33%' : strength === 'medium' ? '66%' : '100%',
            }}
          />
        </div>
        <span className="text-sm font-semibold capitalize">
          {strength === 'weak' ? 'Débil' : strength === 'medium' ? 'Medio' : 'Fuerte'}
        </span>
      </div>

      {/* Requirements Checklist */}
      <div className="text-sm space-y-1">
        {/* Length requirement */}
        <RequirementItem
          met={password.length >= 8}
          text="Mínimo 8 caracteres"
        />

        {/* Uppercase requirement */}
        <RequirementItem
          met={/[A-Z]/.test(password)}
          text="Una letra mayúscula (A-Z)"
        />

        {/* Lowercase requirement */}
        <RequirementItem
          met={/[a-z]/.test(password)}
          text="Una letra minúscula (a-z)"
        />

        {/* Number requirement */}
        <RequirementItem
          met={/\d/.test(password)}
          text="Un número (0-9)"
        />
      </div>

      {/* Error Messages */}
      {errors.length > 0 && (
        <div className="space-y-1">
          {errors.map((error, idx) => (
            <p key={idx} className="text-xs text-red-600">
              ❌ {error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function RequirementItem({ met, text }) {
  return (
    <div className="flex items-center gap-2">
      <span className={met ? 'text-green-600' : 'text-gray-400'}>
        {met ? '✓' : '○'}
      </span>
      <span className={met ? 'text-gray-700' : 'text-gray-500'}>
        {text}
      </span>
    </div>
  );
}
