import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDelayedSplash } from '@/hooks/useDelayedSplash';

// The React splash depends only on readiness: hidden for fast loads (< 300 ms), and once shown it stays
// at least 400 ms so it never flashes. No fixed wait.

describe('useDelayedSplash', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never shows the splash when readiness arrives before the delay', () => {
    const { result, rerender } = renderHook(({ ready }) => useDelayedSplash(ready), { initialProps: { ready: false } });
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe(false);
    rerender({ ready: true });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it('shows the splash after 300 ms of loading and keeps it at least 400 ms', () => {
    const { result, rerender } = renderHook(({ ready }) => useDelayedSplash(ready), { initialProps: { ready: false } });
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    rerender({ ready: true });
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('hides the splash as soon as ready when it was already visible longer than the minimum', () => {
    const { result, rerender } = renderHook(({ ready }) => useDelayedSplash(ready), { initialProps: { ready: false } });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(true);
    rerender({ ready: true });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current).toBe(false);
  });

  it('is false from the start when already ready', () => {
    const { result } = renderHook(() => useDelayedSplash(true));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(false);
  });
});

