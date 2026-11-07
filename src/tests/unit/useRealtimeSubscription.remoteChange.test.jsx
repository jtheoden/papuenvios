import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const rt = vi.hoisted(() => ({ handler: null, noteRemoteChange: vi.fn() }));

vi.mock('@/lib/requestBudget', () => ({ noteRemoteChange: rt.noteRemoteChange }));
vi.mock('@/lib/supabase', () => {
  const channel = {
    on: (_type, _opts, handler) => {
      rt.handler = handler;
      return channel;
    },
    subscribe: () => channel
  };
  return { supabase: { channel: () => channel, removeChannel: () => {} } };
});

import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

describe('useRealtimeSubscription', () => {
  it('tells the request layer about every change before the subscriber refetches', async () => {
    const order = [];
    rt.noteRemoteChange.mockImplementation(() => order.push('noted'));
    renderHook(() => useRealtimeSubscription({ table: 'orders', onUpdate: () => order.push('refetch') }));
    await waitFor(() => expect(rt.handler).toBeTypeOf('function'));
    rt.handler({ eventType: 'UPDATE' });
    expect(order).toEqual(['noted', 'refetch']);
  });
});
