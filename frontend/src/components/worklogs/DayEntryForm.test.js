import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
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

test('Services can save two activities on one date with one daily hours total', async () => {
  const log = logFor('CHW');
  log.workflow_version = 2;
  log.cadre.hours_mode = 'DIRECT';
  log.cadre.fields = [
    { key: 'first_count', label_en: 'First service clients', field_type: 'INTEGER' },
    { key: 'second_count', label_en: 'Second service clients', field_type: 'INTEGER' },
  ];
  log.cadre.activities = [
    { key: 'first', label_en: 'First service', item_type: 'SERVICES', fields: ['first_count'], required_fields: ['first_count'] },
    { key: 'second', label_en: 'Second service', item_type: 'SERVICES', fields: ['second_count'], required_fields: ['second_count'] },
  ];
  act(() => root.render(<DayEntryForm log={log} date="2026-10-23"
    flags={[]} captureOnEntry={false} onSaved={jest.fn()} onClose={jest.fn()} />));
  const add = Array.from(container.querySelectorAll('select')).find(select => select.textContent.includes('Choose another service'));
  act(() => Simulate.change(add, { target: { value: 'second' } }));
  const inputs = container.querySelectorAll('input[type="number"]');
  act(() => {
    Simulate.change(inputs[0], { target: { value: '4' } });
    Simulate.change(inputs[1], { target: { value: '3' } });
    Simulate.change(inputs[2], { target: { value: '7' } });
  });
  expect(container.textContent).toContain('only the highest fixed daily service amount');
  await captureGps();
  await submitDay();
  expect(api.put.mock.calls[0][1]).toMatchObject({
    activity_key: 'first', hours_worked: 4, measures: { first_count: 3 },
    additional_services: [{ activity_key: 'second', measures: { second_count: 7 } }],
  });
});

test.each(['CHW', 'HCP', 'DATA_CLERK'])('%s Payroll hides indicator parameters and shows eight-hour limit', code => {
  const log = logFor(code);
  log.work_type = 'PAYROLL';
  log.cadre.hours_mode = 'DIRECT';
  log.review_summary.limits.daily_hours = 8;
  log.review_summary.limits.weekly_hours = 40;
  const field = { key: 'clients', label_en: 'Clients served', field_type: 'NUMBER' };
  log.cadre.fields = [field];
  log.cadre.activities = [{
    key: 'daily_attendance', label_en: 'Daily attendance', item_type: 'PAYROLL',
    fields: ['clients'], required_fields: ['clients'], hours_input: true,
  }];
  act(() => root.render(<DayEntryForm log={log} date="2026-10-23"
    flags={[]} captureOnEntry={false} onSaved={jest.fn()} onClose={jest.fn()} />));
  expect(container.textContent).not.toContain('Clients served');
  expect(container.textContent).toContain('up to 8 hours per day');
  expect(container.textContent).toContain('Payroll and Services on the same date');
  expect(container.querySelector('input[type="number"]').max).toBe('8');
});

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

const renderGroupedChw = (entryMeasures) => {
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
  const entry = entryMeasures ? {
    activity_key: 'chw_daily_timesheet', hours_worked: 1, measures: entryMeasures,
  } : undefined;
  act(() => root.render(<DayEntryForm log={log} date="2026-10-23" entry={entry} flags={[]} captureOnEntry={true}
    onSaved={jest.fn()} onClose={jest.fn()} />));
  return { groups, keys };
};
const groupDropdown = () => Array.from(container.querySelectorAll('select'))
  .find(select => Array.from(select.options).some(option => option.textContent === 'HIV testing and linkage'));
const chooseGroup = key => act(() => Simulate.change(groupDropdown(), { target: { value: key } }));
const captureGps = async () => {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: success => success({ coords: { latitude: -7.77, longitude: 35.69, accuracy: 12 } }),
  } });
  await act(async () => button('captureGps').click());
};
const submitDay = async () => {
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
};

test('CHW Payroll hides all five historical indicator groups', () => {
  renderGroupedChw();
  expect(groupDropdown()).toBeUndefined();
  expect(container.querySelectorAll('fieldset')).toHaveLength(0);
  expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1);
  expect(container.querySelectorAll('textarea')).toHaveLength(0);
  expect(container.textContent).not.toContain('evidenceWarning');
  expect(button('saveDay').disabled).toBe(true);
});

test('CHW Payroll saves attendance without resending historical indicators', async () => {
  const values = Object.fromEntries([
    ...Array.from({ length: 6 }, (_, i) => [`hiv_${i}`, 0]),
    ...['tb', 'laboratory'].flatMap(group => [0, 1].map(i => [`${group}_${i}`, 0])),
    ...[0, 1, 2].map(i => [`appointments_${i}`, 0]),
    ['self_testing_0', 0],
  ]);
  renderGroupedChw(values);
  await captureGps();
  await submitDay();
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.put.mock.calls[0][1].measures).toEqual({});
});

