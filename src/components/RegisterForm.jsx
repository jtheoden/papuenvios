import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { validatePassword, validateEmail } from '@/lib/passwordValidation';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import { toast } from '@/components/ui/use-toast';

export function RegisterForm() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    fullName: '',
    password: '',
    passwordConfirm: '',
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Clear error for this field on change
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.email.trim()) {
      newErrors.email = 'El email es requerido';
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'El email no es válido';
    }

    if (!formData.fullName.trim()) {
      newErrors.fullName = 'El nombre es requerido';
    }

    const passwordValidation = validatePassword(formData.password);
    if (!passwordValidation.isValid) {
      newErrors.password = passwordValidation.errors[0];
    }

    if (formData.password !== formData.passwordConfirm) {
      newErrors.passwordConfirm = 'Las contraseñas no coinciden';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      // Sign up with Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: formData.fullName,
          },
        },
      });

      if (error) {
        // Check for specific error messages
        if (error.message.includes('already registered')) {
          setErrors({ email: 'Este email ya está registrado. Intenta iniciar sesión.' });
          toast({
            title: 'Email ya registrado',
            description: 'Este email ya tiene una cuenta. Por favor inicia sesión.',
            variant: 'destructive',
          });
        } else {
          setErrors({ submit: error.message });
          toast({
            title: 'Error en el registro',
            description: error.message,
            variant: 'destructive',
          });
        }
        return;
      }

      if (data?.user) {
        toast({
          title: 'Registro exitoso',
          description: 'Por favor verifica tu email para confirmar tu cuenta.',
          variant: 'success',
        });

        // Redirect to email verification page
        navigate('/auth/verify-email', { state: { email: formData.email } });
      }
    } catch (err) {
      console.error('[Register] Error:', err);
      setErrors({ submit: err.message || 'Error inesperado' });
      toast({
        title: 'Error',
        description: err.message || 'Ocurrió un error al registrarse',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Email Input */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-900">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          disabled={loading}
          className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            errors.email
              ? 'border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:ring-blue-500'
          }`}
          placeholder="ejemplo@email.com"
        />
        {errors.email && (
          <p className="mt-1 text-xs text-red-600">{errors.email}</p>
        )}
      </div>

      {/* Full Name Input */}
      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-gray-900">
          Nombre Completo
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          value={formData.fullName}
          onChange={handleChange}
          disabled={loading}
          className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            errors.fullName
              ? 'border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:ring-blue-500'
          }`}
          placeholder="Juan Pérez"
        />
        {errors.fullName && (
          <p className="mt-1 text-xs text-red-600">{errors.fullName}</p>
        )}
      </div>

      {/* Password Input */}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-900">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          value={formData.password}
          onChange={handleChange}
          disabled={loading}
          className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            errors.password
              ? 'border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:ring-blue-500'
          }`}
          placeholder="Contraseña segura"
        />
        {formData.password && (
          <div className="mt-2">
            <PasswordStrengthMeter password={formData.password} />
          </div>
        )}
        {errors.password && !formData.password && (
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
          name="passwordConfirm"
          type="password"
          value={formData.passwordConfirm}
          onChange={handleChange}
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
        {loading ? 'Registrando...' : 'Registrarse'}
      </button>

      {/* Login Link */}
      <p className="text-center text-sm text-gray-600">
        ¿Ya tienes cuenta?{' '}
        <button
          type="button"
          onClick={() => navigate('/auth/login')}
          className="text-blue-600 hover:text-blue-700 font-semibold"
        >
          Inicia sesión
        </button>
      </p>
    </form>
  );
}
