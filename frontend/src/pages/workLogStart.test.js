import { resolveWorkLogStart, resolveWorkLogMonth } from './workLogStart';

const period = { id: 1, start_date: '2026-10-01', end_date: '2026-10-31', status: 'OPEN' };
const day = '2026-10-23';

test.each(['PAYROLL', 'SERVICES'])('reopens rejected %s for its month even with a closed partial schedule', (work_type) => {
  const partial = { ...period, start_date: '2026-10-25', status: 'CLOSED' };
  const existing = { id: 11, period_id: 1, work_type, status: 'REJECTED' };
  expect(resolveWorkLogMonth([partial], [existing], work_type, '2026-10', '2026-10-29')).toEqual({ period: partial, existing });
});

test('keeps an existing global correction when a new regional schedule also exists', () => {
  const regional = { ...period, id: 2, region_id: 7 };
  const existing = { id: 11, period_id: 1, work_type: 'PAYROLL', status: 'RETURNED_TO_PROVIDER' };
  expect(resolveWorkLogMonth([period, regional], [existing], 'PAYROLL', '2026-10', '2026-10-29').existing).toBe(existing);
});

test('uses the regional monthly schedule and never bypasses a closed one', () => {
  const regional = { ...period, id: 2, region_id: 7 };
  expect(resolveWorkLogMonth([period, regional], [], 'PAYROLL', '2026-10', '2026-10-29')).toEqual({ period: regional });
  expect(resolveWorkLogMonth([period, { ...regional, status: 'CLOSED' }], [], 'PAYROLL', '2026-10', '2026-10-29').error).toBeTruthy();
});

test('ignores archived months but does not silently choose between duplicate records', () => {
  const archived = { ...period, id: 2, status: 'ARCHIVED' };
  expect(resolveWorkLogMonth([period, archived], [{ id: 12, period_id: 2, work_type: 'PAYROLL' }], 'PAYROLL', '2026-10', '2026-10-29')).toEqual({ period });
  const logs = [1, 2].map(id => ({ id, period_id: 1, work_type: 'PAYROLL' }));
  expect(resolveWorkLogMonth([period], logs, 'PAYROLL', '2026-10', '2026-10-29').error).toMatch(/Several records/);
});

test.each(['2026-13', '2026-00', '', '0206-10', '2026-11'])('rejects invalid or future work month %s', month => {
  expect(resolveWorkLogMonth([period], [], 'PAYROLL', month, '2026-10-29').error).toBeTruthy();
});

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

test('regional schedule takes priority over a matching global schedule', () => {
  const regional = { ...period, id: 7, region_id: 3 };
  expect(resolveWorkLogStart([period, regional], [], 'SERVICES', day)).toEqual({ period: regional });
});

test('closed regional schedule never falls back to the open global schedule', () => {
  const regional = { ...period, id: 7, region_id: 3, status: 'CLOSED' };
  expect(resolveWorkLogStart([period, regional], [], 'SERVICES', day).error).toBeTruthy();
});

test('existing regional work continues without reopening unrelated global work', () => {
  const regional = { ...period, id: 7, region_id: 3 };
  const existing = { id: 9, period_id: 7, work_type: 'PAYROLL' };
  expect(resolveWorkLogStart([period, regional], [existing], 'PAYROLL', day)).toEqual({ period: regional, existing });
});
