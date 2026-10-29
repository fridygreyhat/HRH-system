import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MyWorkLogs } from './MyWorkLogs';
import { api } from '../api';

let mockCadre = 'CHW';
let mockLogs = [];
const mockPeriods = [{ id: 7, start_date: '2026-10-25', end_date: '2026-10-31',
  status: 'CLOSED', region_id: 1, period_label: 'Hidden finance setup label' }];
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ me: { staff: { id: 1 }, cadre: { code: mockCadre, name: mockCadre } }, t: key => key }),
}));
jest.mock('../format', () => ({
  ...jest.requireActual('../format'), todayLocal: () => '2026-10-29',
}));
jest.mock('../api', () => ({ api: { post: jest.fn() } }));
jest.mock('../hooks', () => ({
  ...jest.requireActual('../hooks'),
  useApi: path => ({ data: path.includes('worklogs') ? mockLogs : mockPeriods, loading: false, error: null, reload: jest.fn() }),
}));
jest.mock('../components/worklogs/ApprovalStepper', () => ({ MiniStepper: () => null }));
jest.mock('../components/worklogs/WorkLogEditor', () => ({
  WorkLogEditor: ({ logId, initialMonth }) => `Opened record ${logId} for ${initialMonth}`,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test.each(['CHW', 'HCP', 'DATA_CLERK'])('%s chooses a month and corrects existing Payroll without creating a duplicate', async cadre => {
  mockCadre = cadre;
  mockLogs = [{ id: 31, period_id: 7, work_type: 'PAYROLL', status: 'REJECTED', entry_count: 2, total_hours: 8 }];
  api.post.mockClear();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(<MyWorkLogs />));
    expect(container.querySelector('input[type="month"]').value).toBe('2026-10');
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.textContent).not.toContain('Hidden finance setup label');
    act(() => Simulate.change(container.querySelector('select'), { target: { value: 'PAYROLL' } }));
    expect(container.textContent).toContain('needs correction');
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Correct Payroll');
    expect(button.disabled).toBe(false);
    await act(async () => Simulate.submit(container.querySelector('form')));
    expect(container.textContent).toContain('Opened record 31 for 2026-10');
    expect(api.post).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
