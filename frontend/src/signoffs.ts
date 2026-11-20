/** Regional Finance sign-offs of the monthly reports, shared by Home and the Monthly work report page.
 *  Kept apart from the page so Home does not download the whole report screen. */
export type SignoffWorkType = 'PAYROLL' | 'SERVICES';

/** One regional report of a recent pay month and whether Regional Finance has signed it. */
export interface SignoffItem {
  month: string;
  region_id: number;
  region_name: string;
  work_type: SignoffWorkType;
  state: 'NOT_SIGNED' | 'CHANGED' | 'SIGNED';
  providers: number;
  approved_at: string | null;
  approved_by_name: string | null;
  can_approve: boolean;
  /** Payroll: timesheets Regional Finance still has to approve before the month can be signed and sent. */
  to_approve?: number;
  /** Payroll: providers on the signed report whose salary the CSO has recorded as paid in full, with proof. */
  paid_providers?: number;
  /** Set when the month was signed, then taken back because a timesheet on it was returned, reopened or cancelled. */
  withdrawn?: Withdrawal | null;
}

/** A signed Payroll month taken back: the CSO must not pay from it until Regional Finance signs again. */
export interface Withdrawal {
  withdrawn_at: string;
  reason: string;
  signed_by_name: string;
  signed_at: string;
}

/** Why the month is no longer signed, for Regional Finance and the CSO. */
export const withdrawnText = (w: Withdrawal, sw: boolean) => sw
  ? `Saini ya ${w.signed_by_name} imechukuliwa tena: jedwali la mshahara lililokuwemo halijaidhinishwa tena. Fedha ya Mkoa isaini mwezi huu upya.`
  : w.reason;

/** The label of a month that is not signed now: never signed, or signed and taken back. */
export const notSignedLabel = (item: Pick<SignoffItem, 'withdrawn'>, sw: boolean) => item.withdrawn
  ? (sw ? 'Imechukuliwa tena: saini upya' : 'Taken back: sign again')
  : (sw ? 'Haijasainiwa' : 'Not signed');

/** Opens the report on one month, work type and region: `2026-10:PAYROLL:11`. */
export const signoffTarget = (item: Pick<SignoffItem, 'month' | 'work_type' | 'region_id'>) => `${item.month}:${item.work_type}:${item.region_id}`;

