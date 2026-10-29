import type { PayPeriod, WorkLogSummary } from '../types';
import { todayLocal } from '../format';

export function workMonthLabel(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month;
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
    .format(new Date(`${month}-01T12:00:00`));
}

/** Providers choose a month, not an internal pay-period label or identifier. */
export function resolveWorkLogMonth(
  periods: PayPeriod[],
  logs: WorkLogSummary[],
  workType: 'SERVICES' | 'PAYROLL',
  month: string,
  today = todayLocal(),
): { period?: PayPeriod; existing?: WorkLogSummary; error?: string } {
  if (!/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month)) return { error: 'Choose a valid work month.' };
  if (month > today.slice(0, 7)) return { error: 'Future work months are not available yet.' };
  const first = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const overlapping = periods.filter(p => p.status !== 'ARCHIVED' && p.start_date <= last && p.end_date >= first);
  // A rejected/returned record must reopen even if its schedule is now closed,
  // partial-month, or predates a subsequently configured regional schedule.
  const existing = logs.filter(log =>
    (log.work_type === workType || log.work_type === 'LEGACY') &&
    overlapping.some(p => p.id === log.period_id));
  if (existing.length === 1) return {
    period: overlapping.find(p => p.id === existing[0].period_id), existing: existing[0],
  };
  if (existing.length > 1) return { error: 'Several records cover this month. Open the correct record from your records below.' };
  const regional = overlapping.filter(p => p.region_id != null);
  const schedules = regional.length ? regional : overlapping.filter(p => p.region_id == null);
  if (schedules.length > 1) return { error: 'Several schedules cover this month. Ask your regional Technical Officer to clarify the monthly dates.' };
  if (schedules.length === 0 || schedules[0].status !== 'OPEN') {
    return { error: 'This month is not open for new work records. Ask your regional Technical Officer to open the monthly schedule.' };
  }
  return { period: schedules[0] };
}

/** Resolve a date without asking providers to manage finance reporting periods. */
export function resolveWorkLogStart(
  periods: PayPeriod[],
  logs: WorkLogSummary[],
  workType: 'SERVICES' | 'PAYROLL',
  workDate: string,
): { period?: PayPeriod; existing?: WorkLogSummary; error?: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { error: 'Choose a work date to continue.' };
  const inRange = periods.filter((p) => p.start_date <= workDate && workDate <= p.end_date);
  // A regional schedule is authoritative for its dates—even when closed. Never fall back to
  // a global OPEN period just because the matching regional period is closed.
  const regional = inRange.filter((p) => p.region_id != null);
  const containing = regional.length ? regional : inRange.filter((p) => p.region_id == null);
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
