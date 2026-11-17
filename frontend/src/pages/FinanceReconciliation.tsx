import React, { useMemo, useState } from 'react';
import { api, qs, saveBlob } from '../api';
import { useAuth } from '../AuthContext';
import { dateOnly, money, num, payMonth, payMonthDates, previousMonth, todayLocal } from '../format';
import { useAction, useApi } from '../hooks';
import { Alert, AsyncState, Empty, Field, KpiStrip, Section } from '../components/ui';
import { AuditDashboard } from '../components/finance/AuditDashboard';
import { CentralDashboard } from '../components/finance/CentralDashboard';
import './polish-admin.css';

type WorkType = 'PAYROLL' | 'SERVICES';

interface Totals {
  providers: number;
  issues: number;
  expected: string;
  paid: string;
  outstanding: string;
  overpaid: string;
  in_review: string;
  paid_in_full: number;
}

interface SummaryRow {
  work_type: WorkType;
  region_name: string | null;
  cadre_name: string;
  providers: number;
  expected: string;
  paid: string;
  outstanding: string;
  overpaid: string;
  in_review: string;
  issues: number;
}

export interface ReconProvider {
  work_type: WorkType;
  staff_id: number;
  provider_name: string;
  cadre_code: string;
  cadre_name: string;
  region_name: string | null;
  claim_id: number | null;
  expected: string | null;
  paid: string;
  outstanding: string;
  overpaid: string;
  in_review: string;
  status: string;
  status_text: string;
  issues: string[];
  references: string[];
}

interface Issue {
  work_type: WorkType;
  region_name: string | null;
  cadre_name: string | null;
  provider_name: string | null;
  claim_id: number | null;
  issue: string;
  text: string;
  amount: string | null;
}

export interface Reconciliation {
  month: string;
  totals: { PAYROLL: Totals; SERVICES: Totals; all: Totals };
  summary: SummaryRow[];
  issues: Issue[];
  providers: ReconProvider[];
  digest: string;
  can_sign: boolean;
  signoff: { signed_by_name: string | null; signed_at: string; note: string | null; issue_count: number; current: boolean } | null;
  regions: { id: number; name: string }[];
}

const WORK_TYPE: Record<WorkType, { en: string; sw: string }> = {
  PAYROLL: { en: 'Payroll', sw: 'Mshahara' },
  SERVICES: { en: 'Services', sw: 'Huduma' },
};
const CADRES = [
  { code: 'CHW', en: 'CHW', sw: 'CHW' },
  { code: 'DATA_CLERK', en: 'Data Clerk', sw: 'Karani wa takwimu' },
  { code: 'HCP', en: 'HCP', sw: 'HCP' },
];
const STATUS_TONE: Record<string, string> = {
  PAID: 'badge-success', IN_REVIEW: 'badge-neutral', NOT_PAID: 'badge-warn', PART_PAID: 'badge-warn',
};
const PAGE_SIZE = 25;

/** Providers that need follow-up first, then the rest, in the server's order. */
export function providersToShow(rows: ReconProvider[], search: string, issuesOnly: boolean): ReconProvider[] {
  const term = search.trim().toLocaleLowerCase();
  return rows.filter((row) => (!issuesOnly || row.issues.length > 0)
    && (!term || [row.provider_name, row.cadre_name, row.region_name || '', ...row.references].some((value) => value.toLocaleLowerCase().includes(term))));
}

