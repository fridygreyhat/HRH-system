import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useAction, useApi } from '../hooks';
import { ProviderPaymentDetails as ProviderPaymentDetailsType } from '../types';
import { Icon } from '../components/Icon';
import { Alert, DevCodeNotice, Field, Section } from '../components/ui';
import './polish-provider.css';

const emptyDetails: ProviderPaymentDetailsType = {
  staff_id: 0,
  bank_name: null,
  bank_account_number: null,
  bank_branch: null,
  mobile_money_number: null,
};

type NewDetails = Omit<ProviderPaymentDetailsType, 'staff_id'>;
interface CodeSent { changed: boolean; phone?: string; minutes?: number; dev_otp?: string }

function mask(value: string | null, empty: string): string {
  if (!value) return empty;
  return `${'•'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}

function normalizeMobile(value: string): string {
  const input = value.trim().replace(/[()\s-]/g, '');
  if (/^0\d{9}$/.test(input)) return `+255${input.slice(1)}`;
  if (/^255\d{9}$/.test(input)) return `+${input}`;
  return input;
}

export function ProviderPaymentDetails() {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const details = useApi<ProviderPaymentDetailsType>('/provider-details/me');
  const save = useAction();
  const [editing, setEditing] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [form, setForm] = useState<ProviderPaymentDetailsType>(emptyDetails);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState<NewDetails | null>(null);
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [code, setCode] = useState('');

  const notAdded = sw ? 'Haijawekwa' : 'Not added';

  useEffect(() => {
    if (details.data && !editing) setForm(details.data);
  }, [details.data, editing]);

  const beginEdit = () => {
    if (details.data) setForm(details.data);
    setSuccess(false);
    save.setError(null);
    setEditing(true);
  };

  const finish = (result: ProviderPaymentDetailsType | null) => {
    if (result) {
      details.setData(result);
      setForm(result);
    }
    setEditing(false);
    setPending(null);
    setSent(null);
    setCode('');
    setShowFull(false);
  };

  const bankAny = Boolean(form.bank_name?.trim() || form.bank_account_number?.trim() || form.bank_branch?.trim());
  const bankComplete = Boolean(form.bank_name?.trim() && form.bank_account_number?.trim() && form.bank_branch?.trim());
  const accountValid = !form.bank_account_number?.trim() || /^\d{6,34}$/.test(form.bank_account_number.trim());
  const mobileValue = form.mobile_money_number?.trim() || '';
  const normalizedMobile = normalizeMobile(mobileValue);
  const mobileValid = !mobileValue || /^\+255[67]\d{8}$/.test(normalizedMobile);
  const valid = (!bankAny || bankComplete) && accountValid && mobileValid;

  const sendCode = async (payload: NewDetails) => {
    const result = await save.run(() => api.post<CodeSent>('/provider-details/me/code', payload));
    if (!result) return;
    if (!result.changed) {
      finish(null);
      return;
    }
    setPending(payload);
    setSent(result);
    setCode('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    await sendCode({
      bank_name: form.bank_name?.trim() || null,
      bank_account_number: form.bank_account_number?.trim() || null,
      bank_branch: form.bank_branch?.trim() || null,
      mobile_money_number: mobileValue ? normalizedMobile : null,
    });
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pending || code.length !== 6) return;
    const result = await save.run(() => api.put<ProviderPaymentDetailsType>('/provider-details/me', { ...pending, code }));
    if (result) {
      finish(result);
      setSuccess(true);
    }
  };

  return (
    <div className="stack-lg pay-page">
      <div className="page-header">
        <div>
          <h1>{sw ? 'Taarifa za malipo' : 'Payment details'}</h1>
        </div>
        {!editing && details.data && (
          <button type="button" className="btn btn-primary" onClick={beginEdit}>{sw ? 'Badilisha taarifa' : 'Edit details'}</button>
        )}
      </div>

      {details.error && (
        <div className="stack">
          <Alert>{details.error}</Alert>
          <div><button type="button" className="btn btn-secondary" onClick={details.reload} disabled={details.loading}>{details.loading ? (sw ? 'Inapakia…' : 'Loading…') : (sw ? 'Jaribu tena' : 'Try again')}</button></div>
        </div>
      )}
      {details.loading && !details.data && <div className="card loading" role="status">{sw ? 'Inapakia taarifa zako za malipo…' : 'Loading your payment details…'}</div>}
      {!details.error && details.data && pending && sent && (
        <Section title={sw ? 'Thibitisha kwa namba ya SMS' : 'Confirm with the SMS code'}>
          <form className="stack" onSubmit={confirm}>
            <p>
              {sw
                ? `Weka namba ya tarakimu 6 iliyotumwa kwa ${sent.phone}. Itaisha baada ya dakika ${sent.minutes}.`
                : `Enter the 6-digit code sent to ${sent.phone}. It expires in ${sent.minutes} minutes.`}
            </p>
            <DevCodeNotice code={sent.dev_otp} />
            <Field label={sw ? 'Namba ya uthibitisho' : 'Confirmation code'}>
              <input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={save.busy || code.length !== 6}>{save.busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Thibitisha na hifadhi' : 'Confirm and save')}</button>
              <button type="button" className="btn btn-secondary" onClick={() => sendCode(pending)} disabled={save.busy}>{sw ? 'Tuma namba mpya' : 'Send a new code'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setPending(null); setSent(null); setCode(''); save.setError(null); }} disabled={save.busy}>{sw ? 'Rudi' : 'Back'}</button>
            </div>
            <p className="muted small">
              {sw
                ? 'Hupati SMS? Muombe msimamizi wako. Hukuomba mabadiliko haya? Mjulishe msimamizi wako sasa.'
                : 'No SMS? Ask your administrator. Not your change? Tell your supervisor now.'}
            </p>
            <Alert>{save.error}</Alert>
          </form>
        </Section>
      )}
      {!details.error && details.data && !pending && (
        <>
          <Alert kind="success">{success ? (sw ? 'Taarifa za malipo zimehifadhiwa.' : 'Payment details saved.') : null}</Alert>
          <div className="pay-cards">
            <section className={`card pay-card${editing ? ' is-editing' : ''}`} aria-labelledby="pay-bank-title">
              <div className="pay-card-head">
                <span className="pay-card-icon" aria-hidden="true"><Icon name="wallet" /></span>
                <div>
                  <h3 id="pay-bank-title">{sw ? 'Akaunti ya benki' : 'Bank account'}</h3>
                  <p className="muted small">{sw ? 'Kwa mshahara (Payroll)' : 'For Payroll salary'}</p>
                </div>
                {!editing && <span className={`badge ${details.data.bank_account_number ? 'badge-success' : 'badge-neutral'}`}>{details.data.bank_account_number ? (sw ? 'Imewekwa' : 'Added') : notAdded}</span>}
              </div>
              {!editing ? (
                <dl className="pay-facts">
                  <div><dt>{sw ? 'Benki' : 'Bank'}</dt><dd>{details.data.bank_name || notAdded}</dd></div>
                  <div><dt>{sw ? 'Namba ya akaunti' : 'Account number'}</dt><dd className="pay-number">{showFull ? details.data.bank_account_number || notAdded : mask(details.data.bank_account_number, notAdded)}</dd></div>
                  <div><dt>{sw ? 'Tawi' : 'Branch'}</dt><dd>{details.data.bank_branch || notAdded}</dd></div>
                </dl>
              ) : (
                <form id="payment-details-form" className="stack" onSubmit={submit}>
                  <p className="muted small">{sw ? 'Jaza sehemu zote tatu za benki; namba ya akaunti ni tarakimu 6–34.' : 'Fill all three bank fields; account number is 6–34 digits.'}</p>
                  <Field label={sw ? 'Jina la benki' : 'Bank name'}><input autoComplete="organization" maxLength={120} value={form.bank_name || ''} onChange={(e) => setForm((current) => ({ ...current, bank_name: e.target.value }))} /></Field>
                  <Field label={sw ? 'Namba ya akaunti' : 'Account number'}><input inputMode="numeric" autoComplete="off" maxLength={34} value={form.bank_account_number || ''} onChange={(e) => setForm((current) => ({ ...current, bank_account_number: e.target.value }))} /></Field>
                  <Field label={sw ? 'Tawi' : 'Branch'}><input maxLength={120} value={form.bank_branch || ''} onChange={(e) => setForm((current) => ({ ...current, bank_branch: e.target.value }))} /></Field>
                  {bankAny && !bankComplete && <Alert kind="warn">{sw ? 'Weka benki, namba ya akaunti na tawi pamoja, au futa zote tatu.' : 'Enter the bank, account number and branch together, or clear all three.'}</Alert>}
                  {!accountValid && <Alert>{sw ? 'Namba ya akaunti lazima iwe na tarakimu 6–34.' : 'Account number must be 6–34 digits.'}</Alert>}
                </form>
              )}
            </section>
            <section className={`card pay-card${editing ? ' is-editing' : ''}`} aria-labelledby="pay-mobile-title">
              <div className="pay-card-head">
                <span className="pay-card-icon" aria-hidden="true"><Icon name="phone" /></span>
                <div>
                  <h3 id="pay-mobile-title">{sw ? 'Pesa kwa simu' : 'Mobile money'}</h3>
                  <p className="muted small">{sw ? 'Kwa malipo ya Huduma' : 'For Services payments'}</p>
                </div>
                {!editing && <span className={`badge ${details.data.mobile_money_number ? 'badge-success' : 'badge-neutral'}`}>{details.data.mobile_money_number ? (sw ? 'Imewekwa' : 'Added') : notAdded}</span>}
              </div>
              {!editing ? (
                <dl className="pay-facts"><div><dt>{sw ? 'Namba ya pesa kwa simu' : 'Mobile money number'}</dt><dd className="pay-number">{showFull ? details.data.mobile_money_number || notAdded : mask(details.data.mobile_money_number, notAdded)}</dd></div></dl>
              ) : (
                <div className="stack">
                  <p className="muted small">{sw ? 'Namba ya Tanzania, mfano +255 712 345 678.' : 'Tanzanian number, e.g. +255 712 345 678.'}</p>
                  <Field label={sw ? 'Namba ya pesa kwa simu' : 'Mobile money number'}>
                    <input type="tel" inputMode="tel" autoComplete="tel" maxLength={24} value={form.mobile_money_number || ''} onChange={(e) => setForm((current) => ({ ...current, mobile_money_number: e.target.value }))} />
                  </Field>
                  {!mobileValid && <Alert>{sw ? 'Tumia namba ya simu ya Tanzania: +255, kisha 6 au 7, kisha tarakimu 8.' : 'Use a Tanzanian mobile number in +255 6 or 7 followed by 8 digits.'}</Alert>}
                </div>
              )}
            </section>
          </div>
          {editing && (
            <>
              <div className="row pay-actions">
                <button type="submit" form="payment-details-form" className="btn btn-primary" disabled={save.busy || !valid}>{save.busy ? (sw ? 'Inatuma…' : 'Sending…') : (sw ? 'Hifadhi taarifa za malipo' : 'Save payment details')}</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setEditing(false); setForm(details.data || emptyDetails); save.setError(null); }} disabled={save.busy}>{sw ? 'Ghairi' : 'Cancel'}</button>
                <span className="muted small">{sw ? 'Namba ya uthibitisho itatumwa kwa SMS kabla ya kuhifadhi.' : 'A confirmation code is sent by SMS before saving.'}</span>
              </div>
            </>
          )}
          {!editing && details.data && (
            <button type="button" className="btn btn-ghost btn-sm pay-reveal" onClick={() => setShowFull((visible) => !visible)}>{showFull ? (sw ? 'Ficha namba' : 'Hide sensitive numbers') : (sw ? 'Onyesha namba' : 'Reveal sensitive numbers')}</button>
          )}
          <Alert>{save.error}</Alert>
        </>
      )}
    </div>
  );
}
