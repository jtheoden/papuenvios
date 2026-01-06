/**
 * SkeletonCard Component
 * Reusable skeleton loader for various card types
 * Provides visual feedback during data loading
 */

import { motion } from 'framer-motion';

const SkeletonPulse = ({ className = '' }) => (
  <motion.div
    className={`bg-gray-200 rounded ${className}`}
    animate={{ opacity: [0.5, 1, 0.5] }}
    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
  />
);

const SkeletonCard = ({ variant = 'product', count = 1 }) => {
  const renderSkeleton = () => {
    switch (variant) {
      case 'product':
        return (
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            {/* Image placeholder */}
            <SkeletonPulse className="h-48 w-full" />
            <div className="p-4 space-y-3">
              {/* Title */}
              <SkeletonPulse className="h-5 w-3/4" />
              {/* Price */}
              <SkeletonPulse className="h-6 w-1/3" />
              {/* Description */}
              <div className="space-y-2">
                <SkeletonPulse className="h-3 w-full" />
                <SkeletonPulse className="h-3 w-5/6" />
              </div>
              {/* Button */}
              <SkeletonPulse className="h-10 w-full mt-4" />
            </div>
          </div>
        );

      case 'combo':
        return (
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            {/* Image placeholder */}
            <SkeletonPulse className="h-40 w-full" />
            <div className="p-4 space-y-3">
              {/* Badge */}
              <SkeletonPulse className="h-5 w-20" />
              {/* Title */}
              <SkeletonPulse className="h-6 w-3/4" />
              {/* Price row */}
              <div className="flex justify-between items-center">
                <SkeletonPulse className="h-5 w-1/4" />
                <SkeletonPulse className="h-7 w-1/3" />
              </div>
              {/* Items */}
              <div className="space-y-2 pt-2">
                <SkeletonPulse className="h-3 w-full" />
                <SkeletonPulse className="h-3 w-4/5" />
                <SkeletonPulse className="h-3 w-3/4" />
              </div>
              {/* Button */}
              <SkeletonPulse className="h-10 w-full mt-4" />
            </div>
          </div>
        );

      case 'remittance':
        return (
          <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
            {/* Header row */}
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <SkeletonPulse className="h-4 w-32" />
                <SkeletonPulse className="h-5 w-24" />
              </div>
              <SkeletonPulse className="h-6 w-20 rounded-full" />
            </div>
            {/* Details */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex justify-between">
                <SkeletonPulse className="h-4 w-20" />
                <SkeletonPulse className="h-4 w-28" />
              </div>
              <div className="flex justify-between">
                <SkeletonPulse className="h-4 w-16" />
                <SkeletonPulse className="h-5 w-24" />
              </div>
            </div>
            {/* Footer */}
            <div className="flex justify-between items-center pt-2">
              <SkeletonPulse className="h-3 w-24" />
              <SkeletonPulse className="h-8 w-20 rounded-lg" />
            </div>
          </div>
        );

      case 'order':
        return (
          <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
            {/* Header */}
            <div className="flex justify-between items-center">
              <SkeletonPulse className="h-5 w-28" />
              <SkeletonPulse className="h-6 w-24 rounded-full" />
            </div>
            {/* Items preview */}
            <div className="flex gap-2">
              <SkeletonPulse className="h-12 w-12 rounded" />
              <SkeletonPulse className="h-12 w-12 rounded" />
              <SkeletonPulse className="h-12 w-12 rounded" />
            </div>
            {/* Details */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex justify-between">
                <SkeletonPulse className="h-4 w-20" />
                <SkeletonPulse className="h-4 w-16" />
              </div>
              <div className="flex justify-between">
                <SkeletonPulse className="h-4 w-16" />
                <SkeletonPulse className="h-5 w-20" />
              </div>
            </div>
          </div>
        );

      case 'carousel':
        return (
          <div className="relative w-full overflow-hidden rounded-xl">
            <SkeletonPulse className="h-64 md:h-80 lg:h-96 w-full" />
            {/* Navigation dots */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
              <SkeletonPulse className="h-2 w-2 rounded-full" />
              <SkeletonPulse className="h-2 w-2 rounded-full" />
              <SkeletonPulse className="h-2 w-2 rounded-full" />
            </div>
          </div>
        );

      case 'testimonial':
        return (
          <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
            {/* Avatar and name */}
            <div className="flex items-center gap-3">
              <SkeletonPulse className="h-12 w-12 rounded-full" />
              <div className="space-y-2">
                <SkeletonPulse className="h-4 w-24" />
                <SkeletonPulse className="h-3 w-16" />
              </div>
            </div>
            {/* Stars */}
            <div className="flex gap-1">
              {[...Array(5)].map((_, i) => (
                <SkeletonPulse key={i} className="h-4 w-4" />
              ))}
            </div>
            {/* Text */}
            <div className="space-y-2">
              <SkeletonPulse className="h-3 w-full" />
              <SkeletonPulse className="h-3 w-full" />
              <SkeletonPulse className="h-3 w-3/4" />
            </div>
          </div>
        );

      case 'category':
        return (
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <SkeletonPulse className="h-32 w-full" />
            <div className="p-3 text-center">
              <SkeletonPulse className="h-4 w-3/4 mx-auto" />
            </div>
          </div>
        );

      case 'stats':
        return (
          <div className="bg-white rounded-xl shadow-md p-4 space-y-2">
            <div className="flex items-center justify-between">
              <SkeletonPulse className="h-10 w-10 rounded-lg" />
              <SkeletonPulse className="h-4 w-16" />
            </div>
            <SkeletonPulse className="h-8 w-20" />
            <SkeletonPulse className="h-3 w-24" />
          </div>
        );

      case 'list-item':
        return (
          <div className="bg-white rounded-lg p-3 flex items-center gap-3">
            <SkeletonPulse className="h-10 w-10 rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonPulse className="h-4 w-3/4" />
              <SkeletonPulse className="h-3 w-1/2" />
            </div>
            <SkeletonPulse className="h-8 w-16 rounded" />
          </div>
        );

      default:
        return (
          <div className="bg-white rounded-xl shadow-md p-4 space-y-3">
            <SkeletonPulse className="h-6 w-3/4" />
            <SkeletonPulse className="h-4 w-full" />
            <SkeletonPulse className="h-4 w-5/6" />
          </div>
        );
    }
  };

  if (count === 1) {
    return renderSkeleton();
  }

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index}>{renderSkeleton()}</div>
      ))}
    </>
  );
};

// Grid wrapper component for multiple skeletons
export const SkeletonGrid = ({
  variant = 'product',
  count = 4,
  columns = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  gap = 'gap-6'
}) => (
  <div className={`grid ${columns} ${gap}`}>
    <SkeletonCard variant={variant} count={count} />
  </div>
);

// List wrapper component for multiple skeletons
export const SkeletonList = ({
  variant = 'list-item',
  count = 3,
  gap = 'gap-3'
}) => (
  <div className={`flex flex-col ${gap}`}>
    <SkeletonCard variant={variant} count={count} />
  </div>
);

export default SkeletonCard;
