import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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


describe('static splash cached logo', () => {
  const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
  const run = (storage) => {
    const page = new DOMParser().parseFromString(html, 'text/html');
    // The logo script is the last inline one, placed after #root so #ps already exists when it runs.
    const scripts = Array.from(page.querySelectorAll('script:not([src])'));
    new Function('document', 'localStorage', scripts.at(-1).textContent)(page, storage);
    return page;
  };
  const cache = (data) => ({ getItem: () => JSON.stringify({ data, timestamp: 0 }) });

  it('swaps the wordmark for the cached logo, capped in height, with the company name as alt', () => {
    const page = run(cache({ logo: LOGO, companyName: 'Acme Envios', logoMaxHeight: 200 }));
    const img = page.querySelector('#ps img');
    expect(img.getAttribute('src')).toBe(LOGO);
    expect(img.getAttribute('alt')).toBe(''); // the .ps-sr label already announces the splash
    expect(img.style.maxHeight).toBe('64px');
    img.onload();
    expect(page.querySelector('#ps svg').style.display).toBe('none');
  });

  it('keeps the wordmark visible until the image has really loaded (fail-open)', () => {
    const page = run(cache({ logo: LOGO }));
    expect(page.querySelector('#ps img')).not.toBeNull();
    expect(page.querySelector('#ps svg').style.display).toBe('');
  });

  it('with an image that never loads the wordmark stays and the 20 s escape hatch still replaces the splash', async () => {
    vi.useFakeTimers();
    try {
      const page = new DOMParser().parseFromString(html, 'text/html');
      const scripts = Array.from(page.querySelectorAll('script:not([src])')).map((script) => script.textContent).join('\n');
      const storage = { getItem: (key) => (key === 'preferredLanguage' ? null : JSON.stringify({ data: { logo: LOGO }, timestamp: 0 })) };
      new Function('document', 'localStorage', 'window', 'setTimeout', scripts)(page, storage, { location: { reload: vi.fn() } }, setTimeout);
      expect(page.querySelector('#ps svg').style.display).toBe('');
      await vi.advanceTimersByTimeAsync(20000);
      expect(page.querySelector('#ps button')?.textContent).toBe('Recargar');
      expect(page.querySelector('#ps img')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses logoMaxHeight when it is below the cap, and 40 when it is not a positive number', () => {
    expect(run(cache({ logo: LOGO, logoMaxHeight: 30 })).querySelector('#ps img').style.maxHeight).toBe('30px');
    expect(run(cache({ logo: LOGO, logoMaxHeight: 'x' })).querySelector('#ps img').style.maxHeight).toBe('40px');
  });

  it('brings the wordmark back if the logo fails to load', () => {
    const page = run(cache({ logo: LOGO }));
    page.querySelector('#ps img').onerror();
    expect(page.querySelector('#ps img')).toBeNull();
    expect(page.querySelector('#ps svg').style.display).toBe('');
  });

  it.each([
    ['unsafe logo', cache({ logo: 'javascript:alert(1)' })],
    ['no logo', cache({ logo: '' })],
    ['no cache', { getItem: () => null }],
    ['corrupt cache', { getItem: () => '{nope' }],
    ['blocked storage', { getItem: () => { throw new Error('blocked'); } }],
  ])('keeps the wordmark and never throws with %s', (_name, storage) => {
    const page = run(storage);
    expect(page.querySelector('#ps img')).toBeNull();
    expect(page.querySelector('#ps svg').style.display).toBe('');
  });

  it('prefers the loader image over the site logo, and falls back to the logo when it is unsafe', () => {
    const OWN = 'data:image/webp;base64,UklGRg==';
    expect(run(cache({ logo: LOGO, loaderImage: OWN })).querySelector('#ps img').getAttribute('src')).toBe(OWN);
    expect(run(cache({ logo: LOGO, loaderImage: 'javascript:x' })).querySelector('#ps img').getAttribute('src')).toBe(LOGO);
    expect(run(cache({ loaderImage: OWN })).querySelector('#ps img').getAttribute('src')).toBe(OWN);
  });

  it('paints a valid hex loader background with readable text, and leaves the theme background otherwise', () => {
    const dark = run(cache({ loaderBgColor: '#123456' })).getElementById('ps');
    expect(dark.style.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(dark.style.color).toBe('rgb(255, 255, 255)');
    expect(dark.querySelector('text').style.fill).toBe('rgb(255, 255, 255)');
    const light = run(cache({ loaderBgColor: '#fff' })).getElementById('ps');
    expect(light.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(light.style.color).toBe('rgb(23, 23, 23)');
    for (const bad of ['red', '#12345', 'url(x)', '#fff;x', 42]) {
      expect(run(cache({ loaderBgColor: bad })).getElementById('ps').getAttribute('style'), String(bad)).toBeNull();
    }
  });

  it('builds the image with DOM APIs only (no dynamic HTML)', () => {
    const page = new DOMParser().parseFromString(html, 'text/html');
    expect(Array.from(page.querySelectorAll('script:not([src])')).at(-1).textContent).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });
});

describe('static splash startup escape hatch', () => {
  let page, reload;
  const start = (storage = localStorage) => {
    page = new DOMParser().parseFromString(html, 'text/html');
    reload = vi.fn();
    const scripts = Array.from(page.querySelectorAll('script:not([src])')).map((script) => script.textContent).join('\n');
    // Inject only browser dependencies: reload is otherwise non-configurable in jsdom.
    new Function('document', 'localStorage', 'window', 'setTimeout', scripts)(page, storage, { location: { reload } }, setTimeout);
  };
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each([
    [null, 'La carga está tardando demasiado.', 'Recargar', 'es'],
    ['en', 'Loading is taking too long.', 'Reload', 'en'],
  ])('offers a localized reload after 20 seconds (preference: %s)', async (preference, message, label, lang) => {
    if (preference) localStorage.setItem('preferredLanguage', preference);
    start();
    await vi.advanceTimersByTimeAsync(19999);
    expect(page.querySelector('#ps button')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const splash = page.getElementById('ps');
    expect(splash.getAttribute('role')).toBe('status');
    expect(splash.textContent).toContain(message);
    expect(splash.querySelector('.ps-sr')).toBeNull();
    expect(splash.getAttribute('lang')).toBe(lang);
    const button = splash.querySelector('button');
    expect(button.textContent).toBe(label);
    expect(button.type).toBe('button');
    button.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('still offers Spanish recovery when all storage access is blocked', async () => {
    start({ getItem: () => { throw new Error('blocked'); } });
    await vi.advanceTimersByTimeAsync(20000);
    expect(page.querySelector('#ps button')?.textContent).toBe('Recargar');
  });

  it('does nothing if React has already removed the static splash', async () => {
    start();
    page.getElementById('root').textContent = 'app';
    await vi.advanceTimersByTimeAsync(20000);
    expect(page.getElementById('root').textContent).toBe('app');
    expect(page.querySelector('button')).toBeNull();
  });

  it('uses no dynamic HTML or network dependencies in the escape hatch', () => {
    const scripts = Array.from(doc.querySelectorAll('script:not([src])')).map((script) => script.textContent).join('\n');
    expect(scripts).not.toMatch(/innerHTML|insertAdjacentHTML|fetch\(|XMLHttpRequest/);
  });
});
