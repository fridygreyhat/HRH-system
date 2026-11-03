import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { RateRulesSection } from './RateRulesSection';
import { api } from '../../api';

const mockReload = jest.fn();
let mockManage = true;
const mockRule = {
  id: 10, category_id: 1, cadre_id: null, region_id: null,
  component_name: 'Clinic allowance', unit_type: 'FIXED', measure_key: null,
  rate_value: 40000, cap_amount: null, currency: 'TZS', status: 'ACTIVE',
  effective_start_date: '2026-10-01', effective_end_date: null,
};
jest.mock('../../AuthContext', () => ({
  useAuth: () => ({ hasRole: () => mockManage }),
}));
jest.mock('../../api', () => ({ api: { post: jest.fn(), put: jest.fn(), del: jest.fn() } }));
jest.mock('../../hooks', () => ({
  ...jest.requireActual('../../hooks'),
  useApi: path => ({
    data: path === '/admin/rate-rules' ? [mockRule]
      : path === '/admin/claim-categories' ? [{ id: 1, name: 'Services', is_active: true }]
      : path === '/admin/cadres' ? [{ id: 1, code: 'CHW', name: 'CHW', fields: [] }]
      : [{ id: 1, name: 'Iringa' }],
    error: null, loading: false, reload: mockReload,
  }),
}));

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockManage = true;
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.post.mockResolvedValue({ ...mockRule });
  api.put.mockResolvedValue({ ...mockRule });
  api.del.mockResolvedValue({ message: 'Rate deleted.' });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const button = text => [...document.querySelectorAll('button')].find(el => el.textContent === text);
const change = (el, value) => act(() => Simulate.change(el, { target: { value } }));
const field = label => [...document.querySelectorAll('label')].find(el => el.querySelector('.field-label')?.textContent === label)?.querySelector('input,select');
const render = () => act(() => root.render(<RateRulesSection />));

test('rates show active status and no approval actions', () => {
  render();
  expect(container.textContent).toContain('Saved rates are active immediately');
  expect(container.textContent).not.toContain('Pending approval');
  expect(button('Approve')).toBeUndefined();
  expect(button('Reject')).toBeUndefined();
  expect(button('Edit')).toBeDefined();
  expect(button('Delete')).toBeDefined();
});

test('add rate saves directly without an approval request', async () => {
  render();
  act(() => Simulate.click(button('Add rate')));
  change(field('Claim category *'), '1');
  change(field('Component name *'), 'Transport');
  change(field('Rate *'), '25000');
  change(field('Unit type *'), 'FIXED');
  await act(async () => { Simulate.submit(button('Save rate').closest('form')); });
  expect(api.post).toHaveBeenCalledWith('/admin/rate-rules', expect.objectContaining({
    category_id: 1, component_name: 'Transport', rate_value: 25000, unit_type: 'FIXED',
  }));
  expect(container.textContent).toContain('Rate saved and active');
  expect(mockReload).toHaveBeenCalledTimes(1);
});

test('edit rate loads its values and sends the changed amount', async () => {
  render();
  act(() => Simulate.click(button('Edit')));
  expect(field('Rate *').value).toBe('40000');
  change(field('Rate *'), '50000');
  await act(async () => { Simulate.submit(button('Save rate').closest('form')); });
  expect(api.put).toHaveBeenCalledWith('/admin/rate-rules/10', expect.objectContaining({ rate_value: 50000 }));
  expect(api.post).not.toHaveBeenCalled();
});

test('delete requires confirmation and explains history protection', async () => {
  render();
  act(() => Simulate.click(button('Delete')));
  expect(document.body.textContent).toContain('existing claim amounts do not change');
  expect(api.del).not.toHaveBeenCalled();
  act(() => Simulate.click(button('Cancel')));
  expect(api.del).not.toHaveBeenCalled();
  act(() => Simulate.click(button('Delete')));
  await act(async () => { Simulate.click(button('Delete rate')); });
  expect(api.del).toHaveBeenCalledWith('/admin/rate-rules/10');
  expect(container.textContent).toContain('Rate deleted.');
});

test('deletion failure remains visible and read-only users have no edit controls', async () => {
  render();
  api.del.mockRejectedValue(new Error('Unable to delete rate'));
  act(() => Simulate.click(button('Delete')));
  await act(async () => { Simulate.click(button('Delete rate')); });
  expect(document.body.textContent).toContain('Unable to delete rate');
  act(() => Simulate.click(button('Cancel')));
  mockManage = false;
  render();
  expect(button('Add rate')).toBeUndefined();
  expect(button('Edit')).toBeUndefined();
  expect(button('Delete')).toBeUndefined();
});
