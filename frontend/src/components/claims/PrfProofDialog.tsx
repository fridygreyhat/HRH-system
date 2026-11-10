import React, { useState } from 'react';
import { api } from '../../api';
import { money, num, todayLocal } from '../../format';
import { useAction, useApi } from '../../hooks';
import { Alert, Field, Modal, pageLang } from '../ui';
import { MAX_SERVICE_PROOF_BYTES, SERVICE_PROOF_TYPES } from './ServicesProofPaymentDialog';

interface Beneficiary {
  claim_id: number;
  provider_name: string;
  services: string[];
  amount: string;
  outstanding_amount: string;
  currency: string;
  can_record_with_proof: boolean;
  payment_status: string;
}

/** After paying a PRF outside the system, Central Finance uploads one proof for all of its unpaid claims. */
export function PrfProofDialog({ prf, onClose, onDone }: {
  prf: { id: number; prf_number: string };
  onClose: () => void;
  onDone: (paid: number) => void;
}) {
  const sw = pageLang() === 'sw';
  const list = useApi<Beneficiary[]>(`/finance/services-payment-report/prf/${prf.id}/claims`);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [method, setMethod] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { busy, error, run } = useAction();
  const rows = list.data || [];
  const unpaid = rows.filter((row) => !['PAID', 'RECONCILED'].includes(row.payment_status));
  const blocked = unpaid.filter((row) => !row.can_record_with_proof);
  const total = unpaid.reduce((sum, row) => sum + Number(Number(row.outstanding_amount) > 0 ? row.outstanding_amount : row.amount), 0);
  const currency = unpaid[0]?.currency || '';
  const ready = !!file && !fileError && !!reference.trim() && !!date && confirmed && unpaid.length > 0 && blocked.length === 0;

  const choose = (next: File | null) => {
    setFile(next);
    setFileError(next && !SERVICE_PROOF_TYPES.includes(next.type) ? (sw ? 'Chagua hati ya PDF, PNG au JPEG.' : 'Choose a PDF, PNG or JPEG document.')
      : next && next.size > MAX_SERVICE_PROOF_BYTES ? (sw ? 'Faili lisizidi MB 10.' : 'The file must be 10 MB or smaller.') : null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !ready) return;
    const form = new FormData();
    form.append('file', file);
    form.append('payment_reference', reference.trim());
    form.append('payment_date', date);
    form.append('beneficiaries_confirmed', 'true');
    if (method) form.append('payment_method', method);
    const result = await run(() => api.upload<{ paid_count: number }>(`/finance/services-payment-report/prf/${prf.id}/proof`, form));
    if (result) onDone(result.paid_count);
  };

  return (
    <Modal title={sw ? `PRF ${prf.prf_number} · pakia uthibitisho wa malipo` : `PRF ${prf.prf_number} · upload proof of payment`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="notice notice-info">{sw
          ? 'Pakia hati moja ya malipo kwa madai yote ambayo hayajalipwa.'
          : 'Upload one payment document for all unpaid claims on this PRF.'}</p>
        {list.error && <Alert>{list.error}</Alert>}
        {list.loading && !list.data && <p className="muted" role="status">{sw ? 'Inapakia madai ya PRF…' : 'Loading the PRF claims…'}</p>}
        {list.data && (
          <>
            <p><strong>{sw ? `Madai ${num(unpaid.length)} ya kulipwa` : `${num(unpaid.length)} claims to pay`}</strong>
              {' · '}{money(total, currency)}{rows.length > unpaid.length && (sw ? ` · ${num(rows.length - unpaid.length)} tayari yamelipwa` : ` · ${num(rows.length - unpaid.length)} already paid`)}</p>
            {blocked.length > 0 && <Alert kind="warn">{sw
              ? `Madai ${num(blocked.length)} hayako tayari kwa malipo: ${blocked.map((row) => `#${row.claim_id}`).join(', ')}.`
              : `${num(blocked.length)} claim(s) are not ready for payment: ${blocked.map((row) => `#${row.claim_id}`).join(', ')}.`}</Alert>}
            <div className="table-wrap prf-proof-list">
              <table>
                <thead><tr><th>{sw ? 'Dai' : 'Claim'}</th><th>{sw ? 'Mtoa huduma' : 'Provider'}</th><th>{sw ? 'Huduma' : 'Services'}</th><th className="num">{sw ? 'Kiasi' : 'Amount'}</th></tr></thead>
                <tbody>
                  {unpaid.map((row) => (
                    <tr key={row.claim_id}><td>#{row.claim_id}</td><td>{row.provider_name}</td><td>{row.services.join(' · ') || '—'}</td>
                      <td className="num">{money(Number(row.outstanding_amount) > 0 ? row.outstanding_amount : row.amount, row.currency)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {unpaid.length > 0 && (
              <>
                <div className="grid-2">
                  <Field label={sw ? 'Kumbukumbu ya malipo' : 'Payment reference'}>
                    <input required maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />
                  </Field>
                  <Field label={sw ? 'Tarehe ya malipo' : 'Payment date'}>
                    <input type="date" required max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                  <Field label={sw ? 'Njia ya malipo (si lazima)' : 'Payment method (optional)'}>
                    <select value={method} onChange={(e) => setMethod(e.target.value)}>
                      <option value="">{sw ? 'Haijabainishwa' : 'Not specified'}</option>
                      <option value="BANK">{sw ? 'Benki' : 'Bank'}</option>
                      <option value="MOBILE_WALLET">{sw ? 'Pesa kwa simu' : 'Mobile wallet'}</option>
                    </select>
                  </Field>
                  <Field label={sw ? 'Hati ya uthibitisho' : 'Proof document'} hint={sw ? 'PDF, PNG au JPEG · hadi MB 10' : 'PDF, PNG or JPEG · maximum 10 MB'}>
                    <input type="file" accept="application/pdf,image/png,image/jpeg" required onChange={(e) => choose(e.target.files?.[0] || null)} />
                  </Field>
                </div>
                <Alert>{fileError}</Alert>
                <label className="check-line">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  <span>{sw
                    ? 'Nimekagua hati ya malipo; inaorodhesha kila mtoa huduma na kiasi chake.'
                    : 'I checked the payment document; it lists every provider and amount.'}</span>
                </label>
              </>
            )}
          </>
        )}
        <Alert>{error}</Alert>
        <div className="row">
          {unpaid.length > 0 && <button type="submit" className="btn btn-primary" disabled={busy || !ready}>{busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Hifadhi uthibitisho na malipo' : 'Save proof and payment')}</button>}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{sw ? 'Funga' : 'Close'}</button>
        </div>
      </form>
    </Modal>
  );
}
