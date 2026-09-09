import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const ES_STRINGS = {
  'tables.bulkDeleteConfirmTitle': 'Confirmar borrado masivo',
  'tables.bulkDeleteConfirmBody': 'Vas a eliminar permanentemente {count} elemento(s). Esta acción no se puede deshacer.',
  'tables.bulkDeleteConfirmInput': 'Escribí ELIMINAR para confirmar',
  'tables.bulkDeleteConfirmWord': 'ELIMINAR',
  'tables.bulkDeleteConfirmButton': 'Eliminar definitivamente',
  'tables.bulkDeleteCancelButton': 'Cancelar',
  'tables.deleteSelected': 'Eliminar seleccionados',
  'tables.clearSelection': 'Limpiar selección',
  'tables.selectedCount': '{count} seleccionado(s)',
  'tables.bulkDeletePreviewLoading': 'Calculando elementos relacionados...',
  'tables.bulkDeletePreviewError': 'No se pudo calcular el impacto del borrado.',
  'tables.bulkDeletePreviewWillDelete': 'Se eliminará junto con:',
  'tables.bulkDeletePreviewBlockingOrders': '{count} orden(es) bloqueante(s)',
  'tables.bulkDeletePreviewCombos': '{count} combo(s) a desactivar',
  'tables.bulkDeletePreviewInventoryRows': '{count} fila(s) de inventario',
  'tables.bulkDeletePreviewInventoryMovements': '{count} movimiento(s) de inventario',
  'tables.bulkDeletePreviewProducts': '{count} producto(s) asociado(s)',
  'tables.bulkDeletePreviewNoImpact': 'sin elementos relacionados'
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => ES_STRINGS[key] ?? null })
}));

import BulkDeleteBar from '@/components/tables/BulkDeleteBar';

describe('BulkDeleteBar confirmation word', () => {
  it('enables the delete button when the user types the word shown in the placeholder', () => {
    const onConfirmDelete = vi.fn();
    render(
      <BulkDeleteBar
        selectedIds={['p1', 'p2']}
        onClearSelection={vi.fn()}
        onConfirmDelete={onConfirmDelete}
      />
    );

    fireEvent.click(screen.getByText('Eliminar seleccionados'));

    const input = screen.getByPlaceholderText('Escribí ELIMINAR para confirmar');
    fireEvent.change(input, { target: { value: 'ELIMINAR' } });

    const confirmButton = screen.getByText('Eliminar definitivamente');
    expect(confirmButton).not.toBeDisabled();
  });
});

describe('BulkDeleteBar cascade preview', () => {
  it('fetches and shows the cascade impact before the user types anything', async () => {
    const onPreview = vi.fn().mockResolvedValue([
      {
        id: 'p1',
        name: 'Producto 1',
        canDelete: true,
        blockReason: null,
        counts: { blockingOrders: 0, combosToDeactivate: 2, inventoryRows: 3, inventoryMovements: 5 }
      },
      {
        id: 'p2',
        name: 'Producto 2',
        canDelete: false,
        blockReason: 'blocking_orders',
        counts: { blockingOrders: 1, combosToDeactivate: 0, inventoryRows: 1, inventoryMovements: 0 }
      }
    ]);

    render(
      <BulkDeleteBar
        selectedIds={['p1', 'p2']}
        onClearSelection={vi.fn()}
        onConfirmDelete={vi.fn()}
        onPreview={onPreview}
        getItemLabel={(id) => id}
      />
    );

    fireEvent.click(screen.getByText('Eliminar seleccionados'));

    expect(onPreview).toHaveBeenCalledWith(['p1', 'p2']);

    await waitFor(() => {
      expect(screen.getByText(/Producto 1/)).toBeInTheDocument();
    });

    expect(screen.getByText(/2 combo\(s\) a desactivar/)).toBeInTheDocument();
    expect(screen.getByText(/3 fila\(s\) de inventario/)).toBeInTheDocument();
    expect(screen.getByText(/5 movimiento\(s\) de inventario/)).toBeInTheDocument();
    expect(screen.getByText(/Producto 2/)).toBeInTheDocument();
  });

  it('does not fetch or render a preview section when onPreview is not provided', () => {
    render(
      <BulkDeleteBar
        selectedIds={['p1']}
        onClearSelection={vi.fn()}
        onConfirmDelete={vi.fn()}
        getItemLabel={(id) => id}
      />
    );

    fireEvent.click(screen.getByText('Eliminar seleccionados'));

    expect(screen.queryByText('Calculando elementos relacionados...')).not.toBeInTheDocument();
  });
});
