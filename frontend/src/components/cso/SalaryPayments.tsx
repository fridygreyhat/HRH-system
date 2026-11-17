import React, { useEffect, useMemo, useState } from 'react';
import { api, qs, saveBlob } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateOnly, money, num, payMonth, payMonthDates, previousMonth, todayLocal } from '../../format';
import { useAction, useApi } from '../../hooks';
import { Alert, AsyncState, Empty, Field, KpiStrip, ReasonDialog, Section } from '../ui';

interface DueRow {
  staff_id: number;
  provider_name: string;
  cadre_name: string;
  region_name: string;
  expected: string;
  paid: string;
  outstanding: string;
}

export interface SalaryPayment {
  id: number;
  staff_id: number;
  provider_name: string;
  amount: string;
  status: 'PAID' | 'FAILED';
  payment_date: string;
  payment_reference: string;
  payment_method: string;
  has_proof: boolean;
  recorded_by_name: string | null;
  voided: boolean;
  void_reason: string | null;
}

interface SalaryPaymentsData {
  month: string;
  providers: DueRow[];
  payments: SalaryPayment[];
  totals: { providers: number; expected: string; paid: string; outstanding: string; unpaid_providers: number };
  proof_required: boolean;
}

/** The request body for one bank transfer or schedule paying the chosen providers. Amounts left blank mean "what is due". */
export function salaryPaymentForm(values: {
  csoId: string; month: string; chosen: Record<number, string>; date: string; reference: string; method: string; status: string; proof: File | null;
}): FormData {
  const form = new FormData();
  form.append('cso_id', values.csoId);
  form.append('month', values.month);
  form.append('items', JSON.stringify(Object.entries(values.chosen).map(([staffId, amount]) => (
    amount.trim() ? { staff_id: Number(staffId), amount: amount.trim() } : { staff_id: Number(staffId) }))));
  form.append('payment_date', values.date);
  form.append('payment_reference', values.reference.trim());
  form.append('payment_method', values.method);
  form.append('status', values.status);
  if (values.proof) form.append('proof', values.proof);
  return form;
}

/**
 * CSO Finance records the salaries it paid for a signed month, with the bank reference and the bank schedule as proof.
 * Central Finance reconciles these against the signed salary file.
 */
