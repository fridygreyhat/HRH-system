import React, { useEffect, useState } from 'react';
import { api, qs, saveBlob } from '../api';
import { useAuth } from '../AuthContext';
import { Alert, AsyncState, Empty, Field } from '../components/ui';
import { money, num, payMonth, payMonthDates, previousMonth, todayLocal, workHours } from '../format';
import { useAction, useApi } from '../hooks';
import './finance-monthly-report.css';

type WorkType = 'PAYROLL' | 'SERVICES';
interface Options { work_types: WorkType[]; regions: { id: number; name: string }[]; cadres?: { id: number; name: string }[] }
interface Person {
  staff_id: number; name: string; cadre: string; region: string; facility: string; community_area: string | null;
  days: number; hours: string; amount: string | null; currency: string; state: string; activities: number;
}
interface Pack { work_type: WorkType; month: string; region: string | null; facility: string | null; totals: Record<string, string>; people: Person[] }

const FILES: { what: string; title: [string, string]; hint: [string, string]; formats: string[] }[] = [
  { what: 'timesheets', title: ['Timesheets', 'Majedwali'], hint: ['One page per person, payment summary last', 'Ukurasa kwa kila mtu, muhtasari wa malipo mwishoni'], formats: ['pdf'] },
  { what: 'activities', title: ['Activity totals', 'Jumla za shughuli'], hint: ['Month totals, added up by the group you choose', 'Jumla za mwezi kwa kundi unalochagua'], formats: ['xlsx', 'pdf'] },
  { what: 'summary', title: ['Payment summary', 'Muhtasari wa malipo'], hint: ['The form to sign, all staff', 'Fomu ya kusaini, watumishi wote'], formats: ['xlsx', 'pdf'] },
  { what: 'import', title: ['Import file', 'Faili la kuingiza'], hint: ['One clean table to import into another system', 'Jedwali safi la kuingiza kwenye mfumo mwingine'], formats: ['xlsx', 'csv'] },
];
const FORMAT_NAME: Record<string, string> = { pdf: 'PDF', xlsx: 'Excel', csv: 'CSV' };
const GROUPS: [string, string, string][] = [
  ['person', 'Person', 'Mtu'], ['facility', 'Facility', 'Kituo'], ['region', 'Region', 'Mkoa'], ['cadre', 'Cadre', 'Kada'], ['all', 'All providers', 'Wote'],
];

