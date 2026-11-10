import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitFor } from '@testing-library/react';

// Running the real entry point: the static splash from index.html stays painted until React's first commit
// (no blank frame in between), then the app replaces it.

vi.mock('@/App', () => ({ default: () => <p>app</p> }));

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const splash = new DOMParser().parseFromString(html, 'text/html').getElementById('root').innerHTML;

describe('src/main.jsx', () => {
  it('keeps the static splash until React commits, then replaces it', async () => {
    document.body.innerHTML = `<div id="root">${splash}</div>`;
    const root = document.getElementById('root');
    await import('@/main.jsx');
    expect(root.querySelector('#ps')).not.toBeNull();
    await waitFor(() => expect(root.innerHTML).toBe('<p>app</p>'));
  });
});
