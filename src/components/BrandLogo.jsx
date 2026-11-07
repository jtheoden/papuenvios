import React, { useState } from 'react';
import { safeLogoSrc } from '@/lib/brandingDisplay';

const DEFAULT_NAME = 'PapuEnvios';
const DEFAULT_MAX_HEIGHT = 40;
const DEFAULT_CAP = 64;
export { safeLogoSrc };

/** logoMaxHeight when it is a positive number, else the default; never above the cap. */
const resolveMaxHeight = (value, cap) => {
  const n = Number(value);
  return Math.min(Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_HEIGHT, cap);
};

/**
 * The brand logo from the visual settings, for screens that sit outside the Header (Login, loading).
 * `fallback` replaces the company-name wordmark shown without a usable logo (null renders nothing).
 * A logo that fails to load falls back too; a new logo source gets another chance.
 */
const BrandLogo = ({ settings, maxHeightCap = DEFAULT_CAP, fallback, className = '' }) => {
  const src = safeLogoSrc(settings?.logo);
  const name = settings?.companyName || DEFAULT_NAME;
  const [failedSrc, setFailedSrc] = useState('');

  if (!src || failedSrc === src) {
    return fallback === undefined ? <span className={`font-bold ${className}`}>{name}</span> : fallback;
  }

  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailedSrc(src)}
      className={`object-contain ${className}`}
      style={{ maxHeight: `${resolveMaxHeight(settings.logoMaxHeight, maxHeightCap)}px`, width: 'auto' }}
    />
  );
};

export default BrandLogo;
