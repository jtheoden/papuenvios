import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));

const recordLegalAcceptance = vi.fn();
vi.mock('@/lib/legalAcceptanceService', () => ({
  recordLegalAcceptance: (...args) => recordLegalAcceptance(...args),
}));

import LegalAcceptanceGate from '@/components/LegalAcceptanceGate';

const setup = (props = {}) => {
  const onAccepted = vi.fn();
  const onCancel = vi.fn();
  render(<LegalAcceptanceGate open source="checkout" onAccepted={onAccepted} onCancel={onCancel} {...props} />);
  return { onAccepted, onCancel };
};

const checkbox = () => screen.getByRole('checkbox');
const dateInput = () => screen.getByLabelText('legal.gate.birthDateLabel');
const submit = () => screen.getByRole('button', { name: 'legal.gate.accept' });

beforeEach(() => {
  recordLegalAcceptance.mockReset();
});

describe('LegalAcceptanceGate', () => {
  it('renders nothing when closed', () => {
    render(<LegalAcceptanceGate open={false} source="checkout" onAccepted={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders an accessible modal dialog with an unchecked checkbox and a labelled date input', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(checkbox().checked).toBe(false);
    expect(dateInput().getAttribute('type')).toBe('date');
    expect(dateInput().getAttribute('max')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('links to the legal pages in a new tab so the cart state is not lost', () => {
    setup();
    const terms = screen.getByRole('link', { name: 'legal.links.terms' });
    const privacy = screen.getByRole('link', { name: 'legal.links.privacy' });
    expect(terms.getAttribute('href')).toBe('/terms');
    expect(privacy.getAttribute('href')).toBe('/privacy');
    expect(terms.getAttribute('target')).toBe('_blank');
    expect(terms.getAttribute('rel')).toContain('noopener');
  });

  it('blocks submit until the checkbox is ticked (no RPC call)', async () => {
    const { onAccepted } = setup();
    fireEvent.change(dateInput(), { target: { value: '1990-05-01' } });
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('legal.gate.errors.acceptRequired');
    expect(recordLegalAcceptance).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it('blocks submit without a date of birth (no RPC call)', async () => {
    setup();
    fireEvent.click(checkbox());
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('legal.gate.errors.birthDateRequired');
    expect(recordLegalAcceptance).not.toHaveBeenCalled();
  });

  it('shows the 18+ message for an under-age result and does not accept', async () => {
    recordLegalAcceptance.mockResolvedValue({ ok: false, code: 'under_age' });
    const { onAccepted } = setup();
    fireEvent.click(checkbox());
    fireEvent.change(dateInput(), { target: { value: '2015-01-01' } });
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('legal.gate.errors.underAge');
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it('shows the conflict message when the profile already has another date', async () => {
    recordLegalAcceptance.mockResolvedValue({ ok: false, code: 'birth_date_conflict' });
    setup();
    fireEvent.click(checkbox());
    fireEvent.change(dateInput(), { target: { value: '1990-05-01' } });
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('legal.gate.errors.conflict');
  });

  it('records the acceptance with the source and date and calls onAccepted on success', async () => {
    recordLegalAcceptance.mockResolvedValue({ ok: true });
    const { onAccepted } = setup({ source: 'remittance' });
    fireEvent.click(checkbox());
    fireEvent.change(dateInput(), { target: { value: '1990-05-01' } });
    fireEvent.click(submit());
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(recordLegalAcceptance).toHaveBeenCalledWith({ birthDate: '1990-05-01', source: 'remittance' });
  });

  it('does not allow a double submit while saving', async () => {
    let resolve;
    recordLegalAcceptance.mockReturnValue(new Promise((r) => { resolve = r; }));
    setup();
    fireEvent.click(checkbox());
    fireEvent.change(dateInput(), { target: { value: '1990-05-01' } });
    fireEvent.click(submit());
    fireEvent.click(screen.getByRole('button', { name: 'legal.gate.saving' }));
    expect(recordLegalAcceptance).toHaveBeenCalledTimes(1);
    resolve({ ok: true });
  });

  it('cancels with the Cancel button and with Escape', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'legal.gate.cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('moves focus into the dialog on open', () => {
    setup();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('disables Cancel while saving', async () => {
    recordLegalAcceptance.mockReturnValue(new Promise(() => {}));
    setup();
    fireEvent.click(checkbox());
    fireEvent.change(dateInput(), { target: { value: '1990-05-01' } });
    fireEvent.click(submit());
    expect(screen.getByRole('button', { name: 'legal.gate.cancel' })).toBeDisabled();
  });

  it('does not double submit when the form is submitted twice in the same tick', () => {
    recordLegalAcceptance.mockReturnValue(new Promise(() => {}));
    setup();
    fireEvent.click(checkbox());
    fireEvent.change(dateInput(), { target: { value: '1990-05-01' } });
    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(recordLegalAcceptance).toHaveBeenCalledTimes(1);
  });

  it('handles Escape at document level while open', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('traps Tab at document level (last -> first, first -> last with Shift)', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    const items = Array.from(dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])'));
    items[items.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('pulls focus back into the dialog if it escapes and Tab is pressed', () => {
    setup();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    outside.remove();
  });

  it('restores the previously focused element when it closes', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const props = { source: 'checkout', onAccepted: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<LegalAcceptanceGate open={false} {...props} />);
    rerender(<LegalAcceptanceGate open {...props} />);
    expect(document.activeElement).not.toBe(trigger);
    rerender(<LegalAcceptanceGate open={false} {...props} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('makes the app root inert and aria-hidden while open, and restores it after', () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    const props = { source: 'checkout', onAccepted: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<LegalAcceptanceGate open {...props} />);
    expect(root.hasAttribute('inert')).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    rerender(<LegalAcceptanceGate open={false} {...props} />);
    expect(root.hasAttribute('inert')).toBe(false);
    expect(root.hasAttribute('aria-hidden')).toBe(false);
    root.remove();
  });

  it('shows a dedicated message when the profile is missing', async () => {
    recordLegalAcceptance.mockResolvedValue({ ok: false, code: 'profile_not_found' });
    setup();
    fireEvent.click(checkbox());
    fireEvent.change(dateInput(), { target: { value: '1990-05-01' } });
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('legal.gate.errors.profileNotFound');
  });

  it('shows a dedicated message when the legal version is outdated', async () => {
    recordLegalAcceptance.mockResolvedValue({ ok: false, code: 'invalid_version' });
    setup();
    fireEvent.click(checkbox());
    fireEvent.change(dateInput(), { target: { value: '1990-05-01' } });
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('legal.gate.errors.versionOutdated');
  });
});
