import React from 'react';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import RemittancesPage from '@/components/RemittancesPage';

const traverse = traverseModule.default || traverseModule;
const business = vi.hoisted(() => ({ visualSettings: {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => business }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  return { motion: new Proxy({}, { get: (_, tag) => React.forwardRef(function Motion({ initial, animate, transition, whileHover, whileTap, ...props }, ref) {
    return React.createElement(tag, { ...props, ref });
  }) }) };
});
afterEach(cleanup);

const files = ['RemittancesPage', 'SendRemittancePage', 'MyRemittancesPage'];
describe('remittance visual-settings wiring', () => {
  it.each(files)('%s sends style objects to style attributes, never className', (name) => {
    const source = readFileSync(`src/components/${name}.jsx`, 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    let count = 0;
    traverse(ast, { CallExpression(path) {
      if (!['getHeadingStyle', 'getPrimaryButtonStyle'].includes(path.node.callee.name)) return;
      count += 1;
      expect(path.node.arguments[0]?.name).toBe('visualSettings');
      expect(path.findParent(parent => parent.isJSXAttribute())?.node.name.name).toBe('style');
    } });
    expect(count).toBeGreaterThan(0);
    expect(source).toMatch(/\{[^}]*visualSettings[^}]*\}\s*=\s*useBusiness\(\)/);
  });

  it.each([
    { activeTheme: 'papuenvios', headingColor: '#123456', buttonBgColor: '#654321', buttonTextColor: '#ffeecc' },
    { activeTheme: 'papuenvios', primaryColor: '#113355', secondaryColor: '#7799bb', useHeadingGradient: true, useButtonGradient: true, gradientDirection: 45 },
  ])('renders configured heading and CTA styles: %j', (settings) => {
    business.visualSettings = settings;
    const { container } = render(<RemittancesPage onNavigate={vi.fn()} />);
    const heading = screen.getByRole('heading', { level: 1 });
    const buttons = screen.getAllByRole('button', { name: 'remittances.send' });
    if (settings.useHeadingGradient) {
      expect(heading.style.backgroundImage).toContain('linear-gradient(45deg');
      buttons.forEach(button => expect(button.style.background).toContain('linear-gradient(45deg'));
    } else {
      expect(heading).toHaveStyle({ color: settings.headingColor });
      buttons.forEach(button => expect(button).toHaveStyle({ background: settings.buttonBgColor, color: settings.buttonTextColor }));
    }
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it.each(files)('%s uses themed action chrome without underlining non-links', (name) => {
    const source = readFileSync(`src/components/${name}.jsx`, 'utf8');
    expect(source).toContain('bg-theme-accent');
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    traverse(ast, { JSXOpeningElement(path) {
      const className = path.node.attributes.find(attribute => attribute.name?.name === 'className');
      if (className?.value?.value?.includes('text-theme-link')) expect(path.node.name.name).toBe('a');
    } });
    expect(source).not.toMatch(/focus:(?:ring|border)-blue-500/);
  });
});
