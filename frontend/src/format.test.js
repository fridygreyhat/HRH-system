import { roleLabel, WORKLOG_STATUS_LABELS, WORKLOG_ACTION_LABELS } from './format';

test('the existing RPM role is displayed as RM without changing its permission code', () => {
  expect(roleLabel('RPM')).toBe('Regional Manager (RM)');
  expect(WORKLOG_STATUS_LABELS.PENDING_RPM_AUTHORIZATION).toBe('Awaiting RM authorization');
  expect(WORKLOG_ACTION_LABELS.authorize).toBe('Authorize (RM)');
});
