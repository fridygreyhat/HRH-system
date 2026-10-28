import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { OctoberWorkReset } from './OctoberWorkReset';
import { api } from '../api';

const mockReload = jest.fn();
jest.mock('../api', () => ({ api: { post: jest.fn() } }));
jest.mock('../hooks', () => ({
  useApi: () => ({
    data: {
      counts: { work_logs: 11, work_logs_to_reset: 3, daily_entries: 4, indicator_values: 7, budget_lines_preserved: 1, claims: 0 },
      blockers: [], preview_token: 'a'.repeat(64), confirmation: 'CLEAR OCTOBER 2026', can_reset: true,
    },
    loading: false, error: null, reload: mockReload,
  }),
  useAction: () => ({ error: null, busy: false, run: fn => fn() }),
}));

test('October reset explains preservation and never changes live or preview data from preview', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const close = jest.fn();
  try {
    act(() => root.render(<OctoberWorkReset periodId={2} onClose={close} onDone={jest.fn()} />));
    expect(document.body.textContent).toContain('budget allocation, budget ledger');
    expect(document.body.textContent).toContain('Historical audit records and a pre-reset snapshot are retained');
    expect(document.body.textContent).toContain('development preview');
    const confirm = Array.from(document.querySelectorAll('input')).find(input => input.type !== 'checkbox');
    const checkbox = document.querySelector('input[type="checkbox"]');
    act(() => {
      Simulate.change(confirm, { target: { value: 'CLEAR OCTOBER 2026' } });
      Simulate.change(checkbox, { target: { checked: true } });
    });
    const clear = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Clear October work records');
    expect(clear.disabled).toBe(true);
    await act(async () => Simulate.submit(document.querySelector('form')));
    expect(api.post).not.toHaveBeenCalled();
    const refresh = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Refresh safety check');
    act(() => refresh.click());
    expect(mockReload).toHaveBeenCalled();
    expect(confirm.value).toBe('');
    expect(checkbox.checked).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
