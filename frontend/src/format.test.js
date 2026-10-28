import { datesBetween, periodDateError, roleLabel, WORKLOG_STATUS_LABELS, WORKLOG_ACTION_LABELS } from './format';

test('the existing RPM role is displayed as RM without changing its permission code', () => {
  expect(roleLabel('RPM')).toBe('Regional Manager (RM)');
  expect(WORKLOG_STATUS_LABELS.PENDING_RPM_AUTHORIZATION).toBe('Awaiting RM authorization');
  expect(WORKLOG_ACTION_LABELS.authorize).toBe('Authorize (RM)');
});

test.each([
  ['0206-10-01', '2026-10-31'],
  ['0943-07-01', '2026-10-31'],
  ['2026-10-31', '2026-10-01'],
  ['2026-02-30', '2026-03-31'],
  ['not-a-date', '2026-10-31'],
  ['2025-01-01', '2026-12-31'],
  ['2026-10-01', '9999-12-31'],
])('rejects invalid period %s–%s without calendar expansion', (start, end) => {
  expect(periodDateError(start, end)).toBeTruthy();
  expect(datesBetween(start, end)).toEqual([]);
});

test.each([
  ['2026-10-01', '2026-10-31', 31],
  ['2026-09-01', '2026-10-31', 61],
  ['2024-01-01', '2024-12-31', 366],
  ['2026-12-31', '2027-01-01', 2],
])('preserves valid period %s–%s', (start, end, length) => {
  expect(periodDateError(start, end)).toBeNull();
  expect(datesBetween(start, end)).toHaveLength(length);
});
