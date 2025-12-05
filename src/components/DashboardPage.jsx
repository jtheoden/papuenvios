import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, DollarSign, Package, Users, AlertTriangle, Eye, Users2, RefreshCw, FileText, List, Send, Settings, Clock, CheckCircle, Ticket, CreditCard } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { getHeadingStyle } from '@/lib/styleUtils';
import TabsResponsive from './TabsResponsive';
import AdminOrdersTab from './AdminOrdersTab';
import AdminRemittancesTab from './AdminRemittancesTab';
import AdminOffersTab from './AdminOffersTab';
import RemittanceTypesConfig from './RemittanceTypesConfig';
import ZellePaymentHistoryTab from './admin/ZellePaymentHistoryTab';

const DashboardPage = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { products, combos, financialSettings, visualSettings } = useBusiness();
  const { user, isAdmin, isSuperAdmin } = useAuth();

  // Tab state
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' or 'orders'

  const [stats, setStats] = useState({
    totalProducts: 0,
    totalCombos: 0,
    totalUsers: 0,
    pendingOrders: 0,
    completedOrders: 0,
    dailyRevenue: 0,
    monthlyRevenue: 0,
    // Remittance metrics
    totalRemittances: 0,
    pendingRemittances: 0,
    completedRemittances: 0,
    dailyRemittanceIncome: 0,
    monthlyRemittanceIncome: 0,
    loading: true
  });

  const [visitStats, setVisitStats] = useState({
    weekly: 0,
    monthly: 0,
    yearly: 0,
    total: 0,
    loading: true
  });

  const [currencies, setCurrencies] = useState([]);
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [exchangeRate, setExchangeRate] = useState(1);

  const isProductNearExpiration = (product) => {
    if (!product.expiryDate) return false;
    const today = new Date();
    const expiry = new Date(product.expiryDate);
    const diffTime = expiry - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 30 && diffDays > 0;
  };

  const expiringProducts = products.filter(isProductNearExpiration);

  // Load currencies
  useEffect(() => {
    const loadCurrencies = async () => {
      const { data } = await supabase
        .from('currencies')
        .select('*')
        .eq('is_active', true)
        .order('code', { ascending: true });

      if (data) {
        setCurrencies(data);
        const baseCurrency = data.find(c => c.is_base);
        if (baseCurrency) {
          setSelectedCurrency(baseCurrency.id);
          setExchangeRate(1);
        }
      }
    };

    loadCurrencies();
  }, []);

  // Update exchange rate when currency changes
  useEffect(() => {
    if (selectedCurrency && currencies.length > 0) {
      const currency = currencies.find(c => c.id === selectedCurrency);
      if (currency) {
        setExchangeRate(currency.exchange_rate || 1);
      }
    }
  }, [selectedCurrency, currencies]);

  // Fetch visit statistics
  const fetchVisitStats = async () => {
    try {
      setVisitStats(prev => ({ ...prev, loading: true }));

      const { data: visitsData, error } = await supabase
        .from('site_visits')
        .select('visit_time');

      // Handle RLS policy errors gracefully
      if (error) {
        console.warn('Visit tracking not configured:', error.message);
        // Set default/mock values when table is not accessible
        setVisitStats({
          weekly: 0,
          monthly: 0,
          yearly: 0,
          total: 0,
          loading: false,
          unavailable: true
        });
        return;
      }

      if (visitsData) {
        const now = new Date();
        const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const oneYearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000);

        const weekly = visitsData.filter(v => new Date(v.visit_time) >= oneWeekAgo).length;
        const monthly = visitsData.filter(v => new Date(v.visit_time) >= oneMonthAgo).length;
        const yearly = visitsData.filter(v => new Date(v.visit_time) >= oneYearAgo).length;
        const total = visitsData.length;

        setVisitStats({ weekly, monthly, yearly, total, loading: false, unavailable: false });
      }
    } catch (error) {
      console.error('Error fetching visit stats:', error);
      setVisitStats({
        weekly: 0,
        monthly: 0,
        yearly: 0,
        total: 0,
        loading: false,
        unavailable: true
      });
    }
  };

  // Fetch real stats from Supabase
  const fetchStats = async () => {
    try {
      setStats(prev => ({ ...prev, loading: true }));

      // Get counts
      const [productsRes, combosRes, usersRes, ordersRes, remittancesRes] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('combo_products').select('id', { count: 'exact', head: true }),
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
        supabase.from('orders').select('id, status, payment_status, total_amount, created_at'),
        supabase.from('remittances').select('id, status, commission_total, created_at')
      ]);

      const totalProducts = productsRes.count || 0;
      const totalCombos = combosRes.count || 0;
      const totalUsers = usersRes.count || 0;

      // Calculate order stats by status
      const orders = ordersRes.data || [];

      // Calculate remittance stats by status
      const remittances = remittancesRes.data || [];
      const paymentPending = orders.filter(o => o.payment_status === 'pending').length;
      const paymentValidated = orders.filter(o => o.payment_status === 'validated' && o.status === 'pending').length;
      const processing = orders.filter(o => o.status === 'processing').length;
      const shipped = orders.filter(o => o.status === 'shipped').length;
      const delivered = orders.filter(o => o.status === 'delivered').length;
      const completedOrders = orders.filter(o => o.status === 'completed').length;
      const cancelled = orders.filter(o => o.status === 'cancelled').length;
      const totalActive = paymentPending + paymentValidated + processing + shipped + delivered;

      // Legacy field for compatibility
      const pendingOrders = paymentPending + paymentValidated;

      // Calculate revenue (last 24 hours and last 30 days)
      const now = new Date();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

      const dailyRevenue = orders
        .filter(o => new Date(o.created_at) >= oneDayAgo && ['delivered', 'completed', 'processing'].includes(o.status))
        .reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);

      const monthlyRevenue = orders
        .filter(o => new Date(o.created_at) >= oneMonthAgo && ['delivered', 'completed', 'processing'].includes(o.status))
        .reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);

      // Calculate remittance stats
      const totalRemittances = remittances.length;
      const pendingRemittances = remittances.filter(r =>
        ['payment_pending', 'payment_proof_uploaded', 'payment_rejected'].includes(r.status)
      ).length;
      const completedRemittances = remittances.filter(r => r.status === 'completed').length;

      // Calculate remittance income (commission earned)
      const dailyRemittanceIncome = remittances
        .filter(r => new Date(r.created_at) >= oneDayAgo && r.status === 'completed')
        .reduce((sum, r) => sum + (parseFloat(r.commission_total) || 0), 0);

      const monthlyRemittanceIncome = remittances
        .filter(r => new Date(r.created_at) >= oneMonthAgo && r.status === 'completed')
        .reduce((sum, r) => sum + (parseFloat(r.commission_total) || 0), 0);

      setStats({
        totalProducts,
        totalCombos,
        totalUsers,
        pendingOrders,
        completedOrders,
        paymentPending,
        paymentValidated,
        processing,
        shipped,
        delivered,
        cancelled,
        totalActive,
        dailyRevenue,
        monthlyRevenue,
        // Remittance metrics
        totalRemittances,
        pendingRemittances,
        completedRemittances,
        dailyRemittanceIncome,
        monthlyRemittanceIncome,
        loading: false
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      setStats(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    if (user && (isAdmin || isSuperAdmin)) {
      fetchStats();
      fetchVisitStats();

      // Update stats every 30 seconds for real-time dashboard
      const statsInterval = setInterval(() => {
        fetchStats();
      }, 30000);

      return () => clearInterval(statsInterval);
    }
  }, [user, isAdmin, isSuperAdmin]);

  // Calculate profits and apply exchange rate
  const dailyProfit = stats.dailyRevenue * (financialSettings.productProfit / 100);
  const monthlyProfit = stats.monthlyRevenue * (financialSettings.productProfit / 100);

  // Calculate remittance profits
  const dailyRemittanceProfit = stats.dailyRemittanceIncome * (financialSettings.remittanceProfit / 100);
  const monthlyRemittanceProfit = stats.monthlyRemittanceIncome * (financialSettings.remittanceProfit / 100);

  // Get current currency symbol and code
  const currentCurrency = currencies.find(c => c.id === selectedCurrency);
  const currencySymbol = currentCurrency?.symbol || '$';
  const currencyCode = currentCurrency?.code || 'USD';

  // Format currency values
  const formatCurrency = (value) => {
    const converted = value * exchangeRate;
    return converted.toFixed(2);
  };

  if (!user || (!isAdmin && !isSuperAdmin)) {
    return (
      <div className="min-h-screen flex items-center justify-center py-8 px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-effect p-8 rounded-2xl max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-gradient-to-r from-red-500 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users2 className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2" style={getHeadingStyle(visualSettings)}>
            {t('dashboard.privateAccess')}
          </h2>
          <p className="text-gray-600">{t('dashboard.adminOnly')}</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-between items-start mb-8"
        >
          <div>
            <h1 className="text-4xl font-bold mb-2" style={getHeadingStyle(visualSettings)}>
              {t('dashboard.title')}
            </h1>
            <p className="text-xl text-gray-600">
              {t('dashboard.subtitle')}
            </p>
          </div>
          {activeTab === 'overview' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  {t('dashboard.selectCurrency')}:
                </label>
                <select
                  value={selectedCurrency || ''}
                  onChange={(e) => setSelectedCurrency(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {currencies.map(currency => (
                    <option key={currency.id} value={currency.id}>
                      {currency.code} ({currency.symbol})
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => {
                  fetchStats();
                  fetchVisitStats();
                }}
                disabled={stats.loading}
                className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl shadow hover:shadow-md transition-shadow"
              >
                <RefreshCw className={`w-4 h-4 ${stats.loading ? 'animate-spin' : ''}`} />
                <span className="text-sm font-medium">{t('dashboard.refresh')}</span>
              </button>
            </div>
          )}
        </motion.div>

        {/* Tabs */}
        <TabsResponsive
          tabs={[
            {
              id: 'overview',
              label: 'dashboard.overviewTab',
              icon: <BarChart3 className="h-5 w-5" />,
              content: (
                <>
                  {expiringProducts.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded-lg mb-8"
                      role="alert"
                    >
                      <div className="flex">
                        <div className="py-1"><AlertTriangle className="h-6 w-6 text-yellow-500 mr-4" /></div>
                        <div>
                          <p className="font-bold">{t('dashboard.expirationWarning.title')}</p>
                          <p className="text-sm">{t('dashboard.expirationWarning.description', { count: expiringProducts.length })}</p>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {isSuperAdmin && (
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                    {[
                      { title: t('dashboard.stats.dailyRevenue'), value: stats.dailyRevenue, icon: DollarSign, color: 'from-green-500 to-emerald-600' },
                      { title: t('dashboard.stats.monthlyRevenue'), value: stats.monthlyRevenue, icon: TrendingUp, color: 'from-blue-500 to-cyan-600' },
                      { title: t('dashboard.stats.dailyProfit'), value: dailyProfit, icon: BarChart3, color: 'from-purple-500 to-pink-600' },
                      { title: t('dashboard.stats.monthlyProfit'), value: monthlyProfit, icon: TrendingUp, color: 'from-orange-500 to-red-600' }
                    ].map((stat, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="glass-effect p-6 rounded-2xl hover-lift"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className={`w-12 h-12 bg-gradient-to-r ${stat.color} rounded-xl flex items-center justify-center`}>
                            <stat.icon className="w-6 h-6 text-white" />
                          </div>
                        </div>
                        <h3 className="text-2xl font-bold mb-1">
                          {currencySymbol}{formatCurrency(stat.value)} {currencyCode}
                        </h3>
                        <p className="text-gray-600 text-sm">{stat.title}</p>
                      </motion.div>
                    ))}
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                    {[
                      { title: t('dashboard.stats.totalProducts'), value: stats.totalProducts, icon: Package },
                      { title: t('dashboard.stats.totalCombos'), value: stats.totalCombos, icon: Users },
                      { title: t('dashboard.stats.pendingOrders'), value: stats.pendingOrders, icon: BarChart3 },
                      { title: t('dashboard.stats.totalUsers'), value: stats.totalUsers, icon: Eye }
                    ].map((stat, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 + index * 0.1 }}
                        className="glass-effect p-6 rounded-2xl hover-lift"
                      >
                        <div className="flex items-center mb-4">
                          <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center mr-3">
                            <stat.icon className="w-5 h-5 text-gray-600" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold">{stat.value}</h3>
                            <p className="text-gray-600 text-sm">{stat.title}</p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  <div className={`grid md:grid-cols-${isSuperAdmin? '2': '1'} gap-8`}>
                    { isSuperAdmin && (
                        <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.8 }}
                      className="glass-effect p-8 rounded-2xl"
                    >
                      <h3 className="text-2xl font-semibold mb-6">{t('dashboard.profitBreakdown')}</h3>
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-lg font-semibold mb-2">{t('dashboard.dailyBreakdown')}</h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span>{t('dashboard.grossRevenue')}:</span>
                              <span className="font-semibold">{currencySymbol}{formatCurrency(stats.dailyRevenue)} {currencyCode}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>{t('dashboard.costs')}:</span>
                              <span className="font-semibold text-red-600">-{currencySymbol}{formatCurrency(stats.dailyRevenue - dailyProfit)} {currencyCode}</span>
                            </div>
                            <div className="flex justify-between border-t pt-2 mt-1">
                              <span>{t('dashboard.netProfit')}:</span>
                              <span className="font-bold text-green-600">{currencySymbol}{formatCurrency(dailyProfit)} {currencyCode}</span>
                            </div>
                            <div className="flex justify-between text-xs text-gray-500">
                              <span>{t('dashboard.profitMargin')}:</span>
                              <span>{financialSettings.productProfit}%</span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-lg font-semibold mb-2">{t('dashboard.monthlyBreakdown')}</h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span>{t('dashboard.grossRevenue')}:</span>
                              <span className="font-semibold">{currencySymbol}{formatCurrency(stats.monthlyRevenue)} {currencyCode}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>{t('dashboard.costs')}:</span>
                              <span className="font-semibold text-red-600">-{currencySymbol}{formatCurrency(stats.monthlyRevenue - monthlyProfit)} {currencyCode}</span>
                            </div>
                            <div className="flex justify-between border-t pt-2 mt-1">
                              <span>{t('dashboard.netProfit')}:</span>
                              <span className="font-bold text-green-600">{currencySymbol}{formatCurrency(monthlyProfit)} {currencyCode}</span>
                            </div>
                            <div className="flex justify-between text-xs text-gray-500">
                              <span>{t('dashboard.profitMargin')}:</span>
                              <span>{financialSettings.productProfit}%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                        </motion.div>
                      )
                    }
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.9 }}
                      className="glass-effect p-8 rounded-2xl"
                    >
                      <h3 className="text-2xl font-semibold mb-6">📦 {t('dashboard.orderSummary')}</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center bg-yellow-50 p-3 rounded-lg border-l-4 border-yellow-500">
                          <span className="font-semibold">🟡 {t('dashboard.orderStatus.paymentPending')}</span>
                          <span className="text-lg font-bold text-yellow-600">{stats.paymentPending || 0}</span>
                        </div>
                        <div className="flex justify-between items-center bg-green-50 p-3 rounded-lg border-l-4 border-green-500">
                          <span className="font-semibold">✅ {t('dashboard.orderStatus.paymentValidated')}</span>
                          <span className="text-lg font-bold text-green-600">{stats.paymentValidated || 0}</span>
                        </div>
                        <div className="flex justify-between items-center bg-blue-50 p-3 rounded-lg border-l-4 border-blue-500">
                          <span className="font-semibold">🔵 {t('dashboard.orderStatus.processing')}</span>
                          <span className="text-lg font-bold text-blue-600">{stats.processing || 0}</span>
                        </div>
                        <div className="flex justify-between items-center bg-purple-50 p-3 rounded-lg border-l-4 border-purple-500">
                          <span className="font-semibold">🟣 {t('dashboard.orderStatus.shipped')}</span>
                          <span className="text-lg font-bold text-purple-600">{stats.shipped || 0}</span>
                        </div>
                        <div className="flex justify-between items-center bg-teal-50 p-3 rounded-lg border-l-4 border-teal-500">
                          <span className="font-semibold">🟢 {t('dashboard.orderStatus.delivered')}</span>
                          <span className="text-lg font-bold text-teal-600">{stats.delivered || 0}</span>
                        </div>
                        <div className="flex justify-between items-center bg-green-100 p-3 rounded-lg border-l-4 border-green-600">
                          <span className="font-semibold">✅ {t('dashboard.completed')}</span>
                          <span className="text-lg font-bold text-green-700">{stats.completedOrders || 0}</span>
                        </div>
                        <div className="flex justify-between items-center bg-red-50 p-3 rounded-lg border-l-4 border-red-500">
                          <span className="font-semibold">❌ {t('dashboard.orderStatus.cancelled')}</span>
                          <span className="text-lg font-bold text-red-600">{stats.cancelled || 0}</span>
                        </div>
                        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border-t-2 border-gray-300 mt-2">
                          <span className="font-bold">📊 {t('dashboard.orderStatus.totalActive')}</span>
                          <span className="text-xl font-bold text-gray-800">{stats.totalActive || 0}</span>
                        </div>
                      </div>
                    </motion.div>
                  </div>

                  { isSuperAdmin && (
                    <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.0 }}
                    className="mb-12 mt-12"
                  >
                    <h2 className="text-2xl font-bold mb-6" style={getHeadingStyle(visualSettings)}>
                      {t('dashboard.remittancesBreakdown')} 💰
                    </h2>

                    <div className="grid md:grid-cols-2 gap-8">
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 1.1 }}
                        className="glass-effect p-8 rounded-2xl"
                      >
                        <h3 className="text-2xl font-semibold mb-6">{t('dashboard.dailyBreakdown')}</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span>{t('dashboard.grossRevenue')} (Remesas):</span>
                            <span className="font-semibold">{currencySymbol}{formatCurrency(stats.dailyRemittanceIncome)} {currencyCode}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>{t('dashboard.costs')}:</span>
                            <span className="font-semibold text-red-600">-{currencySymbol}{formatCurrency(stats.dailyRemittanceIncome - dailyRemittanceProfit)} {currencyCode}</span>
                          </div>
                          <div className="flex justify-between border-t pt-2 mt-1">
                            <span>{t('dashboard.netProfit')}:</span>
                            <span className="font-bold text-green-600">{currencySymbol}{formatCurrency(dailyRemittanceProfit)} {currencyCode}</span>
                          </div>
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>{t('dashboard.profitMargin')}:</span>
                            <span>{financialSettings.remittanceProfit || 0}%</span>
                          </div>
                        </div>
                      </motion.div>

                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 1.2 }}
                        className="glass-effect p-8 rounded-2xl"
                      >
                        <h3 className="text-2xl font-semibold mb-6">{t('dashboard.monthlyBreakdown')}</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span>{t('dashboard.grossRevenue')} (Remesas):</span>
                            <span className="font-semibold">{currencySymbol}{formatCurrency(stats.monthlyRemittanceIncome)} {currencyCode}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>{t('dashboard.costs')}:</span>
                            <span className="font-semibold text-red-600">-{currencySymbol}{formatCurrency(stats.monthlyRemittanceIncome - monthlyRemittanceProfit)} {currencyCode}</span>
                          </div>
                          <div className="flex justify-between border-t pt-2 mt-1">
                            <span>{t('dashboard.netProfit')}:</span>
                            <span className="font-bold text-green-600">{currencySymbol}{formatCurrency(monthlyRemittanceProfit)} {currencyCode}</span>
                          </div>
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>{t('dashboard.profitMargin')}:</span>
                            <span>{financialSettings.remittanceProfit || 0}%</span>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                    </motion.div>
                  )}
<br/>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="mb-12"
                  >
                    <h2 className="text-2xl font-bold mb-6" >
                     📤 <span style={getHeadingStyle(visualSettings)}>{t('dashboard.remittancesMetrics')} </span>
                    </h2>

                    <div className={`grid md:grid-cols-2 lg:grid-cols-${isSuperAdmin?'5':'3'} gap-6`}>
                      {[
                        {
                          title: t('dashboard.stats.totalRemittances'),
                          value: stats.totalRemittances,
                          icon: Send,
                          color: 'from-indigo-500 to-blue-600',
                          type: 'count',
                          public: true
                        },
                        {
                          title: t('dashboard.stats.pendingRemittances'),
                          value: stats.pendingRemittances,
                          icon: Clock,
                          color: 'from-yellow-500 to-orange-600',
                          type: 'count',
                          public: true
                        },
                        {
                          title: t('dashboard.stats.completedRemittances'),
                          value: stats.completedRemittances,
                          icon: CheckCircle,
                          color: 'from-green-500 to-emerald-600',
                          type: 'count',
                          public: true
                        },
                        {
                          title: t('dashboard.stats.dailyRemittanceIncome'),
                          value: stats.dailyRemittanceIncome,
                          icon: DollarSign,
                          color: 'from-purple-500 to-pink-600',
                          type: 'currency',
                          public: false
                        },
                        {
                          title: t('dashboard.stats.monthlyRemittanceIncome'),
                          value: stats.monthlyRemittanceIncome,
                          icon: TrendingUp,
                          color: 'from-orange-500 to-red-600',
                          type: 'currency',
                          public: false
                        }
                      ].filter(stat => isSuperAdmin || stat.public)
                      .map((stat, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, y: 30 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.5 + index * 0.1 }}
                          className="glass-effect p-6 rounded-2xl hover-lift"
                        >
                          <div className="flex items-center justify-between mb-4">
                            <div className={`w-12 h-12 bg-gradient-to-r ${stat.color} rounded-xl flex items-center justify-center`}>
                              <stat.icon className="w-6 h-6 text-white" />
                            </div>
                          </div>
                          <h3 className="text-2xl font-bold mb-1">
                            {stat.type === 'currency'
                              ? `${currencySymbol}${formatCurrency(stat.value)} ${currencyCode}`
                              : stat.value
                            }
                          </h3>
                          <p className="text-gray-600 text-sm">{stat.title}</p>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.0 }}
                    className="mt-8"
                  >
                    <h2 className="text-3xl font-bold mb-6" style={getHeadingStyle(visualSettings)}>{t('dashboard.analyticsTitle')}</h2>

                    <div className="grid md:grid-cols-2 gap-8">
                      <div className="glass-effect p-8 rounded-2xl">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-2xl font-semibold">{t('dashboard.visits.title')}</h3>
                          <Eye className="w-8 h-8 text-blue-500" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-blue-50 p-4 rounded-xl">
                            <p className="text-sm text-gray-600 mb-1">{t('dashboard.visits.thisWeek')}</p>
                            <p className="text-2xl font-bold text-blue-600">{visitStats.weekly}</p>
                          </div>
                          <div className="bg-purple-50 p-4 rounded-xl">
                            <p className="text-sm text-gray-600 mb-1">{t('dashboard.visits.thisMonth')}</p>
                            <p className="text-2xl font-bold text-purple-600">{visitStats.monthly}</p>
                          </div>
                          <div className="bg-orange-50 p-4 rounded-xl">
                            <p className="text-sm text-gray-600 mb-1">{t('dashboard.visits.thisYear')}</p>
                            <p className="text-2xl font-bold text-orange-600">{visitStats.yearly}</p>
                          </div>
                          <div className="bg-green-50 p-4 rounded-xl border-2 border-green-500">
                            <p className="text-sm text-gray-600 mb-1">{t('dashboard.visits.allTime')}</p>
                            <p className="text-2xl font-bold text-green-600">{visitStats.total}</p>
                          </div>
                        </div>
                      </div>

                      <div className="glass-effect p-8 rounded-2xl">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-2xl font-semibold">{t('dashboard.stats.siteVisits')}</h3>
                          <TrendingUp className="w-8 h-8 text-green-500" />
                        </div>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center p-3 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg">
                            <div>
                              <p className="text-sm text-gray-600">{t('dashboard.visits.weekly')}</p>
                              <p className="text-xs text-gray-500">{t('dashboard.visits.thisWeek')}</p>
                            </div>
                            <p className="text-xl font-bold text-blue-600">{visitStats.weekly}</p>
                          </div>
                          <div className="flex justify-between items-center p-3 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg">
                            <div>
                              <p className="text-sm text-gray-600">{t('dashboard.visits.monthly')}</p>
                              <p className="text-xs text-gray-500">{t('dashboard.visits.thisMonth')}</p>
                            </div>
                            <p className="text-xl font-bold text-purple-600">{visitStats.monthly}</p>
                          </div>
                          <div className="flex justify-between items-center p-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border-2 border-green-500">
                            <div>
                              <p className="text-sm text-gray-600">{t('dashboard.visits.total')}</p>
                              <p className="text-xs text-gray-500">{t('dashboard.visits.allTime')}</p>
                            </div>
                            <p className="text-xl font-bold text-green-600">{visitStats.total}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </>
              )
            },
            {
              id: 'orders',
              label: 'dashboard.ordersTab',
              icon: <FileText className="h-5 w-5" />,
              content: (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <AdminOrdersTab />
                </motion.div>
              )
            },
            {
              id: 'remittances',
              label: 'dashboard.remittancesTab',
              icon: <Send className="h-5 w-5" />,
              content: (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <AdminRemittancesTab />
                </motion.div>
              )
            },
            {
              id: 'offers',
              label: 'dashboard.offersTab',
              icon: <Ticket className="h-5 w-5" />,
              content: (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <AdminOffersTab />
                </motion.div>
              )
            },
            {
              id: 'remittance-types',
              label: 'dashboard.remittancesKindTab',
              icon: <Settings className="h-5 w-5" />,
              content: (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <RemittanceTypesConfig />
                </motion.div>
              )
            },
            {
              id: 'zelle-history',
              label: 'dashboard.zelleHistoryTab',
              icon: <CreditCard className="h-5 w-5" />,
              content: (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <ZellePaymentHistoryTab />
                </motion.div>
              )
            }
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
    </div>
  );
};

export default DashboardPage;