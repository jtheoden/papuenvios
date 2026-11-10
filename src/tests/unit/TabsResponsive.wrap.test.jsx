import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// RB-04: the md+ tab strip of the dashboard (7 tabs for super_admin) overflowed the page at 768px.
// Layout is measured in Playwright (responsive-layout.spec.js); here we pin the contract jsdom can see:
// the strip must be allowed to wrap and the labels must not wrap inside a tab.

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {} }) }));

import TabsResponsive from '@/components/TabsResponsive';

const tabs = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, label: `tab.${i}`, icon: null, content: <p>content {i}</p> }));

describe('TabsResponsive desktop strip', () => {
  it('wraps onto a second row instead of overflowing, with one-line labels', () => {
    const { container } = render(<TabsResponsive tabs={tabs} activeTab="t0" onTabChange={() => {}} />);

    const strip = container.querySelector('div.md\\:flex');
    expect(strip).not.toBeNull();
    expect(strip.className).toContain('flex-wrap');
    const buttons = strip.querySelectorAll('button');
    expect(buttons).toHaveLength(7);
    buttons.forEach((button) => expect(button.className).toContain('whitespace-nowrap'));
  });
});
