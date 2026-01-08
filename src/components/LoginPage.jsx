import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { LogIn, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle, getPrimaryButtonStyle } from '@/lib/styleUtils';

const LoginPage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { signInWithGoogle } = useAuth();
  const { visualSettings } = useBusiness();
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      toast({
        title: language === 'es' ? 'Conectando con Google...' : 'Connecting to Google...',
        description: language === 'es' ? 'Por favor espera mientras te redirigimos.' : 'Please wait while we redirect you.',
        variant: 'default'
      });

      await signInWithGoogle();

    } catch (error) {
      console.error('Google login error:', error);
      toast({
        title: language === 'es' ? 'Error de inicio de sesión' : 'Login Error',
        description: error.message || (language === 'es' ? 'No se pudo iniciar sesión con Google' : 'Failed to sign in with Google'),
        variant: 'destructive'
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full space-y-8 glass-effect p-8 sm:p-10 rounded-2xl"
      >
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mb-4">
            <LogIn className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold" style={getHeadingStyle(visualSettings)}>
            {t('auth.loginTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {t('auth.loginSubtitle')}
          </p>
        </div>

        {/* Google Login Button */}
        <div className="space-y-4">
          <Button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full group relative flex items-center justify-center py-4 px-4 text-base font-semibold rounded-xl transition-all duration-200 hover:shadow-lg"
            style={getPrimaryButtonStyle(visualSettings)}
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                {language === 'es' ? 'Conectando...' : 'Connecting...'}
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-3" aria-hidden="true" viewBox="0 0 488 512">
                  <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 126 21.2 172.9 56.9L368.7 128C338.8 102.3 298.2 88 248 88c-86.5 0-157.2 70.2-157.2 156.8s70.7 156.8 157.2 156.8c99.9 0 133-67.8 138.3-103.3H248v-67.3h239.1c1.3 12.2 2.2 24.2 2.2 36.8z"/>
                </svg>
                {t('auth.loginWithGoogle')}
              </>
            )}
          </Button>

          {/* Info text */}
          <p className="text-center text-xs text-gray-500 mt-4">
            {language === 'es'
              ? 'Al continuar, aceptas nuestros términos de servicio y política de privacidad.'
              : 'By continuing, you agree to our terms of service and privacy policy.'}
          </p>
        </div>

        {/* Back to home link */}
        <div className="text-center pt-4 border-t border-gray-200">
          <button
            onClick={() => onNavigate('home')}
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            {language === 'es' ? '← Volver al inicio' : '← Back to home'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;