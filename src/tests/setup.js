import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// Default waitFor/findBy timeout is 1 s: heavy page renders (SendRemittancePage, CartPage) exceed it
// when CI or coverage loads the machine, which made tests flake with "Unable to find role=button".
configure({ asyncUtilTimeout: 5000 });

// jsdom doesn't implement ResizeObserver, needed by Radix UI's Popper (Tooltip, Popover, etc.)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// LoadingState keeps a shown skeleton for MIN_VISIBLE_MS. On a loaded machine a render passes the 300 ms show delay,
// and the held skeleton (role="status") then coexists with the page's own status notices: tests flaked. In tests the
// skeleton goes away as soon as loading ends; LoadingState.test.jsx restores the real timing.
import { loadingTiming } from '@/components/ui/loadingTiming';
loadingTiming.minVisibleMs = 0;
