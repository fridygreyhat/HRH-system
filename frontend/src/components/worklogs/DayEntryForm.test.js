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

test('CHW TB Contact tracing renders and saves all five service indicators', async () => {
  const log = logFor('CHW');
  log.workflow_version = 2;
  log.cadre.hours_mode = 'DIRECT';
  const fields = [
    ['chw_tb_contacts_listed', 'TB Case Contacts Listed (Household and close contacts of the TB client)'],
    ['chw_tb_contacts_screened', 'TB Contacts Reached and Screened for TB'],
    ['chw_tb_contacts_presumptive', 'Presumptive TB Contacts Identified'],
    ['chw_tb_contact_samples_transported', 'Samples collected and transported for TB confirmation/Investigation'],
    ['chw_tb_contacts_started_referred', 'TB Cases Diagnosed and Started/Referred for TB Treatment'],
  ];
  log.cadre.fields = fields.map(([key, label_en]) => ({ key, label_en, field_type: 'INTEGER' }));
  const keys = fields.map(([key]) => key);
  log.cadre.activities = [{
    key: 'chw_tb_contact_tracing', label_en: 'TB Contact tracing', item_type: 'SERVICES',
    fields: keys, required_fields: keys, field_definitions: log.cadre.fields,
    hours_input: true, unit_type: 'PER_DAY', rate_value: null,
  }];
  act(() => root.render(<DayEntryForm log={log} date="2026-10-23"
    flags={[]} captureOnEntry={false} onSaved={jest.fn()} onClose={jest.fn()} />));
  for (const [, label] of fields) expect(container.textContent).toContain(label);
  const inputs = container.querySelectorAll('input[type=number]');
  const values = [20, 15, 5, 7, 3];
  expect(inputs).toHaveLength(6);
  act(() => Simulate.change(inputs[0], { target: { value: '4' } }));
  values.forEach((value, index) => act(() => Simulate.change(inputs[index + 1], { target: { value: String(value) } })));
  await captureGps();
  await submitDay();
  expect(api.put).toHaveBeenCalled();
  expect(api.put.mock.calls[0][1]).toMatchObject({
    activity_key: 'chw_tb_contact_tracing', hours_worked: 4,
    measures: Object.fromEntries(keys.map((key, index) => [key, values[index]])),
  });
});

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

test.each(['HCP', 'DATA_CLERK'])('%s Payroll restores indicators and keeps the eight-hour limit', code => {
  const log = logFor(code);
  log.work_type = 'PAYROLL';
  log.cadre.hours_mode = 'DIRECT';
  log.review_summary.limits.daily_hours = 8;
  log.review_summary.limits.weekly_hours = 40;
  const field = { key: 'clients', label_en: 'Clients served', field_type: 'NUMBER' };
  log.cadre.fields = [field];
  log.cadre.activities = [{
    key: code === 'HCP' ? 'opd_screening' : 'data_clerk_daily_timesheet', label_en: 'Daily activity', item_type: 'PAYROLL',
    fields: ['clients'], required_fields: ['clients'], hours_input: true,
  }];
  act(() => root.render(<DayEntryForm log={log} date="2026-10-23"
    flags={[]} captureOnEntry={false} onSaved={jest.fn()} onClose={jest.fn()} />));
  if (code === 'HCP') act(() => Simulate.change(container.querySelector('select'), { target: { value: 'opd_screening' } }));
  expect(container.textContent).toContain('Clients served');
  expect(container.textContent).toContain('up to 8 hours per day');
  expect(container.textContent).toContain('Payroll and Services on the same date');
  expect(container.querySelector('input[type="number"]').max).toBe('8');
});

