import React from 'react';
import { Eye, Play, Truck, Camera, Check, Ban } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Order Action Buttons Component
 * Renders conditional action buttons based on order status with intuitive colors and styling
 * Uses state machine logic to determine available actions
 */
const OrderActionButtons = ({
  order,
  onView,
  onStartProcessing,
  onMarkAsDispatched,
  onUploadDeliveryProof,
  onCompleteOrder,
  onCancelOrder,
  actionLoading
}) => {
  const { t, language } = useLanguage();
  const isLoading = actionLoading === order.id;

  // Determine primary action button based on order status
  const getPrimaryAction = () => {
    const { payment_status, status } = order;

    if (status === 'cancelled' || status === 'completed') {
      return null; // No primary action
    }

    if (payment_status === 'validated' && status === 'pending') {
      return {
        icon: <Play className="h-4 w-4" />,
        label: t('adminOrders.action.startProcessing'),
        onClick: () => onStartProcessing(order),
        disabled: isLoading,
        color: 'bg-emerald-500 hover:bg-emerald-600 text-white',
        tooltip: t('adminOrders.action.startProcessing')
      };
    }

    if (status === 'processing') {
      return {
        icon: <Truck className="h-4 w-4" />,
        label: t('adminOrders.action.markAsDispatched'),
        onClick: () => onMarkAsDispatched(order),
        disabled: isLoading,
        color: 'bg-blue-500 hover:bg-blue-600 text-white',
        tooltip: t('adminOrders.action.markAsDispatched')
      };
    }

    if (status === 'dispatched') {
      return {
        icon: <Camera className="h-4 w-4" />,
        label: t('adminOrders.action.uploadProof'),
        onClick: () => onUploadDeliveryProof(order),
        disabled: isLoading,
        color: 'bg-purple-500 hover:bg-purple-600 text-white',
        tooltip: t('adminOrders.action.uploadProof')
      };
    }

    if (status === 'delivered') {
      return {
        icon: <Check className="h-4 w-4" />,
        label: t('adminOrders.action.completeOrder'),
        onClick: () => onCompleteOrder(order),
        disabled: isLoading,
        color: 'bg-green-500 hover:bg-green-600 text-white',
        tooltip: t('adminOrders.action.completeOrder')
      };
    }

    return null;
  };

  const primaryAction = getPrimaryAction();

  // Helper function to render individual button with styling
  const renderButton = (button) => (
    <button
      key={button.label}
      onClick={button.onClick}
      disabled={button.disabled}
      title={button.tooltip}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all duration-200 text-sm ${
        button.color || 'bg-blue-500 hover:bg-blue-600 text-white'
      } ${button.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer shadow-sm'}`}
    >
      {button.icon}
      <span className="hidden sm:inline whitespace-nowrap">{button.label}</span>
    </button>
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* View Details Button - Always visible */}
      {renderButton({
        icon: <Eye className="h-4 w-4" />,
        label: t('common.view'),
        onClick: () => onView(order),
        disabled: false,
        color: 'bg-slate-500 hover:bg-slate-600 text-white',
        tooltip: t('adminOrders.action.viewDetails')
      })}

      {/* Primary Action Button - Status dependent */}
      {primaryAction && renderButton(primaryAction)}

      {/* Cancel Button - Always available except when completed or cancelled */}
      {order.status !== 'completed' && order.status !== 'cancelled' && renderButton({
        icon: <Ban className="h-4 w-4" />,
        label: t('common.cancel'),
        onClick: () => onCancelOrder(order),
        disabled: isLoading,
        color: 'bg-red-500 hover:bg-red-600 text-white',
        tooltip: t('adminOrders.action.cancelOrder')
      })}
    </div>
  );
};

export default OrderActionButtons;
