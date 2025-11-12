import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { validatePassword } from '@/lib/passwordValidation';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import { toast } from '@/components/ui/use-toast';
import { Lock } from 'lucide-react';

export function ResetPasswordForm() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({});

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setErrors({ password: passwordValidation.errors[0] });
      return;
    }

    if (password !== passwordConfirm) {
      setErrors({ passwordConfirm: 'Las contraseñas no coinciden' });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) {
        setErrors({ submit: error.message });
        toast({
          title: 'Error',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        setSuccess(true);
        toast({
          title: 'Contraseña actualizada',
          description: 'Tu contraseña ha sido restablecida exitosamente',
        });

        // Redirect to login after 2 seconds
        setTimeout(() => {
          navigate('/auth/login');
        }, 2000);
      }
    } catch (err) {
      console.error('[ResetPassword] Error:', err);
      setErrors({ submit: err.message || 'Error inesperado' });
      toast({
        title: 'Error',
        description: err.message || 'Ocurrió un error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
            <Lock className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            ¡Éxito!
          </h1>
          <p className="text-gray-600 mt-2">
            Tu contraseña ha sido actualizada exitosamente
          </p>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800">
            ✓ Ahora puedes iniciar sesión con tu nueva contraseña
          </p>
        </div>

        <p className="text-center text-sm text-gray-600">
          Redirigiendo al login...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">
          Restablecer contraseña
        </h1>
        <p className="text-gray-600 mt-2">
          Ingresa tu nueva contraseña
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Password Input */}
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-900">
            Nueva Contraseña
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors(prev => ({ ...prev, password: '' }));
            }}
            disabled={loading}
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              errors.password
                ? 'border-red-500 focus:ring-red-500'
                : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="Contraseña segura"
          />
          {password && (
            <div className="mt-2">
              <PasswordStrengthMeter password={password} />
            </div>
          )}
          {errors.password && !password && (
            <p className="mt-1 text-xs text-red-600">{errors.password}</p>
          )}
        </div>

        {/* Confirm Password Input */}
        <div>
          <label htmlFor="passwordConfirm" className="block text-sm font-medium text-gray-900">
            Confirmar Contraseña
          </label>
          <input
            id="passwordConfirm"
            type="password"
            value={passwordConfirm}
            onChange={(e) => {
              setPasswordConfirm(e.target.value);
              if (errors.passwordConfirm) setErrors(prev => ({ ...prev, passwordConfirm: '' }));
            }}
            disabled={loading}
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              errors.passwordConfirm
                ? 'border-red-500 focus:ring-red-500'
                : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="Repite tu contraseña"
          />
          {errors.passwordConfirm && (
            <p className="mt-1 text-xs text-red-600">{errors.passwordConfirm}</p>
          )}
        </div>

        {/* Submit Error */}
        {errors.submit && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-800">{errors.submit}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Actualizando...' : 'Actualizar Contraseña'}
        </button>
      </form>

      {/* Help Text */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-gray-900 text-sm mb-2">
          ⚠️ Importante
        </h3>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>• Tu contraseña debe tener al menos 8 caracteres</li>
          <li>• Debe incluir mayúsculas, minúsculas y números</li>
          <li>• No compartas tu contraseña con nadie</li>
        </ul>
      </div>
    </div>
  );
}
