import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, AlertCircle } from 'lucide-react';

/**
 * SelectDropdown Component
 * Custom select dropdown replacing native <select> with:
 * - Keyboard navigation (arrow keys, Enter, Escape, typing)
 * - Search filtering for long lists
 * - Accessible ARIA attributes
 * - Custom styling matching design system
 *
 * @prop {string} label - Select label
 * @prop {string} name - Input name
 * @prop {array} options - Array of {value, label} objects
 * @prop {string} value - Currently selected value
 * @prop {function} onChange - Change handler
 * @prop {boolean} required - Mark as required
 * @prop {string} placeholder - Placeholder text
 * @prop {boolean} disabled - Disable select
 * @prop {string} error - Error message
 * @prop {boolean} searchable - Enable search/filter (default: true for 5+ items)
 * @prop {string} className - Additional CSS classes
 */
const SelectDropdown = ({
	label = '',
	name = '',
	options = [],
	value = '',
	onChange,
	required = false,
	placeholder = 'Select...',
	disabled = false,
	error = false,
	searchable = null, // Auto-enable for 5+ items
	className = ''
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const [searchTerm, setSearchTerm] = useState('');
	const [highlightedIndex, setHighlightedIndex] = useState(0);
	const containerRef = useRef(null);
	const searchInputRef = useRef(null);
	const listRef = useRef(null);

	// Auto-enable search for large lists
	const showSearch = searchable !== null ? searchable : options.length >= 5;

	// Filter options based on search term
	const filteredOptions = searchTerm
		? options.filter(opt =>
			opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
			opt.value.toLowerCase().includes(searchTerm.toLowerCase())
		)
		: options;

	// Get selected label
	const selectedOption = options.find(opt => opt.value === value);
	const selectedLabel = selectedOption?.label || placeholder;

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (e) => {
			if (containerRef.current && !containerRef.current.contains(e.target)) {
				setIsOpen(false);
				setSearchTerm('');
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
			return () => document.removeEventListener('mousedown', handleClickOutside);
		}
	}, [isOpen]);

	// Focus search input when dropdown opens
	useEffect(() => {
		if (isOpen && showSearch && searchInputRef.current) {
			setTimeout(() => searchInputRef.current.focus(), 50);
		}
	}, [isOpen, showSearch]);

	// Handle keyboard navigation
	const handleKeyDown = (e) => {
		if (disabled) return;

		switch (e.key) {
			case 'Enter':
			case ' ':
				if (!isOpen) {
					e.preventDefault();
					setIsOpen(true);
				} else {
					e.preventDefault();
					selectOption(filteredOptions[highlightedIndex]);
				}
				break;

			case 'Escape':
				e.preventDefault();
				setIsOpen(false);
				setSearchTerm('');
				break;

			case 'ArrowDown':
				e.preventDefault();
				if (!isOpen) {
					setIsOpen(true);
				} else {
					setHighlightedIndex(prev =>
						prev < filteredOptions.length - 1 ? prev + 1 : 0
					);
				}
				break;

			case 'ArrowUp':
				e.preventDefault();
				setHighlightedIndex(prev =>
					prev > 0 ? prev - 1 : filteredOptions.length - 1
				);
				break;

			case 'Tab':
				setIsOpen(false);
				setSearchTerm('');
				break;

			default:
				if (showSearch && !isOpen && e.key.length === 1) {
					setIsOpen(true);
					setSearchTerm(e.key);
				}
		}
	};

	const selectOption = (option) => {
		if (option) {
			onChange?.(option.value);
			setIsOpen(false);
			setSearchTerm('');
			setHighlightedIndex(0);
		}
	};

	const selectId = `select-${name}`;
	const listId = `list-${name}`;

	return (
		<div ref={containerRef} className={`flex flex-col gap-2 ${className}`}>
			{/* Label */}
			{label && (
				<label htmlFor={selectId} className="text-sm font-medium text-gray-700 flex items-center gap-1">
					{label}
					{required && <span className="text-red-500">*</span>}
				</label>
			)}

			{/* Dropdown Button */}
			<button
				id={selectId}
				type="button"
				onClick={() => !disabled && setIsOpen(!isOpen)}
				onKeyDown={handleKeyDown}
				disabled={disabled}
				aria-haspopup="listbox"
				aria-expanded={isOpen}
				aria-controls={listId}
				aria-invalid={!!error}
				className={`
					w-full px-3 py-2 text-left rounded-md border-2 transition-all
					bg-white flex items-center justify-between
					disabled:opacity-50 disabled:cursor-not-allowed
					focus:outline-none focus:ring-2 focus:ring-offset-0
					${
						error
							? 'border-red-500 focus:border-red-600 focus:ring-red-200'
							: isOpen
							? 'border-blue-500 focus:border-blue-600 focus:ring-blue-200'
							: 'border-gray-300 focus:border-blue-500 focus:ring-blue-100'
					}
				`}
			>
				<span className={selectedOption ? 'text-gray-900 font-normal' : 'text-gray-500'}>
					{selectedLabel}
				</span>
				<ChevronDown
					size={18}
					className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
				/>
			</button>

			{/* Dropdown Menu */}
			{isOpen && (
				<div className="relative z-50">
					<div className="absolute top-0 left-0 right-0 mt-2 bg-white border border-gray-200 rounded-md shadow-lg">
						{/* Search Input */}
						{showSearch && (
							<div className="p-2 border-b border-gray-100">
								<div className="relative">
									<Search size={16} className="absolute left-2 top-2.5 text-gray-400" />
									<input
										ref={searchInputRef}
										type="text"
										placeholder="Search..."
										value={searchTerm}
										onChange={(e) => {
											setSearchTerm(e.target.value);
											setHighlightedIndex(0);
										}}
										onKeyDown={handleKeyDown}
										className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
										aria-label="Search options"
									/>
								</div>
							</div>
						)}

						{/* Options List */}
						<ul
							id={listId}
							role="listbox"
							className="max-h-60 overflow-y-auto py-1"
						>
							{filteredOptions.length > 0 ? (
								filteredOptions.map((option, index) => (
									<li
										key={option.value}
										role="option"
										aria-selected={value === option.value}
										onClick={() => selectOption(option)}
										onMouseEnter={() => setHighlightedIndex(index)}
										className={`
											px-3 py-2 cursor-pointer text-sm transition-colors
											${
												index === highlightedIndex
													? 'bg-blue-100 text-blue-900'
													: value === option.value
													? 'bg-blue-50 text-blue-900 font-medium'
													: 'text-gray-900 hover:bg-gray-50'
											}
										`}
									>
										{option.label}
									</li>
								))
							) : (
								<li className="px-3 py-2 text-sm text-gray-500 text-center">
									No options found
								</li>
							)}
						</ul>
					</div>
				</div>
			)}

			{/* Error Message */}
			{error && (
				<p className="text-sm text-red-600 font-medium flex items-center gap-1">
					<AlertCircle size={14} />
					{error}
				</p>
			)}
		</div>
	);
};

export default SelectDropdown;
