import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, DollarSign, Package, Users, AlertTriangle, Eye, Users2, RefreshCw, FileText, List, Send, Settings, Clock, CheckCircle, Ticket, CreditCard, ShieldCheck, Truck, Tag, Calendar } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { listProductCosts, listComboCosts } from '@/lib/adminCostService';
import { listOrderCourierCosts } from '@/lib/courierCostService';
import { classifyAdminCatalogError } from '@/lib/catalogErrors';
import CatalogLoadError from './CatalogLoadError';
import { getHeadingStyle } from '@/lib/styleUtils';
import {
  ACTIVE_ORDER_STATUSES,
  buildMarginLookup,
  computeCombinedRevenue,
  computeCourierCostTotals,
  computeOrderCounters,
  computeOrderProfitTotals,
  computeOrderTotals,
  groupItemsByOrder
} from '@/lib/dashboardMetrics';
import { useRealtimeOrders, useRealtimeRemittances, useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import TabsResponsive from './TabsResponsive';
import AdminOrdersTab from './AdminOrdersTab';
import AdminRemittancesTab from './AdminRemittancesTab';
import AdminOffersTab from './AdminOffersTab';
import RemittanceTypesConfig from './RemittanceTypesConfig';
import ZellePaymentHistoryTab from './admin/ZellePaymentHistoryTab';
import ActivityLogTab from './ActivityLogTab';

// Cost reads settle to { data, error } so one missing RPC does not blank the whole dashboard.
const settleCosts = (promise) =>
  promise
    .then((costs) => ({ data: [...costs.values()], error: null }))
    .catch((error) => ({ data: null, error }));

const DashboardPage = ({ onNavigate }) => {
  const { t, language } = useLanguage();
  const { products, combos, financialSettings, visualSettings } = useBusiness();
  const { user, isAdmin, isSuperAdmin } = useAuth();

  // Tab state
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' or 'orders'

  // Handle URL parameters for tab navigation (deep linking from WhatsApp notifications)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');

    const validTabs = ['overview', 'orders', 'remittances', 'remittance-types', 'offers', 'activity-log', 'zelle-history'];

    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, []);

  const [stats, setStats] = useState({
    totalProducts: 0,
    totalCombos: 0,
    totalUsers: 0,
    pendingOrders: 0,
    proofToReview: 0,
    completedOrders: 0,
    dailyRevenue: 0,
    monthlyRevenue: 0,
    // Remittance metrics
    totalRemittances: 0,
    pendingRemittances: 0,
    completedRemittances: 0,
    totalRemittanceTypes: 0,
    dailyRemittanceIncome: 0,
    monthlyRemittanceIncome: 0,
    dailyRemittanceVolume: 0,
    monthlyRemittanceVolume: 0,
    // Yearly metrics
    yearlyRevenue: 0,
    yearlyRemittanceIncome: 0,
    yearlyRemittanceVolume: 0,
    // Shipping costs
    dailyShippingCost: 0,
    monthlyShippingCost: 0,
    yearlyShippingCost: 0,
    // Zelle totals
    dailyZelleTotal: 0,
    monthlyZelleTotal: 0,
    yearlyZelleTotal: 0,
    // Discount totals
    dailyDiscounts: 0,
    monthlyDiscounts: 0,
    yearlyDiscounts: 0,
    // Payment method breakdown
    paymentMethodBreakdown: {},
    loading: true
  });

  // Inputs for the estimated order profit (orders + order lines + per-item margins)
  const [profitSource, setProfitSource] = useState(null);
  // Item margins come from the admin cost RPCs; a failure is shown, never swallowed into default margins
  const [marginsError, setMarginsError] = useState(null);
  // Courier cost snapshot per order (admin-only table). A failed read is shown as unavailable, never as zeros.
  const [courier, setCourier] = useState({ status: 'loading', totals: null });

  const [visitStats, setVisitStats] = useState({
    weekly: 0,
    monthly: 0,
    yearly: 0,
    total: 0,
    loading: true
  });

  // Dashboard figures are always computed in the base currency; no conversion is offered
  const [baseCurrency, setBaseCurrency] = useState(null);

  const isProductNearExpiration = (product) => {
    if (!product.expiryDate) return false;
    const today = new Date();
    const expiry = new Date(product.expiryDate);
    const diffTime = expiry - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 30 && diffDays > 0;
  };

  const expiringProducts = products.filter(isProductNearExpiration);

  // Load the base currency (label for the figures)
  useEffect(() => {
    const loadBaseCurrency = async () => {
      const { data } = await supabase
        .from('currencies')
        .select('id, code, symbol, is_base')
        .eq('is_active', true)
        .order('code', { ascending: true });

      setBaseCurrency(data?.find(c => c.is_base) || null);
    };

    loadBaseCurrency();
  }, []);

  // Fetch visit statistics
  const fetchVisitStats = useCallback(async () => {

    try {
      setVisitStats(prev => ({ ...prev, loading: true }));

      const { data: visitsData, error } = await supabase
        .from('site_visits')
        .select('visit_time');

      // Handle RLS policy errors gracefully
      if (error) {
        console.warn('[fetchVisitStats] Visit tracking not configured:', error.message);
        console.warn('[fetchVisitStats] Error code:', error?.code);
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
      } else {
      }
    } catch (error) {
      console.error('[fetchVisitStats] ERROR:', error);
      console.error('[fetchVisitStats] Error details:', {
        message: error?.message,
        code: error?.code,
        stack: error?.stack
      });
      setVisitStats({
        weekly: 0,
        monthly: 0,
        yearly: 0,
        total: 0,
        loading: false,
        unavailable: true
      });
    }
  }, []);

  // Fetch real stats from Supabase
  const fetchStats = useCallback(async () => {

    try {
      setStats(prev => ({ ...prev, loading: true }));

      // Get counts
      const [productsRes, combosRes, usersRes, ordersRes, remittancesRes, remittanceTypesRes, zelleRes, productMarginsRes, comboMarginsRes] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('combo_products').select('id', { count: 'exact', head: true }),
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
        supabase.from('orders').select('id, status, payment_status, total_amount, shipping_cost, discount_amount, payment_method, created_at'),
        supabase.from('remittances').select('id, status, commission_total, amount_sent, amount_to_deliver, discount_amount, created_at, delivered_at, completed_at, updated_at'),
        supabase.from('remittance_types').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('zelle_transaction_history').select('id, amount, status, transaction_type, transaction_date, zelle_account_id').eq('status', 'validated'),
        settleCosts(listProductCosts()),
        settleCosts(listComboCosts())
      ]);

      if (productsRes.error) throw productsRes.error;
      if (combosRes.error) throw combosRes.error;
      if (usersRes.error) throw usersRes.error;
      if (ordersRes.error) throw ordersRes.error;
      if (remittancesRes.error) throw remittancesRes.error;
      if (remittanceTypesRes.error) throw remittanceTypesRes.error;
      const marginFailure = productMarginsRes.error || comboMarginsRes.error;
      setMarginsError(marginFailure ? { kind: classifyAdminCatalogError(marginFailure) } : null);
      // Zelle query is non-critical - graceful fallback
      const zelleTransactions = (!zelleRes.error && zelleRes.data) ? zelleRes.data : [];

      const totalProducts = productsRes.count || 0;
      const totalCombos = combosRes.count || 0;
      const totalUsers = usersRes.count || 0;
      const totalRemittanceTypes = remittanceTypesRes.count || 0;

      // Calculate order stats by status
      const orders = ordersRes.data || [];

      // Calculate remittance stats by status
      const remittances = remittancesRes.data || [];

      const {
        paymentPending,
        paymentValidated,
        proofToReview,
        processing,
        dispatched,
        delivered,
        completedOrders,
        cancelled,
        totalActive,
        pendingOrders
      } = computeOrderCounters(orders);

      // Revenue, shipping, discounts and payment breakdown (shared ACTIVE_ORDER_STATUSES)
      const now = new Date();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const oneYearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000);

      const {
        dailyRevenue,
        monthlyRevenue,
        yearlyRevenue,
        dailyShippingCost,
        monthlyShippingCost,
        yearlyShippingCost,
        dailyDiscounts: dailyOrderDiscounts,
        monthlyDiscounts: monthlyOrderDiscounts,
        yearlyDiscounts: yearlyOrderDiscounts,
        paymentMethodBreakdown
      } = computeOrderTotals(orders, now);

      try {
        const costByOrder = await listOrderCourierCosts();
        setCourier({ status: 'ok', totals: computeCourierCostTotals(orders, costByOrder, now) });
      } catch {
        setCourier({ status: 'error', totals: null });
      }

      // Estimated order profit (per-product margin). Lines are fetched in pages
      // for active orders only (single embedded query, no N+1).
      const ITEMS_PAGE_SIZE = 1000;
      const orderItems = [];
      for (let from = 0; ; from += ITEMS_PAGE_SIZE) {
        const { data: page, error: itemsError } = await supabase
          .from('order_items')
          .select('order_id, item_type, item_id, total_price, orders!inner(status)')
          .in('orders.status', ACTIVE_ORDER_STATUSES)
          .order('id', { ascending: true })
          .range(from, from + ITEMS_PAGE_SIZE - 1);
        if (itemsError) throw itemsError;
        orderItems.push(...(page || []));
        if (!page || page.length < ITEMS_PAGE_SIZE) break;
      }
      // Profit is computed at render time so it follows the default margin setting
      setProfitSource({
        orders,
        itemsByOrder: groupItemsByOrder(orderItems),
        marginLookup: buildMarginLookup(productMarginsRes.data || [], comboMarginsRes.data || [])
      });

      // Zelle transaction totals
      const dailyZelleTotal = zelleTransactions
        .filter(tx => new Date(tx.transaction_date) >= oneDayAgo)
        .reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
      const monthlyZelleTotal = zelleTransactions
        .filter(tx => new Date(tx.transaction_date) >= oneMonthAgo)
        .reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
      const yearlyZelleTotal = zelleTransactions
        .filter(tx => new Date(tx.transaction_date) >= oneYearAgo)
        .reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

      // Calculate remittance stats
      const totalRemittances = remittances.length;
      const pendingRemittances = remittances.filter(r =>
        ['payment_pending', 'payment_proof_uploaded', 'payment_rejected', 'payment_validated', 'processing'].includes(r.status)
      ).length;
      const completedRemittances = remittances.filter(r => ['delivered', 'completed'].includes(r.status)).length;

      // Calculate remittance income (commission earned)
      const completedStatuses = ['delivered', 'completed'];

      const getRemittanceCompletionDate = (remittance) => {
        const timestamp = remittance.completed_at || remittance.delivered_at || remittance.updated_at || remittance.created_at;
        return timestamp ? new Date(timestamp) : null;
      };

      // Debug: Show all remittances with their commission_total and status

      // Filter remittances that match criteria for daily income
      const dailyCompletedRemittances = remittances.filter(r => {
        const completedAt = getRemittanceCompletionDate(r);
        const matches = completedAt && completedAt >= oneDayAgo && completedStatuses.includes(r.status);
        return matches;
      });

      const dailyRemittanceIncome = dailyCompletedRemittances
        .reduce((sum, r) => sum + (parseFloat(r.commission_total) || 0), 0);

      // Filter remittances that match criteria for monthly income
      const monthlyCompletedRemittances = remittances.filter(r => {
        const completedAt = getRemittanceCompletionDate(r);
        return completedAt && completedAt >= oneMonthAgo && completedStatuses.includes(r.status);
      });

      const monthlyRemittanceIncome = monthlyCompletedRemittances
        .reduce((sum, r) => sum + (parseFloat(r.commission_total) || 0), 0);

      const dailyRemittanceVolume = remittances
        .filter(r => {
          const completedAt = getRemittanceCompletionDate(r);
          return completedAt && completedAt >= oneDayAgo && completedStatuses.includes(r.status);
        })
        .reduce((sum, r) => sum + (parseFloat(r.amount_sent) || 0), 0);

      const monthlyRemittanceVolume = remittances
        .filter(r => {
          const completedAt = getRemittanceCompletionDate(r);
          return completedAt && completedAt >= oneMonthAgo && completedStatuses.includes(r.status);
        })
        .reduce((sum, r) => sum + (parseFloat(r.amount_sent) || 0), 0);

      // Yearly remittance metrics
      const yearlyRemittanceIncome = remittances
        .filter(r => {
          const completedAt = getRemittanceCompletionDate(r);
          return completedAt && completedAt >= oneYearAgo && completedStatuses.includes(r.status);
        })
        .reduce((sum, r) => sum + (parseFloat(r.commission_total) || 0), 0);

      const yearlyRemittanceVolume = remittances
        .filter(r => {
          const completedAt = getRemittanceCompletionDate(r);
          return completedAt && completedAt >= oneYearAgo && completedStatuses.includes(r.status);
        })
        .reduce((sum, r) => sum + (parseFloat(r.amount_sent) || 0), 0);

      // Remittance discounts
      const dailyRemittanceDiscounts = remittances
        .filter(r => {
          const completedAt = getRemittanceCompletionDate(r);
          return completedAt && completedAt >= oneDayAgo && completedStatuses.includes(r.status);
        })
        .reduce((sum, r) => sum + (parseFloat(r.discount_amount) || 0), 0);
      const monthlyRemittanceDiscounts = remittances
        .filter(r => {
          const completedAt = getRemittanceCompletionDate(r);
          return completedAt && completedAt >= oneMonthAgo && completedStatuses.includes(r.status);
        })
        .reduce((sum, r) => sum + (parseFloat(r.discount_amount) || 0), 0);
      const yearlyRemittanceDiscounts = remittances
        .filter(r => {
          const completedAt = getRemittanceCompletionDate(r);
          return completedAt && completedAt >= oneYearAgo && completedStatuses.includes(r.status);
        })
        .reduce((sum, r) => sum + (parseFloat(r.discount_amount) || 0), 0);

      // Combined discounts (orders + remittances)
      const dailyDiscounts = dailyOrderDiscounts + dailyRemittanceDiscounts;
      const monthlyDiscounts = monthlyOrderDiscounts + monthlyRemittanceDiscounts;
      const yearlyDiscounts = yearlyOrderDiscounts + yearlyRemittanceDiscounts;

      setStats({
        totalProducts,
        totalCombos,
        totalUsers,
        pendingOrders,
        proofToReview,
        completedOrders,
        paymentPending,
        paymentValidated,
        processing,
        dispatched,
        delivered,
        cancelled,
        totalActive,
        dailyRevenue,
        monthlyRevenue,
        yearlyRevenue,
        // Remittance metrics
        totalRemittances,
        pendingRemittances,
        completedRemittances,
        totalRemittanceTypes,
        dailyRemittanceIncome,
        monthlyRemittanceIncome,
        yearlyRemittanceIncome,
        dailyRemittanceVolume,
        monthlyRemittanceVolume,
        yearlyRemittanceVolume,
        // Shipping costs
        dailyShippingCost,
        monthlyShippingCost,
        yearlyShippingCost,
        // Zelle totals
        dailyZelleTotal,
        monthlyZelleTotal,
        yearlyZelleTotal,
        // Discount totals
        dailyDiscounts,
        monthlyDiscounts,
        yearlyDiscounts,
        // Payment method breakdown
        paymentMethodBreakdown,
        loading: false
      });

    } catch (error) {
      console.error('[fetchStats] ERROR:', error);
      console.error('[fetchStats] Error details:', {
        message: error?.message,
        code: error?.code,
        stack: error?.stack
      });
      setStats(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useRealtimeOrders({
    enabled: isAdmin || isSuperAdmin,
    onUpdate: fetchStats
  });

  useRealtimeRemittances({
    enabled: isAdmin || isSuperAdmin,
    onUpdate: fetchStats
  });

  useRealtimeSubscription({
    table: 'site_visits',
    event: '*',
    enabled: isAdmin || isSuperAdmin,
    onInsert: fetchVisitStats,
    onUpdate: fetchVisitStats,
    onDelete: fetchVisitStats
  });

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
  }, [user, isAdmin, isSuperAdmin, fetchStats, fetchVisitStats]);

  // Calculate profits and apply exchange rate
  // Order profit is an ESTIMATE: per-product margin, discount deducted, shipping excluded
  const orderProfit = useMemo(
    () => profitSource
      ? computeOrderProfitTotals(
          profitSource.orders,
          profitSource.itemsByOrder,
          profitSource.marginLookup,
          financialSettings.productProfit
        )
      : { dailyProfit: 0, monthlyProfit: 0, yearlyProfit: 0, fallbackLines: 0 },
    [profitSource, financialSettings.productProfit]
  );
  const { dailyProfit, monthlyProfit, yearlyProfit } = orderProfit;

  // Commission = Profit for remittances (no additional cost layer)
  const dailyRemittanceProfit = Number(stats.dailyRemittanceIncome || 0);
  const monthlyRemittanceProfit = Number(stats.monthlyRemittanceIncome || 0);
  const yearlyRemittanceProfit = Number(stats.yearlyRemittanceIncome || 0);
  const dailyRemittanceVolumeValue = Number(stats.dailyRemittanceVolume || 0);
  const monthlyRemittanceVolumeValue = Number(stats.monthlyRemittanceVolume || 0);
  const yearlyRemittanceVolumeValue = Number(stats.yearlyRemittanceVolume || 0);
  const dailyRemittancePayout = Math.max(0, dailyRemittanceVolumeValue - dailyRemittanceProfit);
  const monthlyRemittancePayout = Math.max(0, monthlyRemittanceVolumeValue - monthlyRemittanceProfit);
  const yearlyRemittancePayout = Math.max(0, yearlyRemittanceVolumeValue - yearlyRemittanceProfit);

  // Combined totals (Orders + Remittances)
  // Headline revenue = order revenue + remittance commission (volume sent is not income)
  const combinedDailyRevenue = computeCombinedRevenue(stats.dailyRevenue, dailyRemittanceProfit);
  const combinedMonthlyRevenue = computeCombinedRevenue(stats.monthlyRevenue, monthlyRemittanceProfit);
  const combinedYearlyRevenue = computeCombinedRevenue(stats.yearlyRevenue, yearlyRemittanceProfit);
  const combinedDailyProfit = Number(dailyProfit || 0) + dailyRemittanceProfit;
  const combinedMonthlyProfit = Number(monthlyProfit || 0) + monthlyRemittanceProfit;
  const combinedYearlyProfit = Number(yearlyProfit || 0) + yearlyRemittanceProfit;

  // Base currency symbol and code
  const currencySymbol = baseCurrency?.symbol || '$';
  const currencyCode = baseCurrency?.code || 'USD';

  // Format currency values
  const formatCurrency = (value) => {
    return Number(value).toFixed(2);
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
                  <CatalogLoadError error={marginsError} />
                  {/* Expiration Warning */}
                  {expiringProducts.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded-lg mb-6"
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

                  {/* ══════════ SECTION 1: Financial KPIs (super_admin) ══════════ */}
                  {isSuperAdmin && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="mb-8"
                    >
                      <div className="grid md:grid-cols-3 gap-4">
                        {/* Daily */}
                        <div className="glass-effect rounded-2xl p-5 border-t-4 border-emerald-500">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                              <Clock className="w-4 h-4 text-emerald-600" />
                            </div>
                            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{t('dashboard.dailyBreakdown')}</span>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs text-gray-500">{t('dashboard.stats.dailyRevenue')}</p>
                              <p className="text-xl font-bold text-gray-900">{currencySymbol}{formatCurrency(combinedDailyRevenue)} <span className="text-xs font-normal text-gray-400">{currencyCode}</span></p>
                            </div>
                            <div className="border-t pt-2">
                              <p className="text-xs text-gray-500">{t('dashboard.stats.dailyProfit')}</p>
                              <p className="text-xl font-bold text-emerald-600">{currencySymbol}{formatCurrency(combinedDailyProfit)} <span className="text-xs font-normal text-gray-400">{currencyCode}</span></p>
                            </div>
                          </div>
                        </div>
                        {/* Monthly */}
                        <div className="glass-effect rounded-2xl p-5 border-t-4 border-blue-500">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                              <Calendar className="w-4 h-4 text-blue-600" />
                            </div>
                            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{t('dashboard.monthlyBreakdown')}</span>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs text-gray-500">{t('dashboard.stats.monthlyRevenue')}</p>
                              <p className="text-xl font-bold text-gray-900">{currencySymbol}{formatCurrency(combinedMonthlyRevenue)} <span className="text-xs font-normal text-gray-400">{currencyCode}</span></p>
                            </div>
                            <div className="border-t pt-2">
                              <p className="text-xs text-gray-500">{t('dashboard.stats.monthlyProfit')}</p>
                              <p className="text-xl font-bold text-blue-600">{currencySymbol}{formatCurrency(combinedMonthlyProfit)} <span className="text-xs font-normal text-gray-400">{currencyCode}</span></p>
                            </div>
                          </div>
                        </div>
                        {/* Yearly */}
                        <div className="glass-effect rounded-2xl p-5 border-t-4 border-purple-500">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                              <TrendingUp className="w-4 h-4 text-purple-600" />
                            </div>
                            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{t('dashboard.yearlyBreakdown')}</span>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs text-gray-500">{t('dashboard.yearlyRevenue')}</p>
                              <p className="text-xl font-bold text-gray-900">{currencySymbol}{formatCurrency(combinedYearlyRevenue)} <span className="text-xs font-normal text-gray-400">{currencyCode}</span></p>
                            </div>
                            <div className="border-t pt-2">
                              <p className="text-xs text-gray-500">{t('dashboard.yearlyProfit')}</p>
                              <p className="text-xl font-bold text-purple-600">{currencySymbol}{formatCurrency(combinedYearlyProfit)} <span className="text-xs font-normal text-gray-400">{currencyCode}</span></p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* ══════════ SECTION 2: Quick Stats Bar ══════════ */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-8"
                  >
                    {[
                      { title: t('dashboard.stats.totalProducts'), value: stats.totalProducts, icon: Package, bg: 'bg-blue-50', iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
                      { title: t('dashboard.stats.totalCombos'), value: stats.totalCombos, icon: Users, bg: 'bg-indigo-50', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600' },
                      { title: t('dashboard.stats.remittanceTypes'), value: stats.totalRemittanceTypes, icon: Send, bg: 'bg-cyan-50', iconBg: 'bg-cyan-100', iconColor: 'text-cyan-600' },
                      { title: t('dashboard.stats.pendingRemittances'), value: stats.pendingRemittances, icon: Clock, bg: 'bg-amber-50', iconBg: 'bg-amber-100', iconColor: 'text-amber-600' },
                      { title: t('dashboard.stats.pendingOrders'), value: stats.pendingOrders, icon: Package, bg: 'bg-orange-50', iconBg: 'bg-orange-100', iconColor: 'text-orange-600' },
                      { title: t('dashboard.stats.totalUsers'), value: stats.totalUsers, icon: Users2, bg: 'bg-violet-50', iconBg: 'bg-violet-100', iconColor: 'text-violet-600' }
                    ].map((stat, i) => (
                      <div key={i} className={`${stat.bg} rounded-xl p-4 flex items-center gap-3`}>
                        <div className={`w-9 h-9 ${stat.iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                          <stat.icon className={`w-4 h-4 ${stat.iconColor}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-lg font-bold text-gray-900 leading-tight">{stat.value}</p>
                          <p className="text-xs text-gray-500 truncate">{stat.title}</p>
                        </div>
                      </div>
                    ))}
                  </motion.div>

                  {/* ══════════ SECTION 3: Orders & Remittances Side by Side ══════════ */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="grid lg:grid-cols-2 gap-6 mb-8"
                  >
                    {/* Orders Pipeline */}
                    <div className="glass-effect rounded-2xl p-6">
                      <div className="flex items-center gap-2 mb-5">
                        <Package className="w-5 h-5 text-blue-600" />
                        <h3 className="text-lg font-semibold">{t('dashboard.orderSummary')}</h3>
                        <span className="ml-auto text-sm font-bold text-gray-400">{stats.totalActive || 0} {t('dashboard.orderStatus.totalActive').toLowerCase()}</span>
                      </div>

                      {/* Order Revenue Summary (super_admin) */}
                      {isSuperAdmin && (
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {[
                            { label: t('dashboard.stats.dailyOrderRevenue'), value: stats.dailyRevenue, color: 'bg-green-50 text-green-700' },
                            { label: t('dashboard.stats.monthlyOrderRevenue'), value: stats.monthlyRevenue, color: 'bg-blue-50 text-blue-700' },
                            { label: t('dashboard.stats.dailyOrderProfit'), value: dailyProfit, color: 'bg-emerald-50 text-emerald-700' }
                          ].map((item, i) => (
                            <div key={i} className={`${item.color} rounded-lg p-2.5 text-center`}>
                              <p className="text-sm font-bold">{currencySymbol}{formatCurrency(item.value)}</p>
                              <p className="text-[10px] mt-0.5 opacity-75">{item.label}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="space-y-2">
                        {[
                          { label: t('dashboard.orderStatus.paymentPending'), value: stats.paymentPending, color: 'border-yellow-400 bg-yellow-50', textColor: 'text-yellow-700' },
                          { label: t('dashboard.orderStatus.proofToReview'), value: stats.proofToReview, color: 'border-orange-400 bg-orange-50', textColor: 'text-orange-700' },
                          { label: t('dashboard.orderStatus.paymentValidated'), value: stats.paymentValidated, color: 'border-green-400 bg-green-50', textColor: 'text-green-700' },
                          { label: t('dashboard.orderStatus.processing'), value: stats.processing, color: 'border-blue-400 bg-blue-50', textColor: 'text-blue-700' },
                          { label: t('dashboard.orderStatus.dispatched'), value: stats.dispatched, color: 'border-purple-400 bg-purple-50', textColor: 'text-purple-700' },
                          { label: t('dashboard.orderStatus.delivered'), value: stats.delivered, color: 'border-teal-400 bg-teal-50', textColor: 'text-teal-700' },
                          { label: t('dashboard.completed'), value: stats.completedOrders, color: 'border-emerald-500 bg-emerald-50', textColor: 'text-emerald-700' },
                          { label: t('dashboard.orderStatus.cancelled'), value: stats.cancelled, color: 'border-red-400 bg-red-50', textColor: 'text-red-600' }
                        ].map((item, i) => (
                          <div key={i} className={`flex justify-between items-center p-2.5 rounded-lg border-l-4 ${item.color}`}>
                            <span className="text-sm font-medium text-gray-700">{item.label}</span>
                            <span className={`text-base font-bold ${item.textColor}`}>{item.value || 0}</span>
                          </div>
                        ))}
                      </div>

                      {/* Payment Method Breakdown */}
                      {isSuperAdmin && Object.keys(stats.paymentMethodBreakdown || {}).length > 0 && (
                        <div className="mt-5 pt-4 border-t">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('dashboard.paymentMethods')}</p>
                          <div className="space-y-2">
                            {Object.entries(stats.paymentMethodBreakdown).map(([method, data]) => (
                              <div key={method} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                  <CreditCard className="w-3.5 h-3.5 text-gray-400" />
                                  <span className="capitalize text-gray-700">{method === 'unknown' ? t('common.other') : method}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-gray-500">{data.count}</span>
                                  <span className="font-semibold text-gray-800">{currencySymbol}{formatCurrency(data.total)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Remittances Overview */}
                    <div className="glass-effect rounded-2xl p-6">
                      <div className="flex items-center gap-2 mb-5">
                        <Send className="w-5 h-5 text-indigo-600" />
                        <h3 className="text-lg font-semibold">{t('dashboard.remittancesMetrics')}</h3>
                      </div>
                      {/* Count cards */}
                      <div className="grid grid-cols-3 gap-3 mb-5">
                        {[
                          { label: t('dashboard.stats.totalRemittances'), value: stats.totalRemittances, color: 'bg-indigo-50 text-indigo-700' },
                          { label: t('dashboard.pending'), value: stats.pendingRemittances, color: 'bg-amber-50 text-amber-700' },
                          { label: t('dashboard.completed'), value: stats.completedRemittances, color: 'bg-emerald-50 text-emerald-700' }
                        ].map((item, i) => (
                          <div key={i} className={`${item.color} rounded-xl p-3 text-center`}>
                            <p className="text-2xl font-bold">{item.value}</p>
                            <p className="text-xs mt-1 opacity-75">{item.label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Remittance Income Summary (super_admin) */}
                      {isSuperAdmin && (
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {[
                            { label: t('dashboard.stats.dailyRemittanceIncome'), value: dailyRemittanceProfit, color: 'bg-purple-50 text-purple-700' },
                            { label: t('dashboard.stats.monthlyRemittanceIncome'), value: monthlyRemittanceProfit, color: 'bg-indigo-50 text-indigo-700' },
                            { label: t('dashboard.yearlyRemittanceIncome'), value: yearlyRemittanceProfit, color: 'bg-violet-50 text-violet-700' }
                          ].map((item, i) => (
                            <div key={i} className={`${item.color} rounded-lg p-2.5 text-center`}>
                              <p className="text-sm font-bold">{currencySymbol}{formatCurrency(item.value)}</p>
                              <p className="text-[10px] mt-0.5 opacity-75">{item.label}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Remittance Volume Summary (super_admin) */}
                      {isSuperAdmin && (
                        <div className="space-y-2">
                          {[
                            { label: t('dashboard.dailyBreakdown'), volume: dailyRemittanceVolumeValue, payout: dailyRemittancePayout },
                            { label: t('dashboard.monthlyBreakdown'), volume: monthlyRemittanceVolumeValue, payout: monthlyRemittancePayout },
                            { label: t('dashboard.yearlyBreakdown'), volume: yearlyRemittanceVolumeValue, payout: yearlyRemittancePayout }
                          ].map((period, i) => (
                            <div key={i} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                              <span className="text-xs text-gray-500 font-medium">{period.label}</span>
                              <div className="flex gap-4">
                                <span className="text-gray-600">{t('dashboard.remittanceVolumeSent')}: <span className="font-semibold">{currencySymbol}{formatCurrency(period.volume)}</span></span>
                                <span className="text-gray-400">{t('dashboard.remittancePayout')}: <span className="font-medium">-{currencySymbol}{formatCurrency(period.payout)}</span></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>

                  {/* ══════════ SECTION 4: Profit Breakdown + Operational Insights (super_admin) ══════════ */}
                  {isSuperAdmin && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="mb-8"
                    >
                      {/* Consolidated P&L: Orders + Remittances + Combined */}
                      <div className="glass-effect rounded-2xl p-6 mb-6">
                        <div className="flex items-center gap-2 mb-5">
                          <BarChart3 className="w-5 h-5 text-purple-600" />
                          <h3 className="text-lg font-semibold">{t('dashboard.profitBreakdown')}</h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b text-left">
                                <th className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
                                <th className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.dailyBreakdown')}</th>
                                <th className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.monthlyBreakdown')}</th>
                                <th className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.yearlyBreakdown')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {/* Orders section */}
                              <tr>
                                <td colSpan="4" className="pt-3 pb-1">
                                  <span className="text-xs font-bold text-blue-600 uppercase tracking-wider flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5" /> {t('dashboard.ordersMetrics')}
                                    {orderProfit.fallbackLines > 0 && (
                                      <span className="text-[10px] font-normal text-gray-400 ml-1">
                                        ({t('dashboard.profitFallbackNote', { count: orderProfit.fallbackLines, margin: financialSettings.productProfit })})
                                      </span>
                                    )}
                                  </span>
                                </td>
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.grossRevenue')}</td>
                                <td className="py-1.5 text-right font-medium">{currencySymbol}{formatCurrency(stats.dailyRevenue)}</td>
                                <td className="py-1.5 text-right font-medium">{currencySymbol}{formatCurrency(stats.monthlyRevenue)}</td>
                                <td className="py-1.5 text-right font-medium">{currencySymbol}{formatCurrency(stats.yearlyRevenue)}</td>
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.costs')}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">-{currencySymbol}{formatCurrency(stats.dailyRevenue - dailyProfit)}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">-{currencySymbol}{formatCurrency(stats.monthlyRevenue - monthlyProfit)}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">-{currencySymbol}{formatCurrency(stats.yearlyRevenue - yearlyProfit)}</td>
                              </tr>
                              <tr className="border-b border-gray-200">
                                <td className="py-1.5 pl-4 font-semibold text-gray-700">{t('dashboard.estimatedProfit')}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{currencySymbol}{formatCurrency(dailyProfit)}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{currencySymbol}{formatCurrency(monthlyProfit)}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{currencySymbol}{formatCurrency(yearlyProfit)}</td>
                              </tr>

                              {/* Remittances section */}
                              <tr>
                                <td colSpan="4" className="pt-3 pb-1">
                                  <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-1.5">
                                    <Send className="w-3.5 h-3.5" /> {t('dashboard.remittancesMetrics')}
                                  </span>
                                </td>
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.remittanceVolumeSent')}</td>
                                <td className="py-1.5 text-right font-medium">{currencySymbol}{formatCurrency(dailyRemittanceVolumeValue)}</td>
                                <td className="py-1.5 text-right font-medium">{currencySymbol}{formatCurrency(monthlyRemittanceVolumeValue)}</td>
                                <td className="py-1.5 text-right font-medium">{currencySymbol}{formatCurrency(yearlyRemittanceVolumeValue)}</td>
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.remittancePayout')}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">-{currencySymbol}{formatCurrency(dailyRemittancePayout)}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">-{currencySymbol}{formatCurrency(monthlyRemittancePayout)}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">-{currencySymbol}{formatCurrency(yearlyRemittancePayout)}</td>
                              </tr>
                              <tr className="border-b border-gray-200">
                                <td className="py-1.5 pl-4 font-semibold text-gray-700">{t('dashboard.remittanceCommission')}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{currencySymbol}{formatCurrency(dailyRemittanceProfit)}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{currencySymbol}{formatCurrency(monthlyRemittanceProfit)}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{currencySymbol}{formatCurrency(yearlyRemittanceProfit)}</td>
                              </tr>

                              {/* Combined totals */}
                              <tr className="bg-gray-50">
                                <td colSpan="4" className="pt-3 pb-1">
                                  <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">{t('dashboard.totalIncome')}</span>
                                </td>
                              </tr>
                              <tr className="bg-gray-50 border-b border-gray-200">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.grossRevenue')}</td>
                                <td className="py-1.5 text-right font-medium">{currencySymbol}{formatCurrency(combinedDailyRevenue)}</td>
                                <td className="py-1.5 text-right font-medium">{currencySymbol}{formatCurrency(combinedMonthlyRevenue)}</td>
                                <td className="py-1.5 text-right font-medium">{currencySymbol}{formatCurrency(combinedYearlyRevenue)}</td>
                              </tr>
                              <tr className="bg-gray-50">
                                <td className="py-2 pl-4 font-bold text-gray-900">{t('dashboard.estimatedNetProfit')}</td>
                                <td className="py-2 text-right font-bold text-emerald-700 text-base">{currencySymbol}{formatCurrency(combinedDailyProfit)}</td>
                                <td className="py-2 text-right font-bold text-emerald-700 text-base">{currencySymbol}{formatCurrency(combinedMonthlyProfit)}</td>
                                <td className="py-2 text-right font-bold text-emerald-700 text-base">{currencySymbol}{formatCurrency(combinedYearlyProfit)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Operational Insights: Transport + Zelle + Discounts */}
                      <div className="grid md:grid-cols-3 gap-4">
                        {/* Transportation Costs */}
                        <div className="glass-effect rounded-2xl p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                              <Truck className="w-4 h-4 text-amber-600" />
                            </div>
                            <h4 className="text-sm font-semibold">{t('dashboard.shippingCollected')}</h4>
                          </div>
                          <div className="space-y-3">
                            {[
                              { label: t('dashboard.dailyShipping'), value: stats.dailyShippingCost },
                              { label: t('dashboard.monthlyShipping'), value: stats.monthlyShippingCost },
                              { label: t('dashboard.yearlyShipping'), value: stats.yearlyShippingCost }
                            ].map((item, i) => (
                              <div key={i} className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">{item.label}</span>
                                <span className="text-sm font-semibold text-amber-700">{currencySymbol}{formatCurrency(item.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Zelle Payments */}
                        <div className="glass-effect rounded-2xl p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                              <CreditCard className="w-4 h-4 text-green-600" />
                            </div>
                            <h4 className="text-sm font-semibold">{t('dashboard.zellePayments')}</h4>
                          </div>
                          <div className="space-y-3">
                            {[
                              { label: t('dashboard.dailyZelle'), value: stats.dailyZelleTotal },
                              { label: t('dashboard.monthlyZelle'), value: stats.monthlyZelleTotal },
                              { label: t('dashboard.yearlyZelle'), value: stats.yearlyZelleTotal }
                            ].map((item, i) => (
                              <div key={i} className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">{item.label}</span>
                                <span className="text-sm font-semibold text-green-700">{currencySymbol}{formatCurrency(item.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Discounts Applied */}
                        <div className="glass-effect rounded-2xl p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
                              <Tag className="w-4 h-4 text-violet-600" />
                            </div>
                            <h4 className="text-sm font-semibold">{t('dashboard.discounts')}</h4>
                          </div>
                          <div className="space-y-3">
                            {[
                              { label: t('dashboard.dailyDiscounts'), value: stats.dailyDiscounts },
                              { label: t('dashboard.monthlyDiscounts'), value: stats.monthlyDiscounts },
                              { label: t('dashboard.yearlyDiscounts'), value: stats.yearlyDiscounts }
                            ].map((item, i) => (
                              <div key={i} className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">{item.label}</span>
                                <span className="text-sm font-semibold text-violet-700">{currencySymbol}{formatCurrency(item.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Courier cost: what the courier is owed vs. the shipping charged to customers */}
                      <div className="glass-effect rounded-2xl p-5 mt-4" data-testid="courier-cost-card">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                            <Truck className="w-4 h-4 text-orange-600" />
                          </div>
                          <h4 className="text-sm font-semibold">{t('dashboard.courier.title')}</h4>
                        </div>
                        {courier.status === 'error' && (
                          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                            {t('dashboard.courier.unavailable')}
                          </p>
                        )}
                        {courier.status === 'loading' && (
                          <p role="status" className="text-sm text-gray-500">{t('dashboard.courier.loading')}</p>
                        )}
                        {courier.status === 'ok' && (
                          <>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b text-left">
                                    <th scope="col" className="pb-2"><span className="sr-only">{t('dashboard.courier.title')}</span></th>
                                    <th scope="col" className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.dailyBreakdown')}</th>
                                    <th scope="col" className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.monthlyBreakdown')}</th>
                                    <th scope="col" className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.yearlyBreakdown')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[
                                    { key: 'collected', label: t('dashboard.courier.collected'), values: [stats.dailyShippingCost, stats.monthlyShippingCost, stats.yearlyShippingCost], money: true },
                                    { key: 'cost', label: t('dashboard.courier.cost'), values: [courier.totals.dailyCourierCost, courier.totals.monthlyCourierCost, courier.totals.yearlyCourierCost], money: true },
                                    {
                                      key: 'difference',
                                      label: t('dashboard.courier.difference'),
                                      values: [
                                        stats.dailyShippingCost - courier.totals.dailyCourierCost,
                                        stats.monthlyShippingCost - courier.totals.monthlyCourierCost,
                                        stats.yearlyShippingCost - courier.totals.yearlyCourierCost
                                      ],
                                      money: true,
                                      strong: true
                                    },
                                    { key: 'unrecorded', label: t('dashboard.courier.unrecorded'), values: [courier.totals.dailyCourierUnrecorded, courier.totals.monthlyCourierUnrecorded, courier.totals.yearlyCourierUnrecorded], money: false }
                                  ].map((row) => (
                                    <tr key={row.key} className="border-b border-gray-100">
                                      <th scope="row" className={`py-1.5 pr-2 text-left text-xs ${row.strong ? 'font-bold text-gray-900' : 'font-normal text-gray-600'}`}>{row.label}</th>
                                      {row.values.map((value, i) => (
                                        <td key={i} className={`py-1.5 text-right ${row.strong ? 'font-bold' : 'font-medium'} ${row.money ? 'text-orange-700' : 'text-gray-600'}`}>
                                          {row.money ? `${currencySymbol}${formatCurrency(value)}` : value}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <p className="mt-3 text-[11px] text-gray-500">{t('dashboard.courier.note')}</p>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* ══════════ SECTION 5: Site Analytics ══════════ */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                  >
                    <div className="glass-effect rounded-2xl p-6">
                      <div className="flex items-center gap-2 mb-5">
                        <Eye className="w-5 h-5 text-blue-600" />
                        <h3 className="text-lg font-semibold">{t('dashboard.analyticsTitle')}</h3>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: t('dashboard.visits.thisWeek'), value: visitStats.weekly, color: 'bg-blue-50 text-blue-700', borderColor: '' },
                          { label: t('dashboard.visits.thisMonth'), value: visitStats.monthly, color: 'bg-purple-50 text-purple-700', borderColor: '' },
                          { label: t('dashboard.visits.thisYear'), value: visitStats.yearly, color: 'bg-orange-50 text-orange-700', borderColor: '' },
                          { label: t('dashboard.visits.allTime'), value: visitStats.total, color: 'bg-emerald-50 text-emerald-700', borderColor: 'ring-2 ring-emerald-300' }
                        ].map((item, i) => (
                          <div key={i} className={`${item.color} ${item.borderColor} rounded-xl p-4 text-center`}>
                            <p className="text-2xl font-bold">{item.value}</p>
                            <p className="text-xs mt-1 opacity-75">{item.label}</p>
                          </div>
                        ))}
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
            ...(isSuperAdmin ? [{
              id: 'activity-log',
              label: 'dashboard.activityLogTab',
              icon: <ShieldCheck className="h-5 w-5" />,
              content: (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <ActivityLogTab />
                </motion.div>
              )
            }] : []),
           
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
