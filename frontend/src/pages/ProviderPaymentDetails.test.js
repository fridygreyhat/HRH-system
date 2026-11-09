import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { ProviderPaymentDetails } from './ProviderPaymentDetails';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const response = {
  staff_id: 33,
  bank_name: 'NMB',
  bank_account_number: '012345678901',
  bank_branch: 'Mwanza',
  mobile_money_number: '+255712345678',
};
let mockLoadError = null;
const mockReload = jest.fn();
const mockPut = jest.fn();
const mockPost = jest.fn();
let mockLang = 'en';
jest.mock('../api', () => ({ api: { put: (...args) => mockPut(...args), post: (...args) => mockPost(...args) } }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ lang: mockLang }) }));
jest.mock('../hooks', () => ({
  useApi: () => ({ data: mockLoadError ? null : response, error: mockLoadError, loading: false, reload: mockReload, setData: jest.fn() }),
  useAction: () => ({ busy: false, error: null, setError: jest.fn(), run: async (fn) => fn() }),
}));

test('provider view masks account details and a change is saved only after the SMS code', async () => {
  mockPut.mockReset();
  mockPut.mockResolvedValue(response);
  mockPost.mockResolvedValue({ changed: true, phone: '+255•••678', minutes: 10 });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<ProviderPaymentDetails />));
  try {
    expect(container.textContent).toContain('••••••••8901');
    expect(container.textContent).not.toContain('012345678901');
    await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Edit details')));
    const inputs = container.querySelectorAll('input');
    await act(async () => {
      Simulate.change(inputs[0], { target: { value: 'NMB' } });
      Simulate.change(inputs[1], { target: { value: '9876543210' } });
      Simulate.change(inputs[2], { target: { value: 'Mwanza' } });
    });
    await act(async () => Simulate.change(inputs[3], { target: { value: '0812345678' } }));
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save payment details').disabled).toBe(true);
    await act(async () => Simulate.change(inputs[3], { target: { value: '0712345678' } }));
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save payment details').disabled).toBe(false);
    await act(async () => Simulate.submit(container.querySelector('form'), { preventDefault() {} }));
    const expected = { bank_name: 'NMB', bank_account_number: '9876543210', bank_branch: 'Mwanza', mobile_money_number: '+255712345678' };
    expect(mockPost).toHaveBeenCalledWith('/provider-details/me/code', expected);
    expect(mockPut).not.toHaveBeenCalled();
    expect(container.textContent).toContain('+255•••678');
    const confirm = () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Confirm and save');
    expect(confirm().disabled).toBe(true);
    await act(async () => Simulate.change(container.querySelector('.otp-input'), { target: { value: '12a3456' } }));
    expect(container.querySelector('.otp-input').value).toBe('123456');
    await act(async () => Simulate.submit(container.querySelector('form'), { preventDefault() {} }));
    expect(mockPut).toHaveBeenCalledWith('/provider-details/me', { ...expected, code: '123456' });
    expect(container.textContent).toContain('Payment details saved.');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('payment detail load errors provide a retry and do not reveal editable fields', async () => {
  mockLoadError = 'Connection interrupted';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<ProviderPaymentDetails />));
  try {
    expect(container.textContent).toContain('Connection interrupted');
    expect(container.textContent).toContain('Try again');
    expect(container.querySelector('input')).toBeNull();
    await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try again')));
    expect(mockReload).toHaveBeenCalled();
  } finally {
    mockLoadError = null;
    act(() => root.unmount());
    container.remove();
  }
});

test('saving unchanged details asks for no code', async () => {
  mockPut.mockReset();
  mockPost.mockResolvedValue({ changed: false });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<ProviderPaymentDetails />));
  try {
    await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Edit details')));
    await act(async () => Simulate.submit(container.querySelector('form'), { preventDefault() {} }));
    expect(container.querySelector('.otp-input')).toBeNull();
    expect(mockPut).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Edit details');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('the page is in Kiswahili for a Kiswahili user', async () => {
  mockLang = 'sw';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<ProviderPaymentDetails />));
  try {
    expect(container.textContent).toContain('Taarifa za malipo');
    expect(container.textContent).not.toContain('Payment details');
  } finally {
    mockLang = 'en';
    act(() => root.unmount());
    container.remove();
  }
});
