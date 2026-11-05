import React from 'react';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot } from 'react-dom/client';
import { act } from '@testing-library/react';
import { buildLoadingTheme } from '@/lib/loadingTheme';

// index.html paints a static splash inside #root before any JS loads; React replaces it on its first commit.

const read = (relative) => readFileSync(resolve(process.cwd(), relative), 'utf8');
const html = read('index.html');
const doc = new DOMParser().parseFromString(html, 'text/html');
const root = doc.getElementById('root');

describe('static splash in index.html', () => {
  it('has content inside #root', () => {
    expect(root.children.length).toBeGreaterThan(0);
    expect(root.querySelector('svg')).not.toBeNull();
  });

  it('keeps the inline wordmark SVG at 4 KB or less', () => {
    expect(new TextEncoder().encode(root.querySelector('svg').outerHTML).length).toBeLessThanOrEqual(4096);
  });

  it('makes no network requests (no src/href/url() in the splash or its styles)', () => {
    expect(root.querySelector('[src], [href], img, link, script')).toBeNull();
    expect(root.innerHTML).not.toMatch(/url\(|https?:\/\//);
    const styles = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent).join('\n');
    expect(styles).not.toMatch(/url\(|@import/);
  });

  it('uses the ivory background and disables the animation for reduced motion', () => {
    const styles = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent).join('\n');
    expect(styles).toMatch(/#FAF7F0/i);
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('follows data-theme: classic gets the classic loading screen background, the brand look keeps ivory', () => {
    const css = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent).join('\n').replace(/\s+/g, '');
    const classicBg = buildLoadingTheme({ useGradient: true })['--ld-bg'].replace(/\s+/g, '');
    const rule = css.match(/\[data-theme="classic"\]#ps\{([^}]*)\}/);
    expect(rule?.[1]).toContain(`background:${classicBg}`);
    // The charcoal wordmark is too dark on the blue/violet gradient: white there (>= 5:1 on both stops).
    expect(css).toMatch(/\[data-theme="classic"\]#pstext\{fill:#fff\}/i);
    // No data-theme (no cache yet) or papuenvios: the base rule, ivory.
    expect(css).toMatch(/#ps\{[^}]*background:#FAF7F0/i);
    expect(css).not.toMatch(/\[data-theme="papuenvios"\]#ps\{[^}]*background:(?!#FAF7F0)/i);
  });

  it('declares Spanish (the default language) on <html> and no stale placeholder note', () => {
    expect(doc.documentElement.getAttribute('lang')).toBe('es');
    expect(html).not.toMatch(/Placeholder wordmark/i);
  });

  it('tells users without JavaScript that the app needs it', () => {
    expect(root.querySelector('noscript')?.textContent).toMatch(/JavaScript/);
  });

  it('is announced to assistive tech as a loading status', () => {
    expect(root.querySelector('[role="status"]')).not.toBeNull();
  });
});

describe('React takes over #root', () => {
  it('createRoot replaces the pre-rendered splash on its first commit', async () => {
    const container = document.createElement('div');
    container.innerHTML = root.innerHTML;
    document.body.appendChild(container);
    const reactRoot = createRoot(container);
    await act(async () => reactRoot.render(<p>app</p>));
    expect(container.innerHTML).toBe('<p>app</p>');
    reactRoot.unmount();
    container.remove();
  });
});
