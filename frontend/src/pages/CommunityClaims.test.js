import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { CommunityClaims } from './CommunityClaims';
import { api } from '../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockRoles = ['PROVIDER'];
let mockClaims = [];
let mockCatalogFields = [{ key: 'visits', label: 'Visits completed', unit_type: 'PER_UNIT' }];
let mockConfigurationError = null;
let mockCategories = [{ id: 5, name: 'Community outreach', unit_fields: mockCatalogFields, configuration_error: mockConfigurationError }];
let mockPaths = [];

jest.mock('../AuthContext', () => ({ useAuth: () => ({ me: { id: 99, staff: { id: 99 } }, hasRole: (...roles) => roles.some(role => mockRoles.includes(role)) }) }));
jest.mock('../api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  qs: params => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value).map(([key, value]) => [key, String(value)])).toString();
    return query ? `?${query}` : '';
  },
}));
jest.mock('../hooks', () => ({
  useApi: path => {
    mockPaths.push(path);
    return {
      data: path === null ? null : path === '/community-claims/options'
        ? { periods: [{ id: 7, start_date: '2025-01-01', end_date: '2025-01-31', period_label: 'January 2025' }], categories: [] }
        : path && path.startsWith('/community-claims/options') && path.includes('period_id=7')
          ? { periods: [], categories: mockCategories.map(category => ({ ...category, unit_fields: mockCatalogFields, configuration_error: mockConfigurationError })) }
          : path && path.startsWith('/claims?work_type=COMMUNITY') ? mockClaims : [],
      error: null, loading: false, reload: jest.fn(), setData: jest.fn(),
    };
  },
  useAction: () => ({ busy: false, error: null, setError: jest.fn(), run: async fn => { try { return await fn(); } catch (error) { return undefined; } } }),
}));
jest.mock('../components/claims/ClaimDrawer', () => ({
  ClaimDrawer: ({ claimId }) => <div role="dialog">Opened claim #{claimId}</div>,
  ComponentsTable: () => <div>Calculated components</div>,
}));

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CommunityClaims />));
  return { container, root };
}