test('CHW Payroll restores all five groups, validates every group and saves daily figures', async () => {
  const log = logFor('CHW');
  log.work_type = 'PAYROLL';
  log.workflow_version = 2;
  log.cadre.hours_mode = 'DIRECT';
  log.review_summary.limits.daily_hours = 8;
  const groups = [
    { key: 'hiv', label_en: 'HIV testing and linkage', fields: ['counselled', 'eligible', 'positive', 'art', 'escort', 'lcm'], color: 'teal' },
    { key: 'tb', label_en: 'TB screening', fields: ['tb_screened', 'tb_symptoms'], color: 'amber' },
    { key: 'appointments', label_en: 'Appointment follow-up', fields: ['calls', 'attended', 'missap'], color: 'blue' },
    { key: 'lab', label_en: 'HVL / DBS follow-up', fields: ['hvl', 'dbs'], color: 'violet' },
    { key: 'self', label_en: 'HIV self-testing', fields: ['self_tests'], color: 'rose' },
  ];
  const keys = groups.flatMap(group => group.fields);
  log.cadre.fields = keys.map(key => ({ key, label_en: key, field_type: 'INTEGER' }));
  const sheet = { label_en: 'Daily CHW timesheet', item_type: 'PAYROLL', fields: keys, required_fields: keys, groups, hours_input: true };
  log.cadre.activities = [{ ...sheet, key: 'chw_daily_timesheet' }, { ...sheet, key: 'daily_attendance' }];
  act(() => root.render(<DayEntryForm log={log} date="2026-10-23"
    entry={{ activity_key: 'daily_attendance', hours_worked: 8, measures: { counselled: 9 } }}
    flags={[]} captureOnEntry={false} onSaved={jest.fn()} onClose={jest.fn()} />));
  const groupSelect = () => Array.from(container.querySelectorAll('select')).find(select => select.options.length === 5);
  expect(groupSelect().options).toHaveLength(5);
  expect(container.querySelectorAll('input[type="number"]')[1].value).toBe('9');
  expect(container.querySelector('input[type="number"]').max).toBe('8');
  await captureGps();
  await submitDay();
  expect(api.put).not.toHaveBeenCalled();
  for (const group of groups) {
    act(() => Simulate.change(groupSelect(), { target: { value: group.key } }));
    const countInputs = Array.from(container.querySelectorAll('input[type="number"]')).slice(1);
    expect(countInputs).toHaveLength(group.fields.length);
    countInputs.forEach(input => act(() => Simulate.change(input, { target: { value: '1' } })));
  }
  await submitDay();
  expect(api.put.mock.calls[0][1]).toMatchObject({
    activity_key: 'daily_attendance', hours_worked: 8,
    measures: Object.fromEntries(keys.map(key => [key, 1])),
  });
  expect(container.textContent).not.toContain('Evidence of work');
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

test('CHW Payroll shows the five daily indicator groups without evidence or comments', () => {
  renderGroupedChw();
  expect(groupDropdown().options).toHaveLength(5);
  expect(container.querySelectorAll('fieldset')).toHaveLength(1);
  expect(container.querySelectorAll('input[type="number"]')).toHaveLength(7);
  expect(container.querySelectorAll('textarea')).toHaveLength(0);
  expect(container.textContent).not.toContain('evidenceWarning');
  expect(button('saveDay').disabled).toBe(true);
});

test('CHW Payroll saves explicit zero counts across every activity group', async () => {
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
  expect(api.put.mock.calls[0][1].measures).toEqual(values);
});

test('missing CHW counts block saving and open the incomplete group', async () => {
  const values = Object.fromEntries([
    ...Array.from({ length: 6 }, (_, i) => [`hiv_${i}`, 0]),
    ...['tb', 'laboratory'].flatMap(group => [0, 1].map(i => [`${group}_${i}`, 0])),
    ...[0, 1, 2].map(i => [`appointments_${i}`, 0]),
  ]);
  renderGroupedChw(values);
  expect(groupDropdown()).toBeDefined();
  await captureGps();
  await submitDay();
  expect(api.put).not.toHaveBeenCalled();
  expect(groupDropdown().value).toBe('self_testing');
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

test('Data Clerk PAYROLL saves reporting counts and checks, without evidence/comments', async () => {
  const required = renderClerk('PAYROLL');
  expect(clerkGroup().options).toHaveLength(5);
  expect(container.querySelectorAll('input[type="number"]')).toHaveLength(9);
  expect(container.querySelectorAll('textarea')).toHaveLength(0);
  await captureGps();
  await submitDay();
  expect(api.put).toHaveBeenCalledTimes(1);
  const payload = api.put.mock.calls[0][1];
  expect(Object.keys(payload.measures)).toEqual(required);
  expect(payload.measures.reporting_0).toBe(false);
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

test('Data Clerk requires an explicit Yes/No answer before saving', async () => {
  renderClerk('PAYROLL', 'reporting_0');
  await captureGps();
  await submitDay();
  expect(clerkGroup().value).toBe('reporting');
  expect(api.put).not.toHaveBeenCalled();
});
