import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { getHeadingStyle } from '@/lib/styleUtils';

const LoginPage = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { login, signInWithGoogle, userRole } = useAuth();
  const { visualSettings } = useBusiness();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    try {
      console.log('Attempting login with:', { email });
      const success = await login(email, password);
      console.log('Login attempt result:', success);

      if (success) {
        console.log('Login successful');
        toast({
          title: "Login Successful",
          description: "Welcome back!",
          variant: "default"
        });

        // Redirect based on user role
        // userRole is updated by AuthContext after login
        // Wait a bit for the role to be set
        setTimeout(() => {
          if (userRole === 'admin' || userRole === 'super_admin') {
            onNavigate('dashboard');
          } else {
            onNavigate('products');
          }
        }, 100);
      }
    } catch (error) {
      console.error('Login error:', error);
      toast({
        title: "Login Error",
        description: error.message || "An unexpected error occurred",
        variant: "destructive"
      });
    }
  };

  const handleGoogleLogin = async () => {
    try {
      toast({ 
        title: "Connecting to Google...",
        description: "Please wait while we redirect you.",
        variant: "default"
      });
      
      await signInWithGoogle();
      
      // The redirect will happen automatically, but we'll show a loading state
      // in case there's any delay
      const loadingToast = toast({ 
        title: "Redirecting...",
        description: "Please complete the sign in process with Google.",
        variant: "default"
      });
      
      // Clean up the toast after 2 seconds (the redirect should have happened by then)
      setTimeout(() => {
        loadingToast.dismiss();
      }, 2000);
      
    } catch (error) {
      console.error('Google login error:', error);
      toast({ 
        title: "Login Error",
        description: error.message || "Failed to sign in with Google",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full space-y-8 glass-effect p-10 rounded-2xl"
      >
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold" style={getHeadingStyle(visualSettings)}>
            {t('auth.loginTitle')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {t('auth.loginSubtitle')}
          </p>
        </div>
        <div className="space-y-6">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('auth.email')}
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('auth.password')}
            />
          </div>

          <div>
            <Button
              onClick={handleLogin}
              className="w-full group relative flex justify-center py-3 px-4"
              style={{
                background: visualSettings.useGradient
                  ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                  : visualSettings.buttonBgColor || '#2563eb',
                color: visualSettings.buttonTextColor || '#ffffff',
                border: 'none'
              }}
            >
              <LogIn className="w-5 h-5 mr-2" />
              {t('auth.login')}
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">{t('auth.or')}</span>
            </div>
          </div>

          <div>
            <Button
              onClick={handleGoogleLogin}
              variant="outline"
              className="w-full group relative flex justify-center py-3 px-4"
              style={{
                borderColor: visualSettings.primaryColor || '#2563eb',
                color: visualSettings.primaryColor || '#2563eb'
              }}
            >
              <svg className="w-5 h-5 mr-2" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512"><path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 126 21.2 172.9 56.9L368.7 128C338.8 102.3 298.2 88 248 88c-86.5 0-157.2 70.2-157.2 156.8s70.7 156.8 157.2 156.8c99.9 0 133-67.8 138.3-103.3H248v-67.3h239.1c1.3 12.2 2.2 24.2 2.2 36.8z"></path></svg>
              {t('auth.loginWithGoogle')}
            </Button>
          </div>
          
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;