import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { AccountRecovery, RESET_CONFIRMATION } from './AccountRecovery';
import { api } from '../../api';

const mockReload = jest.fn();
jest.mock('../../hooks', () => ({
  useApi: () => ({ data: [{ id: 1, created_at: '2026-10-28T12:00:00Z', username: 'test.user',
    reason: 'bad_password', message: 'Incorrect password. Reset the password if needed.' }],
  error: null, loading: false, reload: mockReload }),
}));
jest.mock('../../api', () => ({ api: { post: jest.fn() }, qs: () => '' }));

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); jest.clearAllMocks();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const button = text => [...container.querySelectorAll('button')].find(el => el.textContent === text);
const users = [{ id: 1, roles: ['SUPER_ADMIN'] }, { id: 2, roles: ['PROVIDER'] }, { id: 3, roles: ['CSO_FINANCE'] }];
const change = (el, value) => act(() => Simulate.change(el, { target: { value } }));

test('shows actionable failed sign-ins and gives each non-Super-Admin account its own password, downloaded once', async () => {
  const passwords = [
    { username: 'chw.one', full_name: 'Chw One', phone: '+255712000001', temporary_password: 'aB3dE5fG7hJ9' },
    { username: 'cso.fin', full_name: 'Cso Fin', phone: '+255712000002', temporary_password: 'kM4nP6qR8sT2' },
  ];
  api.post.mockResolvedValue({ reset_count: 2, super_admins_unchanged: 1, passwords });
  const saved = [];
  global.URL.createObjectURL = jest.fn(blob => { saved.push(blob); return 'blob:passwords'; });
  global.URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const onReset = jest.fn();
  act(() => root.render(<AccountRecovery users={users} onReset={onReset} />));
  expect(container.textContent).toContain('Incorrect password. Reset the password if needed.');
  act(() => Simulate.click(button('Reset all non-Super-Admin passwords')));
  expect(container.textContent).toContain('reset 2 accounts');
  expect(container.textContent).toContain('All 1 Super Admin account(s) will remain unchanged');
  expect(container.querySelector('input[type=password]')).toBeNull(); // nobody types one shared password any more
  expect(button('Confirm password reset').disabled).toBe(true);
  change(container.querySelector('textarea'), 'Recover accounts after sign-in failures');
  change(container.querySelector('input[autocomplete=off]'), RESET_CONFIRMATION);
  expect(button('Confirm password reset').disabled).toBe(false);
  await act(async () => { Simulate.submit(container.querySelector('textarea').closest('form')); });
  expect(api.post).toHaveBeenCalledWith('/admin/user-password-reset', {
    confirmation: RESET_CONFIRMATION, expected_count: 2, reason: 'Recover accounts after sign-in failures',
  });
  expect(click).toHaveBeenCalledTimes(1);
  const csv = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(saved[0]); });
  expect(csv).toContain('"chw.one","Chw One","+255712000001","aB3dE5fG7hJ9"');
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('2 accounts reset, each with its own temporary password');
  click.mockRestore();
});

test('cancelling a reset sends no request', () => {
  act(() => root.render(<AccountRecovery users={users} onReset={() => {}} />));
  act(() => Simulate.click(button('Reset all non-Super-Admin passwords')));
  change(container.querySelector('textarea'), 'Recover accounts after sign-in failures');
  act(() => Simulate.click(button('Cancel')));
  act(() => Simulate.click(button('Reset all non-Super-Admin passwords')));
  expect(container.querySelector('textarea').value).toBe('');
  expect(api.post).not.toHaveBeenCalled();
});
