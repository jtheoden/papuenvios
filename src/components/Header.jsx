import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ShoppingBag, Globe, DollarSign, BarChart3, Settings, ShoppingCart, User as UserIcon, LogIn, LogOut, ShieldCheck, Users, LayoutDashboard, ChevronDown } from 'lucide-react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { getPendingOrdersCount } from '@/lib/orderService';

const Header = ({ currentPage, onNavigate }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const { language, setLanguage, t } = useLanguage();
  const { cart, visualSettings } = useBusiness();
  const { user, isAdmin, userRole } = useAuth();

  // Public menu items
  let publicMenuItems = [
    { id: 'home', icon: ShoppingBag, label: t('nav.home') },
    { id: 'products', icon: ShoppingBag, label: t('nav.products') },
    { id: 'remittances', icon: DollarSign, label: t('nav.remittances') },
  ];

  

  // Admin menu items (grouped)
  const adminMenuItems = [
    { id: 'dashboard', icon: BarChart3, label: t('nav.dashboard') },
    { id: 'admin', icon: LayoutDashboard, label: t('nav.admin') },
    { id: 'user-management', icon: Users, label: t('nav.userManagement') },
    { id: 'settings', icon: Settings, label: t('nav.settings') },
  ];

  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    toast({ title: t('auth.logoutSuccess') });
    onNavigate('home');
  };

  const handleLogin = () => {
    onNavigate('login');
  };

  const handleNavClick = (id) => {
    onNavigate(id);
    setIsAdminMenuOpen(false);
    setIsMenuOpen(false);
  };

  // Load pending orders count for admin
  useEffect(() => {
    if (userRole === 'admin' || userRole === 'super_admin') {
      loadPendingOrders();
      // Refresh every 30 seconds
      const interval = setInterval(loadPendingOrders, 30000);      
      return () => clearInterval(interval);
    }
  }, [userRole]);

  const loadPendingOrders = async () => {
    try {
      const count = await getPendingOrdersCount();
      setPendingOrdersCount(count || 0);
    } catch (error) {
      console.error('Error loading pending orders:', error);
      setPendingOrdersCount(0);
    }
  };

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md shadow-sm"
      style={{
        backgroundColor: visualSettings.headerBgColor || 'rgba(255, 255, 255, 0.8)',
        color: visualSettings.headerTextColor || '#1f2937'
      }}
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="flex items-center space-x-2 cursor-pointer"
            onClick={() => handleNavClick('home')}
          >
            {visualSettings.logo ? (
              <div className="w-10 h-10 flex items-center justify-center">
                <img
                  src={visualSettings.logo}
                  alt={visualSettings.companyName || 'Logo'}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ) : (
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: visualSettings.useGradient
                    ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                    : visualSettings.primaryColor || '#2563eb'
                }}
              >
                <ShoppingBag className="w-5 h-5 text-white" />
              </div>
            )}
            <span
              className="text-xl font-bold"
              style={{
                backgroundImage: visualSettings.useGradient
                  ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                  : `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.primaryColor || '#2563eb'})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}
            >
              {visualSettings?.logoName || 'PapuEnvíos'}
            </span>
          </motion.div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {/* Public items */}
            {publicMenuItems.map((item) => (
              <Button
                key={item.id}
                variant={currentPage === item.id ? "default" : "ghost"}
                size="sm"
                onClick={() => handleNavClick(item.id)}
                className="flex items-center space-x-2"
                style={currentPage === item.id ? {
                  background: visualSettings.useGradient
                    ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                    : visualSettings.buttonBgColor || '#2563eb',
                  color: visualSettings.buttonTextColor || '#ffffff',
                  border: 'none'
                } : {
                  color: visualSettings.headerTextColor || '#1f2937'
                }}
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Button>
            ))}

            {/* Admin dropdown */}
            {isAdmin && (
              <div className="relative">
                <Button
                  variant={adminMenuItems.some(i => currentPage === i.id) ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setIsAdminMenuOpen(!isAdminMenuOpen)}
                  className="flex items-center space-x-2"
                  style={adminMenuItems.some(i => currentPage === i.id) ? {
                    background: visualSettings.useGradient
                      ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                      : visualSettings.buttonBgColor || '#2563eb',
                    color: visualSettings.buttonTextColor || '#ffffff',
                    border: 'none'
                  } : {
                    color: visualSettings.headerTextColor || '#1f2937'
                  }}
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Admin</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${isAdminMenuOpen ? 'rotate-180' : ''}`} />
                </Button>

                <AnimatePresence>
                  {isAdminMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute right-0 mt-2 w-56 rounded-xl shadow-xl overflow-hidden backdrop-blur-md"
                      style={{
                        backgroundColor: visualSettings.headerBgColor || 'rgba(255, 255, 255, 0.95)',
                        color: visualSettings.headerTextColor || '#1f2937'
                      }}
                    >
                      {adminMenuItems.map((item) => {
                        // Calculate hover background color based on header background
                        const isHeaderLight = visualSettings.headerBgColor === '#ffffff' || !visualSettings.headerBgColor;
                        const hoverBgColor = isHeaderLight
                          ? `${visualSettings.primaryColor}15` // 15 = 8% opacity in hex
                          : `${visualSettings.headerBgColor}40`; // Lighter shade

                        const activeStyle = currentPage === item.id ? {
                          backgroundColor: hoverBgColor,
                          color: visualSettings.primaryColor || '#2563eb'
                        } : {};

                        return (
                          <Button
                            key={item.id}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleNavClick(item.id)}
                            className="w-full justify-start flex items-center space-x-2 rounded-none hover:opacity-100"
                            style={{
                              ...activeStyle,
                              color: visualSettings.headerTextColor || '#1f2937'
                            }}
                            onMouseEnter={(e) => {
                              if (currentPage !== item.id) {
                                e.currentTarget.style.backgroundColor = hoverBgColor;
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (currentPage !== item.id) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }
                            }}
                          >
                            <item.icon className="w-4 h-4" />
                            <span>{item.label}</span>
                          </Button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </nav>

          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
              className="hidden sm:flex items-center space-x-2"
              style={{
                borderColor: visualSettings.primaryColor || '#2563eb',
                color: visualSettings.primaryColor || '#2563eb'
              }}
            >
              <Globe className="w-4 h-4" />
              <span>{language.toUpperCase()}</span>
            </Button>

            {userRole !== 'admin' && userRole !== 'super_admin' && (
              <Button variant="ghost" size="icon" onClick={() => onNavigate('cart')}>
                <div className="relative">
                  <ShoppingCart className="w-5 h-5" />
                  {cart.length > 0 && (
                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                      {cart.reduce((acc, item) => acc + item.quantity, 0)}
                    </span>
                  )}
                </div>
              </Button>
            )}

            {user ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onNavigate('user-panel')}
                  className="relative"
                >
                  <div className="relative">
                    <UserAvatar user={user} />
                    {(userRole === 'admin' || userRole === 'super_admin') && pendingOrdersCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold shadow-lg">
                        {pendingOrdersCount}
                      </span>
                    )}
                  </div>
                </Button>
                <Button variant="ghost" size="icon" onClick={handleLogout}>
                  <LogOut className="w-5 h-5" />
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="icon" onClick={handleLogin}>
                <LogIn className="w-5 h-5" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.nav
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden border-t border-white/20 py-4"
            >
              <div className="flex flex-col space-y-2">
                {/* Public items */}
                {publicMenuItems.map((item) => (
                  <Button
                    key={item.id}
                    variant={currentPage === item.id ? "default" : "ghost"}
                    size="sm"
                    onClick={() => handleNavClick(item.id)}
                    className="flex items-center space-x-2 justify-start"
                    style={currentPage === item.id ? {
                      background: visualSettings.useGradient
                        ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                        : visualSettings.buttonBgColor || '#2563eb',
                      color: visualSettings.buttonTextColor || '#ffffff',
                      border: 'none'
                    } : {
                      color: visualSettings.headerTextColor || '#1f2937'
                    }}
                  >
                    <item.icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </Button>
                ))}

                {/* Admin section */}
                {isAdmin && (
                  <>
                    <div
                      className="pt-2 pb-1 px-2 text-xs font-semibold uppercase opacity-70"
                      style={{ color: visualSettings.headerTextColor || '#6b7280' }}
                    >
                      {t('nav.adminMenu')}
                    </div>
                    {adminMenuItems.map((item) => (
                      <Button
                        key={item.id}
                        variant={currentPage === item.id ? "default" : "ghost"}
                        size="sm"
                        onClick={() => handleNavClick(item.id)}
                        className="flex items-center space-x-2 justify-start"
                        style={currentPage === item.id ? {
                          background: visualSettings.useGradient
                            ? `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`
                            : visualSettings.buttonBgColor || '#2563eb',
                          color: visualSettings.buttonTextColor || '#ffffff',
                          border: 'none'
                        } : {
                          color: visualSettings.useGradient || '#1f2937'
                        }}
                      >
                        <item.icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </Button>
                    ))}
                  </>
                )}
                <Button
              variant="outline"
              size="sm"
              onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
              className="flex items-center space-x-2 justify-start"
               style={{background: `linear-gradient(to right, ${visualSettings.primaryColor || '#2563eb'}, ${visualSettings.secondaryColor || '#9333ea'})`,
                border: 'none', color: visualSettings.buttonTextColor || '#ffffff'}}
            >
              <Globe className="w-4 h-4" />
              <span>{language.toUpperCase()}</span>
            </Button>
   
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
};

export default Header;