/** Formatting helpers. All times are shown in the operational timezone, Africa/Dar_es_Salaam. */

export const TIMEZONE = 'Africa/Dar_es_Salaam';

export const humanize = (s: string | null | undefined): string =>
  s ? s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—';

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const num = (n: number | string | null | undefined): string =>
  n === null || n === undefined || n === '' ? '—' : numberFormat.format(Number(n));

export const money = (amount: number | string | null | undefined, currency = 'TZS'): string =>
  amount === null || amount === undefined ? '—' : `${currency} ${numberFormat.format(Number(amount))}`;

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** A timestamp (ISO with offset) shown in East Africa Time. */
export const dateTime = (iso: string | null | undefined): string => (iso ? `${dateTimeFormat.format(new Date(iso))} EAT` : '—');

const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });
const weekdaySwahili = ['Jpl', 'Jtt', 'Jnn', 'Jtn', 'Alh', 'Ijm', 'Jms']; // Sun..Sat

/** A calendar date ("YYYY-MM-DD") — no timezone shift. */
export const dateOnly = (d: string | null | undefined): string => (d ? dateFormat.format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : '—');

export const weekday = (d: string, lang: 'en' | 'sw' = 'en'): string => {
  const date = new Date(`${d}T00:00:00Z`);
  return lang === 'sw' ? weekdaySwahili[date.getUTCDay()] : weekdayFormat.format(date);
};

export const dayOfMonth = (d: string): number => Number(d.slice(8, 10));

/** Today's date in Dar es Salaam as "YYYY-MM-DD". */
export const todayLocal = (): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

/** Every date from start to end inclusive ("YYYY-MM-DD"). */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const timeShort = (t: string | null | undefined): string => (t ? t.slice(0, 5) : '—');

const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
/** Short money for chart labels, e.g. "TZS 1.2M"; tooltips and tables keep the full amount. */
export const compactMoney = (amount: number, currency = 'TZS'): string => `${currency} ${compactFormat.format(amount)}`;

