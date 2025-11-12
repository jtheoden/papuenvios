import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { validateEmail } from '@/lib/passwordValidation';
import { toast } from '@/components/ui/use-toast';
import { Mail, Lock, Chrome } from 'lucide-react';

export function LoginForm() {
  const navigate = useNavigate();
  const { login, signInWithGoogle } = useAuth();

  const [loginMethod, setLoginMethod] = useState('email'); // 'email' or 'google'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setErrors({});

    // Validate
    if (!email) {
      setErrors({ email: 'El email es requerido' });
      return;
    }
    if (!validateEmail(email)) {
      setErrors({ email: 'El email no es válido' });
      return;
    }
    if (!password) {
      setErrors({ password: 'La contraseña es requerida' });
      return;
    }

    setLoading(true);

    try {
      const success = await login(email, password);
      if (success) {
        toast({
          title: 'Bienvenido',
          description: 'Iniciaste sesión exitosamente',
        });
        navigate('/dashboard');
      }
    } catch (err) {
      console.error('[Login] Error:', err);
      toast({
        title: 'Error de inicio de sesión',
        description: err.message || 'Ocurrió un error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error('[Google Login] Error:', err);
      toast({
        title: 'Error de inicio de sesión',
        description: err.message || 'No se pudo iniciar sesión con Google',
        variant: 'destructive',
      });
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-6">
      {/* Method Tabs */}
      <div className="flex gap-2 rounded-lg border border-gray-300 p-1 bg-gray-50">
        <button
          type="button"
          onClick={() => {
            setLoginMethod('email');
            setErrors({});
          }}
          className={`flex-1 rounded py-2 font-semibold text-sm transition-colors ${
            loginMethod === 'email'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Mail className="inline w-4 h-4 mr-1" />
          Email
        </button>
        <button
          type="button"
          onClick={() => {
            setLoginMethod('google');
            setErrors({});
          }}
          className={`flex-1 rounded py-2 font-semibold text-sm transition-colors ${
            loginMethod === 'google'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Chrome className="inline w-4 h-4 mr-1" />
          Google
        </button>
      </div>

      {/* Email Login */}
      {loginMethod === 'email' && (
        <form onSubmit={handleEmailLogin} className="space-y-4">
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
                if (errors.email) setErrors(prev => ({ ...prev, email: '' }));
              }}
              disabled={loading}
              className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                errors.email
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-gray-300 focus:ring-blue-500'
              }`}
              placeholder="ejemplo@email.com"
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
          </div>

          {/* Password Input */}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-gray-900">
                Contraseña
              </label>
              <button
                type="button"
                onClick={() => navigate('/auth/forgot-password')}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
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
              placeholder="Tu contraseña"
            />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password}</p>}
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
            {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
          </button>

          {/* Register Link */}
          <p className="text-center text-sm text-gray-600">
            ¿No tienes cuenta?{' '}
            <button
              type="button"
              onClick={() => navigate('/auth/register')}
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              Registrate aquí
            </button>
          </p>
        </form>
      )}

      {/* Google Login */}
      {loginMethod === 'google' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 text-center">
            Inicia sesión o crea una cuenta con tu cuenta de Google
          </p>
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Chrome className="w-4 h-4" />
            {loading ? 'Redirigiendo...' : 'Continuar con Google'}
          </button>

          {/* Register Link */}
          <p className="text-center text-sm text-gray-600">
            ¿Prefieres otro método?{' '}
            <button
              type="button"
              onClick={() => setLoginMethod('email')}
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              Usa tu email
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