/** Timesheets, activity totals, payment summary and import file, Payroll and Services separate, by region, facility or person. */
export function FinanceDownloads() {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const options = useApi<Options>('/finance-pack/options');
  const [workType, setWorkType] = useState<WorkType | ''>('');
  const [month, setMonth] = useState(() => previousMonth(payMonth(todayLocal())));
  const [regionId, setRegionId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [cadreId, setCadreId] = useState('');
  const [groupBy, setGroupBy] = useState('person');
  const download = useAction();
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (options.data && (!workType || !options.data.work_types.includes(workType))) setWorkType(options.data.work_types[0] || '');
    if (options.data && !regionId && options.data.regions.length === 1) setRegionId(String(options.data.regions[0].id));
  }, [options.data, workType, regionId]);
  useEffect(() => { setFacilityId(''); setStaffId(''); }, [regionId, workType]);
  useEffect(() => { setStaffId(''); }, [facilityId, cadreId]);

  const facilities = useApi<{ id: number; name: string }[]>(regionId ? `/finance-pack/facilities${qs({ region_id: regionId })}` : null);
  const selection = { work_type: workType, month, region_id: regionId, facility_id: facilityId, cadre_id: cadreId };
  const pack = useApi<Pack>(workType && month ? `/finance-pack${qs(selection)}` : null);
  const files = { ...selection, staff_id: staffId };
  const payroll = workType === 'PAYROLL';

  const save = async (what: string, format: string) => {
    setBusy(`${what}.${format}`);
    const extra = what === 'activities' ? { group_by: groupBy } : {};
    const file = await download.run(() => api.blob(`/finance-pack/download${qs({ what, format, ...files, ...extra })}`, 'GET', `${what}.${format}`));
    setBusy('');
    if (file) saveBlob(file);
  };

  const people = pack.data?.people || [];
  const shown = staffId ? people.filter((p) => String(p.staff_id) === staffId) : people;
  const total = Object.entries(pack.data?.totals || {}).map(([currency, value]) => money(value, currency)).join(' + ') || '—';
  const kindName = (kind: WorkType) => (kind === 'PAYROLL' ? (sw ? 'Mshahara' : 'Payroll') : (sw ? 'Huduma' : 'Services'));

  return (
    <div className="stack-lg finance-downloads">
      <header className="page-header">
        <h1>{sw ? 'Upakuaji wa Fedha' : 'Finance downloads'}</h1>
        <p className="muted">{sw
          ? 'Mshahara na Huduma kando kando: majedwali, jumla za shughuli, muhtasari wa malipo na faili la kuingiza, kwa mkoa, kituo au mtu mmoja.'
          : 'Payroll and Services kept separate: timesheets, activity totals, payment summary and an import file, for a region, one facility or one person.'}</p>
      </header>
      <AsyncState data={options.data} error={options.error} loading={options.loading}>
        {(opts) => (
          <div className="stack">
            {opts.work_types.length > 1 && (
              <nav className="subnav" aria-label={sw ? 'Aina ya kazi' : 'Work type'}>
                {opts.work_types.map((kind) => (
                  <button key={kind} type="button" aria-current={workType === kind ? 'page' : undefined} onClick={() => setWorkType(kind)}>
                    {kindName(kind)}
                  </button>
                ))}
              </nav>
            )}
            <p className="muted small">{payroll
              ? (sw ? 'Mshahara hulipwa na CSO, baada ya Fedha ya Mkoa kusaini na kutuma.' : 'Payroll is paid by the CSO, after Regional Finance signs and sends it.')
              : (sw ? 'Huduma hulipwa na Fedha Kuu FHI360, baada ya Fedha ya Mkoa kuzituma.' : 'Services are paid by FHI360 Central Finance, after Regional Finance sends them.')}</p>
            <div className="filters">
              <Field label={sw ? 'Mwezi wa malipo' : 'Pay month'} hint={payMonthDates(month)}>
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </Field>
              <Field label={sw ? 'Mkoa' : 'Region'}>
                <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
                  <option value="">{sw ? 'Mikoa yote yangu' : 'All my regions'}</option>
                  {opts.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
              <Field label={sw ? 'Kituo' : 'Facility'}>
                <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} disabled={!regionId}>
                  <option value="">{regionId ? (sw ? 'Vituo vyote' : 'All facilities') : (sw ? 'Chagua mkoa kwanza' : 'Choose a region first')}</option>
                  {(facilities.data || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </Field>
              <Field label={sw ? 'Kada' : 'Cadre'}>
                <select value={cadreId} onChange={(e) => setCadreId(e.target.value)}>
                  <option value="">{sw ? 'Kada zote' : 'All cadres'}</option>
                  {(opts.cadres || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label={sw ? 'Mtu mmoja' : 'One person'}>
                <select value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={!people.length}>
                  <option value="">{sw ? 'Watoa huduma wote' : 'All providers'}</option>
                  {people.map((p) => <option key={p.staff_id} value={p.staff_id}>{p.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="download-grid">
              {FILES.map((file) => (
                <div key={file.what} className="card download-card">
                  <strong>{file.title[sw ? 1 : 0]}</strong>
                  <span className="muted small">{file.hint[sw ? 1 : 0]}</span>
                  {file.what === 'activities' && (
                    <label className="small group-by">
                      {sw ? 'Jumla kwa' : 'Totals by'}{' '}
                      <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label={sw ? 'Jumla kwa' : 'Totals by'}>
                        {GROUPS.map(([value, en, swName]) => <option key={value} value={value}>{sw ? swName : en}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="row">
                    {file.formats.map((format) => (
                      <button key={format} type="button" className="btn btn-secondary btn-sm" disabled={!shown.length || download.busy}
                        onClick={() => save(file.what, format)}>
                        {busy === `${file.what}.${format}` ? (sw ? 'Inaandaa…' : 'Preparing…') : FORMAT_NAME[format]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Alert>{download.error}</Alert>
            <AsyncState data={pack.data} error={pack.error} loading={pack.loading}>
              {() => (shown.length ? (
                <div className="stack">
                  <p className="fin-footnote">
                    {sw ? `Watumishi ${num(shown.length)}` : `${num(shown.length)} ${shown.length === 1 ? 'person' : 'people'}`} · {sw ? 'Jumla' : 'Total'} {staffId
                      ? (shown[0].amount ? money(shown[0].amount, shown[0].currency) : '—') : total}
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">{sw ? 'Jina' : 'Name'}</th>
                          <th scope="col">{sw ? 'Kada' : 'Cadre'}</th>
                          <th scope="col">{sw ? 'Mkoa · kituo' : 'Region · facility'}</th>
                          <th scope="col" className="num">{payroll ? (sw ? 'Siku zilizojazwa' : 'Days filled') : (sw ? 'Siku' : 'Days')}</th>
                          <th scope="col" className="num">{sw ? 'Masaa' : 'Hours'}</th>
                          <th scope="col" className="num">{payroll ? (sw ? 'Mshahara' : 'Salary') : (sw ? 'Kiasi' : 'Amount')}</th>
                          <th scope="col">{sw ? 'Hali' : 'Status'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((p) => (
                          <tr key={p.staff_id}>
                            <td>{p.name}</td>
                            <td>{p.cadre}</td>
                            <td>{p.region} · {p.facility || p.community_area || '—'}</td>
                            <td className="num">{num(p.days)}</td>
                            <td className="num">{workHours(p.hours)}</td>
                            <td className="num">{p.amount ? money(p.amount, p.currency) : '—'}</td>
                            <td>{p.state}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : <Empty>{sw ? 'Hakuna mtu katika uchaguzi huu kwa mwezi huu.' : 'Nobody is in this selection for the month.'}</Empty>)}
            </AsyncState>
          </div>
        )}
      </AsyncState>
    </div>
  );
}
