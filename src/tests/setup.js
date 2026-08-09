import '@testing-library/jest-dom';

// jsdom doesn't implement ResizeObserver, needed by Radix UI's Popper (Tooltip, Popover, etc.)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
