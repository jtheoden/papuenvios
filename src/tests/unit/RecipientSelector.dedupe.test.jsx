import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getMyRecipients: vi.fn(),
  createRecipient: vi.fn(),
  addRecipientAddress: vi.fn(),
  toast: vi.fn()
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => mocks.toast(...a) }));
vi.mock('@/lib/recipientService', () => ({
  getMyRecipients: (...a) => mocks.getMyRecipients(...a),
  createRecipient: (...a) => mocks.createRecipient(...a),
  addRecipientAddress: (...a) => mocks.addRecipientAddress(...a)
}));
vi.mock('@/components/BankAccountSelector', () => ({ default: () => null }));

import RecipientSelector from '@/components/RecipientSelector';
import { getMunicipalitiesByProvince } from '@/lib/cubanLocations';

const zones = [
  { id: 1, province_name: 'Matanzas', municipality_name: null, shipping_cost: 5, free_shipping: false, is_active: true }
];
const addr = (id, municipality, isDefault = true) => ({
  id, province: 'Matanzas', municipality, address_line_1: 'Calle 1', is_default: isDefault
});
const person = (id, name, phone, addresses = []) => ({ id, full_name: name, phone, email: null, addresses });

const renderSelector = (props = {}) => {
  const onSelect = vi.fn();
  render(<RecipientSelector onSelect={onSelect} shippingZones={zones} {...props} />);
  return onSelect;
};

const openForm = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Crear Nuevo Destinatario/ }));
};
const fillBasics = (name = 'Ana Pérez', phone = '+53 5555 5555') => {
  fireEvent.change(screen.getByPlaceholderText('Juan Pérez'), { target: { value: name } });
  fireEvent.change(screen.getByPlaceholderText('+53 5555 5555'), { target: { value: phone } });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMyRecipients.mockResolvedValue([]);
});

