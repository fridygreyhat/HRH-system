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
jest.mock('../api', () => ({ api: { put: (...args) => mockPut(...args) } }));
jest.mock('../hooks', () => ({
  useApi: () => ({ data: mockLoadError ? null : response, error: mockLoadError, loading: false, reload: mockReload, setData: jest.fn() }),
  useAction: () => ({ busy: false, error: null, setError: jest.fn(), run: async (fn) => fn() }),
}));

test('provider view masks account details and edit sends both payment channels in a single self-service update', async () => {
  mockPut.mockResolvedValue(response);
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
    expect(mockPut).toHaveBeenCalledWith('/provider-details/me', {
      bank_name: 'NMB', bank_account_number: '9876543210', bank_branch: 'Mwanza', mobile_money_number: '+255712345678',
    });
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
