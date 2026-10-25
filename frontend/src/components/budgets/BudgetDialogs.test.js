import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { CreateLineModal, EditAllocationModal } from './BudgetDialogs';
import { api } from '../../api';
import { canManageBudgetLine, creatableBudgetOrganizations } from './budgetAccess';
import { budgetStatus, totalsByCurrency } from './BudgetHierarchy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockExistingLines = [];
jest.mock('../../hooks', () => ({
  useApi: path => ({
    data: path === '/organizations'
      ? { organizations: [], regions: [{ id: 7, name: 'Mara' }], assignments: [{ organization_id: 2, region_id: 7, is_active: true }], can_manage: false }
      : path === '/budgets/lines' ? mockExistingLines : null,
    error: null, loading: false, reload: jest.fn(),
  }),
  useAction: () => ({ busy: false, error: null, setError: jest.fn(), run: async fn => fn() }),
}));
jest.mock('../../api', () => ({
  api: {
    post: jest.fn().mockResolvedValue({ id: 4 }),
    put: jest.fn().mockResolvedValue({ id: 4, code: 'B-4' }),
  },
}));

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

test('estimate is optional and blank remains null while zero remains an explicit estimate', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CreateLineModal
    organizations={[{ id: 1, name: 'FHI360', code: null, type: 'FHI360', is_active: true }]}
    categories={[{ id: 5, name: 'Services', is_active: true }]}
    periods={[{ id: 11, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Global Jan', region_id: null }]}
    regions={[]}
    onClose={jest.fn()}
    onCreated={jest.fn()}
  />));
  try {
    const inputs = container.querySelectorAll('input');
    act(() => {
      Simulate.change(inputs[0], { target: { value: 'B-4' } });
      Simulate.change(inputs[1], { target: { value: 'Outreach' } });
      Simulate.change(inputs[2], { target: { value: '100' } });
    });
    const selects = container.querySelectorAll('select');
    act(() => {
      Simulate.change(selects[0], { target: { value: '1' } });
      Simulate.change(selects[1], { target: { value: '5' } });
      Simulate.change(selects[2], { target: { value: '11' } });
    });
    expect(Array.from(inputs).some(input => input.value === '0')).toBe(false);
    const estimate = Array.from(inputs).find(input => input.type === 'number' && input.value === '');
    expect(estimate).toBeTruthy();
    await act(async () => { await Simulate.submit(container.querySelector('form')); });
    expect(api.post).toHaveBeenCalledWith('/budgets/lines', expect.objectContaining({ estimated_amount: null }));
    act(() => Simulate.change(estimate, { target: { value: '0' } }));
    await act(async () => { await Simulate.submit(container.querySelector('form')); });
    expect(api.post).toHaveBeenLastCalledWith('/budgets/lines', expect.objectContaining({ estimated_amount: 0 }));
  } finally { act(() => root.unmount()); container.remove(); }
});

test('estimate validation prevents values above hard cap', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CreateLineModal
    organizations={[{ id: 1, name: 'FHI360', code: null, type: 'FHI360', is_active: true }]}
    categories={[{ id: 5, name: 'Services', is_active: true }]}
    periods={[{ id: 11, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Global Jan', region_id: null }]}
    regions={[]}
    onClose={jest.fn()}
    onCreated={jest.fn()}
  />));
  try {
    const inputs = container.querySelectorAll('input');
    act(() => {
      Simulate.change(inputs[0], { target: { value: 'B-4' } });
      Simulate.change(inputs[1], { target: { value: 'Outreach' } });
      Simulate.change(inputs[2], { target: { value: '25' } });
      Simulate.change(inputs[3], { target: { value: '26' } });
    });
    const selects = container.querySelectorAll('select');
    act(() => {
      Simulate.change(selects[0], { target: { value: '1' } });
      Simulate.change(selects[1], { target: { value: '5' } });
      Simulate.change(selects[2], { target: { value: '11' } });
    });
    expect(container.textContent).toContain('Estimated spend must be between zero and the hard cap.');
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Create line').disabled).toBe(true);
    await act(async () => { await Simulate.submit(container.querySelector('form')); });
    expect(api.post).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); }
});

