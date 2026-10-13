import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'es', t: (key) => key })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {} })
}));
vi.mock('@/components/FileUploadWithPreview', () => ({ default: () => <div data-testid="file-upload" /> }));
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import PaymentProofForm from '@/components/shared/PaymentProofForm';

const file = new File(['x'], 'proof.png', { type: 'image/png' });

const renderForm = (props = {}) => {
  const onSubmit = vi.fn();
  render(
    <PaymentProofForm
      file={file}
      reference="John Doe"
      requireReference
      requirePayerPhone
      payerPhone=""
      onPayerPhoneChange={() => {}}
      onSubmit={onSubmit}
      {...props}
    />
  );
  return { onSubmit };
};

const submitButton = () => screen.getByRole('button', { name: /Enviar Comprobante/ });

describe('PaymentProofForm payer phone', () => {
  it('renders the payer phone field when required', () => {
    renderForm();
    expect(screen.getByLabelText(/Tu teléfono para contactarte/)).toBeTruthy();
  });

  it('does not render the field when not required (backward compatible)', () => {
    renderForm({ requirePayerPhone: false });
    expect(screen.queryByLabelText(/Tu teléfono para contactarte/)).toBeNull();
  });

  it('does not submit without a payer phone', () => {
    const { onSubmit } = renderForm({ payerPhone: '' });
    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit with an invalid phone and shows an inline error', () => {
    const { onSubmit } = renderForm({ payerPhone: '123' });
    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/teléfono válido/i);
  });

  it('reports phone edits upward', () => {
    const onPayerPhoneChange = vi.fn();
    renderForm({ onPayerPhoneChange });
    fireEvent.change(screen.getByLabelText(/Tu teléfono para contactarte/), { target: { value: '305 555 0100' } });
    expect(onPayerPhoneChange).toHaveBeenCalledWith('305 555 0100');
  });

  it('submits with a valid phone, passing the trimmed phone up', () => {
    const { onSubmit } = renderForm({ payerPhone: ' 305 555 0100 ' });
    fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ payerPhone: '305 555 0100' });
  });
});
