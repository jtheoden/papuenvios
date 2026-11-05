import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {} })
}));

import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';

const columns = [{ key: 'name', label: 'Name' }];
const rows = [{ id: 'a', name: 'Alpha' }];
const table = (props) => <ResponsiveTableWrapper columns={columns} {...props} />;

describe('ResponsiveTableWrapper loading state', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a busy skeleton with the loading label on the first load, never "no data"', () => {
    render(table({ data: [], isLoading: true }));
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('tables.noData')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('shows the rows once loaded', () => {
    const { rerender } = render(table({ data: [], isLoading: true }));
    rerender(table({ data: rows, isLoading: false }));
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the current rows visible while a refresh is loading', () => {
    render(table({ data: rows, isLoading: true }));
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows "no data" only after an empty load (also the error path: callers stop loading)', () => {
    const { rerender } = render(table({ data: [], isLoading: true }));
    rerender(table({ data: [], isLoading: false }));
    expect(screen.getByText('tables.noData')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('marks the visible rows busy and dimmed (opacity only, motion-safe) during a refresh, and clears it after', () => {
    const { rerender } = render(table({ data: rows, isLoading: true }));
    const region = screen.getAllByText('Alpha')[0].closest('[aria-busy]');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveClass('opacity-60');
    expect(region.className).toContain('motion-safe:transition-opacity');

    rerender(table({ data: rows, isLoading: false }));
    expect(screen.getAllByText('Alpha')[0].closest('[aria-busy]')).toBeNull();
  });
});
