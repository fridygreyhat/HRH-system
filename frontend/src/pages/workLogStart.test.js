import { resolveWorkLogStart } from './workLogStart';

const period = { id: 1, start_date: '2026-10-01', end_date: '2026-10-31', status: 'OPEN' };
const day = '2026-10-23';

test('uses the matching date schedule without a pay-period selection', () => {
  expect(resolveWorkLogStart([period], [], 'SERVICES', day)).toEqual({ period });
});

test.each(['SERVICES', 'PAYROLL'])('continues an existing %s log instead of duplicating it', (work_type) => {
  const existing = { id: 3, period_id: 1, work_type };
  expect(resolveWorkLogStart([period], [existing], work_type, day)).toEqual({ period, existing });
});

test('services and payroll resolve separately on the same date', () => {
  expect(resolveWorkLogStart([period], [{ id: 3, period_id: 1, work_type: 'SERVICES' }], 'PAYROLL', day)).toEqual({ period });
});

test('continues legacy records without creating mixed workflows', () => {
  const existing = { id: 3, period_id: 1, work_type: 'LEGACY' };
  expect(resolveWorkLogStart([period], [existing], 'SERVICES', day).existing).toBe(existing);
});

test('closed dates block creation but allow opening existing records', () => {
  const closed = { ...period, status: 'CLOSED' };
  expect(resolveWorkLogStart([closed], [], 'PAYROLL', day).error).toBeTruthy();
  expect(resolveWorkLogStart([closed], [{ id: 3, period_id: 1, work_type: 'PAYROLL' }], 'PAYROLL', day).existing.id).toBe(3);
});

test.each(['', '2026-11-05'])('does not invent a schedule for %s', (date) => {
  expect(resolveWorkLogStart([period], [], 'SERVICES', date).error).toBeTruthy();
});

test('ambiguous schedules or existing records require an explicit resolution', () => {
  const second = { ...period, id: 2 };
  expect(resolveWorkLogStart([period, second], [], 'SERVICES', day).error).toBeTruthy();
  const logs = [1, 2].map((id) => ({ id, period_id: id, work_type: 'SERVICES' }));
  expect(resolveWorkLogStart([period, second], logs, 'SERVICES', day).error).toBeTruthy();
});
