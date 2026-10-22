import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, DollarSign, Package, Users, AlertTriangle, Eye, Users2, RefreshCw, FileText, List, Send, Settings, Clock, CheckCircle, Ticket, CreditCard, ShieldCheck, Truck, Tag, Calendar } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { listProductCosts, listComboCosts } from '@/lib/adminCostService';
import { listOrderCourierCosts, listRemittanceCourierCosts } from '@/lib/courierCostService';
import { classifyAdminCatalogError } from '@/lib/catalogErrors';
import CatalogLoadError from './CatalogLoadError';
import { getHeadingStyle } from '@/lib/styleUtils';
import {
  ACTIVE_ORDER_STATUSES,
  buildMarginLookup,
  computeCourierCostTotals,
  computeHeadline,
  computeOrderCosts,
  computeOrderCounters,
  computeOrderProfitTotals,
  computeOrderTotals,
  computeRemittanceCourierTotals,
  computeRemittanceTotals,
  computeZelleTotals,
  groupItemsByOrder
} from '@/lib/dashboardMetrics';
import { roundMoney } from '@/lib/moneyPure';
import { useRealtimeOrders, useRealtimeRemittances } from '@/hooks/useRealtimeSubscription';
import TabsResponsive from './TabsResponsive';
import AdminOrdersTab from './AdminOrdersTab';
import AdminRemittancesTab from './AdminRemittancesTab';
import AdminOffersTab from './AdminOffersTab';
import RemittanceTypesConfig from './RemittanceTypesConfig';
import ZellePaymentHistoryTab from './admin/ZellePaymentHistoryTab';
import ActivityLogTab from './ActivityLogTab';
import { fetchAllRows } from '@/lib/fetchAllRows';

// Cost reads settle to { data, error } so one missing RPC does not blank the whole dashboard.
const settleCosts = (promise) =>
  promise
    .then((costs) => ({ data: [...costs.values()], error: null }))
    .catch((error) => ({ data: null, error }));

