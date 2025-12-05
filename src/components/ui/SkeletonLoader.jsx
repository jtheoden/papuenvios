import React from 'react';

/**
 * Skeleton Loader Component
 * Shows a loading placeholder matching content structure
 *
 * @prop {string} type - Type of skeleton (card, table, form, avatar, text, button)
 * @prop {number} count - Number of items to show (default: 1)
 * @prop {number} rows - For table/form: number of rows (default: 5)
 * @prop {string} className - Additional CSS classes
 */
const SkeletonLoader = ({
	type = 'card',
	count = 1,
	rows = 5,
	className = ''
}) => {
	// Base skeleton line styling
	const skeleton = 'bg-gray-200 rounded-md animate-pulse';

	// Card Skeleton
	if (type === 'card') {
		return (
			<div className={`space-y-3 ${className}`}>
				{Array.from({ length: count }).map((_, idx) => (
					<div key={idx} className="bg-white rounded-lg p-4 border border-gray-100 space-y-4">
						<div className={`${skeleton} h-4 w-1/2`} />
						<div className="space-y-2">
							<div className={`${skeleton} h-3 w-full`} />
							<div className={`${skeleton} h-3 w-5/6`} />
						</div>
						<div className={`${skeleton} h-10 w-full`} />
					</div>
				))}
			</div>
		);
	}

	// Table Skeleton
	if (type === 'table') {
		return (
			<div className={`space-y-2 ${className}`}>
				{/* Header */}
				<div className="flex gap-4 px-4 py-3 bg-gray-50 rounded-lg border border-gray-100">
					{Array.from({ length: 4 }).map((_, idx) => (
						<div key={idx} className={`${skeleton} h-4 flex-1`} />
					))}
				</div>
				{/* Rows */}
				{Array.from({ length: rows }).map((_, idx) => (
					<div key={idx} className="flex gap-4 px-4 py-3 bg-white rounded-lg border border-gray-100">
						{Array.from({ length: 4 }).map((_, colIdx) => (
							<div key={colIdx} className={`${skeleton} h-4 flex-1`} />
						))}
					</div>
				))}
			</div>
		);
	}

	// Form Skeleton
	if (type === 'form') {
		return (
			<div className={`space-y-4 ${className}`}>
				{Array.from({ length: rows }).map((_, idx) => (
					<div key={idx} className="space-y-2">
						<div className={`${skeleton} h-4 w-1/4`} />
						<div className={`${skeleton} h-10 w-full rounded-md`} />
					</div>
				))}
			</div>
		);
	}

	// Avatar Skeleton
	if (type === 'avatar') {
		return (
			<div className={`flex gap-2 ${className}`}>
				{Array.from({ length: count }).map((_, idx) => (
					<div
						key={idx}
						className={`${skeleton} rounded-full flex-shrink-0`}
						style={{ width: '40px', height: '40px' }}
					/>
				))}
			</div>
		);
	}

	// Text Skeleton (multiple lines)
	if (type === 'text') {
		return (
			<div className={`space-y-2 ${className}`}>
				{Array.from({ length: count || 3 }).map((_, idx) => (
					<div
						key={idx}
						className={`${skeleton} h-4`}
						style={{
							width: idx === (count || 3) - 1 ? '80%' : '100%'
						}}
					/>
				))}
			</div>
		);
	}

	// Button Skeleton
	if (type === 'button') {
		return (
			<div className={`flex gap-2 ${className}`}>
				{Array.from({ length: count }).map((_, idx) => (
					<div key={idx} className={`${skeleton} h-10 w-24`} />
				))}
			</div>
		);
	}

	// Default: Single line
	return <div className={`${skeleton} h-4 w-full ${className}`} />;
};

export default SkeletonLoader;
