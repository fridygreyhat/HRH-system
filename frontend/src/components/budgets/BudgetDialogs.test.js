import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { CreateLineModal } from './BudgetDialogs';
import { api } from '../../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockExistingLines = [];
jest.mock('../../hooks', () => ({
  useApi: path => ({
    data: path === '/organizations'
      ? { organizations: [], regions: [{ id: 7, name: 'Mara' }], assignments: [{ organization_id: 2, region_id: 7, is_active: true }], can_manage: false }
      : path === '/budgets/lines' ? mockExistingLines : null,
    error: null, loading: false, reload: jest.fn(),
  }),
  useAction: () => ({ busy: false, error: null, run: async fn => fn() }),
}));
jest.mock('../../api', () => ({ api: { post: jest.fn().mockResolvedValue({ id: 4 }) } }));

afterEach(() => {
  mockExistingLines = [];
  jest.clearAllMocks();
});

test('CSO budget form only offers actively mapped regions and applicable periods', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const close = jest.fn();
  act(() => root.render(<CreateLineModal
    organizations={[
      { id: 1, name: 'FHI360', code: null, type: 'FHI360', is_active: true },
      { id: 2, name: 'Afya Kwanza', code: null, type: 'CSO', is_active: true },
    ]}
    categories={[{ id: 5, name: 'Services', is_active: true }]}
    periods={[
      { id: 11, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Global Jan', region_id: null },
      { id: 12, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Mara Jan', region_id: 7 },
      { id: 13, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Dodoma Jan', region_id: 8 },
    ]}
    regions={[{ id: 7, name: 'Mara' }, { id: 8, name: 'Dodoma' }]}
    onClose={close}
    onCreated={jest.fn()}
  />));
  try {
    const selects = container.querySelectorAll('select');
    act(() => Simulate.change(selects[0], { target: { value: '2' } }));
    const regionSelect = Array.from(container.querySelectorAll('select')).find(select => Array.from(select.options).some(option => option.value === '7'));
    expect(Array.from(regionSelect.options).map(option => option.value)).toEqual(['', '7']);
    expect(regionSelect.value).toBe('');
    expect(Array.from(regionSelect.options).some(option => option.textContent.includes('All regions'))).toBe(false);
    act(() => Simulate.change(regionSelect, { target: { value: '7' } }));
    const periodSelect = Array.from(container.querySelectorAll('select')).find(select => Array.from(select.options).some(option => option.value === '11'));
    expect(Array.from(periodSelect.options).map(option => option.value)).toEqual(['', '11', '12']);
    expect(api.post).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); }
});

test('duplicate CSO allocation bucket is blocked regardless of budget code', () => {
  mockExistingLines = [{
    organization_id: 2, region_id: 7, category_id: 5, period_id: 12, code: 'OLD-CODE',
  }];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CreateLineModal
    organizations={[{ id: 2, name: 'Afya Kwanza', code: null, type: 'CSO', is_active: true }]}
    categories={[{ id: 5, name: 'Services', is_active: true }]}
    periods={[
      { id: 11, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Global Jan', region_id: null },
      { id: 12, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Mara Jan', region_id: 7 },
    ]}
    regions={[{ id: 7, name: 'Mara' }]}
    onClose={jest.fn()}
    onCreated={jest.fn()}
  />));
  try {
    const selects = container.querySelectorAll('select');
    const region = Array.from(selects).find(select => Array.from(select.options).some(option => option.value === '7'));
    act(() => Simulate.change(region, { target: { value: '7' } }));
    const period = Array.from(container.querySelectorAll('select')).find(select => Array.from(select.options).some(option => option.value === '12'));
    const category = Array.from(container.querySelectorAll('select')).find(select => Array.from(select.options).some(option => option.value === '5'));
    act(() => Simulate.change(period, { target: { value: '12' } }));
    act(() => Simulate.change(category, { target: { value: '5' } }));
    expect(container.textContent).toContain('A CSO budget already exists for this organization, region, category, and pay period.');
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Create line').disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); }
});

test('FHI360 regional pay period options are limited to the selected region', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CreateLineModal
    organizations={[{ id: 1, name: 'FHI360', code: null, type: 'FHI360', is_active: true }]}
    categories={[{ id: 5, name: 'Services', is_active: true }]}
    periods={[
      { id: 11, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Global Jan', region_id: null },
      { id: 12, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Mara Jan', region_id: 7 },
      { id: 13, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Dodoma Jan', region_id: 8 },
    ]}
    regions={[{ id: 7, name: 'Mara' }, { id: 8, name: 'Dodoma' }]}
    onClose={jest.fn()}
    onCreated={jest.fn()}
  />));
  try {
    const region = Array.from(container.querySelectorAll('select')).find(select => Array.from(select.options).some(option => option.value === '8'));
    act(() => Simulate.change(region, { target: { value: '7' } }));
    const period = Array.from(container.querySelectorAll('select')).find(select => Array.from(select.options).some(option => option.value === '11'));
    expect(Array.from(period.options).map(option => option.value)).toEqual(['', '11', '12']);
  } finally { act(() => root.unmount()); container.remove(); }
});
