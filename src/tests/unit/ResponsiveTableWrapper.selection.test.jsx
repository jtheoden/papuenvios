import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {} })
}));

import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';

const columns = [{ key: 'name', label: 'Name' }];
const data = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' }
];

describe('ResponsiveTableWrapper selection', () => {
  it('does not render checkboxes when selectable is false', () => {
    render(<ResponsiveTableWrapper data={data} columns={columns} />);
    expect(screen.queryAllByRole('checkbox').length).toBe(0);
  });

  // jsdom has no real CSS layout engine — the mobile/tablet/desktop views all
  // render into the DOM simultaneously (their "hidden sm:block" etc. classes
  // are never actually applied as layout), so queries must be scoped to the
  // desktop <table> specifically rather than screen.getAllByRole globally.

  it('toggling a row checkbox reports the updated selection to the parent', () => {
    const onSelectionChange = vi.fn();
    render(
      <ResponsiveTableWrapper
        data={data}
        columns={columns}
        selectable
        selectedIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    const table = screen.getByRole('table');
    // First checkbox in the table is "select all", second is row "a"
    const checkboxes = within(table).getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    expect(onSelectionChange).toHaveBeenCalledWith(['a']);
  });

  it('select-all toggles every row on the current page', () => {
    const onSelectionChange = vi.fn();
    render(
      <ResponsiveTableWrapper
        data={data}
        columns={columns}
        selectable
        selectedIds={[]}
        onSelectionChange={onSelectionChange}
      />
    );

    const table = screen.getByRole('table');
    const checkboxes = within(table).getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    expect(onSelectionChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('reflects an already-selected id as checked', () => {
    render(
      <ResponsiveTableWrapper
        data={data}
        columns={columns}
        selectable
        selectedIds={['a']}
        onSelectionChange={() => {}}
      />
    );

    const table = screen.getByRole('table');
    const checkboxes = within(table).getAllByRole('checkbox');
    expect(checkboxes[1].checked).toBe(true);
  });
});
