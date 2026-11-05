import React, { useState, useEffect, useCallback, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ShoppingBag, Globe, DollarSign, BarChart3, Settings, ShoppingCart, User as UserIcon, LogIn, LogOut, ShieldCheck, Users, LayoutDashboard, ChevronDown, Crown, Zap, Star, Home, Package, Banknote, BookOpen } from 'lucide-react';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { getPendingOrdersCount } from '@/lib/orderService';
import { getPendingRemittancesCount } from '@/lib/remittanceService';
import { getRefundCounts, REFUNDS_CHANGED_EVENT } from '@/lib/refundService';
import { useRealtimeOrders, useRealtimeRemittances } from '@/hooks/useRealtimeSubscription';
import { semanticColors } from '@/lib/colorTokens';
import RoleUnresolvedBanner from '@/components/RoleUnresolvedBanner';
import { isRefreshBlocked, skipWhileRefreshBlocked } from '@/lib/refreshGuard';
import { buildHeaderTheme } from '@/lib/headerTheme';

// Colours come from CSS variables set on the header root (see buildHeaderTheme). Hover and focus
// are classes, so no inline style can override them.
const ICON_FOCUS = 'focus-visible:ring-brand-focus';
const NAV_BASE = `flex items-center space-x-2 motion-reduce:transition-none motion-reduce:active:scale-100 ${ICON_FOCUS}`;
// shortcut: legacy wordmark gradient (see buildHeaderTheme), until S5 brings the official logo.
const MARK_GRADIENT = 'bg-[linear-gradient(to_right,var(--hdr-mark-from),var(--hdr-mark-to))]';
const NAV_IDLE = 'text-[color:var(--hdr-text)] hover:bg-[color:var(--hdr-hover-bg)] hover:text-[color:var(--hdr-hover-text)]';
// The active state does not rely on colour alone: bold + underline (WCAG 1.4.1).
const ACTIVE_CUE = 'font-semibold underline decoration-2 underline-offset-4';
const NAV_ACTIVE = `${ACTIVE_CUE} [background:var(--hdr-active-background)] text-[color:var(--hdr-active-text)] hover:bg-[color:var(--hdr-active-bg)] hover:text-[color:var(--hdr-active-text)]`;
const PILL_IDLE = 'bg-[color:var(--hdr-pill-bg)] border-[color:var(--hdr-pill-border)] text-[color:var(--hdr-pill-text)] hover:bg-[color:var(--hdr-hover-bg)] hover:text-[color:var(--hdr-hover-text)]';
const MENU_IDLE = 'text-[color:var(--hdr-menu-text)] hover:bg-[color:var(--hdr-hover-bg)] hover:text-[color:var(--hdr-hover-text)]';
const MENU_ACTIVE = `${ACTIVE_CUE} bg-[color:var(--hdr-menu-active-bg)] text-[color:var(--hdr-menu-active-text)] hover:bg-[color:var(--hdr-menu-active-bg)] hover:text-[color:var(--hdr-menu-active-text)]`;

/**
 * Behaviour shared by the header dropdowns: the first item (or the current page's) takes focus on open;
 * Escape closes and returns focus to the trigger; arrows/Home/End move between items; a press outside or
 * Tab out closes. Spread `handlers` on the wrapper that holds both the trigger ([aria-haspopup]) and the menu.
 */
const useDropdownMenu = (open, setOpen) => {
  const ref = useRef(null);
  const items = () => [...ref.current.querySelectorAll('[role="menuitem"]')];

  useEffect(() => {
    if (!open) return undefined;
    const list = items();
    (list.find((el) => el.hasAttribute('aria-current')) || list[0])?.focus();
    const onPress = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPress);
    return () => document.removeEventListener('mousedown', onPress);
  }, [open, setOpen]);

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      ref.current.querySelector('[aria-haspopup]')?.focus();
      return;
    }
    const list = items();
    const at = list.indexOf(document.activeElement);
    const next = { ArrowDown: (at + 1) % list.length, ArrowUp: (at - 1 + list.length) % list.length, Home: 0, End: list.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    list[next]?.focus();
  };
  const onBlur = (e) => {
    if (open && e.relatedTarget && !ref.current.contains(e.relatedTarget)) setOpen(false);
  };

  return { ref, handlers: { onKeyDown, onBlur } };
};

