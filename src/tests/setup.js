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
