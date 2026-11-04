/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ['class'],
	content: [
		'./pages/**/*.{js,jsx}',
		'./components/**/*.{js,jsx}',
		'./app/**/*.{js,jsx}',
		'./src/**/*.{js,jsx}',
	],
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px',
			},
		},
		extend: {
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))',
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))',
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))',
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))',
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))',
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))',
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))',
				},
				// Brand colours come from the Visual settings (applyVisualSettingsToDOM sets the
				// --brand-* variables); the HEX is only the fallback while they are unset.
				// Limit: `var()` colours do not support the alpha modifier, so `bg-brand/50` emits
				// nothing. Use the solid class, or an arbitrary value such as `bg-[#FFA500]/50`.
				brand: {
					DEFAULT: 'var(--brand-button-bg, #FFA500)',
					hover: 'var(--brand-button-hover-bg, #E59400)',
					foreground: 'var(--brand-button-text, #171717)',
					ink: 'var(--brand-ink, #171717)',
					muted: 'var(--brand-muted-text, #605B52)',
					soft: 'var(--brand-soft-accent, #FFF1CC)',
					border: 'var(--brand-border, #E8E0D2)',
					focus: 'var(--brand-focus-ring, #171717)',
					badge: 'var(--brand-cart-badge-bg, #FFA500)',
					'badge-foreground': 'var(--brand-cart-badge-text, #171717)',
					dot: 'var(--brand-dot-active, #FFA500)',
				},
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)',
			},
			keyframes: {
				'accordion-down': {
					from: { height: 0 },
					to: { height: 'var(--radix-accordion-content-height)' },
				},
				'accordion-up': {
					from: { height: 'var(--radix-accordion-content-height)' },
					to: { height: 0 },
				},
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
			},
		},
	},
	plugins: [require('tailwindcss-animate')],
};