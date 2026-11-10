/**
 * showModal({ maxLength }) caps the textarea (the admin cancel reason is 1..500 server side); without it, no cap.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModalProvider, useModal } from '@/contexts/ModalContext';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const Opener = ({ config }) => {
  const { showModal } = useModal();
  return <button type="button" onClick={() => showModal(config)}>open</button>;
};

const open = (config) => {
  render(<ModalProvider><Opener config={config} /></ModalProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'open' }));
  return screen.findByRole('textbox');
};

describe('ModalContext maxLength', () => {
  it('passes maxLength to the textarea', async () => {
    expect((await open({ input: true, maxLength: 500 })).getAttribute('maxlength')).toBe('500');
  });

  it('has no cap when maxLength is not given', async () => {
    expect((await open({ input: true })).hasAttribute('maxlength')).toBe(false);
  });
});

describe('admin cancel copy', () => {
  it('warns to check the Zelle account before cancelling (no proof does not mean no payment)', () => {
    expect(ES.remittances.admin.confirmCancelMessage).toMatch(/Verifica en la cuenta Zelle que no se haya recibido el pago antes de cancelar/);
    expect(EN.remittances.admin.confirmCancelMessage).toMatch(/Check the Zelle account that no payment was received before cancelling/);
  });
});
