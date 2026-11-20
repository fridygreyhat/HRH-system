import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { DayEntryForm } from './DayEntryForm';

// Payroll records hours only: the provider gives the day's total hours, with no times, activity or indicators.
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

const timeOnlyDay = { key: 'daily_attendance', label_en: 'Hours worked', label_sw: 'Masaa ya kazi', item_type: 'PAYROLL', fields: [], required_fields: [], hours_input: true };
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

const activitySelect = () => Array.from(container.querySelectorAll('select')).filter((select) => select.getAttribute('aria-label') !== 'Minutes worked');

test.each([['HCP', 'START_END'], ['CHW', 'DIRECT'], ['DATA_CLERK', 'START_END']])('%s Payroll day asks only for the hours worked', (code, mode) => {
  render(code, mode);
  expect(container.textContent).toContain('enter the total hours you worked this day (up to 8 hours)');
  expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);
  const hours = container.querySelector('input[aria-label="Whole hours worked"]');
  expect(hours).not.toBeNull();
  expect(hours.getAttribute('max')).toBe('8');
  expect(activitySelect()).toHaveLength(0);
  expect(container.textContent).not.toContain('OPD attendees');
});

test('a day recorded earlier with times opens as its hours', () => {
  render('HCP', 'START_END', { activity_key: 'opd_screening', start_time: '08:00:00', end_time: '15:30:00', hours_worked: 7.5, measures: { opd_attendees: 4 } });
  expect(activitySelect()).toHaveLength(0);
  expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);
  expect(container.querySelector('input[aria-label="Whole hours worked"]').value).toBe('7');
  expect(container.querySelector('select[aria-label="Minutes worked"]').value).toBe('30');
});
