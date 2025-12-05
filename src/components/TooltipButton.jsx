import { useState } from 'react';

/**
 * Button wrapper that shows a visual tooltip on hover
 * Useful for buttons with hidden text on mobile devices
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Button content (icon + hidden text)
 * @param {string} props.tooltipText - Text to show in tooltip
 * @param {string} props.className - CSS classes for the button
 * @param {string} props.tooltipPosition - Tooltip position: 'top', 'bottom', 'left', 'right' (default: 'top')
 * @param {string} props.variant - Button variant: 'default' or 'icon' (default: 'default')
 * @param {Function} props.onClick - Click handler
 * @param {boolean} props.disabled - Button disabled state
 * @param {string} props.title - Native title attribute for accessibility
 */
const TooltipButton = ({
  children,
  tooltipText,
  className = '',
  tooltipPosition = 'top',
  variant = 'default',
  onClick,
  disabled = false,
  title
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const positionClasses = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2'
  };

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-gray-900 border-l-transparent border-r-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-900 border-l-transparent border-r-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-900 border-t-transparent border-b-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-gray-900 border-t-transparent border-b-transparent'
  };

  const variantClasses = {
    default: className,
    icon: `p-2 hover:bg-gray-100 rounded-lg transition-colors ${className}`
  };

  const finalClassName = variantClasses[variant] || variantClasses.default;

  return (
    <div className="relative inline-block" onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
      <button
        onClick={onClick}
        disabled={disabled}
        className={finalClassName}
        title={title || tooltipText}
      >
        {children}
      </button>

      {/* Visual Tooltip */}
      {showTooltip && tooltipText && (
        <div
          className={`absolute ${positionClasses[tooltipPosition]} z-50 px-3 py-2 bg-gray-900 text-white text-xs font-medium rounded-lg whitespace-nowrap pointer-events-none animate-fade-in shadow-lg`}
        >
          {tooltipText}
          <div
            className={`absolute w-2 h-2 bg-gray-900 ${arrowClasses[tooltipPosition]}`}
            style={{
              borderWidth: '4px',
              width: '0',
              height: '0'
            }}
          />
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fadeIn 0.2s ease-out;
        }
      `}</style>
    </div>
  );
};

export default TooltipButton;