test('provider previews a period aggregate, explicitly saves draft and opens its claim details', async () => {
  api.post.mockImplementation((path) => Promise.resolve(path.endsWith('/preview')
    ? { amount: 12000, currency: 'TZS', components: [], payor_name: 'Kijiji CSO', region_name: 'Mara', budget_line_id: null }
    : { id: 88, status: 'DRAFT' }));
  const { container, root } = mount();
  try {
    const selects = container.querySelectorAll('select');
    act(() => Simulate.change(selects[0], { target: { value: '7' } }));
    act(() => Simulate.change(container.querySelectorAll('select')[1], { target: { value: '5' } }));
    act(() => Simulate.change(container.querySelector('input[type="number"]'), { target: { value: '12' } }));
    await act(async () => Simulate.submit(container.querySelector('form')));
    expect(api.post).toHaveBeenCalledWith('/community-claims/preview', expect.objectContaining({ period_id: 7, category_id: 5, declared_units: { visits: 12 } }));
    expect(container.textContent).toContain('TZS 12,000');
    expect(container.textContent).toContain('Preview only · not submitted');
    expect(container.textContent).toContain('Save as draft');
    expect(container.textContent).toContain('No regional budget allocation is required');
    expect(container.textContent).not.toContain('budget line');
    await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Save as draft')));
    expect(api.post).toHaveBeenLastCalledWith('/community-claims', expect.objectContaining({ period_id: 7, category_id: 5 }));
    expect(container.textContent).toContain('Opened claim #88');
    expect(container.textContent).toContain('Submit it when you are ready');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('community verifier sees scoped claim register without provider create form', () => {
  mockRoles = ['COMMUNITY_VERIFIER'];
  mockPaths = [];
  const { container, root } = mount();
  try {
    expect(container.textContent).toContain('Claims in your scope');
    expect(container.textContent).not.toContain('Prepare a period claim');
    expect(mockPaths).not.toContain('/community-claims/options');
  } finally {
    act(() => root.unmount());
    container.remove();
    mockRoles = ['PROVIDER'];
    mockPaths = [];
  }
});

test('provider can edit a draft without changing its period or category', async () => {
  mockRoles = ['PROVIDER', 'COMMUNITY_VERIFIER'];
  mockCatalogFields = [{ key: 'new_visits', label: 'New catalog visits field', unit_type: 'PER_UNIT' }];
  mockPaths = [];
  mockClaims = [
    { id: 27, status: 'DRAFT', created_by: 99, staff_name: 'Asha Mollel', category_name: 'Community outreach', period_label: 'January 2025', currency: 'TZS', amount: 1000, amount_paid: 0, route_code: 'C', payment_status: 'NOT_STARTED', updated_at: '2025-01-01T00:00:00Z' },
    { id: 28, status: 'DRAFT', created_by: 55, staff_name: 'Another provider', category_name: 'Community outreach', period_label: 'January 2025', currency: 'TZS', amount: 1000, amount_paid: 0, route_code: 'C', payment_status: 'NOT_STARTED', updated_at: '2025-01-01T00:00:00Z' },
  ];
  api.get.mockResolvedValue({
    id: 27, status: 'DRAFT', period_id: 7, category_id: 5, declared_units: { visits: 4 }, description: 'Earlier note',
    evidence_text: null, created_by: 99, category_name: 'Community outreach', period_label: 'January 2025',
    components: [{ component_name: 'Captured outreach visits', unit_type: 'PER_UNIT', measure_key: 'visits', units: 4, amount: 4000, rate: 1000, rate_rule_id: 1 }],
  });
  api.put.mockResolvedValue({ id: 27, status: 'DRAFT' });
  window.scrollTo = jest.fn();
  const { container, root } = mount();
  try {
    await act(async () => Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Edit')));
    expect(container.textContent).toContain('Period and category are locked');
    expect(container.textContent).toContain('Captured outreach visits');
    expect(container.querySelector('input[type="number"]').value).toBe('4');
    expect(mockPaths.some(path => path && path.includes('period_id=7'))).toBe(false);
    expect(Array.from(container.querySelectorAll('button')).filter(button => button.textContent === 'Edit')).toHaveLength(1);
    act(() => Simulate.change(container.querySelector('input[type="number"]'), { target: { value: '9' } }));
    await act(async () => Simulate.submit(container.querySelector('form')));
    expect(api.put).toHaveBeenCalledWith('/community-claims/27', { declared_units: { visits: 9 }, description: 'Earlier note' });
    expect(container.textContent).toContain('Draft #27 updated');
  } finally {
    mockClaims = [];
    mockRoles = ['PROVIDER'];
    mockCatalogFields = [{ key: 'visits', label: 'Visits completed', unit_type: 'PER_UNIT' }];
    mockConfigurationError = null;
    mockCategories = [{ id: 5, name: 'Community outreach', unit_fields: mockCatalogFields, configuration_error: mockConfigurationError }];
    mockPaths = [];
    act(() => root.unmount());
    container.remove();
  }
});

test('configured category error is shown and prevents preview', () => {
  mockConfigurationError = 'Approved community rates are missing for this category.';
  const { container, root } = mount();
  try {
    act(() => Simulate.change(container.querySelectorAll('select')[0], { target: { value: '7' } }));
    act(() => Simulate.change(container.querySelectorAll('select')[1], { target: { value: '5' } }));
    expect(container.textContent).toContain('Approved community rates are missing');
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Preview amount').disabled).toBe(true);
  } finally {
    mockConfigurationError = null;
    act(() => root.unmount());
    container.remove();
  }
});

test('community category setup guidance requires approved rates but not budget mapping', () => {
  mockCategories = [];
  const { container, root } = mount();
  try {
    act(() => Simulate.change(container.querySelectorAll('select')[0], { target: { value: '7' } }));
    expect(container.textContent).toContain('approved rates');
    expect(container.textContent).not.toContain('budget mapping');
    expect(container.textContent).not.toContain('budget line');
  } finally {
    mockCategories = [{ id: 5, name: 'Community outreach', unit_fields: mockCatalogFields, configuration_error: mockConfigurationError }];
    act(() => root.unmount());
    container.remove();
  }
});
