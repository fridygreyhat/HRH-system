import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { PayPeriods } from './PayPeriods';
import { api } from '../api';

let mockRoles = ['TECHNICAL_OFFICER'];
jest.mock('../AuthContext', () => ({
  useAuth: () => ({
    me: { roles: mockRoles },
    hasRole: (...roles) => roles.some(role => mockRoles.includes(role)),
    t: key => key,
  }),
}));
jest.mock('../api', () => ({
  api: { post: jest.fn(), put: jest.fn() },
  ApiError: class extends Error {},
}));
jest.mock('../hooks', () => ({
  ...jest.requireActual('../hooks'),
  useApi: path => ({
    data: path === '/admin/pay-period-regions' ? [{ id: 7, name: 'Assigned region' }] : [
      { id: 1, period_label: 'Global September', start_date: '2026-09-01', end_date: '2026-09-30', region_id: null, status: 'OPEN', can_manage: false },
      { id: 2, period_label: 'Regional September', start_date: '2026-09-01', end_date: '2026-09-30', region_id: 7, region_name: 'Assigned region', status: 'OPEN', can_manage: true },
      { id: 3, period_label: 'October 2026', start_date: '2026-10-01', end_date: '2026-10-31', region_id: null, status: 'OPEN', can_manage: false, can_delete: false },
    ],
    error: null, loading: false, reload: jest.fn().mockResolvedValue(undefined),
  }),
}));

test('Technical Officer sees global periods read-only and can create a period in an assigned region', async () => {
  mockRoles = ['TECHNICAL_OFFICER'];
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  api.post.mockResolvedValue({});
  try {
    act(() => root.render(<PayPeriods />));
    expect(Array.from(container.querySelectorAll('button')).filter(b => b.textContent === 'Edit')).toHaveLength(1);
    const create = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Set up period');
    act(() => create.click());
    const form = document.querySelector('form');
    const region = Array.from(form.querySelectorAll('select')).find(select =>
      Array.from(select.options).some(option => option.value === '7'));
    expect(Array.from(region.options).some(option => option.value === 'global')).toBe(false);
    act(() => {
      Simulate.change(region, { target: { value: '7' } });
      const dates = form.querySelectorAll('input[type="date"]');
      Simulate.change(dates[0], { target: { value: '2026-09-01' } });
      Simulate.change(dates[1], { target: { value: '2026-09-30' } });
    });
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.post).toHaveBeenCalledWith('/admin/pay-periods', expect.objectContaining({
      start_date: '2026-09-01', end_date: '2026-09-30', status: 'OPEN', region_id: 7,
    }));
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('Super Admin cannot see or invoke the removed October work reset', () => {
  mockRoles = ['SUPER_ADMIN', 'SYSTEM_ADMIN'];
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  api.post.mockClear();
  try {
    act(() => root.render(<PayPeriods />));
    expect(container.textContent).toContain('October 2026');
    expect(container.textContent).not.toContain('Clear October');
    expect(container.textContent).not.toContain('CLEAR OCTOBER');
    expect(api.post).not.toHaveBeenCalled();
    expect([...container.querySelectorAll('button')].filter(button => button.textContent === 'Delete')).toHaveLength(3);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
