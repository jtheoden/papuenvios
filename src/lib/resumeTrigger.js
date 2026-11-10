// src/lib/resumeTrigger.js
//
// One debounced "the page is back" trigger shared by every recovery loop. Mobile browsers fire
// visibilitychange and online in quick succession when a tab returns; each loop used to start its own
// attempt on each event. The wait also lets auth-js's own visibility handler (session recovery under its
// lock) finish first, so the recovery attempts that follow find a settled session instead of racing it.

export const RESUME_DEBOUNCE_MS = 500;
export const RESUME_JITTER_MS = 500; // spreads several tabs/devices behind one IP

const subscribers = new Set();
let timer = null;

const fire = () => {
  timer = null;
  if (document.visibilityState === 'hidden') return;
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // one failing subscriber must not stop the others
    }
  });
};

const schedule = () => {
  if (timer === null) timer = setTimeout(fire, RESUME_DEBOUNCE_MS + Math.random() * RESUME_JITTER_MS);
};
const onVisibility = () => {
  if (document.visibilityState === 'visible') schedule();
};

/** Calls `fn` once per resume burst (visible again / back online), never while hidden. Returns unsubscribe. */
export const subscribeResume = (fn) => {
  if (subscribers.size === 0) {
    window.addEventListener('online', schedule);
    document.addEventListener('visibilitychange', onVisibility);
  }
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size > 0) return;
    window.removeEventListener('online', schedule);
    document.removeEventListener('visibilitychange', onVisibility);
    // The pending timer is kept: a subscriber that re-subscribes in the same tick still gets this resume.
  };
};
