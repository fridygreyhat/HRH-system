/** Tanzanian mobile numbers: the only numbers the SMS gateway can deliver reminders and codes to. Matches backend/core/phones.py. */
export const TZ_MOBILE_HINT = 'Active Tanzanian mobile, e.g. 0712 345 678 or +255712345678. A welcome SMS is sent to it.';
export const TZ_MOBILE_MESSAGE = 'Phone: enter an active Tanzanian mobile number: 07XXXXXXXX, 06XXXXXXXX or +2557XXXXXXXX.';
/** Lets the browser accept spaces and dashes as people type them; the exact check is normalizeTzMobile. */
export const TZ_MOBILE_INPUT_PATTERN = '[0-9 +()\\-]{9,20}';

export function normalizeTzMobile(value: string): string | null {
  let raw = value.replace(/[\s\-().]/g, '');
  if (/^0[67]\d{8}$/.test(raw)) raw = `+255${raw.slice(1)}`;
  else if (/^255[67]\d{8}$/.test(raw)) raw = `+${raw}`;
  return /^\+255[67]\d{8}$/.test(raw) ? raw : null;
}

export interface PhoneCheck { status: string; at: string | null; event: string | null }

/** Whether the last SMS reached this number. A failed one usually means a wrong or switched-off number. */
export function phoneCheckText(check: PhoneCheck | null | undefined): { text: string; tone: 'success' | 'warn' | 'neutral' } | null {
  if (!check) return null;
  if (check.status === 'SENT') return { text: 'SMS delivered to the gateway', tone: 'success' };
  if (check.status === 'FAILED') return { text: 'SMS failed: check the number is correct and active', tone: 'warn' };
  if (check.status === 'PENDING') return { text: 'Welcome SMS waiting to be sent', tone: 'neutral' };
  if (check.status === 'SUPPRESSED') return { text: 'Last SMS not sent (no longer needed)', tone: 'neutral' };
  return { text: 'No SMS sent to this number yet', tone: 'neutral' };
}
