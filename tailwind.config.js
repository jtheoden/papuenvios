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
				// Look tokens: --t-* in index.css hold RGB channels, so the alpha modifier works (`bg-theme-accent/30`).
				// The colour group is `theme`, so the utilities are `bg-theme-accent`: no clash with the shadcn `accent`.
				// scripts/theme-codemod.mjs moves the old blue/purple classes onto them.
				theme: Object.fromEntries(
					[
						'accent', 'accent-hover', 'on-accent', 'accent-soft', 'accent-soft-2', 'accent-line',
						'link', 'link-strong', 'focus', 'accent-2', 'accent-2-soft', 'accent-2-soft-2',
						'grad-from', 'grad-to', 'page-from', 'page-via', 'page-to',
					].map((token) => [token, `rgb(var(--t-${token}) / <alpha-value>)`])
				),
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
				// Micro-animations: opacity/transform only; timing from the --motion-* tokens (index.css).
				// Use them behind `motion-safe:` so prefers-reduced-motion gets none.
				'skeleton-pulse': {
					'0%, 100%': { opacity: '1' },
					'50%': { opacity: '0.5' },
				},
				'fade-in': {
					from: { opacity: '0' },
					to: { opacity: '1' },
				},
				'enter-up': {
					from: { opacity: '0', transform: 'translateY(8px)' },
					to: { opacity: '1', transform: 'none' },
				},
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				skeleton: 'skeleton-pulse 1.6s ease-in-out infinite',
				'fade-in': 'fade-in var(--motion-duration) var(--motion-ease) both',
				// Stagger: set --stagger-index (capped by the caller) on each item.
				enter: 'enter-up var(--motion-duration-slow) var(--motion-ease) calc(var(--stagger-index, 0) * var(--motion-stagger)) both',
			},
			transitionDuration: {
				motion: 'var(--motion-duration)',
			},
			transitionTimingFunction: {
				motion: 'var(--motion-ease)',
			},
		},
	},
	plugins: [require('tailwindcss-animate')],
};