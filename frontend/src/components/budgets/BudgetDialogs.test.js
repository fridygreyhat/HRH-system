import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { activityTypeForFormType, CreateLineModal, EditAllocationModal } from './BudgetDialogs';
import { api } from '../../api';
import { canManageBudgetLine, creatableBudgetOrganizations } from './budgetAccess';
import { budgetStatus, totalsByCurrency } from './BudgetHierarchy';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockExistingLines = [];
const selectWithValue = (container, value) => Array.from(container.querySelectorAll('select'))
  .find((select) => Array.from(select.options).some((option) => option.value === String(value)));
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
    categories={[{ id: 5, name: 'CHW support', form_type: 'CHW_PNP', is_active: true }]}
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
    act(() => Simulate.change(selectWithValue(container, '2'), { target: { value: '2' } }));
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
    categories={[{ id: 5, name: 'CHW support', form_type: 'CHW_PNP', is_active: true }]}
    periods={[
      { id: 11, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Global Jan', region_id: null },
      { id: 12, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Mara Jan', region_id: 7 },
    ]}
    regions={[{ id: 7, name: 'Mara' }]}
    onClose={jest.fn()}
    onCreated={jest.fn()}
  />));
  try {
    const region = selectWithValue(container, '7');
    act(() => Simulate.change(region, { target: { value: '7' } }));
    const period = Array.from(container.querySelectorAll('select')).find(select => Array.from(select.options).some(option => option.value === '12'));
    act(() => Simulate.change(period, { target: { value: '12' } }));
    const activityType = selectWithValue(container, 'SERVICES');
    act(() => Simulate.change(activityType, { target: { value: 'SERVICES' } }));
    expect(container.textContent).toContain('A CSO budget already exists for this organization, region, payment item, and pay period.');
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
    categories={[{ id: 5, name: 'CHW support', form_type: 'CHW_PNP', is_active: true }]}
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
    categories={[{ id: 5, name: 'Outreach item', form_type: 'CHW_PNP', is_active: true }]}
    periods={[{ id: 11, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Global Jan', region_id: null }]}
    regions={[]}
    onClose={jest.fn()}
    onCreated={jest.fn()}
  />));
  try {
    const inputs = container.querySelectorAll('input');
    act(() => Simulate.change(inputs[0], { target: { value: 'B-4' } }));
    act(() => Simulate.change(inputs[1], { target: { value: 'Outreach' } }));
    act(() => Simulate.change(inputs[2], { target: { value: '100' } }));
    expect(container.textContent).toContain('Choose Services or Payroll, then select a matching configured payment item.');
    const activityType = selectWithValue(container, 'SERVICES');
    expect(activityType.required).toBe(true);
    expect(activityType.options.length).toBe(3);
    act(() => Simulate.change(activityType, { target: { value: 'SERVICES' } }));
    expect(container.textContent).toContain('Services · Outreach item.');
    expect(container.querySelector('input[readonly]').value).toBe('Outreach item');
    expect(Array.from(inputs).some(input => input.value === '0')).toBe(false);
    const estimate = Array.from(inputs).find(input => input.type === 'number' && input.value === '');
    expect(estimate).toBeTruthy();
    await act(async () => { await Simulate.submit(container.querySelector('form')); });
    expect(api.post).toHaveBeenCalledWith('/budgets/lines', expect.objectContaining({ category_id: 5, activity_type: 'SERVICES', estimated_amount: null }));
    act(() => Simulate.change(estimate, { target: { value: '0' } }));
    await act(async () => { await Simulate.submit(container.querySelector('form')); });
    expect(api.post).toHaveBeenLastCalledWith('/budgets/lines', expect.objectContaining({ category_id: 5, activity_type: 'SERVICES', estimated_amount: 0 }));
  } finally { act(() => root.unmount()); container.remove(); }
});

