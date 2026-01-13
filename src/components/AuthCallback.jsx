// src/components/AuthCallback.jsx
import React, { useEffect, useState } from 'react';
import { supabase, getUserRole } from '@/lib/supabase';
import { toast } from '@/components/ui/use-toast';

const SUPABASE_AUTH_HANDLED_KEY = 'papuenvios_supabase_auth_handled';

const AuthCallback = ({ onNavigate }) => {
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState(null);

  // Determina la ruta de redirección basada en el contexto de origen
  const getRedirectDestination = (role) => {
    // Admin siempre va al dashboard
    if (role === 'admin' || role === 'super_admin') {
      return 'dashboard';
    }

    // Si hay una remesa pendiente, redirigir a send-remittance para continuar el flujo
    const pendingRemittance = localStorage.getItem('pendingRemittance');
    if (pendingRemittance) {
      console.log('[AuthCallback] Detected pending remittance, redirecting to send-remittance');
      return 'send-remittance';
    }

    // Si hay un checkout pendiente, redirigir al carrito para continuar el flujo
    const pendingCheckout = localStorage.getItem('pendingCheckout');
    if (pendingCheckout) {
      console.log('[AuthCallback] Detected pending checkout, redirecting to cart');
      return 'cart';
    }

    // Por defecto, usuarios regulares van a products
    return 'products';
  };

  useEffect(() => {
    let mounted = true;

    const handleAuthCallback = async () => {
      try {
        console.log('[AuthCallback] start handling callback', { href: window.location.href, hash: window.location.hash, search: window.location.search });

        // Prevent double-handle in same browser session (StrictMode/dev may mount twice)
        if (sessionStorage.getItem(SUPABASE_AUTH_HANDLED_KEY) === '1') {
          console.warn('[AuthCallback] already handled in this session');
          if (mounted) setIsProcessing(false);
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user && onNavigate) {
            // Redirect based on role and context
            const role = await getUserRole(session.user.id);
            onNavigate(getRedirectDestination(role));
          }
          return;
        }
        sessionStorage.setItem(SUPABASE_AUTH_HANDLED_KEY, '1');

        let session = null;

        // Prefer getSessionFromUrl() if available (supabase-js v2), it stores session automatically
        if (typeof supabase.auth.getSessionFromUrl === 'function') {
          const { data, error: sessionError } = await supabase.auth.getSessionFromUrl({ storeSession: true });
          if (sessionError) {
            console.warn('[AuthCallback] getSessionFromUrl returned error', sessionError);
            // fallback will attempt getSession below
          } else {
            session = data?.session;
          }
        }

        // fallback to getSession
        if (!session) {
          const { data: { session: s }, error: getSessionErr } = await supabase.auth.getSession();
          if (getSessionErr) console.warn('[AuthCallback] getSession returned error', getSessionErr);
          session = s;
        }

        // Small retry: sometimes tokens take a moment to persist
        if (!session) {
          await new Promise(r => setTimeout(r, 800)); // short wait
          const { data: { session: s2 } } = await supabase.auth.getSession();
          session = s2;
        }

        if (!session?.user) {
          throw new Error('No se pudo establecer la sesión de usuario');
        }

        console.log('[AuthCallback] Auth success for:', session.user.email);

        // NOTE: Profile creation is handled by database trigger (handle_new_user)
        // No need to manually create/update profile here - the trigger does it automatically
        // when a new user is created in auth.users

        // Clear url params
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch (e) {}

        toast({ title: '¡Bienvenido!', description: `Has iniciado sesión como ${session.user.email}` });

        // Redirect based on role and context (pending remittance, etc.)
        if (onNavigate) {
          const role = await getUserRole(session.user.id);
          setTimeout(() => {
            onNavigate(getRedirectDestination(role));
          }, 150);
        }
      } catch (err) {
        console.error('[AuthCallback] error:', err);
        const msg = err?.message || String(err);
        setError(msg);
        toast({ title: 'Error de Autenticación', description: msg, variant: 'destructive' });
        setTimeout(() => { if (onNavigate) onNavigate('login'); }, 1800);
      } finally {
        if (mounted) setIsProcessing(false);
      }
    };

    handleAuthCallback();

    return () => { mounted = false; };
  }, [onNavigate]);

  if (isProcessing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center p-6 bg-white rounded shadow">
          <div className="w-16 h-16 border-4 border-blue-200 rounded-full animate-spin mx-auto" />
          <p className="mt-4">Completando autenticación...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center p-6 bg-white rounded shadow">
          <h2 className="text-lg font-semibold">Error de Autenticación</h2>
          <p className="mt-2 text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return null;
};

export default AuthCallback;
