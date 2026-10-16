import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsyncResource } from '@/hooks/useAsyncResource';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('useAsyncResource', () => {
  it('loads on mount and exposes data', async () => {
    const loader = vi.fn().mockResolvedValue('a');
    const { result } = renderHook(() => useAsyncResource(loader));
    await waitFor(() => expect(result.current.data).toBe('a'));
    expect(result.current.loading).toBe(false);
  });

  it('does not load while disabled and loads when enabled', async () => {
    const loader = vi.fn().mockResolvedValue('a');
    const { result, rerender } = renderHook(({ enabled }) => useAsyncResource(loader, { enabled }), { initialProps: { enabled: false } });
    expect(loader).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toBe('a'));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('discards an out-of-order response: the newest reload wins', async () => {
    const first = deferred();
    const second = deferred();
    const loader = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAsyncResource(loader));
    act(() => {
      result.current.reload();
    });
    await act(async () => {
      second.resolve('new');
    });
    await act(async () => {
      first.resolve('old');
    });
    expect(result.current.data).toBe('new');
  });

  it('setData invalidates an in-flight reload so a stale response cannot overwrite it', async () => {
    const initial = deferred();
    const inflight = deferred();
    const loader = vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(inflight.promise);
    const { result } = renderHook(() => useAsyncResource(loader));
    await act(async () => {
      initial.resolve('v1');
    });
    act(() => {
      result.current.reload();
    });
    act(() => {
      result.current.setData('saved');
    });
    await act(async () => {
      inflight.resolve('stale');
    });
    expect(result.current.data).toBe('saved');
    expect(result.current.loading).toBe(false);
  });

  it('keeps previous data when a reload fails', async () => {
    const loader = vi.fn().mockResolvedValueOnce('ok').mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => useAsyncResource(loader));
    await waitFor(() => expect(result.current.data).toBe('ok'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBe('ok');
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