function SignOff({ data, monthQuery, sw, onSigned }: { data: Reconciliation; monthQuery: { month: string; region_id: string }; sw: boolean; onSigned: () => void }) {
  const [note, setNote] = useState('');
  const sign = useAction();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const done = await sign.run(() => api.post('/finance/reconciliation/sign', {
      month: monthQuery.month, region_id: monthQuery.region_id ? Number(monthQuery.region_id) : null,
      expected_digest: data.digest, note: note.trim() || null,
    }));
    if (done) {
      setNote('');
      onSigned();
    }
  };
  const signed = data.signoff;
  return (
    <div className="stack">
      {signed ? (
        <Alert kind={signed.current ? 'success' : 'warn'}>
          {sw ? `Imethibitishwa na ${signed.signed_by_name} tarehe ${dateOnly(signed.signed_at)}` : `Reconciled by ${signed.signed_by_name} on ${dateOnly(signed.signed_at)}`}
          {signed.note && ` — ${signed.note}`}
          {!signed.current && (sw ? '. Takwimu zimebadilika tangu hapo: kagua na uthibitishe tena.' : '. The figures have changed since: check and reconcile again.')}
        </Alert>
      ) : <p className="muted small">{sw ? 'Mwezi huu bado haujathibitishwa na Fedha Kuu.' : 'Central Finance has not reconciled this month yet.'}</p>}
      {data.can_sign && (!signed || !signed.current) && (
        <form className="stack" onSubmit={submit}>
          <Field label={`${sw ? 'Maelezo' : 'Note'}${data.issues.length ? ' *' : ''}`}
            hint={data.issues.length
              ? (sw ? 'Kuna masuala yaliyo wazi: eleza yatakavyofuatiliwa.' : 'There are open issues: say how each will be followed up.')
              : (sw ? 'Si lazima.' : 'Optional.')}>
            <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000}
              required={data.issues.length > 0} minLength={data.issues.length ? 10 : undefined} />
          </Field>
          <Alert>{sign.error}</Alert>
          <div>
            <button type="submit" className="btn btn-primary" disabled={sign.busy}>
              {sign.busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Thibitisha ulinganisho wa mwezi' : 'Mark this month reconciled')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Central Finance, Oversight and Regional Finance: what was approved to pay against what was paid, by region and cadre. */
export function FinanceReconciliation() {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const [month, setMonth] = useState(() => previousMonth(payMonth(todayLocal())));
  const [regionId, setRegionId] = useState('');
  const [workType, setWorkType] = useState('');
  const [cadre, setCadre] = useState('');
  const [search, setSearch] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<'central' | 'dashboard' | 'detail'>('central');
  const query = { month, region_id: regionId, work_type: workType, cadre };
  const data = useApi<Reconciliation>(month ? `/finance/reconciliation${qs(query)}` : null);
  const download = useAction();
  const tr = (en: string, swText: string) => (sw ? swText : en);

  const shown = useMemo(() => providersToShow(data.data?.providers || [], search, issuesOnly), [data.data, search, issuesOnly]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);

  const save = async (format: 'xlsx' | 'csv') => {
    const file = await download.run(() => api.blob(`/finance/reconciliation/export${qs({ ...query, format })}`, 'GET', `reconciliation-${month}.${format}`));
    if (file) saveBlob(file);
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>{tr('Financial audit and reconciliation', 'Ukaguzi na ulinganisho wa fedha')}</h1>
          <p className="muted">{tr('What was approved to pay against what was recorded as paid, for Payroll and Services, by region and cadre.',
            'Kilichoidhinishwa kulipwa dhidi ya kilichorekodiwa kuwa kimelipwa, kwa Mshahara na Huduma, kwa mkoa na kada.')}</p>
        </div>
      </div>
      <nav className="subnav" aria-label={tr('Financial audit views', 'Mionekano ya ukaguzi')}>
        <button type="button" aria-current={tab === 'central' ? 'page' : undefined} onClick={() => setTab('central')}>{tr('Central dashboard', 'Dashibodi kuu')}</button>
        <button type="button" aria-current={tab === 'dashboard' ? 'page' : undefined} onClick={() => setTab('dashboard')}>{tr('One month', 'Mwezi mmoja')}</button>
        <button type="button" aria-current={tab === 'detail' ? 'page' : undefined} onClick={() => setTab('detail')}>{tr('Reconciliation', 'Ulinganisho')}</button>
      </nav>
      <div className="fin-toolbar">
        <div className="filters">
          {tab !== 'central' && <Field label={tr('Month worked', 'Mwezi wa kazi')} hint={payMonthDates(month)}>
            <input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setPage(0); }} />
          </Field>}
          <Field label={tr('Region', 'Mkoa')}>
            <select value={regionId} onChange={(event) => { setRegionId(event.target.value); setPage(0); }}>
              <option value="">{tr('All my regions', 'Mikoa yangu yote')}</option>
              {(data.data?.regions || []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </Field>
          {tab === 'detail' && <>
          <Field label={tr('Payment type', 'Aina ya malipo')}>
            <select value={workType} onChange={(event) => { setWorkType(event.target.value); setPage(0); }}>
              <option value="">{tr('Payroll and Services', 'Mshahara na Huduma')}</option>
              {(Object.keys(WORK_TYPE) as WorkType[]).map((key) => <option key={key} value={key}>{sw ? WORK_TYPE[key].sw : WORK_TYPE[key].en}</option>)}
            </select>
          </Field>
          <Field label={tr('Cadre', 'Kada')}>
            <select value={cadre} onChange={(event) => { setCadre(event.target.value); setPage(0); }}>
              <option value="">{tr('All cadres', 'Kada zote')}</option>
              {CADRES.map((c) => <option key={c.code} value={c.code}>{sw ? c.sw : c.en}</option>)}
            </select>
          </Field>
          </>}
        </div>
        {tab === 'detail' && <div className="fin-actions">
          <button type="button" className="btn btn-primary" onClick={() => save('xlsx')} disabled={download.busy || !data.data}>{tr('Download Excel', 'Pakua Excel')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => save('csv')} disabled={download.busy || !data.data}>{tr('Download CSV', 'Pakua CSV')}</button>
        </div>}
      </div>
      {tab === 'central' ? <div className="dash"><CentralDashboard regionId={regionId} /></div>
        : tab === 'dashboard' ? <div className="dash"><AuditDashboard month={month} regionId={regionId} /></div> : <>
      <Alert>{download.error}</Alert>
      <AsyncState data={data.data} error={data.error} loading={data.loading}>
        {(d) => (
          <div className="stack-lg">
            <KpiStrip
              label={tr('Reconciliation totals', 'Jumla za ulinganisho')}
              items={[
                { label: tr('Approved to pay', 'Imeidhinishwa kulipwa'), value: money(d.totals.all.expected), icon: 'wallet' },
                { label: tr('Paid', 'Imelipwa'), value: money(d.totals.all.paid), icon: 'check', tone: 'success' },
                { label: tr('Still to pay', 'Bado kulipwa'), value: money(d.totals.all.outstanding), icon: 'clock', tone: Number(d.totals.all.outstanding) ? 'warn' : 'success' },
                { label: tr('Paid over approved', 'Malipo zaidi ya idhini'), value: money(d.totals.all.overpaid), icon: 'shield', tone: Number(d.totals.all.overpaid) ? 'danger' : 'neutral' },
                { label: tr('Issues to follow up', 'Masuala ya kufuatilia'), value: num(d.issues.length), icon: 'alert', tone: d.issues.length ? 'warn' : 'success',
                  note: Number(d.totals.all.in_review) ? `${tr('In review', 'Bado kukaguliwa')}: ${money(d.totals.all.in_review)}` : undefined },
              ]}
            />
            <Section title={tr('Reconciliation sign-off', 'Uthibitisho wa ulinganisho')}>
              <SignOff data={d} monthQuery={{ month, region_id: regionId }} sw={sw} onSigned={data.reload} />
              {!d.can_sign && (workType || cadre) && <p className="muted small">{tr('Clear the payment type and cadre filters to reconcile the whole month.', 'Ondoa vichujio vya aina ya malipo na kada ili kuthibitisha mwezi wote.')}</p>}
            </Section>
            <Section title={tr('By region and cadre', 'Kwa mkoa na kada')}>
              {d.summary.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{tr('Payment type', 'Aina')}</th>
                        <th scope="col">{tr('Region', 'Mkoa')}</th>
                        <th scope="col">{tr('Cadre', 'Kada')}</th>
                        <th scope="col" className="num">{tr('Providers', 'Watoa huduma')}</th>
                        <th scope="col" className="num">{tr('Approved to pay', 'Imeidhinishwa')}</th>
                        <th scope="col" className="num">{tr('Paid', 'Imelipwa')}</th>
                        <th scope="col" className="num">{tr('Still to pay', 'Bado')}</th>
                        <th scope="col" className="num">{tr('Paid over', 'Zaidi')}</th>
                        <th scope="col" className="num">{tr('Issues', 'Masuala')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.summary.map((row) => (
                        <tr key={`${row.work_type}-${row.region_name}-${row.cadre_name}`}>
                          <td>{sw ? WORK_TYPE[row.work_type].sw : WORK_TYPE[row.work_type].en}</td>
                          <td>{row.region_name || '—'}</td>
                          <td>{row.cadre_name}</td>
                          <td className="num">{num(row.providers)}</td>
                          <td className="num nowrap">{money(row.expected)}{Number(row.in_review) > 0 && <span className="cell-sub">{tr('In review', 'Ukaguzi')}: {money(row.in_review)}</span>}</td>
                          <td className="num nowrap">{money(row.paid)}</td>
                          <td className="num nowrap">{money(row.outstanding)}</td>
                          <td className="num nowrap">{money(row.overpaid)}</td>
                          <td className="num">{row.issues ? <span className="badge badge-warn">{num(row.issues)}</span> : <span className="badge badge-success">0</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>{tr('Nothing approved or paid for this month and selection.', 'Hakuna kilichoidhinishwa au kulipwa kwa mwezi huu.')}</Empty>}
            </Section>
            {d.issues.length > 0 && (
              <Section title={`${tr('Issues to follow up', 'Masuala ya kufuatilia')} (${num(d.issues.length)})`}>
                <ul className="fin-signed-list">
                  {d.issues.slice(0, 50).map((issue, index) => (
                    <li key={`${issue.issue}-${issue.provider_name}-${issue.claim_id}-${index}`}>
                      <span className="badge badge-warn">{sw ? WORK_TYPE[issue.work_type].sw : WORK_TYPE[issue.work_type].en}</span>
                      <span>
                        <strong>{issue.provider_name || issue.region_name}:</strong> {issue.text}
                        {issue.amount && Number(issue.amount) > 0 && ` · ${money(issue.amount)}`}
                        {issue.provider_name && ` · ${[issue.cadre_name, issue.region_name].filter(Boolean).join(', ')}`}
                        {issue.claim_id && ` · ${tr('claim', 'dai')} #${issue.claim_id}`}
                      </span>
                    </li>
                  ))}
                </ul>
                {d.issues.length > 50 && <p className="muted small">{tr(`And ${num(d.issues.length - 50)} more in the Excel file.`, `Na mengine ${num(d.issues.length - 50)} kwenye faili la Excel.`)}</p>}
              </Section>
            )}
            <Section title={tr('Every provider', 'Kila mtoa huduma')}>
              <div className="filters">
                <Field label={tr('Find', 'Tafuta')}>
                  <input type="search" value={search} placeholder={tr('Name, cadre, region or payment reference', 'Jina, kada, mkoa au kumbukumbu ya malipo')}
                    onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
                </Field>
                <label className="check-line small">
                  <input type="checkbox" checked={issuesOnly} onChange={(event) => { setIssuesOnly(event.target.checked); setPage(0); }} />
                  <span>{tr('Only providers with an issue', 'Wenye masuala tu')}</span>
                </label>
              </div>
              {shown.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{tr('Provider', 'Mtoa huduma')}</th>
                        <th scope="col">{tr('Payment type', 'Aina')}</th>
                        <th scope="col" className="num">{tr('Approved to pay', 'Imeidhinishwa')}</th>
                        <th scope="col" className="num">{tr('Paid', 'Imelipwa')}</th>
                        <th scope="col">{tr('Status', 'Hali')}</th>
                        <th scope="col">{tr('Payment references', 'Kumbukumbu za malipo')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((row) => (
                        <tr key={`${row.work_type}-${row.staff_id}-${row.claim_id}`}>
                          <td><span className="cell-main">{row.provider_name}</span><span className="cell-sub">{row.cadre_name} · {row.region_name}</span></td>
                          <td>{sw ? WORK_TYPE[row.work_type].sw : WORK_TYPE[row.work_type].en}{row.claim_id && <span className="cell-sub">#{row.claim_id}</span>}</td>
                          <td className="num nowrap">{row.expected !== null ? money(row.expected) : '—'}{Number(row.in_review) > 0 && <span className="cell-sub">{tr('In review', 'Ukaguzi')}: {money(row.in_review)}</span>}</td>
                          <td className="num nowrap">{money(row.paid)}</td>
                          <td><span className={`badge ${STATUS_TONE[row.status] || 'badge-danger'}`}>{row.status_text}</span>
                            {row.issues.includes('NO_PROOF') && <span className="cell-sub">{tr('No proof of payment', 'Hakuna uthibitisho')}</span>}</td>
                          <td className="small">{row.references.join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>{issuesOnly ? tr('No provider has an open issue.', 'Hakuna mtoa huduma mwenye suala.') : tr('No providers match.', 'Hakuna anayelingana.')}</Empty>}
              {pages > 1 && (
                <div className="row fin-pager">
                  <span className="muted small">{num(current * PAGE_SIZE + 1)}–{num(Math.min((current + 1) * PAGE_SIZE, shown.length))} {tr('of', 'kati ya')} {num(shown.length)}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage(current - 1)} disabled={current === 0}>{tr('Previous', 'Iliyotangulia')}</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>{tr('Next', 'Inayofuata')}</button>
                </div>
              )}
            </Section>
          </div>
        )}
      </AsyncState>
      </>}
    </div>
  );
}
