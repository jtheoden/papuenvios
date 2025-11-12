import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/use-toast';
import { Mail, RotateCcw } from 'lucide-react';

export function EmailVerificationPending() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || '');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDisabled, setResendDisabled] = useState(false);
  const [timer, setTimer] = useState(0);

  // Timer for resend button
  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => setTimer(t => t - 1), 1000);
      return () => clearInterval(interval);
    } else {
      setResendDisabled(false);
    }
  }, [timer]);

  const handleResendEmail = async () => {
    if (!email) {
      toast({
        title: 'Error',
        description: 'Por favor ingresa tu email',
        variant: 'destructive',
      });
      return;
    }

    setResendLoading(true);

    try {
      const { error } = await supabase.auth.resendEmailConfirmationEmail({
        email,
      });

      if (error) {
        toast({
          title: 'Error',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Email enviado',
          description: 'Revisa tu bandeja de entrada',
        });
        setResendDisabled(true);
        setTimer(60); // 60 second cooldown
      }
    } catch (err) {
      console.error('[EmailVerification] Resend error:', err);
      toast({
        title: 'Error',
        description: err.message || 'Error al reenviar email',
        variant: 'destructive',
      });
    } finally {
      setResendLoading(false);
    }
  };

  const handleOpenEmail = () => {
    // Try to open common email providers
    if (email.includes('@gmail')) {
      window.open('https://mail.google.com', '_blank');
    } else if (email.includes('@outlook')) {
      window.open('https://outlook.live.com', '_blank');
    } else if (email.includes('@yahoo')) {
      window.open('https://mail.yahoo.com', '_blank');
    } else {
      // Generic email provider
      const domain = email.split('@')[1];
      window.open(`https://www.${domain}`, '_blank');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
            <Mail className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Verifica tu email
          </h1>
          <p className="text-gray-600 mt-2">
            Hemos enviado un enlace de confirmación a <strong>{email}</strong>
          </p>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h2 className="font-semibold text-gray-900 mb-2">¿Qué hacer ahora?</h2>
          <ol className="text-sm text-gray-700 space-y-2">
            <li><strong>1.</strong> Abre tu email</li>
            <li><strong>2.</strong> Busca el mensaje de "Confirmación de email"</li>
            <li><strong>3.</strong> Haz clic en el enlace "Confirmar email"</li>
            <li><strong>4.</strong> ¡Listo! Tu cuenta estará activada</li>
          </ol>
        </div>

        {/* Open Email Button */}
        <button
          onClick={handleOpenEmail}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg mb-4 transition-colors"
        >
          Abrir cliente de email
        </button>

        {/* Resend Button */}
        <button
          onClick={handleResendEmail}
          disabled={resendLoading || resendDisabled}
          className="w-full flex items-center justify-center gap-2 border border-gray-300 hover:border-gray-400 text-gray-700 font-semibold py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          {resendLoading
            ? 'Reenviando...'
            : resendDisabled
            ? `Reenviar en ${timer}s`
            : 'Reenviar email'}
        </button>

        {/* Change Email */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            ¿Email incorrecto?{' '}
            <button
              onClick={() => navigate('/auth/register')}
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              Registrate con otro email
            </button>
          </p>
        </div>

        {/* Help Text */}
        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">
            💡 Consejos útiles
          </h3>
          <ul className="text-xs text-gray-600 space-y-1">
            <li>• Revisa la carpeta de SPAM si no ves el email</li>
            <li>• El enlace de confirmación expira en 24 horas</li>
            <li>• Asegúrate de usar el email correcto</li>
            <li>• Si aún tienes problemas, contacta al soporte</li>
          </ul>
        </div>

        {/* Back Link */}
        <p className="text-center text-sm text-gray-600 mt-6">
          <button
            onClick={() => navigate('/')}
            className="text-blue-600 hover:text-blue-700 font-semibold"
          >
            Volver al inicio
          </button>
        </p>
      </div>
    </div>
  );
}
