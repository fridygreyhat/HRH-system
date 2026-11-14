import React, { useEffect, useState } from 'react';
import { api, qs } from '../../api';
import { money, num, payMonth, payMonthDates, previousMonth, todayLocal } from '../../format';
import { useAction, useApi } from '../../hooks';
import { Alert, Field } from '../ui';

interface MonthStatus {
  counts: { review: number; ready: number; hold: number; sent: number };
  ready_total: string;
  currency: string;
  ready: { work_log_id: number; provider_name: string; amount: string | null }[];
  central_reviewers: { id: number; name: string; username: string }[];
}

/**
 * Regional Finance checks each Services timesheet and amount, then sends the region's whole month to FHI360 Central
 * Finance in one step, as Payroll is signed and sent to the CSO.
 */
export function SendServicesMonth({ regions, regionId, sw, onSent }: {
  regions: { id: number; name: string }[]; regionId: string; sw: boolean; onSent: () => void;
}) {
  const [month, setMonth] = useState(() => previousMonth(payMonth(todayLocal())));
  const [region, setRegion] = useState(regionId);
  const [reviewer, setReviewer] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const send = useAction();
  useEffect(() => { if (regionId) setRegion(regionId); }, [regionId]);
  useEffect(() => { if (!region && regions.length === 1) setRegion(String(regions[0].id)); }, [region, regions]);
  useEffect(() => { setConfirmed(false); setReviewer(''); setNotice(''); }, [month, region]);
  const status = useApi<MonthStatus>(region && month ? `/finance/services-month${qs({ month, region_id: region })}` : null);
  const data = status.data;
  useEffect(() => {
    if (data?.central_reviewers.length === 1) setReviewer(String(data.central_reviewers[0].id));
  }, [data]);

  const submit = async () => {
    const result = await send.run(() => api.post<{ count: number }>('/finance/services-month/send', {
      month, region_id: Number(region), central_reviewer_id: Number(reviewer), review_confirmed: true,
    }));
    if (result) {
      setNotice(sw ? `Huduma ${num(result.count)} zimetumwa kwa Fedha Kuu.` : `${num(result.count)} Services sent to Central Finance.`);
      setConfirmed(false);
      status.reload();
      onSent();
    }
  };

  return (
    <section className="card stack send-month" aria-label={sw ? 'Tuma mwezi kwa Fedha Kuu' : 'Send month to Central Finance'}>
      <h2>{sw ? 'Tuma Huduma za mwezi kwa Fedha Kuu FHI360' : 'Send the month’s Services to FHI360 Central Finance'}</h2>
      <p className="muted small">{sw
        ? 'Kagua kila jedwali na kiasi chake hapa chini kwanza. Kisha tuma zote zilizokaguliwa za mkoa kwa mwezi huo kwa hatua moja.'
        : 'Check each timesheet and its amount below first. Then send all the checked ones for the region and month in one step.'}</p>
      <div className="filters">
        <Field label={sw ? 'Mwezi wa malipo' : 'Pay month'} hint={payMonthDates(month)}>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <Field label={sw ? 'Mkoa' : 'Region'}>
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">{sw ? 'Chagua mkoa' : 'Choose a region'}</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      </div>
      {status.error && <Alert>{status.error}</Alert>}
      {data && (
        <>
          <dl className="send-month-counts">
            <div><dt>{sw ? 'Bado kukaguliwa' : 'Still to check'}</dt><dd>{num(data.counts.review)}</dd></div>
            <div className={data.counts.ready ? 'is-ready' : ''}><dt>{sw ? 'Tayari kutumwa' : 'Ready to send'}</dt><dd>{num(data.counts.ready)} · {money(data.ready_total, data.currency)}</dd></div>
            <div><dt>{sw ? 'Zimezuiwa' : 'On hold'}</dt><dd>{num(data.counts.hold)}</dd></div>
            <div><dt>{sw ? 'Zimetumwa' : 'Already sent'}</dt><dd>{num(data.counts.sent)}</dd></div>
          </dl>
          {data.counts.review > 0 && data.counts.ready > 0 && (
            <p className="notice notice-warn small">{sw
              ? `Huduma ${num(data.counts.review)} bado hazijakaguliwa; zitabaki hapa hadi utakapozikagua na kuzituma.`
              : `${num(data.counts.review)} still to check will stay here until you check and send them.`}</p>
          )}
          {data.counts.ready > 0 ? (
            <div className="stack">
              <Field label={sw ? 'Mkaguzi wa Fedha Kuu' : 'Central Finance reviewer'}>
                <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
                  <option value="">{sw ? 'Chagua mkaguzi' : 'Choose a reviewer'}</option>
                  {data.central_reviewers.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
                </select>
              </Field>
              {!data.central_reviewers.length && <Alert kind="warn">{sw ? 'Hakuna mkaguzi wa Fedha Kuu anayeweza kuidhinisha Huduma hizi zote.' : 'No Central Finance reviewer may approve all of these Services.'}</Alert>}
              <label className="check-line small">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>{sw
                  ? `Nimekagua Huduma ${num(data.counts.ready)} za mwezi huu (${money(data.ready_total, data.currency)}) na ninazituma kwa Fedha Kuu.`
                  : `I checked these ${num(data.counts.ready)} Services (${money(data.ready_total, data.currency)}) and send them to Central Finance.`}</span>
              </label>
              <div className="row">
                <button type="button" className="btn btn-primary" disabled={!confirmed || !reviewer || send.busy} onClick={submit}>
                  {send.busy ? (sw ? 'Inatuma…' : 'Sending…') : (sw ? `Tuma ${num(data.counts.ready)} kwa Fedha Kuu` : `Send ${num(data.counts.ready)} to Central Finance`)}
                </button>
              </div>
            </div>
          ) : (
            <p className="muted small">{sw ? 'Hakuna Huduma zilizokaguliwa za kutuma kwa mkoa na mwezi huu.' : 'No checked Services to send for this region and month.'}</p>
          )}
        </>
      )}
      <Alert>{send.error}</Alert>
      <Alert kind="success">{notice}</Alert>
    </section>
  );
}