describe('RecipientSelector - double submit guard', () => {
  it('creates the recipient once when Save is clicked twice while the request is pending', async () => {
    let resolveCreate;
    mocks.createRecipient.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    renderSelector({ deliveryMethod: 'transfer' });
    await openForm();
    fillBasics();

    const save = screen.getByRole('button', { name: 'Guardar Destinatario' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(mocks.createRecipient).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();

    await act(async () => { resolveCreate({ success: true, recipient: person('new', 'Ana Pérez', '5355555555') }); });
  });
});

describe('RecipientSelector - visibility by delivery method', () => {
  const noAddress = person('r1', 'Sin Dirección', '5300000001');

  it('shows a recipient without addresses when delivery is not cash', async () => {
    mocks.getMyRecipients.mockResolvedValue([noAddress]);
    renderSelector({ deliveryMethod: 'transfer' });
    expect(await screen.findByText('Sin Dirección')).toBeInTheDocument();
  });

  it('hides a recipient without a valid address when delivery is cash', async () => {
    mocks.getMyRecipients.mockResolvedValue([noAddress]);
    renderSelector({ deliveryMethod: 'cash' });
    await screen.findByText('No se encontraron destinatarios');
    expect(screen.queryByText('Sin Dirección')).toBeNull();
  });
});

describe('RecipientSelector - auto-select of the new recipient', () => {
  it('passes the real address id returned by addRecipientAddress', async () => {
    const created = person('new-id', 'Ana Pérez', '+53 5555 5555');
    mocks.createRecipient.mockResolvedValue({ success: true, recipient: created });
    mocks.addRecipientAddress.mockResolvedValue({ success: true, address: { id: 'addr-new' } });
    const onSelect = renderSelector({ deliveryMethod: 'cash', showProvinceInForm: true });
    await openForm();
    fillBasics();
    fireEvent.change(screen.getByDisplayValue('Seleccione una provincia'), { target: { value: 'Matanzas' } });
    const municipality = getMunicipalitiesByProvince('Matanzas')[0];
    fireEvent.change(await screen.findByDisplayValue('Seleccione un municipio'), { target: { value: municipality } });
    fireEvent.change(screen.getByPlaceholderText('Calle 23, entre L y M'), { target: { value: 'Calle 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Destinatario' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls.at(-1)[0]).toMatchObject({ recipientId: 'new-id', addressId: 'addr-new' });
  });
});

describe('RecipientSelector - existing recipient returned by the service', () => {
  const fillCashForm = async () => {
    await openForm();
    fillBasics();
    fireEvent.change(screen.getByDisplayValue('Seleccione una provincia'), { target: { value: 'Matanzas' } });
    const municipality = getMunicipalitiesByProvince('Matanzas')[0];
    fireEvent.change(await screen.findByDisplayValue('Seleccione un municipio'), { target: { value: municipality } });
    fireEvent.change(screen.getByPlaceholderText('Calle 23, entre L y M'), { target: { value: 'Calle 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Destinatario' }));
    return municipality;
  };

  it('selects it without a duplicate address when it already has the typed one, and tells the user', async () => {
    const municipality = getMunicipalitiesByProvince('Matanzas')[0];
    const existing = person('old-id', 'Ana Pérez', '+53 5555 5555', [
      addr('addr-other', 'Otro', true),
      { ...addr('addr-old', municipality, false), address_line_1: ' calle  1' }
    ]);
    mocks.createRecipient.mockResolvedValue({ success: true, recipient: existing, existing: true });
    const onSelect = renderSelector({ deliveryMethod: 'cash', showProvinceInForm: true });
    await fillCashForm();

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(mocks.addRecipientAddress).not.toHaveBeenCalled();
    expect(onSelect.mock.calls.at(-1)[0]).toMatchObject({ recipientId: 'old-id', addressId: 'addr-old' });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'recipients.recipientAlreadyExists' }));
  });

  it('adds and selects the typed address when the existing recipient does not have it', async () => {
    const existing = person('old-id', 'Ana Pérez', '+53 5555 5555', [addr('addr-old', 'Otro', true)]);
    mocks.createRecipient.mockResolvedValue({ success: true, recipient: existing, existing: true });
    mocks.addRecipientAddress.mockResolvedValue({ success: true, address: { id: 'addr-typed' } });
    const onSelect = renderSelector({ deliveryMethod: 'cash', showProvinceInForm: true });
    await fillCashForm();

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(mocks.addRecipientAddress).toHaveBeenCalledWith(expect.objectContaining({ recipient_id: 'old-id', address_line_1: 'Calle 1' }));
    expect(onSelect.mock.calls.at(-1)[0]).toMatchObject({ recipientId: 'old-id', addressId: 'addr-typed' });
  });
});

describe('RecipientSelector - UX', () => {
  const three = [
    person('a', 'Ana Pérez', '+53 5555 0001', [addr('a1', 'Colón')]),
    person('b', 'Ana Pérez', '+53 5555 0002', [addr('b1', 'Jovellanos')]),
    person('c', 'Luis Gómez', '+53 5555 0003', [addr('c1', 'Perico')])
  ];

  it('shows the search box from the third recipient on', async () => {
    mocks.getMyRecipients.mockResolvedValue(three);
    renderSelector({ deliveryMethod: 'cash' });
    expect(await screen.findByPlaceholderText(/Buscar por nombre/)).toBeInTheDocument();
  });

  it('does not show the search box with two recipients', async () => {
    mocks.getMyRecipients.mockResolvedValue(three.slice(0, 2));
    renderSelector({ deliveryMethod: 'cash' });
    await screen.findAllByText('Ana Pérez');
    expect(screen.queryByPlaceholderText(/Buscar por nombre/)).toBeNull();
  });

  it('tells homonyms apart with the municipality in each option', async () => {
    mocks.getMyRecipients.mockResolvedValue(three);
    renderSelector({ deliveryMethod: 'cash' });
    expect(await screen.findByRole('option', { name: /Ana Pérez.*Colón/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ana Pérez.*Jovellanos/ })).toBeInTheDocument();
  });

  it('warns when the typed phone already belongs to a saved recipient', async () => {
    mocks.getMyRecipients.mockResolvedValue(three);
    renderSelector({ deliveryMethod: 'transfer' });
    await openForm();
    fireEvent.change(screen.getByPlaceholderText('+53 5555 5555'), { target: { value: '53 5555-0003' } });
    expect(screen.getByRole('status')).toHaveTextContent('Luis Gómez');
  });
});
