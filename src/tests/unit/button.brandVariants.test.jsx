import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button, buttonVariants } from '@/components/ui/button';
import tailwindConfig from '../../../tailwind.config.js';
import { BRAND_PALETTE } from '@/lib/brandPalette';

const classesOf = (variant) => {
  render(<Button variant={variant}>x</Button>);
  return screen.getByRole('button').className.split(/\s+/);
};

describe('Button brand variants', () => {
  it('keeps the default variant byte-identical', () => {
    expect(buttonVariants()).toBe(
      'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 shadow-sm hover:shadow-md h-10 px-4 py-2'
    );
  });

  it('brand: filled, readable text, hover by class, black ring, no motion when reduced', () => {
    const c = classesOf('brand');
    expect(c).toEqual(expect.arrayContaining([
      'bg-brand', 'text-brand-foreground', 'hover:bg-brand-hover',
      'focus-visible:ring-brand-focus', 'motion-reduce:transition-none',
    ]));
    expect(c).not.toContain('bg-primary');
    expect(c).not.toContain('focus-visible:ring-ring');
  });

  it('brand-outline: soft border, ink text, soft hover, black ring', () => {
    const c = classesOf('brand-outline');
    expect(c).toEqual(expect.arrayContaining([
      'border', 'border-brand-border', 'text-brand-ink', 'hover:bg-brand-soft',
      'focus-visible:ring-brand-focus', 'motion-reduce:transition-none',
    ]));
    expect(c).not.toContain('focus-visible:ring-ring');
  });

  it('does not use inline styles for the hover state', () => {
    render(<Button variant="brand">x</Button>);
    expect(screen.getByRole('button').getAttribute('style')).toBeNull();
  });
});

describe('tailwind brand colours', () => {
  const brand = tailwindConfig.theme.extend.colors.brand;

  it('maps to CSS variables with a brand HEX fallback', () => {
    expect(brand.DEFAULT).toBe('var(--brand-button-bg, #FFA500)');
    expect(brand.hover).toBe('var(--brand-button-hover-bg, #E59400)');
    expect(brand.foreground).toBe('var(--brand-button-text, #171717)');
    expect(brand.focus).toBe('var(--brand-focus-ring, #171717)');
    expect(brand.border).toBe('var(--brand-border, #E8E0D2)');
  });

  it('only falls back to official palette values', () => {
    const palette = Object.values(BRAND_PALETTE);
    for (const [name, value] of Object.entries(brand)) {
      const fallback = value.match(/^var\(--brand-[a-z-]+, (#[0-9A-F]{6})\)$/)?.[1];
      expect(palette, name).toContain(fallback);
    }
  });

  it('leaves the shadcn globals untouched', () => {
    expect(tailwindConfig.theme.extend.colors.primary.DEFAULT).toBe('hsl(var(--primary))');
    expect(tailwindConfig.theme.extend.colors.ring).toBe('hsl(var(--ring))');
  });
});
