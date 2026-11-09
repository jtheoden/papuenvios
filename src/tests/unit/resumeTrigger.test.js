import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeResume, RESUME_DEBOUNCE_MS, RESUME_JITTER_MS } from '@/lib/resumeTrigger';

const setVisibility = (value) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
const visibilityChange = () => document.dispatchEvent(new Event('visibilitychange'));
const online = () => window.dispatchEvent(new Event('online'));
const MAX_WAIT = RESUME_DEBOUNCE_MS + RESUME_JITTER_MS;

describe('subscribeResume (one debounced trigger for visibilitychange + online)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a burst of visibilitychange + online + visibilitychange runs each subscriber exactly once', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeResume(a);
    const offB = subscribeResume(b);

    visibilityChange();
    await vi.advanceTimersByTimeAsync(100);
    online();
    await vi.advanceTimersByTimeAsync(100);
    visibilityChange();
    expect(a).not.toHaveBeenCalled(); // debounced, not immediate

    await vi.advanceTimersByTimeAsync(MAX_WAIT);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it('a hidden page never triggers (neither visibilitychange nor an online event that fires while hidden)', async () => {
    const fn = vi.fn();
    const off = subscribeResume(fn);

    setVisibility('hidden');
    visibilityChange();
    online();
    await vi.advanceTimersByTimeAsync(MAX_WAIT * 2);

    expect(fn).not.toHaveBeenCalled();
    off();
  });

  it('triggers again for a later, separate resume', async () => {
    const fn = vi.fn();
    const off = subscribeResume(fn);

    visibilityChange();
    await vi.advanceTimersByTimeAsync(MAX_WAIT);
    visibilityChange();
    await vi.advanceTimersByTimeAsync(MAX_WAIT);

    expect(fn).toHaveBeenCalledTimes(2);
    off();
  });

  it('unsubscribing removes the subscriber and, with none left, the page listeners and the pending timer', async () => {
    const fn = vi.fn();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const off = subscribeResume(fn);

    visibilityChange();
    off();
    await vi.advanceTimersByTimeAsync(MAX_WAIT * 2);

    expect(fn).not.toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a failing subscriber does not stop the others', async () => {
    const good = vi.fn();
    const offBad = subscribeResume(() => { throw new Error('boom'); });
    const offGood = subscribeResume(good);

    visibilityChange();
    await vi.advanceTimersByTimeAsync(MAX_WAIT);

    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });

  it('a resume scheduled before the last subscriber left is not lost when another subscribes in the same tick', async () => {
    const offOld = subscribeResume(vi.fn());
    visibilityChange();
    offOld();
    const next = vi.fn();
    const offNext = subscribeResume(next); // re-subscribe (e.g. effect cleanup + re-run)

    await vi.advanceTimersByTimeAsync(MAX_WAIT);

    expect(next).toHaveBeenCalledTimes(1);
    offNext();
  });
});