const NavButton = ({ active, current = active, menu = false, icon: Icon, label, className = '', children, ...props }) => {
  const tone = menu ? (active ? MENU_ACTIVE : MENU_IDLE) : (active ? NAV_ACTIVE : NAV_IDLE);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-current={current ? 'page' : undefined}
      className={`${NAV_BASE} ${tone} ${className}`}
      {...props}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      {children}
    </Button>
  );
};

const Header = ({ currentPage, onNavigate }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [overdueRefunds, setOverdueRefunds] = useState(0);
  const [isMobileUser, setIsMobileUser] = useState(false);
  const headerRef = useRef(null);
  const adminMenuId = useId();
  const userMenuId = useId();
  const adminMenu = useDropdownMenu(isAdminMenuOpen, setIsAdminMenuOpen);
  const userMenu = useDropdownMenu(isUserMenuOpen, setIsUserMenuOpen);
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

  // Publish the real header height (it grows with the quick-nav row, the open mobile menu and the role
  // banner) so fixed elements under it, like ZelleAccountAlert, can sit right below instead of guessing.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--header-h', `${el.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--header-h');
    };
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

  const isAdminRole = userRole === 'admin' || userRole === 'super_admin';

  // Pending work for admins: orders + remittances + refunds that can be paid today (past the 48 h hold).
  // A failing source counts as 0 without hiding the others.
  // While the token refresh is blocked the requests would go out anonymous and read as 0: keep the last badge.
  const loadPendingCount = useCallback(async () => {
    if (isRefreshBlocked()) return;
    const [orders, remittances, refunds] = await Promise.all([
      getPendingOrdersCount().catch((error) => {
        console.error('Error loading pending orders:', error);
        return 0;
      }),
      getPendingRemittancesCount(),
      getRefundCounts().catch(() => ({ actionable: 0, overdue: 0 }))
    ]);
    setPendingCount((orders || 0) + (remittances || 0) + (refunds?.actionable || 0));
    setOverdueRefunds(refunds?.overdue || 0);
  }, []);

  // Initial load + 30s polling as a safety net in case a realtime event is missed
  useEffect(() => {
    if (!isAdminRole) return undefined;
    loadPendingCount();
    const interval = setInterval(skipWhileRefreshBlocked(loadPendingCount), 30000);
    return () => clearInterval(interval);
  }, [isAdminRole, loadPendingCount]);

  // The refunds screen announces a resolution so the badge drops without waiting for the 30 s poll
  useEffect(() => {
    if (!isAdminRole) return undefined;
    window.addEventListener(REFUNDS_CHANGED_EVENT, loadPendingCount);
    return () => window.removeEventListener(REFUNDS_CHANGED_EVENT, loadPendingCount);
  }, [isAdminRole, loadPendingCount]);

  // Real time: any change in orders/remittances (e.g. a new remittance registered) refreshes the badge
  useRealtimeOrders({ onUpdate: loadPendingCount, enabled: isAdminRole });
  useRealtimeRemittances({ onUpdate: loadPendingCount, enabled: isAdminRole });

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

  const toggleLanguage = () => setLanguage(language === 'es' ? 'en' : 'es');
  const adminIsActive = adminMenuItems.some((i) => currentPage === i.id);
  const theme = buildHeaderTheme(visualSettings);
  const legacyMark = Boolean(theme['--hdr-mark-from']);

  return (
    <motion.header
      ref={headerRef}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md shadow-sm"
      style={theme}
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
            ) : legacyMark && (
              <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${MARK_GRADIENT}`}>
                <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
            )}
            {(visualSettings.showCompanyName !== false) && (
              <span
                className={`text-sm sm:text-xl font-bold truncate max-w-[100px] sm:max-w-none ${legacyMark ? `${MARK_GRADIENT} bg-clip-text text-transparent` : ''}`}
              >
                {visualSettings?.companyName || 'PapuEnvíos'}
              </span>
            )}
          </motion.div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {/* Public items */}
            {publicMenuItems.map((item) => (
              <NavButton
                key={item.id}
                active={currentPage === item.id}
                icon={item.icon}
                label={item.label}
                onClick={() => handleNavClick(item.id)}
              />
            ))}

            {/* Admin dropdown */}
            {isAdmin && (
              <div className="relative" ref={adminMenu.ref} {...adminMenu.handlers}>
                <NavButton
                  active={adminIsActive}
                  current={false}
                  icon={ShieldCheck}
                  label="Admin"
                  aria-haspopup="true"
                  aria-controls={adminMenuId}
                  aria-expanded={isAdminMenuOpen}
                  onClick={() => setIsAdminMenuOpen(!isAdminMenuOpen)}
                >
                  <ChevronDown className={`w-3 h-3 transition-transform ${isAdminMenuOpen ? 'rotate-180' : ''}`} />
                </NavButton>

                <AnimatePresence>
                  {isAdminMenuOpen && (
                    <motion.div
                      id={adminMenuId}
                      role="menu"
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute right-0 mt-2 w-56 rounded-xl shadow-xl overflow-hidden bg-[color:var(--hdr-menu-bg)] text-[color:var(--hdr-menu-text)]"
                    >
                      {adminMenuItems.map((item) => (
                        <NavButton
                          key={item.id}
                          menu
                          role="menuitem"
                          active={currentPage === item.id}
                          icon={item.icon}
                          label={item.label}
                          className="w-full justify-start rounded-none"
                          onClick={() => handleNavClick(item.id)}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </nav>

          <div className="flex items-center gap-0.5 sm:gap-2 flex-shrink-0">
            {/* Desktop language selector */}
            <Button
              variant="brand-outline"
              size="sm"
              onClick={toggleLanguage}
              className="hidden sm:flex items-center space-x-2"
            >
              <Globe className="w-4 h-4" />
              <span>{language.toUpperCase()}</span>
            </Button>

            {/* Mobile language selector for regular users - positioned before cart */}
            {showQuickNav && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleLanguage}
                className="sm:hidden h-8 w-8 flex items-center justify-center text-[color:var(--hdr-globe)] focus-visible:ring-brand-focus"
                title={language === 'es' ? 'Switch to English' : 'Cambiar a Español'}
              >
                <Globe className="w-4 h-4" />
              </Button>
            )}

            {userRole !== 'admin' && userRole !== 'super_admin' && (
              <Button variant="ghost" size="icon" onClick={() => onNavigate('cart')} className={`h-8 w-8 sm:h-9 sm:w-9 ${ICON_FOCUS}`}>
                <span className="sr-only">{t('nav.cart')}</span>
                <div className="relative">
                  <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />
                  {cart.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-brand-badge text-brand-badge-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                      {cart.reduce((acc, item) => acc + item.quantity, 0)}
                    </span>
                  )}
                </div>
              </Button>
            )}

            {user ? (
              /* Authenticated: Avatar with dropdown menu */
              <div className="relative" ref={userMenu.ref} {...userMenu.handlers}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-haspopup="true"
                  aria-controls={userMenuId}
                  aria-expanded={isUserMenuOpen}
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className={`relative h-8 w-8 sm:h-9 sm:w-9 ${ICON_FOCUS}`}
                >
                  <span className="sr-only">{t('nav.userMenu')}</span>
                  <div className="relative">
                    {renderCategoryIndicator()}
                    <UserAvatar user={user} />
                    {isAdminRole && pendingCount > 0 && (
                      <>
                        <span
                          aria-hidden="true"
                          className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[11px] leading-none rounded-full h-5 min-w-[1.25rem] px-1 flex items-center justify-center font-bold shadow-lg"
                        >
                          {pendingCount > 99 ? '99+' : pendingCount}
                        </span>
                        {overdueRefunds > 0 && (
                          <span
                            aria-hidden="true"
                            className="absolute -top-1.5 -left-1.5 bg-amber-400 text-red-900 text-[11px] leading-none rounded-full h-5 w-5 flex items-center justify-center font-black shadow-lg ring-2 ring-white"
                          >
                            !
                          </span>
                        )}
                        <span className="sr-only">{t('adminInbox.badgeAria', { count: pendingCount })}</span>
                        {overdueRefunds > 0 && (
                          <span className="sr-only">{t('adminRefunds.badge.overdueSr', { count: overdueRefunds })}</span>
                        )}
                      </>
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
                        id={userMenuId}
                        role="menu"
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-2 w-48 bg-[color:var(--hdr-menu-bg)] text-[color:var(--hdr-menu-text)] rounded-xl shadow-xl border border-[color:var(--brand-border)] py-2 z-50"
                      >
                        {/* User Panel */}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onNavigate('user-panel');
                            setIsUserMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${MENU_IDLE} ${ICON_FOCUS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset`}
                        >
                          <UserIcon className="w-4 h-4" />
                          {language === 'es' ? 'Panel de Usuario' : 'User Panel'}
                        </button>

                        <div className="border-t border-[color:var(--brand-border)] my-1" />

                        {/* Logout */}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            handleLogout();
                            setIsUserMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors ${ICON_FOCUS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset`}
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
              <Button variant="ghost" size="icon" onClick={handleLogin} className={`h-8 w-8 sm:h-9 sm:w-9 ${ICON_FOCUS}`} title={t('auth.login')} data-testid="login-button">
                <UserIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className={`md:hidden h-8 w-8 sm:h-9 sm:w-9 ${ICON_FOCUS}`}
              aria-label={isMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Quick Navigation Pills for Regular Users - UX optimized for elderly users */}
        {showQuickNav && (
          <motion.div
            data-testid="quick-nav"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-t border-[color:var(--hdr-pills-divider)] py-2 px-1"
          >
            <div className="flex items-center justify-center gap-2">
              {quickNavItems.map((item) => {
                const isActive = currentPage === item.id;
                return (
                  <motion.button
                    key={item.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleNavClick(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex flex-1 min-w-0 min-[360px]:flex-none min-[360px]:min-w-[85px] items-center justify-center gap-1 min-[360px]:gap-1.5 px-2 min-[360px]:px-3 py-2 rounded-full text-xs min-[360px]:text-sm font-medium transition-colors duration-200 shadow-sm border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus motion-reduce:transition-none ${
                      isActive
                        ? `border-transparent ${NAV_ACTIVE}`
                        : `border-[1.5px] ${PILL_IDLE}`
                    }`}
                  >
                    {/* below 360 px the icon yields its width to the label ("Remittances" does not fit next to it at 320) */}
                    <item.icon className="w-4 h-4 max-[359px]:hidden" />
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
              className="md:hidden border-t border-[color:var(--hdr-menu-divider)] py-4"
            >
              <div className="flex flex-col space-y-2">
                {/* Public items */}
                {publicMenuItems.map((item) => (
                  <NavButton
                    key={item.id}
                    active={currentPage === item.id}
                    icon={item.icon}
                    label={item.label}
                    className="justify-start"
                    onClick={() => handleNavClick(item.id)}
                  />
                ))}

                {/* Admin section */}
                {isAdmin && (
                  <>
                    <div className="pt-2 pb-1 px-2 text-xs font-semibold uppercase opacity-70 text-[color:var(--hdr-text)]">
                      {t('nav.adminMenu')}
                    </div>
                    {adminMenuItems.map((item) => (
                      <NavButton
                        key={item.id}
                        active={currentPage === item.id}
                        icon={item.icon}
                        label={item.label}
                        className="justify-start"
                        onClick={() => handleNavClick(item.id)}
                      />
                    ))}
                  </>
                )}
                <Button
                  variant="brand-outline"
                  size="sm"
                  onClick={toggleLanguage}
                  className="flex items-center space-x-2 justify-start"
                >
                  <Globe className="w-4 h-4" />
                  <span>{language.toUpperCase()}</span>
                </Button>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
      <RoleUnresolvedBanner />
    </motion.header>
  );
};

export default Header;
