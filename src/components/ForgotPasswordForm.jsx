import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { validateEmail } from '@/lib/passwordValidation';
import { toast } from '@/components/ui/use-toast';
import { Mail, ArrowLeft } from 'lucide-react';

export function ForgotPasswordForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email) {
      setError('El email es requerido');
      return;
    }

    if (!validateEmail(email)) {
      setError('El email no es válido');
      return;
    }

    setLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });

      if (resetError) {
        setError(resetError.message);
        toast({
          title: 'Error',
          description: resetError.message,
          variant: 'destructive',
        });
      } else {
        setSubmitted(true);
        toast({
          title: 'Email enviado',
          description: 'Revisa tu bandeja de entrada para instrucciones',
        });
      }
    } catch (err) {
      console.error('[ForgotPassword] Error:', err);
      setError(err.message || 'Error inesperado');
      toast({
        title: 'Error',
        description: err.message || 'Ocurrió un error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
            <Mail className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Revisa tu email
          </h1>
          <p className="text-gray-600 mt-2">
            Hemos enviado instrucciones para restablecer tu contraseña a <strong>{email}</strong>
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h2 className="font-semibold text-gray-900 mb-2">¿Qué hacer ahora?</h2>
          <ol className="text-sm text-gray-700 space-y-2">
            <li><strong>1.</strong> Abre tu email</li>
            <li><strong>2.</strong> Busca el mensaje "Restablecer contraseña"</li>
            <li><strong>3.</strong> Haz clic en el enlace</li>
            <li><strong>4.</strong> Ingresa tu nueva contraseña</li>
          </ol>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            💡 El enlace expira en 24 horas
          </p>
          <p className="text-sm text-gray-600">
            ❌ No ves el email? Revisa la carpeta de SPAM
          </p>
        </div>

        <button
          onClick={() => navigate('/auth/login')}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al login
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">
          ¿Olvidaste tu contraseña?
        </h1>
        <p className="text-gray-600 mt-2">
          Ingresa tu email y te enviaremos instrucciones para restablecerla
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email Input */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-900">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError('');
            }}
            disabled={loading}
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              error
                ? 'border-red-500 focus:ring-red-500'
                : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="ejemplo@email.com"
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Enviando...' : 'Enviar instrucciones'}
        </button>
      </form>

      {/* Back Link */}
      <p className="text-center text-sm text-gray-600">
        <button
          type="button"
          onClick={() => navigate('/auth/login')}
          className="text-blue-600 hover:text-blue-700 font-semibold"
        >
          ← Volver al login
        </button>
      </p>
    </div>
  );
}
