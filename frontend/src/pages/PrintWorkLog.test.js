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
    period: { start_date: '2026-08-26', end_date: '2026-10-25', period_label: 'September–October' },
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
  expect(container.querySelector('article h2').textContent).toBe('September 2026 · 26 Aug 2026 – 25 Sept 2026');
  const hours = () => [...container.querySelectorAll('tbody tr')].find(row => row.textContent.includes('Hours worked'));
  expect(hours().lastElementChild.textContent).toBe('4');
  expect(container.querySelectorAll('thead th')).toHaveLength(33); // 26 Aug to 25 Sept is 31 days, plus label and total.
  act(() => Simulate.change(container.querySelector('select'), { target: { value: '2026-10' } }));
  expect(container.querySelector('article h2').textContent).toBe('October 2026 · 26 Sept 2026 – 25 Oct 2026');
  expect(hours().lastElementChild.textContent).toBe('8');
  expect(container.querySelectorAll('thead th')).toHaveLength(32); // 26 Sept to 25 Oct is 30 days, plus label and total.
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

test('approval preview uses the exact opened work-log version without another fetch', async () => {
  const ready = jest.fn();
  await act(async () => root.render(<PrintWorkLog logId={19} reviewLog={record()} embedded onReady={ready} />));
  expect(api.get).not.toHaveBeenCalled();
  expect(container.querySelector('article').textContent).toContain('Test Worker');
  expect(ready).toHaveBeenCalled();
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Print')).toBe(false);
});

const additionalService = {
  activity: { key: 'extra', label_en: 'TB contact tracing', label_sw: 'Ufuatiliaji wa TB' },
  measures: { clients: 7 },
  activity_location: 'Outreach post',
};

test('additional services are on the form, so its totals match the server totals', async () => {
  const log = record('HCP');
  log.work_type = 'SERVICES';
  log.cadre.activities = [{ key: 'main', label_en: 'Main service', label_sw: 'Huduma kuu' }];
  log.entries[0] = { ...log.entries[0], activity_key: 'main', activity_snapshot: { additional_services: [additionalService] } };
  await act(async () => root.render(<PrintWorkLog logId={19} reviewLog={log} embedded />));
  const row = text => [...container.querySelectorAll('tbody tr')].find(item => item.textContent.includes(text));
  const september8 = 14; // Row label first, then 26 Aug onward, so the 8th of September sits at index 14.
  expect(row('Clients').children[september8].textContent).toBe('9');
  expect(row('Clients').lastElementChild.textContent).toBe('9');
  expect(row('Activity').children[september8].textContent).toBe('Main service + TB contact tracing');
  expect(row('Secondary facility').children[september8].textContent).toBe('Outreach post');
});

test('the form opens on the first month that has work', async () => {
  const log = record();
  log.entries = [log.entries[1]];
  await act(async () => root.render(<PrintWorkLog logId={19} reviewLog={log} embedded />));
  expect(container.querySelector('article h2').textContent).toBe('October 2026 · 26 Sept 2026 – 25 Oct 2026');
});

test('reviewers without audit access see finished stages as completed, with no signer details', async () => {
  const log = record();
  log.status = 'PENDING_RPM_AUTHORIZATION';
  await act(async () => root.render(<PrintWorkLog logId={19} reviewLog={log} embedded />));
  const box = text => [...container.querySelectorAll('.signoff > div')].find(item => item.textContent.includes(text));
  expect(box('CTC verification').textContent).toContain('Completed');
  expect(box('Technical review').textContent).toContain('Completed');
  expect(box('RM approval').textContent).not.toContain('Completed');
});

test.each(['RETURNED_TO_PROVIDER', 'REJECTED', 'DRAFT'])('%s does not show earlier stages as completed', async status => {
  const log = record();
  log.status = status;
  await act(async () => root.render(<PrintWorkLog logId={19} reviewLog={log} embedded />));
  expect(container.querySelector('.signoff').textContent).not.toContain('Completed');
});

test('one pay month prints as one sheet from the 26th to the 25th, with its public holidays', async () => {
  const log = record();
  log.period = { start_date: '2026-10-26', end_date: '2026-11-25', period_label: 'November 2026', holidays: [{ id: null, date: '2026-11-02', name_en: 'Test Holiday', name_sw: 'Sikukuu ya Jaribio' }] };
  log.entries = [{ id: 1, entry_date: '2026-10-27', hours_worked: 4, measures: { clients: 2 } }, { id: 2, entry_date: '2026-11-20', hours_worked: 8, measures: { clients: 3 } }];
  await act(async () => root.render(<PrintWorkLog logId={19} reviewLog={log} embedded />));
  expect(container.querySelector('.print-toolbar')).toBeNull();
  const headers = [...container.querySelectorAll('thead th')];
  expect(headers[1].getAttribute('title')).toBe('2026-10-26');
  expect(headers[headers.length - 2].getAttribute('title')).toBe('2026-11-25');
  expect(container.querySelector('th[title="2026-11-02"]').className).toBe('holiday');
  expect(container.textContent).toContain('Sikukuu ya Jaribio / Test Holiday');
  expect([...container.querySelectorAll('tbody tr')].find(row => row.textContent.includes('Public holiday')).lastElementChild.textContent).toBe('1');
});

test('a shortfall shows on the timesheet once submitted, and says payment is not affected', async () => {
  const log = record();
  log.status = 'PENDING_RPM_AUTHORIZATION';
  log.service_targets = [
    { service: 'Index testing', service_sw: 'Index', min_days: 10, days: 6, left: 4 },
    { service: 'SNS testing', service_sw: 'SNS', min_days: 5, days: 5, left: 0 },
  ];
  await act(async () => root.render(<PrintWorkLog logId={19} reviewLog={log} embedded />));
  expect(container.textContent).toContain('Below minimum service days');
  expect(container.textContent).toContain('Index testing: 6 of 10 days, 4 short');
  expect(container.textContent).not.toContain('SNS testing:');
  expect(container.textContent).toContain('Payment is not affected');
  await act(async () => root.render(<PrintWorkLog logId={19} reviewLog={{ ...log, status: 'DRAFT' }} embedded />));
  expect(container.textContent).not.toContain('Below minimum service days');
});

test('the review preview drops print wording and tells reviewers to check every month', async () => {
  await act(async () => root.render(<PrintWorkLog logId={19} reviewLog={record()} embedded />));
  expect(container.textContent).toContain('covers 2 months');
  expect(container.textContent).not.toContain('Landscape');
  expect(container.querySelector('select').getAttribute('aria-label')).toBe('Month');
  const single = record();
  single.period = { ...single.period, end_date: '2026-09-25' };
  await act(async () => root.render(<PrintWorkLog logId={19} reviewLog={single} embedded />));
  expect(container.querySelector('.print-toolbar')).toBeNull();
});
