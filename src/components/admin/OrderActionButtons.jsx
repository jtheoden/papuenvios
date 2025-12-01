import React from 'react';
import { Eye, Play, Truck, Camera, Check, Ban } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import IconButtonGroup from '@/components/buttons/IconButtonGroup';

/**
 * Order Action Buttons Component
 * Renders conditional action buttons based on order status
 * Uses state machine logic to determine available actions
 */
const OrderActionButtons = ({
  order,
  onView,
  onStartProcessing,
  onMarkAsShipped,
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
        disabled: isLoading
      };
    }

    if (status === 'processing') {
      return {
        icon: <Truck className="h-4 w-4" />,
        label: t('adminOrders.action.markAsShipped'),
        onClick: () => onMarkAsShipped(order),
        disabled: isLoading
      };
    }

    if (status === 'shipped') {
      return {
        icon: <Camera className="h-4 w-4" />,
        label: t('adminOrders.action.uploadProof'),
        onClick: () => onUploadDeliveryProof(order),
        disabled: isLoading
      };
    }

    if (status === 'delivered') {
      return {
        icon: <Check className="h-4 w-4" />,
        label: t('adminOrders.action.completeOrder'),
        onClick: () => onCompleteOrder(order),
        disabled: isLoading
      };
    }

    return null;
  };

  const primaryAction = getPrimaryAction();

  // Build buttons array
  const buttons = [
    {
      icon: <Eye className="h-4 w-4" />,
      label: t('common.view'),
      onClick: () => onView(order),
      disabled: false,
      title: t('adminOrders.action.viewDetails')
    }
  ];

  // Add primary action if available
  if (primaryAction) {
    buttons.push({
      ...primaryAction,
      title: primaryAction.label
    });
  }

  // Add cancel button if order not completed/cancelled
  if (order.status !== 'completed' && order.status !== 'cancelled') {
    buttons.push({
      icon: <Ban className="h-4 w-4" />,
      label: t('common.cancel'),
      onClick: () => onCancelOrder(order),
      disabled: isLoading,
      title: t('adminOrders.action.cancelOrder')
    });
  }

  return (
    <IconButtonGroup
      buttons={buttons}
      gap="gap-1"
      tooltipPosition="left"
    />
  );
};

export default OrderActionButtons;
