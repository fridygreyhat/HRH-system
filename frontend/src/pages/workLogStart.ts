import type { PayPeriod, WorkLogSummary } from '../types';

/** Resolve a date without asking providers to manage finance reporting periods. */
export function resolveWorkLogStart(
  periods: PayPeriod[],
  logs: WorkLogSummary[],
  workType: 'SERVICES' | 'PAYROLL',
  workDate: string,
): { period?: PayPeriod; existing?: WorkLogSummary; error?: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { error: 'Choose a work date to continue.' };
  const containing = periods.filter((p) => p.start_date <= workDate && workDate <= p.end_date);
  const matches = logs.filter((log) => containing.some((p) => p.id === log.period_id) &&
    (log.work_type === workType || log.work_type === 'LEGACY'));
  if (matches.length === 1) {
    return { period: containing.find((p) => p.id === matches[0].period_id), existing: matches[0] };
  }
  if (matches.length > 1) return { error: 'Several logs cover this date. Open the correct log from your records below.' };
  const available = containing.filter((p) => p.status === 'OPEN');
  if (!available.length) return { error: 'This date is not open for work-log entry. Choose another date or contact your administrator.' };
  if (available.length > 1) return { error: 'Reporting dates overlap. Ask your administrator to correct the schedule before starting a log.' };
  return { period: available[0] };
}
