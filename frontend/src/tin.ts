/** Tanzania Taxpayer Identification Number (TIN): 9 digits, written 123-456-789. Matches backend/core/tin.py. */
export const TIN_LABEL = 'TIN (Taxpayer Identification Number)';
export const TIN_HINT = '9 digits, e.g. 123-456-789. Leave blank if the person has no TIN yet.';
export const TIN_MESSAGE = 'TIN: enter the 9-digit Taxpayer Identification Number, e.g. 123-456-789.';
/** Lets the browser accept spaces and dashes as people type them; the exact check is normalizeTin. */
export const TIN_INPUT_PATTERN = '[0-9 \\-]{9,13}';

/** '' when blank (TIN is optional), the number as 123-456-789, or null when it is not 9 digits. */
export function normalizeTin(value: string): string | null {
  const digits = value.replace(/[\s-]/g, '');
  if (!digits) return '';
  return /^\d{9}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : null;
}
