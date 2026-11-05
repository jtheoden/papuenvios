// Reference row of the CLASSIC (blue/violet) look, as production stored it BEFORE the owner saved the
// PapuEnvios palette. It is NOT the current production row (that one already holds every BRAND_PRESET key).
// Plain module so vitest and Playwright specs can share it (no '@/' alias on purpose); it carries no theme key.
export const CLASSIC_ROW = {
  useGradient: true,
  logo: '',
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
  accentColor: '#9333ea',
  headerGradientColor: '#9333ea',
  gradientDirection: '320',
  pageBgColor: '#f9fafb',
  navBarActiveBgColor: '#2563eb',
  navBarActiveTextColor: '#ffffff',
  headerMenuActiveBgColor: '#eff6ff',
  headerMenuActiveColor: '#2563eb',
  buttonBgColor: '#2563eb',
  buttonTextColor: '#ffffff',
  buttonHoverBgColor: '#1d4ed8',
  headerBgColor: '#ffffff',
  headerTextColor: '#1f2937',
  footerLinkColor: '#2563eb',
  footerLinkHoverColor: '#9333ea',
};
