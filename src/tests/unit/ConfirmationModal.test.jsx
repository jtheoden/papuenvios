import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
