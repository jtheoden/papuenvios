import React, { useState, useEffect } from 'react';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster } from '@/components/ui/toaster';
import LoadingScreen from '@/components/LoadingScreen';
import ErrorBoundary from '@/components/ErrorBoundary';
import Header from '@/components/Header';
import HomePage from '@/components/HomePage';
import ProductsPage from '@/components/ProductsPage';
import ProductDetailPage from '@/components/ProductDetailPage';
import RemittancesPage from '@/components/RemittancesPage';
import SendRemittancePage from '@/components/SendRemittancePage';
import MyRemittancesPage from '@/components/MyRemittancesPage';
import DashboardPage from '@/components/DashboardPage';
import AdminPage from '@/components/AdminPage';
import SettingsPage from '@/components/SettingsPage';
import CartPage from '@/components/CartPage';
import LoginPage from '@/components/LoginPage';
import UserPanel from '@/components/UserPanel';
import UserManagement from '@/components/UserManagement';
import AuthCallback from '@/components/AuthCallback';
import { withProtectedRoute } from '@/components/withProtectedRoute';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { BusinessProvider, useBusiness } from '@/contexts/BusinessContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { ModalProvider } from '@/contexts/ModalContext';

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

// Protect routes with required roles
const ProtectedUserManagement = withProtectedRoute(UserManagement, 'admin');
const ProtectedDashboard = withProtectedRoute(DashboardPage, 'admin');
const ProtectedAdmin = withProtectedRoute(AdminPage, 'admin');
const ProtectedSettings = withProtectedRoute(SettingsPage, 'admin');
const ProtectedUserPanel = withProtectedRoute(UserPanel, 'user');
const ProtectedSendRemittance = withProtectedRoute(SendRemittancePage, 'user');
const ProtectedMyRemittances = withProtectedRoute(MyRemittancesPage, 'user');

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('home');
  const [detailParams, setDetailParams] = useState({ itemId: null, itemType: null });

  // Handle URL-based routing for OAuth callback
  useEffect(() => {
    const path = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));

    // Check if this is an OAuth callback
    if (path === '/auth/callback' ||
        searchParams.has('access_token') ||
        hashParams.has('access_token') ||
        searchParams.has('code')) {
      setCurrentPage('auth/callback');
    }

    // Check for product/combo detail routes
    const productMatch = path.match(/^\/product\/([^/]+)$/);
    const comboMatch = path.match(/^\/combo\/([^/]+)$/);

    if (productMatch) {
      setCurrentPage('product-detail');
      setDetailParams({ itemId: productMatch[1], itemType: 'product' });
    } else if (comboMatch) {
      setCurrentPage('product-detail');
      setDetailParams({ itemId: comboMatch[1], itemType: 'combo' });
    }

    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  const handleNavigate = (page, params = {}) => {
    setCurrentPage(page);

    // Handle detail page navigation
    if (page === 'product-detail' && params.itemId && params.itemType) {
      setDetailParams({ itemId: params.itemId, itemType: params.itemType });
      const url = `/${params.itemType}/${params.itemId}`;
      window.history.pushState({}, '', url);
    }
    // Update browser URL if needed
    else if (page === 'home' && window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    } else if (page !== 'home' && window.location.pathname === '/') {
      window.history.pushState({}, '', `/${page}`);
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
      <HelmetProvider>
        <LanguageProvider>
          <AuthProvider>
            <BusinessProvider>
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
                    </motion.div>
                  )}
                </AnimatePresence>

                <Toaster />
              </div>
              </ModalProvider>
            </BusinessProvider>
          </AuthProvider>
        </LanguageProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}

export default App;