import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { SalaryAmounts } from './SalaryAmounts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockPut = jest.fn();
const mockReload = jest.fn();

jest.mock('../api', () => ({ api: { put: (...args) => mockPut(...args) }, qs: params => `?month=${params.month}` }));
let mockScales = null;
jest.mock('../hooks', () => ({
  useApi: () => ({
    data: mockScales || [
      { scale: 'TGHS A', providers: 4, monthly_amount: '750000.00', history: [{ start_month: '2026-01', monthly_amount: '750000.00' }] },
      { scale: 'TGHS B', providers: 2, monthly_amount: null, history: [] },
    ],
    error: null, loading: false, reload: mockReload,
  }),
  useAction: () => ({ busy: false, error: null, run: async fn => fn() }),
}));

test('Central Finance sees scales with no amount and saves a monthly salary', async () => {
  mockPut.mockResolvedValue({});
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<SalaryAmounts />));
  try {
    expect(container.textContent).toContain('750,000');
    expect(container.textContent).toContain('No amount');
    const scale = container.querySelector('input[list="salary-scale-options"]');
    const month = container.querySelector('input[type="month"]');
    const amount = container.querySelector('input[type="number"]');
    await act(async () => Simulate.change(scale, { target: { value: ' TGHS B ' } }));
    await act(async () => Simulate.change(month, { target: { value: '2026-10' } }));
    await act(async () => Simulate.change(amount, { target: { value: '600000' } }));
    await act(async () => Simulate.submit(container.querySelector('form'), { preventDefault() {} }));
    expect(mockPut).toHaveBeenCalledWith('/salary-amounts', { scale: 'TGHS B', start_month: '2026-10', monthly_amount: '600000' });
    expect(mockReload).toHaveBeenCalled();
    expect(container.textContent).toContain('Saved TGHS B from 2026-10');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('A salary amount can be set before any staff have a scale', async () => {
  mockScales = [];
  mockPut.mockClear();
  mockPut.mockResolvedValue({});
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<SalaryAmounts />));
  try {
    expect(container.textContent).toContain('Type a scale above');
    const scale = container.querySelector('input[list="salary-scale-options"]');
    expect(scale.disabled).toBe(false);
    await act(async () => Simulate.change(scale, { target: { value: 'TGHS C' } }));
    await act(async () => Simulate.change(container.querySelector('input[type="number"]'), { target: { value: '500000' } }));
    await act(async () => Simulate.submit(container.querySelector('form'), { preventDefault() {} }));
    expect(mockPut).toHaveBeenCalledWith('/salary-amounts', expect.objectContaining({ scale: 'TGHS C', monthly_amount: '500000' }));
  } finally {
    mockScales = null;
    act(() => root.unmount());
    container.remove();
  }
});
