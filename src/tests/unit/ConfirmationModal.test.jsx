import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'es' })
}));

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {} })
}));

// framer-motion animations are irrelevant in jsdom; render plain elements.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, animate, exit, transition, ...rest }) => <div {...rest}>{children}</div>
  },
  AnimatePresence: ({ children }) => <>{children}</>
}));

import ConfirmationModal from '@/components/ui/ConfirmationModal';

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onViewOrders: vi.fn(),
  orderNumber: 'ORD-1',
  orderType: 'order',
  total: 50,
  currency: 'USD',
  recipientName: 'Maria',
  itemCount: 2
};

const WHATSAPP_URL = 'https://wa.me/15616011675?text=hola';
const WHATSAPP_NUMBER = '+1 (561) 601-1675';

describe('ConfirmationModal guided WhatsApp step', () => {
  it('renders the WhatsApp link with href, target and rel, and shows the configured number', () => {
    render(<ConfirmationModal {...baseProps} whatsappUrl={WHATSAPP_URL} whatsappNumber={WHATSAPP_NUMBER} />);

    const link = screen.getByTestId('confirmation-whatsapp-link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', WHATSAPP_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link).toHaveTextContent('Enviar comprobante por WhatsApp');
    expect(screen.getByText(`Se abrirá un chat con ${WHATSAPP_NUMBER}`)).toBeInTheDocument();
  });

  it('prepends the WhatsApp step to the next-steps list when a URL is present', () => {
    render(<ConfirmationModal {...baseProps} whatsappUrl={WHATSAPP_URL} whatsappNumber={WHATSAPP_NUMBER} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Envíanos el comprobante por WhatsApp con el botón de abajo');
    expect(items[0]).toHaveTextContent('1');
  });

  it('shows a disabled preparing button while loading without a URL', () => {
    render(<ConfirmationModal {...baseProps} whatsappLoading={true} />);

    const button = screen.getByRole('button', { name: 'Preparando mensaje de WhatsApp…' });
    expect(button).toBeDisabled();
    expect(screen.queryByTestId('confirmation-whatsapp-link')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows the not-configured warning when there is no URL and not loading', () => {
    render(<ConfirmationModal {...baseProps} />);

    expect(
      screen.getByText('WhatsApp del administrador no configurado. Contacta al soporte.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('confirmation-whatsapp-link')).not.toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<ConfirmationModal {...baseProps} isOpen={false} whatsappUrl={WHATSAPP_URL} whatsappNumber={WHATSAPP_NUMBER} />);

    expect(screen.queryByTestId('confirmation-whatsapp-link')).not.toBeInTheDocument();
  });
});

describe('ConfirmationModal pending-proof variant', () => {
  const remittanceProps = {
    ...baseProps,
    orderNumber: 'REM-1',
    orderType: 'remittance',
    whatsappUrl: WHATSAPP_URL,
    whatsappNumber: WHATSAPP_NUMBER
  };

  it('shows the registered title, notify label and upload-later step when proofPending', () => {
    render(<ConfirmationModal {...remittanceProps} proofPending={true} />);

    expect(screen.getByText('¡Remesa Registrada!')).toBeInTheDocument();
    expect(screen.getByText('Falta subir tu comprobante de pago')).toBeInTheDocument();

    const link = screen.getByTestId('confirmation-whatsapp-link');
    expect(link).toHaveAttribute('href', WHATSAPP_URL);
    expect(link).toHaveTextContent('Avisar al administrador por WhatsApp');

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Avísanos por WhatsApp que registraste la remesa con el botón de abajo');
    expect(items[1]).toHaveTextContent('Sube tu comprobante de pago desde Mis Remesas');
    expect(screen.queryByText('Verificaremos tu comprobante de pago')).not.toBeInTheDocument();
    expect(items[2]).toHaveTextContent('Procesaremos tu remesa cuando validemos el pago');
    expect(screen.queryByText('Procesaremos tu remesa en las próximas horas')).not.toBeInTheDocument();
  });

  it('stacks above other z-50 modals', () => {
    render(<ConfirmationModal {...remittanceProps} />);

    const overlay = screen.getByText('¡Remesa Enviada!').closest('.fixed');
    expect(overlay).toHaveClass('z-[60]');
    expect(overlay).not.toHaveClass('z-50');
  });

  it('keeps the original remittance texts without proofPending', () => {
    render(<ConfirmationModal {...remittanceProps} />);

    expect(screen.getByText('¡Remesa Enviada!')).toBeInTheDocument();
    expect(screen.getByText('Tu remesa ha sido registrada exitosamente')).toBeInTheDocument();
    expect(screen.getByTestId('confirmation-whatsapp-link')).toHaveTextContent('Enviar comprobante por WhatsApp');
    expect(screen.getByText('Verificaremos tu comprobante de pago')).toBeInTheDocument();
    expect(screen.getByText('Procesaremos tu remesa en las próximas horas')).toBeInTheDocument();
  });

  it('ignores proofPending for product orders', () => {
    render(<ConfirmationModal {...baseProps} whatsappUrl={WHATSAPP_URL} whatsappNumber={WHATSAPP_NUMBER} proofPending={true} />);

    expect(screen.getByText('¡Pedido Confirmado!')).toBeInTheDocument();
    expect(screen.getByTestId('confirmation-whatsapp-link')).toHaveTextContent('Enviar comprobante por WhatsApp');
  });
});

describe('ConfirmationModal skip guard for the guided WhatsApp step', () => {
  const SKIP_WARNING = 'El administrador aún no fue notificado. Envía el mensaje por WhatsApp para que procese tu operación.';
  const guardedProps = { ...baseProps, whatsappUrl: WHATSAPP_URL, whatsappNumber: WHATSAPP_NUMBER };
  const clickClose = () => fireEvent.click(screen.getByText('Cerrar'));

  beforeEach(() => {
    baseProps.onClose.mockClear();
    baseProps.onViewOrders.mockClear();
  });

  it('warns instead of closing on the first close attempt, then closes on the second', () => {
    render(<ConfirmationModal {...guardedProps} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    clickClose();

    expect(baseProps.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(SKIP_WARNING);

    clickClose();
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('applies the same rule to the X button and the backdrop', () => {
    render(<ConfirmationModal {...guardedProps} />);

    fireEvent.click(screen.getByLabelText('Cerrar'));
    expect(baseProps.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByText('¡Pedido Confirmado!').closest('.fixed'));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the first attempt once the WhatsApp link was clicked', () => {
    render(<ConfirmationModal {...guardedProps} />);

    fireEvent.click(screen.getByTestId('confirmation-whatsapp-link'));
    clickClose();

    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes on the first attempt when there is no WhatsApp URL', () => {
    render(<ConfirmationModal {...baseProps} />);

    clickClose();

    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('guards the close while the WhatsApp message is still loading', () => {
    render(<ConfirmationModal {...baseProps} whatsappLoading={true} />);

    clickClose();
    expect(baseProps.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(SKIP_WARNING);

    clickClose();
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the warning visible when the URL arrives after a guarded attempt during loading', () => {
    const { rerender } = render(<ConfirmationModal {...baseProps} whatsappLoading={true} />);

    clickClose();
    rerender(<ConfirmationModal {...guardedProps} whatsappLoading={false} />);

    expect(screen.getByRole('alert')).toHaveTextContent(SKIP_WARNING);
    expect(screen.getByTestId('confirmation-whatsapp-link')).toBeInTheDocument();
  });

  it('counts a middle-click on the WhatsApp link as having opened it', () => {
    render(<ConfirmationModal {...guardedProps} />);

    fireEvent(
      screen.getByTestId('confirmation-whatsapp-link'),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    );
    clickClose();

    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('guards the view-orders button with the same rule', () => {
    render(<ConfirmationModal {...guardedProps} />);
    const viewOrders = screen.getByRole('button', { name: /Ver Mis Pedidos/ });

    fireEvent.click(viewOrders);
    expect(baseProps.onViewOrders).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(SKIP_WARNING);

    fireEvent.click(viewOrders);
    expect(baseProps.onViewOrders).toHaveBeenCalledTimes(1);
  });

  it('lets view-orders through on the first attempt after the link was clicked', () => {
    render(<ConfirmationModal {...guardedProps} />);

    fireEvent.click(screen.getByTestId('confirmation-whatsapp-link'));
    fireEvent.click(screen.getByRole('button', { name: /Ver Mis Pedidos/ }));

    expect(baseProps.onViewOrders).toHaveBeenCalledTimes(1);
  });

  it('resets the guard every time the modal opens', () => {
    const { rerender } = render(<ConfirmationModal {...guardedProps} />);

    fireEvent.click(screen.getByTestId('confirmation-whatsapp-link'));
    rerender(<ConfirmationModal {...guardedProps} isOpen={false} />);
    rerender(<ConfirmationModal {...guardedProps} />);
    clickClose();

    expect(baseProps.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  describe('resend variant', () => {
    const resendProps = {
      ...guardedProps,
      orderNumber: 'REM-1',
      orderType: 'remittance',
      variant: 'resend'
    };

    it('shows the re-notify texts instead of the success ones and no steps list', () => {
      render(<ConfirmationModal {...resendProps} proofPending={true} />);

      expect(screen.getByText('Notifica al administrador por WhatsApp')).toBeInTheDocument();
      expect(screen.queryByText('¡Remesa Enviada!')).not.toBeInTheDocument();
      expect(screen.queryByText('¡Remesa Registrada!')).not.toBeInTheDocument();
      expect(screen.queryByText('¿Qué sigue?')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
      expect(screen.getByTestId('confirmation-whatsapp-link')).toHaveAttribute('href', WHATSAPP_URL);
      expect(screen.getByText('REM-1')).toBeInTheDocument();
    });

    it('closes on the first attempt without any warning', () => {
      render(<ConfirmationModal {...resendProps} />);

      clickClose();

      expect(baseProps.onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('renders view-orders as a secondary full-width action only when the WhatsApp URL is present', () => {
    const { rerender } = render(<ConfirmationModal {...guardedProps} />);
    const secondary = screen.getByRole('button', { name: /Ver Mis Pedidos/ });

    expect(secondary).toHaveClass('w-full');
    expect(secondary.style.backgroundColor).toBe('');

    rerender(<ConfirmationModal {...baseProps} />);
    expect(screen.getByRole('button', { name: /Ver Mis Pedidos/ }).style.backgroundColor).not.toBe('');
  });
});
