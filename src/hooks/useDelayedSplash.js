import { useEffect, useRef, useState } from 'react';

/**
 * Whether to show a loading splash while `ready` is false: only after `delay` ms (fast loads never see it),
 * and once shown for at least `minVisible` ms so it does not flash.
 */
export const useDelayedSplash = (ready, { delay = 300, minVisible = 400 } = {}) => {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (!ready && !visible) {
      const id = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delay);
      return () => clearTimeout(id);
    }
    if (ready && visible) {
      const id = setTimeout(() => setVisible(false), Math.max(0, minVisible - (Date.now() - shownAt.current)));
      return () => clearTimeout(id);
    }
    return undefined;
  }, [ready, visible, delay, minVisible]);

  return visible;
};
