import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockLang = { current: 'es' };
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: mockLang.current })
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
    expect(items[0]).toHaveTextContent('Opcional: envíanos el comprobante por WhatsApp con el botón de abajo para acelerar la verificación');
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
    expect(items[0]).toHaveTextContent('Opcional: avísanos por WhatsApp que registraste la remesa con el botón de abajo para acelerar la verificación');
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

describe('ConfirmationModal optional WhatsApp step', () => {
  const WARNING_FRAGMENT = /aún no fue notificado|has not been notified/;
  const guardedProps = { ...baseProps, whatsappUrl: WHATSAPP_URL, whatsappNumber: WHATSAPP_NUMBER };
  const clickClose = () => fireEvent.click(screen.getByText('Cerrar'));

  beforeEach(() => {
    mockLang.current = 'es';
    baseProps.onClose.mockClear();
    baseProps.onViewOrders.mockClear();
  });

  const scenarios = [
    ['a WhatsApp URL', guardedProps],
    ['no URL and not configured', baseProps],
    ['the message still loading', { ...baseProps, whatsappLoading: true }]
  ];

  it.each(scenarios)('closes on the first attempt without warning when there is %s', (_name, props) => {
    render(<ConfirmationModal {...props} />);

    clickClose();

    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(WARNING_FRAGMENT)).not.toBeInTheDocument();
  });

  it.each(scenarios)('lets the X button, backdrop and view-orders through immediately with %s', (_name, props) => {
    render(<ConfirmationModal {...props} />);

    fireEvent.click(screen.getByLabelText('Cerrar'));
    fireEvent.click(screen.getByText('¡Pedido Confirmado!').closest('.fixed'));
    expect(baseProps.onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /Ver Mis Pedidos/ }));
    expect(baseProps.onViewOrders).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the WhatsApp button visible with the correct href as a direct link', () => {
    render(<ConfirmationModal {...guardedProps} />);

    const link = screen.getByTestId('confirmation-whatsapp-link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', WHATSAPP_URL);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('does not open WhatsApp automatically', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<ConfirmationModal {...guardedProps} />);
    clickClose();

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('explains in Spanish that the step is optional and the order is already registered', () => {
    render(<ConfirmationModal {...guardedProps} />);

    expect(screen.getByText('Tu pedido ya quedó registrado. El aviso por WhatsApp es opcional.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(/Opcional/);
  });

  it('explains in English that the step is optional and the order is already registered', () => {
    mockLang.current = 'en';
    render(<ConfirmationModal {...guardedProps} />);

    expect(screen.getByText('Your order is already registered. The WhatsApp notice is optional.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(/Optional: .*speed up verification/);
  });

  it.each([
    ['es', 'Tu remesa ya quedó registrada. El aviso por WhatsApp es opcional.'],
    ['en', 'Your remittance is already registered. The WhatsApp notice is optional.']
  ])('applies the same optional treatment to remittances (%s), also with proof pending', (lang, note) => {
    mockLang.current = lang;
    const { rerender } = render(<ConfirmationModal {...guardedProps} orderType="remittance" />);
    expect(screen.getByText(note)).toBeInTheDocument();

    rerender(<ConfirmationModal {...guardedProps} orderType="remittance" proofPending={true} />);
    expect(screen.getByText(note)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(/Opcional|Optional/);
  });

  it('shows no optional note when there is no WhatsApp URL', () => {
    render(<ConfirmationModal {...baseProps} />);

    expect(screen.queryByText(/es opcional/)).not.toBeInTheDocument();
  });

  it('has the same set of rendered texts in both languages (parity)', () => {
    const textsFor = (lang) => {
      mockLang.current = lang;
      const { container, unmount } = render(<ConfirmationModal {...guardedProps} orderType="remittance" proofPending={true} />);
      const count = container.querySelectorAll('li, h2, h3, p, a, button').length;
      unmount();
      return count;
    };

    expect(textsFor('es')).toBe(textsFor('en'));
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
