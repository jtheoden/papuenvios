// Runtime timing of LoadingState, in its own dependency-free module so the test setup can tune it
// (src/tests/setup.js) without importing the component and its contexts before the tests mock them.
export const SHOW_DELAY_MS = 300;
export const MIN_VISIBLE_MS = 400;

export const loadingTiming = { showDelayMs: SHOW_DELAY_MS, minVisibleMs: MIN_VISIBLE_MS };
