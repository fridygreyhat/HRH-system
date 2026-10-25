import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { DayEntryForm, captureLocation } from './DayEntryForm';
import { api } from '../../api';

jest.mock('../../AuthContext', () => ({ useAuth: () => ({ t: key => key, lang: 'en' }) }));
jest.mock('../../api', () => ({ api: { put: jest.fn(), del: jest.fn() } }));

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.put.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete navigator.geolocation;
});

const logFor = code => ({
  id: 1, work_type: 'SERVICES',
  cadre: { code, fields: [], activities: [], hours_mode: 'START_END' },
  review_summary: { limits: { daily_hours: 9, weekly_hours: 45, saturday_min_hours: 4, saturday_max_hours: 6 } },
});
const renderForm = (code, entry) => {
  act(() => root.render(<DayEntryForm log={logFor(code)} date="2026-10-23" entry={entry}
    flags={[]} captureOnEntry={false} onSaved={jest.fn()} onClose={jest.fn()} />));
};
const button = text => Array.from(container.querySelectorAll('button')).find(b => b.textContent === text);

test.each(['CHW', 'HCP', 'DATA_CLERK'])('%s cannot save until location is captured, even with optional capture disabled', async code => {
  const capture = jest.fn(success => success({ coords: { latitude: -7.77, longitude: 35.69, accuracy: 12 } }));
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: capture } });
  renderForm(code, { hours_worked: 1, measures: {}, evidence_text: 'Existing activity evidence', gps_lat: -7.77, gps_lon: 35.69 });
  expect(button('saveDay').disabled).toBe(true);
  await act(async () => button('captureGps').click());
  expect(capture.mock.calls[0][2].maximumAge).toBe(0);
  expect(button('saveDay').disabled).toBe(false);
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.put.mock.calls[0][1]).toMatchObject({ gps_lat: -7.77, gps_lon: 35.69, gps_accuracy_m: 12 });
});

test('permission denial keeps Save disabled with retry instructions', async () => {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: (success, error) => error({ code: 1 }),
  } });
  renderForm('HCP');
  await act(async () => button('captureGps').click());
  expect(button('saveDay').disabled).toBe(true);
  expect(container.textContent).toContain('gpsFailed');
  expect(api.put).not.toHaveBeenCalled();
});

test('missing geolocation or invalid accuracy never produces a valid fix', async () => {
  expect(await captureLocation()).toBeNull();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: success => success({ coords: { latitude: 0, longitude: 0, accuracy: Infinity } }),
  } });
  expect(await captureLocation()).toBeNull();
});

test('CHW daily timesheet shows all five colour groups and no evidence/comment inputs', () => {
  const groups = [
    ['hiv', 'HIV testing and linkage', 'teal', 6],
    ['tb', 'TB screening', 'amber', 2],
    ['appointments', 'Appointment follow-up', 'blue', 3],
    ['laboratory', 'HVL / DBS follow-up', 'violet', 2],
    ['self_testing', 'HIV self-testing', 'rose', 1],
  ].map(([key, label_en, color, count]) => ({
    key, label_en, label_sw: label_en, color,
    fields: Array.from({ length: count }, (_, index) => `${key}_${index}`),
  }));
  const keys = groups.flatMap(group => group.fields);
  const log = logFor('CHW');
  log.work_type = 'PAYROLL';
  log.cadre.fields = keys.map(key => ({ key, label_en: key, field_type: 'INTEGER' }));
  log.cadre.activities = [{
    key: 'chw_daily_timesheet', label_en: 'Daily CHW timesheet',
    fields: keys, required_fields: keys, item_type: 'PAYROLL', hours_input: true, groups,
  }];
  act(() => root.render(<DayEntryForm log={log} date="2026-10-23" flags={[]} captureOnEntry={true}
    onSaved={jest.fn()} onClose={jest.fn()} />));
  expect(container.querySelectorAll('fieldset')).toHaveLength(5);
  groups.forEach(group => expect(container.textContent).toContain(group.label_en));
  expect(container.querySelectorAll('input[type="number"]')).toHaveLength(15);
  expect(container.querySelectorAll('textarea')).toHaveLength(0);
  expect(container.textContent).not.toContain('evidenceWarning');
  expect(button('saveDay').disabled).toBe(true);
});