export function SalaryPayments({ csoId }: { csoId: string }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const [month, setMonth] = useState(() => previousMonth(payMonth(todayLocal())));
  const data = useApi<SalaryPaymentsData>(csoId && month ? `/cso-finance/salary-payments${qs({ cso_id: csoId, month })}` : null);
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [date, setDate] = useState(todayLocal());
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState('BANK');
  const [status, setStatus] = useState('PAID');
  const [proof, setProof] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<SalaryPayment | null>(null);
  const save = useAction();
  const download = useAction();
  useEffect(() => setChosen({}), [month, csoId]);

  const due = useMemo(() => (Array.isArray(data.data?.providers) ? data.data!.providers : []).filter((row) => Number(row.outstanding) > 0), [data.data]);
  const chosenTotal = Object.entries(chosen).reduce((sum, [staffId, amount]) => {
    const row = due.find((r) => r.staff_id === Number(staffId));
    return sum + (amount.trim() ? Number(amount) : Number(row?.outstanding || 0));
  }, 0);
  const allChosen = due.length > 0 && due.every((row) => row.staff_id in chosen);

  const toggle = (staffId: number) => {
    const next = { ...chosen };
    if (staffId in next) delete next[staffId];
    else next[staffId] = '';
    setChosen(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    const result = await save.run(() => api.upload<{ recorded: number }>('/cso-finance/salary-payments',
      salaryPaymentForm({ csoId, month, chosen, date, reference, method, status, proof })));
    if (result) {
      setNotice(sw ? `Malipo ${num(result.recorded)} yamerekodiwa (${reference.trim()}).` : `Recorded ${num(result.recorded)} ${result.recorded === 1 ? 'payment' : 'payments'} (${reference.trim()}).`);
      setChosen({});
      setReference('');
      setProof(null);
      data.reload();
    }
  };

  const proofFile = async (payment: SalaryPayment) => {
    const file = await download.run(() => api.blob(`/cso-finance/salary-payments/${payment.id}/proof${qs({ cso_id: csoId })}`, 'GET', `salary-payment-${payment.id}`));
    if (file) saveBlob(file);
  };

  return (
    <Section title={sw ? 'Malipo ya mshahara yaliyofanyika' : 'Salary payments made'}
      actions={<span className="muted small">{sw ? 'Rekodi kila malipo ili Fedha Kuu iweze kulinganisha.' : 'Record each payment so Central Finance can reconcile it.'}</span>}>
      <div className="fin-toolbar">
        <div className="filters">
          <Field label={sw ? 'Mwezi wa kazi' : 'Month worked'} hint={payMonthDates(month)}>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </Field>
        </div>
      </div>
      <Alert kind="success">{notice}</Alert>
      <AsyncState data={data.data} error={data.error} loading={data.loading}>
        {(d) => !d.totals || d.totals.providers === 0 ? (
          <Empty>{sw ? 'Hakuna mshahara uliosainiwa wa kulipa mwezi huu.' : 'No signed salaries to pay for this month.'}</Empty>
        ) : (
          <div className="stack">
            <KpiStrip
              label={sw ? 'Mishahara ya mwezi' : 'Salaries this month'}
              items={[
                { label: sw ? 'Iliyosainiwa' : 'Signed to pay', value: money(d.totals.expected), icon: 'wallet' },
                { label: sw ? 'Imelipwa' : 'Paid', value: money(d.totals.paid), icon: 'check', tone: 'success' },
                { label: sw ? 'Bado kulipwa' : 'Still to pay', value: money(d.totals.outstanding), icon: 'clock', tone: Number(d.totals.outstanding) ? 'warn' : 'success',
                  note: sw ? `watoa huduma ${num(d.totals.unpaid_providers)}` : `${num(d.totals.unpaid_providers)} ${d.totals.unpaid_providers === 1 ? 'provider' : 'providers'}` },
              ]}
            />
            {due.length > 0 ? (
              <form className="stack" onSubmit={submit} aria-label={sw ? 'Rekodi malipo ya mshahara' : 'Record salary payments'}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">
                          <input type="checkbox" aria-label={sw ? 'Chagua wote' : 'Choose everyone'} checked={allChosen}
                            onChange={() => setChosen(allChosen ? {} : Object.fromEntries(due.map((row) => [row.staff_id, ''])))} />
                        </th>
                        <th scope="col">{sw ? 'Mtoa huduma' : 'Provider'}</th>
                        <th scope="col" className="num">{sw ? 'Mshahara uliosainiwa' : 'Signed salary'}</th>
                        <th scope="col" className="num">{sw ? 'Imelipwa' : 'Paid'}</th>
                        <th scope="col" className="num">{sw ? 'Kiasi kilicholipwa sasa' : 'Amount paid now'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {due.map((row) => (
                        <tr key={row.staff_id}>
                          <td><input type="checkbox" aria-label={row.provider_name} checked={row.staff_id in chosen} onChange={() => toggle(row.staff_id)} /></td>
                          <td><span className="cell-main">{row.provider_name}</span><span className="cell-sub">{row.cadre_name} · {row.region_name}</span></td>
                          <td className="num nowrap">{money(row.expected)}</td>
                          <td className="num nowrap">{money(row.paid)}</td>
                          <td className="num">
                            <input type="number" min="0.01" step="0.01" max={row.outstanding} placeholder={row.outstanding}
                              aria-label={sw ? `Kiasi kwa ${row.provider_name}` : `Amount for ${row.provider_name}`}
                              disabled={!(row.staff_id in chosen)} value={chosen[row.staff_id] ?? ''}
                              onChange={(event) => setChosen({ ...chosen, [row.staff_id]: event.target.value })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid-3">
                  <Field label={sw ? 'Tarehe ya malipo' : 'Payment date'}>
                    <input type="date" value={date} max={todayLocal()} onChange={(event) => setDate(event.target.value)} required />
                  </Field>
                  <Field label={sw ? 'Namba ya kumbukumbu ya malipo' : 'Payment reference'} hint={sw ? 'Kama ilivyo kwenye taarifa ya benki' : 'As on the bank statement'}>
                    <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={200} required />
                  </Field>
                  <Field label={sw ? 'Njia ya malipo' : 'Paid by'}>
                    <select value={method} onChange={(event) => setMethod(event.target.value)}>
                      <option value="BANK">{sw ? 'Benki' : 'Bank'}</option>
                      <option value="MOBILE_WALLET">{sw ? 'Pesa ya simu' : 'Mobile money'}</option>
                    </select>
                  </Field>
                  <Field label={sw ? 'Matokeo' : 'Result'}>
                    <select value={status} onChange={(event) => setStatus(event.target.value)}>
                      <option value="PAID">{sw ? 'Imelipwa' : 'Paid'}</option>
                      <option value="FAILED">{sw ? 'Imeshindikana' : 'Failed'}</option>
                    </select>
                  </Field>
                  <Field label={`${sw ? 'Uthibitisho (PDF, PNG au JPEG)' : 'Proof (PDF, PNG or JPEG)'}${d.proof_required && status === 'PAID' ? ' *' : ''}`}
                    hint={sw ? 'Ratiba ya benki au risiti inayoonyesha malipo haya' : 'The bank schedule or receipt showing these payments'}>
                    <input type="file" accept="application/pdf,image/png,image/jpeg" required={d.proof_required && status === 'PAID'}
                      onChange={(event) => setProof(event.target.files?.[0] || null)} />
                  </Field>
                </div>
                <p><strong>{sw ? 'Waliochaguliwa' : 'Chosen'}: {num(Object.keys(chosen).length)} · {money(String(chosenTotal))}</strong></p>
                <Alert>{save.error}</Alert>
                <div>
                  <button type="submit" className="btn btn-primary" disabled={save.busy || !Object.keys(chosen).length}>
                    {save.busy ? (sw ? 'Inarekodi…' : 'Recording…') : (sw ? 'Rekodi malipo' : 'Record payments')}
                  </button>
                </div>
              </form>
            ) : <Alert kind="success">{sw ? 'Mishahara yote iliyosainiwa ya mwezi huu imelipwa.' : 'Every signed salary for this month is recorded as paid.'}</Alert>}
            {(d.payments || []).length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <caption className="muted small">{sw ? 'Malipo yaliyorekodiwa' : 'Payments recorded'}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{sw ? 'Mtoa huduma' : 'Provider'}</th>
                      <th scope="col" className="num">{sw ? 'Kiasi' : 'Amount'}</th>
                      <th scope="col">{sw ? 'Kumbukumbu' : 'Reference'}</th>
                      <th scope="col">{sw ? 'Hali' : 'Status'}</th>
                      <th scope="col"><span className="sr-only">{sw ? 'Vitendo' : 'Actions'}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td><span className="cell-main">{payment.provider_name}</span><span className="cell-sub">{dateOnly(payment.payment_date)} · {payment.recorded_by_name}</span></td>
                        <td className="num nowrap">{money(payment.amount)}</td>
                        <td>{payment.payment_reference}</td>
                        <td>
                          {payment.voided
                            ? <span className="badge badge-neutral" title={payment.void_reason || undefined}>{sw ? 'Imefutwa' : 'Voided'}</span>
                            : payment.status === 'PAID' ? <span className="badge badge-success">{sw ? 'Imelipwa' : 'Paid'}</span>
                              : <span className="badge badge-warn">{sw ? 'Imeshindikana' : 'Failed'}</span>}
                        </td>
                        <td className="row">
                          {payment.has_proof && <button type="button" className="btn btn-ghost btn-sm" onClick={() => proofFile(payment)} disabled={download.busy}>{sw ? 'Uthibitisho' : 'Proof'}</button>}
                          {!payment.voided && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVoiding(payment)}>{sw ? 'Futa' : 'Void'}</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Alert>{download.error}</Alert>
          </div>
        )}
      </AsyncState>
      {voiding && (
        <ReasonDialog
          title={sw ? `Futa malipo ya ${voiding.provider_name}` : `Void ${voiding.provider_name}'s payment`}
          description={sw ? 'Rekodi inabaki kwa ajili ya ukaguzi, lakini haihesabiwi tena. Kisha rekodi malipo sahihi.'
            : 'The record stays for the audit but no longer counts. Then record the correct payment.'}
          required
          danger
          confirmLabel={sw ? 'Futa malipo' : 'Void payment'}
          onClose={() => setVoiding(null)}
          onConfirm={async (reason) => {
            if (reason.length < 5) throw new Error(sw ? 'Eleza sababu (herufi 5 au zaidi).' : 'Say why (at least 5 characters).');
            await api.post(`/cso-finance/salary-payments/${voiding.id}/void`, { cso_id: Number(csoId), reason });
            setVoiding(null);
            data.reload();
          }}
        />
      )}
    </Section>
  );
}
