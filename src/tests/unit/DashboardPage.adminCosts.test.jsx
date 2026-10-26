import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Phase 0b: the dashboard reads item margins through the admin RPCs. When they are missing
// (migration not applied yet) it must say so instead of silently estimating with the default margin.

const state = vi.hoisted(() => ({ rpcError: null, rpcCalls: [] }));
const stable = vi.hoisted(() => ({
  auth: { user: { id: 'su' }, isAdmin: true, isSuperAdmin: true },
  business: { products: [], combos: [], financialSettings: { productProfit: 40 }, visualSettings: {} }
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => stable.auth }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'en' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => stable.business }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeOrders: vi.fn(),
  useRealtimeRemittances: vi.fn(),
  useRealtimeSubscription: vi.fn()
}));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}) }));
vi.mock('@/components/TabsResponsive', () => ({
  default: ({ tabs, activeTab }) => tabs.find((tab) => tab.id === activeTab)?.content ?? null
}));
vi.mock('@/components/AdminOrdersTab', () => ({ default: () => null }));
vi.mock('@/components/AdminRemittancesTab', () => ({ default: () => null }));
vi.mock('@/components/AdminOffersTab', () => ({ default: () => null }));
vi.mock('@/components/RemittanceTypesConfig', () => ({ default: () => null }));
vi.mock('@/components/admin/ZellePaymentHistoryTab', () => ({ default: () => null }));
vi.mock('@/components/ActivityLogTab', () => ({ default: () => null }));
vi.mock('@/lib/supabase', () => {
  const makeChain = (table) => {
    const chain = {};
    ['select', 'eq', 'in', 'order', 'range', 'gte'].forEach((m) => { chain[m] = () => chain; });
    chain.then = (resolve) => resolve({ data: [], count: 0, error: null, table });
    return chain;
  };
  return {
    supabase: {
      from: (table) => makeChain(table),
      rpc: async (name, args) => {
        state.rpcCalls.push({ name, args });
        return state.rpcError ? { data: null, error: state.rpcError } : { data: [], error: null };
      }
    }
  };
});

import DashboardPage from '@/components/DashboardPage';

describe('DashboardPage admin cost reads', () => {
  it('reads product and combo margins through the admin RPCs, never from the tables', async () => {
    state.rpcError = null;
    state.rpcCalls = [];
    render(<DashboardPage onNavigate={() => {}} />);
    await waitFor(() => expect(state.rpcCalls.map((c) => c.name).filter((name) => name.endsWith('_costs')).sort()).toEqual(['admin_list_combo_costs', 'admin_list_product_costs']));
    expect(screen.queryByText('products.catalogError.adminCosts')).toBeNull();
  });

  it('shows a clear alert when the admin RPCs are missing (no silent default margin)', async () => {
    state.rpcError = { code: 'PGRST202', message: 'Could not find the function public.admin_list_product_costs in the schema cache' };
    state.rpcCalls = [];
    render(<DashboardPage onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('products.catalogError.adminCosts'));
  });
});
