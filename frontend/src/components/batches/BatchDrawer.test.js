import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { BatchDrawer } from './BatchDrawer';
import { api } from '../../api';

let mockBatch, mockRoles, container, root;
const mockSetData = jest.fn();
jest.mock('../../AuthContext', () => ({ useAuth: () => ({
  hasRole: (...wanted) => wanted.some(role => mockRoles.includes(role)),
}) }));
jest.mock('../../api', () => ({ api: { post: jest.fn(), blob: jest.fn() }, saveBlob: jest.fn() }));
jest.mock('../claims/ClaimDrawer', () => ({ ClaimDrawer: () => null }));
jest.mock('../../hooks', () => ({
  useApi: () => ({ data: mockBatch, error: null, loading: false, reload: jest.fn(), setData: mockSetData }),
  useAction: () => ({ busy: false, error: null, run: fn => fn() }),
}));

const batch = extra => ({
  id: 7, reference: 'A-20261105-00007', route_code: 'A', status: 'EXPORTED', line_count: 1, total_amount: 40000,
  currency: 'TZS', payor_name: 'FHI360', executor_name: 'FHI360', created_by_name: 'Finance', created_at: '2026-11-05T08:00:00Z',
  handed_off_at: null, received_at: null, reversed_at: null, reversal_reason: null, reversed_by_name: null,
  payment_progress: {}, can_hand_off: false, can_receive: false, can_reverse: true, lines: [], claims: [], ...extra,
});
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === text);

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockRoles = ['FHI360_FINANCE']; mockBatch = batch(); api.post.mockReset(); mockSetData.mockClear();
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('reversing asks for a reason and warns about the file', async () => {
  const changed = jest.fn();
  api.post.mockResolvedValue(batch({ status: 'REVERSED', can_reverse: false }));
  act(() => root.render(<BatchDrawer batchId={7} onClose={jest.fn()} onChanged={changed} />));
  act(() => button('Reverse batch').click());
  expect(container.textContent).toContain('nobody has paid from this file');
  expect(button('Reverse batch').disabled).toBe(true);
  act(() => Simulate.change(container.querySelector('textarea'), { target: { value: 'Wrong provider' } }));
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(api.post).toHaveBeenCalledWith('/batches/7/reverse', { reason: 'Wrong provider' });
  expect(mockSetData).toHaveBeenCalled();
  expect(changed).toHaveBeenCalled();
});

test('a refused reversal shows the reason and stays open', async () => {
  api.post.mockRejectedValue(new Error('Claim #4 has a payment or proof recorded'));
  act(() => root.render(<BatchDrawer batchId={7} onClose={jest.fn()} />));
  act(() => button('Reverse batch').click());
  act(() => Simulate.change(container.querySelector('textarea'), { target: { value: 'Wrong provider' } }));
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(container.textContent).toContain('Claim #4 has a payment or proof recorded');
  expect(mockSetData).not.toHaveBeenCalled();
});

test('the button only shows when the server allows it', () => {
  mockBatch = batch({ can_reverse: false });
  act(() => root.render(<BatchDrawer batchId={7} onClose={jest.fn()} />));
  expect(button('Reverse batch')).toBeUndefined();
  expect(button('Download CSV')).toBeDefined();
});

test('a reversed batch shows why and offers no download', () => {
  mockBatch = batch({ status: 'REVERSED', can_reverse: false, reversed_at: '2026-11-05T09:00:00Z',
    reversal_reason: 'Wrong provider', reversed_by_name: 'Neema' });
  act(() => root.render(<BatchDrawer batchId={7} onClose={jest.fn()} />));
  expect(container.textContent).toContain('Wrong provider');
  expect(container.textContent).toContain('Do not pay from any copy of this file');
  expect(button('Download CSV')).toBeUndefined();
});
