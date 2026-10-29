import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { PayPeriods } from './PayPeriods';
import { api, ApiError } from '../api';

let mockRoles = ['TECHNICAL_OFFICER'];
let mockDateLocked = false;
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
      { id: 1, period_label: 'Global September', start_date: '2026-09-01', end_date: '2026-09-30', region_id: null, status: 'OPEN', can_manage: mockRoles.includes('SUPER_ADMIN') || mockRoles.includes('CENTRAL_ADMIN') },
      { id: 2, period_label: 'Regional September', start_date: '2026-09-01', end_date: '2026-09-30', region_id: 7, region_name: 'Assigned region', status: 'OPEN', can_manage: true, can_archive: true, can_edit_dates: !mockDateLocked, date_lock_reason: mockDateLocked ? 'Submitted work records protect these dates.' : null },
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

test('protected periods keep dates read-only while allowing label and status edits', async () => {
  mockRoles = ['TECHNICAL_OFFICER'];
  mockDateLocked = true;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  api.put.mockResolvedValue({});
  try {
    act(() => root.render(<PayPeriods />));
    act(() => [...container.querySelectorAll('button')].find(b => b.textContent === 'Edit').click());
    const form = document.querySelector('form');
    expect([...form.querySelectorAll('input[type="date"]')].every(input => input.disabled)).toBe(true);
    expect(form.textContent).toContain('Submitted work records protect these dates.');
    act(() => {
      Simulate.change(form.querySelector('input:not([type="date"])'), { target: { value: 'Corrected label' } });
      const status = [...form.querySelectorAll('select')].find(select => [...select.options].some(o => o.value === 'CLOSED'));
      Simulate.change(status, { target: { value: 'CLOSED' } });
    });
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.put).toHaveBeenLastCalledWith('/admin/pay-periods/2', expect.objectContaining({
      start_date: '2026-09-01', end_date: '2026-09-30', status: 'CLOSED', period_label: 'Corrected label',
    }));
  } finally {
    mockDateLocked = false;
    act(() => root.unmount());
    container.remove();
  }
});

test('unused period dates can be edited and overlap conflicts retain their real message', async () => {
  mockRoles = ['TECHNICAL_OFFICER'];
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  api.put.mockRejectedValueOnce(Object.assign(new ApiError('A pay period already covers these dates in this region'), { status: 409 }));
  try {
    act(() => root.render(<PayPeriods />));
    act(() => [...container.querySelectorAll('button')].find(b => b.textContent === 'Edit').click());
    const form = document.querySelector('form');
    const dates = form.querySelectorAll('input[type="date"]');
    expect(dates[0].disabled).toBe(false);
    act(() => Simulate.change(dates[0], { target: { value: '2026-09-02' } }));
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.put).toHaveBeenLastCalledWith('/admin/pay-periods/2', expect.objectContaining({ start_date: '2026-09-02' }));
    expect(form.textContent).toContain('A pay period already covers these dates in this region');
    expect(form.textContent).not.toContain('This date span is already in use');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('Super Admin can edit an existing global period without moving its region', async () => {
  mockRoles = ['SUPER_ADMIN', 'CENTRAL_ADMIN'];
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  api.put.mockResolvedValue({});
  try {
    act(() => root.render(<PayPeriods />));
    const row = [...container.querySelectorAll('tr')].find(tr => tr.textContent.includes('Global September'));
    act(() => [...row.querySelectorAll('button')].find(b => b.textContent === 'Edit').click());
    const form = document.querySelector('form');
    const region = [...form.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'global'));
    expect(region.value).toBe('global');
    expect(region.disabled).toBe(true);
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.put).toHaveBeenLastCalledWith('/admin/pay-periods/1', expect.objectContaining({ region_id: null }));
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('Super Admin must give a reason and confirm the specific period before archiving', async () => {
  mockRoles = ['SUPER_ADMIN', 'CENTRAL_ADMIN'];
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  api.post.mockClear();
  api.post.mockResolvedValue({ archived: true, id: 2 });
  try {
    act(() => root.render(<PayPeriods />));
    act(() => [...container.querySelectorAll('button')].find(b => b.textContent === 'Archive / restart' && !b.disabled).click());
    const form = document.querySelector('form');
    const submit = form.querySelector('button[type="submit"]');
    expect(submit.disabled).toBe(true);
    expect(form.textContent).toContain('does not erase history or move payments or budgets');
    act(() => Simulate.change(form.querySelector('textarea'), { target: { value: 'Restart monthly testing' } }));
    expect(submit.disabled).toBe(true);
    act(() => Simulate.change(form.querySelector('input'), { target: { value: 'ARCHIVE 2' } }));
    expect(submit.disabled).toBe(false);
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.post).toHaveBeenCalledWith('/admin/pay-periods/2/archive', {
      reason: 'Restart monthly testing', confirmation: 'ARCHIVE 2',
    });
    expect(container.textContent).toContain('Pay period archived.');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
