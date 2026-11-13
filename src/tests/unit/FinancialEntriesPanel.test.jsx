import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const svc = vi.hoisted(() => ({ addFinancialEntry: vi.fn(), voidFinancialEntry: vi.fn() }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/financialEntriesService', () => svc);

import FinancialEntriesPanel from '@/components/admin/FinancialEntriesPanel';

const entries = [
  { id: 'e1', kind: 'expense', amount: '25.50', entry_date: '2026-11-10', category: 'hosting', reason: 'Servidor mensual', voids_entry_id: null },
  { id: 'e2', kind: 'income', amount: '25.50', entry_date: '2026-11-11', category: 'hosting', reason: 'Anulación', voids_entry_id: 'e1' }
];

beforeEach(() => {
  vi.clearAllMocks();
  svc.addFinancialEntry.mockResolvedValue({});
  svc.voidFinancialEntry.mockResolvedValue({});
});

describe('FinancialEntriesPanel date', () => {
  it('defaults the date to the business (New York) day, not the UTC one', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T02:00:00Z')); // 21:00 ET on Nov 12
    try {
      render(<FinancialEntriesPanel entries={[]} onChanged={vi.fn()} />);
      const date = screen.getByLabelText('financialEntries.date');
      expect(date.value).toBe('2026-11-12');
      expect(date.max).toBe('2026-11-12');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FinancialEntriesPanel', () => {
  it('keeps the submit disabled until the form is valid, then records the entry and notifies', async () => {
    const onChanged = vi.fn();
    render(<FinancialEntriesPanel entries={[]} onChanged={onChanged} />);
    const submit = screen.getByRole('button', { name: 'financialEntries.add' });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('financialEntries.amount'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('financialEntries.reason'), { target: { value: 'Compra de insumos de oficina' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(svc.addFinancialEntry).toHaveBeenCalledTimes(1));
    expect(svc.addFinancialEntry.mock.calls[0][0]).toMatchObject({ kind: 'expense', amount: '40', reason: 'Compra de insumos de oficina' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('lists entries and offers to void only an entry that is not a void nor already voided', () => {
    render(<FinancialEntriesPanel entries={entries} onChanged={vi.fn()} />);
    expect(screen.getAllByRole('row').length).toBeGreaterThan(2);
    // e1 is already voided by e2 and e2 is a void: nothing left to void.
    expect(screen.queryByRole('button', { name: 'financialEntries.void' })).toBeNull();
  });

  it('voids an active entry with a reason', async () => {
    const onChanged = vi.fn();
    render(<FinancialEntriesPanel entries={[entries[0]]} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'financialEntries.void' }));
    fireEvent.change(screen.getByLabelText('financialEntries.voidReason'), { target: { value: 'Se cargó dos veces por error' } });
    fireEvent.click(screen.getByRole('button', { name: 'financialEntries.voidConfirm' }));
    await waitFor(() => expect(svc.voidFinancialEntry).toHaveBeenCalledWith('e1', 'Se cargó dos veces por error'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('sends one void request when the confirm button is clicked twice', async () => {
    let release;
    svc.voidFinancialEntry.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    render(<FinancialEntriesPanel entries={[entries[0]]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'financialEntries.void' }));
    fireEvent.change(screen.getByLabelText('financialEntries.voidReason'), { target: { value: 'Se cargó dos veces por error' } });
    const confirm = screen.getByRole('button', { name: 'financialEntries.voidConfirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(svc.voidFinancialEntry).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    release({});
    await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
  });
});
