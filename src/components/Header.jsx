import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ShoppingBag, Globe, DollarSign, BarChart3, Settings, ShoppingCart, User as UserIcon, LogIn, LogOut, ShieldCheck, Users, LayoutDashboard, ChevronDown, Crown, Zap, Star, Home, Package, Banknote, BookOpen } from 'lucide-react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { getPendingOrdersCount } from '@/lib/orderService';
import { semanticColors } from '@/lib/colorTokens';

const Header = ({ currentPage, onNavigate }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [isMobileUser, setIsMobileUser] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const { cart, visualSettings } = useBusiness();
  const { user, isAdmin, userRole, userCategory } = useAuth();

  // Detect mobile viewport for user-friendly quick nav
  const MOBILE_BREAKPOINT = 740;

  useEffect(() => {
    const checkMobile = () => {
      setIsMobileUser(window.innerWidth < MOBILE_BREAKPOINT);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Quick nav items for mobile users (non-admin)
  const quickNavItems = [
    { id: 'home', icon: Home, label: t('nav.home') },
    { id: 'products', icon: Package, label: t('nav.products') },
    { id: 'remittances', icon: Banknote, label: t('nav.remittances') },
  ];

  // Check if quick nav should show (mobile + non-admin user)
  const showQuickNav = isMobileUser && !isAdmin;

  // Public menu items (hide remittances for admin - they use admin panel)
  let publicMenuItems = [
    { id: 'home', icon: ShoppingBag, label: t('nav.home') },
    { id: 'products', icon: ShoppingBag, label: t('nav.products') },
    ...(!isAdmin ? [{ id: 'remittances', icon: DollarSign, label: t('nav.remittances') }] : []),
    { id: 'blog', icon: BookOpen, label: t('nav.blog') },
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
    setIsUserMenuOpen(false);
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

  const getCategoryIndicatorConfig = (categoryName) => {
    const normalized = categoryName || 'regular';
    const baseConfig = {
      regular: { Icon: Star, color: visualSettings.primaryColor || semanticColors.neutral[700] },
      pro: { Icon: Zap, color: '#2563eb' },
      vip: { Icon: Crown, color: '#d97706' }
    };

    return baseConfig[normalized] || baseConfig.regular;
  };

  const renderCategoryIndicator = () => {
    if (!userCategory?.category_name) return null;

    const { Icon, color } = getCategoryIndicatorConfig(userCategory.category_name);
    const translationKey = `users.categories.status${userCategory.category_name.charAt(0).toUpperCase()}${userCategory.category_name.slice(1)}`;

    return (
      <span
        className="absolute -left-2 -top-1 flex items-center justify-center h-5 w-5 rounded-full shadow-sm"
        style={{ backgroundColor: '#ffffff', border: `1px solid ${color}`, color }}
        title={`${t('users.categories.current')}: ${t(translationKey)}`}
      >
        <Icon className="h-3 w-3" />
      </span>
    );
  };

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md shadow-sm"
      style={{
        backgroundColor: visualSettings.headerBgColor || 'rgba(255, 255, 255, 0.8)',
        color: visualSettings.headerTextColor || semanticColors.neutral[800]
      }}
    >
      <div className="container mx-auto px-2 sm:px-4">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-1 sm:gap-2">
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="flex items-center gap-1 sm:gap-2 cursor-pointer min-w-0 flex-shrink-0"
            onClick={() => handleNavClick('home')}
          >
            {visualSettings.logo ? (
              <img
                src={visualSettings.logo}
                alt={visualSettings.companyName || 'Logo'}
                className="object-contain flex-shrink-0"
                style={{
                  maxHeight: `${visualSettings.logoMaxHeight || 40}px`,
                  width: 'auto'
                }}
              />
            ) : (
              <div
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background: visualSettings.useGradient
                    ? `linear-gradient(to right, ${visualSettings.primaryColor || semanticColors.primary.main}, ${visualSettings.secondaryColor || semanticColors.secondary.hex})`
                    : visualSettings.primaryColor || semanticColors.primary.main
                }}
              >
                <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
            )}
            {(visualSettings.showCompanyName !== false) && (
              <span
                className="text-sm sm:text-xl font-bold truncate max-w-[100px] sm:max-w-none"
                style={{
                  backgroundImage: visualSettings.useGradient
                    ? `linear-gradient(to right, ${visualSettings.primaryColor || semanticColors.primary.main}, ${visualSettings.secondaryColor || semanticColors.secondary.hex})`
                    : `linear-gradient(to right, ${visualSettings.primaryColor || semanticColors.primary.main}, ${visualSettings.primaryColor || semanticColors.primary.main})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text'
                }}
              >
                {visualSettings?.companyName || 'PapuEnvíos'}
              </span>
            )}
          </motion.div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {/* Public items */}
            {publicMenuItems.map((item) => {
              const isActive = currentPage === item.id;
              const navHoverBg = visualSettings.headerMenuHoverBgColor || `${visualSettings.primaryColor || '#2563eb'}15`;
              const navHoverText = visualSettings.headerMenuHoverTextColor || visualSettings.headerTextColor || semanticColors.neutral[800];
              const navText = visualSettings.headerTextColor || semanticColors.neutral[800];
              const navActiveBg = visualSettings.navBarActiveBgColor || visualSettings.primaryColor || semanticColors.primary.main;
              const navActiveText = visualSettings.navBarActiveTextColor || '#ffffff';
              const useNavGradient = visualSettings.useHeaderGradient || visualSettings.useGradient;
              const navGradientEnd = visualSettings.headerGradientColor || visualSettings.secondaryColor || semanticColors.secondary.hex;
              const dir = visualSettings.gradientDirection || 135;
              return (
                <Button
                  key={item.id}
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  onClick={() => handleNavClick(item.id)}
                  className="flex items-center space-x-2"
                  style={isActive ? {
                    background: useNavGradient
                      ? `linear-gradient(${dir}deg, ${navActiveBg}, ${navGradientEnd})`
                      : navActiveBg,
                    color: navActiveText,
                    border: 'none'
                  } : {
                    color: navText
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = navHoverBg;
                      e.currentTarget.style.color = navHoverText;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = navText;
                    }
                  }}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Button>
              );
            })}

            {/* Admin dropdown */}
            {isAdmin && (() => {
              const adminIsActive = adminMenuItems.some(i => currentPage === i.id);
              const adminActiveBg = visualSettings.navBarActiveBgColor || visualSettings.primaryColor || semanticColors.primary.main;
              const adminActiveText = visualSettings.navBarActiveTextColor || '#ffffff';
              const useNavGradient = visualSettings.useHeaderGradient || visualSettings.useGradient;
              const navGradientEnd = visualSettings.headerGradientColor || visualSettings.secondaryColor || semanticColors.secondary.hex;
              const dir = visualSettings.gradientDirection || 135;
              return (
              <div className="relative">
                <Button
                  variant={adminIsActive ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setIsAdminMenuOpen(!isAdminMenuOpen)}
                  className="flex items-center space-x-2"
                  style={adminIsActive ? {
                    background: useNavGradient
                      ? `linear-gradient(${dir}deg, ${adminActiveBg}, ${navGradientEnd})`
                      : adminActiveBg,
                    color: adminActiveText,
                    border: 'none'
                  } : {
                    color: visualSettings.headerTextColor || semanticColors.neutral[800]
                  }}
                  onMouseEnter={(e) => {
                    if (!adminMenuItems.some(i => currentPage === i.id)) {
                      e.currentTarget.style.backgroundColor = visualSettings.headerMenuHoverBgColor || `${visualSettings.primaryColor || '#2563eb'}15`;
                      e.currentTarget.style.color = visualSettings.headerMenuHoverTextColor || visualSettings.headerTextColor || semanticColors.neutral[800];
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!adminMenuItems.some(i => currentPage === i.id)) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = visualSettings.headerTextColor || semanticColors.neutral[800];
                    }
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
                        backgroundColor: visualSettings.headerMenuBgColor || visualSettings.headerBgColor || 'rgba(255, 255, 255, 0.95)',
                        color: visualSettings.headerMenuTextColor || visualSettings.headerTextColor || semanticColors.neutral[800]
                      }}
                    >
                      {adminMenuItems.map((item) => {
                        const isActive = currentPage === item.id;
                        const hoverBgColor = visualSettings.headerMenuHoverBgColor || `${visualSettings.primaryColor}15`;
                        const hoverTextColor = visualSettings.headerMenuHoverTextColor || visualSettings.headerMenuTextColor || semanticColors.neutral[800];
                        const activeBgColor = visualSettings.headerMenuActiveBgColor || hoverBgColor;
                        const activeColor = visualSettings.headerMenuActiveColor || visualSettings.primaryColor || semanticColors.primary.main;
                        const dir = visualSettings.gradientDirection || 135;
                        const menuTextColor = visualSettings.headerMenuTextColor || visualSettings.headerTextColor || semanticColors.neutral[800];

                        const activeStyle = visualSettings.useHeaderGradient
                          ? {
                              backgroundColor: activeBgColor,
                              backgroundImage: `linear-gradient(${dir}deg, ${activeColor}, ${visualSettings.headerGradientColor || visualSettings.secondaryColor || '#9333ea'})`,
                              WebkitBackgroundClip: 'text',
                              WebkitTextFillColor: 'transparent',
                              backgroundClip: 'text'
                            }
                          : {
                              backgroundColor: activeBgColor,
                              color: activeColor
                            };

                        return (
                          <Button
                            key={item.id}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleNavClick(item.id)}
                            className="w-full justify-start flex items-center space-x-2 rounded-none hover:opacity-100"
                            style={isActive
                              ? activeStyle
                              : { backgroundColor: 'transparent', color: menuTextColor }
                            }
                            onMouseEnter={(e) => {
                              if (!isActive) {
                                e.currentTarget.style.backgroundColor = hoverBgColor;
                                e.currentTarget.style.color = hoverTextColor;
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isActive) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = menuTextColor;
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
              );
            })()}
          </nav>

          <div className="flex items-center gap-0.5 sm:gap-2 flex-shrink-0">
            {/* Desktop language selector */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
              className="hidden sm:flex items-center space-x-2"
              style={{
                borderColor: visualSettings.primaryColor || semanticColors.primary.main,
                color: visualSettings.primaryColor || semanticColors.primary.main
              }}
            >
              <Globe className="w-4 h-4" />
              <span>{language.toUpperCase()}</span>
            </Button>

            {/* Mobile language selector for regular users - positioned before cart */}
            {showQuickNav && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                className="sm:hidden h-8 w-8 flex items-center justify-center"
                style={{ color: visualSettings.primaryColor || semanticColors.primary.main }}
                title={language === 'es' ? 'Switch to English' : 'Cambiar a Español'}
              >
                <Globe className="w-4 h-4" />
              </Button>
            )}

            {userRole !== 'admin' && userRole !== 'super_admin' && (
              <Button variant="ghost" size="icon" onClick={() => onNavigate('cart')} className="h-8 w-8 sm:h-9 sm:w-9">
                <div className="relative">
                  <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />
                  {cart.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                      {cart.reduce((acc, item) => acc + item.quantity, 0)}
                    </span>
                  )}
                </div>
              </Button>
            )}

            {user ? (
              /* Authenticated: Avatar with dropdown menu */
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="relative h-8 w-8 sm:h-9 sm:w-9"
                >
                  <div className="relative">
                    {renderCategoryIndicator()}
                    <UserAvatar user={user} />
                    {(userRole === 'admin' || userRole === 'super_admin') && pendingOrdersCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold shadow-lg">
                        {pendingOrdersCount}
                      </span>
                    )}
                  </div>
                </Button>

                {/* User Dropdown Menu */}
                <AnimatePresence>
                  {isUserMenuOpen && (
                    <>
                      {/* Backdrop */}
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsUserMenuOpen(false)}
                      />
                      <motion.div
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-50"
                      >
                        {/* User Panel */}
                        <button
                          onClick={() => {
                            onNavigate('user-panel');
                            setIsUserMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          <UserIcon className="w-4 h-4" />
                          {language === 'es' ? 'Panel de Usuario' : 'User Panel'}
                        </button>

                        <div className="border-t border-gray-100 my-1" />

                        {/* Logout */}
                        <button
                          onClick={() => {
                            handleLogout();
                            setIsUserMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          {language === 'es' ? 'Salir' : 'Logout'}
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              /* Guest: User icon → login (Req 10) */
              <Button variant="ghost" size="icon" onClick={handleLogin} className="h-8 w-8 sm:h-9 sm:w-9" title={t('auth.login')}>
                <UserIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-8 w-8 sm:h-9 sm:w-9"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Quick Navigation Pills for Regular Users - UX optimized for elderly users */}
        {showQuickNav && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-t py-2 px-1"
            style={{
              borderColor: `${visualSettings.primaryColor || semanticColors.primary.main}20`,
              backgroundColor: `${visualSettings.headerBgColor || 'rgba(255, 255, 255, 0.95)'}`
            }}
          >
            <div className="flex items-center justify-center gap-2">
              {quickNavItems.map((item) => {
                const isActive = currentPage === item.id;
                return (
                  <motion.button
                    key={item.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleNavClick(item.id)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-all duration-200 min-w-[85px] justify-center shadow-sm"
                    style={isActive ? {
                      background: (visualSettings.useHeaderGradient || visualSettings.useGradient)
                        ? `linear-gradient(${visualSettings.gradientDirection || 135}deg, ${visualSettings.navBarActiveBgColor || visualSettings.primaryColor || semanticColors.primary.main}, ${visualSettings.headerGradientColor || visualSettings.secondaryColor || semanticColors.secondary.hex})`
                        : visualSettings.navBarActiveBgColor || visualSettings.primaryColor || semanticColors.primary.main,
                      color: visualSettings.navBarActiveTextColor || '#ffffff',
                      boxShadow: `0 2px 8px ${visualSettings.navBarActiveBgColor || visualSettings.primaryColor || semanticColors.primary.main}40`
                    } : {
                      backgroundColor: `${visualSettings.primaryColor || semanticColors.primary.main}12`,
                      color: visualSettings.primaryColor || semanticColors.primary.main,
                      border: `1.5px solid ${visualSettings.primaryColor || semanticColors.primary.main}30`
                    }}
                  >
                    <item.icon className="w-4 h-4" />
                    <span className="truncate">{item.label}</span>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}

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
                {publicMenuItems.map((item) => {
                  const isActive = currentPage === item.id;
                  const navHoverBg = visualSettings.headerMenuHoverBgColor || `${visualSettings.primaryColor || '#2563eb'}15`;
                  const navHoverText = visualSettings.headerMenuHoverTextColor || visualSettings.headerTextColor || semanticColors.neutral[800];
                  const navText = visualSettings.headerTextColor || semanticColors.neutral[800];
                  return (
                    <Button
                      key={item.id}
                      variant={isActive ? "default" : "ghost"}
                      size="sm"
                      onClick={() => handleNavClick(item.id)}
                      className="flex items-center space-x-2 justify-start"
                      style={isActive ? {
                        background: (visualSettings.useHeaderGradient || visualSettings.useGradient)
                          ? `linear-gradient(${visualSettings.gradientDirection || 135}deg, ${visualSettings.navBarActiveBgColor || visualSettings.primaryColor || semanticColors.primary.main}, ${visualSettings.headerGradientColor || visualSettings.secondaryColor || semanticColors.secondary.hex})`
                          : visualSettings.navBarActiveBgColor || visualSettings.primaryColor || semanticColors.primary.main,
                        color: visualSettings.navBarActiveTextColor || '#ffffff',
                        border: 'none'
                      } : {
                        color: navText
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = navHoverBg;
                          e.currentTarget.style.color = navHoverText;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.color = navText;
                        }
                      }}
                    >
                      <item.icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </Button>
                  );
                })}

                {/* Admin section */}
                {isAdmin && (
                  <>
                    <div
                      className="pt-2 pb-1 px-2 text-xs font-semibold uppercase opacity-70"
                      style={{ color: visualSettings.headerTextColor || semanticColors.neutral[500] }}
                    >
                      {t('nav.adminMenu')}
                    </div>
                    {adminMenuItems.map((item) => {
                      const isActive = currentPage === item.id;
                      const navHoverBg = visualSettings.headerMenuHoverBgColor || `${visualSettings.primaryColor || '#2563eb'}15`;
                      const navHoverText = visualSettings.headerMenuHoverTextColor || visualSettings.headerTextColor || semanticColors.neutral[800];
                      const navText = visualSettings.headerTextColor || semanticColors.neutral[800];
                      return (
                        <Button
                          key={item.id}
                          variant={isActive ? "default" : "ghost"}
                          size="sm"
                          onClick={() => handleNavClick(item.id)}
                          className="flex items-center space-x-2 justify-start"
                          style={isActive ? {
                            background: (visualSettings.useHeaderGradient || visualSettings.useGradient)
                              ? `linear-gradient(${visualSettings.gradientDirection || 135}deg, ${visualSettings.navBarActiveBgColor || visualSettings.primaryColor || semanticColors.primary.main}, ${visualSettings.headerGradientColor || visualSettings.secondaryColor || semanticColors.secondary.hex})`
                              : visualSettings.navBarActiveBgColor || visualSettings.primaryColor || semanticColors.primary.main,
                            color: visualSettings.navBarActiveTextColor || '#ffffff',
                            border: 'none'
                          } : {
                            color: navText
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) {
                              e.currentTarget.style.backgroundColor = navHoverBg;
                              e.currentTarget.style.color = navHoverText;
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) {
                              e.currentTarget.style.backgroundColor = 'transparent';
                              e.currentTarget.style.color = navText;
                            }
                          }}
                        >
                          <item.icon className="w-4 h-4" />
                          <span>{item.label}</span>
                        </Button>
                      );
                    })}
                  </>
                )}
                <Button
              variant="outline"
              size="sm"
              onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
              className="flex items-center space-x-2 justify-start"
               style={{background: `linear-gradient(to right, ${visualSettings.primaryColor || semanticColors.primary.main}, ${visualSettings.secondaryColor || semanticColors.secondary.hex})`,
                border: 'none', color: visualSettings.buttonTextColor || semanticColors.background.primary}}
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