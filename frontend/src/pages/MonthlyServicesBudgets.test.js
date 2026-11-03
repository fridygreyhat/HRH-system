import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { MonthlyServicesBudgets } from './MonthlyServicesBudgets';
import { api, saveBlob } from '../api';

let mockRoles, container, root;
const mockReload = jest.fn();
jest.mock('../AuthContext', () => ({ useAuth: () => ({
  hasRole: (...wanted) => wanted.some(role => mockRoles.includes(role)),
}) }));
jest.mock('../api', () => ({
  api: { upload: jest.fn(), blob: jest.fn() },
  qs: params => `?month=${params.month}`, saveBlob: jest.fn(),
}));
jest.mock('../hooks', () => ({ useApi: path => ({
  loading: false, error: null, reload: mockReload,
  data: path === '/finance/regions' ? [{ id: 11, name: 'Iringa' }] : [{
    id: 3, region_id: 11, month: '2026-11', currency: 'TZS',
    allocated_amount: '100000', deducted_amount: '40000', remaining_amount: '60000',
    document_name: 'budget.csv',
  }],
}) }));

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockRoles = ['REGIONAL_FINANCE']; api.upload.mockReset(); api.blob.mockReset(); mockReload.mockClear();
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('Regional Finance uploads explicit monthly total and supporting file', async () => {
  api.upload.mockResolvedValue({});
  act(() => root.render(<MonthlyServicesBudgets />));
  const form = container.querySelector('form');
  const file = new File(['budget\n100000\n'], 'budget.csv', { type: 'text/csv' });
  act(() => {
    Simulate.change(form.querySelector('select'), { target: { value: '11' } });
    Simulate.change(form.querySelector('input[type=number]'), { target: { value: '100000' } });
    Simulate.change(form.querySelector('input[type=file]'), { target: { files: [file] } });
  });
  await act(async () => Simulate.submit(form));
  expect(api.upload).toHaveBeenCalledWith('/monthly-service-budgets', expect.any(FormData));
  const data = api.upload.mock.calls[0][1];
  expect(data.get('region_id')).toBe('11');
  expect(data.get('allocated_amount')).toBe('100000');
  expect(data.get('currency')).toBe('TZS');
  expect(data.get('file').name).toBe('budget.csv');
  expect(mockReload).toHaveBeenCalled();
  expect(container.textContent).toContain('Monthly regional Services budget saved.');
  expect(container.textContent).toContain('Deducted on submission');
});

test('Central Finance sees balances and downloads documentation without an upload form', async () => {
  mockRoles = ['FHI360_FINANCE'];
  api.blob.mockResolvedValue({ blob: new Blob(), filename: 'budget.csv' });
  act(() => root.render(<MonthlyServicesBudgets />));
  expect(container.querySelector('form')).toBeNull();
  expect(container.textContent).toContain('Iringa');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'budget.csv').click());
  expect(api.blob).toHaveBeenCalledWith('/monthly-service-budgets/3/document', 'GET', 'budget.csv');
  expect(saveBlob).toHaveBeenCalled();
});

test('upload failures are visible instead of reporting success', async () => {
  api.upload.mockRejectedValue(new Error('Budget cannot be lower than deductions.'));
  act(() => root.render(<MonthlyServicesBudgets />));
  const form = container.querySelector('form');
  act(() => {
    Simulate.change(form.querySelector('select'), { target: { value: '11' } });
    Simulate.change(form.querySelector('input[type=number]'), { target: { value: '1' } });
    Simulate.change(form.querySelector('input[type=file]'), { target: { files: [new File(['1'], 'budget.csv')] } });
  });
  await act(async () => Simulate.submit(form));
  expect(container.textContent).toContain('Budget cannot be lower than deductions.');
  expect(mockReload).not.toHaveBeenCalled();
});
