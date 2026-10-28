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

test('shows actionable failed sign-ins and excludes Super Admins from bulk reset', async () => {
  api.post.mockResolvedValue({ reset_count: 2, super_admins_unchanged: 1 });
  const onReset = jest.fn();
  act(() => root.render(<AccountRecovery users={users} onReset={onReset} />));
  expect(container.textContent).toContain('Incorrect password. Reset the password if needed.');
  act(() => Simulate.click(button('Reset all non-Super-Admin passwords')));
  expect(container.textContent).toContain('reset 2 accounts');
  expect(container.textContent).toContain('All 1 Super Admin account(s) will remain unchanged');
  expect(button('Confirm password reset').disabled).toBe(true);
  change(container.querySelector('input[type=password]'), 'Temporary-test-947');
  change(container.querySelector('textarea'), 'Recover accounts after sign-in failures');
  change(container.querySelector('input[autocomplete=off]'), RESET_CONFIRMATION);
  expect(button('Confirm password reset').disabled).toBe(false);
  const form = container.querySelector('input[type=password]').closest('form');
  await act(async () => { Simulate.submit(form); });
  expect(api.post).toHaveBeenCalledWith('/admin/user-password-reset', {
    new_password: 'Temporary-test-947', confirmation: RESET_CONFIRMATION, expected_count: 2,
    reason: 'Recover accounts after sign-in failures',
  });
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('2 account passwords reset');
  expect(container.querySelector('input[type=password]')).toBeNull();
});

test('cancelling a reset clears its temporary password without sending a request', () => {
  act(() => root.render(<AccountRecovery users={users} onReset={() => {}} />));
  act(() => Simulate.click(button('Reset all non-Super-Admin passwords')));
  change(container.querySelector('input[type=password]'), 'Temporary-test-947');
  act(() => Simulate.click(button('Cancel')));
  act(() => Simulate.click(button('Reset all non-Super-Admin passwords')));
  expect(container.querySelector('input[type=password]').value).toBe('');
  expect(api.post).not.toHaveBeenCalled();
});
