import React, { useState } from 'react';
import { api, qs, saveBlob } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateOnly, dateTime, money, num, payMonth, payMonthDates, previousMonth, todayLocal } from '../../format';
import { useAction, useApi } from '../../hooks';
import { Alert, Field } from '../ui';
import { PrfProofDialog } from './PrfProofDialog';

interface Prf {
  id: number;
  paid_count: number;
  prf_number: string;
  prf_date: string;
  amounts: Record<string, string>;
  claim_count: number;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

interface Download {
  id: number;
  awaiting_review: number;
  format: string;
  row_count: number;
  claim_count: number;
  amounts: Record<string, string>;
  downloaded_at: string;
  prf: Prf | null;
}

const amountsText = (amounts: Record<string, string>) => Object.entries(amounts).map(([currency, total]) => money(total, currency)).join(' + ') || '—';

/** Central Finance downloads the routed Services for a month, then records the PRF it raised for exactly that file. */
/** `onPaid` lets the page refresh its claim list once a proof marks claims paid. */
export function ServicesReportPanel({ onPaid }: { onPaid?: () => void } = {}) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  // Work is approved after the month ends on the 25th, so the last finished month is the one ready to pay.
  const [month, setMonth] = useState(previousMonth(payMonth(todayLocal())));
  const [includePrf, setIncludePrf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [download, setDownload] = useState<Download | null>(null);
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState('');
  const [proofFor, setProofFor] = useState<Prf | null>(null);
  const [paidNotice, setPaidNotice] = useState('');
  const save = useAction();
  const prfs = useApi<Prf[]>(month ? `/finance/services-payment-report/prfs${qs({ month })}` : null);

  const fetchReport = async (format: 'csv' | 'pdf') => {
    setBusy(true);
    setError('');
    setDownload(null);
    save.setError(null);
    try {
      const result = await api.blob(`/finance/services-payment-report/export${qs({ month, format, include_prf: includePrf })}`, 'GET', `services-payment-${month}.${format}`);
      saveBlob(result);
      const id = result.headers?.get('x-download-id');
      if (id) setDownload(await api.get<Download>(`/finance/services-payment-report/downloads/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : (sw ? 'Imeshindikana kupakua ripoti ya Huduma.' : 'Could not download the Services report.'));
    } finally {
      setBusy(false);
    }
  };

  const record = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!download) return;
    const result = await save.run(() => api.post<Prf>('/finance/services-payment-report/prf', {
      download_id: download.id, prf_number: number.trim(), prf_date: date, note: note.trim() || null,
    }));
    if (result) {
      setDownload({ ...download, prf: result });
      setNumber('');
      setNote('');
      prfs.reload();
    }
  };

  const monthDate = new Date(`${month}-01T00:00:00Z`);
  const monthText = Number.isNaN(monthDate.getTime()) ? month : new Intl.DateTimeFormat(sw ? 'sw' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(monthDate);
  const awaitingProof = (prfs.data || []).filter((prf) => prf.paid_count < prf.claim_count).length;
  const prfCount = prfs.data?.length ?? null;

  return (
    <details className="card folded fin-prf-panel" aria-label={sw ? 'Nyaraka za malipo ya Huduma' : 'Services payment documentation'}>
      <summary>
        <span className="fin-prf-title">{sw ? 'Ripoti ya malipo ya Huduma, PRF na uthibitisho wa malipo' : 'Services payment report, PRF and proof of payment'}</span>
        <span className="fin-prf-meta">
          {monthText}
          {prfCount !== null && <> · {sw ? `PRF ${num(prfCount)}` : `${num(prfCount)} ${prfCount === 1 ? 'PRF' : 'PRFs'}`}</>}
          {awaitingProof > 0 && <> · <span className="fin-prf-due">{sw ? `${num(awaitingProof)} ${awaitingProof === 1 ? 'inasubiri' : 'zinasubiri'} uthibitisho` : `${num(awaitingProof)} awaiting proof`}</span></>}
        </span>
      </summary>
      <div className="stack">
        <div className="row">
          <Field label={sw ? 'Mwezi wa ripoti ya Huduma' : 'Services report month'} hint={payMonthDates(month)}>
            <input type="month" required value={month} onChange={(e) => { setMonth(e.target.value); setDownload(null); }} />
          </Field>
          <button className="btn btn-secondary" disabled={busy || !month} onClick={() => fetchReport('csv')}>{sw ? 'Pakua CSV ya Huduma' : 'Download Services CSV'}</button>
          <button className="btn btn-secondary" disabled={busy || !month} onClick={() => fetchReport('pdf')}>{sw ? 'Pakua PDF ya Huduma' : 'Download Services PDF'}</button>
        </div>
        <label className="check-line small">
          <input type="checkbox" checked={includePrf} onChange={(e) => setIncludePrf(e.target.checked)} />
          <span>{sw ? 'Jumuisha madai yaliyo kwenye PRF tayari (kumbukumbu tu, haiwezi kurekodi PRF)' : 'Include claims already on a PRF (reference only, cannot record a PRF)'}</span>
        </label>
        <Alert>{error}</Alert>

        {download && (
          <section className="card stack" aria-label={sw ? 'Rekodi PRF' : 'Record the PRF'}>
            <h3>{sw ? 'Rekodi PRF ya faili hili' : 'Record the PRF for this download'}</h3>
            <p className="small">
              {sw
                ? `Faili ${download.format.toUpperCase()} la ${dateTime(download.downloaded_at)}: madai ${num(download.claim_count)}, mistari ${num(download.row_count)}, jumla ${amountsText(download.amounts)}.`
                : `${download.format.toUpperCase()} downloaded ${dateTime(download.downloaded_at)}: ${num(download.claim_count)} claims, ${num(download.row_count)} rows, total ${amountsText(download.amounts)}.`}
            </p>
            {download.prf ? (
              <Alert kind="success">{sw ? `Imerekodiwa kama PRF ${download.prf.prf_number}.` : `Recorded as PRF ${download.prf.prf_number}.`}</Alert>
            ) : download.awaiting_review > 0 ? (
              <Alert kind="warn">{sw
                ? `Madai ${num(download.awaiting_review)} bado yanasubiri mapitio ya Fedha Kuu. Yaidhinishe, kisha pakua tena.`
                : `${num(download.awaiting_review)} claim(s) still await Central Finance review. Approve them, then download again.`}</Alert>
            ) : includePrf ? (
              <Alert kind="info">{sw ? 'Pakua tena bila kisanduku hicho ili kurekodi PRF mpya.' : 'Download again without that box ticked to record a new PRF.'}</Alert>
            ) : (
              <form className="stack" onSubmit={record}>
                <div className="grid-2">
                  <Field label={sw ? 'Namba ya PRF' : 'PRF number'}>
                    <input required maxLength={50} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="PRF/2026/001" />
                  </Field>
                  <Field label={sw ? 'Tarehe ya PRF' : 'PRF date'}>
                    <input type="date" required max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                </div>
                <Field label={sw ? 'Maelezo (si lazima)' : 'Note (optional)'}>
                  <input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <div><button type="submit" className="btn btn-primary" disabled={save.busy || !number.trim()}>{save.busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Rekodi PRF' : 'Record PRF')}</button></div>
                <Alert>{save.error}</Alert>
              </form>
            )}
          </section>
        )}

        <h3>{sw ? `PRF za ${monthText}` : `PRFs for ${monthText}`}</h3>
        {prfs.error && <Alert>{prfs.error}</Alert>}
        {prfs.data && !prfs.data.length && <p className="muted small">{sw ? 'Hakuna PRF iliyorekodiwa kwa mwezi huu.' : 'No PRF recorded for this month yet.'}</p>}
        {!!prfs.data?.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{sw ? 'Namba ya PRF' : 'PRF number'}</th><th>{sw ? 'Tarehe' : 'Date'}</th><th className="num">{sw ? 'Madai' : 'Claims'}</th><th className="num">{sw ? 'Jumla' : 'Total'}</th><th>{sw ? 'Malipo' : 'Payment'}</th><th>{sw ? 'Imerekodiwa na' : 'Recorded by'}</th><th>{sw ? 'Maelezo' : 'Note'}</th></tr>
              </thead>
              <tbody>
                {prfs.data.map((prf) => (
                  <tr key={prf.id}>
                    <td className="nowrap"><strong>{prf.prf_number}</strong></td>
                    <td className="nowrap">{dateOnly(prf.prf_date)}</td>
                    <td className="num">{num(prf.claim_count)}</td>
                    <td className="num nowrap">{amountsText(prf.amounts)}</td>
                    <td>
                      {prf.paid_count >= prf.claim_count
                        ? <span className="badge badge-success">{sw ? 'Imelipwa' : 'Paid'}</span>
                        : <>
                          <div className="small">{sw ? `Yamelipwa ${num(prf.paid_count)} kati ya ${num(prf.claim_count)}` : `Paid ${num(prf.paid_count)} of ${num(prf.claim_count)}`}</div>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setPaidNotice(''); setProofFor(prf); }}>
                            {sw ? 'Pakia uthibitisho wa malipo' : 'Upload proof of payment'}
                          </button>
                        </>}
                    </td>
                    <td><span className="cell-main">{prf.recorded_by}</span><span className="cell-sub">{dateTime(prf.recorded_at)}</span></td>
                    <td>{prf.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Alert kind="success">{paidNotice || null}</Alert>
        {proofFor && <PrfProofDialog prf={proofFor} onClose={() => setProofFor(null)} onDone={(paid) => {
          setPaidNotice(sw ? `Uthibitisho umehifadhiwa. Madai ${num(paid)} kwenye PRF ${proofFor.prf_number} yamerekodiwa kuwa yamelipwa.` : `Proof saved. ${num(paid)} claim(s) on PRF ${proofFor.prf_number} are recorded as paid.`);
          setProofFor(null);
          prfs.reload();
          onPaid?.();
        }} />}
      </div>
    </details>
  );
}
