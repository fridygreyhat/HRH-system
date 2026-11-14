import React, { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../AuthContext';
import { Alert, AsyncState, Empty, Field } from '../components/ui';
import { WorkLogDrawer } from '../components/worklogs/WorkLogDrawer';
import { supportedServiceFundingSources } from '../components/worklogs/FundingReview';
import { money, num, payMonth, payMonthDates, previousMonth, todayLocal } from '../format';
import { useApi } from '../hooks';
import { navigate } from '../nav';
import './finance-monthly-report.css';
import './polish-finance.css';

type WorkType = 'PAYROLL' | 'SERVICES';
interface Row {
  work_log_id: number; provider_name: string; cadre: string; cadre_id: number; facility: string;
  step: 'timesheet' | 'amount'; amount: string | null; flags: string[]; clean: boolean;
}
interface Listing { rows: Row[]; counts: { total: number; clean: number; flagged: number } }
interface Result { approved: number[]; skipped: { work_log_id: number; provider_name?: string; reason: string }[] }
const CHUNK = 200;
const SHOWN = 100;

function parseTarget(target?: string) {
  const match = /^(PAYROLL|SERVICES):(\d{4}-\d{2}):(\d+)$/.exec(target || '');
  return match ? { workType: match[1] as WorkType, month: match[2], regionId: match[3] } : null;
}

/**
 * Regional Finance approves a region's month of timesheets in bulk (1,000+ of each kind). Only clean ones are approved
 * together; flagged ones are listed apart and opened one by one. Approving sends nothing: Services then go to Central
 * Finance with "Send month", Payroll to the CSO with "Sign and send to CSO".
 */
export function BulkApproval({ initial }: { initial?: string } = {}) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const opened = parseTarget(initial);
  const [workType, setWorkType] = useState<WorkType>(opened?.workType || 'SERVICES');
  const [month, setMonth] = useState(opened?.month || previousMonth(payMonth(todayLocal())));
  const [regionId, setRegionId] = useState(opened?.regionId || '');
  const [cadreId, setCadreId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fundingId, setFundingId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const regions = useApi<{ id: number; name: string }[]>('/finance/regions');
  const facilities = useApi<{ id: number; name: string }[]>(regionId ? `/finance-pack/facilities${qs({ region_id: regionId })}` : null);
  const listing = useApi<Listing>(regionId && month ? `/finance/bulk-review${qs({ work_type: workType, month, region_id: regionId, cadre_id: cadreId, facility_id: facilityId })}` : null);
  const fundingSources = useApi<{ id: number; name: string; code: string }[]>(workType === 'SERVICES' ? '/admin/funding-sources' : null);
  const sources = supportedServiceFundingSources(fundingSources.data || []);

  useEffect(() => { if (!regionId && regions.data?.length === 1) setRegionId(String(regions.data[0].id)); }, [regionId, regions.data]);
  useEffect(() => { setSelected(new Set()); setConfirmed(false); setResult(null); setError(''); setShowAll(false); }, [workType, month, regionId, cadreId, facilityId]);
  useEffect(() => { setFacilityId(''); setCadreId(''); }, [regionId]);

  const rows = listing.data?.rows || [];
  const clean = useMemo(() => rows.filter((r) => r.clean), [rows]);
  const flagged = useMemo(() => rows.filter((r) => !r.clean), [rows]);
  const cadres = useMemo(() => Array.from(new Map(rows.map((r) => [r.cadre_id, r.cadre])).entries()), [rows]);
  const selectedTotal = clean.filter((r) => selected.has(r.work_log_id)).reduce((t, r) => t + Number(r.amount || 0), 0);
  const allClean = clean.length > 0 && clean.every((r) => selected.has(r.work_log_id));
  const payroll = workType === 'PAYROLL';
  const toggle = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const approve = async () => {
    const ids = clean.filter((r) => selected.has(r.work_log_id)).map((r) => r.work_log_id);
    const total: Result = { approved: [], skipped: [] };
    setError('');
    setProgress({ done: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = await api.post<Result>('/finance/bulk-approve', {
          work_type: workType, month, region_id: Number(regionId), work_log_ids: ids.slice(i, i + CHUNK),
          funding_source_id: payroll ? null : Number(fundingId), review_confirmed: true,
        });
        total.approved.push(...part.approved);
        total.skipped.push(...part.skipped);
        setProgress({ done: Math.min(i + CHUNK, ids.length), total: ids.length });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : (sw ? 'Imeshindikana kuidhinisha.' : 'Could not approve.'));
    } finally {
      setProgress(null);
      setResult(total);
      setSelected(new Set());
      setConfirmed(false);
      listing.reload();
    }
  };

  const typeName = (kind: WorkType) => (kind === 'PAYROLL' ? (sw ? 'Mshahara' : 'Payroll') : (sw ? 'Huduma' : 'Services'));
  const list = showAll ? clean : clean.slice(0, SHOWN);

  return (
    <div className="stack-lg bulk-approval">
      <header className="page-header">
        <h1>{sw ? 'Idhinisha majedwali' : 'Approve timesheets'}</h1>
        <p className="muted">{sw
          ? 'Idhinisha majedwali safi ya mkoa kwa mwezi kwa pamoja. Yenye alama yanakaguliwa moja moja. Kuidhinisha hakutumi chochote.'
          : 'Approve a region’s clean timesheets for the month together. Flagged ones are checked one by one. Approving sends nothing.'}</p>
      </header>
      <nav className="subnav" aria-label={sw ? 'Aina ya kazi' : 'Work type'}>
        {(['SERVICES', 'PAYROLL'] as WorkType[]).map((kind) => (
          <button key={kind} type="button" aria-current={workType === kind ? 'page' : undefined} onClick={() => setWorkType(kind)}>{typeName(kind)}</button>
        ))}
      </nav>
      <p className="muted small">{payroll
        ? (sw ? 'Baada ya kuidhinisha yote ya mkoa, Saini na utume kwa CSO.' : 'When every Payroll timesheet of the region is approved, sign and send the month to the CSO.')
        : (sw ? 'Huduma: jedwali na kiasi vinaidhinishwa pamoja kwa chanzo kimoja cha fedha. Kisha tuma mwezi kwa Fedha Kuu.' : 'Services: the timesheet and its amount are approved together, with one funding source. Then send the month to Central Finance.')}</p>
      <div className="filters">
        <Field label={sw ? 'Mwezi wa malipo' : 'Pay month'} hint={payMonthDates(month)}>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <Field label={sw ? 'Mkoa' : 'Region'}>
          <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            <option value="">{sw ? 'Chagua mkoa' : 'Choose a region'}</option>
            {(regions.data || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label={sw ? 'Kada' : 'Cadre'}>
          <select value={cadreId} onChange={(e) => setCadreId(e.target.value)} disabled={!regionId}>
            <option value="">{sw ? 'Kada zote' : 'All cadres'}</option>
            {cadres.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </Field>
        <Field label={sw ? 'Kituo' : 'Facility'}>
          <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} disabled={!regionId}>
            <option value="">{sw ? 'Vituo vyote' : 'All facilities'}</option>
            {(facilities.data || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      </div>

      {!regionId ? <Empty>{sw ? 'Chagua mkoa ili kuona majedwali yanayosubiri.' : 'Choose a region to see the timesheets waiting for you.'}</Empty> : (
        <AsyncState data={listing.data} error={listing.error} loading={listing.loading}>
          {(data) => (
            <div className="stack">
              <dl className="send-month-counts">
                <div><dt>{sw ? 'Yanasubiri' : 'Waiting'}</dt><dd>{num(data.counts.total)}</dd></div>
                <div className={data.counts.clean ? 'is-ready' : ''}><dt>{sw ? 'Safi: yanaidhinishwa pamoja' : 'Clean: approve together'}</dt><dd>{num(data.counts.clean)}</dd></div>
                <div><dt>{sw ? 'Yenye alama: moja moja' : 'Flagged: one by one'}</dt><dd>{num(data.counts.flagged)}</dd></div>
              </dl>

              {result && (
                <Alert kind={result.skipped.length ? 'warn' : 'success'}>
                  {sw ? `Yameidhinishwa ${num(result.approved.length)}.` : `${num(result.approved.length)} approved.`}
                  {result.skipped.length > 0 && (sw ? ` ${num(result.skipped.length)} yameachwa: ` : ` ${num(result.skipped.length)} left for one-by-one review: `)}
                  {result.skipped.slice(0, 5).map((s) => `${s.provider_name || `#${s.work_log_id}`} (${s.reason})`).join('; ')}
                  {' '}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(payroll ? 'payroll-to-cso' : 'routing-queue')}>
                    {payroll ? (sw ? 'Saini na utume kwa CSO' : 'Sign and send to CSO') : (sw ? 'Tuma mwezi kwa Fedha Kuu' : 'Send month to Central Finance')}
                  </button>
                </Alert>
              )}
              <Alert>{error}</Alert>

              {clean.length > 0 && (
                <section className="card stack" aria-label={sw ? 'Majedwali safi' : 'Clean timesheets'}>
                  <div className="row">
                    <label className="check-line">
                      <input type="checkbox" checked={allClean} onChange={() => setSelected(allClean ? new Set() : new Set(clean.map((r) => r.work_log_id)))} />
                      <span><b>{sw ? `Chagua yote safi (${num(clean.length)})` : `Select all clean (${num(clean.length)})`}</b></span>
                    </label>
                    <span className="muted small">{sw ? `Umechagua ${num(selected.size)}` : `${num(selected.size)} selected`}{!payroll && selected.size ? ` · ${money(selectedTotal)}` : ''}</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th scope="col" aria-label={sw ? 'Chagua' : 'Select'} /><th scope="col">{sw ? 'Mtoa huduma' : 'Provider'}</th><th scope="col">{sw ? 'Kada' : 'Cadre'}</th><th scope="col">{sw ? 'Kituo' : 'Facility'}</th>{!payroll && <th scope="col" className="num">{sw ? 'Kiasi' : 'Amount'}</th>}</tr></thead>
                      <tbody>
                        {list.map((r) => (
                          <tr key={r.work_log_id}>
                            <td><input type="checkbox" aria-label={r.provider_name} checked={selected.has(r.work_log_id)} onChange={() => toggle(r.work_log_id)} /></td>
                            <td>{r.provider_name}</td><td>{r.cadre}</td><td>{r.facility}</td>
                            {!payroll && <td className="num">{r.amount ? money(r.amount) : '—'}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {clean.length > SHOWN && !showAll && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll(true)}>
                      {sw ? `Onyesha yote ${num(clean.length)}` : `Show all ${num(clean.length)}`}
                    </button>
                  )}
                  {!payroll && (
                    <Field label={sw ? 'Chanzo cha fedha' : 'Funding source'}>
                      <select value={fundingId} onChange={(e) => setFundingId(e.target.value)}>
                        <option value="">{sw ? 'Chagua chanzo cha fedha' : 'Choose funding source'}</option>
                        {sources.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}
                      </select>
                    </Field>
                  )}
                  <label className="check-line small">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                    <span>{sw
                      ? `Nimekagua majedwali ${num(selected.size)} niliyochagua na ninayaidhinisha.`
                      : `I checked the ${num(selected.size)} selected timesheets and approve them.`}</span>
                  </label>
                  <div className="row">
                    <button type="button" className="btn btn-primary" disabled={!selected.size || !confirmed || (!payroll && !fundingId) || !!progress} onClick={approve}>
                      {progress
                        ? (sw ? `Inaidhinisha ${num(progress.done)} kati ya ${num(progress.total)}…` : `Approving ${num(progress.done)} of ${num(progress.total)}…`)
                        : (sw ? `Idhinisha ${num(selected.size)}` : `Approve ${num(selected.size)}`)}
                    </button>
                  </div>
                </section>
              )}

              {flagged.length > 0 && (
                <section className="card stack" aria-label={sw ? 'Yenye alama' : 'Flagged'}>
                  <h2>{sw ? `Yenye alama: kagua moja moja (${num(flagged.length)})` : `Flagged: review one by one (${num(flagged.length)})`}</h2>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th scope="col">{sw ? 'Mtoa huduma' : 'Provider'}</th><th scope="col">{sw ? 'Kada' : 'Cadre'}</th><th scope="col">{sw ? 'Sababu' : 'Why'}</th><th scope="col" /></tr></thead>
                      <tbody>
                        {flagged.map((r) => (
                          <tr key={r.work_log_id}>
                            <td>{r.provider_name}<div className="muted small">{r.facility}</div></td><td>{r.cadre}</td>
                            <td className="small">{r.flags.join('; ')}</td>
                            <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpenId(r.work_log_id)}>{sw ? 'Fungua' : 'Open'}</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {!data.rows.length && <Empty>{sw ? 'Hakuna majedwali yanayosubiri kwa mkoa na mwezi huu.' : 'No timesheets wait for you for this region and month.'}</Empty>}
            </div>
          )}
        </AsyncState>
      )}
      {openId !== null && <WorkLogDrawer logId={openId} onClose={() => setOpenId(null)} onChanged={listing.reload} />}
    </div>
  );
}
