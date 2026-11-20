/** A person's identity document: National ID (NIDA, 20 digits) or Voter ID. Matches backend/core/national_id.py. */
export type IdType = 'NIDA' | 'VOTER';

export const ID_TYPES: { value: IdType; label: string; hint: string; placeholder: string }[] = [
  { value: 'NIDA', label: 'National ID (NIDA)', hint: '20 digits, as on the card, e.g. 19900101-12345-12345-12.', placeholder: '19900101-12345-12345-12' },
  { value: 'VOTER', label: 'Voter ID', hint: 'The number as printed on the voter card.', placeholder: 'T-1234-5678-901' },
];

export const ID_REQUIRED_MESSAGE = "Enter the person's National ID (NIDA) or Voter ID number.";
export const NIDA_MESSAGE = 'National ID (NIDA): enter the 20-digit number, e.g. 19900101-12345-12345-12.';
export const VOTER_MESSAGE = 'Voter ID: enter the number as on the card, 6 to 30 letters and digits.';

export function idTypeLabel(value: string | null | undefined): string {
  return ID_TYPES.find((t) => t.value === value)?.label || 'ID';
}

/** The number in its standard form, or a message saying what is wrong. Blank gives ''. */
export function normalizeIdNumber(type: IdType | '', value: string): { value: string } | { error: string } {
  const text = value.replace(/\s/g, '').toUpperCase();
  if (!text) return { value: '' };
  if (type === 'NIDA') {
    const digits = text.replace(/-/g, '');
    if (!/^\d{20}$/.test(digits)) return { error: NIDA_MESSAGE };
    return { value: `${digits.slice(0, 8)}-${digits.slice(8, 13)}-${digits.slice(13, 18)}-${digits.slice(18)}` };
  }
  if (type === 'VOTER') {
    return /^[A-Z0-9][A-Z0-9-]{4,28}[A-Z0-9]$/.test(text) ? { value: text } : { error: VOTER_MESSAGE };
  }
  return { error: 'Choose the ID type (National ID or Voter ID) before the number.' };
}

/** The request fields, or a message. Required at registration: both the type and the number. */
export function identityPayload(type: IdType | '', number: string, required = true): { id_type: IdType | null; id_number: string | null } | string {
  const checked = normalizeIdNumber(type, number);
  if ('error' in checked) return checked.error;
  if (!checked.value) return required || type ? ID_REQUIRED_MESSAGE : { id_type: null, id_number: null };
  return { id_type: type as IdType, id_number: checked.value };
}
