import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { PrintWorkLog } from './PrintWorkLog';
import { api } from '../api';

jest.mock('../AuthContext', () => ({
  useAuth: () => ({ me: { client_settings: { provider_otp_required: false } } }),
}));
jest.mock('../api', () => ({ api: { get: jest.fn() } }));

function record(cadre = 'CHW') {
  return {
    id: 19, version: 1, status: 'DRAFT', audit: [], work_type: 'PAYROLL',
    period: { start_date: '2026-09-01', end_date: '2026-10-31', period_label: 'September–October' },
    cadre: {
      code: cadre, name: cadre, form_title: `${cadre} timesheet`, hours_mode: cadre === 'CHW' ? 'DIRECT' : 'START_END',
      requires_facility_endorsement: false, activities: [],
      fields: [{ key: 'clients', label_en: 'Clients', field_type: 'INTEGER' }],
    },
    assignment: { region: 'Iringa', facility: 'Test facility' },
    staff: { name: 'Test Worker', first_name: 'Test', last_name: 'Worker' },
    entries: [
      { id: 1, entry_date: '2026-09-08', hours_worked: 4, measures: { clients: 2 } },
      { id: 2, entry_date: '2026-10-08', hours_worked: 8, measures: { clients: 3 } },
    ],
    totals: { hours: 12, days: 2, measures: { clients: 5 } },
  };
}

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test.each(['CHW', 'HCP', 'DATA_CLERK'])('%s print loads and prints the selected month with its own totals', async cadre => {
  api.get.mockResolvedValue(record(cadre));
  const print = jest.spyOn(window, 'print').mockImplementation(() => {});
  await act(async () => root.render(<PrintWorkLog logId={19} />));
  expect(container.textContent).not.toContain('Loading…');
  expect(container.querySelector('article h2').textContent).toBe('September 2026');
  const hours = () => [...container.querySelectorAll('tbody tr')].find(row => row.textContent.includes('Hours worked'));
  expect(hours().lastElementChild.textContent).toBe('4');
  expect(container.querySelectorAll('thead th')).toHaveLength(32); // 30 days + label + total.
  act(() => Simulate.change(container.querySelector('select'), { target: { value: '2026-10' } }));
  expect(container.querySelector('article h2').textContent).toBe('October 2026');
  expect(hours().lastElementChild.textContent).toBe('8');
  expect(container.querySelectorAll('thead th')).toHaveLength(33);
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Print').click());
  expect(print).toHaveBeenCalledTimes(1);
});

test('corrupt legacy dates show a correction message instead of crashing or expanding centuries', async () => {
  const log = record();
  log.period.start_date = '0206-10-01';
  api.get.mockResolvedValue(log);
  await act(async () => root.render(<PrintWorkLog logId={19} />));
  expect(container.textContent).toContain('four-digit year');
  expect(container.querySelector('select')).toBeNull();
  expect(container.querySelector('article')).toBeNull();
  expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Print').disabled).toBe(true);
});

test('print request times out instead of loading forever, and Retry can recover', async () => {
  jest.useFakeTimers();
  api.get.mockImplementationOnce((path, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')));
  }));
  api.get.mockResolvedValueOnce(record());
  await act(async () => root.render(<PrintWorkLog logId={19} />));
  expect(container.textContent).toContain('Loading…');
  await act(async () => jest.advanceTimersByTime(20001));
  expect(container.textContent).toContain('The request took too long');
  expect(container.textContent).not.toContain('Loading…');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry').click());
  expect(container.querySelector('article')).not.toBeNull();
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('invalid print links show an actionable error without fetching', async () => {
  await act(async () => root.render(<PrintWorkLog logId={NaN} />));
  expect(container.textContent).toContain('Invalid work-log number');
  expect(api.get).not.toHaveBeenCalled();
});
