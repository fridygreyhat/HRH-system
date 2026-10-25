import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { Organizations } from './Organizations';
import { api } from '../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockData;
jest.mock('../hooks', () => ({
  useApi: () => ({ data: mockData, error: null, loading: false, reload: jest.fn().mockResolvedValue(undefined) }),
  useAction: () => ({ busy: false, error: null, run: async fn => { try { return await fn(); } catch (e) { return undefined; } } }),
}));
jest.mock('../api', () => ({ api: { post: jest.fn() } }));

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Organizations />));
  return { container, root };
}

afterEach(() => { mockData = undefined; jest.clearAllMocks(); });

test('mapping page names an empty setup rather than inventing organization-region links', () => {
  mockData = { organizations: [{ id: 2, name: 'Afya Kwanza', code: null, type: 'CSO', is_active: true }], regions: [{ id: 8, name: 'Mara' }], assignments: [], can_manage: false };
  const { container, root } = mount();
  try {
    expect(container.textContent).toContain('No regional assignments configured');
    expect(container.textContent).toContain('Afya Kwanza');
    expect(container.textContent).toContain('No inferred links');
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Assign region')).toBe(false);
  } finally { act(() => root.unmount()); container.remove(); }
});

test('central administrator can create an explicit regional link', async () => {
  mockData = { organizations: [{ id: 2, name: 'Afya Kwanza', code: null, type: 'CSO', is_active: true }], regions: [{ id: 8, name: 'Mara' }], assignments: [], can_manage: true };
  api.post.mockResolvedValue({ id: 91 });
  const { container, root } = mount();
  try {
    const selects = container.querySelectorAll('select');
    act(() => {
      Simulate.change(selects[0], { target: { value: '2' } });
      Simulate.change(selects[1], { target: { value: '8' } });
    });
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.post).toHaveBeenCalledWith('/organizations/assign-cso-region', { organization_id: 2, region_id: 8, is_active: true });
  } finally { act(() => root.unmount()); container.remove(); }
});

test('assignment controls offer active CSOs only and confirm deactivation consequences', async () => {
  mockData = {
    organizations: [
      { id: 1, name: 'Afya Kwanza', code: null, type: 'CSO', is_active: true },
      { id: 2, name: 'Partner Network', code: null, type: 'PARTNER', is_active: true },
      { id: 3, name: 'Inactive CSO', code: null, type: 'CSO', is_active: false },
    ],
    regions: [{ id: 8, name: 'Mara' }],
    assignments: [{ id: 5, organization_id: 1, region_id: 8, is_active: true, organization_name: 'Afya Kwanza', region_name: 'Mara' }],
    can_manage: true,
  };
  api.post.mockResolvedValue({ id: 5 });
  const originalConfirm = window.confirm;
  window.confirm = jest.fn(() => true);
  const { container, root } = mount();
  try {
    const orgSelect = container.querySelector('select');
    expect(Array.from(orgSelect.options).map(option => option.value)).toEqual(['', '1']);
    expect(container.textContent).toContain('Deactivating a link blocks future payroll routing and budget operations');
    const deactivate = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Deactivate');
    await act(async () => Simulate.click(deactivate));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('blocks future payroll routing and budget operations'));
    expect(api.post).toHaveBeenCalledWith('/organizations/assign-cso-region', { organization_id: 1, region_id: 8, is_active: false });
  } finally {
    window.confirm = originalConfirm;
    act(() => root.unmount());
    container.remove();
  }
});
