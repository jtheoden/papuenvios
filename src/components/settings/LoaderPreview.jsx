import React from 'react';
import BrandLogo from '@/components/BrandLogo';
import { buildLoadingTheme } from '@/lib/loadingTheme';
import { getLoaderConfig } from '@/lib/brandingDisplay';

/**
 * What the initial loading screen will paint for the given settings: the loader image, else the site logo, else the
 * company wordmark, on the loader background or, unset, the theme tokens (buildLoadingTheme, same as AuthLoadingScreen).
 */
const LoaderPreview = ({ settings }) => {
  const { image } = getLoaderConfig(settings);
  const source = !image ? 'wordmark' : image === settings?.loaderImage ? 'image' : 'logo';
  return (
    <div
      data-testid="loader-preview"
      data-source={source}
      className="rounded-xl border border-gray-200 p-6 flex items-center justify-center [background:var(--ld-bg)]"
      style={buildLoadingTheme(settings)}
    >
      <div className="p-6 rounded-2xl shadow-md bg-[color:var(--ld-card-bg)] flex flex-col items-center space-y-4 text-[color:var(--ld-text)]">
        <BrandLogo settings={{ ...settings, logo: image }} maxHeightCap={48} />
        <div className="w-10 h-10 border-4 border-transparent border-t-[color:var(--ld-accent)] rounded-full" />
      </div>
    </div>
  );
};

export default LoaderPreview;