test('missing historical CHW counts no longer block Payroll saving', async () => {
  const values = Object.fromEntries([
    ...Array.from({ length: 6 }, (_, i) => [`hiv_${i}`, 0]),
    ...['tb', 'laboratory'].flatMap(group => [0, 1].map(i => [`${group}_${i}`, 0])),
    ...[0, 1, 2].map(i => [`appointments_${i}`, 0]),
  ]);
  renderGroupedChw(values);
  expect(groupDropdown()).toBeUndefined();
  await captureGps();
  await submitDay();
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.put.mock.calls[0][1].measures).toEqual({});
});

const renderClerk = (kind = 'PAYROLL', missingKey) => {
  const groups = [
    ['ctc', 'CTC-2 and treatment data', 9],
    ['hts', 'HTS and contact data', 3],
    ['laboratory', 'HVL / EID requests and results', 6],
    ['reporting', 'Backups and reporting', 4],
    ['followup', 'Weekly lists and result sharing (optional)', 2],
  ].map(([key, label_en, count]) => ({
    key, label_en, label_sw: label_en, color: 'teal',
    fields: Array.from({ length: count }, (_, index) => `${key}_${index}`),
  }));
  const fields = groups.flatMap(group => group.fields.map((key, index) => ({
    key, label_en: key, field_type: group.key === 'reporting' || (group.key === 'followup' && index === 1) ? 'BOOLEAN' : 'INTEGER',
  })));
  const required = groups.slice(0, 4).flatMap(group => group.fields);
  const values = Object.fromEntries(fields.filter(field => required.includes(field.key) && field.key !== missingKey)
    .map(field => [field.key, field.field_type === 'BOOLEAN' ? false : 0]));
  const activity = {
    key: kind === 'PAYROLL' ? 'data_clerk_daily_timesheet' : 'data_clerk_weekend_clinic',
    label_en: kind === 'PAYROLL' ? 'Daily Data Clerk timesheet' : 'Weekend Clinics',
    fields: fields.map(field => field.key), required_fields: required, item_type: kind,
    hours_input: false, groups,
  };
  if (kind === 'SERVICES') {
    activity.fields = [];
    activity.required_fields = [];
    activity.groups = [];
    Object.keys(values).forEach(key => delete values[key]);
  }
  const log = logFor('DATA_CLERK');
  log.work_type = kind;
  log.cadre.fields = fields;
  log.cadre.activities = [activity, ...(kind === 'PAYROLL' ? [{
    ...activity, key: 'data_clerk_secondary_facility', label_en: 'Data entry at a secondary facility',
    requires_location: true,
  }] : [])];
  act(() => root.render(<DayEntryForm log={log} date="2026-10-23"
    entry={{ activity_key: activity.key, hours_worked: 1, start_time: '08:00:00', end_time: '09:00:00', measures: values }}
    flags={[]} captureOnEntry={true} onSaved={jest.fn()} onClose={jest.fn()} />));
  return required;
};
const clerkGroup = () => Array.from(container.querySelectorAll('select'))
  .find(select => Array.from(select.options).some(option => option.textContent === 'CTC-2 and treatment data'));

test('Data Clerk PAYROLL saves hours only, without evidence/comments or indicators', async () => {
  renderClerk('PAYROLL');
  expect(clerkGroup()).toBeUndefined();
  expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0);
  expect(container.querySelectorAll('textarea')).toHaveLength(0);
  await captureGps();
  await submitDay();
  expect(api.put).toHaveBeenCalledTimes(1);
  const payload = api.put.mock.calls[0][1];
  expect(payload.measures).toEqual({});
  expect(payload).not.toHaveProperty('evidence_text');
  expect(payload).not.toHaveProperty('comment');
});

test('Data Clerk Services shows only Weekend Clinics, without daily activity groups', async () => {
  renderClerk('SERVICES');
  const choices = container.querySelectorAll('select');
  expect(choices).toHaveLength(1);
  expect(Array.from(choices[0].options).map(option => option.textContent)).toEqual(['Weekend Clinics']);
  expect(container.querySelectorAll('fieldset')).toHaveLength(0);
  expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0);
  expect(container.textContent).not.toContain('CTC-2 and treatment data');
  expect(container.querySelectorAll('input[type="time"]')).toHaveLength(2);
  expect(container.querySelectorAll('textarea')).toHaveLength(0);
  await captureGps();
  await submitDay();
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.put.mock.calls[0][1]).toMatchObject({
    activity_key: 'data_clerk_weekend_clinic', start_time: '08:00', end_time: '09:00', measures: {},
  });
});

test('Data Clerk historical Yes/No checks no longer block Payroll attendance', async () => {
  renderClerk('PAYROLL', 'reporting_0');
  await captureGps();
  await submitDay();
  expect(clerkGroup()).toBeUndefined();
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.put.mock.calls[0][1].measures).toEqual({});
});
