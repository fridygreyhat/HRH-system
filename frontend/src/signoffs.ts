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
}

/** Opens the report on one month, work type and region: `2026-10:PAYROLL:11`. */
export const signoffTarget = (item: Pick<SignoffItem, 'month' | 'work_type' | 'region_id'>) => `${item.month}:${item.work_type}:${item.region_id}`;

