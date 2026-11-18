import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { DeleteUser } from './UsersSection';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockPost = jest.fn();
jest.mock('../../api', () => ({ api: { post: (...args) => mockPost(...args) } }));

test('deleting needs the username typed exactly and a reason, and says what happened', async () => {
  mockPost.mockResolvedValue({ completely: false, staff_id: 9 });
  const onDeleted = jest.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<DeleteUser user={{ id: 7, username: 'janeth.mandepu', staff_id: 9 }} onDeleted={onDeleted} />));
  try {
    const [typed, reason] = container.querySelectorAll('input');
    const button = container.querySelector('button[type="submit"]');
    expect(container.textContent).toContain('The linked staff record stays in the staff registry.');
    await act(async () => Simulate.change(typed, { target: { value: 'janeth' } }));
    await act(async () => Simulate.change(reason, { target: { value: 'Left the project' } }));
    expect(button.disabled).toBe(true);  // not the exact username
    await act(async () => Simulate.change(typed, { target: { value: 'janeth.mandepu' } }));
    expect(button.disabled).toBe(false);
    await act(async () => Simulate.submit(container.querySelector('form'), { preventDefault() {} }));
    expect(mockPost).toHaveBeenCalledWith('/admin/users/7/delete', { confirmation: 'janeth.mandepu', reason: 'Left the project' });
    expect(onDeleted.mock.calls[0][0]).toContain('marked "(deleted)"');
    expect(onDeleted.mock.calls[0][0]).toContain('staff registry');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
