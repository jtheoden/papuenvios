import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import ES from '@/translations/ES.json';

const translate = (key, params = {}) => {
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), ES);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: 'es' }),
}));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => toastMock(...a) }));

const hook = {
  methods: null,
  loading: false,
  error: null,
  refresh: vi.fn(),
  toggle: vi.fn(),
};
vi.mock('@/hooks/usePaymentMethods', () => ({
  usePaymentMethods: () => ({
    ...hook,
    isMethodEnabled: () => true,
    isFlowBlocked: () => false,
  }),
}));

const counts = { orders: vi.fn(), remittances: vi.fn() };
vi.mock('@/lib/orderService', () => ({ getPendingOrdersCount: (...a) => counts.orders(...a) }));
vi.mock('@/lib/remittanceService', () => ({ getPendingRemittancesCount: (...a) => counts.remittances(...a) }));

import PaymentMethodsStatusCard from '@/components/settings/PaymentMethodsStatusCard';
import { PaymentMethodError, PAYMENT_METHOD_ERROR } from '@/lib/paymentMethodsService';

const ZELLE = {
  code: 'zelle',
  available: true,
  enabled_for_orders: true,
  enabled_for_remittances: true,
  disabled_reason: null,
  updated_at: '2026-10-14T16:00:00Z',
  updated_by: null,
  updated_by_name: null,
};
const BIZUM = {
  code: 'bizum',
  available: false,
  enabled_for_orders: false,
  enabled_for_remittances: false,
  disabled_reason: null,
  updated_at: '2026-10-14T10:00:00Z',
  updated_by: null,
  updated_by_name: null,
};

const switchByName = (name) => screen.getByRole('switch', { name });

beforeEach(() => {
  toastMock.mockReset();
  hook.methods = [BIZUM, ZELLE];
  hook.loading = false;
  hook.error = null;
  hook.refresh = vi.fn().mockResolvedValue([BIZUM, ZELLE]);
  hook.toggle = vi.fn().mockResolvedValue({});
  counts.orders = vi.fn().mockResolvedValue(1);
  counts.remittances = vi.fn().mockResolvedValue(16);
});

