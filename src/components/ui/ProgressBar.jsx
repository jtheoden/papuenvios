import React from 'react';

/**
 * ProgressBar Component
 * Shows progress with determinate or indeterminate mode
 *
 * @prop {number} progress - Progress percentage (0-100) for determinate mode
 * @prop {string} status - Status variant (info, success, warning, error)
 * @prop {boolean} indeterminate - Show animated progress bar without value
 * @prop {string} label - Optional progress label
 * @prop {boolean} showPercentage - Show percentage text (default: true)
 * @prop {string} className - Additional CSS classes
 */
const ProgressBar = ({
	progress = 0,
	status = 'info',
	indeterminate = false,
	label = '',
	showPercentage = true,
	className = ''
}) => {
	// Clamp progress between 0-100
	const clampedProgress = Math.min(100, Math.max(0, progress));

	// Status color configuration
	const statusConfig = {
		info: {
			bg: 'bg-blue-500',
			lightBg: 'bg-blue-100',
			text: 'text-blue-700'
		},
		success: {
			bg: 'bg-green-500',
			lightBg: 'bg-green-100',
			text: 'text-green-700'
		},
		warning: {
			bg: 'bg-yellow-500',
			lightBg: 'bg-yellow-100',
			text: 'text-yellow-700'
		},
		error: {
			bg: 'bg-red-500',
			lightBg: 'bg-red-100',
			text: 'text-red-700'
		}
	};

	const config = statusConfig[status] || statusConfig.info;

	return (
		<div className={`flex flex-col gap-2 ${className}`}>
			{/* Label and Percentage */}
			{(label || showPercentage) && (
				<div className="flex items-center justify-between">
					{label && (
						<label className="text-sm font-medium text-gray-700">
							{label}
						</label>
					)}
					{showPercentage && !indeterminate && (
						<span className={`text-sm font-medium ${config.text}`}>
							{clampedProgress}%
						</span>
					)}
				</div>
			)}

			{/* Progress Bar Container */}
			<div className={`w-full h-2 ${config.lightBg} rounded-full overflow-hidden`}>
				<div
					className={`
						h-full transition-all duration-300 ease-out rounded-full
						${config.bg}
						${indeterminate ? 'animate-pulse' : ''}
					`}
					style={{
						width: indeterminate ? '100%' : `${clampedProgress}%`,
						opacity: indeterminate ? 0.6 : 1
					}}
					role="progressbar"
					aria-valuenow={indeterminate ? undefined : clampedProgress}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-label={label || `Progress: ${clampedProgress}%`}
				/>
			</div>

			{/* Striped variant for indeterminate */}
			{indeterminate && (
				<style>{`
					@keyframes progress-stripes {
						0% { background-position: 0 0; }
						100% { background-position: 40px 0; }
					}
				`}</style>
			)}
		</div>
	);
};

export default ProgressBar;
