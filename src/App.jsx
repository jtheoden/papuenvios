import React, { useState, useEffect } from 'react';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { Analytics } from '@vercel/analytics/react';
import { Toaster } from '@/components/ui/toaster';
import LoadingScreen from '@/components/LoadingScreen';
import ErrorBoundary from '@/components/ErrorBoundary';
import { diagnostics } from '@/lib/diagnostics';
import Header from '@/components/Header';
import HomePage from '@/components/HomePage';
import ProductsPage from '@/components/ProductsPage';
import ProductDetailPage from '@/components/ProductDetailPage';
import RemittancesPage from '@/components/RemittancesPage';
import SendRemittancePage from '@/components/SendRemittancePage';
import MyRemittancesPage from '@/components/MyRemittancesPage';
import MyRecipientsPage from '@/components/MyRecipientsPage';
import DashboardPage from '@/components/DashboardPage';
import AdminPage from '@/components/AdminPage';
import SettingsPage from '@/components/SettingsPage';
import CartPage from '@/components/CartPage';
import LoginPage from '@/components/LoginPage';
import UserPanel from '@/components/UserPanel';
import UserManagement from '@/components/UserManagement';
import AuthCallback from '@/components/AuthCallback';
import Footer from '@/components/Footer';
import { withProtectedRoute } from '@/components/withProtectedRoute';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { BusinessProvider, useBusiness } from '@/contexts/BusinessContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { ModalProvider } from '@/contexts/ModalContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';