describe('PaymentMethodsStatusCard', () => {
  it('renders one labelled switch per method and flow', () => {
    render(<PaymentMethodsStatusCard />);

    expect(screen.getByRole('heading', { name: 'Métodos de pago' })).toBeInTheDocument();
    expect(switchByName('Zelle para Pedidos')).toHaveAttribute('aria-checked', 'true');
    expect(switchByName('Zelle para Remesas')).toHaveAttribute('aria-checked', 'true');
  });

  it('shows Bizum as coming soon with disabled switches', () => {
    render(<PaymentMethodsStatusCard />);

    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    const bizumOrders = switchByName('Bizum para Pedidos');
    expect(bizumOrders).toBeDisabled();
    expect(bizumOrders).toHaveAttribute('aria-checked', 'false');
    expect(switchByName('Bizum para Remesas')).toBeDisabled();
  });

  it('shows a loading state and an error state with retry', () => {
    hook.methods = null;
    hook.loading = true;
    const { rerender } = render(<PaymentMethodsStatusCard />);
    expect(screen.getByText('Cargando métodos de pago…')).toBeInTheDocument();

    hook.loading = false;
    hook.error = new Error('boom');
    rerender(<PaymentMethodsStatusCard />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el estado de los métodos de pago.');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(hook.refresh).toHaveBeenCalled();
  });

  it('shows who disabled a flow, when, and why', () => {
    hook.methods = [
      BIZUM,
      {
        ...ZELLE,
        enabled_for_orders: false,
        disabled_reason: 'mantenimiento',
        updated_by: 'a1',
        updated_by_name: 'Ana Admin',
        updated_at: '2026-10-14T16:05:00Z',
      },
    ];
    render(<PaymentMethodsStatusCard />);

    const status = screen.getByText(/Deshabilitado por Ana Admin el \d{2}\/\d{2} \d{2}:\d{2}/);
    expect(status).toBeInTheDocument();
    expect(screen.getByText('Motivo: mantenimiento')).toBeInTheDocument();
  });

  it('falls back to a nameless text when the actor is unknown', () => {
    hook.methods = [BIZUM, { ...ZELLE, enabled_for_orders: false, updated_by: 'a1', updated_by_name: null }];
    render(<PaymentMethodsStatusCard />);
    expect(screen.getByText(/Deshabilitado el \d{2}\/\d{2} \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('opens a confirmation dialog naming the consequence and the pending count before disabling', async () => {
    render(<PaymentMethodsStatusCard />);
    fireEvent.click(switchByName('Zelle para Pedidos'));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('¿Deshabilitar Zelle para Pedidos?')).toBeInTheDocument();
    expect(within(dialog).getByText(/dejarán de poder crear pedidos nuevos con Zelle/)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByText('Operaciones pendientes que se seguirán validando con normalidad: 1.')).toBeInTheDocument()
    );
    expect(counts.orders).toHaveBeenCalled();
    expect(hook.toggle).not.toHaveBeenCalled();
  });

  it('uses the remittances counter for the remittances flow', async () => {
    render(<PaymentMethodsStatusCard />);
    fireEvent.click(switchByName('Zelle para Remesas'));

    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() =>
      expect(within(dialog).getByText('Operaciones pendientes que se seguirán validando con normalidad: 16.')).toBeInTheDocument()
    );
  });

  it('degrades the pending text when the counter fails', async () => {
    counts.orders = vi.fn().mockRejectedValue(new Error('rpc'));
    render(<PaymentMethodsStatusCard />);
    fireEvent.click(switchByName('Zelle para Pedidos'));

    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() =>
      expect(within(dialog).getByText('Las operaciones ya creadas se seguirán validando con normalidad.')).toBeInTheDocument()
    );
  });

  it('requires an explicit acknowledgement before disabling the last enabled method', async () => {
    render(<PaymentMethodsStatusCard />);
    fireEvent.click(switchByName('Zelle para Pedidos'));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Es el último método habilitado')).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Deshabilitar' });
    expect(confirm).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(confirm).toBeEnabled();

    fireEvent.change(within(dialog).getByLabelText('Motivo (opcional)'), { target: { value: '  mantenimiento  ' } });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(hook.toggle).toHaveBeenCalledWith({
        code: 'zelle',
        flow: 'orders',
        enabled: false,
        reason: 'mantenimiento',
        confirmLast: true,
      })
    );
  });

  it('announces the result in a polite live region and toasts on success', async () => {
    render(<PaymentMethodsStatusCard />);
    fireEvent.click(switchByName('Zelle para Pedidos'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deshabilitar' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Zelle para Pedidos deshabilitado');
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Zelle deshabilitado para pedidos' }));
  });

  it('enabling needs no last-method acknowledgement and sends confirmLast=false', async () => {
    hook.methods = [BIZUM, { ...ZELLE, enabled_for_orders: false }];
    render(<PaymentMethodsStatusCard />);
    fireEvent.click(switchByName('Zelle para Pedidos'));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('¿Habilitar Zelle para Pedidos?')).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Habilitar' }));

    await waitFor(() =>
      expect(hook.toggle).toHaveBeenCalledWith({
        code: 'zelle',
        flow: 'orders',
        enabled: true,
        reason: null,
        confirmLast: false,
      })
    );
  });

  it('closes without changes on cancel and on Escape', async () => {
    render(<PaymentMethodsStatusCard />);
    fireEvent.click(switchByName('Zelle para Pedidos'));
    let dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    fireEvent.click(switchByName('Zelle para Pedidos'));
    dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(hook.toggle).not.toHaveBeenCalled();
  });

  it('shows a mapped, friendly error when the RPC rejects', async () => {
    hook.toggle = vi
      .fn()
      .mockRejectedValue(new PaymentMethodError(PAYMENT_METHOD_ERROR.FORBIDDEN, 'payment_method_forbidden'));
    render(<PaymentMethodsStatusCard />);
    fireEvent.click(switchByName('Zelle para Pedidos'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deshabilitar' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description: 'No tienes permisos para cambiar los métodos de pago.',
        })
      )
    );
  });
});
