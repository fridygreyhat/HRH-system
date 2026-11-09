import React, { useState } from 'react';
import { api, qs, saveBlob } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateOnly, dateTime, money, num, payMonth, payMonthDates, previousMonth, todayLocal } from '../../format';
import { monthLabel } from '../../pages/PrintWorkLog';
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

  return (
    <details className="card folded" open aria-label={sw ? 'Nyaraka za malipo ya Huduma' : 'Services payment documentation'}>
      <summary>{sw ? 'Ripoti ya malipo ya Huduma, PRF na uthibitisho wa malipo' : 'Services payment report, PRF and proof of payment'}</summary>
      <div className="stack">
        <ol className="prf-steps">
          <li>{sw ? 'Pakua ripoti ya Huduma (CSV au PDF).' : 'Download the Services report (CSV or PDF).'}</li>
          <li>{sw ? 'Rekodi namba ya PRF uliyoiandaa kutoka faili hilo.' : 'Record the PRF number you raised from that file.'}</li>
          <li>{sw ? 'Lipa nje ya mfumo (benki au pesa kwa simu).' : 'Pay outside the system (bank or mobile money).'}</li>
          <li>{sw ? 'Pakia uthibitisho wa malipo kwenye PRF hiyo hapa chini.' : 'Upload the proof of payment on that PRF below.'}</li>
        </ol>
        <p className="muted small">{sw
          ? 'Pakua Huduma zilizotumwa za mwezi, andaa PRF kutoka kwenye faili hilo, kisha rekodi namba ya PRF hapa. Madai yaliyo tayari kwenye PRF hayamo kwenye ripoti inayofuata, ili pesa ileile isiombwe mara mbili.'
          : 'Download the routed Services for the month, raise the PRF from that file, then record its PRF number here. Claims already on a PRF are left out of the next report, so the same money is never requested twice.'}</p>
        <div className="row">
          <Field label={sw ? 'Mwezi wa ripoti ya Huduma' : 'Services report month'} hint={payMonthDates(month)}>
            <input type="month" required value={month} onChange={(e) => { setMonth(e.target.value); setDownload(null); }} />
          </Field>
          <button className="btn btn-secondary" disabled={busy || !month} onClick={() => fetchReport('csv')}>{sw ? 'Pakua CSV ya Huduma' : 'Download Services CSV'}</button>
          <button className="btn btn-secondary" disabled={busy || !month} onClick={() => fetchReport('pdf')}>{sw ? 'Pakua PDF ya Huduma' : 'Download Services PDF'}</button>
        </div>
        <label className="check-line small">
          <input type="checkbox" checked={includePrf} onChange={(e) => setIncludePrf(e.target.checked)} />
          <span>{sw ? 'Jumuisha madai yaliyo tayari kwenye PRF (kwa kumbukumbu tu; PRF haiwezi kurekodiwa kutoka faili hili)' : 'Include claims already on a PRF (for reference only; a PRF cannot be recorded from this file)'}</span>
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
                ? `Madai ${num(download.awaiting_review)} kwenye faili hili bado yanasubiri mapitio yako ya Fedha Kuu. Yaidhinishe kwanza, kisha pakua tena ili kurekodi PRF.`
                : `${num(download.awaiting_review)} claim(s) in this file still await your Central Finance review. Approve them first, then download again to record the PRF.`}</Alert>
            ) : includePrf ? (
              <Alert kind="info">{sw ? 'Faili hili lina madai yaliyo kwenye PRF tayari. Pakua tena bila kisanduku hicho ili kurekodi PRF mpya.' : 'This file includes claims already on a PRF. Download again without that box ticked to record a new PRF.'}</Alert>
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

        <h3>{sw ? `PRF za ${monthLabel(month)}` : `PRFs for ${monthLabel(month)}`}</h3>
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
                    <td>{prf.prf_number}</td>
                    <td>{dateOnly(prf.prf_date)}</td>
                    <td className="num">{num(prf.claim_count)}</td>
                    <td className="num">{amountsText(prf.amounts)}</td>
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
                    <td>{prf.recorded_by}<div className="muted small">{dateTime(prf.recorded_at)}</div></td>
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