export const hoursAge = (hours: number): string => {
  if (hours < 1) return 'under 1 h';
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.floor(hours / 24)} d ${Math.round(hours % 24)} h`;
};

export const ageSince = (iso: string): string => hoursAge((Date.now() - new Date(iso).getTime()) / 3_600_000);

export const fileSize = (bytes: number): string =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// ---- Labels ----------------------------------------------------------------------------

export const WORKLOG_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_CTC_VERIFICATION: 'Awaiting CTC verification',
  PENDING_PROVIDER_OTP_CONFIRMATION: 'Awaiting provider confirmation',
  PENDING_TECHNICAL_REVIEW: 'Awaiting technical review',
  PENDING_RPM_AUTHORIZATION: 'Awaiting RPM authorization',
  PENDING_FINANCE_REVIEW: 'Awaiting regional finance review',
  FINANCE_REVIEWED: 'Finance reviewed',
  PENDING_ROUTING: 'Awaiting payor routing',
  ROUTED_FHI360: 'Routed to FHI360',
  ROUTED_CSO: 'Routed to CSO',
  APPROVED: 'Approved',
  PAID: 'Paid',
  RETURNED_TO_PROVIDER: 'Returned to provider',
  REJECTED: 'Rejected',
  BUDGET_HOLD: 'Budget hold',
  CANCELLED: 'Cancelled',
};
export const WORKLOG_STATUSES = Object.keys(WORKLOG_STATUS_LABELS);

export const CLAIM_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  VALIDATION_NEEDED: 'Validation needed',
  PENDING_COMMUNITY_VERIFICATION: 'Awaiting community verification',
  AWAITING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
  HELD: 'Held (budget)',
  BUDGET_HOLD: 'Budget hold',
  PENDING_ROUTING: 'Awaiting payor routing',
  READY: 'Ready for payment',
  EXPORTED: 'Exported',
  HANDED_OFF: 'Handed off to CSO',
  CANCELLED: 'Cancelled',
};
export const CLAIM_STATUSES = Object.keys(CLAIM_STATUS_LABELS);

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'Not started',
  PENDING: 'Pending payment',
  PARTIALLY_RECORDED: 'Partially recorded',
  PROOF_REQUIRED: 'Proof required',
  PAID: 'Paid',
  FAILED: 'Failed',
  RECONCILED: 'Reconciled',
};
export const PAYMENT_STATUSES = Object.keys(PAYMENT_STATUS_LABELS);

export const LOCATION_LABELS: Record<string, string> = {
  WITHIN_GEOFENCE: 'Within facility area',
  OUTSIDE_GEOFENCE: 'Outside facility area – for review',
  NO_GPS: 'No location captured – for review',
  NO_GEOFENCE: 'Facility area not configured – for review',
  COMMUNITY_REVIEW: 'Community location – for supervisor review',
  NOT_CAPTURED: 'Location not requested',
};

export const WORKLOG_ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  edit_header: 'Edited header',
  edit_entry: 'Edited daily entry',
  delete_entry: 'Deleted daily entry',
  submit: 'Submit',
  cancel: 'Cancel work log',
  verify: 'Verify (CTC)',
  return: 'Return to provider',
  confirm_otp: 'Confirmed by SMS code',
  decline: 'Decline (report a problem)',
  endorse: 'Technical endorsement',
  return_to_reviewer: 'Return to previous reviewer',
  reject: 'Reject',
  authorize: 'Authorize (RPM)',
  finance_review: 'Complete finance review',
  route_fhi360: 'Route to FHI360',
  route_cso: 'Route to CSO',
  paid: 'Record paid',
  hold: 'Budget hold',
  release: 'Release hold',
  reopen: 'Reopen for correction',
  facility_endorse: 'Facility in-charge endorsement',
  opened: 'Opened for review',
  otp_resend: 'Requested a new code',
  otp_failed: 'Incorrect code entered',
};

export const CLAIM_ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  verify_community: 'Verify community service',
  revalidate: 'Revalidate',
  submit: 'Submit for approval',
  approve: 'Approve',
  send_back: 'Send back for validation',
  release: 'Release budget hold',
  mark_ready: 'Mark ready for payment',
  cancel: 'Cancel claim',
  export: 'Exported in batch',
  hand_off: 'Handed off to CSO',
  cso_receive: 'CSO acknowledged receipt',
  record_payment: 'Payment recorded',
  upload_proof: 'Proof uploaded',
  confirm_paid: 'Confirm paid',
  reconcile: 'Reconcile',
};

export const WORKLOG_REASON_REQUIRED = new Set(['return', 'return_to_reviewer', 'reject', 'hold', 'release', 'reopen', 'decline']);
export const CLAIM_REASON_REQUIRED = new Set(['send_back', 'cancel']);
export const DESTRUCTIVE_ACTIONS = new Set(['return', 'return_to_reviewer', 'reject', 'hold', 'reopen', 'decline', 'cancel', 'send_back']);

export const ROLE_LABELS: Record<string, string> = {
  PROVIDER: 'Provider',
  SUPERVISOR: 'CTC In-Charge / Supervisor',
  FACILITY_IN_CHARGE: 'Facility In-Charge',
  TECHNICAL_OFFICER: 'Technical Officer',
  RPM: 'Regional Program Manager',
  REGIONAL_FINANCE: 'Regional Finance',
  COMMUNITY_VERIFIER: 'Community Verifier',
  FHI360_FINANCE: 'FHI360 Finance',
  CSO_FINANCE: 'CSO Finance',
  OVERSIGHT: 'Oversight',
  CENTRAL_ADMIN: 'Central Admin',
  REGIONAL_ADMIN: 'Regional Admin',
  SYSTEM_ADMIN: 'System Admin',
  SUPER_ADMIN: 'Super Admin',
};

/** Plain names for payment routes: FHI360 pays route A; the assigned CSO pays routes B and C. */
export const ROUTE_LABELS: Record<string, string> = {
  A: 'FHI360 Payment',
  B: 'CSO Payment · Facility payroll',
  C: 'CSO Payment · Community',
};
export const routeLabel = (r: string | null | undefined): string => (r ? ROUTE_LABELS[r] || r : 'No payment route');

export const roleLabel = (r: string | null | undefined): string => (r ? ROLE_LABELS[r] || humanize(r) : '—');
export const label = (map: Record<string, string>, key: string | null | undefined): string => (key ? map[key] || humanize(key) : '—');
