import React from 'react';
import { CheckCircle, AlertCircle, Clock, XCircle, Zap } from 'lucide-react';

/**
 * Status Badge Component
 * Accessible status indicator with icon, color, and label
 * Replaces emoji-only status indicators
 *
 * @prop {string} status - Status type (success, error, warning, pending, info)
 * @prop {string} label - Status label text
 * @prop {string} size - Badge size (sm, md, lg)
 * @prop {boolean} showIcon - Show icon with badge (default: true)
 * @prop {string} className - Additional CSS classes
 */
const StatusBadge = ({
	status = 'info',
	label = '',
	size = 'md',
	showIcon = true,
	className = ''
}) => {
	// Status configuration
	const statusConfig = {
		success: {
			bg: 'bg-green-100',
			text: 'text-green-800',
			icon: CheckCircle,
			iconColor: 'text-green-600',
			ariaLabel: 'Success'
		},
		error: {
			bg: 'bg-red-100',
			text: 'text-red-800',
			icon: XCircle,
			iconColor: 'text-red-600',
			ariaLabel: 'Error'
		},
		warning: {
			bg: 'bg-yellow-100',
			text: 'text-yellow-800',
			icon: AlertCircle,
			iconColor: 'text-yellow-600',
			ariaLabel: 'Warning'
		},
		pending: {
			bg: 'bg-blue-100',
			text: 'text-blue-800',
			icon: Clock,
			iconColor: 'text-blue-600',
			ariaLabel: 'Pending'
		},
		info: {
			bg: 'bg-sky-100',
			text: 'text-sky-800',
			icon: Zap,
			iconColor: 'text-sky-600',
			ariaLabel: 'Information'
		}
	};

	const config = statusConfig[status] || statusConfig.info;
	const Icon = config.icon;

	// Size configuration
	const sizeConfigMap = {
		sm: {
			padding: 'px-2 py-1',
			textSize: 'text-xs',
			iconSize: 14
		},
		md: {
			padding: 'px-3 py-1.5',
			textSize: 'text-sm',
			iconSize: 16
		},
		lg: {
			padding: 'px-4 py-2',
			textSize: 'text-base',
			iconSize: 18
		}
	};

	const sizeConfig = sizeConfigMap[size] || sizeConfigMap.md;

	return (
		<span
			className={`
				inline-flex items-center gap-1.5 rounded-md font-medium
				${config.bg} ${config.text} ${sizeConfig.padding} ${sizeConfig.textSize}
				${className}
			`}
			role="status"
			aria-label={label || config.ariaLabel}
		>
			{showIcon && (
				<Icon
					size={sizeConfig.iconSize}
					className={`flex-shrink-0 ${config.iconColor}`}
					aria-hidden="true"
				/>
			)}
			{label && <span>{label}</span>}
		</span>
	);
};

export default StatusBadge;
