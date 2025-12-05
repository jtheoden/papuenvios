import React from 'react';
import { Check, Minus } from 'lucide-react';

/**
 * Checkbox Component
 * Custom checkbox with proper styling, indeterminate state support,
 * and accessibility features
 *
 * @prop {boolean} checked - Checked state
 * @prop {boolean} indeterminate - Indeterminate state (dash icon)
 * @prop {function} onChange - Change handler
 * @prop {string} label - Checkbox label
 * @prop {string} id - Input id
 * @prop {string} name - Input name
 * @prop {boolean} disabled - Disable checkbox
 * @prop {string} error - Error message
 * @prop {string} helper - Helper text
 * @prop {string} className - Additional CSS classes
 */
const Checkbox = ({
	checked = false,
	indeterminate = false,
	onChange,
	label = '',
	id = '',
	name = '',
	disabled = false,
	error = false,
	helper = '',
	className = ''
}) => {
	return (
		<div className={`flex flex-col gap-1 ${className}`}>
			<label className="flex items-center gap-2 cursor-pointer group">
				<div
					className={`
						flex items-center justify-center
						w-5 h-5 rounded-md border-2 transition-all
						${
							disabled
								? 'bg-gray-100 border-gray-300 cursor-not-allowed'
								: error
								? 'border-red-500 bg-white group-hover:border-red-600'
								: checked || indeterminate
								? 'border-blue-500 bg-blue-500'
								: 'border-gray-300 bg-white group-hover:border-blue-400'
						}
					`}
				>
					{checked && !indeterminate && (
						<Check size={16} className="text-white" strokeWidth={3} />
					)}
					{indeterminate && (
						<Minus size={16} className="text-white" strokeWidth={3} />
					)}
				</div>

				<input
					id={id}
					name={name}
					type="checkbox"
					checked={checked}
					onChange={(e) => onChange?.(e.target.checked)}
					disabled={disabled}
					aria-invalid={!!error}
					className="sr-only" // Hide but keep accessible
				/>

				{label && (
					<span
						className={`
							text-sm font-normal
							${disabled ? 'text-gray-500' : 'text-gray-900 group-hover:text-gray-700'}
						`}
					>
						{label}
					</span>
				)}
			</label>

			{/* Helper or Error Text */}
			{error && (
				<p className="text-xs text-red-600 font-medium ml-7">
					{error}
				</p>
			)}
			{helper && !error && (
				<p className="text-xs text-gray-600 ml-7">
					{helper}
				</p>
			)}
		</div>
	);
};

/**
 * CheckboxGroup Component
 * Multiple checkboxes with group management
 *
 * @prop {array} options - Array of {value, label} objects
 * @prop {array} values - Array of selected values
 * @prop {function} onChange - Change handler (receives array of values)
 * @prop {string} legend - Group legend (for fieldset)
 * @prop {string} error - Error message for group
 */
export const CheckboxGroup = ({
	options = [],
	values = [],
	onChange,
	legend = '',
	error = false,
	disabled = false,
	className = ''
}) => {
	const handleChange = (value, checked) => {
		const newValues = checked
			? [...values, value]
			: values.filter(v => v !== value);
		onChange?.(newValues);
	};

	return (
		<fieldset className={`flex flex-col gap-3 ${className}`}>
			{legend && (
				<legend className="text-sm font-medium text-gray-700">
					{legend}
				</legend>
			)}

			<div className="space-y-2">
				{options.map((option) => (
					<Checkbox
						key={option.value}
						id={`checkbox-${option.value}`}
						label={option.label}
						checked={values.includes(option.value)}
						onChange={(checked) => handleChange(option.value, checked)}
						disabled={disabled}
						error={error && values.length === 0 ? 'Select at least one option' : false}
					/>
				))}
			</div>

			{error && typeof error === 'string' && (
				<p className="text-sm text-red-600 font-medium">
					{error}
				</p>
			)}
		</fieldset>
	);
};

export default Checkbox;
