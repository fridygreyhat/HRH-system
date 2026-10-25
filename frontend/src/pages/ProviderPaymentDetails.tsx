import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAction, useApi } from '../hooks';
import { ProviderPaymentDetails as ProviderPaymentDetailsType } from '../types';
import { Alert, Field, Section } from '../components/ui';

const emptyDetails: ProviderPaymentDetailsType = {
  staff_id: 0,
  bank_name: null,
  bank_account_number: null,
  bank_branch: null,
  mobile_money_number: null,
};

function mask(value: string | null): string {
  if (!value) return 'Not added';
  return `${'•'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}

function normalizeMobile(value: string): string {
  const input = value.trim().replace(/[()\s-]/g, '');
  if (/^0\d{9}$/.test(input)) return `+255${input.slice(1)}`;
  if (/^255\d{9}$/.test(input)) return `+${input}`;
  return input;
}

export function ProviderPaymentDetails() {
  const details = useApi<ProviderPaymentDetailsType>('/provider-details/me');
  const save = useAction();
  const [editing, setEditing] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [form, setForm] = useState<ProviderPaymentDetailsType>(emptyDetails);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (details.data && !editing) setForm(details.data);
  }, [details.data, editing]);

  const beginEdit = () => {
    if (details.data) setForm(details.data);
    setSuccess(false);
    save.setError(null);
    setEditing(true);
  };

  const bankAny = Boolean(form.bank_name?.trim() || form.bank_account_number?.trim() || form.bank_branch?.trim());
  const bankComplete = Boolean(form.bank_name?.trim() && form.bank_account_number?.trim() && form.bank_branch?.trim());
  const accountValid = !form.bank_account_number?.trim() || /^\d{6,34}$/.test(form.bank_account_number.trim());
  const mobileValue = form.mobile_money_number?.trim() || '';
  const normalizedMobile = normalizeMobile(mobileValue);
  const mobileValid = !mobileValue || /^\+255[67]\d{8}$/.test(normalizedMobile);
  const valid = (!bankAny || bankComplete) && accountValid && mobileValid;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const payload = {
      bank_name: form.bank_name?.trim() || null,
      bank_account_number: form.bank_account_number?.trim() || null,
      bank_branch: form.bank_branch?.trim() || null,
      mobile_money_number: mobileValue ? normalizedMobile : null,
    };
    const result = await save.run(() => api.put<ProviderPaymentDetailsType>('/provider-details/me', payload));
    if (result) {
      details.setData(result);
      setForm(result);
      setEditing(false);
      setSuccess(true);
      setShowFull(false);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Payment details</h1>
          <p className="muted">Keep your payroll bank account and service-payment mobile wallet separate.</p>
        </div>
        {!editing && details.data && (
          <button type="button" className="btn btn-primary" onClick={beginEdit}>Edit details</button>
        )}
      </div>

      {details.error && (
        <div className="stack">
          <Alert>{details.error}</Alert>
          <div><button type="button" className="btn btn-secondary" onClick={details.reload} disabled={details.loading}>{details.loading ? 'Loading…' : 'Try again'}</button></div>
        </div>
      )}
      {details.loading && !details.data && <div className="card loading" role="status">Loading your payment details…</div>}
      {!details.error && details.data && (
        <>
          <Alert kind="success">{success ? 'Payment details saved.' : null}</Alert>
          <Section title="Payroll · bank account">
            {!editing ? (
              <dl className="facts">
                <div><dt>Bank</dt><dd>{details.data.bank_name || 'Not added'}</dd></div>
                <div><dt>Account number</dt><dd>{showFull ? details.data.bank_account_number || 'Not added' : mask(details.data.bank_account_number)}</dd></div>
                <div><dt>Branch</dt><dd>{details.data.bank_branch || 'Not added'}</dd></div>
              </dl>
            ) : (
              <form className="stack" onSubmit={submit}>
                <p className="notice notice-info">All three bank fields are required together for payroll. Account numbers must contain 6–34 digits.</p>
                <div className="grid-2">
                  <Field label="Bank name"><input autoComplete="organization" maxLength={120} value={form.bank_name || ''} onChange={(e) => setForm((current) => ({ ...current, bank_name: e.target.value }))} /></Field>
                  <Field label="Account number"><input inputMode="numeric" autoComplete="off" maxLength={34} value={form.bank_account_number || ''} onChange={(e) => setForm((current) => ({ ...current, bank_account_number: e.target.value }))} /></Field>
                  <Field label="Branch"><input maxLength={120} value={form.bank_branch || ''} onChange={(e) => setForm((current) => ({ ...current, bank_branch: e.target.value }))} /></Field>
                </div>
                {bankAny && !bankComplete && <Alert kind="warn">Enter the bank, account number and branch together, or clear all three.</Alert>}
                {!accountValid && <Alert>Account number must be 6–34 digits.</Alert>}
                <div className="row">
                  <button type="submit" className="btn btn-primary" disabled={save.busy || !valid}>{save.busy ? 'Saving…' : 'Save payment details'}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => { setEditing(false); setForm(details.data || emptyDetails); save.setError(null); }} disabled={save.busy}>Cancel</button>
                </div>
              </form>
            )}
          </Section>
          <Section title="Services · mobile money">
            {!editing ? (
              <dl className="facts"><div><dt>Mobile money number</dt><dd>{showFull ? details.data.mobile_money_number || 'Not added' : mask(details.data.mobile_money_number)}</dd></div></dl>
            ) : (
              <div className="stack">
                <p className="muted small">Used for eligible service payments only; payroll is paid to the bank account above. Enter a Tanzanian mobile number, for example +255 712 345 678.</p>
                <Field label="Mobile money number">
                  <input type="tel" inputMode="tel" autoComplete="tel" maxLength={24} value={form.mobile_money_number || ''} onChange={(e) => setForm((current) => ({ ...current, mobile_money_number: e.target.value }))} />
                </Field>
                {!mobileValid && <Alert>Use a Tanzanian mobile number in +255 6 or 7 followed by 8 digits.</Alert>}
              </div>
            )}
          </Section>
          {!editing && details.data && (
            <button type="button" className="btn btn-ghost" onClick={() => setShowFull((visible) => !visible)}>{showFull ? 'Hide sensitive numbers' : 'Reveal sensitive numbers'}</button>
          )}
          <Alert>{save.error}</Alert>
        </>
      )}
    </div>
  );
}