test('activity type and payment item are explicit, filtered, and never silently picked from multiple active items', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = {
    organizations: [{ id: 1, name: 'FHI360', code: null, type: 'FHI360', is_active: true }],
    periods: [{ id: 11, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Global Jan', region_id: null }],
    regions: [],
    onClose: jest.fn(),
    onCreated: jest.fn(),
  };
  const categories = [
    { id: 5, name: 'CHW PNP item', form_type: 'CHW_PNP', is_active: true },
    { id: 6, name: 'Community services', form_type: 'COMMUNITY_SERVICE', is_active: true },
    { id: 7, name: 'Monthly salary', form_type: 'SALARY', is_active: true },
    { id: 8, name: 'Retired services item', form_type: 'HCP_PNP', is_active: false },
    { id: 9, name: 'Unclassified item', form_type: null, is_active: true },
  ];
  act(() => root.render(<CreateLineModal {...props} categories={categories} />));
  try {
    const activityType = selectWithValue(container, 'SERVICES');
    expect(Array.from(activityType.options).map((option) => option.value)).toEqual(['', 'SERVICES', 'PAYROLL']);
    expect(activityType.required).toBe(true);
    expect(activityType.value).toBe('');
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Create line').disabled).toBe(true);
    act(() => Simulate.change(activityType, { target: { value: 'SERVICES' } }));
    const paymentItem = selectWithValue(container, '5');
    expect(paymentItem.required).toBe(true);
    expect(Array.from(paymentItem.options).map((option) => option.value)).toEqual(['', '5', '6']);
    expect(paymentItem.value).toBe('');
    expect(container.textContent).not.toContain('Retired services item');
    expect(container.textContent).not.toContain('Unclassified item');
    expect(container.textContent).toContain('Choose one configured payment item for Services.');
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Create line').disabled).toBe(true);
    act(() => Simulate.change(activityType, { target: { value: 'PAYROLL' } }));
    expect(container.querySelector('input[readonly]').value).toBe('Monthly salary');
    act(() => Simulate.change(activityType, { target: { value: 'SERVICES' } }));
    expect(selectWithValue(container, '5').value).toBe('');
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Create line').disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }

  const emptyRoot = createRoot(container);
  act(() => emptyRoot.render(<CreateLineModal {...props} categories={[]} />));
  try {
    const activityType = selectWithValue(container, 'SERVICES');
    act(() => Simulate.change(activityType, { target: { value: 'SERVICES' } }));
    expect(container.textContent).toContain('No active payment items are configured.');
    expect(container.textContent).toContain('cannot be created until an active payment item is configured');
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Create line').disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  } finally {
    act(() => emptyRoot.unmount());
    container.remove();
  }
});

test('activity type mapping is explicit and never guesses from unknown metadata', () => {
  expect(activityTypeForFormType('SALARY')).toBe('PAYROLL');
  expect(activityTypeForFormType('CHW_PNP')).toBe('SERVICES');
  expect(activityTypeForFormType('HCP_PNP')).toBe('SERVICES');
  expect(activityTypeForFormType('COORDINATION')).toBe('SERVICES');
  expect(activityTypeForFormType('COMMUNITY_SERVICE')).toBe('SERVICES');
  expect(activityTypeForFormType(null)).toBe('UNCLASSIFIED');
  expect(activityTypeForFormType('OTHER')).toBe('UNCLASSIFIED');
});

test('metadata refresh cannot submit a payment item that no longer matches selected activity type', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const baseProps = {
    organizations: [{ id: 1, name: 'FHI360', code: null, type: 'FHI360', is_active: true }],
    periods: [{ id: 11, start_date: '2026-01-01', end_date: '2026-01-31', period_label: 'Global Jan', region_id: null }],
    regions: [],
    onClose: jest.fn(),
    onCreated: jest.fn(),
  };
  const initialItems = [
    { id: 5, name: 'Service item', form_type: 'CHW_PNP', is_active: true },
    { id: 6, name: 'Second service item', form_type: 'COMMUNITY_SERVICE', is_active: true },
  ];
  act(() => root.render(<CreateLineModal {...baseProps} categories={initialItems} />));
  try {
    act(() => Simulate.change(selectWithValue(container, 'SERVICES'), { target: { value: 'SERVICES' } }));
    act(() => Simulate.change(selectWithValue(container, '5'), { target: { value: '5' } }));
    act(() => root.render(<CreateLineModal
      {...baseProps}
      categories={[{ id: 7, name: 'Salary item', form_type: 'SALARY', is_active: true }]}
    />));
    expect(container.textContent).toContain('No active payment items are configured for Services.');
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Create line').disabled).toBe(true);
    await act(async () => { await Simulate.submit(container.querySelector('form')); });
    expect(api.post).not.toHaveBeenCalled();
    act(() => Simulate.change(selectWithValue(container, 'PAYROLL'), { target: { value: 'PAYROLL' } }));
    expect(container.querySelector('input[readonly]').value).toBe('Salary item');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('estimate validation prevents values above hard cap', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CreateLineModal
    organizations={[{ id: 1, name: 'FHI360', code: null, type: 'FHI360', is_active: true }]}
    categories={[{ id: 5, name: 'Payment item', form_type: 'CHW_PNP', is_active: true }]}
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
    const activityType = selectWithValue(container, 'SERVICES');
    act(() => Simulate.change(activityType, { target: { value: 'SERVICES' } }));
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
