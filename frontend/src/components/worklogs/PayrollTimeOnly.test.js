import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { DayEntryForm } from './DayEntryForm';

// Payroll records time only: the provider gives start and end time, with no activity to pick and no indicators.
jest.mock('../../AuthContext', () => ({
  useAuth: () => ({ t: (key) => key, lang: 'en', me: { client_settings: { payroll_time_only: true } } }),
}));
jest.mock('../../api', () => ({ api: { put: jest.fn(), del: jest.fn() } }));

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const timeOnlyDay = { key: 'daily_attendance', label_en: 'Time worked', label_sw: 'Muda wa kazi', item_type: 'PAYROLL', fields: [], required_fields: [], hours_input: false };
const oldDay = { key: 'opd_screening', label_en: 'OPD screening', item_type: 'PAYROLL', fields: ['opd_attendees'], required_fields: ['opd_attendees'] };

const render = (code, hoursMode = 'START_END', entry) => act(() => root.render(
  <DayEntryForm
    log={{
      id: 1, work_type: 'PAYROLL', workflow_version: 2,
      cadre: { code, hours_mode: hoursMode, fields: [{ key: 'opd_attendees', label_en: 'OPD attendees', field_type: 'INTEGER' }], activities: [timeOnlyDay, oldDay] },
      review_summary: { limits: { daily_hours: 8, weekly_hours: 40, saturday_min_hours: 4, saturday_max_hours: 6 } },
    }}
    date="2026-10-23" entry={entry} flags={[]} captureOnEntry={false} onSaved={jest.fn()} onClose={jest.fn()}
  />,
));

test.each([['HCP', 'START_END'], ['CHW', 'DIRECT'], ['DATA_CLERK', 'START_END']])('%s Payroll day asks only for start and end time', (code, mode) => {
  render(code, mode);
  expect(container.textContent).toContain('No activities or indicators are needed');
  expect(container.querySelectorAll('input[type="time"]')).toHaveLength(2);
  expect(container.querySelector('select')).toBeNull();
  expect(container.querySelector('input[type="number"]')).toBeNull();
  expect(container.textContent).not.toContain('OPD attendees');
});

test('a day recorded earlier with an activity opens as time only', () => {
  render('HCP', 'START_END', { activity_key: 'opd_screening', start_time: '08:00:00', end_time: '15:00:00', hours_worked: 7, measures: { opd_attendees: 4 } });
  expect(container.querySelector('select')).toBeNull();
  expect(container.textContent).not.toContain('OPD attendees');
  expect(Array.from(container.querySelectorAll('input[type="time"]')).map((input) => input.value)).toEqual(['08:00', '15:00']);
});