test('edit allocation sends estimate, hard cap and required audit reason', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const line = { id: 9, code: 'CSO-9', estimated_amount: null, allocated_amount: 120, committed_amount: 20, spent_amount: 10, currency: 'TZS' };
  act(() => root.render(<EditAllocationModal line={line} onClose={jest.fn()} onDone={jest.fn()} />));
  try {
    const inputs = container.querySelectorAll('input');
    act(() => {
      Simulate.change(inputs[0], { target: { value: '90' } });
      Simulate.change(inputs[1], { target: { value: '100' } });
      Simulate.change(container.querySelector('textarea'), { target: { value: 'Updated forecast' } });
    });
    await act(async () => { await Simulate.submit(container.querySelector('form')); });
    expect(api.put).toHaveBeenCalledWith('/budgets/lines/9/allocation', {
      estimated_amount: 90, allocated_amount: 100, reason: 'Updated forecast',
    });
  } finally { act(() => root.unmount()); container.remove(); }
});

test('edit allocation blocks hard cap below current exposure and explains estimate-first adjustment', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const line = { id: 9, code: 'CSO-9', estimated_amount: 90, allocated_amount: 120, committed_amount: 20, spent_amount: 10, currency: 'TZS' };
  act(() => root.render(<EditAllocationModal line={line} onClose={jest.fn()} onDone={jest.fn()} />));
  try {
    const inputs = container.querySelectorAll('input');
    act(() => {
      Simulate.change(inputs[0], { target: { value: '110' } });
      Simulate.change(inputs[1], { target: { value: '100' } });
    });
    expect(container.textContent).toContain('Adjust the estimate first');
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Save allocation').disabled).toBe(true);
    act(() => {
      Simulate.change(inputs[0], { target: { value: '20' } });
      Simulate.change(inputs[1], { target: { value: '20' } });
    });
    expect(container.textContent).toContain('The hard cap cannot be below current exposure');
    expect(api.put).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); }
});

test('allocation access is limited to central finance and a CSO finance user own active CSO', () => {
  const line = { id: 1, organization_id: 2 };
  const orgs = [
    { id: 2, type: 'CSO', is_active: true },
    { id: 3, type: 'CSO', is_active: true },
    { id: 4, type: 'CSO', is_active: false },
    { id: 5, type: 'FHI360', is_active: true },
  ];
  const cso = { roles: ['CSO_FINANCE'], scopes: [{ organization_id: 2 }], organizations: [] };
  const central = { roles: ['FHI360_FINANCE', 'OVERSIGHT'], scopes: [], organizations: [] };
  const oversight = { roles: ['OVERSIGHT'], scopes: [], organizations: [] };
  const assignments = [{ organization_id: 2, region_id: 7, is_active: true }, { organization_id: 3, region_id: 7, is_active: true }];
  expect(canManageBudgetLine(cso, { ...line, region_id: 7 }, orgs, assignments)).toBe(true);
  expect(canManageBudgetLine(cso, { organization_id: 3, region_id: 7 }, orgs, assignments)).toBe(false);
  expect(canManageBudgetLine(cso, { organization_id: 4, region_id: 7 }, orgs, assignments)).toBe(false);
  expect(canManageBudgetLine(central, { organization_id: 3, region_id: 7 }, orgs, assignments)).toBe(true);
  expect(canManageBudgetLine(central, { organization_id: 5 }, orgs, assignments)).toBe(true);
  expect(canManageBudgetLine(oversight, { ...line, region_id: 7 }, orgs, assignments)).toBe(false);
  expect(creatableBudgetOrganizations(central, orgs).map(org => org.id)).toEqual([2, 3, 5]);
});

test('estimate warning and summary keep currency separate and unknown estimates out of totals', () => {
  const rows = [
    { currency: 'TZS', allocated_amount: 100, committed_amount: 20, spent_amount: 5, estimated_amount: 20, budget_status: 'ESTIMATE_REACHED' },
    { currency: 'TZS', allocated_amount: 80, committed_amount: 0, spent_amount: 0, estimated_amount: null },
    { currency: 'USD', allocated_amount: 10, committed_amount: 0, spent_amount: 0, estimated_amount: 0 },
  ];
  expect(budgetStatus(rows[0])).toBe('ESTIMATE_REACHED');
  const totals = totalsByCurrency(rows);
  expect(totals.map(total => [total.currency, total.estimated, total.estimatesSet, total.estimatesNotSet])).toEqual([
    ['TZS', 20, 1, 1], ['USD', 0, 1, 0],
  ]);
});
