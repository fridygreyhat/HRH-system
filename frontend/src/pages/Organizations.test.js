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

function openCreate(container) {
  act(() => Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Add organization')));
}

function change(element, value) {
  act(() => Simulate.change(element, { target: { value } }));
}

afterEach(() => { mockData = undefined; jest.clearAllMocks(); });

test('creates a CSO with the selected region IDs', async () => {
  mockData = { organizations: [], regions: [{ id: 8, name: 'Mara' }, { id: 9, name: 'Kagera' }], assignments: [], can_manage: true };
  api.post.mockResolvedValue({ id: 21, name: 'Afya Kwanza', type: 'CSO' });
  const { container, root } = mount();
  try {
    openCreate(container);
    const name = container.querySelector('.org-create-form input[maxlength="255"]');
    change(name, 'Afya Kwanza');
    const checkboxes = container.querySelectorAll('.org-region-option input');
    act(() => {
      Simulate.change(checkboxes[0], { target: { checked: true } });
      Simulate.change(checkboxes[1], { target: { checked: true } });
    });
    await act(async () => Simulate.submit(container.querySelector('.org-create-form'), { preventDefault() {} }));
    expect(api.post).toHaveBeenCalledWith('/organizations/create-org', {
      name: 'Afya Kwanza', code: null, type: 'CSO', is_active: true, region_ids: [8, 9],
    });
  } finally { act(() => root.unmount()); container.remove(); }
});

test('Partner creation sends an empty region list and explains its payment scope', async () => {
  mockData = { organizations: [], regions: [{ id: 8, name: 'Mara' }], assignments: [], can_manage: true };
  api.post.mockResolvedValue({ id: 22, name: 'Partner Network', type: 'PARTNER' });
  const { container, root } = mount();
  try {
    openCreate(container);
    change(container.querySelector('.org-create-form input[maxlength="255"]'), 'Partner Network');
    change(container.querySelector('.org-create-form select'), 'PARTNER');
    expect(container.textContent).toContain('Partner organizations do not receive regional payment authority.');
    expect(container.querySelectorAll('.org-region-option')).toHaveLength(0);
    await act(async () => Simulate.submit(container.querySelector('.org-create-form'), { preventDefault() {} }));
    expect(api.post).toHaveBeenCalledWith('/organizations/create-org', {
      name: 'Partner Network', code: null, type: 'PARTNER', is_active: true, region_ids: [],
    });
  } finally { act(() => root.unmount()); container.remove(); }
});

test('inactive CSO links remain visible and can be reactivated', async () => {
  mockData = {
    organizations: [{ id: 1, name: 'Afya Kwanza', code: null, type: 'CSO', is_active: true }],
    regions: [{ id: 8, name: 'Mara' }],
    assignments: [{ id: 5, organization_id: 1, region_id: 8, is_active: false, organization_name: 'Afya Kwanza', region_name: 'Mara' }],
    can_manage: true,
  };
  api.post.mockResolvedValue({ id: 5 });
  const { container, root } = mount();
  try {
    expect(container.textContent).toContain('Inactive');
    change(container.querySelectorAll('.org-assign-form select')[0], '1');
    const regionOptions = Array.from(container.querySelectorAll('.org-assign-form select')[1].options);
    expect(regionOptions.map(option => option.textContent)).toContain('Mara · inactive link');
    const reactivate = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Reactivate');
    await act(async () => Simulate.click(reactivate));
    expect(api.post).toHaveBeenCalledWith('/organizations/assign-cso-region', { organization_id: 1, region_id: 8, is_active: true });
  } finally { act(() => root.unmount()); container.remove(); }
});

test('readonly roles see organization and link status but no management controls', () => {
  mockData = {
    organizations: [{ id: 1, name: 'Afya Kwanza', code: null, type: 'CSO', is_active: true }],
    regions: [{ id: 8, name: 'Mara' }],
    assignments: [{ id: 5, organization_id: 1, region_id: 8, is_active: true, organization_name: 'Afya Kwanza', region_name: 'Mara' }],
    can_manage: false,
  };
  const { container, root } = mount();
  try {
    expect(container.textContent).toContain('Afya Kwanza');
    expect(container.textContent).toContain('Mara');
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.org-assign-form')).toBeNull();
  } finally { act(() => root.unmount()); container.remove(); }
});

test('changing the selected CSO clears the chosen region', () => {
  mockData = {
    organizations: [
      { id: 1, name: 'Afya Kwanza', code: null, type: 'CSO', is_active: true },
      { id: 2, name: 'Tumaini', code: null, type: 'CSO', is_active: true },
    ],
    regions: [{ id: 8, name: 'Mara' }, { id: 9, name: 'Kagera' }],
    assignments: [], can_manage: true,
  };
  const { container, root } = mount();
  try {
    const selects = container.querySelectorAll('.org-assign-form select');
    change(selects[0], '1');
    change(selects[1], '8');
    expect(selects[1].value).toBe('8');
    change(selects[0], '2');
    expect(selects[1].value).toBe('');
  } finally { act(() => root.unmount()); container.remove(); }
});

test('active link deactivation confirms payment impact and preserves history', async () => {
  mockData = {
    organizations: [{ id: 1, name: 'Afya Kwanza', code: null, type: 'CSO', is_active: true }],
    regions: [{ id: 8, name: 'Mara' }],
    assignments: [{ id: 5, organization_id: 1, region_id: 8, is_active: true, organization_name: 'Afya Kwanza', region_name: 'Mara' }],
    can_manage: true,
  };
  api.post.mockResolvedValue({ id: 5 });
  const originalConfirm = window.confirm;
  window.confirm = jest.fn(() => true);
  const { container, root } = mount();
  try {
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
