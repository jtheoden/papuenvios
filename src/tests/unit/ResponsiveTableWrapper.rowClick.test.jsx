import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {} })
}));

import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';

const columns = [{ key: 'name', label: 'Name' }];
const modalColumns = [{ key: 'name', label: 'Name' }];
const data = [{ id: 'a', name: 'Alpha' }];

// jsdom renders mobile/tablet/desktop views simultaneously; the first match is the mobile card.
const clickMobileRow = () => fireEvent.click(screen.getAllByText('Alpha')[0]);

describe('ResponsiveTableWrapper row click', () => {
  it('opens the generic detail modal when onRowClick is not provided', () => {
    render(
      <ResponsiveTableWrapper data={data} columns={columns} modalTitle="GENERIC_MODAL" modalColumns={modalColumns} />
    );
    expect(screen.queryByText('GENERIC_MODAL')).toBeNull();
    clickMobileRow();
    expect(screen.getByText('GENERIC_MODAL')).toBeInTheDocument();
  });

  it('delegates to onRowClick and does NOT open the generic modal when provided', () => {
    const onRowClick = vi.fn();
    render(
      <ResponsiveTableWrapper
        data={data}
        columns={columns}
        modalTitle="GENERIC_MODAL"
        modalColumns={modalColumns}
        onRowClick={onRowClick}
      />
    );
    clickMobileRow();
    expect(onRowClick).toHaveBeenCalledWith(data[0]);
    expect(screen.queryByText('GENERIC_MODAL')).toBeNull();
  });
});
