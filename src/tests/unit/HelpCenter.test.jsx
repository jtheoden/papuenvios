import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HelpCenter from '@/components/help/HelpCenter';
import { getHelpSectionsForRole } from '@/lib/helpContent';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const esT = key => key.split('.').reduce((value, part) => value?.[part], ES);
const enT = key => key.split('.').reduce((value, part) => value?.[part], EN);

describe('role-based admin help center', () => {
  it('returns no help for non-admin roles and keeps system guidance super-admin-only', () => {
    expect(getHelpSectionsForRole('user')).toEqual([]);
    expect(getHelpSectionsForRole(null)).toEqual([]);
    expect(getHelpSectionsForRole('admin').map(section => section.id)).not.toContain('platform');
    expect(getHelpSectionsForRole('super_admin').map(section => section.id)).toContain('platform');
  });

  it('does not render for a regular user', () => {
    const { container } = render(<HelpCenter userRole="user" t={esT} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens from the accessible trigger and exposes only admin topics', () => {
    render(<HelpCenter userRole="admin" t={esT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda para administración' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Ayuda de administración')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Temas de ayuda' })).toHaveTextContent('Pedidos');
    expect(screen.queryByRole('button', { name: 'Sistema y acciones críticas' })).not.toBeInTheDocument();
  });

  it('opens and closes with F1 and exposes the extra system guidance only to super admins', () => {
    render(<HelpCenter userRole="super_admin" t={esT} />);
    const launcher = screen.getByRole('button', { name: 'Ayuda para administración' });
    expect(launcher).toHaveAttribute('data-testid', 'help-center-floating-trigger');
    expect(launcher.className).toContain('fixed');
    expect(launcher.className).toContain('right-4');
    expect(launcher.className).toContain('bottom-36');
    expect(launcher.className).toContain('sm:bottom-24');
    expect(launcher.querySelector('img')).toHaveAttribute('src', '/images/superadmin-chatbot-avatar.png');
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sistema y acciones críticas' }));
    expect(screen.getByText(/No la ejecutes basándote solo en esta ayuda/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses active brand tokens with Classic-compatible fallbacks and preserves English UI labels', () => {
    render(<HelpCenter userRole="admin" language="en" t={enT} />);
    const trigger = screen.getByRole('button', { name: 'Admin help' });
    expect(trigger.getAttribute('style')).toContain('var(--brand-button-bg, #2563eb)');
    fireEvent.click(trigger);
    expect(screen.getByText('Administration help')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
    expect(screen.getByText('What do order statuses mean?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Orders' }).getAttribute('style'))
      .toContain('var(--brand-button-bg, #2563eb)');
  });
});
