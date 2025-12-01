import React from 'react';
import TooltipButton from '@/components/TooltipButton';

/**
 * Group of action buttons with responsive icon-only display on mobile
 * Automatically hides text on xs screens, shows on sm+
 *
 * @prop {array} buttons - Array of button configs:
 *   - {icon: React.ReactNode, label: string (i18n key), onClick: function, disabled: boolean, title: string}
 * @prop {string} className - Additional CSS classes for the wrapper
 * @prop {string} gap - Gap between buttons (default: 'gap-2')
 * @prop {string} tooltipPosition - Tooltip position for all buttons (default: 'top')
 */
const IconButtonGroup = ({ buttons = [], className = '', gap = 'gap-2', tooltipPosition = 'top' }) => {
  if (!buttons || buttons.length === 0) return null;

  return (
    <div className={`flex items-center ${gap} ${className}`}>
      {buttons.map((button, idx) => (
        <TooltipButton
          key={idx}
          variant="icon"
          tooltipText={button.title || button.label}
          tooltipPosition={tooltipPosition}
          onClick={button.onClick}
          disabled={button.disabled}
          title={button.title || button.label}
        >
          <div className="flex items-center gap-1">
            {button.icon}
            <span className="hidden sm:inline text-xs sm:text-sm font-medium">{button.label}</span>
          </div>
        </TooltipButton>
      ))}
    </div>
  );
};

export default IconButtonGroup;