// Component to dynamically update page title
function DynamicTitle() {
  const { visualSettings } = useBusiness();

  useEffect(() => {
    document.title = visualSettings.companyName || 'PapuEnvíos';
  }, [visualSettings.companyName]);

  return (
    <Helmet>
      <title>{visualSettings.companyName || 'PapuEnvíos'} - Plataforma de Comercio Digital</title>
      <meta name="description" content="Plataforma completa de comercio digital con vendedores independientes, remesas y gestión de ganancias" />
    </Helmet>
  );
}

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('home');
  const [detailParams, setDetailParams] = useState({ itemId: null, itemType: null });

  // Create protected routes inside App to ensure they have access to context providers
  // This prevents HMR issues where context might not be available
  const ProtectedUserManagement = React.useMemo(() => withProtectedRoute(UserManagement, 'admin'), []);
  const ProtectedDashboard = React.useMemo(() => withProtectedRoute(DashboardPage, 'admin'), []);
  const ProtectedAdmin = React.useMemo(() => withProtectedRoute(AdminPage, 'admin'), []);
  const ProtectedSettings = React.useMemo(() => withProtectedRoute(SettingsPage, 'admin'), []);
  const ProtectedUserPanel = React.useMemo(() => withProtectedRoute(UserPanel, 'user'), []);
  const ProtectedSendRemittance = React.useMemo(() => withProtectedRoute(SendRemittancePage, 'user'), []);
  const ProtectedMyRemittances = React.useMemo(() => withProtectedRoute(MyRemittancesPage, 'user'), []);
  const ProtectedMyRecipients = React.useMemo(() => withProtectedRoute(MyRecipientsPage, 'user'), []);

  const normalizePath = (path) => path.replace(/\/$/, '') || '/';

  const resolvePageFromPath = (path) => {
    const normalizedPath = normalizePath(path);
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));

    if (
      normalizedPath === '/auth/callback' ||
      searchParams.has('access_token') ||
      hashParams.has('access_token') ||
      searchParams.has('code')
    ) {
      return { page: 'auth/callback' };
    }

    const productMatch = normalizedPath.match(/^\/product\/([^/]+)$/);
    const comboMatch = normalizedPath.match(/^\/combo\/([^/]+)$/);

    if (productMatch) {
      return { page: 'product-detail', params: { itemId: productMatch[1], itemType: 'product' } };
    }

    if (comboMatch) {
      return { page: 'product-detail', params: { itemId: comboMatch[1], itemType: 'combo' } };
    }

    const pathToPage = {
      '/': 'home',
      '/products': 'products',
      '/remittances': 'remittances',
      '/remittances/send': 'send-remittance',
      '/remittances/my': 'my-remittances',
      '/recipients': 'recipients',
      '/dashboard': 'dashboard',
      '/admin': 'admin',
      '/settings': 'settings',
      '/cart': 'cart',
      '/login': 'login',
      '/user-panel': 'user-panel',
      '/user-management': 'user-management'
    };

    return { page: pathToPage[normalizedPath] || 'home' };
  };

  // Handle URL-based routing for OAuth callback
  useEffect(() => {
    const { page, params } = resolvePageFromPath(window.location.pathname);

    setCurrentPage(page);
    if (page === 'product-detail' && params) {
      setDetailParams(params);
    }

    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2500);

    const handlePopState = (event) => {
      const newPath = event?.state?.path || window.location.pathname;
      const { page, params } = resolvePageFromPath(newPath);

      setCurrentPage(page);
      if (page === 'product-detail' && params) {
        setDetailParams(params);
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // TODO: Run diagnostics on app startup (remove in production)
  useEffect(() => {
    if (import.meta.env.DEV) {
      diagnostics.runAll().then(report => {
        // Store report for debugging
        window.__papuDiagnosticsReport = report;
      });
    }
  }, []);

  const handleNavigate = (page, params = {}) => {
    setCurrentPage(page);

    // Handle detail page navigation
    if (page === 'product-detail' && params.itemId && params.itemType) {
      setDetailParams({ itemId: params.itemId, itemType: params.itemType });
      const url = `/${params.itemType}/${params.itemId}`;
      window.history.pushState({ path: url }, '', url);
      return;
    }

    const pageToPath = {
      home: '/',
      products: '/products',
      remittances: '/remittances',
      'send-remittance': '/remittances/send',
      'my-remittances': '/remittances/my',
      recipients: '/recipients',
      dashboard: '/dashboard',
      admin: '/admin',
      settings: '/settings',
      cart: '/cart',
      login: '/login',
      'user-panel': '/user-panel',
      'user-management': '/user-management',
      'auth/callback': '/auth/callback'
    };

    const newPath = pageToPath[page] || '/';

    if (newPath !== window.location.pathname) {
      window.history.pushState({ path: newPath }, '', newPath);
    }
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={handleNavigate} />;
      case 'products':
        return <ProductsPage onNavigate={handleNavigate} />;
      case 'product-detail':
        return <ProductDetailPage onNavigate={handleNavigate} itemId={detailParams.itemId} itemType={detailParams.itemType} />;
      case 'remittances':
        return <RemittancesPage onNavigate={handleNavigate} />;
      case 'send-remittance':
        return <ProtectedSendRemittance onNavigate={handleNavigate} />;
      case 'my-remittances':
        return <ProtectedMyRemittances onNavigate={handleNavigate} />;
      case 'recipients':
        return <ProtectedMyRecipients onNavigate={handleNavigate} />;
      case 'dashboard':
        return <ProtectedDashboard onNavigate={handleNavigate} />;
      case 'admin':
        return <ProtectedAdmin onNavigate={handleNavigate} />;
      case 'settings':
        return <ProtectedSettings onNavigate={handleNavigate} />;
      case 'cart':
        return <CartPage onNavigate={handleNavigate} />;
      case 'login':
        return <LoginPage onNavigate={handleNavigate} />;
      case 'user-panel':
        return <ProtectedUserPanel onNavigate={handleNavigate} />;
      case 'user-management':
        return <ProtectedUserManagement onNavigate={handleNavigate} />;
      case 'auth/callback':
        return <AuthCallback onNavigate={handleNavigate} />; // Pasar la prop aquí
      default:
        return <HomePage onNavigate={handleNavigate} />;
    }
  };

  return (
    <ErrorBoundary>
      <Analytics />
      <HelmetProvider>
        <LanguageProvider>
          <AuthProvider>
            <BusinessProvider>
              <CurrencyProvider>
                <ModalProvider>
                <div className="min-h-screen">
                  <DynamicTitle />

                <AnimatePresence mode="wait">
                  {isLoading ? (
                    <LoadingScreen key="loading" />
                  ) : (
                    <motion.div
                      key="main"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.5 }}
                      className="min-h-screen"
                    >
                      {currentPage !== 'auth/callback' && (
                        <Header currentPage={currentPage} onNavigate={handleNavigate} />
                      )}
                      <main className={currentPage !== 'auth/callback' ? 'pt-20' : ''}>
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={currentPage}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                          >
                            {renderPage()}
                          </motion.div>
                        </AnimatePresence>
                      </main>
                      {currentPage !== 'auth/callback' && <Footer />}
                    </motion.div>
                  )}
                </AnimatePresence>

                <Toaster />
              </div>
              </ModalProvider>
              </CurrencyProvider>
            </BusinessProvider>
          </AuthProvider>
        </LanguageProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}

export default App;