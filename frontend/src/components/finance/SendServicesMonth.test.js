import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { SendServicesMonth } from './SendServicesMonth';
import * as apiModule from '../../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const status = {
  counts: { review: 1, ready: 2, hold: 0, sent: 3 }, ready_total: '80000', currency: 'TZS',
  ready: [{ work_log_id: 5, provider_name: 'Asha', amount: '40000' }, { work_log_id: 6, provider_name: 'Juma', amount: '40000' }],
  central_reviewers: [{ id: 9, name: 'George Massawe', username: 'george' }],
};
jest.mock('../../hooks', () => ({
  useApi: (path) => ({ data: path ? status : null, error: null, loading: false, reload: jest.fn() }),
  useAction: () => ({ busy: false, error: null, run: async (fn) => fn() }),
}));

test('Regional Finance sends the checked Services of the month in one step', async () => {
  const post = jest.spyOn(apiModule.api, 'post').mockResolvedValue({ count: 2 });
  const onSent = jest.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<SendServicesMonth regions={[{ id: 11, name: 'Iringa' }]} regionId="" sw={false} onSent={onSent} />));
  try {
    expect(container.textContent).toContain('Ready to send');
    expect(container.textContent).toContain('1 still to check will stay here');
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Send 2 to Central Finance');
    expect(button.disabled).toBe(true);
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(post).toHaveBeenCalledWith('/finance/services-month/send', expect.objectContaining({ region_id: 11, central_reviewer_id: 9, review_confirmed: true }));
    expect(container.textContent).toContain('2 Services sent to Central Finance.');
    expect(onSent).toHaveBeenCalled();
  } finally {
    act(() => root.unmount()); container.remove(); post.mockRestore();
  }
});
