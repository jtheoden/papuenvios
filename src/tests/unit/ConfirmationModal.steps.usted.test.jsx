import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'es' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {} }) }));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, initial, animate, exit, transition, ...rest }) => <div {...rest}>{children}</div> },
  AnimatePresence: ({ children }) => <>{children}</>,
}));

import ConfirmationModal from '@/components/ui/ConfirmationModal';

// «Qué sigue» steps (stepWhatsapp, step1, step2, step3): «usted», and no notification promise
// (the customer WhatsApp/email notifications are not sent by the app).
const TUTEO = /(^|[^\p{L}])(tú|tu|tus|ti|te|envíanos|avísanos|contáctanos|sube|registraste|puedes|tienes)(?=$|[^\p{L}])/iu;
const PROMISE = /notificaremos|avisaremos|le avisamos/i;

const props = {
  isOpen: true,
  onClose: vi.fn(),
  onViewOrders: vi.fn(),
  orderNumber: 'X-1',
  total: 50,
  currency: 'USD',
  recipientName: 'Maria',
  itemCount: 2,
  whatsappUrl: 'https://wa.me/15550100',
  whatsappNumber: '+1 555 0100',
};

describe.each([
  ['order', { orderType: 'order' }],
  ['remittance', { orderType: 'remittance' }],
  ['remittance with proof pending', { orderType: 'remittance', proofPending: true }],
])('ConfirmationModal next steps in ES (%s)', (_name, extra) => {
  it('addresses the customer as «usted» and promises no notifications', () => {
    render(<ConfirmationModal {...props} {...extra} />);
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const item of items) {
      expect(item.textContent).not.toMatch(TUTEO);
      expect(item.textContent).not.toMatch(PROMISE);
    }
  });
});
