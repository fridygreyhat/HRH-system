import React from 'react';
import { Field } from '../ui';
import { normalizeTin, TIN_HINT, TIN_INPUT_PATTERN, TIN_LABEL, TIN_MESSAGE } from '../../tin';

/** What only a provider shares at registration: the CSO pays their salary into this bank account. */
export interface ProviderPay {
  tin_number: string;
  bank_name: string;
  bank_account_number: string;
}

export const EMPTY_PROVIDER_PAY: ProviderPay = { tin_number: '', bank_name: '', bank_account_number: '' };

/** Banks most providers use; any other bank can be typed. */
const BANKS = ['CRDB Bank', 'NMB Bank', 'NBC Bank', 'Stanbic Bank', 'Exim Bank', 'Absa Bank', 'Equity Bank', 'DTB Bank',
  'Azania Bank', 'TCB Bank', 'Akiba Commercial Bank', 'Mwanga Hakika Bank', 'Amana Bank', 'I&M Bank', 'KCB Bank'];

const BANK_MESSAGE = "Bank name: letters, digits, spaces and . , ' & / ( ) - only.";
const ACCOUNT_MESSAGE = 'Bank account number: 6 to 34 digits, as on the bank statement.';

/** The request fields, or a message saying what is missing or wrong. Matches backend/api/endpoints/staff.py. */
export function providerPayPayload(v: ProviderPay): { tin_number: string; bank_name: string; bank_account_number: string } | string {
  const tin = normalizeTin(v.tin_number);
  const account = v.bank_account_number.replace(/[\s-]/g, '');
  const missing = [!tin && tin !== null ? 'TIN' : null, !v.bank_name.trim() ? 'bank name' : null, !account ? 'bank account number' : null].filter(Boolean);
  if (missing.length) return `Enter the provider's ${missing.join(', ')}: the CSO pays their salary into this bank account.`;
  if (tin === null) return TIN_MESSAGE;
  if (!/^[0-9]{6,34}$/.test(account)) return ACCOUNT_MESSAGE;
  if (!/^[A-Za-z0-9][A-Za-z0-9 .,'&/()-]{0,99}$/.test(v.bank_name.trim())) return BANK_MESSAGE;
  return { tin_number: tin, bank_name: v.bank_name.trim(), bank_account_number: account };
}

/** No TIN or bank account: sent as empty for Government facility staff, who are paid for Services only. */
export const NO_PROVIDER_PAY = { tin_number: null, bank_name: null, bank_account_number: null };

export const SERVICES_ONLY_NOTE =
  'Government facility staff are paid for Services only, to the mobile wallet of their phone. No TIN or bank account is needed.';

export function ProviderPayFields({ value, onChange, disabled }: { value: ProviderPay; onChange: (v: ProviderPay) => void; disabled?: boolean }) {
  const set = (k: keyof ProviderPay) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset className="stack provider-pay">
      <legend>Tax and bank details (required)</legend>
      <p className="muted small">Only providers give these. The CSO pays the salary into this account.</p>
      <div className="grid-2">
        <Field label={`${TIN_LABEL} *`} hint={TIN_HINT.replace(' Leave blank if the person has no TIN yet.', '')}>
          <input inputMode="numeric" value={value.tin_number} onChange={set('tin_number')} pattern={TIN_INPUT_PATTERN} maxLength={13}
            placeholder="123-456-789" autoComplete="off" required disabled={disabled} />
        </Field>
        <Field label="Bank name *">
          <input value={value.bank_name} onChange={set('bank_name')} list="provider-banks" maxLength={100} autoComplete="off" required disabled={disabled} />
          <datalist id="provider-banks">{BANKS.map((bank) => <option key={bank} value={bank} />)}</datalist>
        </Field>
        <Field label="Bank account number *" hint="As on the bank statement.">
          <input inputMode="numeric" value={value.bank_account_number} onChange={set('bank_account_number')} maxLength={40} autoComplete="off" required disabled={disabled} />
        </Field>
      </div>
    </fieldset>
  );
}
