import React, { useState } from 'react';

/**
 * Brand image with a fallback: renders `fallback` when there is no `src` or it fails to load.
 * `src` comes from admin settings (URL or data URI): it only ever goes into <img src>, never into HTML.
 */
const BrandLogo = ({ src, fallback = null, ...imgProps }) => {
  const [failedSrc, setFailedSrc] = useState(null);
  if (!src || failedSrc === src) return fallback;
  return <img src={src} onError={() => setFailedSrc(src)} {...imgProps} />;
};

export default BrandLogo;