const HEADLINE_PERIODS = [
  { key: 'daily', titleKey: 'dashboard.dailyBreakdown', Icon: Clock, border: 'border-emerald-500', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', netColor: 'text-emerald-600' },
  { key: 'monthly', titleKey: 'dashboard.monthlyBreakdown', Icon: Calendar, border: 'border-blue-500', iconBg: 'bg-blue-100', iconColor: 'text-blue-600', netColor: 'text-blue-600' },
  { key: 'yearly', titleKey: 'dashboard.yearlyBreakdown', Icon: TrendingUp, border: 'border-purple-500', iconBg: 'bg-purple-100', iconColor: 'text-purple-600', netColor: 'text-purple-600' }
];

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

  // Money figures stay undefined until the first successful load (`ready`): the cards show "—", never a fake $0.00.
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalCombos: 0,
    totalUsers: 0,
    pendingOrders: 0,
    proofToReview: 0,
    completedOrders: 0,
    totalRemittances: 0,
    pendingRemittances: 0,
    completedRemittances: 0,
    totalRemittanceTypes: 0,
    pendingDeliveryCount: 0,
    paymentMethodBreakdown: {},
    ready: false,
    error: false,
    loading: true
  });

  // Inputs for the estimated order profit (orders + order lines + per-item margins)
  const [profitSource, setProfitSource] = useState(null);
  // Item margins come from the admin cost RPCs; a failure is shown, never swallowed into default margins
  const [marginsError, setMarginsError] = useState(null);
  // Courier cost snapshot per order (admin-only table). A failed read is shown as unavailable, never as zeros.
  const [courier, setCourier] = useState({ status: 'loading', totals: null });
  // Transport cost of cash remittances (table may not be deployed yet): unavailable never breaks the dashboard.
  const [remittanceCourier, setRemittanceCourier] = useState({ status: 'loading', totals: null });

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

  // Visit counts come from the server (exact count, head only): reading the rows would be capped by max_rows.
  const fetchVisitStats = useCallback(async () => {
    const unavailable = { weekly: 0, monthly: 0, yearly: 0, total: 0, loading: false, unavailable: true };
    try {
      const nowMs = Date.now();
      const since = (days) => new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
      const countVisits = (from) => {
        const query = supabase.from('site_visits').select('visit_time', { count: 'exact', head: true });
        return from ? query.gte('visit_time', from) : query;
      };

      const results = await Promise.all([countVisits(since(7)), countVisits(since(30)), countVisits(since(365)), countVisits()]);
      if (results.some((res) => res.error)) {
        setVisitStats(unavailable);
        return;
      }
      const [weekly, monthly, yearly, total] = results.map((res) => res.count || 0);
      setVisitStats({ weekly, monthly, yearly, total, loading: false, unavailable: false });
    } catch {
      setVisitStats(unavailable);
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
        fetchAllRows((from, to) => supabase.from('orders').select('id, status, payment_status, total_amount, shipping_cost, shipping_zone_id, discount_amount, payment_method, created_at, validated_at').order('id').range(from, to)),
        fetchAllRows((from, to) => supabase.from('remittances').select('id, status, commission_total, amount_sent, discount_amount, payment_validated_at, delivered_at, completed_at, delivery_cost, shipping_zone_id, created_at').order('id').range(from, to)),
        supabase.from('remittance_types').select('id', { count: 'exact', head: true }).eq('is_active', true),
        fetchAllRows((from, to) => supabase.from('zelle_transaction_history').select('id, amount, status, transaction_type, transaction_date, zelle_account_id').eq('status', 'validated').order('id').range(from, to)),
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

      // Revenue, shipping, discounts and payment breakdown (validated, active orders; ET calendar windows)
      const now = new Date();
      const orderTotals = computeOrderTotals(orders, now);

      try {
        const costByOrder = await listOrderCourierCosts();
        setCourier({ status: 'ok', totals: computeCourierCostTotals(orders, costByOrder, now, costByOrder.firstRecordedAt) });
      } catch {
        setCourier({ status: 'error', totals: null });
      }

      try {
        const costByRemittance = await listRemittanceCourierCosts();
        setRemittanceCourier({
          status: 'ok',
          totals: computeRemittanceCourierTotals(remittances, costByRemittance, now, costByRemittance.firstRecordedAt)
        });
      } catch {
        setRemittanceCourier({ status: 'error', totals: null });
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

      // Remittance income counts from payment validation; payout from delivery (see computeRemittanceTotals)
      const remittanceTotals = computeRemittanceTotals(remittances, now);
      const zelleTotals = computeZelleTotals(zelleTransactions, now);
      const discounts = Object.fromEntries(
        ['daily', 'monthly', 'yearly'].map((k) => [
          `${k}Discounts`,
          roundMoney(orderTotals[`${k}Discounts`] + remittanceTotals[`${k}RemittanceDiscounts`])
        ])
      );

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
        totalRemittanceTypes,
        ...orderTotals,
        ...remittanceTotals,
        ...zelleTotals,
        ...discounts,
        ready: true,
        error: false,
        loading: false
      });

    } catch {
      // Keep the last good figures on screen and tell the admin they may be stale.
      setStats(prev => ({ ...prev, loading: false, error: true }));
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

  useEffect(() => {
    if (user && (isAdmin || isSuperAdmin)) {
      fetchStats();
      fetchVisitStats();

      // Poll every 30 seconds (site_visits is not in the realtime publication)
      const statsInterval = setInterval(() => {
        fetchStats();
        fetchVisitStats();
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

  const remittanceCourierCost = (k) => remittanceCourier.totals?.[`${k}RemittanceCourierCost`] ?? 0;

  // Headlines per window (D1): sales, net income and cash collected are never added together.
  const headlines = {
    daily: computeHeadline({ orderRevenue: stats.dailyRevenue, orderProfit: dailyProfit, remittanceCommission: stats.dailyRemittanceIncome, remittanceVolume: stats.dailyRemittanceVolume, remittanceDeliveryCharge: stats.dailyRemittanceDeliveryCharge, remittanceCourierCost: remittanceCourierCost('daily') }),
    monthly: computeHeadline({ orderRevenue: stats.monthlyRevenue, orderProfit: monthlyProfit, remittanceCommission: stats.monthlyRemittanceIncome, remittanceVolume: stats.monthlyRemittanceVolume, remittanceDeliveryCharge: stats.monthlyRemittanceDeliveryCharge, remittanceCourierCost: remittanceCourierCost('monthly') }),
    yearly: computeHeadline({ orderRevenue: stats.yearlyRevenue, orderProfit: yearlyProfit, remittanceCommission: stats.yearlyRemittanceIncome, remittanceVolume: stats.yearlyRemittanceVolume, remittanceDeliveryCharge: stats.yearlyRemittanceDeliveryCharge, remittanceCourierCost: remittanceCourierCost('yearly') })
  };
  const orderCosts = {
    daily: computeOrderCosts(stats.dailyRevenue, stats.dailyShippingCost, dailyProfit),
    monthly: computeOrderCosts(stats.monthlyRevenue, stats.monthlyShippingCost, monthlyProfit),
    yearly: computeOrderCosts(stats.yearlyRevenue, stats.yearlyShippingCost, yearlyProfit)
  };

  // Base currency symbol and code
  const currencySymbol = baseCurrency?.symbol || '$';
  const currencyCode = baseCurrency?.code || 'USD';

  // Format currency values (always rounded to cents first)
  const formatCurrency = (value) => roundMoney(value).toFixed(2);

  // Amount with the base-currency symbol; "—" until the first load so a pending figure is not read as a real zero.
  const money = (value) => (stats.ready ? `${currencySymbol}${formatCurrency(value)}` : '—');
  const negativeMoney = (value) => (stats.ready ? `-${currencySymbol}${formatCurrency(value)}` : '—');
  const visitCount = (value) => (visitStats.loading || visitStats.unavailable ? '—' : value);

  // Courier card amounts are USD (tariff and snapshot are USD). shortcut: no currency conversion, "charged" is the
  // base-currency shipping; base is USD today, a real conversion is needed if that ever changes. null -> n/a.
  const formatUsd = (value) =>
    value === null || value === undefined
      ? t('dashboard.courier.notAvailable')
      : `${value < 0 ? '-' : ''}$${formatCurrency(Math.abs(value))}`;

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
                aria-busy={stats.loading}
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
                  {stats.error && (
                    <div data-testid="stats-error" role="alert" className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm">{stats.ready ? t('dashboard.loadErrorStale') : t('dashboard.loadError')}</p>
                      <button type="button" onClick={fetchStats} disabled={stats.loading} className="px-3 py-1.5 bg-white border border-red-300 rounded-lg text-sm font-medium hover:bg-red-100">
                        {t('dashboard.retry')}
                      </button>
                    </div>
                  )}
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
                      <p className="text-xs text-gray-500 mb-2">{t('dashboard.timeZoneNote')}</p>
                      <div className="grid md:grid-cols-3 gap-4">
                        {HEADLINE_PERIODS.map(({ key, titleKey, Icon, border, iconBg, iconColor, netColor }) => (
                          <div key={key} className={`glass-effect rounded-2xl p-5 border-t-4 ${border}`}>
                            <div className="flex items-center gap-2 mb-4">
                              <div className={`w-8 h-8 ${iconBg} rounded-lg flex items-center justify-center`}>
                                <Icon className={`w-4 h-4 ${iconColor}`} />
                              </div>
                              <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{t(titleKey)}</span>
                            </div>
                            <div className="space-y-3">
                              {[
                                { row: 'sales', value: headlines[key].sales, valueClass: 'text-gray-900' },
                                { row: 'netIncome', value: headlines[key].netIncome, valueClass: netColor },
                                { row: 'collected', value: headlines[key].collected, valueClass: 'text-gray-900' }
                              ].map(({ row, value, valueClass }, i) => (
                                <div key={row} className={i > 0 ? 'border-t pt-2' : ''}>
                                  <p className="text-xs text-gray-500 cursor-help" title={t(`dashboard.headline.${row}Def`)}>
                                    {t(`dashboard.headline.${row}`)}
                                    <span className="sr-only"> — {t(`dashboard.headline.${row}Def`)}</span>
                                  </p>
                                  <p data-testid={`headline-${key}-${row}`} className={`text-xl font-bold ${valueClass}`}>
                                    {money(value)} <span className="text-xs font-normal text-gray-500">{currencyCode}</span>
                                  </p>
                                  {row === 'collected' && (
                                    <p data-testid={`headline-${key}-deliveryCharge`} className="text-xs text-gray-500">
                                      {t('dashboard.headline.deliveryCharge')}: {money(headlines[key].deliveryCharge)}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
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
                              <p className="text-sm font-bold">{money(item.value)}</p>
                              <p className="text-xs mt-0.5 opacity-75">{item.label}</p>
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
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('dashboard.paymentMethods')} <span className="font-normal normal-case">({t('dashboard.paymentMethodsPeriod')})</span></p>
                          <div className="space-y-2">
                            {Object.entries(stats.paymentMethodBreakdown).map(([method, data]) => (
                              <div key={method} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                  <CreditCard className="w-3.5 h-3.5 text-gray-400" />
                                  <span className="capitalize text-gray-700">{method === 'unknown' ? t('common.other') : method}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-gray-500">{data.count}</span>
                                  <span className="font-semibold text-gray-800">{money(data.total)}</span>
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
                      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
                        {[
                          { label: t('dashboard.stats.totalRemittances'), value: stats.totalRemittances, color: 'bg-indigo-50 text-indigo-700' },
                          { label: t('dashboard.pending'), value: stats.pendingRemittances, color: 'bg-amber-50 text-amber-700' },
                          { label: t('dashboard.completed'), value: stats.completedRemittances, color: 'bg-emerald-50 text-emerald-700' }
                        ].map((item, i) => (
                          <div key={i} className={`${item.color} rounded-xl p-2 sm:p-3 text-center min-w-0`}>
                            <p className="text-xl sm:text-2xl font-bold">{item.value}</p>
                            <p className="text-xs mt-1 opacity-75 break-words">{item.label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Remittance Income Summary (super_admin) */}
                      {isSuperAdmin && (
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {[
                            { label: t('dashboard.stats.dailyRemittanceIncome'), value: stats.dailyRemittanceIncome, color: 'bg-purple-50 text-purple-700' },
                            { label: t('dashboard.stats.monthlyRemittanceIncome'), value: stats.monthlyRemittanceIncome, color: 'bg-indigo-50 text-indigo-700' },
                            { label: t('dashboard.yearlyRemittanceIncome'), value: stats.yearlyRemittanceIncome, color: 'bg-violet-50 text-violet-700' }
                          ].map((item, i) => (
                            <div key={i} className={`${item.color} rounded-lg p-2.5 text-center`}>
                              <p className="text-sm font-bold">{money(item.value)}</p>
                              <p className="text-xs mt-0.5 opacity-75">{item.label}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Liability: payment validated, not delivered yet (super_admin) */}
                      {isSuperAdmin && (
                        <div
                          data-testid="remittance-pending-delivery"
                          title={t('dashboard.remittancePendingDeliveryDef')}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-amber-50 text-amber-800 rounded-lg px-3 py-2 mb-4"
                        >
                          <span className="text-xs font-medium">{t('dashboard.remittancePendingDelivery')} ({stats.pendingDeliveryCount || 0})</span>
                          <span className="text-sm font-bold">{money(stats.pendingDeliveryAmount)}</span>
                        </div>
                      )}

                      {/* Remittance Volume Summary (super_admin) */}
                      {isSuperAdmin && (
                        <div className="space-y-2">
                          {[
                            { key: 'daily', label: t('dashboard.dailyBreakdown'), volume: stats.dailyRemittanceVolume, payout: stats.dailyRemittancePayout },
                            { key: 'monthly', label: t('dashboard.monthlyBreakdown'), volume: stats.monthlyRemittanceVolume, payout: stats.monthlyRemittancePayout },
                            { key: 'yearly', label: t('dashboard.yearlyBreakdown'), volume: stats.yearlyRemittanceVolume, payout: stats.yearlyRemittancePayout }
                          ].map((period) => (
                            <div key={period.key} data-testid={`remittance-volume-${period.key}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm bg-gray-50 rounded-lg px-3 py-2">
                              <span className="text-xs text-gray-500 font-medium">{period.label}</span>
                              <div className="flex flex-wrap gap-x-4 gap-y-1">
                                <span className="text-gray-600">{t('dashboard.remittanceVolumeSent')}: <span className="font-semibold">{money(period.volume)}</span></span>
                                <span className="text-gray-500">{t('dashboard.remittancePayout')}: <span className="font-medium">{negativeMoney(period.payout)}</span></span>
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
                                <th scope="col" className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide"><span className="sr-only">{t('dashboard.profitBreakdown')}</span></th>
                                <th scope="col" className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.dailyBreakdown')}</th>
                                <th scope="col" className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.monthlyBreakdown')}</th>
                                <th scope="col" className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.yearlyBreakdown')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {/* Orders section */}
                              <tr>
                                <td colSpan="4" className="pt-3 pb-1">
                                  <span className="text-xs font-bold text-blue-600 uppercase tracking-wider flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5" /> {t('dashboard.ordersMetrics')}
                                    {orderProfit.fallbackLines > 0 && (
                                      <span className="text-xs font-normal text-gray-500 ml-1">
                                        ({t('dashboard.profitFallbackNote', { count: orderProfit.fallbackLines, margin: financialSettings.productProfit })})
                                      </span>
                                    )}
                                  </span>
                                </td>
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.grossRevenue')}</td>
                                <td className="py-1.5 text-right font-medium">{money(stats.dailyRevenue)}</td>
                                <td className="py-1.5 text-right font-medium">{money(stats.monthlyRevenue)}</td>
                                <td className="py-1.5 text-right font-medium">{money(stats.yearlyRevenue)}</td>
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.shippingRow')}</td>
                                <td data-testid="pnl-orders-shipping-daily" className="py-1.5 text-right font-medium text-red-600">{negativeMoney(stats.dailyShippingCost)}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">{negativeMoney(stats.monthlyShippingCost)}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">{negativeMoney(stats.yearlyShippingCost)}</td>
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.costs')}</td>
                                <td data-testid="pnl-orders-costs-daily" className="py-1.5 text-right font-medium text-red-600">{negativeMoney(orderCosts.daily)}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">{negativeMoney(orderCosts.monthly)}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">{negativeMoney(orderCosts.yearly)}</td>
                              </tr>
                              <tr className="border-b border-gray-200">
                                <td className="py-1.5 pl-4 font-semibold text-gray-700">{t('dashboard.estimatedProfit')}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{money(dailyProfit)}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{money(monthlyProfit)}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{money(yearlyProfit)}</td>
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
                                <td className="py-1.5 text-right font-medium">{money(stats.dailyRemittanceVolume)}</td>
                                <td className="py-1.5 text-right font-medium">{money(stats.monthlyRemittanceVolume)}</td>
                                <td className="py-1.5 text-right font-medium">{money(stats.yearlyRemittanceVolume)}</td>
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.remittancePayout')}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">{negativeMoney(stats.dailyRemittancePayout)}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">{negativeMoney(stats.monthlyRemittancePayout)}</td>
                                <td className="py-1.5 text-right font-medium text-red-600">{negativeMoney(stats.yearlyRemittancePayout)}</td>
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.headline.deliveryCharge')}</td>
                                <td data-testid="pnl-remittance-delivery-daily" className="py-1.5 text-right font-medium">{money(stats.dailyRemittanceDeliveryCharge)}</td>
                                <td className="py-1.5 text-right font-medium">{money(stats.monthlyRemittanceDeliveryCharge)}</td>
                                <td className="py-1.5 text-right font-medium">{money(stats.yearlyRemittanceDeliveryCharge)}</td>
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-1.5 pl-4 text-gray-600">{t('dashboard.remittanceCourier.cost')}</td>
                                {['daily', 'monthly', 'yearly'].map((k) => (
                                  <td key={k} data-testid={`pnl-remittance-courier-cost-${k}`} className="py-1.5 text-right font-medium text-red-600">
                                    {remittanceCourier.status === 'ok' ? negativeMoney(remittanceCourierCost(k)) : t('dashboard.courier.notAvailable')}
                                  </td>
                                ))}
                              </tr>
                              {remittanceCourier.status === 'error' && (
                                <tr>
                                  <td colSpan="4" className="pb-2">
                                    <p data-testid="remittance-courier-unavailable" role="status" className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1">{t('dashboard.remittanceCourier.unavailable')}</p>
                                  </td>
                                </tr>
                              )}
                              {remittanceCourier.status === 'ok' && (remittanceCourier.totals.yearlyRemittanceCourierUnrecorded > 0 || remittanceCourier.totals.yearlyRemittanceCourierMissingRow > 0) && (
                                <tr>
                                  <td colSpan="4" className="pb-2">
                                    <p data-testid="remittance-courier-unrecorded" className="text-xs text-gray-600">
                                      {t('dashboard.remittanceCourier.unrecorded', { count: remittanceCourier.totals.yearlyRemittanceCourierUnrecorded + remittanceCourier.totals.yearlyRemittanceCourierMissingRow })}
                                    </p>
                                  </td>
                                </tr>
                              )}
                              <tr className="border-b border-gray-200">
                                <td className="py-1.5 pl-4 font-semibold text-gray-700">{t('dashboard.remittanceCommission')}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{money(stats.dailyRemittanceIncome)}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{money(stats.monthlyRemittanceIncome)}</td>
                                <td className="py-1.5 text-right font-bold text-emerald-600">{money(stats.yearlyRemittanceIncome)}</td>
                              </tr>

                              {/* Combined totals (never added together: see computeHeadline) */}
                              <tr className="bg-gray-50">
                                <td colSpan="4" className="pt-3 pb-1">
                                  <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">{t('dashboard.totalIncome')}</span>
                                </td>
                              </tr>
                              <tr className="bg-gray-50 border-b border-gray-200">
                                <th scope="row" className="py-1.5 pl-4 text-left font-normal text-gray-600" title={t('dashboard.headline.salesDef')}>{t('dashboard.headline.sales')}</th>
                                <td className="py-1.5 text-right font-medium">{money(headlines.daily.sales)}</td>
                                <td className="py-1.5 text-right font-medium">{money(headlines.monthly.sales)}</td>
                                <td className="py-1.5 text-right font-medium">{money(headlines.yearly.sales)}</td>
                              </tr>
                              <tr className="bg-gray-50 border-b border-gray-200">
                                <th scope="row" className="py-1.5 pl-4 text-left font-normal text-gray-600" title={t('dashboard.headline.collectedDef')}>{t('dashboard.headline.collected')}</th>
                                <td className="py-1.5 text-right font-medium">{money(headlines.daily.collected)}</td>
                                <td className="py-1.5 text-right font-medium">{money(headlines.monthly.collected)}</td>
                                <td className="py-1.5 text-right font-medium">{money(headlines.yearly.collected)}</td>
                              </tr>
                              <tr className="bg-gray-50">
                                <th scope="row" className="py-2 pl-4 text-left font-bold text-gray-900" title={t('dashboard.headline.netIncomeDef')}>{t('dashboard.headline.netIncome')}</th>
                                <td className="py-2 text-right font-bold text-emerald-700 text-base">{money(headlines.daily.netIncome)}</td>
                                <td className="py-2 text-right font-bold text-emerald-700 text-base">{money(headlines.monthly.netIncome)}</td>
                                <td className="py-2 text-right font-bold text-emerald-700 text-base">{money(headlines.yearly.netIncome)}</td>
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
                                <span className="text-sm font-semibold text-amber-700">{money(item.value)}</span>
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
                                <span className="text-sm font-semibold text-green-700">{money(item.value)}</span>
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
                                <span className="text-sm font-semibold text-violet-700">{money(item.value)}</span>
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
                          <h4 className="text-sm font-semibold">{t('dashboard.courier.title')} <span className="text-xs font-normal text-gray-400">USD</span></h4>
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
                              <table className="w-full table-fixed text-sm">
                                <thead>
                                  <tr className="border-b text-left">
                                    <th scope="col" className="w-2/5 pb-2"><span className="sr-only">{t('dashboard.courier.title')}</span></th>
                                    <th scope="col" className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.dailyBreakdown')}</th>
                                    <th scope="col" className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.monthlyBreakdown')}</th>
                                    <th scope="col" className="pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">{t('dashboard.yearlyBreakdown')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[
                                    { key: 'collected', label: t('dashboard.courier.collected'), values: [stats.dailyShippingCost, stats.monthlyShippingCost, stats.yearlyShippingCost], money: true },
                                    { key: 'collectedCompared', label: t('dashboard.courier.collectedCompared'), values: [courier.totals.dailyCourierCollected, courier.totals.monthlyCourierCollected, courier.totals.yearlyCourierCollected], money: true },
                                    { key: 'cost', label: t('dashboard.courier.cost'), values: [courier.totals.dailyCourierCost, courier.totals.monthlyCourierCost, courier.totals.yearlyCourierCost], money: true },
                                    {
                                      key: 'difference',
                                      label: t('dashboard.courier.difference'),
                                      values: [courier.totals.dailyCourierDifference, courier.totals.monthlyCourierDifference, courier.totals.yearlyCourierDifference],
                                      money: true,
                                      strong: true
                                    },
                                    { key: 'unrecorded', label: t('dashboard.courier.unrecorded'), values: [courier.totals.dailyCourierUnrecorded, courier.totals.monthlyCourierUnrecorded, courier.totals.yearlyCourierUnrecorded], money: false },
                                    // Orders with a zone but no row: possible trigger failure, shown apart from "no tariff".
                                    {
                                      key: 'missingRow',
                                      label: t('dashboard.courier.missingRow'),
                                      values: [courier.totals.dailyCourierMissingRow, courier.totals.monthlyCourierMissingRow, courier.totals.yearlyCourierMissingRow],
                                      money: false,
                                      alert: true
                                    }
                                  ].filter((row) => !row.alert || row.values.some((v) => v > 0)).map((row) => (
                                    <tr key={row.key} className={`border-b border-gray-100 ${row.alert ? 'bg-amber-50' : ''}`}>
                                      <th scope="row" className={`py-1.5 pr-2 text-left text-xs break-words ${row.alert ? 'font-semibold text-amber-800' : row.strong ? 'font-bold text-gray-900' : 'font-normal text-gray-600'}`}>{row.label}</th>
                                      {row.values.map((value, i) => (
                                        <td key={i} className={`py-1.5 text-right ${row.strong ? 'font-bold' : 'font-medium'} ${row.alert ? 'text-amber-800' : row.money ? 'text-orange-700' : 'text-gray-600'}`}>
                                          {row.money ? formatUsd(value) : value}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <p className="mt-3 text-xs text-gray-500">{t('dashboard.courier.note')}</p>
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
                      {visitStats.unavailable && (
                        <p role="status" className="text-sm text-gray-600 mb-3">{t('dashboard.visits.unavailable')}</p>
                      )}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: t('dashboard.visits.thisWeek'), value: visitStats.weekly, color: 'bg-blue-50 text-blue-700', borderColor: '' },
                          { label: t('dashboard.visits.thisMonth'), value: visitStats.monthly, color: 'bg-purple-50 text-purple-700', borderColor: '' },
                          { label: t('dashboard.visits.thisYear'), value: visitStats.yearly, color: 'bg-orange-50 text-orange-700', borderColor: '' },
                          { label: t('dashboard.visits.allTime'), value: visitStats.total, color: 'bg-emerald-50 text-emerald-700', borderColor: 'ring-2 ring-emerald-300' }
                        ].map((item, i) => (
                          <div key={i} className={`${item.color} ${item.borderColor} rounded-xl p-4 text-center`}>
                            <p className="text-2xl font-bold">{visitCount(item.value)}</p>
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
