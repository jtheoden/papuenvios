import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import React from 'react';
import { Loader } from 'lucide-react';

const buttonVariants = cva(
	'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed',
	{
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 shadow-sm hover:shadow-md',
				destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-95 shadow-sm hover:shadow-md',
				outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground active:scale-95',
				secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-95 shadow-sm hover:shadow-md',
				ghost: 'hover:bg-accent hover:text-accent-foreground active:scale-95',
				link: 'text-primary underline-offset-4 hover:underline',
			},
			size: {
				default: 'h-10 px-4 py-2',
				sm: 'h-9 px-3',
				lg: 'h-11 px-8',
				xl: 'h-12 px-6 text-base',
				icon: 'h-10 w-10',
				'icon-sm': 'h-8 w-8',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

/**
 * Button Component
 * Enhanced with loading state, disabled styling, and better focus states
 *
 * @prop {string} variant - Button variant (default, destructive, outline, secondary, ghost, link)
 * @prop {string} size - Button size (default, sm, lg, xl, icon, icon-sm)
 * @prop {boolean} loading - Show loading spinner and disable interaction
 * @prop {boolean} disabled - Disable button
 * @prop {React.ReactNode} children - Button content
 * @prop {function} onClick - Click handler
 * @prop {string} className - Additional CSS classes
 * @prop {boolean} asChild - Use Slot for composition
 */
const Button = React.forwardRef(({
	className,
	variant,
	size,
	asChild = false,
	loading = false,
	disabled = false,
	children,
	...props
}, ref) => {
	const Comp = asChild ? Slot : 'button';
	const isDisabled = disabled || loading;

	return (
		<Comp
			className={cn(buttonVariants({ variant, size, className }))}
			disabled={isDisabled}
			aria-busy={loading}
			ref={ref}
			{...props}
		>
			{loading ? (
				<>
					<Loader className="mr-2 h-4 w-4 animate-spin" />
					<span className="opacity-70">Loading...</span>
				</>
			) : (
				children
			)}
		</Comp>
	);
});
Button.displayName = 'Button';

export { Button, buttonVariants };