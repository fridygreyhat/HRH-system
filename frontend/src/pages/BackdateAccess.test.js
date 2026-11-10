import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { BackdateAccess } from './BackdateAccess';
import { useAction, useApi } from '../hooks';
import { useAuth } from '../AuthContext';
import { api } from '../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('../hooks', () => ({ useApi: jest.fn(), useAction: jest.fn() }));
jest.mock('../AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), api: { post: jest.fn(), del: jest.fn() } }));

const grants = [{ id: 7, staff_id: 4, provider_name: 'Janeth Mandepu', entry_date: '2026-10-01', end_date: '2026-10-07',
  expires_at: '2026-11-10T09:00:00Z', reason: 'Missed week', granted_by_name: 'Denis Bikaru', revoked_at: null, status: 'ACTIVE' }];

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-09T09:00:00+03:00'));
  useAuth.mockReturnValue({ lang: 'en', hasRole: () => true });
  useApi.mockReturnValue({ data: { grace_hours: 72, providers: [{ id: 4, name: 'Janeth Mandepu', cadre: 'HCP', region: 'Iringa' }], grants },
    error: null, loading: false, reload: jest.fn() });
  useAction.mockReturnValue({ busy: false, error: null, setError: jest.fn(), run: async (fn) => fn() });
  api.post.mockResolvedValue({});
});
afterEach(() => jest.useRealTimers());

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<BackdateAccess />));
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

const set = (el, value) => act(() => Simulate.change(el, { target: { value } }));

test('a grant can reopen one date or a range of dates', async () => {
  const { container, unmount } = mount();
  try {
    expect(container.textContent).toMatch(/2026 – .*7.*2026|7.*2026 – /); // the listed grant shows its range
    const [from, to] = container.querySelectorAll('input[type="date"]');
    set(from, '2026-10-01');
    // The page waits for the provider list of the new start date before allowing a grant.
    const ready = useApi(); useApi.mockReturnValue({ ...ready, loading: true });
    set(container.querySelector('textarea'), 'x');
    useApi.mockReturnValue({ ...ready, loading: false });
    set(container.querySelector('textarea'), 'xy');
    set(container.querySelector('select'), '4');
    set(container.querySelector('textarea'), 'Missed week of work');
    set(to, '2026-11-05'); // 36 days: too long
    expect(container.textContent).toContain('at most 31 days');
    expect(container.querySelector('button.btn-primary').disabled).toBe(true);
    set(to, '2026-10-07');
    expect(container.textContent).toContain('7 days');
    await act(async () => { Simulate.submit(container.querySelector('form')); });
    expect(api.post).toHaveBeenLastCalledWith('/backdate-access', expect.objectContaining({ staff_id: 4, entry_date: '2026-10-01', end_date: '2026-10-07' }));
    set(to, '');
    set(container.querySelector('select'), '4');
    set(container.querySelector('textarea'), 'One missed day');
    await act(async () => { Simulate.submit(container.querySelector('form')); });
    expect(api.post).toHaveBeenLastCalledWith('/backdate-access', expect.objectContaining({ entry_date: '2026-10-01', end_date: null }));
  } finally {
    unmount();
  }
});
