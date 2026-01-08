import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { LogIn, Loader2 } from 'lucide-react';

export function LoginForm() {
  const navigate = useNavigate();
  const { signInWithGoogle } = useAuth();
  const { language } = useLanguage();
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      toast({
        title: language === 'es' ? 'Conectando con Google...' : 'Connecting to Google...',
        description: language === 'es' ? 'Por favor espera mientras te redirigimos.' : 'Please wait while we redirect you.',
      });
      await signInWithGoogle();
    } catch (err) {
      console.error('[Google Login] Error:', err);
      toast({
        title: language === 'es' ? 'Error de inicio de sesión' : 'Login Error',
        description: err.message || (language === 'es' ? 'No se pudo iniciar sesión con Google' : 'Failed to sign in with Google'),
        variant: 'destructive',
      });
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm sm:max-w-md space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto w-14 h-14 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center mb-4">
          <LogIn className="w-7 h-7 text-white" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">
          {language === 'es' ? 'Bienvenido de Nuevo' : 'Welcome Back'}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {language === 'es' ? 'Inicia sesión para acceder a tu cuenta.' : 'Log in to access your account.'}
        </p>
      </div>

      {/* Google Login Button */}
      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 rounded-xl bg-blue-600 px-4 py-3 text-base font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            {language === 'es' ? 'Conectando...' : 'Connecting...'}
          </>
        ) : (
          <>
            <svg className="w-5 h-5" aria-hidden="true" viewBox="0 0 488 512">
              <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 126 21.2 172.9 56.9L368.7 128C338.8 102.3 298.2 88 248 88c-86.5 0-157.2 70.2-157.2 156.8s70.7 156.8 157.2 156.8c99.9 0 133-67.8 138.3-103.3H248v-67.3h239.1c1.3 12.2 2.2 24.2 2.2 36.8z"/>
            </svg>
            {language === 'es' ? 'Continuar con Google' : 'Continue with Google'}
          </>
        )}
      </button>

      {/* Info text */}
      <p className="text-center text-xs text-gray-500">
        {language === 'es'
          ? 'Al continuar, aceptas nuestros términos de servicio y política de privacidad.'
          : 'By continuing, you agree to our terms of service and privacy policy.'}
      </p>

      {/* Back link */}
      <div className="text-center pt-2">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          {language === 'es' ? '← Volver al inicio' : '← Back to home'}
        </button>
      </div>
    </div>
  );
}
