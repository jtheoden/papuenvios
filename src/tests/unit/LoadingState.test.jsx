import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key })
}));

import LoadingState, { SkeletonBox, SHOW_DELAY_MS, MIN_VISIBLE_MS } from '@/components/ui/LoadingState';

const skeleton = <SkeletonBox className="h-10" />;
const ui = (loading) => (
  <LoadingState loading={loading} skeleton={skeleton}>
    <p>content</p>
  </LoadingState>
);

const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

describe('LoadingState', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('uses a short show delay and a minimum visible time', () => {
    expect(SHOW_DELAY_MS).toBe(300);
    expect(MIN_VISIBLE_MS).toBe(400);
  });

  it('renders the content right away when it is not loading at mount', () => {
    render(ui(false));
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reserves the skeleton invisibly before the delay, then shows it with the label', () => {
    render(ui(true));
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('data-state', 'waiting');
    expect(status).toHaveClass('opacity-0');
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();

    advance(SHOW_DELAY_MS);
    expect(status).toHaveAttribute('data-state', 'visible');
    expect(status).toHaveClass('opacity-100');
    expect(screen.getByText('common.loading')).toBeVisible();
  });

  it('shows the content without any skeleton flash on a fast load', () => {
    const { rerender } = render(ui(true));
    advance(SHOW_DELAY_MS - 50);
    rerender(ui(false));
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('content').parentElement).not.toHaveClass('motion-safe:animate-fade-in');
  });

  it('keeps a shown skeleton for the minimum time, then fades the content in', () => {
    const { rerender } = render(ui(true));
    advance(SHOW_DELAY_MS + 50);
    rerender(ui(false));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();

    advance(MIN_VISIBLE_MS - 60);
    expect(screen.getByRole('status')).toBeInTheDocument();
    advance(20);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('content').parentElement).toHaveClass('motion-safe:animate-fade-in');
  });

  it('shows the content immediately once the skeleton was already visible long enough', () => {
    const { rerender } = render(ui(true));
    advance(SHOW_DELAY_MS + MIN_VISIBLE_MS + 100);
    rerender(ui(false));
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('only animates under prefers-reduced-motion: no-preference (motion-safe classes)', () => {
    render(ui(true));
    const box = screen.getByRole('status').querySelector('[data-skeleton]');
    expect(box.className).toContain('motion-safe:animate-skeleton');
    expect(box.className.split(' ')).not.toContain('animate-skeleton');
    expect(box).toHaveClass('bg-muted');
    expect(screen.getByRole('status').className).toContain('motion-safe:transition-opacity');
  });

  it('pauses the skeleton pulse while the tab is hidden', () => {
    render(ui(true));
    const status = screen.getByRole('status');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(status).toHaveAttribute('data-paused');

    visibility.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(status).not.toHaveAttribute('data-paused');
  });

  it('uses a custom label when given one', () => {
    render(<LoadingState loading skeleton={skeleton} label="Loading offers">x</LoadingState>);
    advance(SHOW_DELAY_MS);
    expect(screen.getByText('Loading offers')).toBeInTheDocument();
  });
});
